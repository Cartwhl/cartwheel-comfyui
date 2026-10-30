import importlib
import json
import os
import struct
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import types
import unittest
from unittest.mock import patch


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
package = types.ModuleType("cartwheel_test_package")
package.__path__ = [str(PACKAGE_ROOT)]
sys.modules[package.__name__] = package
client_module = importlib.import_module(f"{package.__name__}.client")
config = importlib.import_module(f"{package.__name__}.config")


class SettingsTests(unittest.TestCase):
    def test_only_production_key_and_endpoint_are_used(self):
        with TemporaryDirectory() as directory, patch.dict(os.environ, {}, clear=True):
            settings = Path(directory) / "comfy.settings.json"
            settings.write_text(json.dumps({config.API_KEY_SETTING: " production-key ",
                "Cartwheel.Connection.Environment": "unsupported", "Cartwheel.Connection.OtherApiKey": "other-key"}))
            connection = config.read_connection(settings)
            self.assertEqual(connection.api_key, "production-key")
            self.assertEqual(connection.environment, "production")
            self.assertEqual(connection.base_url, config.PRODUCTION_API_URL)
            self.assertNotIn("production-key", repr(connection))

    def test_obsolete_server_overrides_cannot_redirect_credentials(self):
        with TemporaryDirectory() as directory, patch.dict(os.environ, {
            "CARTWHEEL_ENVIRONMENT": "other", "CARTWHEEL_API_KEY": "server-key",
            "CARTWHEEL_API_BASE_URL": "https://untrusted.example"}, clear=True):
            connection = config.read_connection(Path(directory) / "missing.json")
            self.assertEqual(connection.base_url, config.PRODUCTION_API_URL)
            self.assertEqual(connection.api_key, "server-key")

    def test_production_cache_identity_is_preserved(self):
        import hashlib
        connection = config.Connection("production-key")
        expected = hashlib.sha256(f"production\0{config.PRODUCTION_API_URL}\0production-key".encode()).hexdigest()
        self.assertEqual(connection.fingerprint, expected)
        self.assertNotEqual(connection.fingerprint, config.Connection("another-key").fingerprint)

    def test_missing_key_and_multi_user_fail_before_execution(self):
        with TemporaryDirectory() as directory, patch.dict(os.environ, {}, clear=True):
            path = Path(directory) / "missing.json"
            with self.assertRaisesRegex(ValueError, "Settings"):
                config.read_connection(path)
            with self.assertRaisesRegex(ValueError, "single-user"):
                config.read_connection(path, multi_user=True)

    def test_invalid_settings_and_header_characters_are_rejected(self):
        with TemporaryDirectory() as directory, patch.dict(os.environ, {}, clear=True):
            path = Path(directory) / "settings.json"
            for value in [[], {config.API_KEY_SETTING:123}, {config.API_KEY_SETTING:"one\ntwo"}]:
                path.write_text(json.dumps(value))
                with self.assertRaises(ValueError):config.read_connection(path)
            path.write_text("invalid JSON")
            with self.assertRaisesRegex(ValueError, "could not be read"):config.read_connection(path)


OPTIONS = {"comicModel": "comic4", "numPeople": 2, "facialCapture": True, "footPlanting": True, "qualityPreset": "smoothed", "batchName": "ComfyUI Comic 4 test", "loop": False,
           "exportSettings": {"characterID": "char-upload-MHR", "exportType": "fbx-blender", "frameRate": 60.0, "includeMesh": True, "keyframeCleaning": "none", "forward": "-Z", "up": "Y", "frameStepSize": 1.0, "moveInPlace": False}}


