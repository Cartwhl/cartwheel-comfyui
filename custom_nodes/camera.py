"""Versioned motion/camera handoff for the local editor and control renderer."""

import copy
import hashlib
import json
import math
from pathlib import Path

from .client import file_hash
from .scene import scene_preview
from .camera_presets import validate_preset
from .camera_format import DEFAULT_OUTPUT_FRAME, validate_output_frame
from .history import validate_motion_id


DEFAULT_SETTINGS = {"schema_version": 1, "mode": "captured", "camera_index": 0, "target_actor": None,
                    "start": None, "end": None, "manual_path": None, "world_frame_id": None, "preset": None, "history_camera": None, "output_frame": DEFAULT_OUTPUT_FRAME.copy()}


def history_camera_settings(value, actors=None):
    if not isinstance(value, dict):
        raise ValueError("Choose a camera from history, then click Load camera.")
    result = {"motion_id": validate_motion_id(value.get("motion_id"))}
    for key in ("source_actor", "reference_actor"):
        actor = value.get(key, 1)
        if type(actor) is not int or actor not in {1, 2, 3, 4}:
            raise ValueError("Choose a valid camera source and motion reference actor.")
        result[key] = actor
    if actors is not None and result["reference_actor"] not in actors:
        raise ValueError("The motion reference actor is unavailable. Choose an actor in this motion.")
    timing = value.get("timing", "stretch")
    if not isinstance(timing, str) or timing not in {"stretch", "hold"}:
        raise ValueError("Choose Fit motion duration or Original speed for the camera source.")
    result["timing"] = timing
    return result


def finite(value, label, lower, upper):
    if type(value) not in {int, float} or not math.isfinite(value) or not lower <= value <= upper:
        raise ValueError(f"{label} must be a finite number between {lower} and {upper}.")
    return value


def read_camera_settings(value):
    if isinstance(value, str):
        if len(value) > 8 * 1024 * 1024:
            raise ValueError("Camera settings are too large.")
        try:
            value = json.loads(value)
        except ValueError:
            raise ValueError("Camera settings could not be read. Reset the camera and try again.") from None
    if not isinstance(value, dict) or value.get("schema_version") != 1:
        raise ValueError("Unsupported camera settings version.")
    if value.get("mode") not in {"captured", "bookends", "preset", "history"}:
        raise ValueError("Choose Captured camera, Preset shot, or Manual path.")
    return value


