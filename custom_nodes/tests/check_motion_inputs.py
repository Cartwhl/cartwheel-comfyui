"""Actual ComfyUI schema/executor check with synthetic, non-Cartwheel GLBs."""
import asyncio
import importlib.util
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

export_fixture=Path(sys.argv[2]).resolve() if len(sys.argv)>2 else None
root=Path(sys.argv[1]).resolve();package_root=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(root),str(package_root/'tests')]
temporary=TemporaryDirectory(prefix='generic-motion-check-');base=Path(temporary.name)
sys.argv=[sys.argv[0],'--cpu','--base-directory',str(base)]
import comfy.options
comfy.options.enable_args_parsing()
from motion_fixture import animated_glb
from render_fixture import make_render
from comfy_api.latest import InputImpl
from execution import validate_prompt,PromptExecutor
from comfy_extras.nodes_video import SaveVideo
import nodes as registry
import folder_paths
spec=importlib.util.spec_from_file_location('generic_motion_check',package_root/'__init__.py',submodule_search_locations=[str(package_root)])
package=importlib.util.module_from_spec(spec);sys.modules[spec.name]=package;spec.loader.exec_module(package)
from generic_motion_check import nodes
from generic_motion_check.motion_io import camera_from_motion

async def check():
    input_root=Path(folder_paths.get_input_directory());input_root.mkdir(parents=True,exist_ok=True)
    output_root=Path(folder_paths.get_output_directory());output_root.mkdir(parents=True,exist_ok=True)
    (input_root/'actor.glb').write_bytes(animated_glb())
    (input_root/'camera.json').write_text((package_root/'examples'/'camera-input-example.json').read_text())
    no_camera=nodes.CartwheelLoadMotionAndCamera.execute('actor.glb')
    assert no_camera[1] is None and no_camera[0]['scene']['camera']['format']=='default'
    imported=nodes.CartwheelLoadMotionAndCamera.execute('actor.glb',camera_file='camera.json')
    assert imported[1]['source']['format']=='camera_json'
    # A separately imported camera is an ordinary CAMERA object; the editor has
    # no connection lookup, even when motion and camera originate separately.
    fixture=make_render(output_root/'cartwheel/renders/mock_render.mp4')
    with patch.object(nodes,'save_job',return_value={'id':'fixture'}), patch.object(nodes,'connection',side_effect=AssertionError('No account needed')), \
         patch.object(nodes.bridge,'render',AsyncMock(return_value=fixture)) as render, \
         patch.object(nodes.PromptServer,'instance',SimpleNamespace(),create=True):
        for item in [no_camera,imported]:
            result=await nodes.CartwheelCameraPreview.execute(motion=item[0],camera=item[1],render_view='offline')
            assert isinstance(result[0],InputImpl.VideoFromFile)
            assert render.call_args.kwargs['motion']['scene']['camera']['format'] in ['default','camera_json']
    for cls in [nodes.CartwheelLoadMotionAndCamera,nodes.CartwheelCameraPreview,SaveVideo]:registry.NODE_CLASS_MAPPINGS[cls.define_schema().node_id]=cls
    schema=nodes.CartwheelCameraPreview.define_schema()
    assert schema.inputs[0].id=='motion'
    assert next(i for i in schema.inputs if i.id=='camera').optional
    graph={'1':{'class_type':'CartwheelLoadMotionAndCamera','inputs':{'actor_1':'actor.glb','actor_2':'','actor_3':'','actor_4':'','camera_file':''}},
           '2':{'class_type':'CartwheelCameraPreview','inputs':{'motion':['1',0],'camera':['1',1],'motion_index':0,'render_size':'720p','render_fps':'24','render_view':'offline','render_camera':0,'camera_settings':''}},
           '3':{'class_type':'SaveVideo','inputs':{'video':['2',0],'filename_prefix':'generic-test','format':'mp4','format.codec':'h264','format.codec.encoding':'auto'}}}
    ok,error,outputs,details=await validate_prompt('generic-input-check',graph,None)
    assert ok and not details,(error,details)
    server=SimpleNamespace(client_id=None,last_node_id=None,send_sync=lambda *a,**kw:None)
    with patch.object(nodes,'save_job',return_value={'id':'fixture'}), patch.object(nodes,'connection',side_effect=AssertionError('Editor must be source independent')), \
         patch.object(nodes.bridge,'render',AsyncMock(return_value=fixture)), \
         patch.object(nodes.PromptServer,'instance',server,create=True):
        executor=PromptExecutor(server,cache_args={'ram':0,'ram_inactive':0})
        await executor.execute_async(graph,'generic-input-check',execute_outputs=outputs)
        assert executor.success,executor.status_messages
    # Export a fixture only when an explicit destination was supplied.
    if export_fixture is not None:
        import shutil
        export_fixture.mkdir(parents=True, exist_ok=True)
        target=export_fixture/'output'
        if target.exists():
            raise ValueError('Fixture output already exists; choose an empty destination.')
        shutil.copytree(output_root,target)
        (export_fixture/'fixture.json').write_text(json.dumps({'root':str(target),'motions':[no_camera[0],imported[0]]}))
    print('GLB file source, optional CAMERA=None connection, JSON camera, zero credential access, actual ComfyUI execution and VIDEO output passed.')

try:asyncio.run(check())
finally:temporary.cleanup()
