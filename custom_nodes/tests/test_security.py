"""Production transport, local-route and malformed-upload regression checks."""
import asyncio
import importlib
import json
from pathlib import Path
import struct
import sys
from tempfile import TemporaryDirectory
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

from aiohttp import web
from aiohttp.test_utils import make_mocked_request

pkg = ModuleType('cw_security_tests')
pkg.__path__ = [str(Path(__file__).resolve().parents[1])]
sys.modules[pkg.__name__] = pkg
transport = importlib.import_module(pkg.__name__ + '.transport')
security = importlib.import_module(pkg.__name__ + '.route_security')
client = importlib.import_module(pkg.__name__ + '.client')
config = importlib.import_module(pkg.__name__ + '.config')
scene_routes = importlib.import_module(pkg.__name__ + '.motion_routes')
glb = importlib.import_module(pkg.__name__ + '.glb_metadata')
fbx = importlib.import_module(pkg.__name__ + '.fbx_metadata')
from test_client import Session, Response
from motion_fixture import animated_glb


class URLTests(unittest.TestCase):
    def test_private_and_unsafe_asset_destinations_rejected(self):
        for value in [None, 'http://assets.example/a', 'https://127.0.0.1/a', 'https://[::1]/a',
                      'https://[::ffff:127.0.0.1]/a', 'https://169.254.169.254/a', 'https://10.1.2.3/a',
                      'https://224.0.0.1/a', 'https://localhost/a', 'https://internal/a', 'https://host.local/a',
                      'https://host.internal/a', 'https://user:password@assets.example/a',
                      'https://assets.example:8443/a', 'https://assets.example/a#fragment']:
            with self.subTest(value=value), self.assertRaises(ValueError):transport.validate_asset_url(value)
        for value in ['https://assets.example/a?signature=private', 'https://8.8.8.8/a']:
            transport.validate_asset_url(value)

    def test_route_origins_and_upload_directory_confinement(self):
        for headers in [{}, {'Host':'127.0.0.1:8188','Origin':'http://127.0.0.1:8188'},
                        {'Host':'app.example','Origin':'http://app.example','Sec-Fetch-Site':'same-origin'}]:
            security.same_origin(make_mocked_request('GET','/cartwheel/history',headers=headers))
        for headers in [{'Host':'localhost:8188','Origin':'https://unrelated.example'},
                        {'Host':'localhost:8188','Origin':'null'}, {'Host':'localhost:8188','Origin':'https://localhost:8188'}, {'Sec-Fetch-Site':'cross-site'}]:
            with self.assertRaises(web.HTTPForbidden):security.same_origin(make_mocked_request('GET','/',headers=headers))
        with TemporaryDirectory() as directory:
            base=Path(directory);inputs=base/'input';inputs.mkdir();outside=base/'outside';outside.mkdir()
            (inputs/'cartwheel_imports').symlink_to(outside,target_is_directory=True)
            with self.assertRaises(ValueError):security.upload_directory(inputs,'cartwheel_imports')
            self.assertEqual(list(outside.iterdir()),[])

    def test_malformed_scene_metadata_is_validation_error(self):
        with TemporaryDirectory() as directory:
            root=Path(directory)
            p=root/'bad.fbx';p.write_bytes(b'Kaydara FBX Binary  \x00\x1a\x00')
            with self.assertRaises(ValueError):fbx.read_metadata(p)
            for doc in [{'asset':{'version':'2.0'},'images':[None]}, {'asset':{'version':'2.0'},'animations':[None]}]:
                data=json.dumps(doc).encode();data+=b' '*(-len(data)%4)
                p=root/'bad.glb';p.write_bytes(struct.pack('<4sIII4s',b'glTF',2,len(data)+20,len(data),b'JSON')+data)
                with self.assertRaises(ValueError):glb.read_metadata(p)


class TransportSecurityTests(unittest.IsolatedAsyncioTestCase):
    async def test_dns_is_checked_on_connection_resolution(self):
        resolver=transport.PublicResolver()
        try:
            for addresses in [[], [{'host':'127.0.0.1'}], [{'host':'8.8.8.8'},{'host':'10.0.0.1'}], [{'host':'::1'}]]:
                with patch.object(resolver.delegate,'resolve',AsyncMock(return_value=addresses)):
                    with self.assertRaises(OSError):await resolver.resolve('assets.example',443)
            public=[{'host':'8.8.8.8'}]
            with patch.object(resolver.delegate,'resolve',AsyncMock(return_value=public)):
                self.assertEqual(await resolver.resolve('assets.example',443),public)
        finally:await resolver.close()

    async def test_non_json_objects_and_oversize_downloads_fail_safely(self):
        session=Session();session.responses=[Response([])]
        api=client.Client(config.Connection('synthetic-key'),session)
        with self.assertRaises(client.CartwheelError):await api.api('GET','/motions')
        with TemporaryDirectory() as directory:
            target=Path(directory)/'actor.glb';target.write_bytes(b'keep previous')
            response=Response();response.content_length=transport.MAX_DOWNLOAD_BYTES+1
            session.responses=[response]
            with self.assertRaisesRegex(client.CartwheelError,'1 GiB'):await api.download('https://assets.example/a',target,lambda:None)
            self.assertEqual(target.read_bytes(),b'keep previous');self.assertFalse(target.with_suffix('.glb.part').exists())
            session.responses=[Response()]
            with patch.object(client,'MAX_DOWNLOAD_BYTES',2),self.assertRaisesRegex(client.CartwheelError,'1 GiB'):
                await api.download('https://assets.example/a',target,lambda:None)
            self.assertEqual(target.read_bytes(),b'keep previous');self.assertFalse(target.with_suffix('.glb.part').exists())

    async def test_cross_site_upload_stops_before_reading_body(self):
        server=SimpleNamespace(routes=web.RouteTableDef());scene_routes.register_motion_routes(server,lambda:'/unused')
        request=make_mocked_request('POST','/cartwheel/scene/upload',headers={'Origin':'https://untrusted.example'})
        with self.assertRaises(web.HTTPForbidden):await list(server.routes)[0].handler(request)

    async def test_scene_upload_and_cancelled_partial_cleanup(self):
        class Part:
            name='file';filename='actor.glb'
            def __init__(self,cancel=False):self.count=0;self.cancel=cancel
            async def read_chunk(self,n):
                self.count+=1
                if self.count==1:return animated_glb(duration=2)
                if self.cancel:raise asyncio.CancelledError()
                return b''
        with TemporaryDirectory() as directory:
            server=SimpleNamespace(routes=web.RouteTableDef());scene_routes.register_motion_routes(server,lambda:directory)
            handler=list(server.routes)[0].handler
            def request(part):return SimpleNamespace(headers={},multipart=AsyncMock(return_value=SimpleNamespace(next=AsyncMock(return_value=part))))
            result=await handler(request(Part()));self.assertEqual(result.status,200)
            name=json.loads(result.text)['filename'];self.assertTrue((Path(directory)/name).is_file())
            files=list((Path(directory)/'cartwheel_imports').iterdir())
            with self.assertRaises(asyncio.CancelledError):await handler(request(Part(cancel=True)))
            self.assertEqual(list((Path(directory)/'cartwheel_imports').iterdir()),files)


if __name__=='__main__':unittest.main(verbosity=2)
