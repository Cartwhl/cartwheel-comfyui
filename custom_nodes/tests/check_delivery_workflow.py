"""Real Comfy types and native expansion, synthetic media, no paid requests."""
import sys,importlib.util,json
from pathlib import Path
from tempfile import TemporaryDirectory
import numpy as np
root=Path(sys.argv[1]);package_root=Path(__file__).resolve().parents[1];sys.path[:0]=[str(root),str(package_root/'tests')]
temporary=TemporaryDirectory();base=Path(temporary.name);sys.argv=[sys.argv[0],'--cpu','--base-directory',str(base)]
import comfy.options;comfy.options.enable_args_parsing()
from comfy_api.latest import InputImpl
from test_media import make_video
spec=importlib.util.spec_from_file_location('cw_delivery_test',package_root/'__init__.py',submodule_search_locations=[str(package_root)]);p=importlib.util.module_from_spec(spec);sys.modules[spec.name]=p;spec.loader.exec_module(p)
from cw_delivery_test import nodes,delivery,reference_library,endpoint_images
import folder_paths,torch
out=Path(folder_paths.get_output_directory());out.mkdir(parents=True,exist_ok=True)
original=out/'original.mp4';generated=out/'generated.mp4';control=out/'control.mp4';make_video(original,frames=240,fps=24,audio=True);make_video(generated,frames=192,fps=24,audio=False);make_video(control,frames=180,fps=24,audio=False)
context={'schema_version':1,'source_media':{'video':{'filename':'original.mp4','subfolder':'','type':'output'},'metadata':{'has_audio':True}},'passes':{'depth':{'filename':'control.mp4','subfolder':'','type':'output'}}}
control.with_suffix('.render.json').write_text(json.dumps(context))
video=InputImpl.VideoFromFile(str(control));prepared=nodes.CartwheelPrepareVideoReferences.execute(video,model='MiniMax H3',start_seconds=1,reference_duration=5.5)
pack=prepared[9];assert pack['duration']==6 and pack['delivery']['duration']==5.5 and pack['delivery']['start']==1
assert pack['delivery']['source_media'] and not pack['audios']
assert nodes.CartwheelPrepareVideoReferences.check_lazy_status(use_endpoint_images=False,first_frame_image=None,last_frame_image=None)==[]
frame=torch.zeros((1,64,64,3));prepared=nodes.CartwheelPrepareVideoReferences.execute(video,model='MiniMax H3',reference_duration=5.5,use_endpoint_images=True,first_frame_image=frame,last_frame_image=frame,camera_reference='None')
assert len(prepared[9]['images'])==2 and not prepared[9]['videos']
depth=nodes.CartwheelPrepareVideoReferences.execute(video,reference_duration=5.5,camera_reference='Depth');assert len(depth[9]['videos'])==1
result=delivery.CartwheelFinalizeVideo.execute(InputImpl.VideoFromFile(str(generated)),pack);info=p.nodes.inspect_video(result[0].get_stream_source());assert info['frame_count']==132 and info['fps']==24 and info['has_audio'];assert abs(info['duration']-5.5)<.001
restored=delivery.audio_window(pack['delivery']['source_media'],1,5.5,out);assert restored[0].shape[-1]==264000 and np.max(np.abs(restored[0]))>.05
silent=nodes.CartwheelPrepareVideoReferences.execute(video,use_original_audio=False);assert silent[9]['delivery']['source_media'] is None
for service in endpoint_images.SERVICES:
 result=endpoint_images.CartwheelEndpointImage.execute(frame,generate=True,service=service,prompt='Style this frame');graph=result.expand
 assert len(graph)==1 and next(iter(graph.values()))['class_type'] in ['OpenAIGPTImageNodeV2','GeminiImageNode','Flux2ImageNode']
