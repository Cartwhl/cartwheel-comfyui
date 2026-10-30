from .transport import api_session
import asyncio
from contextlib import contextmanager
import json
from pathlib import Path
from tempfile import TemporaryDirectory

from comfy.cli_args import args
from comfy.model_management import throw_exception_if_processing_interrupted
from comfy_execution.graph import ExecutionBlocker
from comfy_api.latest import ComfyAPI, InputImpl, Types, VideoContainer, io, ui
import folder_paths

from .job_progress import JobProgress
from .delivery import source_context, attach_render, image_tensor, selected_control, delivery_settings, render_context, camera_video_flags
from .reference_library import References, Prepared, prepare_collection
from .client import CartwheelError, Client, capture, validate_glb
from .config import read_connection
from .camera import DEFAULT_SETTINGS, motion_from_capture, make_editor_camera, validate_render_camera, with_camera_source, read_camera_settings, history_camera_settings
from .history import load_history_capture
from .motion_io import import_motion, validate_motion, persist_motion, camera_from_motion, with_camera_input
from .local_jobs import load_job, save_job, job_path
from .scene import capture_files, load_capture, scene_preview
from .video_render import bridge
from .media import DEFAULT_PROMPT, MODEL_LIMITS, inspect_video, validate_capture_video, validate_references, reference_windows, trim_audio
from server import PromptServer


Capture = io.Custom("CARTWHEEL_CAPTURE")
Motion = io.Custom("CARTWHEEL_MOTION")
Camera = io.Custom("CARTWHEEL_CAMERA")
EXPORT_FPS = ["24", "30", "60", "120"]
QUALITY_PRESETS = {"Smoothed (faster)": "smoothed", "Balanced": "balanced", "Detailed (slower)": "detailed"}
SPLINE_OPTIONS = {"None": "none", "Rebuild curves": "simplify"}
# MHR export resource used by this workflow; the public API checks account access.
MHR_CHARACTER_ID = "char-upload-MHR"


def connection():
    path = Path(folder_paths.get_public_user_directory("default")) / "comfy.settings.json"
    return read_connection(path, multi_user=args.multi_user)


@contextmanager
def upload_source(video):
    with TemporaryDirectory(prefix="cartwheel-", dir=folder_paths.get_temp_directory()) as temporary:
        if type(video) is InputImpl.VideoFromFile and video.get_active_trim_window() == (0.0, 0.0):
            source = video.get_stream_source()
            if isinstance(source, str) and video.get_dimensions() == InputImpl.VideoFromFile(source).get_dimensions():
                path = Path(source)
                if path.suffix.lower() in {".avi", ".mkv", ".mov", ".mp4", ".webm"}:
                    yield path
                    return
        path = Path(temporary) / "source.mp4"
        video.save_to(str(path), format=VideoContainer.MP4)
        yield path


def source_sockets():
    return [io.Video.Output("source_video", tooltip="Exact submitted source, with original audio when present."),
            io.String.Output("source_info", tooltip="JSON metadata: exact duration, dimensions, rational FPS, frame count and audio availability."),
            io.Float.Output("source_fps"), io.Int.Output("source_frames"), io.Float.Output("source_duration")]


def capture_source_path(capture):
    source = capture.get("source") or {}
    path = Path(source["path"]).resolve() if source.get("path") else None
    root = (Path(folder_paths.get_output_directory()) / "cartwheel").resolve()
    contained = path and any(parent.is_dir() and root.is_dir() and parent.samefile(root) for parent in path.parents)
    return path if path and path.is_file() and contained else None


def source_outputs(capture):
    source = capture.get("source") or {}
    path = capture_source_path(capture)
    if path is None:
        return (ExecutionBlocker("Original source video is unavailable. Load the original file separately."),
                json.dumps({"available": False}), 0.0, 0, 0.0)
    info = source.get("metadata") or inspect_video(path)
    return (InputImpl.VideoFromFile(str(path)), json.dumps({"available": True, **info}, indent=2),
            info["fps"], info["frame_count"], info["duration"])


def scene_sockets():
    return [Motion.Output("motion", tooltip="Source-independent animated actors and shared timeline/world frame."),
            Camera.Output("camera", tooltip="Starting camera, reusable separately from the motion.")]


def scene_outputs(capture, motion_index=0):
    motion,camera=_scene_outputs(capture,motion_index)
    source=source_context(capture,folder_paths.get_output_directory())
    if source:motion['source_media']=source;motion=persist_motion(motion,folder_paths.get_output_directory())
    return motion,camera


