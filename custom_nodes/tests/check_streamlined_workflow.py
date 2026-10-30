"""Offline native execution: provider expansion, lazy checkpoint and references."""
import asyncio,importlib.util,json,sys,copy
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch
export_path=Path(sys.argv[2]) if len(sys.argv)>2 else None
comfy=Path(sys.argv[1]);pack=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(comfy),str(pack/'tests')]
tmp=TemporaryDirectory(prefix='cw-streamlined-check-');sys.argv=[sys.argv[0],'--cpu','--base-directory',tmp.name]
import comfy.options
comfy.options.enable_args_parsing()
import torch,nodes as registry
from comfy_api.latest import io,InputImpl
from comfy_extras.nodes_video import SaveVideo
from comfy_api_nodes.nodes_bytedance import ByteDance2ReferenceNodeV2 as Seed
from comfy_api_nodes.nodes_minimax import MinimaxHailuo03ReferenceNode as H3
from execution import validate_prompt,PromptExecutor
from test_media import make_video
spec=importlib.util.spec_from_file_location('cw_streamline_check',pack/'__init__.py',submodule_search_locations=[str(pack)])
package=importlib.util.module_from_spec(spec);sys.modules[spec.name]=package;spec.loader.exec_module(package)
from cw_streamline_check import nodes as cw
from cw_streamline_check.reference_library import CartwheelReferenceLibrary,CartwheelGenerateVideo,prepare_collection
from cw_streamline_check.workflow_step import CartwheelWorkflowStep
from cw_streamline_check.delivery import CartwheelFinalizeVideo
from cw_streamline_check.source_selector import CartwheelMotionSource
MODEL_CAPS={'Seedance 2.5':30,'MiniMax H3':15}
from cw_streamline_check.comparison import CartwheelCompareVideos,compare_files

