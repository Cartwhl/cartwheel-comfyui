"""Synthetic files matching the browser renderer's output contract."""
import json
from pathlib import Path
import shutil
from PIL import Image
from test_media import make_video


def make_render(path, *, frames=48, fps=24):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    make_video(path, frames=frames, fps=fps, audio=False)
    for kind in ("depth", "normal", "pose"):
        shutil.copyfile(path, path.with_name(path.stem + "_" + kind + ".mp4"))
    for endpoint in ("first", "last"):
        Image.new("RGB", (64, 64), (96, 96, 96)).save(path.with_suffix("." + endpoint + ".png"))
    duration = frames / fps
    camera = {
        "schema_version": 1, "units": "meters", "up": "Y", "fps": fps,
        "aspect": 1.0, "frames": [
            {"time": time, "position": [0, 2, 5], "quaternion": [0, 0, 0, 1], "fov": 35}
            for time in (0, duration)
        ], "pose_status": {"mapped_actors": [1]},
    }
    path.with_suffix(".camera.json").write_text(json.dumps(camera))
    return path
