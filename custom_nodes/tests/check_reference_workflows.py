"""Installed ComfyUI integration checks, with all model/upload operations mocked."""
import asyncio
import importlib.util
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from unittest.mock import AsyncMock, patch
from types import SimpleNamespace

import torch

comfy_root=Path(sys.argv[1]).resolve();package_root=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(comfy_root),str(package_root/'tests')]
temporary=TemporaryDirectory(prefix='cw-reference-check-');base=Path(temporary.name)
sys.argv=[sys.argv[0],'--cpu','--base-directory',str(base)]
import comfy.options
comfy.options.enable_args_parsing()
from comfy_api.latest import InputImpl, io
from comfy_execution.graph import ExecutionBlocker
from comfy_execution.validation import validate_node_input
from comfy_extras.nodes_video import VideoSlice
from comfy_api_nodes import nodes_minimax as h3
from test_media import make_video
spec=importlib.util.spec_from_file_location('cw_reference_check',package_root/'__init__.py',submodule_search_locations=[str(package_root)])
package=importlib.util.module_from_spec(spec);sys.modules[spec.name]=package;spec.loader.exec_module(package)
from cw_reference_check import nodes


async def check():
    import folder_paths
    Path(folder_paths.get_temp_directory()).mkdir(parents=True,exist_ok=True)
    path=base/'source.mp4';make_video(path,frames=480,audio=True)
    source=InputImpl.VideoFromFile(str(path));image=torch.zeros((1,256,256,3))
    original_bytes=path.read_bytes()
    # Automatic capping and source context use a single ordinary VIDEO connection.
    rendered=base/'camera.mp4';make_video(rendered,frames=1080,audio=False)
    context=InputImpl.VideoFromFile(str(rendered))
    context.cartwheel_source_video=source  # Stale metadata must be ignored.
    assert isinstance(context,InputImpl.VideoFromFile)
    assert context.get_duration()==45
    assert len(nodes.CartwheelCameraPreview.define_schema().outputs)==10
    auto=nodes.CartwheelPrepareVideoReferences.execute(context,model='MiniMax H3')
    assert auto[0].get_duration()==15 and auto[4]==15 and auto[8] is True
    assert isinstance(auto[1],ExecutionBlocker) and isinstance(auto[2],ExecutionBlocker)
    # Disabled references stay connected/saved but must never affect the clip
    # window or consume the video allowance. They are requested lazily only
    # when their corresponding toggle is enabled.
    disabled=nodes.CartwheelPrepareVideoReferences.execute(context,model='MiniMax H3',
        reference_image=image,secondary_video=source,reference_audio={'waveform':torch.ones(1,2,48000), 'sample_rate':48000},
        use_reference_image=False,use_secondary_video=False,use_reference_audio=False)
    assert disabled[0].get_duration()==15
    assert isinstance(disabled[1],ExecutionBlocker) and isinstance(disabled[2],ExecutionBlocker) and isinstance(disabled[7],ExecutionBlocker)
    assert json.loads(disabled[6])['secondary_video'] is None
    assert nodes.CartwheelPrepareVideoReferences.check_lazy_status(reference_image=None,secondary_video=None,reference_audio=None,
        use_reference_image=False,use_secondary_video=False,use_reference_audio=False)==[]
    assert nodes.CartwheelPrepareVideoReferences.check_lazy_status(reference_image=None,secondary_video=None,reference_audio=None,
        use_reference_image=True,use_secondary_video=False,use_reference_audio=False)==['reference_image']
    assert not json.loads(auto[6])['has_image'] and not json.loads(auto[6])['has_audio']
    seed_auto=nodes.CartwheelPrepareVideoReferences.execute(context)
    assert seed_auto[0].get_duration()==30 and seed_auto[4]==30 and seed_auto[8] is False
    assert isinstance(seed_auto[1],ExecutionBlocker) and isinstance(seed_auto[2],ExecutionBlocker)
    short=nodes.CartwheelPrepareVideoReferences.execute(source,model='MiniMax H3',reference_duration=15)
    assert short[0].get_duration()==15
    tail=nodes.CartwheelPrepareVideoReferences.execute(context,model='MiniMax H3',start_seconds=40)
    assert tail[0].get_duration()==5 and isinstance(tail[2],ExecutionBlocker)
    end=nodes.CartwheelPrepareVideoReferences.execute(context,model='MiniMax H3',start_seconds=10,end_seconds=18)
    assert end[0].get_duration()==8
    two=nodes.CartwheelPrepareVideoReferences.execute(context,model='MiniMax H3',secondary_video=source,reference_image=image)
    assert two[0].get_duration()==two[7].get_duration()==7.5
    explicit_audio={'waveform':torch.ones(1,2,48000*30), 'sample_rate':48000}
    overridden=nodes.CartwheelPrepareVideoReferences.execute(context,model='MiniMax H3',reference_audio=explicit_audio,
        reference_image=image,reference_duration=8,audio_start_seconds=2)
    assert torch.equal(overridden[1],image) and overridden[2]['waveform'].shape==(1,2,48000*8)
    assert json.loads(overridden[6])['has_image'] and json.loads(overridden[6])['has_audio']
    # The camera node itself carries source context; ordinary Save Video remains compatible.
    source_dir=Path(folder_paths.get_output_directory())/'cartwheel'/'fixture'
    source_dir.mkdir(parents=True)
    saved_source=source_dir/'source.mp4';saved_source.write_bytes(path.read_bytes())
    capture={'source':{'path':str(saved_source)}}
    assert nodes.capture_source_path(capture)==saved_source.resolve()
    assert nodes.capture_source_path({'source':{'path':str(path)}}) is None
    render_file=source_dir/'render.mp4';render_file.write_bytes(path.read_bytes());render_file.with_suffix('.camera.json').write_text('{}')
    for kind in ['depth','normal','pose']:(source_dir/('render_'+kind+'.mp4')).write_bytes(path.read_bytes())
    motion={'scene':{'actors':[{'actor':1}]},'actors':[{}]}
    camera={'settings':{'camera_index':0}}
    with patch.object(nodes,'editor_motion',AsyncMock(return_value=(motion,{},None))), \
         patch.object(nodes,'make_editor_camera',return_value=(camera,None)), patch.object(nodes,'attach_render',return_value={}),patch.object(nodes,'save_job',return_value={'id':'offline'}),patch.object(nodes,'image_tensor',return_value=image), \
         patch.object(nodes.bridge,'render',AsyncMock(return_value=source_dir/'render.mp4')), \
         patch.object(nodes.PromptServer,'instance',SimpleNamespace(),create=True):
        for use_frames in [False,True]:
            camera_result=await nodes.CartwheelCameraPreview.execute(capture,render_view='offline',auto_frame_images=use_frames)
            assert camera_result[9] is use_frames
    assert type(camera_result[0]) is InputImpl.VideoFromFile
    assert not hasattr(camera_result[0],'cartwheel_source_video')
    input_ids=[item.id for item in nodes.CartwheelPrepareVideoReferences.define_schema().inputs]
    assert 'source_video' not in input_ids
    assert all(name in input_ids for name in ['control_video','reference_image','secondary_video','reference_audio'])
    from comfy_extras.nodes_video import SaveVideo
    assert validate_node_input(nodes.CartwheelCameraPreview.define_schema().outputs[0].io_type,
        SaveVideo.define_schema().inputs[0].io_type)

    result=nodes.CartwheelPrepareVideoReferences.execute(source,model='MiniMax H3',reference_audio=explicit_audio,
        reference_duration=14,output_duration=14,reference_image=image,prompt=' ')
    assert torch.equal(result[1],image) and result[3]==nodes.DEFAULT_PROMPT and result[4]==14 and result[5]=='adaptive'
    assert result[0].get_duration()==14
    assert result[2]['sample_rate']==48000 and result[2]['waveform'].shape[0]==1
    assert 13.98<=result[2]['waveform'].shape[-1]/48000<=14.03
    assert path.read_bytes()==original_bytes,'Trimming changed the source file.'
    trimmed=VideoSlice.execute(source,start_time=2,duration=10,strict_duration=True)[0]
    assert trimmed.get_duration()==10
    seedance=nodes.CartwheelPrepareVideoReferences.execute(source,reference_duration=19.4)
    assert seedance[4]==20 and isinstance(seedance[1],ExecutionBlocker)
    assert json.loads(seedance[6])['ratio']=='adaptive'
    # Exercise actual H3 input validation with a longer reference than requested output.
    model={'model':'MiniMax H3','prompt':result[3],'resolution':'768P','ratio':'adaptive','duration':8,
           'reference_images':{'image_1':image},'reference_videos':{'video_1':result[0]},'reference_audios':{'audio_1':result[2]}}
    fake_url='https://example.com/test-only'
    with patch.object(h3,'upload_images_to_comfyapi',AsyncMock(return_value=[fake_url])), \
         patch.object(h3,'upload_video_to_comfyapi',AsyncMock(return_value=fake_url)), \
         patch.object(h3,'upload_audio_to_comfyapi',AsyncMock(return_value=fake_url)), \
         patch.object(h3,'_hailuo03_run_task',AsyncMock(return_value='mock-video')) as task:
        assert await h3.MinimaxHailuo03ReferenceNode.execute(model,42,False)=='mock-video'
        assert task.call_args.kwargs['duration']==8
        assert task.call_args.kwargs['ratio']=='adaptive'
    silent=base/'silent.mp4';make_video(silent,frames=120,audio=False)
    no_audio=nodes.CartwheelPrepareVideoReferences.execute(InputImpl.VideoFromFile(str(silent)),reference_image=image)
    assert isinstance(no_audio[2],ExecutionBlocker)
    for loader in [nodes.CartwheelLoadHistory,nodes.CartwheelLoadCapture]:
        assert [o.id for o in loader.define_schema().outputs]==['capture','source_video','source_info','source_fps','source_frames','source_duration','motion','camera']
    assert validate_node_input(nodes.CartwheelPrepareVideoReferences.define_schema().outputs[5].io_type, 'COMBO')
    import nodes as registry
    from comfy_extras.nodes_video import SaveVideo
    from comfy_api_nodes.nodes_bytedance import ByteDance2ReferenceNodeV2
    from execution import validate_prompt
    from comfy_extras.nodes_logic import SwitchNode
    classes=[SwitchNode,nodes.CartwheelLoadHistory,nodes.CartwheelCameraPreview,nodes.CartwheelPrepareVideoReferences,SaveVideo,ByteDance2ReferenceNodeV2,h3.MinimaxHailuo03ReferenceNode]
    for cls in classes:registry.NODE_CLASS_MAPPINGS[cls.define_schema().node_id]=cls
    for name in ['seedance','h3','model-switch']:
        graph=json.loads((package_root/'examples'/f'history-{name}-references-api.json').read_text())
        valid,error,_,details=await validate_prompt('offline-reference-test',graph,None)
        assert valid and not details,(error,details)
    # Native switch requests only the chosen branch; the preparation signal is its sole selector.
    for value,selected_branch in [(False,'on_false'),(True,'on_true')]:
        assert SwitchNode.check_lazy_status(value,on_false=None,on_true=None)==[selected_branch]
        assert SwitchNode.execute(value,on_false='seedance',on_true='h3')[0]==('h3' if value else 'seedance')
    # Run the real executor with native lazy switching and mocked generation methods.
    # This proves that a single preparation selector does not execute both providers.
    from execution import PromptExecutor
    class Fixture(io.ComfyNode):
        @classmethod
        def define_schema(cls):
            return io.Schema(node_id='ReferenceFixture',inputs=[],outputs=[io.Video.Output('video')])
        @classmethod
        def execute(cls):
            return io.NodeOutput(context)
    registry.NODE_CLASS_MAPPINGS['ReferenceFixture']=Fixture
    calls=[]
    async def fake_seedance(cls, model, seed, watermark):
        calls.append('Seedance 2.5')
        return io.NodeOutput(model['reference_videos']['video_1'],'offline-task')
    async def fake_h3(cls, model, seed, watermark):
        calls.append('MiniMax H3')
        return io.NodeOutput(model['reference_videos']['video_1'])
    server=SimpleNamespace(client_id=None,last_node_id=None,send_sync=lambda *a,**kw:None)
    for family in ['Seedance 2.5','MiniMax H3']:
        graph=json.loads((package_root/'examples'/'history-model-switch-references-api.json').read_text())
        graph.pop('1');graph.pop('2')
        graph['20']={'class_type':'ReferenceFixture','inputs':{}}
        graph['3']['inputs']['control_video']=['20',0]
        graph['3']['inputs']['model']=family
        valid,error,outputs,details=await validate_prompt('offline-route-test',graph,None)
        assert valid and not details,(error,details)
        with patch.object(ByteDance2ReferenceNodeV2,'execute',classmethod(fake_seedance)), \
             patch.object(h3.MinimaxHailuo03ReferenceNode,'execute',classmethod(fake_h3)):
            executor=PromptExecutor(server,cache_args={'ram':0,'ram_inactive':0})
            await executor.execute_async(graph,'offline-route-'+family,execute_outputs=outputs)
            assert executor.success,executor.status_messages
        assert calls==[family],calls
        calls.clear()
    print('Actual ComfyUI executor: Seedance selection ran only Seedance; H3 selection ran only H3. Provider execution was mocked, and the resulting bounded VIDEO was saved locally.')
    print('Camera-only VIDEO, explicit optional image/video/audio, ignored original-source metadata, 45→30/15 caps, reference windows, shared budget, and native model routing passed.')
    print('The installed H3 API node accepts a 14-second reference with 8-second output in local validation. Uploads and generation were mocked; provider acceptance is untested.')

try:asyncio.run(check())
finally:temporary.cleanup()