class FakeClient:
    connection = config.Connection("test-secret")

    def __init__(self):
        self.submissions = 0
        self.api_calls = []
        self.lose_acknowledgement = False
        self.submission_error = None
        self.batch_status = "COMPLETED"
        self.fail_download = False
        self.uploaded_bytes = None
        self.items = [{"jobID": "motion-1", "status": "COMPLETED", "studioPreviewURL": "https://assets.example/preview.mp4", "cameraFbxURL": "https://assets.example/camera.fbx", "exportURLs": ["https://assets.example/actor0.fbx", "https://assets.example/actor1.fbx"], "exportFilenames": ["actor0.fbx", "../../actor1.fbx"], "faceURLs": [{"bvhURL": "https://assets.example/mhr0.fbx"}, {"bvhURL": "https://assets.example/mhr1.fbx"}], "mhrIdentityJsonURLs": [None, "https://assets.example/id1.json"]}]

    async def api(self, method, route, *, body=None, params=None):
        self.api_calls.append((method, route, body))
        if route == "/media/upload":
            return {"mediaUploads": [{"mediaID": "media-1", "mediaUploadURL": "https://assets.example/upload"}]}
        if route == "/motion/fromVideo":
            self.submissions += 1
            if self.submission_error:
                raise self.submission_error
            if self.lose_acknowledgement:
                raise client_module.CartwheelError("connection lost")
            return {"batchID": f"batch-{self.submissions}"}
        if route.startswith("/batch/batch-"):
            return {"status": self.batch_status}
        raise AssertionError(route)

    async def upload(self, url, path):
        self.uploaded_bytes = path.read_bytes()

    async def pages(self, route, field):
        return self.items

    async def download(self, url, destination, check_interrupt):
        check_interrupt()
        if self.fail_download:
            self.fail_download = False
            raise client_module.CartwheelError("expired URL")
        destination.write_bytes(b"asset")


class CaptureTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temporary = TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.source = self.root / "input.mp4"
        self.source.write_bytes(b"original video bytes")
        self.client = FakeClient()

    async def asyncTearDown(self):
        self.temporary.cleanup()

    async def run_capture(self, *, wait_seconds=3600,capture_version=0, omit_batch_name=False, **overrides):
        async def progress(value):
            pass
        options = OPTIONS | overrides
        if omit_batch_name:options.pop("batchName",None)
        return await client_module.capture(self.client, self.source, {"name": "input", "extension": "mp4", "duration": 5, "resolution": "1920x1080"}, options, self.root / "state", self.root / "output", lambda: None, progress, wait_seconds=wait_seconds, poll_seconds=0,capture_version=capture_version)

    async def test_default_unnamed_capture_reaches_api_without_a_name_or_fallback(self):
        result = await self.run_capture(omit_batch_name=True)
        sent = next(body for method,route,body in self.client.api_calls if route == "/motion/fromVideo")
        self.assertNotIn("batchName",sent)
        self.assertNotIn("batchName",result["capture_options"])
        self.assertEqual(result["title"],"input")
        again = await self.run_capture(omit_batch_name=True)
        self.assertEqual(again["batch_id"],result["batch_id"])
        self.assertEqual(self.client.submissions,1)

    async def test_unknown_unnamed_submission_is_not_repeated(self):
        self.client.lose_acknowledgement=True
        with self.assertRaises(client_module.CartwheelError):await self.run_capture(omit_batch_name=True)
        self.client.lose_acknowledgement=False
        with self.assertRaisesRegex(client_module.CartwheelError,"unknown outcome"):await self.run_capture(omit_batch_name=True)
        self.assertEqual(self.client.submissions,1)

    async def test_old_named_capture_is_reused_after_automatic_batch_naming(self):
        import hashlib
        result = await self.run_capture()
        current = next((self.root / "state").glob("*.json"))
        state = json.loads(current.read_text());state.pop("request_identity", None)
        fields = {"source": hashlib.sha256(self.source.read_bytes()).hexdigest(), "account": self.client.connection.fingerprint, "options": OPTIONS}
        old = current.parent / (hashlib.sha256(json.dumps(fields,sort_keys=True).encode()).hexdigest()+".json")
        current.unlink();old.write_text(json.dumps(state))
        again = await self.run_capture(omit_batch_name=True)
        self.assertEqual(again["batch_id"], result["batch_id"])
        self.assertEqual(self.client.submissions, 1)
        await self.run_capture(batchName="another organizational label")
        self.assertEqual(self.client.submissions, 1)

    async def test_uploads_original_and_reuses_completed_matching_execution(self):
        result = await self.run_capture()
        self.assertEqual(self.client.uploaded_bytes, self.source.read_bytes())
        next_result = await self.run_capture()
        self.assertEqual(self.client.submissions, 1)
        self.assertEqual(next_result["batch_id"], result["batch_id"])
        first_preview = Path(result["motions"][0]["assets"]["preview"])
        next_preview = Path(next_result["motions"][0]["assets"]["preview"])
        self.assertEqual(first_preview.parent, next_preview.parent)
        self.assertEqual(first_preview.read_bytes(), b"asset")
        self.assertEqual(next_preview.read_bytes(), b"asset")
        self.assertEqual(json.loads((first_preview.parent / "capture.json").read_text()), result)
        history = list((self.root / "state" / "history").glob("*.json"))
        self.assertEqual(len(history), 0)
        submitted = next(body for method, route, body in self.client.api_calls if route == "/motion/fromVideo")
        self.assertEqual(submitted["exportSettings"]["exportType"], "fbx-blender")
        self.assertEqual(submitted["comicModel"], "comic4")
        self.assertEqual(submitted["exportSettings"]["characterID"], "char-upload-MHR")
        self.assertTrue(submitted["exportSettings"]["includeMesh"])
        self.assertFalse(any(route.startswith("/characters") for method, route, body in self.client.api_calls))
        serialized = json.dumps(result)
        self.assertNotIn("test-secret", serialized)
        self.assertNotIn("https://", serialized)
        assets = result["motions"][0]["assets"]
        self.assertIsNone(assets["mhr_identity_0"])
        self.assertTrue(Path(assets["mhr_0"]).is_file())
        self.assertTrue(Path(assets["mhr_1"]).is_file())
        self.assertTrue(Path(assets["export_1"]).is_relative_to(self.root / "output"))
        self.assertEqual(Path(assets["export_0"]).suffix, ".fbx")

    async def test_missing_cached_asset_redownloads_without_new_capture(self):
        first=await self.run_capture();path=Path(first['motions'][0]['assets']['preview']);path.unlink()
        second=await self.run_capture();self.assertEqual(self.client.submissions,1);self.assertEqual(first['batch_id'],second['batch_id']);self.assertTrue(path.is_file())

    async def test_new_capture_version_is_explicit_and_itself_reusable(self):
        first=await self.run_capture();second=await self.run_capture(capture_version=1)
        self.assertEqual(self.client.submissions,2);self.assertNotEqual(first['batch_id'],second['batch_id'])
        third=await self.run_capture(capture_version=1);self.assertEqual(self.client.submissions,2);self.assertEqual(second['batch_id'],third['batch_id'])

    async def test_submitted_source_copy_survives_original_removal(self):
        original = self.source.read_bytes()
        result = await self.run_capture()
        saved = Path(result["source"]["path"])
        self.assertNotEqual(saved, self.source)
        self.source.unlink()
        self.assertEqual(saved.read_bytes(), original)
        self.assertEqual(result["source"]["media_id"], "media-1")

    async def test_public_face_fbx_field_preserves_missing_actor_slots(self):
        slots = client_module.asset_slots({"faceURLs": [None, {"bvhURL": "https://assets.example/mhr1.fbx"}]}, "fbx-blender")
        self.assertEqual(slots["mhr_0"], (None, ".fbx"))
        self.assertEqual(slots["mhr_1"], ("https://assets.example/mhr1.fbx", ".fbx"))

    async def test_download_failure_resumes_acknowledged_batch(self):
        self.client.fail_download = True
        with self.assertRaisesRegex(client_module.CartwheelError, "expired"):
            await self.run_capture()
        result = await self.run_capture()
        self.assertEqual(self.client.submissions, 1)
        self.assertTrue(Path(result["motions"][0]["assets"]["preview"]).is_file())

    async def test_lost_submission_acknowledgement_does_not_resubmit(self):
        self.client.lose_acknowledgement = True
        with self.assertRaisesRegex(client_module.CartwheelError, "connection lost"):
            await self.run_capture()
        with self.assertRaisesRegex(client_module.CartwheelError, "unknown outcome"):
            await self.run_capture()
        self.assertEqual(self.client.submissions, 1)

    async def test_poll_timeout_resumes_acknowledged_capture(self):
        self.client.batch_status = "PROCESSING"
        with self.assertRaisesRegex(client_module.CartwheelError, "Timed out"):
            await self.run_capture(wait_seconds=0)
        self.client.batch_status = "COMPLETED"
        result = await self.run_capture()
        self.assertEqual(self.client.submissions, 1)
        self.assertEqual(result["batch_id"], "batch-1")

    async def test_rejected_submission_can_be_run_again_after_fixing_the_issue(self):
        self.client.submission_error = client_module.ApiError(400, "/motion/fromVideo")
        with self.assertRaises(client_module.ApiError):
            await self.run_capture()
        self.client.submission_error = None
        await self.run_capture()
        self.assertEqual(self.client.submissions, 2)

    async def test_failed_provider_job_can_be_run_again(self):
        self.client.batch_status = "FAILED"
        with self.assertRaisesRegex(client_module.CartwheelError, "capture is failed"):
            await self.run_capture()
        self.client.batch_status = "COMPLETED"
        await self.run_capture()
        self.assertEqual(self.client.submissions, 2)

    async def test_fbx_export_is_not_mislabeled_when_filenames_are_omitted(self):
        self.client.items[0].pop("exportFilenames")
        result = await self.run_capture()
        self.assertEqual(Path(result["motions"][0]["assets"]["export_0"]).suffix, ".fbx")

    async def test_glb_exports_keep_all_actor_slots_and_native_preview_files(self):
        self.client.items[0]["exportURLs"] = ["https://assets.example/a.glb", "https://assets.example/b.glb"]
        self.client.items[0]["exportFilenames"] = ["a.glb", "b.glb"]
        result = await self.run_capture(exportSettings=OPTIONS["exportSettings"] | {"exportType": "glb"})
        assets = result["motions"][0]["assets"]
        self.assertEqual([Path(assets[f"export_{i}"]).suffix for i in range(2)], [".glb", ".glb"])
        self.assertEqual(Path(assets["mhr_0"]).suffix, ".fbx")
        self.assertEqual(Path(assets["camera"]).suffix, ".fbx")

    async def test_glb_export_without_provider_filenames_uses_glb_extension(self):
        self.client.items[0].pop("exportFilenames")
        result = await self.run_capture(exportSettings=OPTIONS["exportSettings"] | {"exportType": "glb"})
        self.assertEqual(Path(result["motions"][0]["assets"]["export_0"]).suffix, ".glb")

    async def test_glb_validation_rejects_renamed_fbx_and_truncated_downloads(self):
        path = self.root / "export.glb"
        path.write_bytes(b"FBX is not GLB")
        with self.assertRaisesRegex(client_module.CartwheelError, "invalid GLB"):
            client_module.validate_glb(path)
        path.write_bytes(struct.pack("<4sII", b"glTF", 2, 100))
        with self.assertRaisesRegex(client_module.CartwheelError, "invalid GLB"):
            client_module.validate_glb(path)
        with self.assertRaisesRegex(client_module.CartwheelError, "different export format"):
            client_module.validate_glb(self.root / "export.fbx")

    async def test_processing_and_export_controls_use_the_exact_api_fields(self):
        export = OPTIONS["exportSettings"] | {"frameRate": 24.0, "includeMesh": False, "keyframeCleaning": "simplify", "exportType": "fbx-maya", "frameStepSize": 2.0}
        await self.run_capture(numPeople=3, facialCapture=False, footPlanting=False, qualityPreset="detailed", batchName="MHR test", exportSettings=export)
        submitted = next(body for method, route, body in self.client.api_calls if route == "/motion/fromVideo")
        self.assertEqual(submitted, {"comicModel": "comic4", "numPeople": 3, "facialCapture": False, "footPlanting": False, "qualityPreset": "detailed", "batchName": "MHR test", "loop": False, "exportSettings": export, "mediaIDs": ["media-1"]})

    async def test_native_mhr_fbx_remains_available_with_bvh_export(self):
        self.client.items[0].pop("exportFilenames")
        result = await self.run_capture(exportSettings=OPTIONS["exportSettings"] | {"exportType": "bvh"})
        assets = result["motions"][0]["assets"]
        self.assertEqual(Path(assets["export_0"]).suffix, ".bvh")
        self.assertEqual(Path(assets["mhr_0"]).suffix, ".fbx")


