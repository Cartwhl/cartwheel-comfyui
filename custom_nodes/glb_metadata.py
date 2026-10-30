"""Read self-contained GLB 2 scene metadata without modifying downloaded assets."""

import json
import math
from pathlib import Path
import struct


def _read_metadata(path, layout=False):
    path = Path(path)
    with path.open('rb') as stream:
        header = stream.read(20)
        if len(header) != 20:
            raise ValueError('The actor GLB is truncated. Reload its capture from history.')
        magic, version, length, size, kind = struct.unpack('<4sIII4s', header)
        if magic != b'glTF' or version != 2 or length != path.stat().st_size or kind != b'JSON' or size > 16 * 1024 * 1024 or size + 20 > length:
            raise ValueError('Camera preview requires a valid GLB 2 actor file.')
        try:
            document = json.loads(stream.read(size))
        except (ValueError, UnicodeError):
            raise ValueError('The actor GLB contains invalid scene metadata.') from None
        if not isinstance(document, dict) or not isinstance(document.get('asset'), dict) or document['asset'].get('version') != '2.0':
            raise ValueError('Camera preview requires a GLB 2 scene.')
        for asset in [*document.get('buffers', []), *document.get('images', [])]:
            if 'uri' in asset and (not isinstance(asset['uri'], str) or not asset['uri'].startswith('data:')):
                raise ValueError('The actor GLB must embed its buffers and textures; external files are unsupported.')
        unsupported = {'KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu'} & set(document.get('extensionsRequired', []))
        if unsupported:
            raise ValueError('This actor GLB requires an unsupported decoder: ' + ', '.join(sorted(unsupported)))
        binary = stream.read(8)
        bin_offset = stream.tell()
        bin_size = 0
        if binary:
            if len(binary) != 8:
                raise ValueError('The actor GLB has a truncated binary chunk.')
            bin_size, bin_kind = struct.unpack('<I4s', binary)
            if bin_kind != b'BIN\x00' or bin_offset + bin_size > length:
                raise ValueError('The actor GLB has an invalid binary chunk.')
        duration = 0.0
        # Read actual animation input timestamps instead of trusting optional accessor bounds.
        for animation in document.get('animations', [])[:1]:
            for sampler in animation.get('samplers', []):
                try:
                    if type(sampler['input']) is not int or sampler['input'] < 0:
                        raise ValueError()
                    accessor = document['accessors'][sampler['input']]
                    view = document['bufferViews'][accessor['bufferView']]
                    count = accessor['count']
                    stride = view.get('byteStride', 4)
                    offset = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
                    if any(type(v) is not int for v in [count, stride, offset, accessor.get('bufferView')]) or accessor.get('bufferView', -1) < 0 or accessor['componentType'] != 5126 or accessor['type'] != 'SCALAR' or view.get('buffer', 0) != 0 or 'uri' in document['buffers'][0] or type(count) is not int or count < 1 or stride < 4 or offset < 0 or offset + (count-1)*stride + 4 > bin_size:
                        raise ValueError()
                    stream.seek(bin_offset + offset + (count-1)*stride)
                    stop, = struct.unpack('<f', stream.read(4))
                    if not math.isfinite(stop) or stop < 0:
                        raise ValueError()
                    duration = max(duration, stop)
                except (KeyError, IndexError, TypeError, struct.error, ValueError):
                    raise ValueError('The actor GLB has invalid animation timestamps.') from None
    result = {'format': 'glb', 'meters_per_unit': 1.0, 'duration': duration}
    if layout:
        from .import_layout import glb_layout
        result['import_layout'] = glb_layout(document)
    return result


def read_metadata(path, *, layout=False):
    try:
        return _read_metadata(path, layout=layout)
    except (AttributeError, TypeError, IndexError, KeyError, UnicodeError, struct.error, OverflowError):
        raise ValueError("The scene file contains malformed or truncated metadata.") from None
