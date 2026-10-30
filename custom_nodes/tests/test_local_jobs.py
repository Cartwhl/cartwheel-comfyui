import importlib
import json
from pathlib import Path
import shutil
import sys
from tempfile import TemporaryDirectory
from types import ModuleType
import unittest
import zipfile

pkg=ModuleType('cw_local_job_tests');pkg.__path__=[str(Path(__file__).resolve().parents[1])];sys.modules[pkg.__name__]=pkg
jobs=importlib.import_module(pkg.__name__+'.local_jobs')
motion_io=importlib.import_module(pkg.__name__+'.motion_io')
camera=importlib.import_module(pkg.__name__+'.camera')
from motion_fixture import animated_glb

class LocalJobsTests(unittest.TestCase):
    def setUp(self):
        self.tmp=TemporaryDirectory();self.root=Path(self.tmp.name);self.output=self.root/'output';self.output.mkdir()
        self.glb=self.root/'actor.glb';self.glb.write_bytes(animated_glb(duration=2))
        self.motion=motion_io.import_motion([self.glb],None,self.output);self.motion['title']='Two-second test'
        self.camera=camera.make_camera(self.motion,camera.DEFAULT_SETTINGS)
        self.video=self.output/'cartwheel/renders/test.mp4';self.video.parent.mkdir(parents=True);self.video.write_bytes(b'local preview fixture')
        self.track={'schema_version':1,'units':'meters','up':'Y','fps':2,'aspect':16/9,'frames':[{'time':i*.5,'position':[i,2,5],'quaternion':[0,0,0,1],'fov':35+i,'roll':0} for i in range(5)],'render_actors':[{'actor':1,'format':'glb'}]}
        self.video.with_suffix('.camera.json').write_text(json.dumps(self.track))
    def tearDown(self):self.tmp.cleanup()
    def save(self):return jobs.save_job(self.output,self.motion,self.camera,self.video,fps=2,size='720p')
    def test_saved_job_is_self_contained_and_restores_edited_path_offline(self):
        saved=self.save();directory=(self.output/'cartwheel'/saved['id']).parent
        shutil.rmtree(self.output/'cartwheel/scenes');self.video.unlink();self.video.with_suffix('.camera.json').unlink()
        loaded=jobs.load_job(self.output,saved['id'])
        self.assertEqual(loaded['scene']['camera']['format'],'camera_json')
        self.assertEqual(loaded['scene']['camera']['frames'],self.track['frames'])
        self.assertEqual(loaded['scene']['camera']['frames'][-1]['position'],[4,2,5])
        self.assertEqual(loaded['timeline']['duration'],2)
        self.assertTrue(motion_io.asset_path(loaded['scene']['actors'][0],self.output).is_file())
        self.assertTrue((directory/'preview.mp4').is_file())
        self.assertNotEqual(loaded['world_frame']['id'],self.motion['world_frame']['id'])
    def test_catalog_keeps_multiple_camera_versions_and_has_no_absolute_paths(self):
        one=self.save();two=self.save();items=jobs.list_jobs(self.output)
        self.assertEqual(sum(i['id'] in {one['id'],two['id']} for i in items),2)
        self.assertNotIn(str(self.root),json.dumps(items))
        self.assertTrue(all('created_at' in i and 'title' in i for i in items))
    def test_zip_is_portable_and_includes_original_and_edited_camera(self):
        saved=self.save();path=jobs.bundle_job(self.output,saved['id'])
        with zipfile.ZipFile(path) as z:
            self.assertIsNone(z.testzip());names=z.namelist()
            self.assertTrue(any(n.endswith('.glb') for n in names))
            self.assertTrue(any(n.endswith('edited_camera.json') for n in names))
            self.assertTrue(any(n.endswith('camera_settings.json') for n in names))
            self.assertIn('original_motion.json',names);self.assertIn('import_camera_blender.py',names)
            self.assertNotIn(str(self.root),z.read('motion.json').decode())
            self.assertFalse(any(n.startswith('/') or '..' in Path(n).parts for n in names))
    def test_whole_fbx_scene_retains_separate_targets_and_source_after_saving(self):
        from fbx_fixture import scene_fbx
        scene=self.root/'scene.fbx';scene.write_bytes(scene_fbx(skinned=True))
        self.motion=motion_io.import_motion([scene],None,self.output)
        self.camera=camera.make_camera(self.motion,camera.DEFAULT_SETTINGS)
        saved=self.save()
        selectors=[a['selection'] for a in self.motion['scene']['actors']]
        shutil.rmtree(self.output/'cartwheel/scenes');scene.unlink()
        loaded=jobs.load_job(self.output,saved['id'])
        self.assertEqual([a['selection'] for a in loaded['scene']['actors']],selectors)
        self.assertTrue(loaded['scene']['original_camera']['embedded'])
        self.assertEqual(loaded['scene']['actors'][0]['background_nodes'],[9000])
        with zipfile.ZipFile(jobs.bundle_job(self.output,saved['id'])) as archive:
            self.assertEqual(sum(name.endswith('.fbx') for name in archive.namelist()),1)
            original=json.loads(archive.read('original_motion.json'))
            self.assertEqual([a['selection'] for a in original['scene']['actors']],selectors)
            self.assertTrue(original['scene']['camera']['embedded'])

    def test_invalid_paths_and_broken_entries_do_not_escape_output(self):
        saved=self.save()
        for token in ['', '../job.json','/etc/job.json','saved_jobs/nope/job.json']:
            with self.subTest(token=token),self.assertRaises(ValueError):jobs.load_job(self.output,token)
        broken=self.output/'cartwheel/saved_jobs/bad';broken.mkdir();(broken/'job.json').write_text('not json')
        self.assertIn(saved['id'],[i['id'] for i in jobs.list_jobs(self.output)])
        outside=self.root/'elsewhere';outside.mkdir();(outside/'job.json').write_text('{}')
        (self.output/'cartwheel/saved_jobs/link').symlink_to(outside,target_is_directory=True)
        with self.assertRaises(ValueError):jobs.load_job(self.output,'saved_jobs/link/job.json')
    def test_bad_catalog_duration_is_ignored_and_original_camera_survives_resaving(self):
        saved=self.save();loaded=jobs.load_job(self.output,saved['id'])
        self.assertEqual(loaded['scene']['original_camera']['format'],'default')
        again=jobs.save_job(self.output,loaded,camera.make_camera(loaded,camera.DEFAULT_SETTINGS),self.video,fps=2,size='720p')
        restored=jobs.load_job(self.output,again['id'])
        self.assertEqual(restored['scene']['original_camera']['format'],'default')
        path=self.output/'cartwheel'/saved['id'];doc=json.loads(path.read_text());doc['summary']['duration']='invalid';path.write_text(json.dumps(doc))
        self.assertNotIn(saved['id'],[i['id'] for i in jobs.list_jobs(self.output)])

    def test_fisheye_metadata_round_trips(self):
        self.track['lens_projection']='fisheye_equidistant';self.video.with_suffix('.camera.json').write_text(json.dumps(self.track))
        saved=self.save();loaded=jobs.load_job(self.output,saved['id'])
        self.assertEqual(loaded['scene']['camera']['lens_projection'],'fisheye_equidistant')

