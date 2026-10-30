# Actor and camera imports

Load Motion → Upload files expects individual animated actor files and an optional separate camera. GLB is primary; compatible binary FBX is also accepted. Whole-scene files can contain multiple actors, static geometry, and an embedded camera.

## Shared scene conventions

- Up to four actors, in a shared world frame. Preserve their relative placement rather than centering each independently.
- GLB uses meters, Y-up, right-handed coordinates. FBX uses supported declared units and axis conventions; arbitrary axis/rig conversion is not provided.
- Actor animations share a clip timeline. A camera is optional; the editor creates a default starting view when none is available.
- Embedded perspective cameras can supply the starting view. A separate camera input takes precedence. Orthographic cameras are not supported as output cameras.

The importer groups skin-connected meshes into actors and retains unassigned static meshes as background geometry. If an ambiguous hierarchy produces unexpected grouping, export separate characters. Body-part targeting depends on recognizable joints; generic imports do not require a Cartwheel account.

## Camera JSON

Use the [camera example](../custom_nodes/examples/camera-input-example.json) as the import contract. It contains `schema_version:1`, `units:"meters"`, `up:"Y"`, FPS, aspect ratio, and timestamped frames beginning at zero. Use `[x,y,z,w]` quaternions consistently, or target coordinates consistently, throughout a file. Camera positions are meters and FOV is vertical degrees.

Camera JSON is limited to 10 MiB and 14,401 samples; the scene timeline is limited to 120 seconds. A perspective-camera FBX is another supported separate input. This is not an importer for arbitrary camera JSON dialects.

## Local reuse

Load Motion → Saved jobs reopens this ComfyUI installation’s retained output files. Save scene preserves editable camera blocks and settings alongside the sampled combined camera. The exported perspective path can be imported into Blender with the included helper; fisheye rendering is specific to this viewer.

See [full format contracts](../TECHNICAL_REFERENCE.md#7-source-independent-data-contracts) and [FBX compatibility](../TECHNICAL_REFERENCE.md#fbx-upload-compatibility).
