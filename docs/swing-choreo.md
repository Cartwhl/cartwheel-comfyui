# Swing Choreo

Add **Cartwheel Swing Choreo**, or use the Swing Choreo section in the full workflow. In **Choose Motion Source**, select **Swing Choreo**, enter the motion prompt, then Run in **Preview camera** mode. After generation finishes, the same Camera Preview controls work for the generated actors. No input video or starting camera is required.

## Inputs

- **Motion prompt**: describe the people, their actions, and interactions. Actor count is inferred by Cartwheel from the prompt; the camera editor supports up to four actors.
- **Motion duration · seconds**: whole seconds from 5 through 15; default 8.
- **Loop motion**: off by default; requests a looping motion from the service.
- **Export frame rate**: 24, 30, 60, or 120; default 60.
- **Spline simplification** (Advanced): None or Rebuild curves.

Exports use GLB with mesh, MHR, meters, Y up, and −Z forward. The node has no model or variations selector. Video-capture controls (actor count, facial capture, foot stabilization, and capture quality) are not parameters of the text-generation endpoint.

## Outputs and reuse

**MOTION** preserves every returned actor in the shared scene and plugs into Choose Motion Source → Swing Choreo, or directly into Camera Preview. **CAMERA** is available if Cartwheel returns one; otherwise the editor initializes a default view. **CAPTURE** retains the saved job manifest, **GLB** exposes the first actor, and **preview** exposes a thumbnail when the service provides one. The thumbnail is optional; use Camera Preview's rendered VIDEO for Seedance/H3.

The node omits optional `batchName` by default; users do not name API jobs. Integrators may add this optional API field for their own organization. Named local scenes are separate.

The node uses the same saved Cartwheel connection as Performance Capture. It submits through the public `/motion/fromText` API and polls the batch and requested GLB exports for up to one hour. No source video upload is required. The API request uses `requestedModel: "swing_choreo"`, `swingChoreoProperties.duration`, one prompt entry, and the public export settings.

Generation uses Cartwheel credits. **Preview camera** skips Seedance/H3, but selecting a fresh Swing Choreo source still requests Cartwheel generation. Comfy caches unchanged successful nodes in the running session. For continued editing after restart or input changes, choose the completed job in **Load Motion → Saved jobs** to reuse it without generating again.

If polling or downloading fails after a batch ID is acknowledged, Run again resumes that job. The node records submission intent before sending the request. If the response is lost or otherwise ambiguous, it stops rather than sending a duplicate job. Check Cartwheel history first. Once you have identified the existing job, recover its local files when available; account-level recovery requires the service-key owner; for deliberate recovery, stop ComfyUI and move the matching text-job journal outside `user/__cartwheel/text_jobs` (use the configured system user directory if different). Changing prompt/options creates a different request and may incur a new charge. Finished or definitively rejected/failed executions do not remain permanent cache entries in this journal.
