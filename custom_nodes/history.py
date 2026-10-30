"""Read-only Cartwheel history and local capture downloads via the public API."""

import asyncio
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import urlsplit

from filelock import FileLock, Timeout

from .client import CartwheelError, asset_slots, validate_glb, write_json
from .source_media import history_source


EXPORT_EXTENSIONS = {".glb", ".fbx", ".bvh", ".ma", ".mb", ".usd", ".usda", ".usdz", ".json"}


def validate_motion_id(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}", value):
        raise ValueError("Choose a capture in Cartwheel history, then run the workflow.")
    return value


async def history_page(client, next_token=None, *, limit=25):
    if type(limit) is not int or not 1 <= limit <= 100:
        raise ValueError("History page size must be between 1 and 100.")
    if next_token is not None and (not isinstance(next_token, str) or len(next_token) > 16384):
        raise ValueError("Invalid history page. Refresh history and try again.")
    params = {"limit": str(limit), "sortAscending": "false"}
    if next_token:
        params["nextToken"] = next_token
    page = await client.api("GET", "/motions", params=params)
    if not isinstance(page, dict) or not isinstance(page.get("items"), list):
        raise CartwheelError("Cartwheel returned an invalid history response.")
    token = page.get("nextToken") or None
    if token is not None and (not isinstance(token, str) or len(token) > 16384 or token == next_token):
        raise CartwheelError("Cartwheel returned an invalid or repeated history page token. Refresh history.")
    return page["items"], token


def motion_source(item):
    # These are public text-motion scene fields, not guesses from camera presence.
    if item.get("durationSeconds") is not None and ("outputs" in item or "variations" in item):
        return "swing"
    if item.get("sourceVideoMediaID"):
        return "performance"
    return "unknown"


def local_motion_sources(output_root):
    result = {}
    for path in Path(output_root).glob("*/capture.json"):
        try:
            value = json.loads(path.read_text())
            kind = "swing" if value.get("generation_options", {}).get("requestedModel") == "swing_choreo" else "performance" if value.get("capture_options", {}).get("comicModel") == "comic4" else None
            if kind:
                for motion in value.get("motions", []):
                    result[motion["job_id"]] = kind
        except (OSError, ValueError, KeyError, TypeError):
            continue
    return result


def history_summary(item):
    """Allowlisted picker metadata; never expose signed asset URLs or credentials."""
    motion_id = validate_motion_id(item.get("jobID"))
    actors = max((sum(bool(value) for value in item.get(field) or [])
                  for field in ("faceURLs", "bvhURLs", "exportURLs")), default=0)
    if not actors and item.get("bvhURL"):
        actors = 1
    glb_slots, actor_slots = glb_export_slots(item)
    return {"motion_id": motion_id, "title": str(item.get("title") or motion_id)[:300],
            "created_at": str(item.get("createdAt") or "")[:50], "status": str(item.get("status") or "UNKNOWN")[:40],
            "source_kind": motion_source(item), "has_glb": bool(glb_slots),
            "glb_compatible": bool(actor_slots) and actor_slots <= glb_slots,
            "actors": actors, "has_camera": bool(item.get("cameraFbxURL")),
            "has_native_actors": any(face and face.get("bvhURL") for face in item.get("faceURLs") or [])}


async def find_history_motion(client, motion_id, check_interrupt):
    validate_motion_id(motion_id)
    token, seen = None, set()
    while True:
        check_interrupt()
        items, token = await history_page(client, token, limit=100)
        for item in items:
            if item.get("jobID") == motion_id:
                return item
        if not token:
            raise CartwheelError("This capture was not found in the selected Cartwheel API account. Check the API key and refresh history.")
        if token in seen:
            raise CartwheelError("Cartwheel returned a repeated history page token. Refresh history.")
        seen.add(token)


def history_assets(item):
    # Native fields are documented independently of the formatted export format.
    slots = asset_slots(item | {"exportURLs": [], "exportFilenames": []}, "bvh")
    warnings = []
    names = item.get("exportFilenames") or []
    for index, url in enumerate(item.get("exportURLs") or []):
        if not url:
            slots[f"export_{index}"] = (None, "")
            continue
        filename = names[index] if index < len(names) else None
        suffix = Path(filename or urlsplit(url).path).suffix.lower()
        if suffix not in EXPORT_EXTENSIONS:
            slots[f"export_{index}"] = (None, "")
            warnings.append(f"Export {index + 1} was not downloaded: its self-contained file format could not be identified or is unsupported.")
            continue
        slots[f"export_{index}"] = (url, suffix)
    return slots, warnings


