"""Source-independent motion/starting-camera adapters. No account or API access."""
import copy
import hashlib
import json
import math
from pathlib import Path
import shutil

from .glb_metadata import read_metadata as glb_metadata
from .fbx_metadata import read_metadata as fbx_metadata


def default_camera():
    return {'format':'default', 'meters_per_unit':1.0, 'duration':0,
            'cameras':[{'name':'Default camera', 'aspect':16/9, 'fov':37.8493, 'near':0.01, 'far':1000, 'projection':0}]}


def number(value, label, low=-100000, high=100000):
    if type(value) not in {int,float} or not math.isfinite(value) or not low <= value <= high:
        raise ValueError(f'{label} must be finite and between {low} and {high}.')
    return value


def vector(value, label, size=3):
    if not isinstance(value,list) or len(value)!=size:
        raise ValueError(f'{label} must contain {size} numbers.')
    return [number(v,label) for v in value]


def camera_document(value):
    if not isinstance(value,dict) or value.get('schema_version')!=1 or value.get('units')!='meters' or value.get('up')!='Y':
        raise ValueError('Camera JSON requires schema_version 1, units "meters", up "Y", and frames. See the camera example.')
    projection=value.get('lens_projection','perspective')
    if projection not in {'perspective','fisheye_equidistant'}:raise ValueError('Unsupported camera projection.')
    frames=value.get('frames')
    if not isinstance(frames,list) or not 1<=len(frames)<=14401:
        raise ValueError('Camera JSON needs 1–14401 timestamped frames.')
    aspect=number(value.get('aspect',16/9),'Camera aspect',0.1,10)
    fps=number(value.get('fps',30),'Camera FPS',1,120)
    clean=[];previous=-1;mode=None
    for frame in frames:
        if not isinstance(frame,dict):raise ValueError('Every camera frame must be an object.')
        time=number(frame.get('time'),'Camera frame time',0,120)
        if time<=previous:raise ValueError('Camera frame times must be strictly increasing, beginning at zero.')
        if not clean and time!=0:raise ValueError('The first camera frame must be at time zero.')
        previous=time
        row={'time':time,'position':vector(frame.get('position'),'Camera position'),
             'fov':number(frame.get('fov',37.8493),'Vertical FOV',5,180 if projection=='fisheye_equidistant' else 150),'roll':number(frame.get('roll',0),'Roll',-360,360)}
        current='quaternion' if 'quaternion' in frame else 'target'
        if mode is not None and current!=mode:raise ValueError('Use target or quaternion consistently across camera frames.')
        mode=current
        row[current]=vector(frame.get(current),'Camera '+current,4 if current=='quaternion' else 3)
        if current=='target' and sum((a-b)**2 for a,b in zip(row['position'],row['target']))<1e-10:
            raise ValueError('Camera position and target must be different.')
        if current=='quaternion':
            length=math.sqrt(sum(v*v for v in row[current]))
            if length<1e-8:raise ValueError('Camera quaternion must have a nonzero length.')
            row[current]=[v/length for v in row[current]]
        if current=='quaternion' and 'target' in frame:
            row['target']=vector(frame['target'],'Camera optical-axis point')
            if frame.get('target_semantics')=='optical_axis_1m':row['target_semantics']='optical_axis_1m'
        for key in ['focal_length','sensor_height']:
            if key in frame:row[key]=number(frame[key],'Camera '+key,.001,100000)
        if 'cut' in frame:
            if type(frame['cut']) is not bool:raise ValueError('Camera cut must be true or false.')
            row['cut']=frame['cut']
        if 'lens_projection' in frame:
            if frame['lens_projection'] not in {'perspective','fisheye_equidistant'}:raise ValueError('Unsupported frame projection.')
            row['lens_projection']=frame['lens_projection']
        clean.append(row)
    return {'schema_version':1,'units':'meters','up':'Y','fps':fps,'aspect':aspect,'lens_projection':projection,'frames':clean}


