"""Public, serializable shot recipe validation. Camera math runs in the viewport."""
import copy
import math

DEFAULT_PRESET = {
    'aim_source':'legacy','follow_strength':.25,'tracking_mode':'legacy','vertical_tracking':'auto','room_horizontal':.12,'room_vertical':.16,'pan_smoothing':.3,'tilt_smoothing':.75,
    'framing_motion':False,'framing_start_x':1/3,'framing_start_y':1/3,'framing_end_x':2/3,'framing_end_y':1/3,
    'target_mode': 'actors', 'custom_target': None,
    'custom_position': None, 'camera_transition': None,
    'lens_calibration': 'legacy', 'fisheye_fov': 160, 'elevation_angle': 0,
    'focus_point': 'legacy', 'frame_reference': 'auto', 'frame_x': .5, 'frame_y': 1/3, 'framing_scale': 1, 'focus_fill': 0,
    'framing_version': 1, 'behavior': 'legacy', 'selection': 'legacy', 'follow_direction': 'reference', 'position_offset': [0, 0, 0],
    'framing_mode': 'reference', 'path_anchor': 'follow',
    'reference_time': 0, 'reference_actor': None, 'reference_basis': 'legacy_chest',
    'composition': 'single', 'actors': [], 'foreground_actor': None, 'shot': 'full', 'aim': 'auto',
    'horizontal': 'front', 'vertical': 'eye', 'lens': 'natural', 'focal_length': 35, 'sensor_height': 24,
    'roll': 0, 'padding': 1.12, 'bearing_offset': 0, 'target_offset': [0, 0, 0], 'movement': 'fixed',
    'direction': 'left', 'travel': 1, 'orbit_degrees': 90, 'rotation_degrees': 20, 'end_focal_length': 85,
    'crane_forward': 1, 'start_time': 0, 'end_time': 0, 'pacing': 'ease_in_out', 'aim_behavior': 'track',
    'response': 'smooth', 'responsiveness': .35, 'follow_response': 'smooth', 'follow_responsiveness': .35,
    'max_turn_speed': 35, 'dead_zone': 1.5, 'max_follow_speed': 4,
    'shoulder_side': 'right', 'shoulder_offset': .3, 'shoulder_back': .6,
}
CHOICES = {
    'target_mode': {'actors', 'marker'},
    "aim_source":{"legacy","live","reference"},
    "lens_calibration":{"legacy","full_frame"},
    "tracking_mode":{"legacy","auto","custom","exact","off"},"vertical_tracking":{"auto","grounded","gentle","exact"},
    'focus_point': {'legacy', 'auto', 'eyes', 'chest', 'back', 'hands', 'left_hand', 'right_hand', 'shoulders', 'left_shoulder', 'right_shoulder', 'hips', 'thighs', 'left_thigh', 'right_thigh', 'knees', 'left_knee', 'right_knee', 'feet', 'left_foot', 'right_foot'},
    'frame_reference': {'auto', 'center', 'upper_third', 'lower_third', 'left_third', 'right_third', 'upper_left', 'upper_right', 'lower_left', 'lower_right', 'custom'},
    'behavior': {'legacy', 'static', 'move', 'follow'}, 'selection': {'legacy', 'single', 'all', 'selected'},
    'follow_direction': {'reference', 'facing'},
    'composition': {'single', 'two', 'group', 'ots', 'pov', 'detail'},
    'shot': {'extreme_close', 'close', 'chest', 'waist', 'cowboy', 'medium_full', 'full', 'wide', 'extreme_wide'},
    'aim': {'auto', 'head', 'chest', 'hips', 'body', 'left_hand', 'right_hand', 'custom'},
    'horizontal': {'front', 'front_left', 'front_right', 'left', 'right', 'rear_left', 'rear_right', 'back', 'custom'},
    'vertical': {'custom', 'auto', 'top', 'high', 'slight_high', 'eye', 'slight_low', 'low', 'ground'},
    'lens': {'fisheye', 'ultra_wide', 'wide', 'natural', 'portrait', 'telephoto', 'custom'},
    'movement': {'fixed', 'pan', 'tilt', 'push', 'pull', 'truck', 'pedestal', 'orbit', 'follow', 'lead', 'alongside', 'crane', 'zoom', 'dolly_zoom', 'track_subjects'},
    'direction': {'left', 'right', 'up', 'down', 'in', 'out'},
    'pacing': {'constant', 'ease_in', 'ease_out', 'ease_in_out'},
    'aim_behavior': {'fixed', 'target', 'track'}, 'framing_mode': {'reference', 'whole_clip'}, 'path_anchor': {'fixed', 'follow'}, 'response': {'direct', 'smooth'}, 'follow_response': {'direct', 'smooth'},
    'shoulder_side': {'left', 'right'}, 'reference_basis': {'pelvis', 'chest', 'legacy_chest'},
}
RANGES = {
    "follow_strength":(0,1),
    'room_horizontal':(0,.6),'room_vertical':(0,.6),'pan_smoothing':(.05,3),'tilt_smoothing':(.05,3),
    'framing_start_x':(.1,.9),'framing_start_y':(.1,.9),'framing_end_x':(.1,.9),'framing_end_y':(.1,.9),
    'elevation_angle': (-89.9,89.9), 'fisheye_fov': (90, 180),
    'frame_x': (.1, .9), 'frame_y': (.1, .9), 'framing_scale': (.03, 20), 'focus_fill': (0, 1.5),
    'reference_time': (0, 120), 'focal_length': (10, 200), 'sensor_height': (18, 36), 'roll': (-90, 90), 'padding': (1, 2),
    'bearing_offset': (-180, 180), 'travel': (0, 100), 'orbit_degrees': (0, 360), 'rotation_degrees': (0, 160),
    'end_focal_length': (10, 200), 'crane_forward': (-100, 100), 'start_time': (0, 120), 'end_time': (0, 120),
    'responsiveness': (0, 1), 'follow_responsiveness': (0, 1), 'max_turn_speed': (1, 180),
    'dead_zone': (0, 10), 'max_follow_speed': (.1, 30), 'shoulder_offset': (.05, 2), 'shoulder_back': (.1, 3),
}


