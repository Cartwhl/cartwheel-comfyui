"""Local, ordered creative reference collection and native provider expansion."""
import json
import math
from pathlib import Path
from uuid import uuid4
import numpy as np
import torch
from PIL import Image, ImageOps
from aiohttp import web
from .route_security import same_origin, upload_directory
import folder_paths
from comfy_api.latest import io, InputImpl
from comfy_execution.graph_utils import GraphBuilder
from .media import source_parts, trim_audio, validate_references, MODEL_LIMITS

References=io.Custom('CARTWHEEL_REFERENCES')
Prepared=io.Custom('CARTWHEEL_PREPARED_REFERENCES')
LIMITS={'Seedance 2.5':(30,10,10),'MiniMax H3':(9,3,3)}
SUFFIXES={'.png':'image','.jpg':'image','.jpeg':'image','.webp':'image','.mp4':'video','.mov':'video','.webm':'video','.mkv':'video','.wav':'audio','.mp3':'audio','.m4a':'audio','.flac':'audio','.ogg':'audio'}


def local_path(name):
    if not isinstance(name, str) or not name:
        raise ValueError('Choose a local reference file.')
    root=Path(folder_paths.get_input_directory()).resolve()
    path=(root/name).resolve()
    if not path.is_relative_to(root) or not path.is_file():raise ValueError('Reference file is missing or outside the ComfyUI input folder.')
    return path


def register_reference_routes(server):
    @server.routes.post('/cartwheel/references/upload')
    async def upload(request):
        same_origin(request)
        path=None
        complete=False
        try:
            part=await (await request.multipart()).next()
            if part is None or part.name!='file' or not part.filename:raise ValueError('Choose an image, video or audio file.')
            suffix=Path(part.filename).suffix.lower()
            if suffix not in SUFFIXES:raise ValueError('Unsupported reference file type.')
            root=upload_directory(folder_paths.get_input_directory(), 'cartwheel_references')
            path=root/(uuid4().hex+suffix);size=0
            with path.open('xb') as target:
                while chunk:=await part.read_chunk(1024*1024):
                    size+=len(chunk)
                    if size>250_000_000:raise ValueError('Each reference must be smaller than 250 MB.')
                    target.write(chunk)
            complete=True
            return web.json_response({'file':path.relative_to(Path(folder_paths.get_input_directory()).resolve()).as_posix(),'name':Path(part.filename).name,'kind':SUFFIXES[suffix]},headers={'Cache-Control':'no-store'})
        except ValueError as error:
            return web.json_response({'error':str(error)},status=400,headers={'Cache-Control':'no-store'})
        except OSError:
            return web.json_response({'error':'The reference upload could not be saved.'},status=400,headers={'Cache-Control':'no-store'})
        finally:
            if path is not None and not complete:path.unlink(missing_ok=True)


