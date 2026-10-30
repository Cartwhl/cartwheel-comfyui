# Performance Capture

Performance Capture uses Cartwheel’s Comic 4 model to turn a video into animated 3D performers.

## Setup and capture

1. Configure a production Cartwheel project API key as described in [Accounts and credits](../README.md#accounts-and-credits).
2. Load a video and optionally trim it with Video Slice before capture.
3. Select Performance Capture in Choose Motion Source and leave Preview or Generate on Preview camera.
4. Set actor count (one to four), facial capture, foot stabilization, quality, and export frame rate. Run the workflow.

The node requests GLB exports with meshes in a shared, meter-based Y-up scene. Its advanced export controls include frame rate and spline simplification. Batch names are optional API labels and are omitted by this workflow. The camera editor receives all returned actors, plus a starting camera when available.

## Reuse and interruption

A matching source video, account, and capture settings can reuse a completed local capture. Increase `capture_version` to request a new paid take. Use Load Motion → Saved jobs for deliberate reuse of an existing local scene or camera edit.

The client records submission intent before sending a job, then retains its acknowledged batch ID for polling and download recovery. Rerunning an interrupted, acknowledged request resumes it; it does not submit another capture merely to check status. A `submitting` journal without a batch ID means the response was uncertain. Investigate that submission in the Cartwheel account before retrying; deleting the journal can create a duplicate paid job.

Stopping ComfyUI stops local waiting. It does not cancel an accepted Cartwheel job or reverse its charge. The client waits up to one hour; that is a client timeout, not a service completion guarantee.

## Files and transport

Assets and `capture.json` are saved under the current ComfyUI output directory’s `cartwheel/` folder. Submission journals use ComfyUI’s system-user directory. Keys and signed asset URLs are excluded from these manifests.

Authenticated requests use the fixed production API. Signed asset transfers use public HTTPS without the API key; redirects and private network destinations are rejected. Downloads are limited to 1 GiB per asset.

See [Public API contract](public-api-contract.md), [motion inputs](motion-inputs.md), and the [technical reference](../TECHNICAL_REFERENCE.md#5-public-cartwheel-api-integration).