assert endpoint_images.CartwheelEndpointImage.execute(frame)[0] is frame
expand=reference_library.CartwheelGenerateVideo.execute(pack).expand;assert any(n['class_type']=='CartwheelFinalizeVideo' for n in expand.values())
# Too-short output is rejected rather than stretching or padding.
try:delivery.finalize_file(control,out/'bad.mp4',10)
except ValueError:pass
else:raise AssertionError('Short output was accepted')
fractional=out/'fractional.mp4';delivery.finalize_file(generated,fractional,7.517)
fractional_info=p.nodes.inspect_video(fractional);assert abs(fractional_info['duration']-7.517)<.002,fractional_info
assert fractional_info['frame_count']==181
print('PASS: exact-window 5.5s delivery/132 frames, original audio, pass selection, optional endpoint images, three native image services, lazy defaults and provider finalization. No paid calls.')
# Validate and execute actual expansion schemas, while mocking only paid native endpoints.
import asyncio,nodes as registry
from execution import validate_prompt,PromptExecutor
from unittest.mock import patch
from types import SimpleNamespace
from comfy_api.latest import io
from comfy_api_nodes.nodes_openai import OpenAIGPTImageNodeV2 as OpenAI
from comfy_api_nodes.nodes_gemini import GeminiImage as Gemini
from comfy_api_nodes.nodes_bfl import Flux2ImageNode as Flux
class ImageFixture(io.ComfyNode):
    @classmethod
    def define_schema(cls):return io.Schema(node_id='DeliveryImageFixture',inputs=[io.Float.Input('value',default=0,optional=True)],outputs=[io.Image.Output()])
    @classmethod
    def execute(cls,value=0):return io.NodeOutput(torch.full_like(frame,value))
class ImageSink(io.ComfyNode):
    @classmethod
    def define_schema(cls):return io.Schema(node_id='DeliveryImageSink',is_output_node=True,inputs=[io.Image.Input('image')],outputs=[])
    @classmethod
    def execute(cls,image):assert image.shape[:3]==frame.shape[:3] and image.shape[-1] in (3,4);return io.NodeOutput()
for cls in [ImageFixture,ImageSink,endpoint_images.CartwheelEndpointImage,OpenAI,Gemini,Flux]:registry.NODE_CLASS_MAPPINGS[cls.define_schema().node_id]=cls
calls=[]
async def native(cls,**kwargs):
    calls.append((cls.define_schema().node_id,kwargs))
    # OpenAI's real decoder always returns RGBA, including for opaque images.
    rgba=torch.cat([torch.full_like(frame,.75),torch.ones((*frame.shape[:3],1))],dim=-1)
    return io.NodeOutput(rgba)

async def image_check():
    server=SimpleNamespace(client_id=None,last_node_id=None,send_sync=lambda *a,**kw:None)
    with patch.object(OpenAI,'execute',classmethod(native)),patch.object(Gemini,'execute',classmethod(native)),patch.object(Flux,'execute',classmethod(native)):
        for enabled in [False,True]:
            for service in endpoint_images.SERVICES:
                calls.clear();graph={'1':{'class_type':'DeliveryImageFixture','inputs':{}},'2':{'class_type':'CartwheelEndpointImage','inputs':{'image':['1',0],'generate':enabled,'service':service,'prompt':'Style frame','seed':42}},'3':{'class_type':'DeliveryImageSink','inputs':{'image':['2',0]}}}
                valid,error,outputs,details=await validate_prompt('delivery-image',graph,None);assert valid,(error,details)
                executor=PromptExecutor(server,cache_args={'ram':0,'ram_inactive':0});await executor.execute_async(graph,'delivery-image',{},outputs)
                assert executor.success,executor.status_messages
                assert len(calls)==int(enabled),(enabled,service,calls)
asyncio.run(image_check())
print('PASS: actual native OpenAI/Gemini/BFL expansion and validation; disabled endpoint styling makes zero provider calls.')

