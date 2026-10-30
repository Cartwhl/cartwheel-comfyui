"""Durable, local-only motion/camera jobs. No credentials or API client imports."""
import copy
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
from uuid import uuid4
import zipfile

from .motion_io import asset_path, reference, validate_motion, restore_motion, persist_motion, read_camera

MAX_JSON = 20 * 1024 * 1024


def write_json(path, value):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    temporary=path.with_name(path.name+'.'+uuid4().hex+'.part')
    try:
        temporary.write_text(json.dumps(value,indent=2));temporary.chmod(0o600);temporary.replace(path)
    finally:temporary.unlink(missing_ok=True)


def root_path(output_root):
    output=Path(output_root).resolve();root=(output/'cartwheel').resolve()
    if not root.is_relative_to(output):raise ValueError('Local jobs must stay inside ComfyUI output.')
    return root


def job_path(output_root, token):
    if not isinstance(token, str) or not token or len(token) > 1024:
        raise ValueError('Choose a saved local job, then run again.')
    root = root_path(output_root)
    path = (root / token).resolve()
    if not path.is_relative_to(root) or path.name not in {'job.json', 'capture.json', 'motion.json'} or not path.is_file() or path.stat().st_size > MAX_JSON:
        raise ValueError('This saved job is unavailable in the local ComfyUI output folder.')
    return path


def read_document(path):
    try:
        value = json.loads(path.read_text())
    except (OSError, ValueError):
        raise ValueError('The saved local job could not be read.') from None
    if not isinstance(value, dict):
        raise ValueError('The saved local job is invalid.')
    return value


def capture_title(value, fallback='Saved motion'):
    return str(value.get('title') or value.get('generation_options', {}).get('batchName') or value.get('capture_options', {}).get('batchName') or fallback)[:200]


def list_jobs(output_root, *, limit=200):
    root = root_path(output_root)
    paths = [*root.glob('saved_jobs/*/job.json'), *root.glob('*/capture.json'), *root.glob('scenes/*/motion.json')]
    paths = sorted((p for p in paths if p.is_file()), key=lambda p:p.stat().st_mtime, reverse=True)
    items = []
    seen = set()
    # Bound scanning independently of display count. Malformed/deleted entries
    # do not prevent the remaining local jobs from being listed.
    for path in paths[:1000]:
        try:
            path = job_path(output_root, path.relative_to(root).as_posix())
            value = read_document(path)
            if path.name == 'job.json':
                info = value['summary']; key = str(path)
                asset_path(value['motion'], output_root)
                video = value.get('preview')
                info = dict(info)
            elif path.name == 'capture.json':
                key = 'capture:'+str(value.get('motions',[{}])[0].get('job_id') or path.parent)
                assets = value['motions'][0]['assets']
                actors = {int(k.rsplit('_',1)[1]) for k,v in assets.items() if v and k.startswith(('mhr_', 'export_')) and k.rsplit('_',1)[1].isdigit()}
                if not actors:continue
                info = {'title':capture_title(value), 'actors':len(actors), 'duration':None, 'has_camera':bool(assets.get('camera')), 'has_edits':False}
                video = reference(assets['preview'], output_root) if assets.get('preview') and Path(assets['preview']).is_file() else None
            else:
                # Source snapshots backing captures and saved jobs are not
                # separate user-facing jobs. Show standalone uploaded scenes.
                if value.get('saved_job_id') or value.get('source_kind') in {'performance','swing'} or value.get('timeline',{}).get('basis')=='native_capture':continue
                if value.get('scene',{}).get('material_policy')!='preserve':continue
                motion = validate_motion(value, output_root)
                key = motion['world_frame']['id']
                info = {'title':capture_title(value,'Uploaded motion'), 'actors':len(motion['actors']), 'duration':motion['timeline']['duration'], 'has_camera':motion['scene']['camera']['format']!='default', 'has_edits':False}
                video = None
            if key and key in seen:continue
            if key:seen.add(key)
            if not isinstance(info.get('title'),str) or type(info.get('actors')) is not int or not 1<=info['actors']<=4:continue
            duration=info.get('duration')
            if duration is not None and (type(duration) not in (int,float) or not math.isfinite(duration) or duration<=0):continue
            if video:
                try:
                    vp=asset_path(video,output_root)
                    video=reference(vp,output_root) if vp.is_relative_to(root) and vp.suffix.lower() in {'.mp4','.mov','.webm'} else None
                except ValueError:video=None
            items.append({**info, 'id':path.relative_to(root).as_posix(), 'created_at':datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(), 'preview':video})
            if len(items)>=limit:break
        except (ValueError, OSError, KeyError, TypeError):
            continue
    return items


