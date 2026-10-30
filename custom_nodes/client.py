from .submission_identity import request_state_path
import asyncio
import hashlib
import json
import shutil
import struct
import time
from pathlib import Path
from urllib.parse import quote
from uuid import uuid4

import aiohttp
from filelock import FileLock, Timeout

from .config import Connection
from .transport import validate_asset_url, MAX_DOWNLOAD_BYTES


class CartwheelError(RuntimeError):
    pass


class ApiError(CartwheelError):
    def __init__(self, status, route, message=""):
        self.status = status
        detail = f" {message}" if message else " No additional error details were returned."
        super().__init__(f"Cartwheel returned HTTP {status} for {route}.{detail}")


class Client:
    def __init__(self, connection: Connection, session: aiohttp.ClientSession):
        self.connection = connection
        self.session = session

    async def api(self, method, route, *, body=None, params=None):
        try:
            async with self.session.request(
                method, self.connection.base_url + route,
                headers={"x-api-key": self.connection.api_key, "Accept": "application/json"},
                json=body, params=params, allow_redirects=False,
            ) as response:
                if not 200 <= response.status < 300:
                    # Provider messages may contain worker details, paths or signed
                    # links. Present client-owned guidance rather than raw errors.
                    message = {
                        400: "Request rejected. Check the input and selected settings.",
                        401: "Check your Cartwheel API key.",
                        402: "The Cartwheel account has insufficient credits.",
                        403: "Check your Cartwheel API key and account permissions.",
                        404: "The requested Cartwheel resource is unavailable to this account.",
                        429: "Cartwheel rate limited this request. No submission was automatically retried.",
                    }.get(response.status, "The Cartwheel service could not complete this request. No submission was automatically retried.")
                    raise ApiError(response.status, route, message)
                result = await response.json()
                if not isinstance(result, dict):
                    raise ValueError("Invalid API response")
                return result
        except (aiohttp.ClientError, asyncio.TimeoutError, ValueError):
            raise CartwheelError(f"Cartwheel {route} request could not be completed. No submission was automatically retried.") from None

    async def pages(self, route, field):
        items, token, seen = [], None, set()
        while True:
            params = {"limit": "100"}
            if token:
                params["nextToken"] = token
            page = await self.api("GET", route, params=params)
            if not isinstance(page.get(field), list):
                raise CartwheelError("Cartwheel returned an invalid paginated response.")
            items.extend(page[field])
            token = page.get("nextToken")
            if token is not None and (not isinstance(token, str) or len(token) > 16384):
                raise CartwheelError("Cartwheel returned an invalid pagination token.")
            if not token:
                return items
            if token in seen:
                raise CartwheelError("Cartwheel returned a repeated pagination token.")
            seen.add(token)

    async def upload(self, url, path):
        require_https(url)
        try:
            with path.open("rb") as media:
                async with self.session.put(url, data=media, headers={"Content-Type": "application/octet-stream"}, allow_redirects=False,
                                            timeout=aiohttp.ClientTimeout(total=600)) as response:
                    if not 200 <= response.status < 300:
                        raise CartwheelError(f"Cartwheel media transfer failed (HTTP {response.status}).")
        except (aiohttp.ClientError, asyncio.TimeoutError):
            raise CartwheelError("Cartwheel media transfer could not be completed.") from None

    async def download(self, url, destination, check_interrupt):
        require_https(url)
        temporary = destination.with_suffix(destination.suffix + ".part")
        try:
            async with self.session.get(url, allow_redirects=False, timeout=aiohttp.ClientTimeout(total=600)) as response:
                if not 200 <= response.status < 300:
                    raise CartwheelError(f"Cartwheel asset download failed (HTTP {response.status}). Run again to refresh its link; the acknowledged capture will be reused.")
                if (getattr(response, "content_length", None) or 0) > MAX_DOWNLOAD_BYTES:
                    raise CartwheelError("A Cartwheel asset exceeds the 1 GiB download limit.")
                size = 0
                with temporary.open("wb") as output:
                    async for chunk in response.content.iter_chunked(1024 * 1024):
                        check_interrupt()
                        size += len(chunk)
                        if size > MAX_DOWNLOAD_BYTES:
                            raise CartwheelError("A Cartwheel asset exceeds the 1 GiB download limit.")
                        output.write(chunk)
            if temporary.stat().st_size == 0:
                raise CartwheelError("Cartwheel returned an empty asset.")
            temporary.replace(destination)
        except (aiohttp.ClientError, asyncio.TimeoutError):
            raise CartwheelError("Cartwheel asset download could not be completed. Run again to resume the acknowledged capture.") from None
        finally:
            temporary.unlink(missing_ok=True)