def read_camera(path):
    path=Path(path)
    if path.suffix.lower()=='.fbx':
        data={'format':'fbx',**fbx_metadata(path)}
        if not data['cameras'] or any(c['projection']!=0 for c in data['cameras']):
            raise ValueError('Upload a perspective-camera FBX, or supported camera JSON.')
        return data
    if path.suffix.lower()!='.json' or path.stat().st_size>10*1024*1024:
        raise ValueError('Camera must be a supported JSON (up to 10 MiB) or perspective-camera FBX.')
    try:value=json.loads(path.read_text())
    except (ValueError,UnicodeError):raise ValueError('Camera JSON could not be read.') from None
    doc=camera_document(value)
    return {'format':'camera_json','meters_per_unit':1.0,'duration':doc['frames'][-1]['time'],
            'cameras':[{'name':'Imported camera','aspect':doc['aspect'],'fov':doc['frames'][0]['fov'],'near':0.01,'far':1000,'projection':0}],
            'frames':doc['frames'],'lens_projection':doc['lens_projection'],**({'editor_recipe':copy.deepcopy(value['editor_recipe'])} if isinstance(value.get('editor_recipe'),dict) else {})}


def file_digest(path):
    digest=hashlib.sha256()
    with Path(path).open('rb') as source:
        for chunk in iter(lambda:source.read(1024*1024),b''):digest.update(chunk)
    return digest.hexdigest()


def asset_path(asset, output_root):
    if not isinstance(asset,dict) or asset.get('type')!='output':raise ValueError('Scene assets must use ComfyUI output references.')
    name,folder=asset.get('filename'),asset.get('subfolder','')
    if not isinstance(name,str) or Path(name).name!=name or not isinstance(folder,str):raise ValueError('Invalid scene asset reference.')
    root=Path(output_root).resolve();path=(root/folder/name).resolve()
    if not path.is_relative_to(root) or not path.is_file():raise ValueError('A motion/camera asset is missing from the ComfyUI output directory.')
    return path


def reference(path,output_root):
    root=Path(output_root).resolve();path=Path(path).resolve()
    if not path.is_relative_to(root):raise ValueError('Scene assets must be inside the ComfyUI output directory.')
    return {'filename':path.name,'subfolder':path.parent.relative_to(root).as_posix(),'type':'output'}


def validate_motion(value,output_root):
    if not isinstance(value,dict) or value.get('schema_version')!=1 or not isinstance(value.get('scene'),dict):
        raise ValueError('Connect Performance Capture, Swing Choreo, or Load Motion.')
    result=copy.deepcopy(value);world=result.get('world_frame',{});timeline=result.get('timeline',{})
    if not isinstance(world,dict) or not isinstance(world.get('id'),str) or not world['id'] or world.get('units')!='meters' or world.get('up')!='Y' or world.get('handedness')!='right':
        raise ValueError('MOTION must specify a shared world frame in meters, Y-up, right-handed.')
    number(timeline.get('duration'),'Motion duration',0.000001,120)
    actors=result['scene'].get('actors',[])
    if not isinstance(actors,list) or not 1<=len(actors)<=4:raise ValueError('MOTION must contain 1–4 actor assets.')
    ids=[]
    for actor in actors:
        identity=actor.get('actor')
        if type(identity) is not int or identity not in {1,2,3,4} or identity in ids:raise ValueError('Actor IDs must be unique numbers from 1 to 4.')
        ids.append(identity)
        path=asset_path(actor,output_root)
        if actor.get('format')=='glb':glb_metadata(path)
        elif actor.get('format')=='fbx':fbx_metadata(path, actor='animation_start' in actor) # Retain legacy capture descriptors.
        else:raise ValueError('MOTION actors require supported GLB or FBX assets.')
        if actor.get('native_reference'):asset_path(actor['native_reference'],output_root)
    if [a.get('id') for a in result.get('actors',[])]!=ids:raise ValueError('MOTION actor IDs do not match the scene assets.')
    camera=result['scene'].get('camera') or default_camera()
    if camera.get('format')!='default':
        path=asset_path(camera,output_root)
        if camera.get('embedded'):
            camera=reference(path,output_root)|read_import_camera(path)
        elif camera.get('format')=='fbx':read_camera(path)
        elif camera.get('format')=='camera_json':camera=reference(path,output_root)|read_camera(path)
        else:raise ValueError('Unsupported camera source format.')
    result['scene']['camera']=camera
    result['scene']['duration']=timeline['duration']
    return result


