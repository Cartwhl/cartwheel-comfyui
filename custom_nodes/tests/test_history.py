import importlib
import json
from pathlib import Path
import struct
import sys
from tempfile import TemporaryDirectory
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch

from aiohttp import web
from aiohttp.test_utils import make_mocked_request

pkg = ModuleType('cartwheel_history_tests')
pkg.__path__ = [str(Path(__file__).resolve().parents[1])]
sys.modules[pkg.__name__] = pkg
history = importlib.import_module(f'{pkg.__name__}.history')
routes = importlib.import_module(f'{pkg.__name__}.history_routes')
config = importlib.import_module(f'{pkg.__name__}.config')
scene = importlib.import_module(f'{pkg.__name__}.scene')
from test_scene import binary_fbx


def glb_bytes():
    data = b'{"asset":{"version":"2.0"}}  '
    data += b' ' * (-len(data) % 4)
    return struct.pack('<4sII', b'glTF', 2, 20 + len(data)) + struct.pack('<I4s', len(data), b'JSON') + data


def motion():
    return {'jobID': 'motion-test', 'title': '<Example capture>', 'createdAt': '2026-01-01T00:00:00Z', 'status': 'COMPLETED',
            'studioPreviewURL': 'https://assets.example/preview.mp4?token=private', 'cameraFbxURL': 'https://assets.example/camera.fbx?token=private',
            'faceURLs': [{'bvhURL': 'https://assets.example/actor0.fbx'}, None, {'bvhURL': 'https://assets.example/actor2.fbx'}],
            'bvhURLs': ['https://assets.example/a.bvh', None, 'https://assets.example/c.bvh'],
            'exportURLs': ['https://assets.example/a.glb?token=private', None, 'https://assets.example/c.glb?token=private'],
            'exportFilenames': ['../../a.glb', None, 'c.glb']}


class HistoryClient:
    connection = config.Connection('private-key')
    def __init__(self):
        self.item = motion()
        self.calls, self.downloads = [], []
        self.fail_download = False
    async def api(self, method, route, *, params=None):
        self.calls.append((method, route, params))
        assert method == 'GET' and route == '/motions', 'History must never generate, export or retarget.'
        if not params.get('nextToken'):
            return {'items': [self.item | {'jobID': 'other'}], 'nextToken': 'page-two'}
        return {'items': [self.item]}
    async def download(self, url, target, check_interrupt):
        check_interrupt()
        self.downloads.append(url)
        if self.fail_download:
            self.fail_download = False
            raise history.CartwheelError('expired link')
        target.write_bytes(glb_bytes() if target.suffix == '.glb' else binary_fbx() if target.suffix == '.fbx' else b'asset')


class HistoryTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.client = HistoryClient()
    async def asyncTearDown(self):
        self.temp.cleanup()
    async def load(self, client=None, motion_id='motion-test', check=lambda: None):
        async def progress(value): pass
        return await history.load_history_capture(client or self.client, motion_id, self.root/'state', self.root/'output'/'cartwheel', check, progress)

    async def test_paginated_history_download_opens_in_existing_camera_viewer(self):
        capture = await self.load()
        assets = capture['motions'][0]['assets']
        self.assertIsNone(assets['mhr_1'])
        self.assertIsNone(assets['export_1'])
        self.assertEqual([a['actor'] for a in scene.scene_preview(capture, self.root/'output', 0)['actors']], [1,3])
        self.assertEqual(Path(assets['export_0']).suffix, '.glb')
        self.assertEqual(self.client.calls[1][2]['nextToken'], 'page-two')
        serialized = json.dumps(capture)
        for secret in ['https://', 'token=private', 'private-key']:
            self.assertNotIn(secret, serialized)
        self.assertEqual(scene.load_capture(self.root/'output', scene.capture_files(self.root/'output')[0]), capture)

    async def test_history_restores_original_video_using_only_read_requests(self):
        from test_media import make_video
        original = self.root/'original.mp4'
        make_video(original, audio=False)
        payload = original.read_bytes()
        class SourceClient(HistoryClient):
            async def api(self, method, route, *, params=None):
                if route == '/media/media-source':
                    self.calls.append((method, route, params))
                    assert method == 'GET'
                    return {'fileExtension': 'mp4', 'mediaDownloadURL': 'https://assets.example/original.mp4?private=source'}
                return await super().api(method, route, params=params)
            async def download(self, url, target, check_interrupt):
                if '/original.mp4?' in url:
                    check_interrupt();self.downloads.append(url);target.write_bytes(payload)
                else:
                    await super().download(url, target, check_interrupt)
        api = SourceClient();api.item['sourceVideoMediaID'] = 'media-source'
        first = await self.load(api)
        self.assertEqual(first['source']['metadata']['frame_count'],48)
        self.assertEqual(Path(first['source']['path']).read_bytes(),payload)
        self.assertNotIn('private=source',json.dumps(first))
        self.assertNotIn('https://',json.dumps(first))
        downloads=len(api.downloads)
        await self.load(api)
        self.assertEqual(len(api.downloads),downloads)
        self.assertEqual(sum(route == '/media/media-source' for _,route,_ in api.calls),1)

    async def test_repeat_load_reuses_files_but_checks_current_account_history(self):
        first = await self.load()
        downloads = len(self.client.downloads)
        Path(first['motions'][0]['assets']['camera']).unlink()
        second = await self.load()
        self.assertEqual(first, second)
        self.assertEqual(len(self.client.downloads), downloads+1)
        self.assertEqual(len(self.client.calls), 4)

    async def test_cache_is_scoped_to_connection(self):
        one = await self.load()
        other = HistoryClient()
        other.connection = config.Connection('different-key')
        two = await self.load(other)
        self.assertNotEqual(one['motions'][0]['assets']['camera'], two['motions'][0]['assets']['camera'])
        self.assertTrue(other.downloads)

    async def test_expired_link_can_resume_with_fresh_history(self):
        self.client.fail_download = True
        with self.assertRaisesRegex(history.CartwheelError, 'expired'):
            await self.load()
        result = await self.load()
        self.assertTrue(Path(result['motions'][0]['assets']['camera']).is_file())
        self.assertEqual(len(self.client.calls), 4)

    async def test_unavailable_or_incomplete_jobs_never_download(self):
        self.client.item['status'] = 'FAILED'
        with self.assertRaisesRegex(history.CartwheelError, 'not completed'):
            await self.load()
        with self.assertRaisesRegex(history.CartwheelError, 'not found'):
            await self.load(motion_id='not-accessible')
        self.assertEqual(self.client.downloads, [])

    async def test_missing_camera_is_explicit_and_body_assets_remain_loadable(self):
        self.client.item.pop('cameraFbxURL')
        result = await self.load()
        self.assertTrue(result['warnings'])
        self.assertIsNone(result['motions'][0]['assets']['camera'])
        self.assertTrue(Path(result['motions'][0]['assets']['mhr_0']).is_file())

    async def test_old_fbx_and_unknown_export_formats_are_not_mislabeled_glb(self):
        item = motion()
        item['exportFilenames'] = ['old.fbx', None, 'unidentified']
        item['exportURLs'][2] = 'https://assets.example/opaque?token=private'
        slots, warnings = history.history_assets(item)
        self.assertEqual(slots['export_0'][1], '.fbx')
        self.assertEqual(slots['export_2'], (None,''))
        self.assertTrue(warnings)
        item.pop('exportFilenames')
        self.assertEqual(history.history_assets(item)[0]['export_0'][1], '.glb')

    async def test_invalid_ids_and_interruption_stop_before_network(self):
        for value in ['', '../somewhere', 'a/b', 'a?b', None]:
            with self.assertRaises(ValueError): await self.load(motion_id=value)
        def stop(): raise RuntimeError('interrupted')
        with self.assertRaisesRegex(RuntimeError, 'interrupted'): await self.load(check=stop)
        self.assertFalse(self.client.calls)

    async def test_repeated_pagination_token_fails_instead_of_looping(self):
        async def repeated(method, route, params): return {'items': [], 'nextToken':'same'}
        self.client.api = repeated
        with self.assertRaisesRegex(history.CartwheelError, 'repeated'):
            await self.load()

    async def test_picker_route_exposes_only_safe_metadata(self):
        server = SimpleNamespace(routes=web.RouteTableDef())
        routes.register_history(server, lambda: self.client.connection)
        request = make_mocked_request('GET', '/cartwheel/history')
        with patch.object(routes, 'Client', return_value=self.client):
            response = await list(server.routes)[0].handler(request)
        result = json.loads(response.text)
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertTrue(result['items'][0]['has_camera'])
        self.assertEqual(result['items'][0]['actors'], 2)
        for secret in ['https://', 'private-key', 'token=private', 'bvhURL', 'createdBy']:
            self.assertNotIn(secret, response.text)
        self.assertEqual(result['connection'], self.client.connection.fingerprint)

    async def test_glb_only_requires_every_actor_and_detects_url_extensions(self):
        item = motion()
        self.assertTrue(history.has_glb_motion(item))
        summary = history.history_summary(item)
        self.assertTrue(summary['has_glb'])
        self.assertTrue(summary['glb_compatible'])
        item['exportFilenames'][2] = 'actor.fbx'
        self.assertTrue(history.history_summary(item)['has_glb'])
        self.assertFalse(history.has_glb_motion(item))
        item.pop('exportFilenames')
        self.assertTrue(history.has_glb_motion(item))
        item['exportURLs'][2] = None
        self.assertFalse(history.has_glb_motion(item))
        item['faceURLs'] = [];item['bvhURLs'] = [];item['exportURLs'] = []
        self.assertFalse(history.has_glb_motion(item))

    async def test_glb_required_rejects_fbx_before_any_download(self):
        self.client.item['exportFilenames'] = ['a.fbx', None, 'c.fbx']
        async def progress(value): pass
        with self.assertRaisesRegex(history.CartwheelError, 'GLB export for every actor'):
            await history.load_history_capture(self.client, 'motion-test', self.root/'state', self.root/'output'/'cartwheel', lambda:None, progress, require_glb=True)
        self.assertEqual(self.client.downloads, [])
        self.assertFalse((self.root/'output').exists())

    async def test_glb_picker_skips_fbx_pages_and_retains_cursor(self):
        old = motion() | {'jobID':'old', 'exportFilenames':['a.fbx',None,'c.fbx']}
        class Pages(HistoryClient):
            async def api(self, method, route, *, params):
                assert method == 'GET' and route == '/motions'
                self.calls.append(params)
                return {'items':[old], 'nextToken':'next'} if not params.get('nextToken') else {'items':[motion()], 'nextToken':'later'}
        client = Pages()
        items, token = await history.glb_history_page(client)
        self.assertEqual([item['jobID'] for item in items], ['motion-test'])
        self.assertEqual(token, 'later')
        self.assertEqual(len(client.calls), 2)

    async def test_glb_picker_page_skip_is_bounded(self):
        old = motion() | {'exportFilenames':['a.fbx',None,'c.fbx']}
        class Pages(HistoryClient):
            async def api(self, method, route, *, params):
                self.calls.append(params)
                return {'items':[old], 'nextToken':f'page-{len(self.calls)}'}
        client = Pages()
        items, token = await history.glb_history_page(client)
        self.assertEqual(items, [])
        self.assertEqual(token, 'page-5')
        self.assertEqual(len(client.calls), 5)

    async def test_glb_only_route_omits_fbx_and_signed_urls(self):
        old = motion() | {'jobID':'old-fbx', 'exportFilenames':['a.fbx',None,'c.fbx']}
        async def mixed(method, route, *, params): return {'items':[old, motion()]}
        self.client.api = mixed
        server = SimpleNamespace(routes=web.RouteTableDef())
        routes.register_history(server, lambda:self.client.connection)
        with patch.object(routes, 'Client', return_value=self.client):
            response = await list(server.routes)[0].handler(make_mocked_request('GET', '/cartwheel/history?glb_only=1'))
        result = json.loads(response.text)
        self.assertTrue(result['glb_only'])
        self.assertEqual([item['motion_id'] for item in result['items']], ['motion-test'])
        self.assertNotIn('https://', response.text)

    async def test_missing_key_is_actionable_in_picker(self):
        def missing(): raise ValueError('Add your production key in Settings.')
        server = SimpleNamespace(routes=web.RouteTableDef())
        routes.register_history(server, missing)
        response = await list(server.routes)[0].handler(make_mocked_request('GET','/cartwheel/history'))
        self.assertEqual(response.status,400)
        self.assertIn('Settings',json.loads(response.text)['error'])


if __name__ == '__main__': unittest.main()

class HistorySourceTests(unittest.TestCase):
    def test_classification_uses_explicit_public_data(self):
        self.assertEqual(history.motion_source({'durationSeconds':8,'outputs':[]}), 'swing')
        self.assertEqual(history.motion_source({'sourceVideoMediaID':'video'}), 'performance')
        self.assertEqual(history.motion_source({'cameraFbxURL':'camera','title':'swing dance'}), 'unknown')

    def test_retained_manifest_classifies_known_jobs(self):
        with TemporaryDirectory() as directory:
            root=Path(directory)
            for name,value in [('swing',{'generation_options':{'requestedModel':'swing_choreo'},'motions':[{'job_id':'s1'}]}),('performance',{'capture_options':{'comicModel':'comic4'},'motions':[{'job_id':'p1'}]})]:
                path=root/name;path.mkdir();(path/'capture.json').write_text(json.dumps(value))
            bad=root/'bad';bad.mkdir();(bad/'capture.json').write_text('not JSON')
            self.assertEqual(history.local_motion_sources(root),{'s1':'swing','p1':'performance'})
