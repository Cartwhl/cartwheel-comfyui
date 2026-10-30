"""Resolve original uploads through Cartwheel's documented read-only media endpoint."""

import asyncio
from pathlib import Path
import re
from urllib.parse import quote

from .client import CartwheelError
from .media import inspect_video


async def history_source(client, item, directory, check_interrupt):
    media_id = item.get('sourceVideoMediaID')
    if not media_id:
        return None, ['Original source video is unavailable for this entry. Connect the original video separately to prepare references.']
    if not isinstance(media_id, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}', media_id):
        return None, ['Cartwheel returned an invalid source media reference. The captured scene is still available.']
    directory = Path(directory)
    try:
        candidates = [p for p in directory.glob('source.*') if p.is_file() and p.suffix.lower() in {'.mp4', '.mov', '.webm', '.mkv', '.avi'}]
        if candidates:
            path = candidates[0]
        else:
            check_interrupt()
            result = await client.api('GET', '/media/' + quote(media_id, safe=''))
            extension = str(result.get('fileExtension', '')).lower().lstrip('.')
            if extension not in {'mp4', 'mov', 'webm', 'mkv', 'avi'} or not result.get('mediaDownloadURL'):
                raise ValueError('No supported original video was returned.')
            path = directory / ('source.' + extension)
            await client.download(result['mediaDownloadURL'], path, check_interrupt)
        metadata = await asyncio.to_thread(inspect_video, path)
        return {'path': str(path), 'media_id': media_id, 'metadata': metadata}, []
    except (CartwheelError, ValueError):
        return None, ['Original source video could not be retrieved or decoded. The motion/camera were retained; connect the original video separately.']
