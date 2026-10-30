"""Source media inspection and reference preparation; no model calls."""

import math
from pathlib import Path

import av
import numpy as np
import torch


DEFAULT_PROMPT = 'Follow Video 1 exactly for motion, timing, blocking and camera movement. Keep the same framing from start to finish, with no added zooms, cuts or close-ups. Use Video 1 for motion only, not for its look. Re-render the scene to match the reference images or description.\n\nCinematic, photoreal, shot on film. Natural, motivated lighting that fits the scene, with film grain and realistic texture.\n\nAvoid: changing the motion or framing, added zooms or cuts, letterbox bars, a CGI or digital look.'
MODEL_LIMITS = {"Seedance 2.5": (4, 30), "MiniMax H3": (4, 15)}


def inspect_video(path):
    """Count frames without retaining image tensors, including variable-rate inputs."""
    path = Path(path)
    try:
        with av.open(str(path)) as media:
            if not media.streams.video:
                raise ValueError('The selected file contains no video stream.')
            stream = media.streams.video[0]
            rate = stream.average_rate or stream.guessed_rate
            if rate is None or rate <= 0:
                raise ValueError('The source video has no readable frame rate.')
            count, intervals, previous = 0, set(), None
            for frame in media.decode(video=0):
                count += 1
                if frame.pts is not None:
                    if previous is not None:
                        intervals.add(frame.pts-previous)
                    previous = frame.pts
            if not count:
                raise ValueError('The selected video contains no decodable frames.')
            duration = float(stream.duration * stream.time_base) if stream.duration else count / float(rate)
            if not math.isfinite(duration) or duration <= 0 or stream.width <= 0 or stream.height <= 0:
                raise ValueError('The source video has invalid timing or dimensions.')
            return {'width': stream.width, 'height': stream.height, 'duration': duration,
                    'fps': float(rate), 'fps_numerator': rate.numerator, 'fps_denominator': rate.denominator,
                    'frame_count': count, 'variable_frame_rate': bool(intervals and max(intervals)-min(intervals) > 1),
                    'time_base_numerator': stream.time_base.numerator, 'time_base_denominator': stream.time_base.denominator,
                    'has_audio': bool(media.streams.audio),
                    'video_start_seconds': float((stream.start_time or 0) * stream.time_base),
                    'audio_start_seconds': float((media.streams.audio[0].start_time or 0) * media.streams.audio[0].time_base) if media.streams.audio else None,
                    'size_bytes': path.stat().st_size}
    except (av.FFmpegError, OSError):
        raise ValueError('The source video could not be read. Choose a supported, playable video file.') from None


def validate_capture_video(info):
    if info['duration'] > 30.000001:
        raise ValueError(f"Cartwheel source is {info['duration']:.3f}s; maximum is 30 seconds. Use Trim Video before capture.")
    if info['size_bytes'] >= 250_000_000:
        raise ValueError('Cartwheel source must be smaller than 250 MB. Trim or re-encode it before capture.')


def validate_references(model, duration, requested_duration=0):
    if model not in MODEL_LIMITS:
        raise ValueError('Choose Seedance 2.5 or MiniMax H3.')
    minimum, maximum = MODEL_LIMITS[model]
    if not math.isfinite(duration) or duration < 1.8 - 0.000001 or duration > maximum + 0.000001:
        raise ValueError(f'{model} reference video is {duration:.3f}s; supported range is 1.8–{maximum} seconds. '
                         'Choose a longer reference window within the model limit.')
    target = max(minimum, min(maximum, int(math.ceil(duration-1e-7)))) if requested_duration == 0 else requested_duration
    if type(target) is not int or not minimum <= target <= maximum:
        raise ValueError(f'{model} output duration must be {minimum}–{maximum} whole seconds. '
                         f'Auto rounded this reference to {target}s; choose Output duration explicitly or trim the reference.')
    if target+1e-6<duration:raise ValueError('Output seconds must cover the selected camera window. Use Auto or shorten the reference window.')
    return target


