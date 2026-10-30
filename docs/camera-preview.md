# Camera Preview

Connect the selected motion source to Cartwheel Camera Preview. A starting camera is optional. Run once to load the scene, then edit the shot in the split scene/camera view. Run again to render updated outputs.

## Scene inspection and output camera

Scene inspection changes how you view the editor; it does not change the authored camera. Select the camera, a path point, or the custom aim marker and drag its positive XYZ arrows to edit it. Press F over Scene to inspect the selected control more closely. Guides, paths, labels, and gizmos do not appear in exported videos.

The toolbar provides starting-camera viewing, output orientation and aspect ratio, visibility settings, Save scene, and Undo/Redo. Reset camera resets the selected setup; Reset scene returns to one starting camera.

## Render outputs

Camera Preview outputs the edited video, sampled camera data, first and last frame images, and depth/normal/pose videos. The separate Control Videos display previews those passes. All outputs use the same evaluated camera timeline, including cuts and holds.

Keep the requesting browser connected during rendering. The renderer uses local graphics and encoding resources. A fresh upstream Performance Capture or Swing Choreo source can still incur its own generation job.

For reuse, select Load Motion → Saved jobs. This catalog reads local output files; it does not browse account-wide API history.

See [camera controls](camera-editor.md), [control passes](delivery-and-control-passes.md), and the [workflow overview](../OVERVIEW.md).