def glb_export_slots(item):
    """Require a downloadable GLB for every actor; filenames and URL paths agree with the loader."""
    slots, _ = history_assets(item)
    glbs = {int(name.rsplit("_", 1)[1]) for name, (url, extension) in slots.items()
            if name.startswith("export_") and url and extension == ".glb"}
    actors = {int(name.rsplit("_", 1)[1]) for name, (url, _) in slots.items()
              if url and name.startswith(("body_", "mhr_", "export_"))}
    return glbs, actors


def has_glb_motion(item):
    glbs, actors = glb_export_slots(item)
    return bool(actors) and actors <= glbs


async def glb_history_page(client, next_token=None, *, limit=25, max_pages=5):
    """Skip incompatible pages, while retaining the API cursor for Load more."""
    token, seen = next_token, {next_token} if next_token else set()
    for _ in range(max_pages):
        items, token = await history_page(client, token, limit=limit)
        if token and token in seen:
            raise CartwheelError("Cartwheel returned a repeated history page token. Refresh history.")
        if token:
            seen.add(token)
        compatible = [item for item in items if has_glb_motion(item)]
        if compatible or not token:
            return compatible, token
    return [], token


async def load_history_capture(client, motion_id, state_root, output_root, check_interrupt, progress, *, require_glb=False):
    """Retrieve existing assets only. Never upload, generate, retarget, or export."""
    validate_motion_id(motion_id)
    await progress(5)
    item = await find_history_motion(client, motion_id, check_interrupt)
    if item.get("status") != "COMPLETED":
        raise CartwheelError("This history entry is not completed. Refresh history after processing finishes, or select another capture. No new capture was submitted.")
    if require_glb and not has_glb_motion(item):
        raise CartwheelError("This job does not have a GLB export for every actor. Refresh history and select a GLB job. No new capture or export was requested.")
    summary = history_summary(item)
    slots, warnings = history_assets(item)
    if not any(url for name, (url, _) in slots.items() if name not in {"preview", "camera"}):
        raise CartwheelError("This history entry has no downloadable motion assets. No new capture or export was requested.")
    if not summary["has_camera"]:
        warnings.append("No captured camera is available. Camera Preview starts with a default camera that you can edit.")
    if not summary["has_native_actors"] and not any(url and extension == ".glb" for name, (url, extension) in slots.items() if name.startswith("export_")):
        warnings.append("This capture has no GLB or native MHR actors; Camera Preview cannot display it.")
    identity = hashlib.sha256(f"{client.connection.fingerprint}\0{motion_id}".encode()).hexdigest()
    destination = Path(output_root) / f"history_{identity}"
    state_root = Path(state_root)
    state_root.mkdir(parents=True, exist_ok=True)
    lock = FileLock(str(state_root / f"history_{identity}.lock"))
    while True:
        check_interrupt()
        try:
            lock.acquire(blocking=False)
            break
        except Timeout:
            await asyncio.sleep(0.5)
    try:
        destination.mkdir(parents=True, exist_ok=True)
        paths = {}
        available = sum(bool(url) for url, _ in slots.values())
        count = 0
        for label, (url, extension) in slots.items():
            check_interrupt()
            if not url:
                paths[label] = None
                continue
            target = destination / f"motion_0_{label}{extension}"
            if not target.is_file() or not target.stat().st_size:
                await client.download(url, target, check_interrupt)
            if extension == ".glb":
                try:
                    validate_glb(target)
                except CartwheelError:
                    target.unlink(missing_ok=True)
                    raise
            paths[label] = str(target)
            count += 1
            await progress(10 + int(85 * count / available))
        source, source_warnings = await history_source(client, item, destination, check_interrupt)
        warnings.extend(source_warnings)
        manifest = {"schema_version": 1, "environment": client.connection.environment, "origin": "api_history",
                    "history_motion_id": motion_id, "title": summary["title"], "created_at": summary["created_at"],
                    "source": source, "warnings": warnings, "motions": [{"job_id": motion_id, "assets": paths}]}
        write_json(destination / "capture.json", manifest)
        await progress(100)
        return manifest
    finally:
        lock.release()
