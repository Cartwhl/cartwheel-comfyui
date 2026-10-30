# Camera movement presets

Choose Moving in the camera-type control, then select a preset beside Manual path. Presets include push in, pull out, truck, orbit, pan, tilt, crane, and deliberate zoom. Their movement-specific controls appear in the same area as manual-path options.

## Placement and direction

Camera distance, orbit, height, and the scene gizmo share the current placement. The selected target supplies the orbit center: one actor’s root, the average roots of selected actors, or the custom aim marker. A push in treats the placed camera as its close/end position; extending travel moves the start backward.

Preset direction is evaluated relative to the actual camera and target, rather than assuming every camera begins in front of the actors. Ordinary movement preserves lens settings. A Zoom preset or explicit start/end lens animation changes them deliberately.

## Tracking and composition

Aim and composition controls remain independent of the selected route. Follow subjects transports the camera with the selected performers; Camera follow strength determines how closely the aim follows local gestures. Presets use animated landmarks for recognizable rigs rather than fixed rest-pose body positions.

Each timeline block retains its own preset and settings. Splitting alone preserves the existing movement. See [camera timeline](camera-timeline.md), [tracking](auto-tracking.md), and the [technical control reference](../TECHNICAL_REFERENCE.md#8-camera-editor-behavior-and-controls).
