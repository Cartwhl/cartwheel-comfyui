import copy
import importlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import sys
import types
import unittest

from test_scene import binary_fbx

package = types.ModuleType('cartwheel_camera_tests')
package.__path__ = [str(Path(__file__).resolve().parents[1])]
sys.modules[package.__name__] = package
camera = importlib.import_module(f'{package.__name__}.camera')
routes = importlib.import_module(f'{package.__name__}.camera_routes')


class CameraTests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.directory = self.root/'cartwheel'/'scene'
        self.directory.mkdir(parents=True)
        actor, view = self.directory/'actor.fbx', self.directory/'camera.fbx'
        actor.write_bytes(binary_fbx(duration=2))
        view.write_bytes(binary_fbx(duration=2.1))
        self.capture = {'schema_version':1,'motions':[{'job_id':'motion-test','assets':{'mhr_0':str(actor),'mhr_2':str(actor),'camera':str(view),'export_0':str(actor)}}]}
        self.motion = camera.motion_from_capture(self.capture, self.root)
        self.settings = camera.DEFAULT_SETTINGS | {'mode':'bookends','world_frame_id':self.motion['world_frame']['id'],'target_actor':3,
            'start':{'position':[0,2,5],'target':[0,1,0],'fov':45},'end':{'position':[2,2,5],'target':[0,1,0],'fov':60}}
    def tearDown(self): self.temporary.cleanup()

    def test_inline_camera_history_mode_validates_and_round_trips(self):
        selected = {'motion_id':'existing-motion', 'source_actor':1, 'reference_actor':3, 'timing':'hold'}
        registered = camera.with_camera_source(self.motion, self.motion, 1, 3, 'hold')
        settings = camera.DEFAULT_SETTINGS | {'mode':'history','history_camera':selected,'world_frame_id':'old'}
        view, notice = camera.make_editor_camera(registered, settings)
        self.assertIsNone(notice)
        self.assertEqual(view['settings']['mode'],'history')
        self.assertEqual(view['settings']['history_camera'],selected)
        self.assertIsNone(view['settings']['preset'])
        self.assertEqual(camera.validate_render_camera(registered,json.loads(json.dumps(view))),view)
        selected['reference_actor']=1
        self.assertEqual(view['settings']['history_camera']['reference_actor'],3)
        with self.assertRaisesRegex(ValueError,'Load the selected'):
            camera.make_camera(self.motion,settings)
        for invalid in [None,{}, {'motion_id':'https://example.com'}, {'motion_id':'test','source_actor':True},
                        {'motion_id':'test','reference_actor':4}, {'motion_id':'test','timing':[]}]:
            with self.subTest(invalid=invalid),self.assertRaises(ValueError):
                camera.history_camera_settings(invalid,[1,3])
        captured=camera.make_camera(self.motion,camera.DEFAULT_SETTINGS | {'history_camera':selected})
        self.assertIsNone(captured['settings']['history_camera'])

    def test_camera_source_registration_contract_and_local_restore(self):
        source_dir = self.root/'cartwheel'/'source'
        source_dir.mkdir()
        source_actor, source_camera = source_dir/'actor.fbx', source_dir/'camera.fbx'
        source_actor.write_bytes(binary_fbx(duration=5))
        source_camera.write_bytes(binary_fbx(duration=5))
        capture = {'schema_version':1, 'motions':[{'job_id':'source', 'assets':{
            'mhr_0':str(source_actor), 'camera':str(source_camera)}}]}
        source = camera.motion_from_capture(capture, self.root)
        before = copy.deepcopy(self.motion)
        result = camera.with_camera_source(self.motion, source, 1, 3)
        self.assertEqual(self.motion, before)
        self.assertEqual(result['actors'], self.motion['actors'])
        self.assertEqual(result['timeline'], self.motion['timeline'])
        self.assertNotEqual(result['world_frame'], self.motion['world_frame'])
        self.assertEqual(result['scene']['camera'], source['scene']['camera'])
        self.assertEqual(result['scene']['motion_camera'], self.motion['scene']['camera'])
        transfer = result['scene']['camera_transfer']
        self.assertEqual((transfer['reference_actor'],transfer['source_actor']['actor']), (3,1))
        self.assertEqual((transfer['source_duration'],transfer['target_duration']), (5,2.1))
        self.assertNotIn(str(self.root), json.dumps(result))
        view = camera.make_camera(result, camera.DEFAULT_SETTINGS)
        self.assertEqual(camera.validate_render_camera(result, json.loads(json.dumps(view))), view)
        with self.assertRaisesRegex(ValueError, 'same capture'):
            camera.validate_render_camera(self.motion, view)
        self.assertNotEqual(camera.with_camera_source(self.motion, source, 1, 1)['world_frame'], result['world_frame'])
        self.assertNotEqual(camera.with_camera_source(self.motion, source, 1, 3, 'hold')['world_frame'], result['world_frame'])
        (self.directory/'capture.json').write_text(json.dumps(self.capture))
        (source_dir/'capture.json').write_text(json.dumps(capture))
        self.assertEqual(routes.restore_editor_scene(self.root, result['scene']), result)
        for source_id, target_id, timing in [(2,3,'stretch'),(True,3,'stretch'),(1,4,'stretch'),(1,True,'stretch'),(1,3,'other'),(1,3,[])]:
            with self.subTest(source=source_id,target=target_id,timing=timing),self.assertRaises(ValueError):
                camera.with_camera_source(self.motion, source, source_id,target_id,timing)
        bad = copy.deepcopy(result['scene'])
        bad['camera'] = bad['camera'] | {'filename':'../camera.fbx'}
        with self.assertRaises(ValueError): routes.restore_editor_scene(self.root,bad)

    def test_camera_source_prefers_native_anchor_and_resets_previous_pair_edits(self):
        source = copy.deepcopy(self.motion)
        source['scene']['actors'][0]['native_reference'] = {'filename':'native.fbx','format':'fbx'}
        result = camera.with_camera_source(self.motion, source, 1, 1)
        self.assertEqual(result['scene']['camera_transfer']['source_actor'], {'filename':'native.fbx','format':'fbx','actor':1})
        settings = self.settings | {'mode':'preset','preset':{'actors':[1]}}
        view, notice = camera.make_editor_camera(result, settings)
        self.assertEqual(view['settings']['mode'],'captured')
        self.assertIn('reset', notice)

    def test_manual_curve_contract_round_trip_and_validation(self):
        path = {'kind':'curve', 'controls':[[1,2,5],[2,3,5]], 'pacing':'smooth', 'aim':'fixed'}
        settings = self.settings | {'manual_path':path}
        result = camera.make_camera(self.motion, settings)
        self.assertEqual(camera.validate_render_camera(self.motion, json.loads(json.dumps(result))), result)
        self.assertEqual(result['settings']['manual_path'], path)
        path['controls'][0][0] = 99
        self.assertEqual(result['settings']['manual_path']['controls'][0][0], 1)
        self.assertIsNone(camera.make_camera(self.motion, self.settings)['settings']['manual_path'])
        self.assertIsNone(camera.make_camera(self.motion, settings | {'mode':'captured'})['settings']['manual_path'])
        for bad in [[], {'kind':'unknown'}, {'kind':'curve'}, {'kind':'curve','controls':[[1,2,3]]},
                    {'kind':'curve','controls':[[1,2,True],[1,2,3]]}, {'kind':'line','controls':[[1,2,float('inf')],[1,2,3]]},
                    {'kind':'line','pacing':'fast'}, {'kind':'line','aim':'invalid'}]:
            with self.subTest(path=bad), self.assertRaises(ValueError):
                camera.make_camera(self.motion, self.settings | {'manual_path':bad})

    def test_manual_subject_framing_zoom_priority_and_adjustment_limits(self):
        recipe = {'actors':[1,3],'composition':'group','shot':'cowboy','focus_point':'auto','framing_version':2}
        path = {'kind':'curve','controls':[[1,2,5],[2,3,5]],'aim':'shot','framing_priority':'lens','points':[[1,2,5]]*5}
        value = self.settings | {'preset':recipe,'manual_path':path,'target_actor':None}
        result = camera.make_camera(self.motion,value)
        self.assertEqual(result['settings']['preset']['shot'],'cowboy')
        self.assertEqual(result['settings']['manual_path']['framing_priority'],'reference')
        self.assertEqual(len(result['settings']['manual_path']['points']),5)
        self.assertEqual(camera.validate_render_camera(self.motion,json.loads(json.dumps(result))),result)
        for patch in [{'points':[[1,2,3]]*6},{'points':[[1,2,True]]},{'framing_priority':'bad'}]:
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                camera.make_camera(self.motion,value | {'manual_path':path | patch})
        with self.assertRaisesRegex(ValueError,'subjects'):
            camera.make_camera(self.motion,value | {'preset':None})

    def test_custom_reference_position_contract(self):
        from cartwheel_camera_tests.camera_presets import validate_preset
        recipe={'actors':[1,3],'composition':'group','horizontal':'custom','custom_position':[4,2,-3]}
        settings=self.settings | {'mode':'preset','preset':recipe,'target_actor':None}
        result=camera.make_camera(self.motion,settings)
        self.assertEqual(result['settings']['preset']['custom_position'],[4,2,-3])
        self.assertEqual(camera.validate_render_camera(self.motion,json.loads(json.dumps(result))),result)
        recipe['custom_position'][0]=99
        self.assertEqual(result['settings']['preset']['custom_position'],[4,2,-3])
        for bad in [None,[],[1,2],[1,2,True],[1,2,float('inf')],[1,2,100001]]:
            with self.subTest(bad=bad),self.assertRaises(ValueError):
                validate_preset(recipe | {'custom_position':bad},[1,3],2.1)

    def test_saved_manual_lens_round_trip(self):
        recipe = {'actors':[1], 'composition':'single', 'lens':'natural'}
        path = {'kind':'line','aim':'shot','reference_fov':37.5}
        value = self.settings | {'preset':recipe,'manual_path':path,'target_actor':None}
        result = camera.make_camera(self.motion,value)
        self.assertEqual(result['settings']['manual_path']['reference_fov'],37.5)
        self.assertEqual(camera.validate_render_camera(self.motion,json.loads(json.dumps(result))),result)
        for bad in [True, None, 0, 151, float('nan')]:
            with self.subTest(bad=bad),self.assertRaises(ValueError):
                camera.make_camera(self.motion,value | {'manual_path':path | {'reference_fov':bad}})
        fisheye=value | {'preset':recipe | {'lens':'fisheye'},'manual_path':path | {'reference_fov':160}}
        self.assertEqual(camera.make_camera(self.motion,fisheye)['settings']['manual_path']['reference_fov'],160)

    def test_natural_tracking_contract_and_framing_transition(self):
        from cartwheel_camera_tests.camera_presets import validate_preset
        recipe={'actors':[1], 'tracking_mode':'auto', 'framing_motion':True,
                'framing_start_x':1/3,'framing_start_y':1/3,'framing_end_x':2/3,'framing_end_y':1/3}
        clean=validate_preset(recipe,[1,3],2.1)
        self.assertEqual(clean['tracking_mode'],'auto')
        self.assertEqual(clean['vertical_tracking'],'auto')
        value=camera.make_camera(self.motion,self.settings | {'preset':recipe,'target_actor':None,
                  'manual_path':{'kind':'line','aim':'shot','framing_priority':'reference'}})
        self.assertEqual(camera.validate_render_camera(self.motion,json.loads(json.dumps(value))),value)
        for bad in [{'tracking_mode':'bad'},{'vertical_tracking':'bad'},{'room_horizontal':.9},{'room_vertical':True},
                    {'pan_smoothing':0},{'tilt_smoothing':float('nan')},{'framing_motion':1},{'framing_start_x':-.1},
                    {'framing_end_y':2}]:
            with self.subTest(bad=bad),self.assertRaises(ValueError):validate_preset(recipe | bad,[1,3],2.1)

    def test_native_timeline_and_actor_slots_are_shared_without_mislabeling_fbx(self):
        self.assertEqual(self.motion['timeline']['duration'],2.1)
        self.assertEqual([a['id'] for a in self.motion['actors']],[1,3])
        self.assertIsNone(self.motion['actors'][0]['glb'])
        self.assertEqual(self.motion['world_frame']['units'],'meters')
        self.assertNotIn(str(self.root),json.dumps(self.motion))

    def test_camera_json_round_trip_preserves_edits_and_render_contract(self):
        result = camera.make_camera(self.motion,json.dumps(self.settings))
        reloaded = json.loads(json.dumps(result))
        self.assertEqual(camera.validate_render_camera(self.motion,reloaded),result)
        self.assertEqual(result['settings']['target_actor'],3)
        self.assertEqual(result['settings']['end']['position'],[2,2,5])
        self.settings['end']['position'][0]=100
        self.assertEqual(result['settings']['end']['position'],[2,2,5])

    def test_captured_mode_preserves_index_and_drops_unused_manual_edits(self):
        result = camera.make_camera(self.motion,self.settings | {'mode':'captured'})
        self.assertIsNone(result['settings']['start'])
        self.assertIsNone(result['settings']['target_actor'])
        self.assertEqual(result['settings']['camera_index'],0)

    def test_foreign_capture_or_timeline_cannot_be_silently_combined(self):
        original = camera.make_camera(self.motion,self.settings)
        for changed in ['world_frame','timeline']:
            other = copy.deepcopy(original)
            other[changed] = {}
            with self.assertRaisesRegex(ValueError,'same capture'): camera.validate_render_camera(self.motion,other)
        with self.assertRaisesRegex(ValueError,'another capture'):
            camera.make_camera(self.motion,self.settings | {'world_frame_id':'other'})
        self.capture['motions'][0]['job_id']='different-motion'
        self.assertNotEqual(camera.motion_from_capture(self.capture,self.root)['world_frame']['id'],self.motion['world_frame']['id'])

    def test_editor_switch_resets_foreign_edits_before_actor_and_time_validation(self):
        # The previous clip can have actors, cameras and reference times absent
        # from the replacement clip. None should prevent opening the new one.
        frame = {'orientation': 'portrait', 'ratio': '4:3'}
        cases = [self.settings | {'world_frame_id': 'previous', 'camera_index': 9, 'target_actor': 4},
                 camera.DEFAULT_SETTINGS | {'mode': 'preset', 'world_frame_id': 'previous',
                    'preset': {'composition': 'group', 'actors': [2, 4], 'reference_time': 90}}]
        for settings in cases:
            with self.subTest(mode=settings['mode']):
                snapshot = copy.deepcopy(settings | {'output_frame': frame})
                result, notice = camera.make_editor_camera(self.motion, json.dumps(snapshot))
                self.assertEqual(result['settings'], camera.DEFAULT_SETTINGS | {'output_frame': frame})
                self.assertEqual(result['world_frame'], self.motion['world_frame'])
                self.assertIn('Previous camera edits were reset', notice)
                self.assertEqual(camera.validate_render_camera(self.motion, result), result)
                self.assertEqual(settings['world_frame_id'], 'previous')

    def test_editor_same_motion_keeps_edits_and_does_not_mask_invalid_settings(self):
        for settings in [self.settings, camera.DEFAULT_SETTINGS]:
            result, notice = camera.make_editor_camera(self.motion, settings)
            self.assertEqual(result, camera.make_camera(self.motion, settings))
            self.assertIsNone(notice)
        for invalid in [self.settings | {'world_frame_id': None},
                        self.settings | {'target_actor': 4},
                        self.settings | {'schema_version': 2, 'world_frame_id': 'previous'},
                        self.settings | {'mode': 'unknown', 'world_frame_id': 'previous'},
                        self.settings | {'world_frame_id': 'previous', 'output_frame': {'ratio': 'bad'}}, '{bad']:
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                camera.make_editor_camera(self.motion, invalid)

    def test_nonfinite_positions_invalid_lens_and_missing_actor_are_rejected(self):
        cases = [{'target_actor':2},{'target_actor':True},{'camera_index':1},{'camera_index':True},{'mode':'unknown'},
                 {'start':{'position':[float('nan'),0,0],'target':[0,1,0],'fov':45}},
                 {'end':{'position':[0,2,5],'target':[0,1,0],'fov':180}}]
        for invalid in cases:
            with self.subTest(invalid=invalid),self.assertRaises(ValueError): camera.make_camera(self.motion,self.settings | invalid)
        with self.assertRaisesRegex(ValueError,'different'):
            camera.make_camera(self.motion,self.settings | {'target_actor':None,'start':{'position':[0,0,0],'target':[0,0,0],'fov':45}})

    def test_unknown_timing_and_invalid_json_fail_with_actionable_messages(self):
        Path(self.capture['motions'][0]['assets']['camera']).write_bytes(binary_fbx())
        Path(self.capture['motions'][0]['assets']['mhr_0']).write_bytes(binary_fbx())
        with self.assertRaisesRegex(ValueError,'duration'): camera.motion_from_capture(self.capture,self.root)
        with self.assertRaisesRegex(ValueError,'Reset'): camera.make_camera(self.motion,'{invalid')

    def test_existing_preview_scene_restores_same_motion_without_queueing(self):
        (self.directory/'capture.json').write_text(json.dumps(self.capture))
        restored = routes.prepare_saved_scene(self.root,self.motion['scene']['camera'])
        self.assertEqual(restored,self.motion)
        self.assertEqual(restored['world_frame']['id'],self.motion['world_frame']['id'])

    def test_preview_restore_rejects_external_files_and_unmatched_camera(self):
        (self.directory/'capture.json').write_text(json.dumps(self.capture))
        for invalid in [None, {'type':'input'}, {'type':'output','filename':'../camera.fbx','subfolder':'cartwheel/scene'},
                        {'type':'output','filename':'camera.fbx','subfolder':'../elsewhere'}]:
            with self.subTest(invalid=invalid),self.assertRaises(ValueError): routes.prepare_saved_scene(self.root,invalid)
        (self.directory/'unmatched.fbx').write_bytes(binary_fbx(duration=2))
        with self.assertRaisesRegex(ValueError,'match'):
            routes.prepare_saved_scene(self.root,self.motion['scene']['camera'] | {'filename':'unmatched.fbx'})


    def test_preset_recipe_round_trip_and_existing_world_contract(self):
        recipe = {'composition': 'group', 'actors': [1, 3], 'movement': 'follow', 'response': 'smooth',
                  'follow_response': 'smooth', 'shot': 'cowboy', 'roll': -12, 'lens': 'portrait'}
        settings = camera.DEFAULT_SETTINGS | {'mode': 'preset', 'world_frame_id': self.motion['world_frame']['id'], 'preset': recipe}
        result = camera.make_camera(self.motion, settings)
        self.assertEqual(camera.validate_render_camera(self.motion, json.loads(json.dumps(result))), result)
        self.assertEqual(result['settings']['preset']['actors'], [1, 3])
        self.assertEqual(result['settings']['preset']['max_turn_speed'], 35)
        self.assertIsNone(result['settings']['start'])
        with self.assertRaisesRegex(ValueError, 'another capture'):
            camera.make_camera(self.motion, settings | {'world_frame_id': 'foreign'})

    def test_preset_actor_selection_and_compositions_are_validated(self):
        from cartwheel_camera_tests.camera_presets import validate_preset
        bad = [{'actors': []}, {'actors': [True]}, {'actors': [2]}, {'actors': [1, 1]},
               {'actors': [1], 'composition': 'group'}, {'actors': [1], 'composition': 'two'},
               {'actors': [1, 3]}, {'actors': [1], 'composition': 'ots', 'foreground_actor': 1},
               {'actors': [1], 'composition': 'ots', 'foreground_actor': None}]
        for value in bad:
            with self.subTest(value=value), self.assertRaises(ValueError): validate_preset(value, [1, 3], 3)
        valid = validate_preset({'actors': [3], 'composition': 'ots', 'foreground_actor': 1}, [1, 3], 3)
        self.assertEqual(valid['foreground_actor'], 1)

    def test_camera_behavior_contract_and_position_offsets(self):
        from cartwheel_camera_tests.camera_presets import validate_preset
        static = validate_preset({'actors': [1], 'behavior': 'static', 'movement': 'orbit', 'aim_behavior': 'track'}, [1], 3)
        self.assertEqual((static['movement'], static['aim_behavior']), ('fixed', 'fixed'))
        follow = validate_preset({'actors': [1,3], 'composition': 'group', 'selection': 'selected', 'behavior': 'follow',
                                  'follow_direction': 'facing', 'position_offset': [1,-2,3], 'framing_mode': 'whole_clip'}, [1,3], 3)
        self.assertEqual((follow['movement'], follow['aim_behavior'], follow['framing_mode']), ('track_subjects','track','reference'))
        settings = camera.DEFAULT_SETTINGS | {'mode':'preset','world_frame_id':self.motion['world_frame']['id'],'preset':follow}
        snapshot = camera.make_camera(self.motion,settings)
        self.assertEqual(camera.validate_render_camera(self.motion,json.loads(json.dumps(snapshot))),snapshot)
        self.assertEqual(snapshot['settings']['preset']['position_offset'],[1,-2,3])
        legacy = validate_preset({'actors':[1],'movement':'follow'}, [1],3)
        self.assertEqual((legacy['behavior'],legacy['movement']),('legacy','follow'))
        for patch in [{'behavior':'other'},{'selection':'other'},{'follow_direction':'other'},
                      {'position_offset':[0,0]},{'position_offset':[0,True,0]},{'position_offset':[0,float('inf'),0]}]:
            with self.subTest(patch=patch), self.assertRaises(ValueError): validate_preset({'actors':[1],**patch},[1],3)

    def test_anatomical_shot_version_and_medium_full_round_trip(self):
        from cartwheel_camera_tests.camera_presets import validate_preset
        self.assertEqual(validate_preset({'actors': [1]}, [1], 3)['framing_version'], 1)
        recipe = {'actors': [1], 'framing_version': 2, 'shot': 'medium_full', 'aim': 'auto'}
        settings = camera.DEFAULT_SETTINGS | {'mode': 'preset', 'preset': recipe,
                    'world_frame_id': self.motion['world_frame']['id']}
        result = camera.make_camera(self.motion, json.dumps(settings))
        self.assertEqual(camera.validate_render_camera(self.motion, result), result)
        self.assertEqual(result['settings']['preset']['framing_version'], 2)
        self.assertEqual(result['settings']['preset']['shot'], 'medium_full')
        for version in [True, 0, 3, 2.0, '2']:
            with self.subTest(version=version), self.assertRaisesRegex(ValueError, 'framing version'):
                validate_preset(recipe | {'framing_version': version}, [1], 3)

    def test_focus_and_composition_contract_round_trip_and_limits(self):
        from cartwheel_camera_tests.camera_presets import validate_preset
        recipe = {'actors': [1], 'focus_point': 'left_hand', 'frame_reference': 'custom',
                  'frame_x': .4, 'frame_y': .25, 'framing_scale': 1.2, 'focus_fill': .85}
        settings = camera.DEFAULT_SETTINGS | {'mode': 'preset', 'preset': recipe,
                    'world_frame_id': self.motion['world_frame']['id']}
        result = camera.make_camera(self.motion, json.dumps(settings))
        self.assertEqual(camera.validate_render_camera(self.motion, result), result)
        for key, value in recipe.items():
            self.assertEqual(result['settings']['preset'][key], value)
        self.assertEqual(result['settings']['preset']['framing_version'], 2)
        self.assertEqual(validate_preset({'actors': [1]}, [1], 3)['focus_point'], 'legacy')
        detail = validate_preset(recipe | {'composition': 'detail', 'shot': 'full'}, [1], 3)
        self.assertEqual(detail['shot'], 'full')
        for patch in [{'focus_point': 'unknown'}, {'frame_reference': 'unknown'}, {'frame_x': .05},
                      {'frame_y': float('nan')}, {'focus_fill': .01}, {'focus_fill': 1.6},
                      {'framing_scale': 0}, {'frame_x': True}, {'focus_fill': True}]:
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                validate_preset(recipe | patch, [1], 3)

    def test_auto_height_and_fisheye_contract(self):
        from cartwheel_camera_tests.camera_presets import validate_preset
        recipe = {'actors': [1], 'vertical': 'auto', 'lens': 'fisheye', 'fisheye_fov': 160}
        settings = camera.DEFAULT_SETTINGS | {'mode': 'preset', 'preset': recipe,
                    'world_frame_id': self.motion['world_frame']['id']}
        result = camera.make_camera(self.motion, settings)
        self.assertEqual(camera.validate_render_camera(self.motion, result), result)
        self.assertEqual(result['settings']['preset']['vertical'], 'auto')
        self.assertEqual(result['settings']['preset']['lens'], 'fisheye')
        self.assertEqual(validate_preset({'actors': [1]}, [1], 3)['vertical'], 'eye')
        for angle in [90, 180]:
            self.assertEqual(validate_preset(recipe | {'fisheye_fov': angle}, [1], 3)['fisheye_fov'], angle)
        for value in [True, 89, 181, float('nan')]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_preset(recipe | {'fisheye_fov': value}, [1], 3)
        for movement in ['zoom', 'dolly_zoom']:
            with self.subTest(movement=movement), self.assertRaisesRegex(ValueError, 'perspective lens'):
                validate_preset(recipe | {'behavior': 'move', 'movement': movement, 'direction': 'in'}, [1], 3)

    def test_preset_numeric_limits_timing_and_unknown_fields(self):
        from cartwheel_camera_tests.camera_presets import validate_preset
        bad = [{'roll': float('nan')}, {'roll': True}, {'padding': .1}, {'sensor_height': 0},
               {'responsiveness': 2}, {'max_turn_speed': 0}, {'target_offset': [0, 0, float('inf')]},
               {'target_offset': [0]}, {'movement': 'unsupported'}, {'start_time': 2, 'end_time': 1},
               {'start_time': 4}, {'end_time': 4}, {'movement': 'tilt', 'direction': 'left'}]
        for patch in bad:
            with self.subTest(patch=patch), self.assertRaises(ValueError): validate_preset({'actors': [1], **patch}, [1, 3], 3)
        result = validate_preset({'actors': [1], 'untrusted_extra': 'discarded'}, [1], 3)
        self.assertNotIn('untrusted_extra', result)

    def test_preset_incompatible_aim_and_pov_travel_are_normalized(self):
        from cartwheel_camera_tests.camera_presets import validate_preset
        for movement, direction, aim in [('orbit', 'left', 'fixed'), ('follow', 'left', 'fixed'),
                                          ('pan', 'left', 'fixed'), ('tilt', 'up', 'fixed')]:
            recipe = validate_preset({'actors': [1], 'movement': movement, 'direction': direction,
                                      'aim_behavior': 'track' if movement in {'pan', 'tilt'} else 'fixed'}, [1], 3)
            self.assertEqual(recipe['aim_behavior'], aim)
        pov = validate_preset({'actors': [1], 'composition': 'pov', 'movement': 'truck', 'aim_behavior': 'fixed'}, [1], 3)
        self.assertEqual(pov['movement'], 'fixed')
        self.assertEqual(pov['aim_behavior'], 'track')


    def test_preset_detail_and_zoom_controls_match_effective_recipe(self):
        from cartwheel_camera_tests.camera_presets import validate_preset
        detail = validate_preset({'actors': [1], 'composition': 'detail', 'shot': 'wide', 'aim': 'hips'}, [1], 3)
        self.assertEqual((detail['shot'], detail['aim']), ('close', 'head'))
        zoom = validate_preset({'actors': [1], 'movement': 'zoom', 'end_focal_length': 18}, [1], 3)
        self.assertEqual(zoom['direction'], 'out')


    def test_shot_reference_is_validated_and_saved_with_camera(self):
        from cartwheel_camera_tests.camera_presets import validate_preset
        legacy = validate_preset({'actors': [3]}, [1, 3], 3)
        self.assertEqual((legacy['reference_time'], legacy['reference_actor'], legacy['reference_basis']), (0, 3, 'legacy_chest'))
        recipe = {'composition': 'group', 'actors': [1, 3], 'reference_time': 1.37123,
                  'reference_actor': 3, 'reference_basis': 'pelvis'}
        settings = camera.DEFAULT_SETTINGS | {'mode': 'preset', 'preset': recipe, 'world_frame_id': self.motion['world_frame']['id']}
        result = camera.make_camera(self.motion, settings)
        self.assertEqual(camera.validate_render_camera(self.motion, json.loads(json.dumps(result))), result)
        for key in ['reference_time', 'reference_actor', 'reference_basis']:
            self.assertEqual(result['settings']['preset'][key], recipe[key])
        bad = [{'reference_time': -1}, {'reference_time': 4}, {'reference_time': True},
               {'reference_time': float('nan')}, {'reference_actor': True}, {'reference_actor': 3},
               {'reference_basis': 'other'}]
        for patch in bad:
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                validate_preset({'actors': [1], **patch}, [1, 3], 3)


    def test_output_frame_roundtrip_and_all_ratios(self):
        from cartwheel_camera_tests.camera_format import output_aspect, output_dimensions
        for ratio, aspect in [('16:9', 16/9), ('4:3', 4/3), ('1:1', 1), ('21:9', 21/9)]:
            for orientation in ['landscape', 'portrait']:
                frame = {'orientation': orientation, 'ratio': ratio}
                result = camera.make_camera(self.motion, self.settings | {'output_frame': frame})
                self.assertEqual(result['settings']['output_frame'], frame)
                self.assertEqual(camera.validate_render_camera(self.motion,json.loads(json.dumps(result))), result)
                expected = 1/aspect if orientation == 'portrait' else aspect
                self.assertAlmostEqual(output_aspect(frame, .56), expected)
                width, height = output_dimensions('720p', expected)
                self.assertEqual(min(width, height), 720)
                self.assertAlmostEqual(width/height, expected)
        captured = camera.make_camera(self.motion,self.settings | {'mode':'captured','output_frame':{'orientation':'landscape','ratio':'4:3'}})
        self.assertEqual(captured['settings']['output_frame']['ratio'],'4:3')
        self.assertEqual(output_aspect(None,.56),.56)
        for value in ['bad', {'orientation':'other'}, {'ratio':'3:2'}, {'orientation':True}]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                camera.make_camera(self.motion,self.settings | {'output_frame':value})

    def test_retired_whole_clip_migrates_without_changing_aim_or_path(self):
        from cartwheel_camera_tests.camera_presets import validate_preset
        for aim in ['target','fixed','track']:
            recipe = validate_preset({'composition':'group','actors':[1,3],'movement':'orbit',
                                     'aim_behavior':aim,'path_anchor':'fixed','framing_mode':'whole_clip'}, [1,3],3)
            self.assertEqual(recipe['aim_behavior'],aim)
            self.assertEqual(recipe['path_anchor'],'fixed')
            self.assertEqual(recipe['framing_mode'],'reference')
        for patch in [{'framing_mode':'other'},{'path_anchor':True}]:
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                validate_preset({'actors':[1],**patch},[1],3)

