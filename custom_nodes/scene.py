import json
from pathlib import Path

from .fbx_metadata import read_metadata
from .glb_metadata import read_metadata as glb_metadata


def capture_files(output_root):
    root = Path(output_root) / "cartwheel"
    return [str(path.relative_to(root)) for path in sorted(root.glob("*/capture.json"), key=lambda path: path.stat().st_mtime, reverse=True)]


def load_capture(output_root, capture_file):
    root = (Path(output_root) / "cartwheel").resolve()
    path = (root / capture_file).resolve()
    if not capture_file or not path.is_relative_to(root) or path.name != "capture.json" or not path.is_file():
        raise ValueError("Choose a saved Cartwheel capture.json from the ComfyUI output/cartwheel folder.")
    return json.loads(path.read_text())


def scene_preview(capture, output_root, motion_index):
    root = Path(output_root).resolve()
    capture_root = root / "cartwheel"
    if not isinstance(capture, dict) or capture.get("schema_version") != 1:
        raise ValueError("Connect a Cartwheel capture or load a saved Cartwheel capture.")
    motions = capture.get("motions", [])
    if type(motion_index) is not int or not 0 <= motion_index < len(motions):
        raise ValueError("This capture has no motion at the selected index.")
    assets = motions[motion_index]["assets"]

    def asset(path, *, glb=False):
        if not isinstance(path, str):
            raise ValueError("The capture is missing a required FBX asset.")
        path = Path(path).resolve()
        if not path.is_file() or path.suffix.lower() != (".glb" if glb else ".fbx"):
            raise ValueError("Camera preview requires downloaded GLB/FBX assets inside ComfyUI output/cartwheel.")
        # samefile also handles differently cased paths on macOS/Windows.
        ancestor = next((parent for parent in path.parents if capture_root.is_dir() and parent.samefile(capture_root)), None)
        if ancestor is None:
            raise ValueError("Camera preview requires downloaded GLB/FBX assets inside ComfyUI output/cartwheel.")
        metadata = glb_metadata(path) if glb else {"format": "fbx", **read_metadata(path)}
        relative = path.parent.relative_to(ancestor)
        return {"filename": path.name, "subfolder": (Path("cartwheel") / relative).as_posix(), "type": "output", **metadata}

    slots = sorted({int(name.partition("_")[2]) for name in assets
                    if name.startswith(("mhr_", "export_")) and name.partition("_")[2].isdigit()})
    actors = []
    for slot in slots:
        exported, native = assets.get(f"export_{slot}"), assets.get(f"mhr_{slot}")
        if exported and Path(exported).suffix.lower() == ".glb":
            actor = {"actor": slot + 1, **asset(exported, glb=True)}
            if native:
                # Verify GLB alignment; retain the original actor for an explicit native fallback.
                actor["native_reference"] = asset(native)
                actor["export_duration"] = actor["duration"]
                actor["duration"] = actor["native_reference"]["duration"] or actor["duration"]
            actors.append(actor)
        elif native:
            actors.append({"actor": slot + 1, **asset(native)})
    if not actors:
        raise ValueError("The capture has no GLB or native MHR actors to preview.")
    camera = asset(assets.get("camera"))
    if not camera["cameras"]:
        raise ValueError("The captured FBX contains no camera.")
    if any(item["projection"] != 0 for item in camera["cameras"]):
        raise ValueError("Camera preview currently supports captured perspective cameras.")
    return {"actors": actors, "camera": camera}