class CartwheelReferenceLibrary(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(node_id='CartwheelReferenceLibrary',display_name='Creative References · Images / Videos / Audio',category='Cartwheel',
            inputs=[io.String.Input('files',default='[]',socketless=True,extra_dict={'hidden':True})],outputs=[References.Output('references')])
    @classmethod
    def execute(cls,files='[]'):
        items=json.loads(files)
        if not isinstance(items,list) or len(items)>100:raise ValueError('Choose at most 100 local references.')
        # Disabled entries are not opened or decoded. Loading is deferred until Prepare runs.
        selected=[]
        for item in items:
            if not isinstance(item,dict):raise ValueError('Invalid reference entry.')
            if item.get('enabled',True) is not True:continue
            path=local_path(item.get('file',''))
            kind=SUFFIXES.get(path.suffix.lower())
            if not kind:raise ValueError('Unsupported reference type.')
            start,duration=item.get('start',0),item.get('duration',0)
            if any(type(v) not in {int,float} or not math.isfinite(v) or v<0 for v in [start,duration]):raise ValueError('Reference start and duration must be nonnegative seconds.')
            selected.append(dict(path=str(path),kind=kind,start=start,duration=duration,name=item.get('name',path.name)))
        return io.NodeOutput(selected)


def prepare_collection(control,model,start=0,duration=0,end=0,output_duration=0,prompt='',items=(),image=None,secondary=None,audio=None,secondary_start=0,secondary_duration=0,audio_start=0,extra_images=(),include_control=True,camera_videos=None):
    if model not in LIMITS:raise ValueError('Choose Seedance 2.5 or MiniMax H3.')
    for number in [start,duration,end,secondary_start,secondary_duration,audio_start]:
        if type(number) not in {int,float} or not math.isfinite(number) or number<0:raise ValueError('Reference start, end and duration must be finite nonnegative seconds.')
    if end and (duration or end<=start):raise ValueError('Set a valid End after Start, or Duration, not both.')
    camera_videos = list(camera_videos) if camera_videos is not None else ([('Edited camera video',control)] if include_control else [])
    camera_count=len(camera_videos)
    include_control=bool(camera_count)
    counts={kind:sum(x['kind']==kind for x in items) for kind in ['image','video','audio']}
    maxima=LIMITS[model]
    for kind,count,maximum in zip(['image','video','audio'],[counts['image']+sum(int(x.shape[0]) for x in extra_images)+(int(image.shape[0]) if image is not None else 0),counts['video']+camera_count+int(secondary is not None),counts['audio']+int(audio is not None)],maxima):
        if count>maximum:
            guidance='Disable extra camera video switches or creative videos.' if kind=='video' else f'Disable extra {kind} reference entries.'
            raise ValueError(f'{model} accepts at most {maximum} {kind} references (including enabled camera videos and passes). {guidance}')
    images=[] if image is None else [image[i:i+1] for i in range(image.shape[0])]
    videos=[(camera_videos[0][1],start,(end-start) if end else duration)] if include_control else []
    sounds=[] if audio is None else [(audio,audio_start,0)]
    for item in items:
        if item['kind']=='image':
            with Image.open(item['path']) as source:
                rgb=ImageOps.exif_transpose(source).convert('RGB');images.append(torch.from_numpy(np.asarray(rgb).copy()).float().div_(255).unsqueeze(0))
        elif item['kind']=='video':videos.append((InputImpl.VideoFromFile(item['path']),item['start'],item['duration']))
        else:
            sound=source_parts(item['path'],image=False)[1]
            if sound is None:raise ValueError(f"No audio found in {item['name']}.")
            sounds.append((sound,item['start'],item['duration']))
    images.extend(frame[i:i+1] for frame in extra_images for i in range(frame.shape[0]))
    if secondary is not None:videos.append((secondary,secondary_start,secondary_duration))
    maximum=MODEL_LIMITS[model][1]
    def allocate(entries,available,weights=None):
        if not entries:return [],[]
        weights=weights or [1]*len(entries)
        if sum(weights)*1.8>maximum+1e-6:raise ValueError(f'Too many references for the {maximum}s shared allowance; each needs at least 1.8s.')
        remaining=maximum;result=[];windows=[]
        # Split automatic windows equally, honoring shorter clips and explicit durations.
        for index,(value,offset,wanted) in enumerate(entries):
            length=(min(v.get_duration() for _,v in camera_videos) if weights[index]>1 else available(value))-offset
            if length<1.8-1e-6:raise ValueError('Every enabled reference needs at least 1.8 seconds after its start point.')
            weight=weights[index];later=sum(weights[index+1:])
            allowance=(remaining-later*1.8)/weight
            take=min(length,wanted or remaining/(later+weight),allowance)
            if take<1.8-1e-6:raise ValueError('Reference duration must be at least 1.8 seconds.')
            result.append((value,offset,take));windows.append({'start':offset,'duration':take});remaining-=take*weight
        return result,windows
    weights=([camera_count]+[1]*(len(videos)-1)) if camera_count else None
    allocated,video_windows=allocate(videos,lambda v:v.get_duration(),weights)
    if camera_count:
        # All camera passes describe the exact same time window. Budget each as
        # a separate reference without trimming them to different motion spans.
        first=video_windows[0]
        allocated=[(v,first['start'],first['duration']) for _,v in camera_videos]+allocated[1:]
        video_windows=[dict(first) for _ in camera_videos]+video_windows[1:]
    trimmed=[v.as_trimmed(offset,length,strict_duration=True) for v,offset,length in allocated]
    if any(v is None for v in trimmed):raise ValueError('Could not trim a reference video.')
    if include_control:primary=video_windows[0]
    else:
        from .media import reference_windows
        selected=reference_windows(model,control.get_duration(),start=start,duration=duration,end=end)
        primary={'start':start,'duration':selected['duration']}
    allocated_audio,audio_windows=allocate(sounds,lambda a:a['waveform'].shape[-1]/a['sample_rate'])
    sounds=[trim_audio(a,min(length,primary['duration']),start=offset) for a,offset,length in allocated_audio]
    for window in audio_windows:window['duration']=min(window['duration'],primary['duration'])
    seconds=validate_references(model,primary['duration'],output_duration)
    roles=[{'index':index+1,'name':name,**video_windows[index]} for index,(name,_) in enumerate(camera_videos)]
    notices=[f'Video references share {maximum}s; audio references separately share {maximum}s. Automatic windows share their allowance.']
    if camera_count>1:
        notices.append(f'{camera_count} camera videos use the same {primary["duration"]:.3f}s window and count separately toward the shared video allowance.')
    desired=(end-start) if end else (duration or control.get_duration()-start)
    if camera_count and primary['duration']+1e-6<desired:
        notices.append(f'Camera window shortened from {desired:.3f}s to {primary["duration"]:.3f}s to fit available footage and the shared video allowance. Disable extra videos to allow a longer clip.')
    return {'model':model,'images':images,'videos':trimmed,'audios':sounds,'duration':seconds,'ratio':'adaptive','prompt':prompt,
            'info':{'model':model,'primary_window':primary,'video_windows':video_windows,'audio_windows':audio_windows,'image_count':len(images),'video_count':len(trimmed),'audio_count':len(sounds),'output_duration':seconds,'ratio':'adaptive','notices':notices,'camera_videos':roles,'camera_video_count':camera_count,'secondary_video_index':len(trimmed)-1 if secondary is not None else None}}


class CartwheelGenerateVideo(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(node_id='CartwheelGenerateVideo',display_name='Generate with Seedance / H3',category='Cartwheel',enable_expand=True,is_api_node=True,
            inputs=[Prepared.Input('references'),io.Int.Input('seed',default=42,min=0,max=2147483647),io.Boolean.Input('generate_audio',default=True)],outputs=[io.Video.Output('video')])
    @classmethod
    def execute(cls,references,seed=42,generate_audio=True):
        p=references;h3=p['model']=='MiniMax H3';graph=GraphBuilder()
        values={'model':p['model'],'model.prompt':p['prompt'],'model.resolution':'768P' if h3 else '720p','model.ratio':'adaptive','model.duration':p['duration'],'seed':seed,'watermark':False}
        if not h3:values.update({'model.generate_audio':generate_audio and not bool((p.get('delivery',{}).get('source_media') or {}).get('metadata',{}).get('has_audio')),'model.task_type':'reference','model.output_format':'mp4','model.auto_downscale':True,'model.auto_upscale':False})
        for kind,plural in [('image','images'),('video','videos'),('audio','audios')]:
            for index,value in enumerate(p[plural],1):values[f'model.reference_{plural}.{kind}_{index}']=value
        native=graph.node('MinimaxHailuo03ReferenceNode' if h3 else 'ByteDance2ReferenceNodeV2',**values)
        final=graph.node('CartwheelFinalizeVideo',video=native.out(0),references=p)
        return io.NodeOutput(final.out(0),expand=graph.finalize())