class ManualTangentValidationTests(unittest.TestCase):
    def test_tangents_and_live_aim_survive_validation(self):
        p=camera.validate_preset({'actors':[1],'reference_actor':1,'aim_source':'live','follow_strength':.3},[1],4)
        settings=camera.DEFAULT_SETTINGS|{'mode':'bookends','world_frame_id':'scene','preset':p,
            'start':{'position':[0,2,5],'target':[0,1,0],'fov':45},'end':{'position':[2,2,5],'target':[0,1,0],'fov':45},
            'manual_path':{'kind':'curve','controls':[[1,3,5],[2,3,5]],'points':[[1,2,5]],'point_handles':[[[0,1,0],[0,-1,0]]],'aim':'shot'}}
        result=camera.camera_settings(settings,[1],1,'scene',4)
        self.assertEqual(result['preset']['aim_source'],'live');self.assertEqual(result['preset']['follow_strength'],.3)
        self.assertEqual(result['manual_path']['point_handles'],settings['manual_path']['point_handles'])
        for handles in [[],[[[0,0,0]]],[[[float('nan'),0,0],[0,0,0]]]]:
            bad=copy.deepcopy(settings);bad['manual_path']['point_handles']=handles
            with self.assertRaises(ValueError):camera.camera_settings(bad,[1],1,'scene',4)
        for strength in [-.1,1.1,float('nan')]:
            with self.assertRaises(ValueError):camera.validate_preset({'actors':[1],'follow_strength':strength},[1],4)

