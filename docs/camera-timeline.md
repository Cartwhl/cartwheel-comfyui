# Camera timeline

The track below the scene starts with one camera covering the entire motion. The ruler scrubs playback; the blocks set when camera moves run. Selecting a block changes the editable camera, while playback continues showing the camera active at the playhead.

- Right-click a block and choose **Split into new camera** at the playhead. An untouched split preserves the original movement, easing, lens and orientation.
- Drag a block edge to change its movement duration, or drag its body through free time. Other blocks do not move. Blocks cannot overlap, swap order, or push neighbors.
- The narrow shared handle between touching blocks adjusts both timing boundaries together. Individual edge handles remain available on either side.
- Empty time holds the preceding camera's final state. Before the first block, the first camera's starting state is held. Performers continue moving.
- Each camera retains its own movement preset/manual path, subjects, aim, composition, follow strength, lens and tilt. Optional start/end changes apply inside that block.
- Neighboring paths connect by default. Connected endpoints move together; only the selected camera's controls are interactive. Other camera paths remain visible in matching outline colors.
- Right-click to disconnect paths, disable smoothing, or change transition length. Disconnection preserves both paths' positions. Deleting leaves a hold without moving surviving paths.
- Connected, touching moves default to a 30-frame transition centered on their boundary. Across a gap, smoothing becomes an ease-out into the hold and an ease-in from the hold. Transition windows shorten for very short blocks. Zero disables smoothing. Leading/trailing holds have their own easing switches in the context menu.
- **Undo/Redo** buttons and Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z work inside the editor. Text inputs retain native text undo. Dragging counts as one edit.
- **Save scene** retains the complete editable track locally. Exported camera JSON includes both a sampled combined animation and a versioned `editor_recipe`. Load Motion restores saved blocks; uploading that JSON with matching GLBs also restores the timeline.

All control renders and endpoint frames evaluate the same combined camera. Exported samples explicitly mark cuts so they remain cuts on reload; the Blender helper uses constant interpolation immediately before a cut. Perspective cameras import into Blender as one animated camera. The existing helper does not reproduce fisheye projection. Switching between perspective and fisheye changes projection at the transition midpoint; numeric lens values and camera motion still blend.

Timeline boundaries snap to the selected frame rate, with a one-frame minimum and a maximum of 64 camera moves. Splitting retains a source interval; resizing retimes that interval rather than restarting it. Manual subdivisions retain sampled source orientation/lens and rebuild editable handles around the cropped path. Start/end settings remain optional; there is no keyframe or aim-path editor.

No LLM or paid provider calls are involved in timeline editing or local control rendering. The selected video generator may interpret cuts or complex transitions differently from the control video.

## Holds and new connections

Right-click empty time and choose **Fill gap with camera** to fill that entire interval. The new static camera matches the held view and becomes selected; neither neighbor moves. Leading and trailing empty intervals work the same way. Undo restores the gap.

Across a hold, spatial connections remain available, but the camera does not blend directly across the empty time. The preceding camera has its own **Ease out to hold** switch and frame count; the following camera has its own **Ease in from hold** switch and frame count. Turn off the first and keep the second on for an abrupt stop followed by a smooth departure. Hold duration does not count toward either easing window.

When filling or closing a gap, existing connection preferences are combined conservatively: both sides must agree to connect and smooth; the shorter transition length wins. Without an existing connection, newly adjoining paths stay disconnected. Original endpoint hold preferences remain stored independently. An ordinary untouched split still preserves the exact original move.

During a camera drag, pointer updates are grouped to the display refresh rate, unedited camera plans are reused, and the selected path uses a lightweight preview. Full path sampling is restored on release; playback, saved scenes and exported control videos retain full sampling.

Camera display labels always run Camera 1, Camera 2, … from left to right after every timeline edit. Internal IDs remain stable. Optional [Camera instructions · AI](camera-instructions.md) can replace selected blocks or author an entire numerical sequence; valid results apply immediately as one undoable edit.