# Different shapes, ordered references and unmodified artist wording reach all services.
raw_first=torch.full((1,32,48,3),.1)
styled_first=torch.full((1,48,32,3),.8)
style=torch.full((2,16,16,3),.5)
for service in endpoint_images.SERVICES:
    result=endpoint_images.CartwheelEndpointImage.execute(frame,generate=True,service=service,
        prompt='Dress the orange performer in blue.',first_frame=raw_first,
        styled_first_frame=styled_first,style_reference=style)
    values=next(iter(result.expand.values()))['inputs']
    if service=='Google Nano Banana':
        refs=values['images'];assert refs.shape==(5,64,64,3)
        assert torch.allclose(refs.mean(dim=(1,2,3)),torch.tensor([0.,.1,.8,.5,.5]))
    else:
        refs=[values[f'model.images.image_{i}'] for i in range(1,6)]
        assert refs[0] is not None and torch.equal(refs[1],raw_first) and torch.equal(refs[2],styled_first)
    prompt=values['prompt']
    assert 'Image 1 controls the exact camera' in prompt and 'Image 2 is the ORIGINAL FIRST' in prompt
    assert 'Image 3 is the STYLED FIRST' in prompt and 'before/after pair' in prompt
    assert 'Dress the orange performer in blue.' in prompt
assert endpoint_images.CartwheelEndpointImage.check_lazy_status(generate=False,first_frame=None,styled_first_frame=None)==[]
assert endpoint_images.CartwheelEndpointImage.check_lazy_status(generate=True,first_frame=None,styled_first_frame=None)==['first_frame','styled_first_frame']

from itertools import product
async def continuity_check():
    server=SimpleNamespace(client_id=None,last_node_id=None,send_sync=lambda *a,**kw:None)
    with patch.object(OpenAI,'execute',classmethod(native)),patch.object(Gemini,'execute',classmethod(native)),patch.object(Flux,'execute',classmethod(native)):
        for enabled in [False,True]:
            for first_service,service in product(endpoint_images.SERVICES,repeat=2):
                calls.clear()
                graph={
                    '1':{'class_type':'DeliveryImageFixture','inputs':{'value':.1}},
                    '2':{'class_type':'DeliveryImageFixture','inputs':{'value':.25}},
                    '3':{'class_type':'CartwheelEndpointImage','inputs':{'image':['1',0],'generate':True,'service':first_service,'prompt':'First appearance','seed':42}},
                    '4':{'class_type':'CartwheelEndpointImage','inputs':{'image':['2',0],'first_frame':['1',0],'styled_first_frame':['3',0],'generate':enabled,'service':service,'prompt':'Final appearance','seed':42}},
                    '5':{'class_type':'DeliveryImageSink','inputs':{'image':['4',0]}},
                }
                valid,error,outputs,details=await validate_prompt('continuity',graph,None);assert valid,(error,details)
                executor=PromptExecutor(server,cache_args={'ram':0,'ram_inactive':0})
                await executor.execute_async(graph,'continuity',{},outputs)
                assert executor.success,executor.status_messages
                assert len(calls)==(2 if enabled else 0),(service,enabled,calls)
                if enabled:
                    last=calls[-1][1]
                    if service=='Google Nano Banana':refs=last['images']
                    else:refs=torch.cat(list(last['model']['images'].values()),dim=0)
                    assert torch.allclose(refs.mean(dim=(1,2,3)),torch.tensor([.25,.1,.75])),(service,last)
asyncio.run(continuity_check())

# Explicit passes are lazy and replace, rather than append to, the primary control.
pass_inputs={'depth_video':None,'normal_video':None,'pose_video':None}
assert nodes.CartwheelPrepareVideoReferences.check_lazy_status(**pass_inputs)==[]
for kind in ['Depth','Normal','Pose']:
    assert nodes.CartwheelPrepareVideoReferences.check_lazy_status(camera_reference=kind,**pass_inputs)==[kind.lower()+'_video']
    selected=nodes.CartwheelPrepareVideoReferences.execute(video,camera_reference=kind,**{kind.lower()+'_video':InputImpl.VideoFromFile(str(original))},reference_duration=5.5)
    assert len(selected[9]['videos'])==1 and selected[0].get_stream_source()==str(original)