def load_job(output_root, token):
    path = job_path(output_root, token)
    value = read_document(path)
    if path.name == 'job.json':
        motion = restore_motion(value['motion'], output_root)
        camera = value.get('baked_camera')
        saved_recipe = read_document(asset_path(value['camera_recipe'], output_root)).get('settings') if value.get('camera_recipe') else None
        editable_sequence = isinstance(saved_recipe, dict) and bool(saved_recipe.get('camera_timeline'))
        if camera and not editable_sequence:
            camera_path = asset_path(camera, output_root)
            motion['scene'].setdefault('original_camera', copy.deepcopy(motion['scene']['camera']))
            motion['scene']['camera'] = reference(camera_path, output_root) | read_camera(camera_path)
            motion['scene'].pop('camera_transfer', None)
            motion['scene'].pop('motion_camera', None)
        motion['saved_job_id'] = token
        motion['title'] = value['summary']['title']
        # Each saved camera is a distinct starting view, even when the actor
        # assets came from the same source scene.
        motion['world_frame']['id'] = hashlib.sha256((motion['world_frame']['id']+'\0'+token).encode()).hexdigest()
        if editable_sequence:
            from .camera import camera_settings
            identity=motion['world_frame']['id']
            saved_recipe['world_frame_id']=identity
            saved_recipe['camera_timeline']['world_frame_id']=identity
            for segment in saved_recipe['camera_timeline']['segments']:
                if segment['settings']['mode'] in {'preset','bookends'}:segment['settings']['world_frame_id']=identity
            motion['saved_editor_settings']=camera_settings(saved_recipe,[a['id'] for a in motion['actors']],len(motion['scene']['camera']['cameras']),identity,motion['timeline']['duration'])
        return persist_motion(validate_motion(motion, output_root), output_root)
    if path.name == 'motion.json':
        return persist_motion(validate_motion(value, output_root), output_root)
    # The old local capture loader is reused; this never calls Cartwheel.
    from .camera import motion_from_capture
    if value.get('motions', [{}])[0].get('assets', {}).get('camera'):
        motion = motion_from_capture(value, output_root)
    else:
        from .motion_io import import_motion
        assets = value['motions'][0]['assets']
        paths = [Path(v) for k,v in sorted(assets.items()) if k.startswith('export_') and v and Path(v).suffix.lower()=='.glb']
        for p in paths:
            if not p.resolve().is_relative_to(root_path(output_root)):
                raise ValueError('Saved actors must be inside the local output folder.')
        motion = import_motion(paths, None, output_root)
    motion['title'] = capture_title(value)
    from .delivery import source_context
    source=source_context(value,output_root)
    if source:motion['source_media']=source
    return persist_motion(motion, output_root)


def link_or_copy(source, dest):
    try:os.link(source, dest)
    except OSError:shutil.copyfile(source, dest)


def save_job(output_root, motion, camera, video, *, fps, size, title=None):
    if title is not None and (not isinstance(title,str) or not title.strip() or len(title)>200 or any(ord(c)<32 for c in title)):
        raise ValueError("Enter a scene name of 1–200 characters.")
    motion = validate_motion(motion, output_root)
    from .camera import validate_render_camera
    camera = validate_render_camera(motion, camera)
    source_video = Path(video).resolve()
    if not source_video.is_file() or not source_video.is_relative_to(root_path(output_root)):
        raise ValueError('The camera video must be a saved local output.')
    baked_path = source_video.with_suffix('.camera.json')
    if not baked_path.is_file():
        raise ValueError('Refresh the ComfyUI browser and rerun the preview to save this motion and camera.')
    baked = read_document(baked_path)
    directory = root_path(output_root) / 'saved_jobs' / uuid4().hex
    directory.mkdir(parents=True)
    assets_dir = directory / 'assets';assets_dir.mkdir()
    retained = {}
    snapshot = copy.deepcopy(motion)
    snapshot.pop('saved_editor_settings',None)
    snapshot['scene'].pop('motion_manifest', None)
    def retain(value):
        if isinstance(value, dict):
            if value.get('type')=='output' and 'filename' in value and 'subfolder' in value:
                original = asset_path(value, output_root)
                if not original.is_relative_to(root_path(output_root)) or original.suffix.lower() not in {'.glb','.fbx','.json','.mp4','.mov','.webm','.mkv','.avi'}:
                    raise ValueError('Only local motion and camera assets can be saved.')
                if original not in retained:
                    name = f'{len(retained)+1:02d}_'+original.name
                    target = assets_dir/name
                    link_or_copy(original, target);retained[original]=target
                return {**value, **reference(retained[original], output_root)}
            return {k:retain(v) for k,v in value.items()}
        if isinstance(value,list):return [retain(v) for v in value]
        return value
    try:
        snapshot = retain(snapshot)
        preview = directory/'preview.mp4';link_or_copy(source_video,preview)
        artifacts={}
        render_sidecar=source_video.with_suffix('.render.json')
        if render_sidecar.is_file():
            artifacts=retain(read_document(render_sidecar));write_json(preview.with_suffix('.render.json'),artifacts)
            for kind in ['depth','normal','pose']:
                if kind in artifacts.get('passes',{}):link_or_copy(asset_path(artifacts['passes'][kind],output_root),directory/(kind+'.mp4'))
        baked_target = directory/'edited_camera.json';write_json(baked_target,baked)
        # Also retain the editable recipe, alongside its sampled camera path.
        write_json(directory/'camera_settings.json', camera)
        snapshot['scene']['motion_manifest'] = reference(directory/'motion.json',output_root)
        write_json(directory/'motion.json',snapshot)
        summary = {'title':title.strip() if title is not None else capture_title(motion,'Camera edit'), 'actors':len(motion['actors']), 'duration':motion['timeline']['duration'], 'has_camera':True, 'has_edits':camera['settings']['mode']!='captured' or bool(motion.get('saved_job_id'))}
        manifest = {'schema_version':1, 'summary':summary, 'motion_identity':motion['world_frame']['id'],
                    'motion':reference(directory/'motion.json',output_root), 'preview':reference(preview,output_root),
                    'baked_camera':reference(baked_target,output_root), 'camera_recipe':reference(directory/'camera_settings.json',output_root),
                    'control_passes':artifacts.get('passes',{}), 'render_actors':baked.get('render_actors',[]), 'fps':int(fps), 'size':size}
        write_json(directory/'job.json',manifest)
        return {'id':(directory/'job.json').relative_to(root_path(output_root)).as_posix(), **summary}
    except BaseException:
        shutil.rmtree(directory,ignore_errors=True)
        raise