def persist_motion(motion,output_root):
    result=copy.deepcopy(motion);result['scene'].pop('motion_manifest',None)
    text=json.dumps(result,sort_keys=True);identity=hashlib.sha256(text.encode()).hexdigest()
    path=Path(output_root)/'cartwheel'/'scenes'/identity/'motion.json';path.parent.mkdir(parents=True,exist_ok=True)
    result['scene']['motion_manifest']=reference(path,output_root)
    path.write_text(json.dumps(result,indent=2))
    return result


def restore_motion(descriptor,output_root):
    path=asset_path(descriptor,output_root)
    if path.name!='motion.json' or path.stat().st_size>20*1024*1024:raise ValueError('Invalid saved MOTION manifest.')
    return validate_motion(json.loads(path.read_text()),output_root)


def read_actor(path):
    """GLB-first import with native binary FBX compatibility; no retargeting or conversion."""
    path=Path(path)
    if path.suffix.lower()=='.glb':meta=glb_metadata(path, layout=True)
    elif path.suffix.lower()=='.fbx':meta=fbx_metadata(path, actor=True)
    else:raise ValueError('Actor motion must be GLB (.glb) or a supported animated FBX (.fbx).')
    number(meta['duration'],'Animated motion duration',0.000001,120)
    return meta


def read_import_camera(path, meta=None):
    meta=meta or read_actor(path)
    cameras=meta.get('import_layout',{}).get('cameras',[])
    if not cameras:raise ValueError('The imported scene has no supported perspective camera.')
    result={k:v for k,v in meta.items() if k!='import_layout'}
    result.update(embedded=True,cameras=cameras,selection={'nodes':[c.get('model_id',c.get('node_id')) for c in cameras]})
    return result


