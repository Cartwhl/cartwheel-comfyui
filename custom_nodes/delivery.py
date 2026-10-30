"""Local render provenance, frame extraction and exact-window delivery. No provider calls."""
import json,math
from fractions import Fraction
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4
import av
import numpy as np
import torch
from PIL import Image
import folder_paths
from comfy_api.latest import io,InputImpl
from .motion_io import asset_path,reference
from .local_jobs import write_json

PASSES=('depth','normal','pose')
def render_path(video):
    source=video.get_stream_source() if hasattr(video,'get_stream_source') else None
    if not isinstance(source,str):return None
    root=Path(folder_paths.get_output_directory()).resolve();path=Path(source).resolve()
    return path if path.is_relative_to(root) and path.is_file() else None

def render_context(video):
    path=render_path(video)
    if not path:return {}
    side=path.with_suffix('.render.json')
    if not side.is_file() or side.stat().st_size>20*1024*1024:return {}
    value=json.loads(side.read_text())
    return value if isinstance(value,dict) and value.get('schema_version')==1 else {}

def source_context(capture,root):
    source=capture.get('source') or {};name=source.get('path')
    if not isinstance(name,str):return None
    path=Path(name).resolve();base=Path(root).resolve()
    if not path.is_relative_to(base) or not path.is_file():return None
    return {'video':reference(path,root),'metadata':source.get('metadata',{})}

def image_tensor(path):
    with Image.open(path) as image:return torch.from_numpy(np.asarray(image.convert('RGB')).copy()).float().div_(255).unsqueeze(0)

def attach_render(video,motion,camera,root):
    path=Path(video);passes={k:reference(path.with_name(path.stem+'_'+k+'.mp4'),root) for k in PASSES if path.with_name(path.stem+'_'+k+'.mp4').is_file()}
    context={'schema_version':1,'source_media':motion.get('source_media'),'passes':passes,'camera':reference(path.with_suffix('.camera.json'),root),'duration':motion['timeline']['duration'],'pass_definitions':{'depth':{'distance':'radial_meters','near':.1,'far':50,'near_color':'light gray','foreground_floor':.12,'foreground_ceiling':.98,'background':'black'},'normal':{'space':'world','encoding':'RGB = normal * 0.5 + 0.5'},'pose':{'kind':'major_joint_skeleton','background':'black'}}}
    data=json.loads(path.with_suffix('.camera.json').read_text())
    if data.get('depth_range'):context['pass_definitions']['depth'].update(data['depth_range'])
    pose=data.get('pose_status') or {};context['pose_status']=pose
    if len(pose.get('mapped_actors',[]))<len(motion['actors']):context['pose_warning']='Some actors have unrecognized joint names. Their pose pass is unavailable; depth and normals still use their animated geometry.'
    write_json(path.with_suffix('.render.json'),context)
    return context

def camera_video_flags(camera_reference='Color', use_camera_video=None, use_depth=None, use_normal=None, use_pose=None):
    """New independent toggles override the old single-choice setting when present."""
    if camera_reference not in {'Color','Depth','Normal','Pose','None'}:
        raise ValueError('Choose valid camera video references.')
    choices = {'Color':camera_reference=='Color','Depth':camera_reference=='Depth',
               'Normal':camera_reference=='Normal','Pose':camera_reference=='Pose'}
    for name,value in zip(choices,[use_camera_video,use_depth,use_normal,use_pose]):
        if value is not None:
            if type(value) is not bool:
                raise ValueError('Camera video reference switches must be true or false.')
            choices[name]=value
    return choices


def selected_control(video,choice,connected=None):
    if choice in {'Color','None'}:return video
    context=render_context(video);asset=context.get('passes',{}).get(choice.lower())
    if choice=='Pose' and context.get('pose_status',{}).get('mapped_actors')==[]:raise ValueError('No supported joint mapping was found for these actors. Use Color, Depth, or Normal instead.')
    explicit=(connected or {}).get(choice)
    if explicit is not None:return explicit
    if not asset:raise ValueError(f'{choice} pass is unavailable. Run the camera preview again to generate control passes.')
    return InputImpl.VideoFromFile(str(asset_path(asset,folder_paths.get_output_directory())))

def delivery_settings(video,start,duration,use_original_audio):
    context=render_context(video);source=context.get('source_media')
    if source:
        try:asset_path(source['video'],folder_paths.get_output_directory())
        except (ValueError,KeyError,OSError):source=None
    offset=video.get_active_trim_window()[0] if hasattr(video,'get_active_trim_window') else 0
    return {'duration':duration,'start':start+offset,'source_media':source if use_original_audio and (source or {}).get('metadata',{}).get('has_audio') else None,'use_original_audio':bool(use_original_audio)}

def audio_window(source,start,duration,root):
    if not source:return None
    path=asset_path(source['video'],root)
    # Respect audio PTS relative to the original video start; preserve gaps as silence.
    with av.open(str(path)) as media:
        if not media.streams.audio:return None
        stream=media.streams.audio[0];rate=stream.sample_rate;channels=len(stream.codec_context.layout.channels)
        wave=np.zeros((channels,round(duration*rate)),dtype=np.float32)
        video=media.streams.video[0];origin=float((video.start_time or 0)*video.time_base)
        resampler=av.AudioResampler(format='fltp',layout=stream.codec_context.layout.name,rate=rate)
        for frame in media.decode(audio=0):
            for part in resampler.resample(frame):
                offset=round(((float(part.time) if part.time is not None else origin)-origin-start)*rate);data=part.to_ndarray();left=max(0,offset);right=min(wave.shape[1],offset+data.shape[1])
                if right>left:wave[:,left:right]=data[:,left-offset:right-offset]
        return wave,rate,stream.codec_context.layout.name

