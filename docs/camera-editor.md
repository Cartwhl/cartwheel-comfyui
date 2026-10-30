# Camera editor

The editor arranges controls from broad shot decisions to finer adjustments. Its scene view shows editable geometry and camera paths; the camera view shows the actual output framing.

## Camera and target

Choose Static, Moving, or Follow subjects. Select the target actor(s), aim point, and composition. A custom aim marker is a stationary point in world space and replaces actor/body-part targeting for that shot.

Camera distance, orbit, and height stay synchronized with scene gizmos. Orbit uses counterclockwise-positive angles from 0–360°. Lens, fisheye field of view, and horizon tilt control projection and roll. Ordinary travel and targeting do not automatically compensate distance by changing the lens.

For Moving cameras, choose Manual path or a movement preset. Each camera block has its own settings. Optional Custom start/end settings animate target, aim, composition, follow strength, lens, and tilt within the selected block; timing belongs to its timeline interval.

## Tracking and persistence

Camera follow strength ranges from steady framing of nearby action to tight tracking of the current aim point. It accounts for framing scale. Unknown rigs may lack reliable anatomical targets; a custom marker remains available.

Save scene creates a named local snapshot containing actors, camera samples, editable recipes, timeline blocks, and preview files. Undo/Redo handles camera edits, including accepted LLM changes. Guides and labels remain editor-only.

## Formats and current scope

GLB is the primary actor format. Compatible binary FBX and whole scenes are supported; imports preserve shared placement and timing. An embedded perspective camera can supply the starting view, and a separate uploaded camera overrides it. See [motion inputs](motion-inputs.md).

Cartwheel-generated GLBs can be checked against returned native MHR references. When a formatted export cannot be aligned and a complete native actor is available, the viewer can use that original actor with an explicit fallback indicator. Uploaded non-Cartwheel files use their own supported animation data.

The editor is not a general rig-retargeting or DCC keyframe system. For complete controls and data contracts, see the [technical reference](../TECHNICAL_REFERENCE.md#8-camera-editor-behavior-and-controls).