class Response:
    status = 200

    def __init__(self, data=None):
        self.data = data
        self.content = self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    async def json(self, **kwargs):
        return self.data

    async def iter_chunked(self, size):
        yield b"asset"


class Session:
    def __init__(self):
        self.calls = []
        self.responses = []

    def request(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        return self.responses.pop(0)

    def put(self, url, **kwargs):
        return self.request("PUT", url, **kwargs)

    def get(self, url, **kwargs):
        return self.request("GET", url, **kwargs)


class TransportTests(unittest.IsolatedAsyncioTestCase):
    async def test_key_is_only_sent_to_api_not_asset_storage(self):
        session = Session()
        session.responses = [Response({}), Response(), Response()]
        client = client_module.Client(config.Connection("test-secret"), session)
        with TemporaryDirectory() as directory:
            path = Path(directory) / "source.mp4"
            path.write_bytes(b"video")
            await client.api("GET", "/characters")
            await client.upload("https://storage.example/upload", path)
            await client.download("https://storage.example/preview", Path(directory) / "preview.mp4", lambda: None)
        self.assertEqual(session.calls[0][1], config.PRODUCTION_API_URL + "/characters")
        self.assertEqual(session.calls[0][2]["headers"]["x-api-key"], "test-secret")
        for method, url, options in session.calls[1:]:
            self.assertNotIn("x-api-key", options.get("headers", {}))
            self.assertFalse(options["allow_redirects"])

    async def test_pagination_keeps_all_items(self):
        session = Session()
        session.responses = [Response({"items": [1], "nextToken": "next"}), Response({"items": [2]})]
        client = client_module.Client(config.Connection("test-secret"), session)
        self.assertEqual(await client.pages("/motions/batch", "items"), [1, 2])
        self.assertEqual(session.calls[1][2]["params"]["nextToken"], "next")

    async def test_provider_errors_do_not_expose_backend_messages_or_credentials(self):
        session = Session()
        response = Response({"message": "Request rejected. private-worker-name /srv/private/worker.py test-secret https://storage.example/file?signature=secret"})
        response.status = 400
        session.responses = [response]
        client = client_module.Client(config.Connection("test-secret"), session)
        with self.assertRaises(client_module.ApiError) as caught:
            await client.api("GET", "/characters")
        self.assertIn("Request rejected", str(caught.exception))
        self.assertNotIn("test-secret", str(caught.exception))
        self.assertNotIn("private-worker-name", str(caught.exception))
        self.assertNotIn("/srv/private", str(caught.exception))
        self.assertNotIn("https://", str(caught.exception))
        self.assertNotIn("signature=secret", str(caught.exception))

    async def test_http_storage_is_rejected(self):
        client = client_module.Client(config.Connection("test-secret"), Session())
        with self.assertRaisesRegex(client_module.CartwheelError, "HTTPS"):
            await client.upload("http://storage.example/upload", Path("unused"))


if __name__ == "__main__":
    unittest.main()
