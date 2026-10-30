import asyncio,importlib.util,json,sys,tempfile
from pathlib import Path
from unittest.mock import patch,AsyncMock
comfy=Path(sys.argv[1]).resolve();pack=Path(__file__).resolve().parents[1]
tmp=tempfile.TemporaryDirectory(prefix='swing-comfy-check-');sys.path[:0]=[str(comfy),str(pack/'tests')];sys.argv=[sys.argv[0],'--cpu','--base-directory',tmp.name]
import comfy.options
comfy.options.enable_args_parsing()
spec=importlib.util.spec_from_file_location('swing_integration',pack/'__init__.py',submodule_search_locations=[str(pack)])
pkg=importlib.util.module_from_spec(spec);sys.modules[spec.name]=pkg;spec.loader.exec_module(pkg)
from swing_integration import swing_choreo as swing,nodes
from swing_integration.source_selector import CartwheelMotionSource
from test_text_generation import FakeClient
from comfy_api.latest import io

def check_options():
 schema=swing.CartwheelSwingChoreo.define_schema();ids=[i.id for i in schema.inputs]
 assert ids==['prompt','duration','loop','frameRate','keyframeCleaning'],ids
 assert swing.CartwheelSwingChoreo in asyncio.run(pkg.CartwheelExtension().get_node_list())
 for duration in [5,8,15]:
  opts=swing.generation_options(' One actor waves\nthen bows ',duration,True,'30','Rebuild curves')
  assert 'batchName' not in opts
  assert opts['prompts']==['One actor waves\nthen bows'] and opts['requestedModel']=='swing_choreo'
  assert opts['swingChoreoProperties']['duration']==duration and opts['loop'] is True
  assert opts['exportSettings']['exportType']=='glb' and opts['exportSettings']['includeMesh'] is True
 cases=[{'prompt':' '},{'duration':4},{'duration':16},{'duration':8.5},{'duration':True},{'loop':'false'},{'frameRate':'25'},{'keyframeCleaning':'unknown'}]
 base=dict(prompt='One actor waves',duration=8,loop=False,frameRate='60',keyframeCleaning='None')
 for bad in cases:
  try:swing.generation_options(**(base|bad))
  except ValueError:pass
  else:raise AssertionError(bad)
 assert CartwheelMotionSource.check_lazy_status('Swing Choreo',swing_motion=None,history_motion=None)==['swing_motion']
 assert CartwheelMotionSource.execute('Swing Choreo',swing_motion='motion')[0]=='motion'

async def check_execute():
 import folder_paths
 Path(folder_paths.get_temp_directory()).mkdir(parents=True,exist_ok=True)
 fake=FakeClient(actors=4)
 progress=AsyncMock()
 class API:
  execution=type('Execution',(),{'set_progress':progress})()
 with patch.object(swing,'connection',return_value=fake.connection),patch.object(swing,'Client',return_value=fake),patch.object(swing,'ComfyAPI',API):
  result=await swing.CartwheelSwingChoreo.execute('Four people dance together',8,False,'60','None',batchName='Ignored old label')
 assert fake.submissions==1
 assert 'batchName' not in fake.calls[0][2]
 assert result[2]['title']=='Four people dance together'
 assert [a['id'] for a in result[0]['actors']]==[1,2,3,4]
 assert result[0]['scene']['camera']['format']=='default' and result[1] is None
 assert result[0]['scene'].get('material_policy')!='preserve'
 assert result[0]['timeline']['duration']==8
 json.dumps(result[2])
 print('PASS: real Swing Choreo execute with mocked HTTP client -> four animated GLBs -> MOTION -> default camera. No camera, thumbnail or native FBX required.')
try:
 check_options();asyncio.run(check_execute());print('PASS: schema defaults/options and invalid input checks; model and prompt count are fixed internally.')
finally:tmp.cleanup()
