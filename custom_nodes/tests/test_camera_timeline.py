import copy
import importlib
import json
import sys
import types
import unittest
from pathlib import Path
package=types.ModuleType('cartwheel_timeline_tests');package.__path__=[str(Path(__file__).resolve().parents[1])];sys.modules[package.__name__]=package
camera=importlib.import_module(package.__name__+'.camera')

class TimelineTests(unittest.TestCase):
    def setUp(self):
        self.recipe=camera.DEFAULT_SETTINGS|{'mode':'bookends','world_frame_id':'world','start':{'position':[0,2,5],'target':[0,1,0],'fov':45},'end':{'position':[4,2,5],'target':[0,1,0],'fov':45},'manual_path':{'kind':'line','aim':'blend','pacing':'linear'}}
        self.timeline={'schema_version':1,'fps':24,'duration':10,'world_frame_id':'world','selected_id':'camera-2','next_id':3,'segments':[{'id':'camera-1','name':'Camera 1','start':0,'end':5,'source_start':0,'source_end':5,'settings':copy.deepcopy(self.recipe)},{'id':'camera-2','name':'Camera 2','start':5,'end':10,'source_start':5,'source_end':10,'settings':copy.deepcopy(self.recipe)}],'joins':[{'left':'camera-1','right':'camera-2','connected':True,'smooth':True,'frames':10,'point':[2,2,5],'preserve':True}]}
        self.settings=self.recipe|{'camera_timeline':self.timeline}
    def clean(self,value=None):return camera.camera_settings(value or self.settings,[1,2],1,'world',10)
    def test_default_blend_is_thirty_frames_and_saved_values_are_preserved(self):
        self.assertEqual(self.clean()['camera_timeline']['joins'][0]['frames'],10)
        del self.timeline['joins'][0]['frames']
        self.assertEqual(self.clean()['camera_timeline']['joins'][0]['frames'],30)
    def test_roundtrip_and_no_mutation(self):
        before=copy.deepcopy(self.settings);clean=self.clean();self.assertEqual(clean['camera_timeline']['segments'][1]['source_start'],5);self.assertEqual(self.clean(json.dumps(clean)),clean);self.assertEqual(before,self.settings)
    def test_gaps_one_frame_static_and_zero_blend(self):
        self.timeline['segments'][0]['start']=1;self.timeline['segments'][0]['end']=1+1/24;self.timeline['segments'][1]['start']=8;self.timeline['joins'][0]['frames']=0
        self.assertEqual(len(self.clean()['camera_timeline']['segments']),2)
    def test_reject_invalid_sequences(self):
        cases=[]
        def case(fn):
            v=copy.deepcopy(self.settings);fn(v['camera_timeline']);cases.append(v)
        case(lambda t:t.update(schema_version=2));case(lambda t:t.update(fps=0));case(lambda t:t.update(fps=True));case(lambda t:t.update(duration=8));case(lambda t:t.update(world_frame_id='other'));case(lambda t:t.update(selected_id='missing'));case(lambda t:t.update(next_id=2.5));case(lambda t:t.update(segments=[]));case(lambda t:t.update(segments=t['segments']*40))
        case(lambda t:t['segments'][1].update(id='camera-1'));case(lambda t:t['segments'][1].update(start=4));case(lambda t:t['segments'][0].update(end=.001));case(lambda t:t['segments'][0].update(start=.123));case(lambda t:t['segments'][0].update(end=float('nan')));case(lambda t:t['segments'][0].update(source_end=0));case(lambda t:t['segments'][0].update(source_start=-1));case(lambda t:t['segments'][0].update(offset_start=[0,0]));case(lambda t:t['segments'][0].update(offset_end=[0,0,float('inf')]));case(lambda t:t['segments'][0]['settings'].update(camera_timeline={}))
        case(lambda t:t['joins'][0].update(right='camera-1'));case(lambda t:t['joins'][0].update(frames=1.5));case(lambda t:t['joins'][0].update(frames=601));case(lambda t:t['joins'][0].update(connected=False));case(lambda t:t['joins'][0].update(smooth='yes'));case(lambda t:t['joins'][0].update(point=[1,2]));case(lambda t:t.update(joins=t['joins']*2))
        for i,value in enumerate(cases):
            with self.subTest(case=i),self.assertRaises(ValueError):self.clean(value)
    def test_independent_hold_edges_roundtrip(self):
        a,b=self.timeline['segments'];a.update(end=3,ease_end=False,ease_end_frames=25);b.update(start=7,ease_start=True,ease_start_frames=12)
        clean=self.clean()['camera_timeline'];self.assertFalse(clean['segments'][0]['ease_end']);self.assertEqual(clean['segments'][1]['ease_start_frames'],12)
        self.assertEqual(self.clean(json.dumps(self.clean())),self.clean())
        for invalid in (-1,601,2.5,True,'25',float('nan')):
            with self.subTest(invalid=invalid),self.assertRaises(ValueError):
                b['ease_start_frames']=invalid;self.clean()
    def test_capture_switch_resets_entire_sequence(self):
        motion={'world_frame':{'id':'new','units':'meters','up':'Y','handedness':'right'},'timeline':{'duration':10},'actors':[{'id':1},{'id':2}],'scene':{'camera':{'cameras':[{}]}}}
        result,notice=camera.make_editor_camera(motion,self.settings);self.assertEqual(result['settings']['mode'],'captured');self.assertNotIn('camera_timeline',result['settings']);self.assertTrue(notice)
    def test_legacy_unchanged(self):
        self.assertNotIn('camera_timeline',self.clean(self.recipe));self.assertEqual(self.clean(camera.DEFAULT_SETTINGS)['mode'],'captured')

if __name__=='__main__':unittest.main()