def _single_camera_settings(value, actors, camera_count, world_frame_id, duration=None):
    value = read_camera_settings(value)
    index = value.get("camera_index")
    if type(index) is not int or not 0 <= index < camera_count:
        raise ValueError("The selected captured camera is unavailable.")
    target = value.get("target_actor")
    if target is not None and (type(target) is not int or target not in actors):
        raise ValueError("The camera target actor is unavailable. Choose an actor in this capture.")
    result = copy.deepcopy(DEFAULT_SETTINGS) | {k: value[k] for k in DEFAULT_SETTINGS if k in value}
    result["output_frame"] = validate_output_frame(result["output_frame"])
    if result["mode"] in {"captured", "history"}:
        result.update(start=None, end=None, target_actor=None, world_frame_id=None, preset=None, manual_path=None)
        result["history_camera"] = history_camera_settings(value.get("history_camera"), actors) if result["mode"] == "history" else None
        return result
    result["history_camera"] = None
    if result["world_frame_id"] != world_frame_id:
        raise ValueError("These camera edits belong to another capture. Reset to the captured camera before editing this capture.")
    if result["mode"] == "preset":
        result.update(start=None, end=None, target_actor=None, manual_path=None, preset=validate_preset(value.get("preset"), actors, duration))
        return result
    result["preset"] = validate_preset(value["preset"], actors, duration) if value.get("preset") is not None else None
    for endpoint in ("start", "end"):
        pose = value.get(endpoint)
        if not isinstance(pose, dict):
            raise ValueError("Set both the starting and ending camera views.")
        clean = {}
        for key in ("position", "target"):
            vector = pose.get(key)
            if not isinstance(vector, list) or len(vector) != 3:
                raise ValueError(f"Camera {endpoint} {key} needs X, Y and Z.")
            clean[key] = [finite(v, f"Camera {endpoint} {key}", -100000, 100000) for v in vector]
        clean["fov"] = finite(pose.get("fov"), "Vertical field of view", 5, 150)
        if target is None and sum((a-b)**2 for a,b in zip(clean["position"], clean["target"])) < 1e-10:
            raise ValueError("Camera position and target must be different.")
        result[endpoint] = clean
    path = value.get("manual_path")
    if path is not None:
        if not isinstance(path, dict) or path.get("kind") not in {"line", "curve"}:
            raise ValueError("Choose a straight or curved manual camera path.")
        if path.get("pacing", "linear") not in {"linear", "smooth"} or path.get("aim", "blend") not in {"blend", "fixed", "shot", "source"}:
            raise ValueError("Choose valid manual path pacing and aiming.")
        if path.get("framing_priority", "shot") not in {"shot", "lens", "reference"}:
            raise ValueError("Choose reference-frame framing for the manual path.")
        if path.get("aim") == "shot" and result["preset"] is None:
            raise ValueError("Choose subjects and framing for this manual path.")
        controls = path.get("controls")
        if controls is not None:
            if not isinstance(controls, list) or len(controls) != 2 or any(not isinstance(v, list) or len(v) != 3 for v in controls):
                raise ValueError("A curved path needs two XYZ curve handles.")
            controls = [[finite(v, "Curve handle", -100000, 100000) for v in point] for point in controls]
        if path["kind"] == "curve" and controls is None:
            raise ValueError("A curved path needs two XYZ curve handles.")
        points = path.get("points", [])
        if not isinstance(points, list) or len(points) > 5 or any(not isinstance(v, list) or len(v) != 3 for v in points):
            raise ValueError("A manual path supports up to 5 XYZ adjustment markers.")
        points = [[finite(v, "Path adjustment", -100000, 100000) for v in point] for point in points]
        result["manual_path"] = {"kind": path["kind"], "controls": controls, "pacing": path.get("pacing", "linear"), "aim": path.get("aim", "blend")}
        if "points" in path:
            result["manual_path"]["points"] = points
        if "point_handles" in path:
            handles=path["point_handles"]
            if not isinstance(handles,list) or len(handles)!=len(points) or any(not isinstance(pair,list) or len(pair)!=2 or any(not isinstance(v,list) or len(v)!=3 for v in pair) for pair in handles):
                raise ValueError("Each path adjustment needs an incoming and outgoing XYZ curve handle.")
            result["manual_path"]["point_handles"]=[[[finite(v,"Adjustment tangent",-100000,100000) for v in vector] for vector in pair] for pair in handles]
        for key in ("smooth_handles","source_static","lens_override"):
            if key in path:
                if type(path[key]) is not bool:raise ValueError("Invalid manual camera option.")
                result["manual_path"][key]=path[key]
        if "source_frames" in path:
            frames=path["source_frames"]
            if not isinstance(frames,list) or not 2<=len(frames)<=14401:raise ValueError("Invalid starting camera path.")
            clean_frames=[]
            for frame in frames:
                if not isinstance(frame,dict):raise ValueError("Invalid starting camera sample.")
                clean_frame={"time":finite(frame.get("time"),"Camera sample time",0,120),"fov":finite(frame.get("fov"),"Camera sample lens",5,180)}
                for key,length in (("position",3),("quaternion",4)):
                    vector=frame.get(key)
                    if not isinstance(vector,list) or len(vector)!=length:raise ValueError("Invalid starting camera transform.")
                    clean_frame[key]=[finite(v,"Camera sample transform",-100000 if key=="position" else -1,100000 if key=="position" else 1) for v in vector]
                if abs(sum(v*v for v in clean_frame["quaternion"])-1)>1e-4:raise ValueError("Invalid starting camera rotation.")
                if clean_frames and clean_frame["time"]<=clean_frames[-1]["time"]:raise ValueError("Starting camera samples must be ordered.")
                if 'cut' in frame:
                    if type(frame['cut']) is not bool:raise ValueError('Invalid camera cut.')
                    clean_frame['cut']=frame['cut']
                if 'lens_projection' in frame:
                    if not isinstance(frame['lens_projection'],str) or frame['lens_projection'] not in {'perspective','fisheye_equidistant'}:raise ValueError('Invalid source camera projection.')
                    clean_frame['lens_projection']=frame['lens_projection']
                clean_frames.append(clean_frame)
            if clean_frames[0]["time"]!=0 or duration is None or abs(clean_frames[-1]["time"]-duration)>1e-5:raise ValueError("Starting camera path must cover this motion.")
            result["manual_path"]["source_frames"]=clean_frames
            if 'position_interpolation' in path:
                if path['position_interpolation'] not in ('linear','cubic'):raise ValueError('Camera position interpolation must be linear or cubic.')
                result['manual_path']['position_interpolation']=path['position_interpolation']
        elif path.get("aim")=="source":raise ValueError("Starting camera samples are missing.")
        if "reference_fov" in path:
            upper = 180 if result["preset"] and result["preset"]["lens"] == "fisheye" else 150
            result["manual_path"]["reference_fov"] = finite(path["reference_fov"], "Saved manual lens", 5, upper)
        if "framing_priority" in path:
            result["manual_path"]["framing_priority"] = "reference"
    return result


def camera_settings(value, actors, camera_count, world_frame_id, duration=None):
    value = read_camera_settings(value)
    result = _single_camera_settings(value, actors, camera_count, world_frame_id, duration)
    if value.get('camera_timeline') is not None:
        from .camera_timeline import validate_camera_timeline
        result['camera_timeline'] = validate_camera_timeline(value['camera_timeline'], actors, camera_count, world_frame_id, duration, _single_camera_settings)
    return result


