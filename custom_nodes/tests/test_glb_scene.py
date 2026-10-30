import json
import struct
import unittest

import test_scene
from test_scene import scene, binary_fbx
from test_camera import camera


def binary_glb(duration=3.0, extra=None):
    document = {'asset': {'version': '2.0'}, 'buffers': [{'byteLength': 8}],
                'bufferViews': [{'buffer': 0, 'byteLength': 8}],
                'accessors': [{'bufferView': 0, 'componentType': 5126, 'count': 2, 'type': 'SCALAR'}],
                'animations': [{'samplers': [{'input': 0}]}]}
    document.update(extra or {})
    data = json.dumps(document).encode()
    data += b' ' * (-len(data) % 4)
    body = struct.pack('<I4s', len(data), b'JSON') + data + struct.pack('<I4s2f', 8, b'BIN\x00', 0, duration)
    return struct.pack('<4sII', b'glTF', 2, 12+len(body)) + body


class GLBSceneTests(unittest.TestCase):
    tearDown = test_scene.SceneTests.tearDown
    def setUp(self):
        test_scene.SceneTests.setUp(self)
        self.glb = self.directory / 'actor.glb'
        self.glb.write_bytes(binary_glb())

    def test_glb_is_preferred_per_slot_and_native_camera_is_preserved(self):
        assets = self.capture['motions'][0]['assets']
        assets['export_0'] = str(self.glb)
        native = scene.scene_preview(self.capture | {'motions': [{'assets': assets | {'export_0': None}}]}, self.root, 0)
        result = scene.scene_preview(self.capture, self.root, 0)
        self.assertEqual([a['actor'] for a in result['actors']], [1, 3])
        self.assertEqual([a['format'] for a in result['actors']], ['glb', 'fbx'])
        self.assertEqual(result['actors'][0]['meters_per_unit'], 1)
        self.assertEqual(result['actors'][0]['native_reference']['filename'], self.actor.name)
        self.assertEqual(result['actors'][0]['export_duration'], 3)
        self.assertEqual(native['camera'], result['camera'])
        self.assertNotIn(str(self.root), json.dumps(result))

    def test_glb_without_native_actor_can_load_and_uses_export_timestamps(self):
        assets = self.capture['motions'][0]['assets']
        assets.update(mhr_0=None, mhr_2=None, export_3=str(self.glb))
        result = scene.scene_preview(self.capture, self.root, 0)
        self.assertEqual([a['actor'] for a in result['actors']], [4])
        self.assertNotIn('native_reference', result['actors'][0])
        self.assertEqual(result['actors'][0]['duration'], 3)

    def test_camera_edits_keep_the_same_world_and_native_duration_after_switch(self):
        self.actor.write_bytes(binary_fbx(duration=2))
        self.camera.write_bytes(binary_fbx(duration=2.1))
        original = camera.motion_from_capture(self.capture, self.root)
        settings = camera.DEFAULT_SETTINGS | {'mode': 'bookends', 'world_frame_id': original['world_frame']['id'],
            'start': {'position': [0,2,5], 'target': [0,1,0], 'fov': 45},
            'end': {'position': [1,2,5], 'target': [0,1,0], 'fov': 50}}
        self.capture['motions'][0]['assets']['export_0'] = str(self.glb)
        updated = camera.motion_from_capture(self.capture, self.root)
        self.assertEqual(original['world_frame'], updated['world_frame'])
        self.assertEqual(original['timeline'], updated['timeline'])
        self.assertEqual(camera.make_camera(original, settings), camera.make_camera(updated, settings))

    def test_bad_glb_is_rejected_instead_of_silently_showing_fbx(self):
        self.capture['motions'][0]['assets']['export_0'] = str(self.glb)
        for content in [b'broken', binary_glb()[:-4], binary_glb(float('nan')),
                        binary_glb(extra={'buffers': [{'uri': 'https://example.com/mesh.bin'}]}),
                        binary_glb(extra={'images': [{'uri': '../body.png'}]}),
                        binary_glb(extra={'extensionsRequired': ['KHR_draco_mesh_compression']})]:
            self.glb.write_bytes(content)
            with self.subTest(size=len(content)), self.assertRaises(ValueError):
                scene.scene_preview(self.capture, self.root, 0)

    def test_glb_must_be_inside_the_capture_output_directory(self):
        outside = self.root / 'outside.glb'
        outside.write_bytes(binary_glb())
        self.capture['motions'][0]['assets']['export_0'] = str(outside)
        with self.assertRaisesRegex(ValueError, 'inside ComfyUI'):
            scene.scene_preview(self.capture, self.root, 0)