def bundle_job(output_root, token):
    """A portable local scene with available source media, never account credentials."""
    motion = load_job(output_root, token)
    path = job_path(output_root, token);value = read_document(path)
    selected = {}
    def collect(v):
        if isinstance(v,dict):
            if v.get('type')=='output' and 'filename' in v and 'subfolder' in v:
                p=asset_path(v,output_root)
                if p.suffix.lower() in {'.glb','.fbx','.json','.mp4','.mov','.webm','.mkv','.avi'} and p.is_relative_to(root_path(output_root)):
                    selected[p]=f'assets/{len(selected)+1:02d}_{p.name}' if p not in selected else selected[p]
            for item in v.values():collect(item)
        elif isinstance(v,list):
            for item in v:collect(item)
    portable=copy.deepcopy(motion);portable['scene'].pop('motion_manifest',None)
    collect(portable)
    original = None
    if path.name=='job.json':
        original=restore_motion(value['motion'],output_root)
        original['scene'].pop('motion_manifest',None)
        collect(original)
        for key in ['preview','camera_recipe','control_passes']:collect(value.get(key))
    def rewrite(v):
        if isinstance(v,dict):
            if v.get('type')=='output' and 'filename' in v and 'subfolder' in v:
                p=asset_path(v,output_root)
                if p in selected:return {**v,'filename':Path(selected[p]).name,'subfolder':'assets','type':'output'}
            return {k:rewrite(x) for k,x in v.items()}
        if isinstance(v,list):return [rewrite(x) for x in v]
        return v
    result = root_path(output_root)/'downloads';result.mkdir(parents=True,exist_ok=True)
    identity=hashlib.sha256((token+str(path.stat().st_mtime_ns)).encode()).hexdigest()
    archive=result/(identity+'.zip');temporary=archive.with_name(archive.name+'.'+uuid4().hex+'.part')
    if archive.is_file():return archive
    try:
        with zipfile.ZipFile(temporary,'w',zipfile.ZIP_DEFLATED,compresslevel=1) as z:
            for p,name in selected.items():z.write(p,name)
            z.writestr('motion.json',json.dumps(rewrite(portable),indent=2))
            if original:z.writestr('original_motion.json',json.dumps(rewrite(original),indent=2))
            z.writestr('README.txt','Saved local motion and camera files. Units: meters, Y-up, right-handed. Keep shared actor positions and timing.\nGLB exports and native actor FBXs are both retained when available. For actors marked fbx in render_actors, use the native_reference FBX to match the viewer.\nThe edited camera JSON contains sampled world-space position/quaternion/FOV. Camera settings are an editor recipe, not an FBX camera.\nUse import_camera_blender.py for a perspective edited camera. Fisheye projection is retained for this viewer; the Blender helper does not reproduce the fisheye shader.\nNo Cartwheel API calls are needed to use these files.\n')
            z.writestr('render_actors.json',json.dumps(value.get('render_actors',[])))
            helper=Path(__file__).parent/'blender_camera_import.py'
            z.write(helper,'import_camera_blender.py')
        temporary.replace(archive)
    finally:temporary.unlink(missing_ok=True)
    return archive