if __name__=='__main__':unittest.main()

class NamedLocalJobsTests(unittest.TestCase):
    setUp=LocalJobsTests.setUp
    tearDown=LocalJobsTests.tearDown
    def test_distinct_named_camera_snapshots(self):
        a=jobs.save_job(self.output,self.motion,self.camera,self.video,fps=24,size='720p',title='Fisheye boxers')
        b=jobs.save_job(self.output,self.motion,self.camera,self.video,fps=24,size='720p',title='Wide boxers')
        self.assertNotEqual(a['id'],b['id']);self.assertEqual(jobs.load_job(self.output,a['id'])['title'],'Fisheye boxers')
        self.assertEqual(jobs.load_job(self.output,b['id'])['title'],'Wide boxers')
        titles={i['title'] for i in jobs.list_jobs(self.output)};self.assertIn('Fisheye boxers',titles);self.assertIn('Wide boxers',titles)
    def test_invalid_names_fail_before_saving(self):
        for title in ['', '   ', 'x'*201, 'bad\nname', 42]:
            with self.subTest(title=repr(title)),self.assertRaises(ValueError):jobs.save_job(self.output,self.motion,self.camera,self.video,fps=24,size='720p',title=title)

class TimelineLocalJobsTests(unittest.TestCase):
    setUp=LocalJobsTests.setUp
    tearDown=LocalJobsTests.tearDown
    def sequence(self):
        world=self.motion['world_frame']['id']
        recipe=camera.DEFAULT_SETTINGS|{'mode':'bookends','world_frame_id':world,'start':{'position':[0,2,5],'target':[0,1,0],'fov':45},'end':{'position':[4,2,5],'target':[0,1,0],'fov':45},'manual_path':{'kind':'line','aim':'blend','pacing':'linear'}}
        timeline={'schema_version':1,'fps':24,'duration':2,'world_frame_id':world,'selected_id':'camera-2','next_id':3,'segments':[{'id':'camera-1','name':'Orbit','start':0,'end':1,'source_start':0,'source_end':1,'settings':json.loads(json.dumps(recipe))},{'id':'camera-2','name':'Truck','start':1.25,'end':2,'source_start':1,'source_end':2,'settings':json.loads(json.dumps(recipe))}],'joins':[{'left':'camera-1','right':'camera-2','connected':True,'smooth':True,'frames':10,'point':[2,2,5],'preserve':False}]}
        self.camera=camera.make_camera(self.motion,recipe|{'camera_timeline':timeline});return self.camera['settings']
    def test_named_sequence_restores_blocks_and_original_input_offline(self):
        settings=self.sequence();self.track['editor_recipe']=settings;self.video.with_suffix('.camera.json').write_text(json.dumps(self.track))
        saved=jobs.save_job(self.output,self.motion,self.camera,self.video,fps=24,size='720p',title='Orbit and truck')
        shutil.rmtree(self.output/'cartwheel/scenes')
        loaded=jobs.load_job(self.output,saved['id']);restored=loaded['saved_editor_settings'];timeline=restored['camera_timeline']
        self.assertEqual(loaded['scene']['camera']['format'],'default')
        self.assertEqual([s['name'] for s in timeline['segments']],['Camera 1','Camera 2']);self.assertEqual(timeline['selected_id'],'camera-2');self.assertEqual(timeline['segments'][1]['start'],1.25)
        self.assertEqual(timeline['world_frame_id'],loaded['world_frame']['id']);self.assertEqual(timeline['segments'][0]['settings']['world_frame_id'],loaded['world_frame']['id'])
        self.assertEqual(camera.make_camera(loaded,restored)['settings'],restored)
        # A second Save scene keeps current settings without embedding older recipes.
        self.motion=loaded;self.camera=camera.make_camera(loaded,restored)
        again=jobs.save_job(self.output,loaded,self.camera,self.video,fps=24,size='720p',title='Another version');reloaded=jobs.load_job(self.output,again['id'])
        self.assertEqual(len(reloaded['saved_editor_settings']['camera_timeline']['segments']),2)
        manifest=json.loads((self.output/'cartwheel'/again['id']).read_text());snapshot=json.loads(motion_io.asset_path(manifest['motion'],self.output).read_text());self.assertNotIn('saved_editor_settings',snapshot)
    def test_exported_camera_json_reopens_editable_sequence_with_uploaded_glb(self):
        settings=self.sequence();self.track['editor_recipe']=settings;self.track['frames'][2]['cut']=True
        path=self.root/'camera.json';path.write_text(json.dumps(self.track));loaded=motion_io.import_motion([self.glb],path,self.output)
        self.assertEqual(len(loaded['saved_editor_settings']['camera_timeline']['segments']),2)
        self.assertEqual(loaded['scene']['camera']['frames'][2]['cut'],True)
        self.assertEqual(loaded['saved_editor_settings']['camera_timeline']['world_frame_id'],loaded['world_frame']['id'])