# Invalid optional inputs are ignored when Color/None is selected.
selected=nodes.CartwheelPrepareVideoReferences.execute(video,depth_video=object(),normal_video=object(),pose_video=object())
assert len(selected[9]['videos'])==1 and selected[0].get_stream_source()==str(control)
try:
    endpoint_images.CartwheelEndpointImage.execute(frame,generate=True,service='BFL Flux.2',prompt='Test',style_reference=torch.zeros((8,16,16,3)))
except ValueError as error:assert 'at most 8' in str(error)
else:raise AssertionError('Too many Flux reference images accepted')

# Exported graph links must be reciprocal and use the updated schema socket order.
w=json.loads((package_root.parent/'Cartwheel-Motion-to-Video.json').read_text())
ns={n['id']:n for n in w['nodes']}
for link,source,slot,target,input_slot,kind in w['links']:
    assert link in ns[source]['outputs'][slot]['links']
    assert ns[target]['inputs'][input_slot]['link']==link
assert [s['name'] for s in ns[52]['inputs']]==['image',*[f'reference_{i}' for i in range(1,6)],'references']
assert ns[57]['type']=='CartwheelMatchFirstFrame' and ns[56]['type']=='CartwheelImageReferences'
assert all(name in [i['name'] for i in ns[3]['inputs']] for name in ['depth_video','normal_video','pose_video'])
print('PASS: three-service continuity chain, camera roles, all Gemini references, lazy no-charge bypass, explicit pass selection and workflow wiring. No paid calls.')

# Exercise lazy pass sockets through the real executor, rather than only status helpers.
pass_calls=[]
class PassFixture(io.ComfyNode):
    @classmethod
    def define_schema(cls):return io.Schema(node_id='DeliveryPassFixture',inputs=[io.String.Input('kind')],outputs=[io.Video.Output()])
    @classmethod
    def execute(cls,kind):pass_calls.append(kind);return io.NodeOutput(video)
class VideoSink(io.ComfyNode):
    @classmethod
    def define_schema(cls):return io.Schema(node_id='DeliveryVideoSink',is_output_node=True,inputs=[io.Video.Input('video')],outputs=[])
    @classmethod
    def execute(cls,video):assert abs(video.get_duration()-5.5)<.001;return io.NodeOutput()
for cls in [PassFixture,VideoSink,nodes.CartwheelPrepareVideoReferences]:registry.NODE_CLASS_MAPPINGS[cls.define_schema().node_id]=cls
async def pass_check():
    server=SimpleNamespace(client_id=None,last_node_id=None,send_sync=lambda *a,**kw:None)
    for choice in ['Color','Depth','Normal','Pose']:
        pass_calls.clear()
        graph={str(i):{'class_type':'DeliveryPassFixture','inputs':{'kind':kind}} for i,kind in enumerate(['Color','Depth','Normal','Pose'],1)}
        graph['5']={'class_type':'CartwheelPrepareVideoReferences','inputs':{'control_video':['1',0],
            'model':'MiniMax H3','output_duration':0,'start_seconds':0,'reference_duration':5.5,'prompt':'Test',
            'camera_reference':choice,'depth_video':['2',0],'normal_video':['3',0],'pose_video':['4',0]}}
        graph['6']={'class_type':'DeliveryVideoSink','inputs':{'video':['5',0]}}
        valid,error,outputs,details=await validate_prompt('pass-lazy',graph,None);assert valid,(error,details)
        executor=PromptExecutor(server,cache_args={'ram':0,'ram_inactive':0});await executor.execute_async(graph,'pass-lazy',{},outputs)
        assert executor.success,executor.status_messages
        assert set(pass_calls)==({'Color'} if choice=='Color' else {'Color',choice}),pass_calls