def _scene_outputs(capture, motion_index=0):
    item = capture.get("motions", [])[motion_index]
    if not item.get("assets", {}).get("camera"):
        glbs = [Path(path) for key, path in sorted(item.get("assets", {}).items())
                if key.startswith("export_") and path and Path(path).suffix.lower() == ".glb"]
        motion = import_motion(glbs, None, folder_paths.get_output_directory())
        motion["scene"].pop("material_policy", None)
        motion["title"] = str(capture.get("title") or capture.get("generation_options",{}).get("batchName") or "Saved motion")[:200]
        return persist_motion(motion, folder_paths.get_output_directory()), None
    motion = motion_from_capture(capture, folder_paths.get_output_directory(), motion_index)
    motion = persist_motion(motion, folder_paths.get_output_directory())
    motion["title"] = str(capture.get("title") or capture.get("generation_options",{}).get("batchName") or capture.get("capture_options",{}).get("batchName") or "Saved motion")[:200]
    return motion, camera_from_motion(motion)


class CartwheelPerformanceCapture(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="CartwheelPerformanceCapture",
            display_name="Cartwheel Performance Capture",
            category="Cartwheel",
            description="Cartwheel Performance Capture using the Comic 4 model and MHR through the public API. Matching video/settings reuse completed local files; interrupted submissions resume. Increase New capture version for another paid capture. Uses your saved Cartwheel key and Cartwheel credits.",
            is_experimental=True,
            is_output_node=True,
            hidden=[io.Hidden.unique_id],
            inputs=[
                io.Video.Input("video"),
                io.Combo.Input("numPeople", display_name="Actors", options=[1, 2, 3, 4], default=1, tooltip="Maximum actors to capture automatically. This does not select specific people in a crowd."),
                io.Boolean.Input("facialCapture", display_name="Facial capture", default=True),
                io.Boolean.Input("footPlanting", display_name="Foot stabilization", default=True, tooltip="Contact-aware foot planting and skating correction."),
                io.Combo.Input("qualityPreset", display_name="Capture quality", options=list(QUALITY_PRESETS), default="Smoothed (faster)", tooltip="Relative preset labels; processing time varies."),
                io.Combo.Input("frameRate", display_name="Export frame rate", options=EXPORT_FPS, default="60", tooltip="External API exportSettings.frameRate. Does not change source upload timing or the native MHR preview."),
                io.Combo.Input("keyframeCleaning", display_name="Spline simplification", options=list(SPLINE_OPTIONS), default="None", advanced=True, tooltip="None keeps sampled keys. Rebuild curves simplifies the GLB export animation curves."),
                io.Int.Input('capture_version',display_name='New capture version',default=0,min=0,optional=True,advanced=True,tooltip='Matching video/settings reuse completed local results. Increase this number to request a new paid capture.'),
            ],
            outputs=[
                io.Video.Output("preview"),
                Capture.Output("capture"),
                io.File3DGLB.Output("glb", tooltip="First actor's GLB motion export with mesh. All actors' GLB paths are retained in capture. Connect to Preview 3D (Advanced) → model_3d."),
                io.String.Output("export_path", tooltip="First actor's GLB export path. All returned actors are saved under output/cartwheel."),
            ] + source_sockets() + scene_sockets(),
        )

    @classmethod
    def fingerprint_inputs(cls, **kwargs):
        try:
            return connection().fingerprint
        except ValueError:
            return "unconfigured"

    @classmethod
    async def execute(cls, video, numPeople, facialCapture, footPlanting, qualityPreset, frameRate,
                      keyframeCleaning="None",capture_version=0,batchName=None):
        # Accept stale API-workflow names for compatibility, but never forward them.
        if type(numPeople) is not int or numPeople not in {1, 2, 3, 4}:
            raise ValueError("Actors must be 1, 2, 3, or 4.")
        if qualityPreset not in QUALITY_PRESETS or keyframeCleaning not in SPLINE_OPTIONS or str(frameRate) not in EXPORT_FPS:
            raise ValueError("Choose one of the supported capture quality, spline, and frame-rate options.")
        if type(capture_version) is not int or capture_version<0:raise ValueError("New capture version must be a nonnegative integer.")
        configured = connection()
        options = {
            "comicModel": "comic4", "numPeople": numPeople, "facialCapture": facialCapture,
            "footPlanting": footPlanting, "qualityPreset": QUALITY_PRESETS[qualityPreset], "loop": False,
            "exportSettings": {"characterID": MHR_CHARACTER_ID, "exportType": "glb", "frameRate": float(frameRate),
                               "includeMesh": True, "keyframeCleaning": SPLINE_OPTIONS[keyframeCleaning], "forward": "-Z", "up": "Y",
                               "frameStepSize": 1, "moveInPlace": False},
        }
        progress = JobProgress(cls, "performance", video.get_duration(), numPeople, facialCapture, api=ComfyAPI)
        await progress(0)
        # The source remains alive across upload and is deleted only if materialized locally.
        with upload_source(video) as source:
            validate_capture_video({"duration": video.get_duration(), "size_bytes": source.stat().st_size})
            source_info = await asyncio.to_thread(inspect_video, source)
            validate_capture_video(source_info)
            width, height = source_info["width"], source_info["height"]
            metadata = {"name": source.stem[:100], "extension": source.suffix[1:].lower(), "duration": source_info["duration"], "resolution": f"{width}x{height}"}
            async with api_session() as session:
                result = await capture(Client(configured, session), source, metadata, options,
                                       Path(folder_paths.get_system_user_directory("cartwheel")) / "jobs",
                                       Path(folder_paths.get_output_directory()) / "cartwheel",
                                       throw_exception_if_processing_interrupted, progress, source_metadata=source_info,capture_version=capture_version)
        preview = Path(result["motions"][0]["assets"]["preview"])
        for motion in result["motions"]:
            for name, path in motion["assets"].items():
                if name.startswith("export_") and path:
                    validate_glb(Path(path))
        glb = result["motions"][0]["assets"].get("export_0")
        if not glb:
            raise CartwheelError("Cartwheel did not return the first actor's GLB export. The capture and downloaded assets were retained.")
        subfolder = str(preview.parent.relative_to(folder_paths.get_output_directory()))
        return io.NodeOutput(InputImpl.VideoFromFile(str(preview)), result, Types.File3D(glb), glb, *source_outputs(result), *scene_outputs(result),
                             ui=ui.PreviewVideo([ui.SavedResult(preview.name, subfolder, io.FolderType.output)]))


