# Control passes and delivery

Camera Preview renders the edited video, depth/normal/pose videos, camera data, and endpoint images from one evaluated timeline. Control Videos displays the three additional passes below the main editor.

## Pass definitions

- **Depth:** radial camera distance mapped to grayscale. One range is calculated from all actors over sampled camera/scene times, including important timeline boundaries. Foreground values retain contrast against black background. Static geometry outside the actor-derived range can saturate.
- **Normal:** world-space surface normals encoded as `RGB = normal * 0.5 + 0.5`.
- **Pose:** major-joint skeletons for recognized rigs. Unrecognized joint names can leave an actor unmapped; depth and normals still use its geometry.

These are local scene computations, without another paid AI request. The camera-reference switches in Prepare control which videos are sent to the generator. The edited camera video starts enabled; additional passes start disabled and consume video-reference budget when enabled.

## Timing and audio

All selected camera passes use the same clip window. Providers can require whole-second output durations, so final assembly trims excess frames to the selected performance window. An unexpectedly short result is rejected rather than silently stretched.

Use original audio restores the corresponding soundtrack window when source audio is available. Creative audio references guide generation separately. Compare Videos aligns the selected edited window and generated result at their starts, holds the shorter side’s last frame, and produces a silent comparison.

## Camera data and images

Camera exports contain sampled position, orientation, FOV/projection, and editable recipe data. The Blender helper supports perspective paths. First and last IMAGE outputs come from the rendered 3D camera; optional image styling changes appearance while preserving their intended viewpoint and pose.

See [camera export format](../TECHNICAL_REFERENCE.md#portable-sampled-camera-json), [image styling](../TECHNICAL_REFERENCE.md#13-optional-endpoint-image-styling), and [reference limits](video-references.md).