def validate_preset(value, actors, duration=None):
    if not isinstance(value, dict):
        raise ValueError('Choose a preset shot before rendering.')
    result = copy.deepcopy(DEFAULT_PRESET)
    result.update({key: value[key] for key in DEFAULT_PRESET if key in value})
    if type(result['framing_version']) is not int or result['framing_version'] not in {1, 2}:
        raise ValueError('Unsupported shot framing version.')
    if type(result["framing_motion"]) is not bool:
        raise ValueError("Framing transition must be enabled or disabled.")
    for key, options in CHOICES.items():
        if not isinstance(result[key], str) or result[key] not in options:
            raise ValueError(f'Choose a supported camera {key.replace("_", " ")}.')
    for key, (lower, upper) in RANGES.items():
        number = result[key]
        if type(number) not in {int, float} or not math.isfinite(number) or not lower <= number <= upper:
            raise ValueError(f'Camera {key.replace("_", " ")} must be a finite number between {lower} and {upper}.')
    if 0 < result['focus_fill'] < .05:
        raise ValueError('Focus area size must be zero (preset) or 5–150 percent.')
    if result['focus_point'] != 'legacy':
        result.update(framing_version=2, aim='auto')
    # Accept the retired field in saved workflows, but never restore distance
    # inflation or recenter a prescribed move around the entire clip.
    result['framing_mode'] = 'reference'
    selected = result['actors']
    if not isinstance(selected, list) or not 1 <= len(selected) <= 4 or any(type(a) is not int or a not in actors for a in selected) or len(set(selected)) != len(selected):
        raise ValueError('Select distinct actors available in this capture.')
    if result['reference_actor'] is None:
        result['reference_actor'] = selected[0]
    if type(result['reference_actor']) is not int or result['reference_actor'] not in selected:
        raise ValueError('Choose a facing reference actor from the selected subjects.')
    if duration is not None and result['reference_time'] > duration:
        raise ValueError('Shot reference time must be within the clip.')
    composition = result['composition']
    if composition == 'two' and len(selected) != 2:
        raise ValueError('A two-actor shot needs exactly two selected actors.')
    if composition == 'group' and len(selected) < 2:
        raise ValueError('A group shot needs at least two selected actors.')
    if composition in {'single', 'ots', 'pov', 'detail'} and len(selected) != 1:
        raise ValueError('Select one target actor for this composition.')
    foreground = result['foreground_actor']
    if foreground is not None and (type(foreground) is not int or foreground not in actors):
        raise ValueError('The foreground actor is unavailable in this capture.')
    if composition == 'ots' and (foreground is None or foreground in selected):
        raise ValueError('Over-the-shoulder shots need different foreground and target actors.')
    marker = result['custom_target']
    if marker is not None and (not isinstance(marker, list) or len(marker) != 3 or any(type(v) not in {int, float} or not math.isfinite(v) or abs(v) > 100000 for v in marker)):
        raise ValueError('Aim marker needs finite X, Y and Z values within 100000 meters.')
    if result['target_mode'] == 'marker':
        if marker is None:
            raise ValueError('Place an aim marker in Scene.')
        if result['behavior'] == 'follow' or result['movement'] in {'track_subjects', 'follow', 'lead', 'alongside'}:
            raise ValueError('A fixed aim marker supports Static or Moving cameras, not Follow subjects.')
        result.update(aim_source='reference', tracking_mode='exact', aim_behavior='target', path_anchor='fixed')
    if marker is not None:
        result['custom_target'] = marker.copy()
    position = result['custom_position']
    if position is not None and (not isinstance(position, list) or len(position) != 3 or any(type(v) not in {int, float} or not math.isfinite(v) or abs(v) > 100000 for v in position)):
        raise ValueError('Custom camera position needs finite X, Y and Z values within 100000 meters.')
    if position is not None:
        result['custom_position'] = position.copy()
    if result['horizontal'] == 'custom' and position is None:
        raise ValueError('Place the custom camera in Scene.')
    offset = result['target_offset']
    if not isinstance(offset, list) or len(offset) != 3 or any(type(v) not in {int, float} or not math.isfinite(v) or abs(v) > 100 for v in offset):
        raise ValueError('Target offset needs finite X, Y and Z values between -100 and 100 meters.')
    position_offset = result['position_offset']
    if not isinstance(position_offset, list) or len(position_offset) != 3 or any(type(v) not in {int, float} or not math.isfinite(v) or abs(v) > 100 for v in position_offset):
        raise ValueError('Camera position offset needs finite X, Y and Z values between -100 and 100 meters.')
    if result['behavior'] == 'static':
        result.update(movement='fixed', aim_behavior='fixed')
    if result['behavior'] == 'follow' and composition != 'pov':
        result.update(movement='track_subjects', aim_behavior='track', framing_mode='reference')
    if composition == 'detail' and result['focus_point'] == 'legacy':
        if result['shot'] not in {'close', 'extreme_close'}:
            result['shot'] = 'close'
        if result['aim'] not in {'auto', 'head', 'left_hand', 'right_hand'}:
            result['aim'] = 'head'
    if composition == 'pov':
        result.update(movement='fixed', aim_behavior='track')
    if composition in {'ots', 'pov'}:
        result['framing_mode'] = 'reference'
    if result['movement'] in {'pan', 'tilt'}:
        result['aim_behavior'] = 'fixed'
    directions = {'pan': {'left', 'right'}, 'tilt': {'up', 'down'}, 'truck': {'left', 'right'}, 'pedestal': {'up', 'down'},
                  'orbit': {'left', 'right'}, 'alongside': {'left', 'right'}, 'crane': {'up', 'down'}, 'dolly_zoom': {'in', 'out'}}
    if result['movement'] in directions and result['direction'] not in directions[result['movement']]:
        raise ValueError('Choose a direction supported by this camera movement.')
    end = result['end_time'] or duration
    if end is not None and (result['start_time'] >= end or duration is not None and end > duration + 1e-6):
        raise ValueError('Movement end must be after its start and within the clip. Zero means clip end.')
    transition = copy.deepcopy(result['camera_transition'])
    if transition is not None:
        allowed = {'target', 'focus_point', 'frame_reference', 'follow_strength', 'focal_length', 'roll', 'fisheye_fov'}
        if not isinstance(transition, dict) or set(transition) - {'enabled', 'fields', 'start', 'end'}:
            raise ValueError('Unsupported start/end camera settings.')
        if type(transition.get('enabled', False)) is not bool:
            raise ValueError('Start/end camera settings must be enabled or disabled.')
        fields = transition.get('fields', [])
        if not isinstance(fields, list) or any(not isinstance(k, str) or k not in allowed for k in fields) or len(set(fields)) != len(fields):
            raise ValueError('Choose supported start/end camera settings; position belongs to the path.')
        for side in ['start', 'end']:
            endpoint = transition.get(side)
            keys = {'target_mode', 'custom_target', 'actors', 'selection', 'composition', 'reference_actor', 'focus_point', 'frame_reference', 'follow_strength', 'focal_length', 'roll', 'fisheye_fov'}
            if not isinstance(endpoint, dict) or set(endpoint) - keys:
                raise ValueError('Start/end settings require supported start and end values.')
            # Reuse the same actor, target, choice and number validation as the main camera.
            candidate = {**result, **endpoint, 'camera_transition': None, 'behavior': 'static', 'movement': 'fixed', 'horizontal': 'front'}
            validated = validate_preset(candidate, actors, duration)
            transition[side] = {k: copy.deepcopy(validated[k]) for k in keys}
        result['camera_transition'] = copy.deepcopy(transition)
    if result['lens'] == 'fisheye':
        if result['movement'] in {'zoom', 'dolly_zoom'}:
            raise ValueError('Fisheye supports camera movement, but Zoom and Dolly zoom require a perspective lens.')
        return result
    # Reject unrenderable fixed-sensor FOVs before asking the browser to render.
    focal = {'ultra_wide': 18, 'wide': 24, 'natural': 35, 'portrait': 50, 'telephoto': 85}.get(result['lens'], result['focal_length'])
    if result['movement'] == 'zoom':
        result['direction'] = 'in' if result['end_focal_length'] >= focal else 'out'
    for mm in [focal] + ([result['end_focal_length']] if result['movement'] == 'zoom' else []):
        fov = math.degrees(2 * math.atan(result['sensor_height'] / (2 * mm)))
        if not 5 <= fov <= 150:
            raise ValueError('This lens and sensor combination exceeds the supported 5–150° field of view.')
    return result
