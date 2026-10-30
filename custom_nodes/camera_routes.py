"""Restore an existing preview's local scene without queueing an encode or API job."""

import asyncio
from pathlib import Path

from aiohttp import web
from .route_security import same_origin

from .camera import motion_from_capture, with_camera_source, history_camera_settings
from .scene import load_capture
from .motion_io import restore_motion


def prepare_saved_scene(output_root, descriptor):
    if not isinstance(descriptor, dict) or descriptor.get('type') != 'output':
        raise ValueError('Choose a saved Cartwheel camera from the output directory.')
    filename, subfolder = descriptor.get('filename'), descriptor.get('subfolder')
    if not isinstance(filename, str) or Path(filename).name != filename or not isinstance(subfolder, str):
        raise ValueError('The saved camera reference is invalid.')
    root = (Path(output_root)/'cartwheel').resolve()
    camera = (Path(output_root)/subfolder/filename).resolve()
    if not camera.is_relative_to(root) or camera.suffix.lower() != '.fbx' or not camera.is_file():
        raise ValueError('The saved Cartwheel camera file is unavailable. Load a completed capture.')
    relative = camera.parent.relative_to(root)/'capture.json'
    capture = load_capture(output_root, str(relative))
    for index, motion in enumerate(capture.get('motions', [])):
        path = motion.get('assets', {}).get('camera')
        if path and Path(path).resolve() == camera:
            return motion_from_capture(capture, output_root, index)
    raise ValueError('This camera does not match its saved capture. Load the capture again.')


def restore_editor_scene(output_root, scene):
    if not isinstance(scene, dict):
        raise ValueError('The saved scene reference is invalid.')
    if scene.get('motion_manifest'):
        return restore_motion(scene['motion_manifest'], output_root)
    transfer = scene.get('camera_transfer')
    if transfer is None:
        return prepare_saved_scene(output_root, scene.get('camera'))
    if not isinstance(transfer, dict) or transfer.get('schema_version') != 1 or not isinstance(transfer.get('source_actor'), dict):
        raise ValueError('The saved camera source is invalid. Run the camera node again.')
    # Resolve both captures from local files again, never accept client-supplied asset metadata.
    motion = prepare_saved_scene(output_root, scene.get('motion_camera'))
    source = prepare_saved_scene(output_root, scene.get('camera'))
    return with_camera_source(motion, source, transfer['source_actor'].get('actor'),
                              transfer.get('reference_actor'), transfer.get('timing'))


def register_camera_routes(server, output_directory, read_connection=None):
    @server.routes.post('/cartwheel/camera/prepare')
    async def prepare(request):
        same_origin(request)
        try:
            body = await request.json()
            if not isinstance(body, dict):
                raise ValueError('The saved camera reference is invalid.')
            if 'scene' in body:
                motion = await asyncio.to_thread(restore_editor_scene, output_directory(), body['scene'])
            else:
                motion = await asyncio.to_thread(prepare_saved_scene, output_directory(), body.get('camera'))
            return web.json_response({'motion': motion}, headers={'Cache-Control':'no-store'})
        except (ValueError, OSError) as error:
            return web.json_response({'error':str(error)}, status=400, headers={'Cache-Control':'no-store'})

