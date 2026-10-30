import copy
import importlib
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import types
import unittest

from motion_fixture import animated_glb
from test_scene import binary_fbx

package=types.ModuleType('generic_motion_tests');package.__path__=[str(Path(__file__).resolve().parents[1])];sys.modules[package.__name__]=package
motion_io=importlib.import_module(package.__name__+'.motion_io')
camera=importlib.import_module(package.__name__+'.camera')
routes=importlib.import_module(package.__name__+'.camera_routes')


class MotionInputTests(unittest.TestCase):
    def setUp(self):
        self.temporary=TemporaryDirectory();self.root=Path(self.temporary.name);self.output=self.root/'output';self.output.mkdir()
        self.actor=self.root/'independent.glb';self.actor.write_bytes(animated_glb())
        self.document={'schema_version':1,'units':'meters','up':'Y','aspect':16/9,
            'frames':[{'time':0,'position':[0,1,4],'target':[0,1,0],'fov':40},{'time':2,'position':[1,1,4],'target':[0,1,0],'fov':40}]}

    def tearDown(self):self.temporary.cleanup()

    def test_animated_glb_without_camera_restores_and_edits_without_an_account(self):
        original=self.actor.read_bytes()
        result=motion_io.import_motion([self.actor],None,self.output)
        self.assertEqual(result['timeline']['duration'],2)
        self.assertEqual(result['scene']['camera']['format'],'default')
        self.assertEqual(result['scene']['material_policy'],'preserve')
        self.assertNotIn('capture',result)
        self.assertEqual(motion_io.validate_motion(result,self.output),result)
        self.assertEqual(routes.restore_editor_scene(self.output,result['scene']),result)
        settings=camera.DEFAULT_SETTINGS|{'mode':'preset','world_frame_id':result['world_frame']['id'],'preset':{'actors':[1],'shot':'full','behavior':'static'}}
        self.assertEqual(camera.make_camera(result,settings)['settings']['mode'],'preset')
        self.assertEqual(self.actor.read_bytes(),original)
        self.assertEqual(motion_io.import_motion([self.actor],None,self.output),result)

    def test_four_actors_and_optional_json_or_fbx_camera(self):
        second=self.root/'second.glb';second.write_bytes(animated_glb(x=3))
        camera_path=self.root/'camera.json';camera_path.write_text(json.dumps(self.document))
        result=motion_io.import_motion([self.actor,second,self.actor,second],camera_path,self.output)
        self.assertEqual([a['id'] for a in result['actors']],[1,2,3,4])
        self.assertEqual(result['scene']['camera']['format'],'camera_json')
        output=motion_io.camera_from_motion(result)
        self.assertEqual(output['source']['frames'][1]['position'],[1,1,4])
        self.assertEqual(motion_io.with_camera_input(result,output,self.output)['scene']['camera']['format'],'camera_json')
        fbx=self.root/'camera.fbx';fbx.write_bytes(binary_fbx(duration=2))
        loaded=motion_io.import_motion([self.actor],fbx,self.output)
        self.assertEqual(loaded['scene']['camera']['format'],'fbx')

    def test_independent_camera_input_and_manifest_remain_local(self):
        base=motion_io.import_motion([self.actor],None,self.output)
        path=self.root/'camera.json';path.write_text(json.dumps(self.document))
        source=motion_io.import_motion([self.actor],path,self.output)
        result=motion_io.with_camera_input(base,motion_io.camera_from_motion(source),self.output)
        self.assertIn('camera_transfer',result['scene'])
        self.assertEqual(routes.restore_editor_scene(self.output,result['scene']),result)
        changed=copy.deepcopy(result);changed['scene']['actors'][0]['filename']='../../outside.glb'
        with self.assertRaises(ValueError):motion_io.validate_motion(changed,self.output)
        changed=copy.deepcopy(result);changed['scene']['motion_manifest']={'filename':'motion.json','subfolder':'../elsewhere','type':'output'}
        with self.assertRaises(ValueError):routes.restore_editor_scene(self.output,changed['scene'])

    def test_wrong_formats_invalid_camera_timing_and_external_assets_reject(self):
        for frames in [[],[{'time':1,'position':[0,1,4],'target':[0,1,0]}],
                       [{'time':0,'position':[0,1,0],'target':[0,1,0]}],
                       [{'time':0,'position':[0,float('nan'),4],'target':[0,1,0]}]]:
            with self.subTest(frames=frames),self.assertRaises(ValueError):motion_io.camera_document(self.document|{'frames':frames})
        with self.assertRaises(ValueError):motion_io.camera_document(self.document|{'units':'centimeters'})
        for paths in [[],[self.actor]*5]:
            with self.assertRaises(ValueError):motion_io.import_motion(paths,None,self.output)
        wrong=self.root/'actor.fbx';wrong.write_bytes(binary_fbx(duration=2))
        with self.assertRaisesRegex(ValueError,'animated mesh'):motion_io.import_motion([wrong],None,self.output)
        static=self.root/'static.glb';static.write_bytes(animated_glb(duration=0))
        with self.assertRaises(ValueError):motion_io.import_motion([static],None,self.output)
