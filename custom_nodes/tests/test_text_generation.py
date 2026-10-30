import copy
import importlib
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import types
import unittest

from motion_fixture import animated_glb

root = Path(__file__).resolve().parents[1]
package = types.ModuleType('cw_text_tests'); package.__path__ = [str(root)]; sys.modules[package.__name__] = package
text = importlib.import_module(package.__name__ + '.text_generation')
config = importlib.import_module(package.__name__ + '.config')
motion_io = importlib.import_module(package.__name__ + '.motion_io')
OPTIONS = {'batchName':'Test motion','prompts':['Four people dancing together'], 'requestedModel':'swing_choreo',
           'swingChoreoProperties':{'duration':8},'loop':False,
           'exportSettings':{'characterID':'char-upload-MHR','exportType':'glb','frameRate':60.0,'includeMesh':True,
                             'keyframeCleaning':'none','forward':'-Z','up':'Y','frameStepSize':1,'moveInPlace':False}}

class FakeClient:
    connection = config.Connection('synthetic-test-secret')
    def __init__(self, actors=4):
        self.submissions=0;self.calls=[];self.status='COMPLETED';self.lose_ack=False;self.fail_download=False;self.corrupt=False
        self.ready=True;self.actors=actors
    async def api(self,method,route,*,body=None,params=None):
        self.calls.append((method,route,copy.deepcopy(body)))
        if method=='POST':
            assert route=='/motion/fromText'
            self.submissions+=1
            if self.lose_ack:raise text.CartwheelError('Synthetic lost acknowledgement')
            return {'batchID':f'batch-{self.submissions}'}
        return {'status':self.status}
    async def pages(self,route,field):
        return [{'jobID':'motion-one','status':'COMPLETED','exportURLs':[f'https://assets.example/actor-{i}.glb' if self.ready else None for i in range(self.actors)]}]
    async def download(self,url,target,check_interrupt):
        check_interrupt()
        if self.fail_download:self.fail_download=False;raise text.CartwheelError('Synthetic download failure')
        target.write_bytes(b'Not a GLB' if self.corrupt else animated_glb(x=int(url.rsplit('-',1)[1].split('.')[0]),duration=8))

class GenerationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp=TemporaryDirectory();self.root=Path(self.tmp.name);self.client=FakeClient()
    async def asyncTearDown(self):self.tmp.cleanup()
    async def run_job(self,**kw):
        async def progress(value):pass
        return await text.generate_motion(self.client,OPTIONS,self.root/'state',self.root/'output',lambda:None,progress,poll_seconds=0,**kw)
    async def test_unnamed_text_request_resumes_without_adding_a_batch_label(self):
        options={k:v for k,v in OPTIONS.items() if k!='batchName'}
        async def progress(value):pass
        async def run():return await text.generate_motion(self.client,options,self.root/'state',self.root/'output',lambda:None,progress,poll_seconds=0,wait_seconds=0)
        self.client.status='GENERATING'
        with self.assertRaises(text.CartwheelError):await run()
        self.client.status='COMPLETED';result=await run()
        self.assertEqual(self.client.submissions,1)
        self.assertNotIn('batchName',self.client.calls[0][2])
        self.assertNotIn('batchName',result['generation_options'])
        self.assertEqual(result['title'],options['prompts'][0])

    async def test_no_capture_upload_or_camera_requirement_and_all_four_glbs_remain_aligned(self):
        result=await self.run_job()
        exports=[Path(result['motions'][0]['assets'][f'export_{i}']) for i in range(4)]
        motion=motion_io.import_motion(exports,None,self.root/'output')
        self.assertEqual([a['id'] for a in motion['actors']],[1,2,3,4]);self.assertEqual(motion['timeline']['duration'],8)
        self.assertEqual(motion['scene']['camera']['format'],'default')
        self.assertEqual(self.client.calls[0],('POST','/motion/fromText',OPTIONS))
        self.assertEqual(self.client.submissions,1)
        self.assertNotIn('synthetic-test-secret',json.dumps(result));self.assertNotIn('https://',json.dumps(result))
        self.assertEqual(json.loads((exports[0].parent/'capture.json').read_text()),result)
    async def test_poll_timeout_resumes_acknowledged_batch(self):
        self.client.status='GENERATING'
        with self.assertRaisesRegex(text.CartwheelError,'resume the existing'):await self.run_job(wait_seconds=0)
        self.client.status='COMPLETED';await self.run_job();self.assertEqual(self.client.submissions,1)
    async def test_delayed_exports_resume_without_optional_preview_or_native_files(self):
        self.client.ready=False
        with self.assertRaisesRegex(text.CartwheelError,'GLB exports'):await self.run_job(wait_seconds=0)
        self.client.ready=True;await self.run_job();self.assertEqual(self.client.submissions,1)
    async def test_unknown_submission_never_automatically_retries(self):
        self.client.lose_ack=True
        with self.assertRaisesRegex(text.CartwheelError,'lost acknowledgement'):await self.run_job()
        self.client.lose_ack=False
        with self.assertRaisesRegex(text.CartwheelError,'unknown outcome'):await self.run_job()
        self.assertEqual(self.client.submissions,1)
    async def test_download_failure_resumes_existing_job(self):
        self.client.fail_download=True
        with self.assertRaisesRegex(text.CartwheelError,'download failure'):await self.run_job()
        await self.run_job();self.assertEqual(self.client.submissions,1)
    async def test_invalid_glb_is_removed_for_retry_without_resubmission(self):
        self.client.corrupt=True
        with self.assertRaisesRegex(text.CartwheelError,'GLB'):await self.run_job()
        self.assertFalse(list((self.root/'output').rglob('*.glb')))
        self.client.corrupt=False;await self.run_job();self.assertEqual(self.client.submissions,1)
    async def test_new_execution_after_success_starts_new_job_with_separate_assets(self):
        first=await self.run_job();second=await self.run_job()
        self.assertEqual(self.client.submissions,2);self.assertNotEqual(first['batch_id'],second['batch_id'])
        self.assertNotEqual(first['motions'][0]['assets']['export_0'],second['motions'][0]['assets']['export_0'])
    async def test_one_actor_is_supported(self):
        self.client.actors=1;result=await self.run_job()
        self.assertEqual(len([x for x in result['motions'][0]['assets'] if x.startswith('export_')]),1)
    async def test_cancellation_leaves_acknowledged_job_resumable(self):
        cancelled=False
        original_api=self.client.api
        async def api(method,route,**kwargs):
            nonlocal cancelled
            result=await original_api(method,route,**kwargs)
            if method=='GET':cancelled=True
            return result
        self.client.api=api
        def check_interrupt():
            if cancelled:raise InterruptedError('Synthetic user cancellation')
        async def progress(value):pass
        with self.assertRaises(InterruptedError):
            await text.generate_motion(self.client,OPTIONS,self.root/'state',self.root/'output',check_interrupt,progress,poll_seconds=0)
        self.client.api=original_api
        await self.run_job();self.assertEqual(self.client.submissions,1)

if __name__=='__main__':unittest.main()