class AimMarkerValidationTests(unittest.TestCase):
    def test_marker_survives_camera_round_trip(self):
        p = camera.validate_preset({'actors':[1], 'target_mode':'marker', 'custom_target':[3.2,1.4,-2],
            'behavior':'move', 'movement':'orbit', 'aim_source':'live'}, [1], 4)
        self.assertEqual((p['aim_source'],p['tracking_mode'],p['path_anchor']),('reference','exact','fixed'))
        s=camera.DEFAULT_SETTINGS|{'mode':'bookends','world_frame_id':'scene','preset':p,
            'start':{'position':[0,2,5],'target':[0,1,0],'fov':45},'end':{'position':[2,2,5],'target':[0,1,0],'fov':45},
            'manual_path':{'kind':'line','aim':'shot'}}
        result=camera.camera_settings(json.loads(json.dumps(s)),[1],1,'scene',4)
        self.assertEqual(result['preset']['custom_target'],[3.2,1.4,-2])
        self.assertEqual(result['preset']['target_mode'],'marker')
        p['custom_target'][0]=99
        self.assertEqual(result['preset']['custom_target'][0],3.2)

    def test_marker_rejects_invalid_or_inapplicable_settings(self):
        recipe={'actors':[1],'target_mode':'marker','custom_target':[1,1,0]}
        for bad in [None,[0,1],[True,0,0],[float('nan'),0,0],[100001,0,0],'1,2,3']:
            with self.subTest(bad=bad),self.assertRaises(ValueError):camera.validate_preset(recipe|{'custom_target':bad},[1],4)
        for patch in [{'target_mode':'anything'},{'target_mode':True},{'behavior':'follow'},{'movement':'track_subjects'}]:
            with self.subTest(patch=patch),self.assertRaises(ValueError):camera.validate_preset(recipe|patch,[1],4)
        self.assertEqual(camera.validate_preset({'actors':[1]},[1],4)['target_mode'],'actors')
