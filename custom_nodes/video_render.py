"""Local browser-frame rendering bridge and MP4 encoding."""

import asyncio
from concurrent.futures import Future
from fractions import Fraction
from io import BytesIO
import math
from pathlib import Path
import threading
import time
from uuid import UUID, uuid4

from .camera_format import output_aspect, output_dimensions
from .motion_io import camera_document
from .local_jobs import write_json

import av
from aiohttp import web
from .route_security import same_origin
from PIL import Image


class VideoRender:
    def __init__(self, destination, width, height, fps):
        self.destination = Path(destination)
        self.temporary = self.destination.with_suffix(".mp4.part")
        self.width, self.height, self.fps = width, height, fps
        self.pass_renders = {}
        self.frames = 0
        self.expected_frames = None
        self.duration = None
        self.completed = Future()
        self.lock = threading.Lock()
        self.container = None
        self.stream = None
        self.last_activity = time.monotonic()

    def start(self, duration):
        with self.lock:
            duration = self.duration if self.duration is not None else duration
            if self.container is not None or self.completed.done():
                raise ValueError("The render has already started or ended.")
            if not isinstance(duration, (int, float)) or not math.isfinite(duration) or not 0 < duration <= 120:
                raise ValueError("The rendered clip duration must be between 0 and 120 seconds.")
            self.duration = duration
            self.expected_frames = math.ceil(duration * self.fps)
            self.destination.parent.mkdir(parents=True, exist_ok=True)
            self.container = av.open(str(self.temporary), mode="w", format="mp4", options={"movflags": "+faststart"})
            self.stream = self.container.add_stream("libx264", rate=self.fps)
            self.stream.width, self.stream.height, self.stream.pix_fmt = self.width, self.height, "yuv420p"
            self.stream.options = {"crf": "18", "preset": "fast"}
            for child in self.pass_renders.values():child.start(duration)
            self.last_activity = time.monotonic()
            return self.expected_frames

    def add_frame(self, index, data):
        with self.lock:
            if self.container is None or self.completed.done():
                raise ValueError("This render is not accepting frames.")
            if index != self.frames or index >= self.expected_frames:
                raise ValueError("Render frames must arrive once, in timeline order.")
            with Image.open(BytesIO(data)) as image:
                if image.format != "PNG" or image.size != (self.width, self.height):
                    raise ValueError("The rendered PNG does not match the requested dimensions.")
                if index in {0,self.expected_frames-1}:
                    image.save(self.destination.with_suffix('.first.png' if index==0 else '.last.png'))
                frame = av.VideoFrame.from_image(image.convert("RGB"))
            frame.pts = index
            frame.time_base = Fraction(1, self.fps)
            for packet in self.stream.encode(frame):
                self.container.mux(packet)
            self.frames += 1
            self.last_activity = time.monotonic()

    def finish(self, camera_track=None):
        with self.lock:
            if self.container is None or self.completed.done() or self.frames != self.expected_frames:
                raise ValueError("The render has not received every frame.")
            track = None
            if camera_track is not None:
                track = camera_document(camera_track)
                if track['fps'] != self.fps or abs(track['aspect']-self.width/self.height)>1e-6 or len(track['frames'])!=self.expected_frames+1 or any(abs(row['time']-i/self.fps)>1e-6 for i,row in enumerate(track['frames'][:-1])) or abs(track['frames'][-1]['time']-self.duration)>1e-6:
                    raise ValueError("The saved camera does not match this rendered timeline.")
                actors=camera_track.get('render_actors',[])
                expected=getattr(self,'actor_formats',{})
                if not isinstance(actors,list) or any(not isinstance(a,dict) for a in actors):raise ValueError('Invalid saved actor references.')
                if expected and (len(actors)!=len(expected) or {a.get('actor') for a in actors}!=set(expected) or any(a.get('format') not in expected[a['actor']] for a in actors)):
                    raise ValueError("The saved actors do not match this rendered scene.")
                depth=camera_track.get('depth_range')
                if depth is not None and (not isinstance(depth,dict) or any(type(depth.get(k)) not in {int,float} or not math.isfinite(depth[k]) for k in ['near','far']) or not 0<depth['near']<depth['far']<=100000):raise ValueError('Invalid clip-wide depth range.')
                track.update(render_actors=actors,width=self.width,height=self.height,frame_count=self.expected_frames,
                             world_frame=getattr(self,'world_frame',None),editor_recipe=getattr(self,'editor_recipe',None),
                             pose_status=camera_track.get('pose_status',{}),depth_range=camera_track.get('depth_range'))
            elif getattr(self,'require_camera_track',False):
                raise ValueError("Refresh the ComfyUI browser and rerun to save the rendered camera path.")
            for packet in self.stream.encode():
                self.container.mux(packet)
            self.container.close()
            self.container = None
            self.temporary.replace(self.destination)
            if track is not None:
                write_json(self.destination.with_suffix('.camera.json'),track)
            for child in self.pass_renders.values():child.finish(camera_track)
            self.completed.set_result(self.destination)

    def abort(self, message):
        with self.lock:
            if not self.completed.done():
                if self.container is not None:
                    self.container.close()
                    self.container = None
                self.temporary.unlink(missing_ok=True)
                self.destination.unlink(missing_ok=True);self.destination.with_suffix('.camera.json').unlink(missing_ok=True)
                for child in self.pass_renders.values():
                    if not child.completed.done():child.abort(message)
                    child.destination.unlink(missing_ok=True)
                    child.destination.with_suffix('.camera.json').unlink(missing_ok=True)
                for suffix in ['.first.png','.last.png']:self.destination.with_suffix(suffix).unlink(missing_ok=True)
                self.completed.set_exception(RuntimeError(message))