class CartwheelLoadCapture(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        files = capture_files(folder_paths.get_output_directory())
        return io.Schema(node_id="CartwheelLoadCapture", display_name="Load Cartwheel Capture", category="Cartwheel",
                         description="Open a completed local capture without submitting an API job.",
                         inputs=[io.Combo.Input("capture_file", display_name="Saved capture", options=files or [""], default=files[0] if files else "")],
                         outputs=[Capture.Output("capture")] + source_sockets() + scene_sockets())

    @classmethod
    def execute(cls, capture_file):
        capture = load_capture(folder_paths.get_output_directory(), capture_file)
        return io.NodeOutput(capture, *source_outputs(capture), *scene_outputs(capture))


class CartwheelLoadHistory(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(node_id="CartwheelLoadHistory", display_name="Load Cartwheel History (retired)", category="Cartwheel", is_output_node=True, is_deprecated=True,
                         description="Retired API History. Use Load Motion → Saved jobs to browse previously saved local output without a Cartwheel API connection.",
                         inputs=[io.String.Input("motion_id", display_name="Capture ID", default="", tooltip="Choose a capture with Refresh history. Its motion ID is saved in the workflow.")],
                         outputs=[Capture.Output("capture")] + source_sockets() + scene_sockets())

    @classmethod
    def fingerprint_inputs(cls, **kwargs):
        return "retired-api-history"

    @classmethod
    async def execute(cls, motion_id):
        raise ValueError("API History has been retired. Use Load Motion → Saved jobs to reopen local files without an API connection.")


def camera_fingerprint(camera_settings):
    # Account identity belongs to the capture/history source, not the editor.
    return None


async def editor_motion(capture, motion_index, camera_settings, camera=None):
    # The capture branch only keeps existing saved graphs compatible. New
    # sources connect MOTION; this path performs no account/API/history lookup.
    if isinstance(capture, dict) and "world_frame" in capture:
        motion = validate_motion(capture, folder_paths.get_output_directory())
    else:
        motion = motion_from_capture(capture, folder_paths.get_output_directory(), motion_index)
    motion = with_camera_input(motion, camera, folder_paths.get_output_directory())
    settings = read_camera_settings(camera_settings)
    notice = None
    if motion.get("saved_editor_settings") and (settings.get("world_frame_id") != motion["world_frame"]["id"] or settings["mode"] == "captured" and not settings.get("camera_timeline")):
        settings = motion["saved_editor_settings"]
    if settings["mode"] == "history":
        settings = DEFAULT_SETTINGS | {"output_frame":settings.get("output_frame", DEFAULT_SETTINGS["output_frame"])}
        notice = "Load Motion → Saved jobs restores a saved camera; uploaded camera files are optional."
    return motion, settings, notice


class CartwheelLoadMotionAndCamera(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        root = Path(folder_paths.get_input_directory())
        actors = [""] + sorted(str(p.relative_to(root)) for p in root.rglob("*") if p.is_file() and p.suffix.lower() in {".glb", ".fbx"})
        cameras = [""] + sorted(str(p.relative_to(root)) for p in root.rglob("*") if p.is_file() and p.suffix.lower() in {".json", ".fbx"})
        return io.Schema(node_id="CartwheelLoadMotionAndCamera", display_name="Load Motion · Upload / Saved Jobs", category="Cartwheel", is_output_node=True,
            description="Load individual animated actors (GLB preferred) and an optional camera file; whole scenes with multiple actors and an embedded camera are also supported. Or reopen a saved local job with its actors and camera edits. Browse and download local output files without an API key or Cartwheel history access.",
            inputs=[io.Combo.Input("actor_1", options=actors, default="", display_name="Actor 1"),
                    io.Combo.Input("actor_2", options=actors, default="", display_name="Actor 2 · optional"),
                    io.Combo.Input("actor_3", options=actors, default="", display_name="Actor 3 · optional"),
                    io.Combo.Input("actor_4", options=actors, default="", display_name="Actor 4 · optional"),
                    io.Combo.Input("camera_file", options=cameras, default="", display_name="Camera · optional override JSON / FBX"),
                    io.String.Input("load_mode", optional=True, default="Upload files", socketless=True, extra_dict={"hidden":True}),
                    io.String.Input("saved_job", optional=True, default="", socketless=True, extra_dict={"hidden":True})],
            outputs=[Motion.Output("motion"), Camera.Output("camera"), io.String.Output("motion_info")])

    @classmethod
    def validate_inputs(cls, **kwargs):
        # Uploads can add valid files after the combo schema was registered.
        return True

    @classmethod
    def fingerprint_inputs(cls, load_mode="Upload files", saved_job="", **kwargs):
        from .motion_io import file_digest
        if load_mode=="Saved jobs":
            path=job_path(folder_paths.get_output_directory(),saved_job)
            return [saved_job,file_digest(path)]
        return [file_digest(cls.file(value)) for key,value in kwargs.items() if key in {"actor_1","actor_2","actor_3","actor_4","camera_file"} and value]

    @staticmethod
    def file(name):
        root = Path(folder_paths.get_input_directory()).resolve()
        if not isinstance(name, str) or not name:
            raise ValueError("Choose or upload animated motion for Actor 1.")
        path = (root / name).resolve()
        if not path.is_relative_to(root) or not path.is_file():
            raise ValueError("Choose an uploaded file inside ComfyUI's input directory.")
        return path

    @classmethod
    def execute(cls, actor_1="", actor_2="", actor_3="", actor_4="", camera_file="", load_mode="Upload files", saved_job=""):
        if load_mode=="Saved jobs":
            motion=load_job(folder_paths.get_output_directory(),saved_job)
            info={"actors":len(motion["actors"]),"duration":motion["timeline"]["duration"],"camera":True,"saved_job":saved_job,"title":motion.get("title","Saved job")}
            return io.NodeOutput(motion, camera_from_motion(motion), json.dumps(info), ui={"cartwheel_motion_info":[info]})
        if load_mode!="Upload files":raise ValueError("Choose Upload files or Saved jobs.")
        if not actor_1: raise ValueError("Choose or upload animated motion for Actor 1.")
        values = [actor_1, actor_2, actor_3, actor_4]
        # Keep actor numbering stable if an optional slot is empty.
        if any(not values[i] and any(values[i+1:]) for i in range(3)):
            raise ValueError("Fill actor slots in order, without gaps.")
        motion = import_motion([cls.file(v) for v in values if v], cls.file(camera_file) if camera_file else None, folder_paths.get_output_directory())
        motion["title"] = Path(actor_1).stem
        camera = camera_from_motion(motion) if motion["scene"]["camera"]["format"]!="default" else None
        return io.NodeOutput(motion, camera, json.dumps({"actors":len(motion["actors"]), "duration":motion["timeline"]["duration"], "camera":camera is not None}, indent=2),
            ui={"cartwheel_motion_info":[{"actors":len(motion["actors"]), "duration":motion["timeline"]["duration"], "camera":camera is not None}]})


class CartwheelCameraPreview(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(node_id="CartwheelCameraPreview", display_name="Cartwheel Camera Preview", category="Cartwheel",
                         description="Edit the camera directly with scene and camera views together. Preview changes live, then run to output the edited VIDEO. Connect any compatible MOTION and optional CAMERA. Use Load Motion → Saved jobs to reopen local motion and saved camera paths. No paid API calls.",
                         is_output_node=True, is_experimental=True,
                         inputs=[io.MultiType.Input(Motion.Input("motion"), types=[Motion, Capture]), io.Int.Input("motion_index", default=0, min=0, socketless=True, extra_dict={"hidden": True}),
                                 io.Combo.Input("render_size", display_name="Video size", options=["720p", "1080p"], default="720p", tooltip="Short side of the rendered video. The captured camera's aspect ratio is preserved."),
                                 io.Combo.Input("render_fps", display_name="Video frame rate", options=EXPORT_FPS, default="24"),
                                 io.String.Input("render_view", default="", socketless=True, extra_dict={"hidden": True}),
                                 io.Int.Input("render_camera", default=0, min=0, socketless=True, extra_dict={"hidden": True}),
                                 io.String.Input("camera_settings", default="", socketless=True, extra_dict={"hidden": True}),
                                 Camera.Input("camera", optional=True, tooltip="Optional starting camera. Without one, use the motion starting view or a default camera for uploaded GLBs."),
                                 io.Boolean.Input("auto_frame_images",display_name="Auto start/end frame images",default=False,optional=True,tooltip="Include the connected first/last frame images as references when generating. Image styling is controlled separately in the image service nodes.")],
                         outputs=[io.Video.Output("video"),Camera.Output('camera'),io.String.Output('camera_json'),io.String.Output('camera_file'),io.Image.Output('first_frame'),io.Image.Output('last_frame'),*[io.Video.Output(kind) for kind in ['depth','normal','pose']],io.Boolean.Output('use_frame_images')])

    @classmethod
    def fingerprint_inputs(cls, camera_settings="", **kwargs):
        return camera_fingerprint(camera_settings or DEFAULT_SETTINGS)

    @classmethod
    def validate_inputs(cls, render_view, **kwargs):
        return True if render_view else "Refresh the ComfyUI browser or replace this camera node to enable VIDEO rendering."

    @classmethod
    async def execute(cls, motion=None, motion_index=0, render_size="720p", render_fps="24", render_view="", render_camera=0, camera_settings="", camera=None, capture=None, auto_frame_images=False):
        camera_settings = camera_settings or (DEFAULT_SETTINGS | {"camera_index": render_camera})
        motion, camera_settings, source_notice = await editor_motion(motion if motion is not None else capture, motion_index, camera_settings, camera)
        camera, notice = make_editor_camera(motion, camera_settings or (DEFAULT_SETTINGS | {"camera_index": render_camera}))
        notice = notice or source_notice
        descriptor = motion["scene"]
        async def progress(value):
            await ComfyAPI().execution.set_progress(value, 100)
        video = await bridge.render(PromptServer.instance, render_view, descriptor, folder_paths.get_output_directory(),
                                    render_size, render_fps, camera["settings"]["camera_index"], throw_exception_if_processing_interrupted, progress,
                                    camera=camera, motion=motion)
        context=attach_render(video,motion,camera,folder_paths.get_output_directory())
        sampled=json.loads(video.with_suffix('.camera.json').read_text())
        baked_camera=camera | {'sampled':sampled,'anchor':motion['scene']['actors'][0]}
        saved_job = await asyncio.to_thread(save_job, folder_paths.get_output_directory(), motion, camera, video, fps=render_fps, size=render_size)
        subfolder = video.parent.relative_to(folder_paths.get_output_directory()).as_posix()
        return io.NodeOutput(InputImpl.VideoFromFile(str(video)),baked_camera,json.dumps(sampled),str(video.with_suffix('.camera.json')),
                             image_tensor(video.with_suffix('.first.png')),image_tensor(video.with_suffix('.last.png')),
                             *[InputImpl.VideoFromFile(str(video.with_name(video.stem+'_'+kind+'.mp4'))) for kind in ['depth','normal','pose']],bool(auto_frame_images),
                             ui={'cartwheel_render_artifacts':[context],"cartwheel_scene": [descriptor], "cartwheel_motion": [motion], "cartwheel_camera": [camera], "cartwheel_camera_notice": [notice], "cartwheel_saved_job": [{**saved_job,"job_file":saved_job["id"]}],
                             "cartwheel_video": [{"filename": video.name, "subfolder": subfolder, "type": "output"}]})


class CartwheelCamera(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(node_id="CartwheelCamera", display_name="Cartwheel Camera", category="Cartwheel", is_output_node=True,
                         description="Edit the camera with scene and camera views side by side. Saves camera settings in the workflow; no VIDEO encoding or API calls.",
                         is_experimental=True,
                         inputs=[io.MultiType.Input(Motion.Input("motion"), types=[Motion, Capture]), io.Int.Input("motion_index", display_name="Motion index", default=0, min=0, advanced=True),
                                 io.String.Input("camera_settings", default=json.dumps(DEFAULT_SETTINGS), socketless=True, extra_dict={"hidden": True}), Camera.Input("camera", optional=True)],
                         outputs=[Motion.Output("motion"), Camera.Output("camera"), io.String.Output("camera_json")])

    @classmethod
    def fingerprint_inputs(cls, camera_settings=json.dumps(DEFAULT_SETTINGS), **kwargs):
        return camera_fingerprint(camera_settings)

    @classmethod
    async def execute(cls, motion=None, motion_index=0, camera_settings=json.dumps(DEFAULT_SETTINGS), camera=None, capture=None):
        motion, camera_settings, source_notice = await editor_motion(motion if motion is not None else capture, motion_index, camera_settings, camera)
        camera, notice = make_editor_camera(motion, camera_settings)
        notice = notice or source_notice
        camera.update(source=motion["scene"]["camera"], anchor=motion["scene"]["actors"][0])
        return io.NodeOutput(motion, camera, json.dumps(camera, indent=2),
                             ui={"cartwheel_motion": [motion], "cartwheel_camera": [camera], "cartwheel_camera_notice": [notice]})


class CartwheelControlRender(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(node_id="CartwheelControlRender", display_name="Cartwheel Control Render", category="Cartwheel", is_output_node=True,
                         description="Render the motion through the edited camera to VIDEO. Uses the connected browser; no capture or generation API calls.",
                         is_experimental=True,
                         inputs=[Motion.Input("motion"), Camera.Input("camera"),
                                 io.Combo.Input("render_size", display_name="Video size", options=["720p", "1080p"], default="720p"),
                                 io.Combo.Input("render_fps", display_name="Video frame rate", options=EXPORT_FPS, default="24"),
                                 io.String.Input("render_view", default="", socketless=True, extra_dict={"hidden": True})],
                         outputs=[io.Video.Output("video")])

    @classmethod
    async def execute(cls, motion, camera, render_size="720p", render_fps="24", render_view=""):
        camera = validate_render_camera(motion, camera)
        async def progress(value):
            await ComfyAPI().execution.set_progress(value, 100)
        video = await bridge.render(PromptServer.instance, render_view, motion["scene"], folder_paths.get_output_directory(),
                                    render_size, render_fps, camera["settings"]["camera_index"],
                                    throw_exception_if_processing_interrupted, progress, camera=camera)
        subfolder = video.parent.relative_to(folder_paths.get_output_directory()).as_posix()
        saved = {"filename": video.name, "subfolder": subfolder, "type": "output"}
        return io.NodeOutput(InputImpl.VideoFromFile(str(video)), ui={"cartwheel_video": [saved]})


class CartwheelPrepareVideoReferences(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(node_id="CartwheelPrepareVideoReferences", display_name="Cartwheel Prepare Video References", category="Cartwheel",
            description="Choose Seedance/H3, select a bounded reference window, and prepare optional image/video/audio references. Never uploads or generates. Connect prepared_references to Generate with Seedance / H3. Individual outputs remain compatible with older native model workflows.",
            inputs=[io.Video.Input("control_video", display_name="control_video", tooltip="Video 1: the animated scene rendered by Cartwheel Camera Preview. Supplies motion and camera guidance."),
                    io.Combo.Input("model", options=list(MODEL_LIMITS), default="Seedance 2.5"),
                    io.Int.Input("output_duration", display_name="Output seconds · 0 = auto", default=0, min=0, max=30,
                                 tooltip="Auto rounds up to cover the selected window. The final video is trimmed back to the exact camera-window duration."),
                    io.Float.Input("start_seconds", display_name="Start · seconds", default=0, min=0, step=0.01),
                    io.Float.Input("reference_duration", display_name="Duration · 0 = maximum available", default=0, min=0, max=30, step=0.01,
                                   tooltip="Automatically capped to the remaining clip and model allowance: Seedance 2.5 30s, H3 15s, shared with a second video."),
                    io.String.Input("prompt", default=DEFAULT_PROMPT, multiline=True),
                    io.Image.Input("reference_image", display_name="Reference image", optional=True, lazy=True, tooltip="Optional Image 1: desired character, appearance, or style. Add Load Image or an image generator."),
                    io.Video.Input("secondary_video", display_name="secondary_video", optional=True, lazy=True, tooltip="Optional Video 2: creative reference, such as an environment. Add Load Video. Both videos share the model allowance."),
                    io.Audio.Input("reference_audio", display_name="Reference audio", optional=True, lazy=True, tooltip="Optional Audio 1: soundtrack, voice, or other creative reference. Add Load Audio. No audio is extracted automatically."),
                    io.Float.Input("end_seconds", display_name="End · 0 = use duration", default=0, min=0, step=0.01, advanced=True, optional=True,
                                   tooltip="Optional exclusive end time. Leave Duration at zero when setting End."),
                    io.Float.Input("secondary_start_seconds", display_name="Reference video start · seconds", default=0, min=0, step=0.01, advanced=True, optional=True),
                    io.Float.Input("secondary_duration", display_name="Reference video duration · 0 = auto", default=0, min=0, max=30, step=0.01, advanced=True, optional=True,
                                   tooltip="Auto shares the available video allowance. An explicit value reserves that amount for Video 2, up to the model limit."),
                    io.Float.Input("audio_start_seconds", display_name="Reference audio start · seconds", default=0, min=0, step=0.01, advanced=True, optional=True),
                    io.Boolean.Input("use_reference_image", display_name="Use image reference", default=True, optional=True),
                    io.Boolean.Input("use_secondary_video", display_name="Use secondary video", default=True, optional=True),
                    io.Boolean.Input("use_reference_audio", display_name="Use audio reference", default=True, optional=True), References.Input("reference_library",optional=True,lazy=True),
                    io.Boolean.Input('use_original_audio',display_name='Use original audio',default=True,optional=True,tooltip='Restore the original performance soundtrack on the final video when available. This is not an AI audio reference.'),
                    io.Combo.Input('camera_reference',options=['Color','Depth','Normal','Pose','None'],default='Color',optional=True,extra_dict={'hidden':True}),
                    io.Boolean.Input('use_endpoint_images',display_name='Use first / last frame images',default=False,optional=True),
                    io.Image.Input('first_frame_image',optional=True,lazy=True),io.Image.Input('last_frame_image',optional=True,lazy=True),
                    *[io.Video.Input(kind+'_video',display_name=kind.capitalize()+' pass',optional=True,lazy=True,tooltip='Used only when its video reference switch is on; off by default.') for kind in ['depth','normal','pose']],
                    io.Boolean.Input('use_camera_video',display_name='Use edited camera video',default=True,optional=True,tooltip='Primary rendered performance and camera reference. Every enabled video shares the model allowance.'),
                    io.Boolean.Input('use_depth',display_name='Use depth video',default=False,optional=True),
                    io.Boolean.Input('use_normal',display_name='Use normal video',default=False,optional=True),
                    io.Boolean.Input('use_pose',display_name='Use pose video',default=False,optional=True)],
            # Preserve the seven existing output positions for saved workflows.
            outputs=[io.Video.Output("control_video", display_name="control_video"), io.Image.Output("reference_image", display_name="Reference image"), io.Audio.Output("source_audio", display_name="Reference audio"),
                     io.String.Output("prompt"), io.Int.Output("duration"), io.Combo.Output("ratio", options=["adaptive"]), io.String.Output("reference_info"),
                     io.Video.Output("secondary_video", display_name="secondary_video"), io.Boolean.Output("use_h3", tooltip="False = Seedance on_false; True = H3 on_true. Connect to the final If/Else Switch's switch input."), Prepared.Output("prepared_references")])

    @classmethod
    def check_lazy_status(cls, use_reference_image=True, use_secondary_video=True, use_reference_audio=True,use_endpoint_images=False,camera_reference="Color",use_camera_video=None,use_depth=None,use_normal=None,use_pose=None, **inputs):
        flags=camera_video_flags(camera_reference,use_camera_video,use_depth,use_normal,use_pose)
        return [name for name, enabled in [("reference_library", True), ("reference_image", use_reference_image), ("secondary_video", use_secondary_video), ("reference_audio", use_reference_audio),("first_frame_image",use_endpoint_images),("last_frame_image",use_endpoint_images), *[(kind+"_video",flags[kind.capitalize()]) for kind in ["depth","normal","pose"]]]
                if enabled and name in inputs and inputs[name] is None]

    @classmethod
    def execute(cls, control_video, model="Seedance 2.5", output_duration=0, start_seconds=0, reference_duration=0,
                prompt=DEFAULT_PROMPT, reference_image=None, secondary_video=None, reference_audio=None,
                end_seconds=0, secondary_start_seconds=0, secondary_duration=0, audio_start_seconds=0,
                use_reference_image=True, use_secondary_video=True, use_reference_audio=True, reference_library=None,use_original_audio=True,camera_reference="Color",use_endpoint_images=False,first_frame_image=None,last_frame_image=None,depth_video=None,normal_video=None,pose_video=None,use_camera_video=None,use_depth=None,use_normal=None,use_pose=None):
        reference_image = reference_image if use_reference_image else None
        secondary_video = secondary_video if use_secondary_video else None
        reference_audio = reference_audio if use_reference_audio else None
        if type(output_duration) is not int or output_duration < 0:
            raise ValueError("Output duration must be a nonnegative whole second, or zero for Auto.")
        prompt = prompt.strip() if isinstance(prompt,str) and prompt.strip() else DEFAULT_PROMPT
        if use_endpoint_images:
            endpoints=[x for x in [first_frame_image,last_frame_image] if x is not None]
            if not endpoints:raise ValueError('Connect first/last frame images or their styled outputs before enabling them.')
            # Image references can have different shapes; collection accepts an ordered list.
            endpoint_items=endpoints
        else:endpoint_items=[]
        original_control=control_video
        flags=camera_video_flags(camera_reference,use_camera_video,use_depth,use_normal,use_pose)
        cameras=[]
        connected={"Depth":depth_video,"Normal":normal_video,"Pose":pose_video}
        declared=render_context(original_control).get('duration')
        offset=original_control.get_active_trim_window()[0] if hasattr(original_control,'get_active_trim_window') else 0
        available=original_control.get_duration()
        if isinstance(declared,(int,float)) and declared>offset:available=min(available,declared-offset)
        for kind,enabled in flags.items():
            if not enabled:continue
            video=selected_control(original_control,kind,connected)
            video=video.as_trimmed(0,min(video.get_duration(),available),strict_duration=True)
            if video is None:raise ValueError('The saved camera duration could not be selected.')
            cameras.append(('Edited camera video' if kind=='Color' else kind+' pass',video))
        if not cameras and prompt==DEFAULT_PROMPT:prompt='Create a video using the enabled reference images, videos and audio. Preserve the visual identities and interactions described by the references.'
        if end_seconds and reference_duration:raise ValueError("Set Duration or End, not both.")
        if end_seconds and end_seconds<=start_seconds:raise ValueError("End must be after Start.")
        pack=prepare_collection(control_video,model,start_seconds,reference_duration,end_seconds,output_duration,prompt,reference_library or [],
            reference_image,secondary_video,reference_audio,secondary_start_seconds,secondary_duration,audio_start_seconds,extra_images=endpoint_items,camera_videos=cameras)
        selected=pack['info']['primary_window']
        info=pack['info'];info.update(reference_start=selected['start'],reference_end=selected['start']+selected['duration'],reference_duration=selected['duration'],has_image=bool(pack['images']),has_audio=bool(pack['audios']),secondary_video=info['video_windows'][info['secondary_video_index']] if info['secondary_video_index'] is not None else None,use_h3=model=='MiniMax H3')
        pack['delivery']=delivery_settings(original_control,selected['start'],selected['duration'],use_original_audio)
        pack['info'].update(camera_reference=', '.join(name for name,_ in cameras) or 'None',camera_references=[name for name,_ in cameras],delivery_duration=selected['duration'],original_audio_available=bool((render_context(original_control).get('source_media') or {}).get('metadata',{}).get('has_audio')),use_original_audio=use_original_audio)
        if not cameras and not pack['images'] and not pack['videos']:raise ValueError('Enable a camera video or at least one creative image/video reference.')
        missing=ExecutionBlocker("Optional reference is not enabled.")
        info=pack['info']
        return io.NodeOutput(pack['videos'][0] if cameras else original_control.as_trimmed(selected['start'],selected['duration'],strict_duration=True),pack['images'][0] if pack['images'] else missing,
            pack['audios'][0] if pack['audios'] else missing,prompt,pack['duration'],'adaptive',json.dumps(info,indent=2),
            pack['videos'][info['secondary_video_index']] if info['secondary_video_index'] is not None else missing,model=='MiniMax H3',pack,ui={'cartwheel_reference_info':[info]})