def motion_from_capture(capture, output_root, motion_index=0):
    scene = scene_preview(capture, output_root, motion_index)
    duration = max((a.get("duration") or 0 for a in [*scene["actors"], scene["camera"]]), default=0)
    finite(duration, "Native capture duration", 0.000001, 120)
    assets = capture["motions"][motion_index]["assets"]
    job_id = capture["motions"][motion_index].get("job_id", "")
    frame_id = hashlib.sha256(f'{job_id}\0{file_hash(Path(assets["camera"]))}'.encode()).hexdigest()
    world = {"id": frame_id, "units": "meters", "up": "Y", "handedness": "right"}
    root = Path(output_root).resolve()
    actors = []
    for actor in scene["actors"]:
        glb = assets.get(f'export_{actor["actor"]-1}')
        glb_reference = None
        if glb and Path(glb).suffix.lower() == ".glb":
            path = Path(glb).resolve()
            if not path.is_relative_to(root) or not path.is_file():
                raise ValueError("The motion GLB must exist inside the ComfyUI output directory.")
            glb_reference = {"filename": path.name, "subfolder": path.parent.relative_to(root).as_posix(), "type": "output"}
        actors.append({"id": actor["actor"], "glb": glb_reference})
    return {"schema_version": 1, "world_frame": world,
            "timeline": {"duration": duration, "start_seconds": 0, "basis": "native_capture"},
            "actors": actors, "scene": scene}


def with_camera_source(motion, source, source_actor=1, reference_actor=1, timing="stretch"):
    """Register a captured camera to another motion without changing actor assets."""
    for label, actor, owner in [("Camera source actor", source_actor, source),
                                ("Motion reference actor", reference_actor, motion)]:
        if type(actor) is not int or actor not in [item["id"] for item in owner["actors"]]:
            raise ValueError(f"{label} is unavailable. Choose an actor present in that capture.")
    if not isinstance(timing, str) or timing not in {"stretch", "hold"}:
        raise ValueError("Choose Fit motion duration or Original speed for the camera source.")
    result = copy.deepcopy(motion)
    selected = next(item for item in source["scene"]["actors"] if item["actor"] == source_actor)
    # Prefer the already-native rig for registration; no hidden GLB retiming is needed.
    anchor = copy.deepcopy(selected.get("native_reference", selected))
    anchor["actor"] = source_actor
    transfer = {"schema_version": 1, "source_actor": anchor, "reference_actor": reference_actor,
                "timing": timing, "source_duration": source["timeline"]["duration"],
                "target_duration": motion["timeline"]["duration"],
                "source_frame_id": source["world_frame"]["id"]}
    identity = {"motion": motion["world_frame"]["id"], "transfer": transfer}
    result["world_frame"]["id"] = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
    result["scene"].update(motion_camera=copy.deepcopy(motion["scene"]["camera"]),
                            camera=copy.deepcopy(source["scene"]["camera"]), camera_transfer=transfer)
    return result


def make_camera(motion, settings):
    clean = camera_settings(settings, [a["id"] for a in motion["actors"]],
                            len(motion["scene"]["camera"]["cameras"]), motion["world_frame"]["id"], motion["timeline"]["duration"])
    if clean["mode"] == "history":
        transfer = motion["scene"].get("camera_transfer")
        selected = clean["history_camera"]
        if not transfer or (transfer["source_actor"]["actor"], transfer["reference_actor"], transfer["timing"]) != (
                selected["source_actor"], selected["reference_actor"], selected["timing"]):
            raise ValueError("Load the selected history camera before rendering this motion.")
    return {"schema_version": 1, "world_frame": copy.deepcopy(motion["world_frame"]), "timeline": copy.deepcopy(motion["timeline"]), "settings":clean}


CAPTURE_CHANGED_NOTICE = "New motion loaded. Previous camera edits were reset to this motion’s starting camera. Click Edit camera to create a shot for this motion."


def make_editor_camera(motion, settings):
    """Allow an editor to switch captures; render contracts remain strict."""
    value = read_camera_settings(settings)
    previous_frame = value.get("camera_timeline", {}).get("world_frame_id", value.get("world_frame_id"))
    changed = ((value["mode"] in {"bookends", "preset"} or value.get("camera_timeline")) and isinstance(previous_frame, str)
               and bool(previous_frame) and previous_frame != motion["world_frame"]["id"])
    if changed:
        # Coordinates, actor selections and reference times belong to the old
        # motion. Only the independent output format survives a capture switch.
        value = copy.deepcopy(DEFAULT_SETTINGS) | {"output_frame": value.get("output_frame", DEFAULT_OUTPUT_FRAME)}
    return make_camera(motion, value), CAPTURE_CHANGED_NOTICE if changed else None


def validate_render_camera(motion, camera):
    if not isinstance(motion, dict) or motion.get("schema_version") != 1 or not isinstance(camera, dict) or camera.get("schema_version") != 1:
        raise ValueError("Connect motion and camera outputs from Cartwheel Camera.")
    if camera.get("world_frame") != motion.get("world_frame") or camera.get("timeline") != motion.get("timeline"):
        raise ValueError("Motion and camera must use the same capture coordinate frame and timeline.")
    finite(motion["timeline"]["duration"], "Native capture duration", 0.000001, 120)
    return make_camera(motion, camera.get("settings"))
