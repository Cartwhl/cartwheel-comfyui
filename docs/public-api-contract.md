# Public API contract

The bundled Cartwheel API client handles media upload, motion submission, batch polling, and asset downloads. This guide maps those operations to the public endpoint documentation.

## Connection and request stages

The client uses `https://external-mogen.api.getcartwheel.com` with the user's `x-api-key`. Its address is fixed; the user supplies the API key through ComfyUI settings or the documented process environment variable. Local scene imports and camera rendering do not call Cartwheel.

| Stage | Public reference |
| --- | --- |
| Register media, then PUT video bytes to the returned signed URL | [Media upload](https://api-docs.getcartwheel.com/api/create-media-upload/) |
| Submit Performance Capture through `POST /motion/fromVideo` | [Motion from video](https://api-docs.getcartwheel.com/api/motion-from-video/) |
| Submit Swing Choreo through `POST /motion/fromText` | [Motion from text](https://api-docs.getcartwheel.com/api/motion-from-text/) |
| Poll the acknowledged batch | [Get batch](https://api-docs.getcartwheel.com/api/get-batch-by-id/) |
| Retrieve every page of generated motions | [Batch motions](https://api-docs.getcartwheel.com/api/get-motions-by-batch/) |
| Inspect account-accessible export characters | [Character catalog](https://api-docs.getcartwheel.com/api/get-characters/) |

Storage transfers use returned signed URLs without the API key. API requests and transfers reject redirects. These safeguards apply to API requests and asset transfers.

## Request mapping

Performance Capture explicitly requests `comicModel:"comic4"`. Actor count, facial capture, foot stabilization, and quality map to `numPeople`, `facialCapture`, `footPlanting`, and `qualityPreset`. Export settings request GLB with a mesh and the workflow's MHR export character, `char-upload-MHR`. This is an API resource identifier, not a credential. Access to the required character must be available to the configured API key; the project does not ship account access.

Swing Choreo requests `requestedModel:"swing_choreo"`, one prompt entry, a whole 5–15 second duration, optional looping, and GLB export. The model and single-result count are fixed internally. Both source requests omit optional `batchName`; integrators may supply it for organizational labels.

The [video request](https://api-docs.getcartwheel.com/api/motion-from-video/) and [text request](https://api-docs.getcartwheel.com/api/motion-from-text/) pages are the service references. `nodes.py` and `swing_choreo.py` define this client's exact options. See the [technical reference](../TECHNICAL_REFERENCE.md#5-public-cartwheel-api-integration) for request examples.

## Returned assets and timing

The client preserves ordered `exportURLs`/`exportFilenames`, body arrays, optional `cameraFbxURL`, `mhrBvhURLs`, `mhrIdentityJsonURLs`, and native MHR references when returned. The historical `faceURLs[i].bvhURL` field is read as an FBX asset; the field name alone does not establish its format. The adapter preserves missing actor slots and does not substitute the primary `/motion/:id` body for complete multi-actor result arrays.

The native MHR output and formatted export are distinct artifacts. The viewer prefers GLB and can verify body timing against a matching native reference. If a formatted export cannot be aligned and a complete native MHR actor is available, the viewer uses that actor and labels the fallback. No universal retargeting, timing conversion, or face-fidelity guarantee follows from a filename or export enum. Independent uploaded GLB/FBX scenes use their own supported import conventions, without requiring Cartwheel-generated assets.

See the [format contract](camera-editor.md#formats-and-current-scope), [FBX compatibility](../TECHNICAL_REFERENCE.md#fbx-upload-compatibility), and the bundled client/metadata implementation.

## Source audio and local reuse

For fresh captures, the exact submitted local video is retained as source context. If a supported legacy result supplies `sourceVideoMediaID`, the retained adapter can use [media lookup](https://api-docs.getcartwheel.com/api/get-media-by-id/) and its `fileExtension`/`mediaDownloadURL` fields. Keys remain on API calls, never storage downloads. Source access failures do not invalidate motion/camera assets already stored locally.

Saved jobs lists files in the current ComfyUI installation’s output directory, rather than querying account-wide API history. Old history code/examples are retained for compatibility; the current workflow does not use them. The legacy [recent motions endpoint](https://api-docs.getcartwheel.com/api/get-motions/) is scoped to its authenticated account, not automatically to an end user sharing a service key.

## Deployment and verification

A hosted integration must enforce its own user-to-job/media ownership and keep shared service credentials server-side. A batch label is not authorization, and filtering a shared account's history only in a browser is insufficient.

Verify live service access, export-character entitlement, timing, and supported platforms separately from local automated tests. Local automated checks use synthetic fixtures and mocked service calls.
