"""Read binary FBX scene and camera metadata without decoding mesh geometry.

Record layout: https://code.blender.org/2013/08/fbx-binary-file-format-specification/
"""

import math
import struct


def _read_metadata(path, actor=False):
    size = path.stat().st_size
    with path.open("rb") as stream:
        if stream.read(23) != b"Kaydara FBX Binary  \x00\x1a\x00":
            raise ValueError("Use a binary FBX file (FBX 7.x); GLB remains the recommended motion format.")
        version = struct.unpack("<I", stream.read(4))[0]
        header = "<QQQB" if version >= 7500 else "<IIIB"
        header_size = struct.calcsize(header)

        def read_node(depth=0):
            if depth > 128:
                raise ValueError("FBX metadata nesting is too deep.")
            raw = stream.read(header_size)
            if len(raw) != header_size:
                raise ValueError("FBX metadata is truncated.")
            end, count, length, name_length = struct.unpack(header, raw)
            if not end:
                return None
            if end > size or end <= stream.tell() or length > end - stream.tell() - name_length:
                raise ValueError("FBX metadata contains an invalid record.")
            name = stream.read(name_length).decode("utf-8")
            skip_children = name in {"Geometry", "Material", "Deformer", "Video", "Texture", "AnimationCurve"}
            if skip_children and not actor:
                stream.seek(end)
                return name, [], []
            properties = []
            property_end = stream.tell() + length
            for _ in range(count):
                kind = stream.read(1)
                formats = {b"Y": "<h", b"C": "<?", b"I": "<i", b"F": "<f", b"D": "<d", b"L": "<q"}
                if kind in formats:
                    fmt = formats[kind]
                    properties.append(struct.unpack(fmt, stream.read(struct.calcsize(fmt)))[0])
                elif kind in {b"S", b"R"}:
                    length_value = struct.unpack("<I", stream.read(4))[0]
                    if length_value > property_end - stream.tell():
                        raise ValueError("FBX metadata contains an invalid string length.")
                    if kind == b"S":
                        properties.append(stream.read(length_value).decode("utf-8", errors="replace"))
                    else:
                        stream.seek(length_value, 1)
                        properties.append(None)
                elif kind in {b"f", b"d", b"l", b"i", b"b", b"c"}:
                    _, _, encoded_length = struct.unpack("<III", stream.read(12))
                    if encoded_length > property_end - stream.tell():
                        raise ValueError("FBX metadata contains an invalid array length.")
                    stream.seek(encoded_length, 1)
                    properties.append(None)
                else:
                    raise ValueError("FBX metadata contains an unsupported property type.")
            if stream.tell() != property_end:
                raise ValueError("FBX metadata property length is invalid.")
            if skip_children:
                stream.seek(end)
                return name, properties, []
            children = []
            while stream.tell() < end:
                child = read_node(depth + 1)
                if child is None:
                    break
                children.append(child)
            stream.seek(end)
            return name, properties, children

        sections = []
        while True:
            section = read_node()
            if section is None:
                break
            sections.append(section)

    def properties(node):
        block = next((child for child in node[2] if child[0] == "Properties70"), None)
        return {item[1][0]: item[1][4:] for item in block[2] if item[0] == "P" and len(item[1]) >= 5} if block else {}

    global_node = next((node for node in sections if node[0] == "GlobalSettings"), None)
    if global_node is None:
        raise ValueError("FBX has no scene unit metadata.")
    globals_ = properties(global_node)
    scale = globals_.get("UnitScaleFactor", [None])[0]
    if not isinstance(scale, (int, float)) or not math.isfinite(scale) or scale <= 0:
        raise ValueError("FBX scene unit scale is missing or invalid.")
    axes = [globals_.get(key, [None])[0] for key in ["UpAxis", "UpAxisSign", "FrontAxis", "FrontAxisSign", "CoordAxis", "CoordAxisSign"]]
    if actor:
        if axes not in ([1, 1, 2, 1, 0, 1], [1, 1, 2, -1, 0, 1]):
            raise ValueError("FBX motion must be exported Y-up with X-right coordinates. Export a compatible FBX or GLB; automatic axis conversion is not supported.")
    elif axes != [1, 1, 2, 1, 0, 1]:
        raise ValueError("Camera preview currently supports Cartwheel's Y-up captured FBX coordinate frame.")
    objects = next((node[2] for node in sections if node[0] == "Objects"), [])
    connections = next((node[2] for node in sections if node[0] == "Connections"), [])
    models = {node[1][0]: node for node in objects if node[0] == "Model"}
    cameras = []
    for node in objects:
        if node[0] != "NodeAttribute" or len(node[1]) < 3 or node[1][2] != "Camera":
            continue
        model_id = next((c[1][2] for c in connections if c[0] == "C" and c[1][:2] == ["OO", node[1][0]]), None)
        if model_id not in models:
            continue
        values = properties(node)
        def value(key, default):
            return values.get(key, [default])[0]
        width, height = value("AspectWidth", 1920), value("AspectHeight", 1080)
        if width <= 0 or height <= 0:
            raise ValueError("FBX camera aspect ratio is invalid.")
        focal = value("FocalLength", None)
        film_height = value("FilmHeight", None)
        fov = math.degrees(2 * math.atan(film_height * 25.4 / (2 * focal))) if film_height and focal else value("FieldOfView", 45)
        cameras.append({"model_id": model_id, "name": models[model_id][1][1].split("\x00")[0],
                        "aspect": width / height, "width": width, "height": height, "fov": fov,
                        "near": value("NearPlane", 1) * scale / 100, "far": value("FarPlane", 100000) * scale / 100,
                        "projection": value("CameraProjectionType", 0)})
    if actor:
        mesh = any(node[0] == "Geometry" and len(node[1]) >= 3 and node[1][2] == "Mesh" for node in objects)
        animated = any(node[0] == "AnimationCurve" for node in objects)
        if not mesh or not animated or not any(node[0] == "AnimationStack" for node in objects):
            raise ValueError("FBX motion needs an animated mesh. Include the character mesh and animation in the export; camera-only or static FBX files cannot be used as actors.")
    stack = next((properties(node) for node in objects if node[0] == "AnimationStack"), {})
    stop = stack.get("LocalStop", globals_.get("TimeSpanStop", [None]))[0]
    duration = stop / 46186158000 if isinstance(stop, (int, float)) and math.isfinite(stop) and stop > 0 else None
    if actor:
        start = stack.get("LocalStart", globals_.get("TimeSpanStart", [0]))[0]
        if not isinstance(start, (int, float)) or not math.isfinite(start) or not isinstance(stop, (int, float)) or not math.isfinite(stop):
            raise ValueError("FBX motion needs a valid animation take start and end time.")
        if start < 0:
            raise ValueError("FBX animation takes must start at frame zero or later. Rebase the take or export GLB.")
        duration = (stop - start) / 46186158000
        if not 0 < duration <= 120:
            raise ValueError("FBX motion duration must be positive and at most 120 seconds.")
        from .import_layout import fbx_layout
        layout = fbx_layout(objects, connections)
        layout['cameras'] = [c for c in cameras if c['projection'] == 0]
        return {"format": "fbx", "meters_per_unit": scale / 100, "duration": duration,
                "animation_start": start / 46186158000, "import_layout": layout}
    return {"meters_per_unit": scale / 100, "cameras": cameras, "duration": duration}


def read_metadata(path, *, actor=False):
    try:
        return _read_metadata(path, actor=actor)
    except (AttributeError, TypeError, IndexError, KeyError, UnicodeError, struct.error, OverflowError):
        raise ValueError("The scene file contains malformed or truncated metadata.") from None