asyncio.run(pass_check())
print('PASS: real executor requests only the selected control-pass socket; all unselected passes remain lazy.')

# Run the actual native OpenAI decoder on a local PNG payload, without an API call.
import base64
from io import BytesIO
from PIL import Image
from comfy_api_nodes.nodes_openai import validate_and_cast_response
buffer=BytesIO();Image.new('RGBA',(48,32),(51,102,153,128)).save(buffer,format='PNG')
response=SimpleNamespace(data=[SimpleNamespace(b64_json=base64.b64encode(buffer.getvalue()).decode(),url=None)])
rgba=asyncio.run(validate_and_cast_response(response))
assert rgba.shape==(1,32,48,4)
refs,roles=endpoint_images.frame_references(frame,styled_first_frame=rgba)
expected=rgba[...,:3]*rgba[...,3:4]+1-rgba[...,3:4]
assert refs[1].shape==(1,32,48,3) and torch.allclose(refs[1],expected)
for service in endpoint_images.SERVICES:
    result=endpoint_images.CartwheelEndpointImage.execute(frame,generate=True,service=service,prompt='Keep identities',styled_first_frame=rgba)
    assert result.expand
# Grayscale and fully transparent references also have stable RGB conversions.
transparent=torch.zeros((1,8,8,4));gray=torch.full((1,8,8,1),.3)
refs,roles=endpoint_images.frame_references(frame,first_frame=gray,styled_first_frame=transparent)
assert refs[1].shape[-1]==3 and torch.all(refs[2]==1)
for bad in [torch.zeros(1,0,8,3),torch.zeros(1,8,8,2),torch.zeros(8,8,3)]:
    try:endpoint_images.frame_references(frame,styled_first_frame=bad)
    except ValueError as error:assert 'styled_first reference' in str(error)
    else:raise AssertionError('Malformed image accepted')
print('PASS: actual OpenAI RGBA decoder, transparent/grayscale handling, and all nine cross-service continuity combinations. No paid calls.')

# Independent switches: all 16 combinations on both providers. Camera clips
# must share a window, stay ordered, and stay inside count/duration budgets.
from itertools import product
switches=['use_camera_video','use_depth','use_normal','use_pose']
labels=['Edited camera video','Depth pass','Normal pass','Pose pass']
for model,limit,max_count in [('Seedance 2.5',30,10),('MiniMax H3',15,3)]:
    for values in product([False,True],repeat=4):
        flags=dict(zip(switches,values));count=sum(values)
        kwargs=dict(flags,model=model,start_seconds=1,depth_video=video,normal_video=InputImpl.VideoFromFile(str(generated)),pose_video=video,reference_image=frame)
        if count>max_count:
            try:nodes.CartwheelPrepareVideoReferences.execute(video,**kwargs)
            except ValueError as error:assert 'at most 3 video' in str(error)
            else:raise AssertionError('H3 accepted four video references')
            continue
        result=nodes.CartwheelPrepareVideoReferences.execute(video,**kwargs);pack=result[9]
        assert len(pack['videos'])==count
        assert [r['name'] for r in pack['info']['camera_videos']]==[name for name,use in zip(labels,values) if use]
        assert sum(v.get_duration() for v in pack['videos'])<=limit+1e-6
        if count:
            durations=[v.get_duration() for v in pack['videos']]
            assert max(durations)-min(durations)<1e-6
            assert all(r['start']==1 for r in pack['info']['camera_videos'])
            assert abs(pack['delivery']['duration']-durations[0])<1e-6
            assert all(abs(v.get_active_trim_window()[0]-1)<1e-6 for v in pack['videos'])
        pending=dict(flags,depth_video=None,normal_video=None,pose_video=None)
        assert nodes.CartwheelPrepareVideoReferences.check_lazy_status(**pending)==[name for name,use in zip(['depth_video','normal_video','pose_video'],values[1:]) if use]
