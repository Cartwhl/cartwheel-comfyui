"""Output framing shared by the saved camera and local VIDEO encoder."""
import math

DEFAULT_OUTPUT_FRAME = {'orientation': 'original', 'ratio': '16:9'}
RATIOS = {'16:9': 16 / 9, '4:3': 4 / 3, '1:1': 1, '21:9': 21 / 9}


def validate_output_frame(value=None):
    if value is None:
        return DEFAULT_OUTPUT_FRAME.copy()
    if not isinstance(value, dict):
        raise ValueError('Choose an output orientation and aspect ratio.')
    result = DEFAULT_OUTPUT_FRAME | {key: value[key] for key in DEFAULT_OUTPUT_FRAME if key in value}
    if not isinstance(result['orientation'], str) or result['orientation'] not in {'original', 'landscape', 'portrait'}:
        raise ValueError('Choose Original capture, Landscape or Portrait orientation.')
    if not isinstance(result['ratio'], str) or result['ratio'] not in RATIOS:
        raise ValueError('Choose 16:9, 4:3, 1:1 or 21:9 aspect ratio.')
    return result


def output_aspect(value, native_aspect):
    frame = validate_output_frame(value)
    if frame['orientation'] == 'original':
        return native_aspect
    aspect = RATIOS[frame['ratio']]
    return 1 / aspect if frame['orientation'] == 'portrait' else aspect


def output_dimensions(resolution, aspect):
    if resolution not in {'720p', '1080p'} or not math.isfinite(aspect) or aspect <= 0:
        raise ValueError('Choose a supported video size and aspect ratio.')
    short_side = int(resolution[:-1])
    width, height = short_side * max(aspect, 1), short_side * max(1 / aspect, 1)
    scale = min(1, 4096 / max(width, height))
    return tuple(max(2, round(value * scale / 2) * 2) for value in (width, height))
