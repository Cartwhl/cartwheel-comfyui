"""Swing Choreo through the public text-generation API, with resumable submissions."""
from .submission_identity import request_state_path
import asyncio
import json
from pathlib import Path
import time
from urllib.parse import quote
from uuid import uuid4

from filelock import FileLock, Timeout

from .client import ApiError, CartwheelError, asset_slots, interruptible_sleep, validate_glb, write_json


async def generate_motion(client, options, state_root, output_root, check_interrupt, progress,
                          *, wait_seconds=3600, poll_seconds=5):
    state_root, output_root = Path(state_root), Path(output_root)
    state_path, identity = request_state_path(state_root, {'account': client.connection.fingerprint}, options, output_root=output_root)
    state_root.mkdir(parents=True, exist_ok=True)
    lock = FileLock(str(state_path.with_suffix('.lock')))
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
            state['request_identity'] = identity
            write_json(state_path, state)
        if state.get('phase') in {'complete', 'rejected', 'failed'}:
            write_json(state_root / 'history' / f"{state['generation_id']}.json", state)
            state = {}
        if not state:
            state = {'phase': 'preparing', 'generation_id': str(uuid4()), 'request_identity': identity}
            write_json(state_path, state)
        if state.get('phase') == 'submitting' and not state.get('batch_id'):
            raise CartwheelError('The previous Swing Choreo submission has an unknown outcome. Another paid job will not be sent automatically. Check Cartwheel history before recovery; see docs/swing-choreo.md.')
        if not state.get('batch_id'):
            check_interrupt()
            await progress(5)
            state['phase'] = 'submitting'
            write_json(state_path, state)
            try:
                submitted = await client.api('POST', '/motion/fromText', body=options)
            except ApiError as error:
                if 400 <= error.status < 500 and error.status not in {408, 429}:
                    state['phase'] = 'rejected'
                    write_json(state_path, state)
                raise
            if not isinstance(submitted, dict) or not isinstance(submitted.get('batchID'), str) or not submitted['batchID']:
                raise CartwheelError('Cartwheel did not acknowledge the Swing Choreo job with a batch ID. Check history before retrying; another job will not be sent automatically.')
            state.update(phase='submitted', batch_id=submitted['batchID'])
            write_json(state_path, state)
        deadline = time.monotonic() + wait_seconds
        batch_id = quote(state['batch_id'], safe='')
        while True:
            check_interrupt()
            batch = await client.api('GET', f'/batch/{batch_id}')
            status = batch.get('status')
            if status in {'FAILED', 'REJECTED', 'CANCELLED'}:
                state['phase'] = 'failed'; write_json(state_path, state)
                raise CartwheelError(f'Swing Choreo is {status.lower()}. Its job was retained. Running generation again submits a new paid job.')
            if status == 'COMPLETED':
                break
            if time.monotonic() >= deadline:
                raise CartwheelError('Timed out waiting for Swing Choreo. Run again to resume the existing job.')
            await progress(35)
            await interruptible_sleep(poll_seconds, check_interrupt)
        # Text generation can return actors without a captured camera, native FBX,
        # or thumbnail. Only the requested actor GLBs are necessary for the editor.
        while True:
            check_interrupt()
            items = await client.pages(f'/motions/{batch_id}', 'items')
            if any(item.get('status') in {'FAILED', 'FLAGGED', 'REJECTED', 'CANCELLED'} for item in items):
                state['phase'] = 'failed'; write_json(state_path, state)
                raise CartwheelError('Swing Choreo returned a failed or flagged motion. Its job was retained. Running generation again submits a new paid job.')
            if len(items) > 1:
                raise CartwheelError('Cartwheel returned an unexpected job list. The acknowledged job was retained; no additional generation was submitted.')
            if items and items[0].get('status') == 'COMPLETED':
                exports = items[0].get('exportURLs') or []
                if len(exports) > 4:
                    raise CartwheelError('The camera editor supports up to four actor GLBs. The generated job was retained in Cartwheel history.')
                if exports and all(exports):
                    slots = asset_slots(items[0], 'glb')
                    if any(extension != '.glb' for label, (_, extension) in slots.items() if label.startswith('export_')):
                        raise CartwheelError('Swing Choreo returned a different export format instead of GLB. The job was retained.')
                    break
            if time.monotonic() >= deadline:
                raise CartwheelError('Swing Choreo GLB exports are not ready. Run again to resume the existing job.')
            await progress(75)
            await interruptible_sleep(poll_seconds, check_interrupt)
        destination = output_root / state['generation_id']
        destination.mkdir(parents=True, exist_ok=True)
        paths = {}
        available = sum(bool(url) for url, _ in slots.values())
        downloaded = 0
        for label, (url, extension) in slots.items():
            check_interrupt()
            if not url:
                paths[label] = None
                continue
            target = destination / f'motion_0_{label}{extension}'
            if not target.is_file() or not target.stat().st_size:
                await client.download(url, target, check_interrupt)
            if extension == '.glb':
                try:
                    validate_glb(target)
                except CartwheelError:
                    target.unlink(missing_ok=True)
                    raise
            paths[label] = str(target)
            downloaded += 1
            await progress(50 + int(45 * downloaded / available))
        manifest = {'schema_version': 1, 'environment': client.connection.environment,
                    'origin': 'text_generation', 'batch_id': state['batch_id'], 'title': options['prompts'][0][:200],
                    'generation_options': options, 'motions': [{'job_id': items[0]['jobID'], 'assets': paths}]}
        write_json(destination / 'capture.json', manifest)
        state['phase'] = 'complete'; write_json(state_path, state)
        await progress(100)
        return manifest
    finally:
        lock.release()
