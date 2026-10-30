"""Local scene uploads; no external requests or Cartwheel credentials."""
import asyncio
from pathlib import Path
from uuid import uuid4

from aiohttp import web
from .route_security import same_origin, upload_directory

from .motion_io import read_actor, read_camera


def register_motion_routes(server, input_directory):
    @server.routes.post('/cartwheel/scene/upload')
    async def upload(request):
        same_origin(request)
        path = None
        complete = False
        meta = None
        try:
            kind = getattr(request, 'query', {}).get('kind', 'auto')
            if kind not in {'auto', 'motion', 'camera'}:
                raise ValueError('Choose motion or camera upload.')
            reader = await request.multipart()
            part = await reader.next()
            if part is None or part.name != 'file' or not part.filename:
                raise ValueError('Choose an actor motion or camera JSON/FBX file.')
            suffix = Path(part.filename).suffix.lower()
            allowed = {'.glb', '.fbx'} if kind == 'motion' else {'.json', '.fbx'} if kind == 'camera' else {'.glb', '.json', '.fbx'}
            if suffix not in allowed:
                raise ValueError('Actor motion must be GLB or supported FBX. Camera may be supported JSON or FBX.')
            root = upload_directory(input_directory(), 'cartwheel_imports')
            path = root / (uuid4().hex + suffix)
            size = 0
            with path.open('xb') as target:
                while chunk := await part.read_chunk(1024 * 1024):
                    size += len(chunk)
                    if size > 250_000_000: raise ValueError('Each uploaded file must be smaller than 250 MB.')
                    target.write(chunk)
            if kind == 'motion' or suffix == '.glb':
                meta = await asyncio.to_thread(read_actor, path)
                if len(meta['import_layout']['actors']) > 4:raise ValueError('The scene contains more than four actors. Export individual actors or a smaller scene.')
            elif kind == 'camera' or suffix == '.json':
                await asyncio.to_thread(read_camera, path)
            else:
                # Older clients do not specify the role. Accept either valid FBX use.
                try:
                    await asyncio.to_thread(read_camera, path)
                except ValueError:
                    await asyncio.to_thread(read_actor, path)
            complete = True
            result = {'filename':path.relative_to(Path(input_directory()).resolve()).as_posix()}
            if meta is not None:result.update(actors=len(meta['import_layout']['actors']), embedded_camera=bool(meta['import_layout'].get('cameras')))
            return web.json_response(result, headers={'Cache-Control':'no-store'})
        except ValueError as error:
            return web.json_response({'error':str(error)}, status=400, headers={'Cache-Control':'no-store'})
        except OSError:
            return web.json_response({'error':'The scene upload could not be saved.'}, status=400, headers={'Cache-Control':'no-store'})
        finally:
            if path is not None and not complete:
                path.unlink(missing_ok=True)