# Adding a creative video consumes the budget after the synchronized camera group.
result=nodes.CartwheelPrepareVideoReferences.execute(video,model='MiniMax H3',use_depth=True,depth_video=video,secondary_video=InputImpl.VideoFromFile(str(original)),start_seconds=1)
pack=result[9];assert len(pack['videos'])==3 and all(abs(v.get_duration()-5)<1e-6 for v in pack['videos'])
assert pack['info']['secondary_video_index']==2 and result[7].get_stream_source()==str(original)
assert pack['info']['camera_video_count']==2
# With no enabled camera video or creative image/video, fail locally.
try:nodes.CartwheelPrepareVideoReferences.execute(video,use_camera_video=False)
except ValueError as error:assert 'Enable a camera video' in str(error)
else:raise AssertionError('Empty video generation accepted')
print('PASS: independent camera toggles, synchronized windows, budgets, roles, creative video indexing and disabled pass laziness.')

async def independent_pass_check():
    server=SimpleNamespace(client_id=None,last_node_id=None,send_sync=lambda *a,**kw:None)
    for values in product([False,True],repeat=4):
        pass_calls.clear()
        graph={str(i):{'class_type':'DeliveryPassFixture','inputs':{'kind':kind}} for i,kind in enumerate(['Color','Depth','Normal','Pose'],1)}
        graph['7']={'class_type':'DeliveryImageFixture','inputs':{}}
        graph['5']={'class_type':'CartwheelPrepareVideoReferences','inputs':{'control_video':['1',0],
            'model':'Seedance 2.5','output_duration':0,'start_seconds':0,'reference_duration':5.5,'prompt':'Test',
            **dict(zip(switches,values)), 'reference_image':['7',0],
            'depth_video':['2',0],'normal_video':['3',0],'pose_video':['4',0]}}
        graph['6']={'class_type':'DeliveryVideoSink','inputs':{'video':['5',0]}}
        valid,error,outputs,details=await validate_prompt('independent-passes',graph,None);assert valid,(error,details)
        executor=PromptExecutor(server,cache_args={'ram':0,'ram_inactive':0});await executor.execute_async(graph,'independent-passes',{},outputs)
        assert executor.success,executor.status_messages
        assert set(pass_calls)==({'Color'}|{name for name,use in zip(['Depth','Normal','Pose'],values[1:]) if use}),(values,pass_calls)
asyncio.run(independent_pass_check())
print('PASS: all 16 independent pass combinations execute through Comfy with only enabled optional sockets evaluated.')

# The moved switch reaches Prepare via an ordinary Boolean connection. Endpoint
# image inputs remain lazy when off, regardless of the saved fallback value.
endpoint_reads=[];prepared_images=[]
class FrameFlagFixture(io.ComfyNode):
    @classmethod
    def define_schema(cls):return io.Schema(node_id='FrameFlagFixture',inputs=[io.Boolean.Input('enabled')],outputs=[io.Boolean.Output()])
    @classmethod
    def execute(cls,enabled):return io.NodeOutput(enabled)
class FrameImagesFixture(io.ComfyNode):
    @classmethod
    def define_schema(cls):return io.Schema(node_id='FrameImagesFixture',inputs=[],outputs=[io.Image.Output(),io.Image.Output()])
    @classmethod
    def execute(cls):endpoint_reads.append('read');return io.NodeOutput(frame,frame)
class PreparedImageSink(io.ComfyNode):
    @classmethod
    def define_schema(cls):return io.Schema(node_id='PreparedImageSink',is_output_node=True,inputs=[reference_library.Prepared.Input('references')],outputs=[])
    @classmethod
    def execute(cls,references):prepared_images.append(len(references['images']));return io.NodeOutput()
