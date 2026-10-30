"""Native ComfyUI registration and GLB/VIDEO contracts; synthetic data only.

Usage: python tests/check_comfy_glb.py COMFYUI_ROOT
"""
import asyncio
import importlib.util
import json
from pathlib import Path
import struct
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

comfy_root = Path(sys.argv[1]).resolve()
package_root = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(comfy_root), str(package_root / "tests")]
temporary = TemporaryDirectory(prefix="cartwheel-native-check-")
base = Path(temporary.name)
sys.argv = [sys.argv[0], "--cpu", "--base-directory", str(base)]

import comfy.options
comfy.options.enable_args_parsing()
from comfy_api.latest import InputImpl
from comfy_execution.validation import validate_node_input
from comfy_extras.nodes_load_3d import Preview3DAdvanced
from render_fixture import make_render

spec = importlib.util.spec_from_file_location(
    "cartwheel_native_check", package_root / "__init__.py",
    submodule_search_locations=[str(package_root)],
)
package = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = package
spec.loader.exec_module(package)
from cartwheel_native_check import nodes
from cartwheel_native_check.config import Connection


async def check():
    (base / "temp").mkdir()
    assets = base / "output" / "cartwheel" / "fixture"
    video = make_render(assets / "preview.mp4")
    doc = json.dumps({"asset": {"version": "2.0"}, "scene": 0,
                      "scenes": [{"nodes": []}]}).encode()
    doc += b" " * (-len(doc) % 4)
    actor = assets / "actor.glb"
    actor.write_bytes(struct.pack("<4sII", b"glTF", 2, len(doc) + 20)
                      + struct.pack("<I4s", len(doc), b"JSON") + doc)
    manifest = {"motions": [{"assets": {"preview": str(video), "export_0": str(actor)}}]}
    capture = AsyncMock(return_value=manifest)
    schema = nodes.CartwheelPerformanceCapture.define_schema()
    defaults = {item.id: item.default for item in schema.inputs if hasattr(item, "default")}
    with patch.object(nodes, "connection", return_value=Connection("synthetic-key")), \
         patch.object(nodes, "capture", capture), \
         patch.object(nodes, "scene_outputs", return_value=({"motion": True}, {"camera": True})):
        result = await nodes.CartwheelPerformanceCapture.execute(
            video=InputImpl.VideoFromFile(str(video)), **defaults)
    assert "batchName" not in capture.call_args.args[3]
    assert result[2].format == "glb" and result[2].get_source() == str(actor)
    assert [item.id for item in schema.inputs] == [
        "video", "numPeople", "facialCapture", "footPlanting", "qualityPreset",
        "frameRate", "keyframeCleaning", "capture_version",
    ]
    viewer = Preview3DAdvanced.define_schema()
    preview = nodes.CartwheelCameraPreview.define_schema()
    editor = nodes.CartwheelCamera.define_schema()
    render = nodes.CartwheelControlRender.define_schema()
    assert validate_node_input(schema.outputs[2].io_type, viewer.inputs[0].get_io_type())
    assert validate_node_input(schema.outputs[9].io_type, preview.inputs[0].get_io_type())
    assert validate_node_input(editor.outputs[0].io_type, render.inputs[0].get_io_type())
    assert validate_node_input(editor.outputs[1].io_type, render.inputs[1].get_io_type())
    assert [item.id for item in preview.outputs] == [
        "video", "camera", "camera_json", "camera_file", "first_frame", "last_frame",
        "depth", "normal", "pose", "use_frame_images",
    ]
    server = SimpleNamespace(sockets={}, routes=None)
    with patch.object(package.bridge, "register"), \
         patch.object(package, "register_local_jobs"), \
         patch.object(package, "register_camera_routes"), \
         patch.object(package, "register_motion_routes"), \
         patch.object(package, "register_reference_routes"), \
         patch.object(package, "register_instruction_routes"), \
         patch.object(package.PromptServer, "instance", server, create=True):
        registered = await (await package.comfy_entrypoint()).get_node_list()
    ids = [node.define_schema().node_id for node in registered]
    assert len(ids) == len(set(ids))
    for required in ("CartwheelPerformanceCapture", "CartwheelSwingChoreo",
                     "CartwheelLoadMotionAndCamera", "CartwheelCameraPreview",
                     "CartwheelControlPreview", "CartwheelPrepareVideoReferences",
                     "CartwheelGenerateVideo", "CartwheelEndpointImage"):
        assert required in ids, required
    output = Preview3DAdvanced.execute(result[2], {}, 256, 256)
    assert output[0] is result[2]
    copied = list((base / "temp").glob("preview3d_advanced_*.glb"))
    assert len(copied) == 1 and copied[0].read_bytes() == actor.read_bytes()
    print("PASS: native node registration, omitted batch name, GLB viewer socket/file, MOTION/CAMERA and control outputs; no paid calls.")


try:
    with patch.object(nodes, "ComfyAPI", return_value=SimpleNamespace(
            execution=SimpleNamespace(set_progress=AsyncMock()))):
        asyncio.run(check())
finally:
    temporary.cleanup()