def finalize_file(source,destination,duration,original=None,start=0,root=None,check_interrupt=lambda:None):
    if not math.isfinite(duration) or duration<=0:raise ValueError('Invalid delivery duration.')
    audio=audio_window(original,start,duration,root) if original else None
    if audio is None:
        # Preserve the generated soundtrack if no original soundtrack is selected.
        from .media import source_parts
        sound=source_parts(source,image=False)[1]
        if sound:
            wave=sound['waveform'][0].numpy();sr=sound['sample_rate'];wave=wave[:,:round(duration*sr)]
            audio=(wave,sr,'mono' if wave.shape[0]==1 else 'stereo')
    with av.open(str(source)) as input, av.open(str(destination),'w',format='mp4',options={'movflags':'+faststart'}) as output:
        stream=input.streams.video[0];rate=stream.average_rate or stream.guessed_rate
        if not rate:raise ValueError('Generated video has no readable frame rate.')
        available=float(stream.duration*stream.time_base) if stream.duration else float(input.duration or 0)/av.time_base
        if available+1/float(rate)<duration:raise ValueError('The model returned less footage than the selected camera window. Generate again; the video was not stretched.')
        target=output.add_stream('libx264',rate=rate);target.width=stream.width;target.height=stream.height;target.pix_fmt='yuv420p';target.options={'crf':'18','preset':'fast'}
        grid=Fraction(1,90000);target.time_base=grid;target.codec_context.time_base=grid
        def mux_video(packet):
            if packet.pts is not None:
                remaining=duration-float(packet.pts*packet.time_base)
                packet.duration=max(1,round(min(1/float(rate),remaining)/float(packet.time_base)))
            output.mux(packet)
        if audio:
            wave,sr,layout=audio;sound=output.add_stream('aac',rate=sr);sound.layout=layout
        count=math.ceil(duration*float(rate)-1e-7);written=0
        for frame in input.decode(video=0):
            check_interrupt()
            if written>=count:break
            frame.pts=round(written/float(rate)/float(grid));frame.time_base=grid
            for packet in target.encode(frame):mux_video(packet)
            written+=1
        if written<count:raise ValueError('The model returned too few frames for the selected camera window.')
        for packet in target.encode():mux_video(packet)
        if audio:
            for offset in range(0,wave.shape[1],1024):
                check_interrupt();frame=av.AudioFrame.from_ndarray(wave[:,offset:offset+1024].copy(),format='fltp',layout=layout);frame.sample_rate=sr;frame.pts=offset;frame.time_base=Fraction(1,sr)
                for packet in sound.encode(frame):output.mux(packet)
            for packet in sound.encode():output.mux(packet)
    return destination

class CartwheelFinalizeVideo(io.ComfyNode):
    @classmethod
    def define_schema(cls):return io.Schema(node_id='CartwheelFinalizeVideo',display_name='Finish Video · Duration / Original Audio',category='Cartwheel',inputs=[io.Video.Input('video'),io.Custom('CARTWHEEL_PREPARED_REFERENCES').Input('references')],outputs=[io.Video.Output('video')])
    @classmethod
    def execute(cls,video,references):
        from comfy.model_management import throw_exception_if_processing_interrupted
        settings=references.get('delivery')
        if not settings:return io.NodeOutput(video)
        root=Path(folder_paths.get_output_directory());directory=root/'cartwheel'/'final';directory.mkdir(parents=True,exist_ok=True);dest=directory/(uuid4().hex+'.mp4');temporary=dest.with_suffix('.mp4.part')
        try:
            with TemporaryDirectory(prefix='cw-final-') as work:
                source=Path(work)/'generated.mp4';video.save_to(str(source));finalize_file(source,temporary,settings['duration'],settings.get('source_media'),settings['start'],root,throw_exception_if_processing_interrupted)
            temporary.replace(dest)
        finally:temporary.unlink(missing_ok=True)
        return io.NodeOutput(InputImpl.VideoFromFile(str(dest)))

class CartwheelCameraData(io.ComfyNode):
    @classmethod
    def define_schema(cls):return io.Schema(node_id='CartwheelCameraData',display_name='Camera Data · Export / Inspect',category='Cartwheel',inputs=[io.String.Input('camera_json',force_input=True)],outputs=[io.String.Output(x) for x in ['positions','targets','path','focal_lengths','fovs','camera_json']])
    @classmethod
    def execute(cls,camera_json):
        from .motion_io import camera_document
        raw=json.loads(camera_json);value=camera_document(raw);frames=value['frames'];value.update({k:raw[k] for k in ['world_frame','editor_recipe','frame_count'] if k in raw})
        # Explicit filmback for converting vertical FOV; no guessed change to the saved projection.
        focal=[f.get('focal_length') for f in frames]
        return io.NodeOutput(*[json.dumps(x) for x in [[f['position'] for f in frames],[f.get('target') for f in frames],{'samples':frames,'editor_recipe':value.get('editor_recipe')},focal,[f['fov'] for f in frames],value]])