for cls in [FrameFlagFixture,FrameImagesFixture,PreparedImageSink]:registry.NODE_CLASS_MAPPINGS[cls.define_schema().node_id]=cls
async def moved_frame_control_check():
    server=SimpleNamespace(client_id=None,last_node_id=None,send_sync=lambda *a,**kw:None)
    for enabled in [False,True]:
        endpoint_reads.clear();prepared_images.clear()
        graph={
            '1':{'class_type':'DeliveryPassFixture','inputs':{'kind':'Color'}},
            '2':{'class_type':'FrameFlagFixture','inputs':{'enabled':enabled}},
            '3':{'class_type':'FrameImagesFixture','inputs':{}},
            '4':{'class_type':'CartwheelPrepareVideoReferences','inputs':{'control_video':['1',0],'model':'Seedance 2.5',
                 'output_duration':0,'start_seconds':0,'reference_duration':5.5,'prompt':'Test','use_endpoint_images':['2',0],
                 'first_frame_image':['3',0],'last_frame_image':['3',1]}},
            '5':{'class_type':'PreparedImageSink','inputs':{'references':['4',9]}},
        }
        valid,error,outputs,details=await validate_prompt('moved-frame-control',graph,None);assert valid,(error,details)
        executor=PromptExecutor(server,cache_args={'ram':0,'ram_inactive':0});await executor.execute_async(graph,'moved-frame-control',{},outputs)
        assert executor.success,executor.status_messages
        assert prepared_images==[2 if enabled else 0] and len(endpoint_reads)==int(enabled)
asyncio.run(moved_frame_control_check())
print('PASS: moved first/last image switch passes through Boolean wiring and skips endpoint image evaluation when off.')
# Separate control display reuses exact local files; endpoints toggle is independent of preview.
from cw_delivery_test.control_preview import CartwheelControlPreview
shown=CartwheelControlPreview.execute(video,video,video).ui['cartwheel_control_previews'][0]
assert set(shown)=={'depth','normal','pose'} and all(x['filename']=='control.mp4' for x in shown.values())
assert endpoint_images.CartwheelEndpointReview.execute(enabled=False,use_frame_images=True)[0] is True
assert endpoint_images.CartwheelEndpointReview.check_lazy_status(enabled=False,first=None,last=None)==[]
assert endpoint_images.CartwheelEndpointReview.execute(enabled=True,use_frame_images=False,first=frame,last=frame)[0] is False
graph_ui=json.loads((package_root.parent/'Cartwheel-Motion-to-Video.json').read_text())
assert any(n['type']=='CartwheelControlPreview' for n in graph_ui['nodes'])
endpoint_link=next(l for l in graph_ui['links'] if l[3]==3 and l[-1]=='BOOLEAN' and l[1]==53)
assert endpoint_link[2]==0
print('PASS: local pass display uses original files, no re-encode/upload; image-review inclusion toggle is independent of preview and remains lazy when off.')
# Generic endpoint references: five artist images + automatic matching fit Flux's 8-image cap.
from cw_delivery_test.frame_references import CartwheelImageReferences,CartwheelMatchFirstFrame
from PIL import Image
input_root=Path(folder_paths.get_input_directory());input_root.mkdir(parents=True,exist_ok=True)
Image.new('RGB',(64,64),'red').save(input_root/'monkey.png')
library=CartwheelImageReferences.execute(json.dumps([{'file':'monkey.png','name':'monkey.png'}]))[0]
assert len(library)==1 and library[0]['image'].shape==(1,64,64,3)
assert CartwheelImageReferences.execute(json.dumps([{'file':'missing.png','enabled':False}]))[0]==[]
refs=[dict(library[0],name=f'character_{i}.png') for i in range(5)]
matched=CartwheelMatchFirstFrame.execute(frame,frame,refs)[0]
for service in endpoint_images.SERVICES:
 result=endpoint_images.CartwheelEndpointImage.execute(frame,generate=True,service=service,prompt='Replace orange with Image 2.',references=matched)
 n=next(iter(result.expand.values()));assert 'Image 2' in n['inputs']['prompt'] and 'before/after pair' in n['inputs']['prompt']
 if service=='Google Nano Banana':assert n['inputs']['images'].shape[0]==8
 else:assert sum(k.startswith('model.images.image_') for k in n['inputs'])==8
