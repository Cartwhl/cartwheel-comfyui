"""Browse and download only jobs already present in local ComfyUI output."""
import asyncio
import json
from aiohttp import web
from .local_jobs import list_jobs, bundle_job, save_job
from .route_security import same_origin


def register_local_jobs(server, output_directory):
    @server.routes.get('/cartwheel/local-jobs')
    async def listing(request):
        same_origin(request)
        return web.json_response({'items':await asyncio.to_thread(list_jobs,output_directory())},headers={'Cache-Control':'no-store'})

    @server.routes.get('/cartwheel/local-jobs/download')
    async def download(request):
        same_origin(request)
        try:
            archive=await asyncio.to_thread(bundle_job,output_directory(),request.query.get('job'))
            return web.FileResponse(archive,headers={'Cache-Control':'no-store','Content-Disposition':'attachment; filename="saved-motion-and-camera.zip"'})
        except (ValueError,OSError,KeyError,TypeError):
            return web.json_response({'error':'The saved job files are unavailable. Refresh Saved jobs and choose another entry.'},status=400,headers={'Cache-Control':'no-store'})

    @server.routes.post('/cartwheel/local-jobs/save-camera')
    async def save_camera(request):
        same_origin(request)
        if request.content_length is not None and request.content_length>20*1024*1024:
            raise web.HTTPRequestEntityTooLarge(max_size=20*1024*1024,actual_size=request.content_length)
        try:
            raw=bytearray()
            async for chunk in request.content.iter_chunked(64*1024):
                raw.extend(chunk)
                if len(raw)>20*1024*1024:raise web.HTTPRequestEntityTooLarge(max_size=20*1024*1024,actual_size=len(raw))
            body=json.loads(raw)
            if not isinstance(body,dict):raise ValueError('Invalid camera snapshot.')
            title=body.get('name')
            if not isinstance(title,str) or not title.strip() or len(title)>200 or any(ord(c)<32 for c in title):raise ValueError('Enter a scene name of 1–200 characters.')
            from .motion_io import validate_motion, reference
            from .camera import make_editor_camera
            from .video_render import bridge
            from .delivery import attach_render
            motion=validate_motion(body.get('motion'),output_directory())
            camera,_=make_editor_camera(motion,body.get('camera_settings'))
            client=body.get('client_id')
            if not isinstance(client,str) or client not in server.sockets:raise ValueError('Keep this ComfyUI browser connected while saving.')
            async def progress(value):pass
            video=await bridge.render(server,body.get('render_view'),motion['scene'],output_directory(),body.get('size','720p'),body.get('fps','24'),camera['settings']['camera_index'],lambda:None,progress,camera=camera,motion=motion,client_id=client)
            context=attach_render(video,motion,camera,output_directory())
            saved=await asyncio.to_thread(save_job,output_directory(),motion,camera,video,fps=body.get('fps','24'),size=body.get('size','720p'),title=title)
            return web.json_response({'saved':saved,'ui':{'cartwheel_saved_job':[saved], 'cartwheel_render_artifacts':[context],'cartwheel_video':[reference(video,output_directory())]}},headers={'Cache-Control':'no-store'})
        except (ValueError,TypeError,KeyError,OSError,RuntimeError):
            return web.json_response({'error':'Scene could not be saved. Check the name and scene, keep this browser open, and try again.'},status=400,headers={'Cache-Control':'no-store'})