def import_motion(paths,camera_path,output_root):
    if not 1<=len(paths)<=4:raise ValueError('Choose 1–4 actor files (individual actors preferred; a whole scene is also supported).')
    assets=[];digests=[]
    for path in paths:
        path=Path(path);meta=read_actor(path)
        assets.append((path,meta));digests.append(file_digest(path))
    count=sum(len(meta['import_layout']['actors']) for _,meta in assets)
    if not 1<=count<=4:raise ValueError('The selected files contain more than four actors. Export individual actors or choose fewer files.')
    if camera_path:digests.append(file_digest(camera_path))
    identity=hashlib.sha256(json.dumps(digests).encode()).hexdigest()
    directory=Path(output_root)/'cartwheel'/'scenes'/identity;directory.mkdir(parents=True,exist_ok=True)
    actors=[];camera=default_camera()
    for file_index,(path,meta) in enumerate(assets,1):
        dest=directory/f'actor_{file_index}{path.suffix.lower()}'
        if path.resolve()!=dest.resolve():shutil.copyfile(path,dest)
        ref=reference(dest,output_root);layout=meta['import_layout'];base={k:v for k,v in meta.items() if k!='import_layout'}
        for index,group in enumerate(layout['actors']):
            actor=ref|base|{'actor':len(actors)+1}
            if len(layout['actors'])>1 or layout.get('background_nodes') or layout.get('cameras'):
                actor['selection']={'nodes':group['nodes']}
                actor['name']=group['name']
            if index==0 and layout.get('background_nodes'):actor['background_nodes']=layout['background_nodes']
            actors.append(actor)
        if camera['format']=='default' and layout.get('cameras'):
            camera=ref|read_import_camera(dest,meta)
    if camera_path:
        meta=read_camera(camera_path);dest=directory/('camera'+Path(camera_path).suffix.lower())
        if Path(camera_path).resolve()!=dest.resolve():shutil.copyfile(camera_path,dest)
        camera=reference(dest,output_root)|meta
    duration=max(a['duration'] for a in actors)
    motion={'schema_version':1,'world_frame':{'id':identity,'units':'meters','up':'Y','handedness':'right'},
            'timeline':{'duration':duration,'start_seconds':0,'basis':actors[0]['format'] if len({a['format'] for a in actors})==1 else 'imported'},
            'actors':[{'id':a['actor'],a['format']:{k:a[k] for k in ['filename','subfolder','type']}} for a in actors],
            'scene':{'actors':actors,'camera':camera,'duration':duration,'material_policy':'preserve'}}
    if camera.get('editor_recipe'):
        from .camera import camera_settings
        settings=camera.pop('editor_recipe');settings['world_frame_id']=identity;settings['camera_index']=0
        if settings.get('camera_timeline'):
            settings['camera_timeline']['world_frame_id']=identity
            for segment in settings['camera_timeline']['segments']:
                segment['settings']['camera_index']=0
                if segment['settings']['mode'] in {'preset','bookends'}:segment['settings']['world_frame_id']=identity
        motion['saved_editor_settings']=camera_settings(settings,[a['id'] for a in motion['actors']],1,identity,duration)
    return persist_motion(motion,output_root)


def camera_from_motion(motion):
    from .camera import make_camera,DEFAULT_SETTINGS
    camera=make_camera(motion,DEFAULT_SETTINGS)
    camera['source']=copy.deepcopy(motion['scene']['camera'])
    camera['anchor']=copy.deepcopy(motion['scene']['actors'][0])
    return camera


def with_camera_input(motion,camera,output_root):
    from .camera import with_camera_source
    if camera is None:return motion
    if isinstance(camera,dict) and camera.get('sampled'):
        doc=camera_document(camera['sampled']);text=json.dumps(doc,sort_keys=True);identity=hashlib.sha256(text.encode()).hexdigest()
        path=Path(output_root)/'cartwheel'/'cameras'/(identity+'.json');path.parent.mkdir(parents=True,exist_ok=True);path.write_text(text)
        camera=copy.deepcopy(camera);camera['source']=reference(path,output_root)|read_camera(path);camera['settings']={'mode':'captured'}
    if not isinstance(camera,dict) or camera.get('schema_version')!=1 or not isinstance(camera.get('source'),dict):
        raise ValueError('Connect a compatible CAMERA source containing its source camera descriptor.')
    if camera.get('settings',{}).get('mode','captured') not in {'captured','history'}:
        raise ValueError('Starting CAMERA inputs require a captured or sampled camera path. Render edited recipes with their matching motion using Cartwheel Control Render.')
    source=camera['source'];result=copy.deepcopy(motion)
    if camera.get('world_frame')!=motion['world_frame'] and camera.get('anchor') and source.get('format')!='default':
        anchor=camera['anchor']
        imported={'world_frame':camera['world_frame'],'timeline':camera['timeline'],'actors':[{'id':anchor['actor']}],
                  'scene':{'actors':[anchor],'camera':source}}
        result=with_camera_source(motion,imported,anchor['actor'],motion['actors'][0]['id'])
    else:
        result['scene']['camera']=copy.deepcopy(source)
        if source!=motion['scene'].get('camera'):
            result['world_frame']['id']=hashlib.sha256((motion['world_frame']['id']+json.dumps(source,sort_keys=True)).encode()).hexdigest()
    return persist_motion(validate_motion(result,output_root),output_root)