async def main():
 import folder_paths,av
 from PIL import Image
 Path(folder_paths.get_temp_directory()).mkdir(parents=True,exist_ok=True);Path(folder_paths.get_input_directory()).mkdir(parents=True,exist_ok=True)
 source=Path(tmp.name)/'source.mp4';make_video(source,frames=480,audio=True);video=InputImpl.VideoFromFile(str(source));calls=[]
 image=Path(folder_paths.get_input_directory())/'ref.png';Image.new('RGB',(256,256),'red').save(image)
 assert CartwheelReferenceLibrary.execute(json.dumps([{'file':'missing.mp4','enabled':False}]))[0]==[]
 items=CartwheelReferenceLibrary.execute(json.dumps([{'file':'ref.png'}]))[0]
 assert items[0]['kind']=='image'
 for family,limit in [('Seedance 2.5',30),('MiniMax H3',15)]:
  prepared=prepare_collection(video,family,items=items,secondary=video,prompt='test')
  assert len(prepared['images'])==1 and len(prepared['videos'])==2
  assert sum(v.get_duration() for v in prepared['videos'])<=limit+1e-6
  too_many=[{'kind':'image','path':str(image),'name':'ref'}]*31
  try:prepare_collection(video,family,items=too_many)
  except ValueError as error:assert 'at most' in str(error)
  else:raise AssertionError('Missing count validation')
 class Fixture(io.ComfyNode):
  @classmethod
  def define_schema(cls):return io.Schema(node_id='CleanupVideoFixture',inputs=[],outputs=[io.Video.Output()])
  @classmethod
  def execute(cls):return io.NodeOutput(video)
 for c in [CartwheelFinalizeVideo,Fixture,cw.CartwheelPrepareVideoReferences,CartwheelReferenceLibrary,CartwheelGenerateVideo,CartwheelWorkflowStep,CartwheelCompareVideos,SaveVideo,Seed,H3,CartwheelMotionSource,cw.CartwheelLoadHistory,cw.CartwheelCameraPreview]:registry.NODE_CLASS_MAPPINGS[c.define_schema().node_id]=c
 async def native(cls,model,seed,watermark):
  family=model['model'];calls.append((family,len(model.get('reference_images',{})),len(model['reference_videos'])))
  assert model['reference_videos']['video_1'].get_duration()<=MODEL_CAPS[family]
  return io.NodeOutput(model['reference_videos']['video_1']) if family=='MiniMax H3' else io.NodeOutput(model['reference_videos']['video_1'],'offline')
 def save(cls,**kw):calls.append('save');return io.NodeOutput()
 def compare(cls,enabled,**kw):calls.append(('compare',enabled));return io.NodeOutput(video)
 base={
  '1':{'class_type':'CleanupVideoFixture','inputs':{}},
  '2':{'class_type':'CartwheelReferenceLibrary','inputs':{'files':json.dumps([{'file':'ref.png'}])}},
  '3':{'class_type':'CartwheelPrepareVideoReferences','inputs':{'control_video':['1',0],'reference_library':['2',0],'model':'MiniMax H3','output_duration':0,'start_seconds':0,'reference_duration':0,'prompt':'Follow Video 1'}},
  '4':{'class_type':'CartwheelGenerateVideo','inputs':{'references':['3',9],'seed':42,'generate_audio':True}},
  '5':{'class_type':'CartwheelWorkflowStep','inputs':{'camera_video':['1',0],'generated_video':['4',0],'action':'Preview camera'}},
  '6':{'class_type':'SaveVideo','inputs':{'video':['5',0],'filename_prefix':'test','format':'mp4','codec':'h264','color_space':'auto'}},
  '7':{'class_type':'CartwheelCompareVideos','inputs':{'enabled':['5',1],'camera_video':['3',0],'generated_video':['4',0]}}}
 server=SimpleNamespace(client_id=None,last_node_id=None,send_sync=lambda *a,**kw:None)
 with patch.object(Seed,'execute',classmethod(native)),patch.object(H3,'execute',classmethod(native)),patch.object(SaveVideo,'execute',classmethod(save)),patch.object(CartwheelCompareVideos,'execute',classmethod(compare)):
  for family in ['Seedance 2.5','MiniMax H3']:
   for generate in [False,True]:
    graph=copy.deepcopy(base);graph['3']['inputs']['model']=family;graph['3']['inputs']['reference_duration']=10;graph['5']['inputs']['action']='Generate final video' if generate else 'Preview camera'
    valid,error,outputs,details=await validate_prompt('cleanup',graph,None);assert valid and not details,(error,details)
    calls.clear();executor=PromptExecutor(server,cache_args={"ram":0,"ram_inactive":0});await executor.execute_async(graph,'cleanup',{},outputs)
    assert executor.success,executor.status_messages
    providers=[v for v in calls if isinstance(v,tuple) and v[0] in ['Seedance 2.5','MiniMax H3']]
    assert len(providers)==int(generate),(generate,calls)
    if generate:assert providers[0]==(family,1,1),calls
 # Verify the actual frontend export, including eager output roots and the saved-video branch.
 if export_path:
  async def history(cls,**kwargs):calls.append('history');return io.NodeOutput({},video,'',24.,480,20.,{'source':'history'},None)
  async def camera(cls,motion,**kwargs):calls.append('camera');return io.NodeOutput(video)
  with patch.object(cw.CartwheelLoadHistory,'execute',classmethod(history)),patch.object(cw.CartwheelCameraPreview,'execute',classmethod(camera)),patch.object(Seed,'execute',classmethod(native)),patch.object(H3,'execute',classmethod(native)),patch.object(SaveVideo,'execute',classmethod(save)),patch.object(CartwheelCompareVideos,'execute',classmethod(compare)):
   from comfy_extras.nodes_video import LoadVideo,VideoSlice
   registry.NODE_CLASS_MAPPINGS.update({'LoadVideo':LoadVideo,'Video Slice':VideoSlice})
   for family in ['Seedance 2.5','MiniMax H3']:
    for generate in [False,True]:
     graph=json.loads(export_path.read_text());graph['3']['inputs']['model']=family;graph['45']['inputs']['action']='Generate final video' if generate else 'Preview camera'
     calls.clear();valid,error,outputs,details=await validate_prompt('full-export',graph,None);assert valid and not details,(error,details)
     executor=PromptExecutor(server,cache_args={'ram':0,'ram_inactive':0});await executor.execute_async(graph,'full-export',{},outputs)
     assert executor.success,executor.status_messages
     assert calls.count('history')==1 and calls.count('camera')==1,calls
     assert calls.count('save')==2,calls
     providers=[v for v in calls if isinstance(v,tuple) and v[0] in MODEL_CAPS];assert len(providers)==int(generate),calls
     assert ('compare',generate) in calls,calls
 # Actual encoded comparison: unequal lengths, synchronized at frame 0, hold final frame.
 short=Path(tmp.name)/'short.mp4';make_video(short,frames=48,audio=False)
 dest=Path(tmp.name)/'comparison.mp4';compare_files(short,source,dest,height=64)
 with av.open(str(dest)) as output:
  frames=list(output.decode(video=0));assert len(frames)==480 and frames[0].width==128 and frames[0].height==96
  import numpy as np
  last=frames[-1].to_ndarray(format='rgb24');earlier=frames[60].to_ndarray(format='rgb24');assert np.abs(last[32:,:64].astype(float)-earlier[32:,:64]).mean()<3
 print('PASS: native Seedance/H3 expansion, preview skips both providers, shared budgets/counts, disabled missing references, and encoded synchronized comparison with final-frame hold.')
asyncio.run(main())