for enabled in [False,True]:
 missing=endpoint_images.CartwheelEndpointImage.check_lazy_status(generate=enabled,references=None,reference_1=None)
 assert missing==(['references','reference_1'] if enabled else [])
try:endpoint_images.CartwheelEndpointImage.execute(frame,generate=True,service=endpoint_images.SERVICES[0],prompt='test',references=refs,reference_1=frame)
except ValueError:pass
else:raise AssertionError('More than five artist images accepted')
assert endpoint_images.CartwheelEndpointImage.execute(frame,generate=False,references=[{'bad':'ignored'}])[0] is frame
print('PASS: five generic appearance refs, same numbering on first/last, automatic identity matching, all three native services, 8-image Flux cap, no-charge disabled path and missing disabled files.')

# Save-camera HTTP route: local-only snapshot, scoped browser, named recents and error handling.
from aiohttp import web
from aiohttp.test_utils import TestClient,TestServer
from types import SimpleNamespace
from unittest.mock import patch,AsyncMock
from motion_fixture import animated_glb
from cw_delivery_test.local_job_routes import register_local_jobs
from cw_delivery_test.motion_io import import_motion
from cw_delivery_test.camera import DEFAULT_SETTINGS,make_editor_camera
from cw_delivery_test.local_jobs import list_jobs
async def save_route_checks():
 glb=input_root/'save_actor.glb';glb.write_bytes(animated_glb(duration=2));motion=import_motion([glb],None,out)
 camera,_=make_editor_camera(motion,DEFAULT_SETTINGS)
 preview=out/'cartwheel/renders/save_preview.mp4';preview.parent.mkdir(parents=True,exist_ok=True);make_video(preview,frames=48,fps=24)
 preview.with_suffix('.camera.json').write_text(json.dumps({'schema_version':1,'units':'meters','up':'Y','fps':24,'aspect':16/9,'frames':[{'time':t,'position':[0,2,5],'quaternion':[0,0,0,1],'fov':35} for t in [0,2]],'render_actors':[{'actor':1,'format':'glb'}]}))
 server=SimpleNamespace(routes=web.RouteTableDef(),sockets={'test-browser':object()});register_local_jobs(server,lambda:str(out))
 app=web.Application(client_max_size=21*1024*1024);app.add_routes(server.routes)
 async with TestClient(TestServer(app)) as client:
  with patch.object(p.video_render.bridge,'render',new=AsyncMock(return_value=preview)) as render:
   body={'name':'Fisheye boxers','motion':motion,'camera_settings':DEFAULT_SETTINGS,'client_id':'test-browser','render_view':'test-view','fps':'24','size':'720p'}
   response=await client.post('/cartwheel/local-jobs/save-camera',json=body);assert response.status==200,await response.text();saved=await response.json();assert saved['saved']['title']=='Fisheye boxers'
   assert render.call_args.kwargs['client_id']=='test-browser' and any(i['title']=='Fisheye boxers' for i in list_jobs(out))
   for invalid in [{**body,'name':''},{**body,'motion':{}},{**body,'client_id':'unknown'}]:
    response=await client.post('/cartwheel/local-jobs/save-camera',json=invalid);assert response.status==400
   assert render.await_count==1
   async def chunks():
    payload=json.dumps({**body,'name':'Chunked wide shot'}).encode()
    for i in range(0,len(payload),128):yield payload[i:i+128]
   response=await client.post('/cartwheel/local-jobs/save-camera',data=chunks());assert response.status==200,await response.text()
   assert render.await_count==2
   response=await client.post('/cartwheel/local-jobs/save-camera',json=body,headers={'Origin':'https://unrelated.example'});assert response.status==403
 print('PASS: real local-save HTTP validation, scoped browser, named saved-job listing, invalid/missing motion and cross-site rejection; no capture/generation API calls.')
asyncio.run(save_route_checks())
