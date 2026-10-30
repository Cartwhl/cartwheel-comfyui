# Local saved jobs

Select Load Motion in Choose Motion Source, then open Saved jobs, refresh, and choose a saved result. Run to reopen it. Upload files remains available for individual animated actors or compatible whole scenes and an optional camera.

## Save and reload

Camera Preview execution saves a local snapshot. Save scene creates a deliberately named snapshot for an experiment. Snapshots under ComfyUI’s `output/cartwheel/saved_jobs/` retain actor assets, original camera context, sampled edited camera, editable recipe/timeline, and preview files.

Saved multi-camera recipes reopen as editable blocks. A plain sampled camera can be used as a starting path. Keep the output assets to retain reuse across restarts; a workflow JSON is not an asset bundle. Existing local capture manifests and standalone uploaded scenes can also appear when their assets remain available.

## Export and scope

The local bundle utility can package available actor files, camera JSON, recipes, manifests, previews, and the perspective-camera Blender helper. This utility remains available through the local route; extra download-link buttons are not part of the editor UI. Video players provide their ordinary download controls.

Blender imports perspective samples as one animated camera; actors are imported separately. The helper does not reproduce the viewer’s fisheye shader, and automated tests do not establish Blender GUI compatibility.

The catalog reads the current ComfyUI server’s output files without a Cartwheel API request. It is intended for a trusted single-user installation. See [saved-scene contracts and security](../TECHNICAL_REFERENCE.md#14-files-local-reuse-and-security-boundary).