class RenderBridge:
    def __init__(self):
        self.jobs = {}
        self.lock = threading.Lock()

    def register(self, server):
        @server.routes.post("/cartwheel/render/{token}/{action}")
        async def receive(request):
            same_origin(request)
            with self.lock:
                job = self.jobs.get(request.match_info["token"])
            if job is None:
                raise web.HTTPNotFound(text="This render request has expired.")
            action = request.match_info["action"]
            try:
                if action == "start":
                    body = await request.json()
                    count = await asyncio.to_thread(job.start, body.get("duration"))
                    return web.json_response({"frames": count})
                if action == "frame":
                    data = await request.read()
                    if len(data) > 20 * 1024 * 1024:
                        raise ValueError("The rendered frame is too large.")
                    index = int(request.query.get("index", "-1"))
                    kind=request.query.get('pass','color')
                    target=job if kind=='color' else job.pass_renders.get(kind)
                    if target is None:raise ValueError('Unknown control render pass.')
                    await asyncio.to_thread(target.add_frame, index, data)
                elif action == "finish":
                    body = await request.json() if request.can_read_body else None
                    await asyncio.to_thread(job.finish, body)
                elif action == "error":
                    await asyncio.to_thread(job.abort, "The browser could not render this clip. Check the camera preview and run again.")
                else:
                    raise web.HTTPNotFound()
            except (ValueError, OSError, av.error.FFmpegError) as error:
                await asyncio.to_thread(job.abort, "Local video rendering failed. Check the camera preview and run again.")
                raise web.HTTPBadRequest(text=str(error)) from None
            return web.json_response({"ok": True})

    async def render(self, server, view_id, descriptor, output_root, resolution, fps, camera_index, check_interrupt, progress, *, camera=None, motion=None, client_id=None):
        try:
            UUID(view_id)
        except (ValueError, TypeError, AttributeError):
            raise ValueError("Refresh ComfyUI in your browser to enable this camera node's VIDEO output.") from None
        sid = client_id or server.client_id
        if not sid or sid not in server.sockets:
            raise ValueError("Camera VIDEO rendering requires the workflow's ComfyUI browser to remain connected.")
        if resolution not in {"720p", "1080p"} or str(fps) not in {"24", "30", "60", "120"}:
            raise ValueError("Choose a supported render size and frame rate.")
        if type(camera_index) is not int or not 0 <= camera_index < len(descriptor["camera"]["cameras"]):
            raise ValueError("Choose a camera available in this captured scene.")
        native_aspect = descriptor["camera"]["cameras"][camera_index]["aspect"]
        aspect = output_aspect(camera.get("settings", {}).get("output_frame") if camera else None, native_aspect)
        width, height = output_dimensions(resolution, aspect)
        token = uuid4().hex
        job = VideoRender(Path(output_root) / "cartwheel" / "renders" / f"camera_{token}.mp4", width, height, int(fps))
        if motion is not None:
            for kind in ['depth','normal','pose']:
                job.pass_renders[kind]=VideoRender(job.destination.with_name(job.destination.stem+'_'+kind+'.mp4'),width,height,int(fps))
        job.editor_recipe=camera.get('settings') if camera else None;job.world_frame=motion.get('world_frame') if motion else None
        job.require_camera_track = motion is not None
        job.actor_formats = {a['actor']:{a.get('format','fbx')} | ({'fbx'} if a.get('native_reference') else set()) for a in descriptor.get('actors',[])}
        if camera is not None:
            job.duration = camera["timeline"]["duration"]
        with self.lock:
            self.jobs[token] = job
        future = asyncio.wrap_future(job.completed)
        server.send_sync("cartwheel.render", {"view_id": view_id, "token": token, "scene": descriptor,
                                             "width": width, "height": height, "fps": int(fps), "camera_index": camera_index, "camera": camera, "motion": motion, "control_passes":list(job.pass_renders)}, sid)
        try:
            while not future.done():
                check_interrupt()
                if sid not in server.sockets:
                    raise RuntimeError("The ComfyUI browser disconnected during video rendering. Reconnect and run again.")
                if time.monotonic() - job.last_activity > 45:
                    raise RuntimeError("The browser did not respond to the render request. Refresh the page and run again.")
                if job.expected_frames:
                    await progress(round(100 * job.frames / job.expected_frames))
                await asyncio.wait({future}, timeout=0.25)
            result = await future
            await progress(100)
            return result
        finally:
            with self.lock:
                self.jobs.pop(token, None)
            if not job.completed.done():
                await asyncio.to_thread(job.abort, "Camera video rendering was interrupted.")
            if future.done() and not future.cancelled():
                future.exception()


bridge = RenderBridge()
