"""Local actor import and upload validation, independent of paid providers."""
import importlib
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import AsyncMock
from aiohttp import web
from fbx_fixture import animated_fbx, scene_fbx
from motion_fixture import animated_glb, scene_glb
from test_scene import binary_fbx

pkg=ModuleType('fbx_upload_tests');pkg.__path__=[str(Path(__file__).resolve().parents[1])];sys.modules[pkg.__name__]=pkg
motion=importlib.import_module(pkg.__name__+'.motion_io')
routes=importlib.import_module(pkg.__name__+'.motion_routes')


class FBXImportTests(unittest.TestCase):
    def test_versions_units_timing_and_mixed_scene_restore(self):
        with TemporaryDirectory() as d:
            root=Path(d);out=root/'output';out.mkdir();glb=root/'actor.glb';glb.write_bytes(animated_glb())
            for version in [7400,7700]:
                for start,scale in [(0,1.),(5,100.)]:
                    with self.subTest(version=version,start=start,scale=scale):
                        fbx=root/'actor.FBX';data=animated_fbx(version=version,start=start,scale=scale,compressed=True);fbx.write_bytes(data)
                        scene=motion.import_motion([fbx,glb,fbx,glb],None,out)
                        self.assertEqual(scene['timeline'],{'duration':2.,'start_seconds':0,'basis':'imported'})
                        actor=scene['scene']['actors'][0]
                        self.assertEqual(actor['format'],'fbx');self.assertEqual(actor['animation_start'],start)
                        self.assertEqual(actor['meters_per_unit'],scale/100)
                        self.assertEqual(motion.asset_path(actor,out).read_bytes(),data)
                        self.assertIn('fbx',scene['actors'][0]);self.assertIn('glb',scene['actors'][1])
                        self.assertEqual(motion.restore_motion(scene['scene']['motion_manifest'],out),scene)
                        self.assertEqual(scene,motion.import_motion([fbx,glb,fbx,glb],None,out))
            self.assertEqual(motion.import_motion([fbx]*4,None,out)['timeline']['basis'],'fbx')
            camera=root/'camera.fbx';camera.write_bytes(binary_fbx(duration=2))
            self.assertEqual(motion.import_motion([fbx],camera,out)['scene']['camera']['format'],'fbx')

    def test_whole_scene_groups_camera_override_and_actor_limit(self):
        with TemporaryDirectory() as d:
            root=Path(d);out=root/'output'
            for suffix,data in [('glb',scene_glb()),('fbx',scene_fbx()),('fbx',scene_fbx(skinned=True,start=5))]:
                path=root/('scene.'+suffix);path.write_bytes(data)
                result=motion.import_motion([path],None,out)
                self.assertEqual(len(result['actors']),2)
                self.assertEqual(result['scene']['camera']['format'],suffix)
                self.assertTrue(result['scene']['camera']['embedded'])
                self.assertEqual(len(result['scene']['actors'][0]['background_nodes']),1)
                self.assertEqual(result,motion.validate_motion(result,out))
                self.assertEqual(result,motion.restore_motion(result['scene']['motion_manifest'],out))
                camera=root/'camera.json';camera.write_text(json.dumps({'schema_version':1,'units':'meters','up':'Y','frames':[{'time':0,'position':[0,1,4],'target':[0,1,0]}]}))
                override=motion.import_motion([path],camera,out)
                self.assertEqual(override['scene']['camera']['format'],'camera_json')
                with self.assertRaisesRegex(ValueError,'four actors'):motion.import_motion([path]*3,None,out)
            for suffix,data in [('glb',scene_glb(5)),('fbx',scene_fbx(5))]:
                path=root/('large.'+suffix);path.write_bytes(data)
                with self.assertRaisesRegex(ValueError,'four actors'):motion.import_motion([path],None,out)

    def test_invalid_motion_fails_before_persisting(self):
        with TemporaryDirectory() as d:
            root=Path(d);fbx=root/'actor.fbx';out=root/'output'
            cases=[(binary_fbx(duration=2),'animated mesh'),(animated_fbx(animated=False),'animated mesh'),
                   (animated_fbx(mesh=False),'animated mesh'),(animated_fbx(up=2),'Y-up'),
                   (animated_fbx(start=-2),'frame zero'),(animated_fbx(scale=0),'unit scale'),(animated_fbx(duration=0),'duration'),
                   (animated_fbx(duration=121),'duration'),(b'; FBX 7.4.0 project file','binary FBX'),
                   (animated_fbx()[:80],'metadata')]
            for data,error in cases:
                with self.subTest(error=error):
                    fbx.write_bytes(data)
                    with self.assertRaisesRegex(ValueError,error):motion.import_motion([fbx],None,out)
                    self.assertFalse(out.exists())


class FBXUploadTests(unittest.IsolatedAsyncioTestCase):
    async def upload(self,root,data,filename='actor.fbx',kind='motion'):
        class Part:
            name='file'
            def __init__(self):self.filename=filename;self.done=False
            async def read_chunk(self,*args):
                if self.done:return b''
                self.done=True;return data
        server=SimpleNamespace(routes=web.RouteTableDef());routes.register_motion_routes(server,lambda:str(root))
        req=SimpleNamespace(headers={},query={'kind':kind},multipart=AsyncMock(return_value=SimpleNamespace(next=AsyncMock(return_value=Part()))))
        return await list(server.routes)[0].handler(req)

    async def test_valid_upload_and_legacy_auto_role(self):
        with TemporaryDirectory() as d:
            root=Path(d)
            for kind,data in [('motion',animated_fbx()),('auto',animated_fbx()),('camera',binary_fbx(duration=2)),('motion',scene_fbx(skinned=True))]:
                response=await self.upload(root,data,kind=kind)
                self.assertEqual(response.status,200,response.text)
                result=json.loads(response.text)
                if kind=='motion':self.assertIn('actors',result)
                name=result['filename'];self.assertEqual((root/name).read_bytes(),data)
                self.assertNotIn(str(root),response.text)

    async def test_wrong_role_bad_files_and_rejected_cleanup(self):
        with TemporaryDirectory() as d:
            root=Path(d)
            for data,filename,kind in [(binary_fbx(duration=2),'camera.fbx','motion'),(animated_fbx(),'actor.fbx','camera'),
                 (animated_fbx(up=2),'actor.fbx','motion'),(scene_fbx(5),'scene.fbx','motion'),(b'bad','actor.fbx','motion'),
                 (animated_glb(),'actor.glb','camera'),(b'{}','camera.json','motion'),(b'bad','actor.exe','motion'),(b'bad','actor.fbx','other')]:
                response=await self.upload(root,data,filename,kind)
                self.assertEqual(response.status,400,response.text)
                self.assertEqual(list(root.rglob('*.fbx')),[])
                self.assertEqual(list(root.rglob('*.glb')),[])
