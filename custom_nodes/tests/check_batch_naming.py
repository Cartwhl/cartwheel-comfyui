"""Check GLB socket/file handoff using a ComfyUI checkout, without an API call."""

import asyncio
import importlib.util
from pathlib import Path
import sys
import struct
import json
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import av


comfy_root = Path(sys.argv[1]).resolve()
package_root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(comfy_root))
temporary = TemporaryDirectory(prefix="cartwheel-glb-check-")
base = Path(temporary.name)
sys.argv = [sys.argv[0], "--cpu", "--base-directory", str(base)]

import comfy.options
comfy.options.enable_args_parsing()
from comfy_api.latest import InputImpl, Types
from comfy_execution.validation import validate_node_input
from comfy_extras.nodes_load_3d import Preview3DAdvanced

spec = importlib.util.spec_from_file_location("cartwheel_glb_check", package_root / "__init__.py", submodule_search_locations=[str(package_root)])
package = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = package
spec.loader.exec_module(package)
from cartwheel_glb_check import nodes
from cartwheel_glb_check.config import Connection
from cartwheel_glb_check.media import inspect_video


async def check():
    (base / "temp").mkdir()
    output_dir = base / "output" / "cartwheel" / "fixture"
    output_dir.mkdir(parents=True)
    video_path = output_dir / "preview.mp4"
    with av.open(str(video_path), "w") as output:
        stream = output.add_stream("libx264", rate=24)
        stream.width, stream.height, stream.pix_fmt = 32, 32, "yuv420p"
        for _ in range(3):
            frame = av.VideoFrame(32, 32, "yuv420p")
            for plane in frame.planes:
                plane.update(bytes(plane.buffer_size))
            for packet in stream.encode(frame):
                output.mux(packet)
        for packet in stream.encode():
            output.mux(packet)
    fbx_path = output_dir / "character.fbx"
    fbx_path.write_bytes(b"mock FBX bytes for backend file handoff")
    export_path = output_dir / "motion.glb"
    glb_json = json.dumps({"asset": {"version": "2.0"}, "scene": 0, "scenes": [{"nodes": []}]}).encode()
    glb_json += b" " * (-len(glb_json) % 4)
    export_path.write_bytes(struct.pack("<4sII", b"glTF", 2, 20 + len(glb_json)) + struct.pack("<I4s", len(glb_json), b"JSON") + glb_json)
    manifest = {"motions": [{"assets": {"preview": str(video_path), "mhr_0": str(fbx_path), "export_0": str(export_path)}}]}
    manifest["source"] = {"path": str(video_path), "metadata": inspect_video(video_path)}
    mocked_capture = AsyncMock(return_value=manifest)
    video = InputImpl.VideoFromFile(str(video_path))
    source_schema = nodes.CartwheelPerformanceCapture.define_schema()
    defaults = {item.id: item.default for item in source_schema.inputs if hasattr(item, "default")}
    expected = {"comicModel": "comic4", "numPeople": 1, "facialCapture": True, "footPlanting": True,
                "qualityPreset": "smoothed", "loop": False,
                "exportSettings": {"characterID": "char-upload-MHR", "exportType": "glb", "frameRate": 60.0,
                                   "includeMesh": True, "keyframeCleaning": "none", "forward": "-Z", "up": "Y",
                                   "frameStepSize": 1, "moveInPlace": False}}
    with patch.object(nodes, "connection", return_value=Connection("test-secret")), patch.object(nodes, "capture", mocked_capture), patch.object(nodes, "scene_outputs", return_value=({"fixture_motion":True},{"fixture_camera":True})):
        assert nodes.CartwheelPerformanceCapture.fingerprint_inputs() == nodes.CartwheelPerformanceCapture.fingerprint_inputs()
        result = await nodes.CartwheelPerformanceCapture.execute(video=video, **defaults)
        assert mocked_capture.call_args.args[3] == expected
        await nodes.CartwheelPerformanceCapture.execute(video=video, **(defaults | {"numPeople": 4, "qualityPreset": "Detailed (slower)", "facialCapture": False, "footPlanting": False,
                                                                                   "frameRate": "120", "keyframeCleaning": "Rebuild curves"}))
        sent = mocked_capture.call_args.args[3]
        assert sent == expected | {"numPeople": 4, "qualityPreset": "detailed", "facialCapture": False, "footPlanting": False,
                                   "exportSettings": expected["exportSettings"] | {"frameRate": 120.0, "keyframeCleaning": "simplify"}}
        for actors, fps in zip([1, 2, 3, 4], ["24", "30", "60", "120"]):
            await nodes.CartwheelPerformanceCapture.execute(video=video, **(defaults | {"numPeople": actors, "frameRate": fps, "qualityPreset": "Balanced"}))
            sent = mocked_capture.call_args.args[3]
            assert sent["numPeople"] == actors and sent["exportSettings"]["frameRate"] == float(fps) and sent["qualityPreset"] == "balanced"
        await nodes.CartwheelPerformanceCapture.execute(video=video, **defaults, batchName="Ignored legacy label")
        assert "batchName" not in mocked_capture.call_args.args[3]
        for invalid in [{"numPeople": 0}, {"numPeople": 5}, {"numPeople": True}, {"numPeople": 1.5}, {"frameRate": "25"}, {"qualityPreset": "smoothed"}, {"keyframeCleaning": "reduce"}]:
            calls = mocked_capture.call_count
            try:
                await nodes.CartwheelPerformanceCapture.execute(video=video, **(defaults | invalid))
            except ValueError:
                pass
            else:
                raise AssertionError(f"Invalid input was accepted: {invalid}")
            assert mocked_capture.call_count == calls, "Invalid input reached remote capture."
    assert len(result.result) == 11
    assert result[9] == {"fixture_motion":True} and result[10] == {"fixture_camera":True}
    assert Path(result[4].get_stream_source()).samefile(video_path)
    assert json.loads(result[5])["frame_count"] == 3
    assert result.result[6:9] == (24.0, 3, 0.125)
    assert result[1] is manifest
    assert isinstance(result[2], Types.File3D) and result[2].format == "glb"
    assert result[2].get_source() == str(export_path)
    assert result[3] == str(export_path)
    assert "batchName" not in [item.id for item in source_schema.inputs]
    assert defaults["numPeople"] == 1 and defaults["frameRate"] == "60"
    print("PASS: Performance Capture has no name widget; omitted API batchName, ignored legacy names, actor/export settings and invalid-input checks; mocked capture, zero paid calls.")
try:
    with patch.object(nodes, "ComfyAPI", return_value=SimpleNamespace(execution=SimpleNamespace(set_progress=AsyncMock()))):
        asyncio.run(check())
finally:
    temporary.cleanup()
