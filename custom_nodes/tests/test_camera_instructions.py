import copy
import importlib
import json
import math
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch
pkg=types.ModuleType('camera_instruction_test');pkg.__path__=[str(Path(__file__).resolve().parents[1])];sys.modules[pkg.__name__]=pkg
mod=importlib.import_module(pkg.__name__+'.camera_instructions')


def frame(time,x=0):return {'time':time,'position':[x,2,5],'quaternion':[0,0,0,1],'fov':45}
def response():return {'schema_version':1,'summary':'An authored camera','blocks':[{'start':0,'end':2,'frames':[frame(0),frame(1,1),frame(2,2)]}]}

class CameraInstructionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        importlib.import_module(pkg.__name__+'.instruction_budget').tokenizer()
    def test_dense_and_sparse_paths_keep_model_poses(self):
        original=response();clean=mod.camera_response(json.dumps(original),0,2,24);self.assertEqual(clean['blocks'][0]['frames'][1]['position'],[1,2,5]);self.assertEqual(original,response())
        clean=mod.camera_response('```json\n'+json.dumps(original)+'\n```',0,2,24);self.assertEqual(len(clean['blocks']),1)
    def test_multiple_cameras_continuous_or_cut(self):
        v=response();v['blocks']=[{'start':0,'end':1,'frames':[frame(0),frame(1,1)]},{'start':1,'end':2,'frames':[frame(1,1),frame(2,2)]}]
        self.assertEqual(len(mod.camera_response(json.dumps(v),0,2,24)['blocks']),2)
        v['blocks'][1]['frames'][0]['position']=[10,2,5]
        with self.assertRaises(ValueError):mod.camera_response(json.dumps(v),0,2,24)
        v['blocks'][1]['transition']='cut';self.assertEqual(mod.camera_response(json.dumps(v),0,2,24)['blocks'][1]['transition'],'cut')
        with self.assertRaises(ValueError):mod.camera_response(json.dumps(v),0,2,24,True)
    def test_bad_responses_never_execute_or_expand_scope(self):
        values=['', 'print(1)', '{}','[1]',json.dumps({'schema_version':1,'blocks':[]})]
        changes=[lambda v:v['blocks'][0].update(start=.1),lambda v:v['blocks'][0].update(end=3),lambda v:v['blocks'][0].update(end=1.5),lambda v:v['blocks'][0].update(transition='eval'),lambda v:v['blocks'][0].update(continue_previous='true'),lambda v:v['blocks'][0].update(frames=[]),lambda v:v['blocks'][0]['frames'][0].update(time=.1),lambda v:v['blocks'][0]['frames'][1].update(time=0),lambda v:v['blocks'][0]['frames'][1].update(position=[0,1]),lambda v:v['blocks'][0]['frames'][1].update(position=[float('nan'),1,2]),lambda v:v['blocks'][0]['frames'][1].update(quaternion=[0,0,0,0]),lambda v:v['blocks'][0]['frames'][1].update(fov=181),lambda v:v['blocks'][0]['frames'][1].update(lens_projection='code')]
        for change in changes:
            v=response();change(v);values.append(json.dumps(v))
        for value in values:
            with self.subTest(value=value[:90]),self.assertRaises(ValueError):mod.camera_response(value,0,2,24)
    def test_position_interpolation_is_explicit_and_validated(self):
        v=response();self.assertEqual(mod.camera_response(json.dumps(v),0,2,24)['blocks'][0]['position_interpolation'],'linear')
        v['blocks'][0]['position_interpolation']='cubic';self.assertEqual(mod.camera_response(json.dumps(v),0,2,24)['blocks'][0]['position_interpolation'],'cubic')
        for invalid in ['eval',None,[],{},42]:
            v['blocks'][0]['position_interpolation']=invalid
            with self.subTest(invalid=invalid),self.assertRaises(ValueError):mod.camera_response(json.dumps(v),0,2,24)
    def test_quaternion_sign_and_scale_are_normalized(self):
        v=response();v['blocks'][0]['frames'][1]['quaternion']=[0,0,0,-2];clean=mod.camera_response(json.dumps(v),0,2,24);self.assertEqual(clean['blocks'][0]['frames'][1]['quaternion'],[0,0,0,1])
    def test_exact_fractional_and_one_frame_ranges(self):
        for end in [.01,1/24,7.967]:
            v={'schema_version':1,'blocks':[{'start':0,'end':end,'frames':[frame(0),frame(end)]}]};self.assertEqual(mod.camera_response(json.dumps(v),0,end,24)['blocks'][-1]['end'],end)
    def request(self,provider='openai',model='gpt-6-sol'):
        return {'protocol_version':2,'request_id':'test-request','model':provider+':'+model,'system_prompt':'SYSTEM ONLY','user_prompt':'USER ONLY','context':{'schema_version':2,'format':'compact_world_tracks','duration':2,'fps':24,'units':'millimeters','position_tolerance_mm':10,'actors':[{'id':1,'joints':[]}],'allowed_ranges':[{'start':0,'end':2,'ids':['camera-1']}],'keep_blocks':False}}
    def catalog(self,provider='openai',model='gpt-6-sol',node='OpenAIChatNode'):
        return [{'id':provider+':'+model,'provider':provider,'model':model,'node':node}]
    def test_graph_uses_native_auth_and_one_bounded_model(self):
        module=types.SimpleNamespace(SUPPORTED_REASONING_EFFORTS={'gpt-6-sol':('none','low','medium')})
        with patch.object(mod.importlib,'import_module',return_value=module):g=mod.request_graph(self.request(),self.catalog())
        config=next(v for v in g.values() if v['class_type']=='OpenAIChatConfig');model=next(v for v in g.values() if v['class_type']=='OpenAIChatNode')
        self.assertEqual(config['inputs']['instructions'],'SYSTEM ONLY');self.assertNotIn('SYSTEM ONLY',model['inputs']['prompt']);self.assertIn('USER ONLY',model['inputs']['prompt']);self.assertEqual(config['inputs']['truncation'],'disabled');self.assertLessEqual(config['inputs']['max_output_tokens'],8192);self.assertEqual(config['inputs']['reasoning_effort'],'low')
        self.assertEqual(sum(n['class_type']=='OpenAIChatNode' for n in g.values()),1)
        self.assertFalse(any('key' in k or 'auth' in k for n in g.values() for k in n['inputs']))
    def test_request_validation_and_retired_format(self):
        for key,value in [('protocol_version',1),('request_id','../escape'),('model','unknown'),('system_prompt',''),('user_prompt',''),('context',None),('context',{'requested_range':[0,2],'fps':24,'motion_frames':[]})]:
            v=self.request();v[key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):mod.request_graph(v,self.catalog())
        for update in [{'fps':float('inf')},{'duration':-1},{'allowed_ranges':[{'start':1,'end':0,'ids':['a']}]},{'motion_frames':[]},{'units':'meters'}]:
            v=self.request();v['context'].update(update)
            with self.subTest(update=update),self.assertRaises(ValueError):mod.request_graph(v,self.catalog())
    def test_anthropic_gemini_system_role_and_output_limit(self):
        module=types.SimpleNamespace(_NO_TEMPERATURE_MODELS={'Opus 5.5'},_THINKING_UNSUPPORTED=set())
        with patch.object(mod.importlib,'import_module',return_value=module):
            for provider,model,node in [('anthropic','Opus 5.5','ClaudeNode'),('gemini','Gemini 3.8 Flash','GeminiNodeV3')]:
                g=mod.request_graph(self.request(provider,model),self.catalog(provider,model,node));inputs=next(n['inputs'] for n in g.values() if n['class_type']==node)
                self.assertEqual(inputs.get('system_prompt',inputs.get('model.system_prompt')),'SYSTEM ONLY');self.assertNotIn('model.temperature',inputs);self.assertLessEqual(inputs.get('model.max_tokens',inputs.get('model.max_output_tokens')),8192)
    def test_expensive_models_build_one_bounded_graph_without_dollar_cap(self):
        module=types.SimpleNamespace(SUPPORTED_REASONING_EFFORTS={'gpt-6-astra':('low','medium')})
        with patch.object(mod.importlib,'import_module',return_value=module):
            result=mod.prepared_request(self.request('openai','gpt-6-astra'),self.catalog('openai','gpt-6-astra'))
        self.assertIsNone(result['review']['budget_usd']);self.assertGreater(result['review']['estimated_ceiling_usd'],.5)
        self.assertEqual(sum(n['class_type']=='OpenAIChatNode' for n in result['graph'].values()),1)
        config=next(n for n in result['graph'].values() if n['class_type']=='OpenAIChatConfig');self.assertEqual(config['inputs']['max_output_tokens'],8192)
    def test_nonadjacent_scope_and_whole_clip_coverage(self):
        ranges=[{'start':0,'end':1,'ids':['one']},{'start':2,'end':3,'ids':['three']}]
        value={'schema_version':1,'blocks':[{'start':0,'end':1,'frames':[frame(0),frame(1)]},{'start':2,'end':3,'frames':[frame(2),frame(3)]}]}
        result=mod.scoped_camera_response(json.dumps(value),ranges,24,True);self.assertEqual(len(result['groups']),2);self.assertEqual(result['groups'][1]['range']['ids'],['three'])
        value['blocks'].insert(1,{'start':1,'end':2,'frames':[frame(1),frame(2)]})
        with self.assertRaises(ValueError):mod.scoped_camera_response(json.dumps(value),ranges,24)
        with self.assertRaises(ValueError):mod.scoped_camera_response(json.dumps(response()),[{'start':0,'end':3,'ids':['a']}],24)
    def test_system_prompt_explicitly_allows_direct_animation(self):
        self.assertIn('ONE continuous camera block',mod.SYSTEM_PROMPT);self.assertIn('preserve aspects the user did not ask to change',mod.SYSTEM_PROMPT);self.assertIn('timeline settings require preserving multiple existing blocks',mod.SYSTEM_PROMPT);self.assertIn('NOT limited',mod.SYSTEM_PROMPT);self.assertIn('WORLD-space',mod.SYSTEM_PROMPT);self.assertIn('no automatic tracker',mod.SYSTEM_PROMPT);self.assertIn('position_interpolation="cubic"',mod.SYSTEM_PROMPT)

if __name__=='__main__':unittest.main()
