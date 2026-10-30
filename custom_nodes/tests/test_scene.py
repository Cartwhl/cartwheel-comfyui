import importlib
import json
import math
from pathlib import Path
import struct
import sys
from tempfile import TemporaryDirectory
import types
import unittest

package = types.ModuleType("cartwheel_scene_tests")
package.__path__ = [str(Path(__file__).resolve().parents[1])]
sys.modules[package.__name__] = package
metadata = importlib.import_module(f"{package.__name__}.fbx_metadata")
scene = importlib.import_module(f"{package.__name__}.scene")


def binary_fbx(scale=1.0, duration=None):
    def encode(value):
        if isinstance(value, str):
            data = value.encode()
            return b"S" + struct.pack("<I", len(data)) + data
        return (b"D" + struct.pack("<d", value)) if isinstance(value, float) else b"L" + struct.pack("<q", value)
    def node(name, props, children, offset):
        name = name.encode()
        data = b"".join(encode(value) for value in props)
        body = b""
        for child in children:
            body += node(*child, offset + 25 + len(name) + len(data) + len(body))
        if children:
            body += bytes(25)
        end = offset + 25 + len(name) + len(data) + len(body)
        return struct.pack("<QQQB", end, len(props), len(data), len(name)) + name + data + body
    def property_(name, value):
        return ("P", [name, "double", "", "", value], [])
    globals_ = {"UnitScaleFactor": scale, "UpAxis": 1, "UpAxisSign": 1, "FrontAxis": 2, "FrontAxisSign": 1, "CoordAxis": 0, "CoordAxisSign": 1}
    if duration is not None:
        globals_["TimeSpanStop"] = int(duration * 46186158000)
    camera = {"AspectWidth": 1920.0, "AspectHeight": 1080.0, "FilmHeight": 20.25 / 25.4, "FocalLength": 28.0, "NearPlane": 0.01, "FarPlane": 10000.0}
    sections = [("GlobalSettings", [], [("Properties70", [], [property_(key, value) for key, value in globals_.items()])]),
                ("Objects", [], [("NodeAttribute", [7, "Camera", "Camera"], [("Properties70", [], [property_(key, value) for key, value in camera.items()])]), ("Model", [8, "Camera_Trajectory\x00\x01Model", "Camera"], [])]),
                ("Connections", [], [("C", ["OO", 7, 8], [])])]
    result = b"Kaydara FBX Binary  \x00\x1a\x00" + struct.pack("<I", 7700)
    for section in sections:
        result += node(*section, len(result))
    return result + bytes(25)


class SceneTests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.directory = self.root / "cartwheel" / "test"
        self.directory.mkdir(parents=True)
        self.actor = self.directory / "actor.fbx"
        self.camera = self.directory / "camera.fbx"
        self.actor.write_bytes(binary_fbx())
        self.camera.write_bytes(binary_fbx())
        self.capture = {"schema_version": 1, "batch_id": "mock-batch", "motions": [{"assets": {"mhr_0": str(self.actor), "mhr_1": None, "mhr_2": str(self.actor), "export_0": str(self.actor), "camera": str(self.camera)}}]}

    def tearDown(self):
        self.temporary.cleanup()

    def test_scene_preserves_actor_slots_and_only_exposes_local_asset_descriptors(self):
        result = scene.scene_preview(self.capture, self.root, 0)
        self.assertEqual([actor["actor"] for actor in result["actors"]], [1, 3])
        self.assertEqual(result["camera"]["meters_per_unit"], 0.01)
        self.assertEqual(result["camera"]["subfolder"], "cartwheel/test")
        self.assertNotIn("mock-batch", json.dumps(result))
        self.assertNotIn(str(self.root), json.dumps(result))

    def test_film_gate_drives_vertical_fov_and_clipping_uses_scene_units(self):
        result = metadata.read_metadata(self.camera)["cameras"][0]
        self.assertAlmostEqual(result["fov"], math.degrees(2 * math.atan(20.25 / 56)))
        self.assertEqual(result["model_id"], 8)
        self.assertEqual(result["aspect"], 1920 / 1080)
        self.assertAlmostEqual(result["near"], 0.0001)
        self.assertEqual(result["far"], 100)

    def test_different_declared_units_are_read_from_each_asset(self):
        self.camera.write_bytes(binary_fbx(100.0))
        result = scene.scene_preview(self.capture, self.root, 0)
        self.assertEqual(result["actors"][0]["meters_per_unit"], 0.01)
        self.assertEqual(result["camera"]["meters_per_unit"], 1)

    def test_missing_camera_has_an_actionable_error(self):
        self.capture["motions"][0]["assets"]["camera"] = None
        with self.assertRaisesRegex(ValueError, "missing a required FBX"):
            scene.scene_preview(self.capture, self.root, 0)

    def test_assets_outside_the_capture_directory_are_rejected(self):
        outside = self.root / "outside.fbx"
        outside.write_bytes(binary_fbx())
        self.capture["motions"][0]["assets"]["camera"] = str(outside)
        with self.assertRaisesRegex(ValueError, "inside ComfyUI"):
            scene.scene_preview(self.capture, self.root, 0)

    def test_saved_capture_can_be_loaded_without_api_credentials(self):
        (self.directory / "capture.json").write_text(json.dumps(self.capture))
        self.assertEqual(scene.capture_files(self.root), ["test/capture.json"])
        self.assertEqual(scene.load_capture(self.root, "test/capture.json"), self.capture)
        with self.assertRaises(ValueError):
            scene.load_capture(self.root, "../../capture.json")

    def test_case_aliases_work_on_case_insensitive_filesystems(self):
        alias = self.directory.parent / "TEST" / "actor.fbx"
        if not alias.is_file():
            self.skipTest("The test filesystem is case-sensitive.")
        self.capture["motions"][0]["assets"]["mhr_0"] = str(alias)
        result = scene.scene_preview(self.capture, self.root, 0)
        self.assertEqual(result["actors"][0]["subfolder"], "cartwheel/TEST")

    def test_invalid_units_and_truncated_fbx_are_rejected(self):
        for scale in [0.0, float("nan")]:
            self.camera.write_bytes(binary_fbx(scale))
            with self.assertRaisesRegex(ValueError, "unit scale"):
                metadata.read_metadata(self.camera)
        self.camera.write_bytes(binary_fbx()[:40])
        with self.assertRaises(ValueError):
            metadata.read_metadata(self.camera)

    def test_motion_index_must_exist(self):
        with self.assertRaisesRegex(ValueError, "selected index"):
            scene.scene_preview(self.capture, self.root, 1)