def reference_windows(model, available, *, start=0, duration=0, end=0,
                      secondary_available=None, secondary_start=0, secondary_duration=0):
    """Select bounded windows, sharing the provider's aggregate video allowance."""
    if model not in MODEL_LIMITS:
        raise ValueError('Choose Seedance 2.5 or MiniMax H3.')
    for name, value in [('Video duration', available), ('Start', start), ('Duration', duration), ('End', end),
                        ('Second video start', secondary_start), ('Second video duration', secondary_duration)]:
        if type(value) not in {int, float} or not math.isfinite(value) or value < 0:
            raise ValueError(f'{name} must be a finite, nonnegative number of seconds.')
    if start >= available:
        raise ValueError('Start must be before the end of the camera video.')
    if end and end <= start:
        raise ValueError('End must be after Start, or zero for automatic.')
    if end and duration:
        raise ValueError('Set Duration or End, not both. Leave the other at zero.')
    maximum = MODEL_LIMITS[model][1]
    notes, second = [], None
    reserve = 0
    if secondary_available is not None:
        if (type(secondary_available) not in {int, float} or not math.isfinite(secondary_available)
                or secondary_available <= secondary_start):
            raise ValueError('Second video start must be before its end.')
        remaining = secondary_available - secondary_start
        reserve = min(remaining, secondary_duration or maximum / 2)
        if reserve < 1.8:
            raise ValueError('The second video needs at least 1.8 seconds of available reference footage.')
        reserve = min(reserve, maximum - 1.8)
    requested = (end - start) if end else (duration or available - start)
    seconds = min(requested, available - start, maximum - reserve)
    if seconds < 1.8 - 1e-6:
        raise ValueError('The camera reference needs at least 1.8 seconds. Choose an earlier Start or a longer Duration.')
    if requested > seconds + 1e-6:
        notes.append('Camera reference was limited to the available footage and the model video allowance.')
    if secondary_available is not None:
        second_seconds = min(secondary_available - secondary_start, secondary_duration or maximum - seconds, maximum - seconds)
        if second_seconds < 1.8 - 1e-6:
            raise ValueError('Leave at least 1.8 seconds of the shared video allowance for the second video.')
        second = {'start': secondary_start, 'duration': second_seconds, 'end': secondary_start + second_seconds}
        notes.append(f'The two video references share the {maximum}-second total allowance.')
    return {'start': start, 'duration': seconds, 'end': start + seconds,
            'secondary': second, 'maximum': maximum, 'notes': notes}


def trim_audio(audio, seconds, *, start=0):
    """Trim a core AUDIO reference without changing its rate or channel layout."""
    if not isinstance(audio, dict) or type(audio.get('sample_rate')) is not int or audio['sample_rate'] <= 0:
        raise ValueError('Connect a valid AUDIO reference with a positive sample rate.')
    wave, rate = audio.get('waveform'), audio['sample_rate']
    if not isinstance(wave, torch.Tensor) or wave.ndim != 3 or wave.shape[0] != 1 or wave.shape[1] < 1:
        raise ValueError('Connect one AUDIO reference in the standard ComfyUI waveform format.')
    if type(start) not in {int, float} or not math.isfinite(start) or start < 0:
        raise ValueError('Audio start must be finite and nonnegative.')
    first = round(start * rate)
    count = min(math.floor(seconds * rate), wave.shape[-1] - first)
    if count / rate < 1.8 - 1e-6:
        raise ValueError('The selected audio reference needs at least 1.8 seconds.')
    return {'waveform': wave[..., first:first + count], 'sample_rate': rate}


def source_parts(path, *, image=True, audio=True):
    """Decode one image and original audio without loading all video frames into RAM."""
    decode_audio = audio
    first, audio = None, None
    if image:
        with av.open(str(path)) as media:
            frame = next(media.decode(video=0))
            first = torch.from_numpy(frame.to_ndarray(format='rgb24').copy()).float().div_(255).unsqueeze(0)
    with av.open(str(path)) as media:
        if decode_audio and media.streams.audio:
            stream = media.streams.audio[0]
            rate = stream.codec_context.sample_rate
            resampler = av.AudioResampler(format='fltp', layout=stream.codec_context.layout, rate=rate)
            chunks = []
            for frame in media.decode(audio=0):
                for decoded in resampler.resample(frame):
                    chunks.append(decoded.to_ndarray())
            for decoded in resampler.resample(None):
                chunks.append(decoded.to_ndarray())
            if chunks:
                audio = {'waveform': torch.from_numpy(np.concatenate(chunks, axis=1).copy()).unsqueeze(0), 'sample_rate': rate}
    return first, audio