def require_https(url):
    try:
        validate_asset_url(url)
    except ValueError as error:
        raise CartwheelError(str(error)) from None


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.chmod(0o600)
    temporary.replace(path)


def file_hash(path):
    digest = hashlib.sha256()
    with path.open("rb") as media:
        for chunk in iter(lambda: media.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_glb(path):
    if path.suffix.lower() != ".glb":
        raise CartwheelError("Cartwheel returned a different export format instead of GLB. Downloaded files were retained; changing the extension does not convert them.")
    with path.open("rb") as stream:
        header = stream.read(12)
    if path.stat().st_size < 20 or len(header) != 12 or struct.unpack("<4sII", header) != (b"glTF", 2, path.stat().st_size):
        raise CartwheelError("Cartwheel returned an invalid GLB header. Downloaded files were retained for inspection.")


def asset_slots(item, export_type):
    export_extension = ".fbx" if export_type.startswith("fbx-") else "." + export_type
    slots = {"preview": (item.get("studioPreviewURL"), ".mp4"), "camera": (item.get("cameraFbxURL"), ".fbx")}
    for field, label, extension in [
        ("bvhURLs", "body", ".bvh"),
        ("mhrBvhURLs", "mhr_body", ".bvh"), ("mhrIdentityJsonURLs", "mhr_identity", ".json"),
        ("exportURLs", "export", export_extension),
    ]:
        for index, url in enumerate(item.get(field) or []):
            suffix = extension
            if field == "exportURLs":
                names = item.get("exportFilenames") or []
                suffix = Path(names[index]).suffix.lower() if index < len(names) and names[index] else extension
                if suffix not in {".glb", ".gltf", ".fbx", ".bvh", ".ma", ".mb", ".usd", ".usda", ".usdz", ".json"}:
                    raise CartwheelError("Cartwheel returned an unsupported export filename extension.")
            slots[f"{label}_{index}"] = (url, suffix)
    if "body_0" not in slots and item.get("bvhURL"):
        slots["body_0"] = (item["bvhURL"], ".bvh")
    for index, face in enumerate(item.get("faceURLs") or []):
        # Cartwheel's public Comic 4 workflow documents this historical FBX field.
        slots[f"mhr_{index}"] = (face.get("bvhURL") if face else None, ".fbx")
    return slots


async def capture(client, source, media_metadata, options, state_root, output_root, check_interrupt, progress, *, wait_seconds=3600, poll_seconds=5, source_metadata=None,capture_version=0):
    source_hash = await asyncio.to_thread(file_hash, source)
    state_path, request_hash = request_state_path(state_root, {"source": source_hash, "account": client.connection.fingerprint}, options, version=capture_version)
    state_root.mkdir(parents=True, exist_ok=True)
    lock = FileLock(str(state_path.with_suffix(".lock")))
    while True:
        check_interrupt()
        try:
            lock.acquire(blocking=False)
            break
        except Timeout:
            await asyncio.sleep(0.5)
    try:
        state = json.loads(state_path.read_text()) if state_path.is_file() else {}
        if state:
            state["request_identity"] = request_hash
            write_json(state_path, state)
        capture_id=state.get('capture_id',request_hash)
        if not isinstance(capture_id,str) or len(capture_id)>80 or not all(c.isascii() and (c.isalnum() or c in '-_') for c in capture_id):raise CartwheelError('The saved capture journal is invalid. No new paid capture was submitted.')
        if state.get('phase')=='complete':
            path=output_root/state.get('capture_id',request_hash)/'capture.json'
            if path.is_file():
                saved=json.loads(path.read_text())
                assets=[p for item in saved.get('motions',[]) for p in item.get('assets',{}).values() if p]
                if assets and all(Path(p).resolve().is_relative_to(Path(output_root).resolve()) and Path(p).is_file() and Path(p).stat().st_size for p in assets):
                    saved_source=Path(saved.get('source',{}).get('path') or path.parent/('source'+source.suffix.lower()))
                    if saved_source.resolve().is_relative_to(Path(output_root).resolve()) and not saved_source.is_file():
                        await asyncio.to_thread(shutil.copyfile,source,saved_source)
                    await progress(100)
                    return saved
        if state.get('phase')=='complete' and state.get('batch_id'):
            # Missing local assets are downloaded from the acknowledged batch, not recaptured.
            state['phase']='submitted';write_json(state_path,state)
        if state.get("phase") in {"complete", "rejected", "failed"}:
            write_json(state_root / "history" / f"{state.get('capture_id', request_hash)}.json", state)
            state = {}
        if not state:
            state = {"phase": "preparing", "capture_id": str(uuid4()), "request_identity": request_hash}
            write_json(state_path, state)
        destination = output_root / state.get("capture_id", request_hash)
        destination.mkdir(parents=True, exist_ok=True)
        saved_source = destination / ("source" + source.suffix.lower())
        if not saved_source.is_file() or await asyncio.to_thread(file_hash, saved_source) != source_hash:
            temporary_source = saved_source.with_suffix(saved_source.suffix + ".part")
            await asyncio.to_thread(shutil.copyfile, source, temporary_source)
            temporary_source.replace(saved_source)
        if state.get("phase") == "submitting" and not state.get("batch_id"):
            raise CartwheelError("The previous capture submission has an unknown outcome. Another paid capture will not be sent automatically. Check Cartwheel for this job before recovery; see docs/usage.md.")
        if not state.get("batch_id"):
            check_interrupt()
            await progress(5)
            registration = await client.api("POST", "/media/upload", body={"media": [media_metadata]})
            upload = registration["mediaUploads"][0]
            await client.upload(upload["mediaUploadURL"], source)
            check_interrupt()
            state.update(phase="submitting", media_id=upload["mediaID"], source_sha256=source_hash,
                         batch_name=options.get("batchName"))
            write_json(state_path, state)
            request = dict(options)
            request["mediaIDs"] = [upload["mediaID"]]
            if state["batch_name"] is not None:
                request["batchName"] = state["batch_name"]
            else:
                request.pop("batchName", None)
            try:
                submitted = await client.api("POST", "/motion/fromVideo", body=request)
            except ApiError as error:
                if 400 <= error.status < 500 and error.status not in {408, 429}:
                    state["phase"] = "rejected"
                    write_json(state_path, state)
                raise
            state.update(phase="submitted", batch_id=submitted["batchID"])
            write_json(state_path, state)

        await progress(30)
        batch_id = quote(state["batch_id"], safe="")
        deadline = time.monotonic() + wait_seconds
        while True:
            check_interrupt()
            batch = await client.api("GET", f"/batch/{batch_id}")
            status = batch["status"]
            if status in {"FAILED", "REJECTED", "CANCELLED"}:
                state["phase"] = "failed"
                write_json(state_path, state)
                raise CartwheelError(f"Cartwheel capture is {status.lower()}. Its batch was retained. Running capture again submits a new paid job.")
            if status == "COMPLETED":
                break
            if time.monotonic() >= deadline:
                raise CartwheelError("Timed out waiting for Cartwheel. Run again to resume the existing batch.")
            await progress(50)
            await interruptible_sleep(poll_seconds, check_interrupt)

        # Formatted MHR exports may become available after capture completes.
        export_type = options["exportSettings"]["exportType"]
        while True:
            check_interrupt()
            items = await client.pages(f"/motions/{batch_id}", "items")
            if any(i["status"] in {"FAILED", "FLAGGED"} for i in items):
                state["phase"] = "failed"
                write_json(state_path, state)
                raise CartwheelError("Cartwheel returned a failed or flagged motion. The batch was retained. Running capture again submits a new paid job.")
            if items and all(i["status"] == "COMPLETED" and i.get("studioPreviewURL") and i.get("exportURLs") and all(i["exportURLs"]) and asset_slots(i, export_type).get("mhr_0", (None,))[0] for i in items):
                break
            if time.monotonic() >= deadline:
                raise CartwheelError("Cartwheel preview, native MHR FBX, or requested exports are not ready. Run again to resume this batch.")
            await progress(75)
            await interruptible_sleep(poll_seconds, check_interrupt)

        await progress(90)
        destination.mkdir(parents=True, exist_ok=True)
        motions = []
        for job_index, item in enumerate(items):
            paths = {}
            for label, (url, extension) in asset_slots(item, export_type).items():
                if not url:
                    paths[label] = None
                    continue
                target = destination / f"motion_{job_index}_{label}{extension}"
                if not target.is_file() or not target.stat().st_size:
                    await client.download(url, target, check_interrupt)
                paths[label] = str(target)
            motions.append({"job_id": item["jobID"], "assets": paths})
        manifest = {"schema_version": 1, "environment": client.connection.environment, "batch_id": state["batch_id"],
                    "source_sha256": source_hash, "title": str(media_metadata.get("name") or "Performance Capture")[:200], "capture_options": options, "motions": motions,
                    "source": {"path": str(saved_source), "media_id": state.get("media_id"), "metadata": source_metadata or {}}}
        write_json(destination / "capture.json", manifest)
        state["phase"] = "complete"
        write_json(state_path, state)
        await progress(100)
        return manifest
    finally:
        lock.release()


async def interruptible_sleep(seconds, check_interrupt):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        check_interrupt()
        await asyncio.sleep(min(0.5, deadline - time.monotonic()))
