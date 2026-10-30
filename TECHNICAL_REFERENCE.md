# Cartwheel Motion to Video — technical reference

**Snapshot:** October 29, 2026.  
**Audience:** developers and automation tools working with the Cartwheel ComfyUI integration.  
**Product walkthrough:** [Human overview](OVERVIEW.md).

## 1. Scope and authority

This reference documents the implemented nodes, camera editor, data contracts, and execution behavior. Implementation source paths are relative to `custom_nodes/`; the workflow file `Cartwheel-Motion-to-Video.json` is at the repository root.

The extension connects to Cartwheel’s public motion APIs and installed ComfyUI image, video, and text integrations. Scene evaluation, the camera timeline, local control passes, reference preparation, and camera exports run in the extension. Service authentication and billing depend on the selected integration.

The [workflow overview](OVERVIEW.md) describes the user experience. `Cartwheel-Motion-to-Video.json` contains the connected graph, sockets, and defaults. Section 15 maps features to source files, and §16 describes validation and known limits. The focused guides under `docs/` cover individual features; graphs under `custom_nodes/examples/` are compatibility fixtures.

### Public API references

Use the [public Cartwheel API documentation](https://api-docs.getcartwheel.com/api/motion-from-video/) and endpoint links in §5 as the service contract. The repository provides working request/response examples, not a separate authoritative OpenAPI export. Client polling intervals, local file limits, and model-adapter limits are implementation choices and do not define service quotas.

For additional agent-oriented examples, see the public [Cartwheel MCP repository](https://github.com/Cartwhl/cartwheel-mcp). It includes API tooling, production setup guidance, and animation workflows for MCP clients. It is an optional reference; this ComfyUI extension includes its own API client and does not require the MCP server to be installed.

## 2. System boundaries and execution flow

```text
Load Video → Video Slice → Performance Capture ─┐
Swing Choreo ────────────────────────────────────┼→ Choose Motion Source → Camera Preview
Load Motion: actor/scene import or local saved scene ─────┘                         │
                                 optional starting CAMERA ──────────────┘
                                                                         ├→ edited VIDEO → save camera video
                                                                         ├→ depth / normal / pose → Control Videos
                                                                         ├→ camera JSON → Camera Data
                                                                         └→ first / last IMAGE → optional styling / review

edited VIDEO + enabled passes + Creative References + optional endpoint images
  → Prepare Video References → Generate with Seedance / H3 → final assembly

Preview or Generate chooses camera VIDEO or generated VIDEO → Result video
edited VIDEO + generated VIDEO → optional synchronized Compare Videos
```

**No final-generation pause is implemented by suspending a running graph.** Preview/Generate uses lazy evaluation: Preview does not request the generated branch. The user edits and submits another Run when ready. A fresh selected motion source may still incur a Cartwheel job during Preview.

Sources are output-capable nodes. The source selector therefore also manages their enabled/muted state in the browser; laziness at a downstream socket alone is insufficient to prevent independent output roots from executing. Preserve both protections when modifying execution routing.

## 3. Behaviors to preserve and why

| Behavior | Why it matters |
| --- | --- |
| One explicit motion source; unused fresh sources never submit | A video left in an unused branch must not create an accidental paid job. |
| Preview first, separate final-generation action | Users must be able to edit the camera before paying for video generation. |
| Motion and starting camera can be supplied separately; camera optional | The editor remains useful for correctly formatted non-Cartwheel scenes. |
| Ordinary camera movement never compensates distance with hidden zoom | Prevents warping and unnatural constant-size faces caused by automatic lens compensation. |
| Actual animated anatomy, not rest-pose landmarks | Hand targeting must follow hands raised for a gesture rather than aim beside the hips. |
| Steady action tracking with view-size awareness | Tight framing needs different correction from a wide shot, without making a bouncing gesture shake the camera. |
| Every output time has a camera; gaps mean holds | Timing edits never shorten or omit the performance itself. |
| Splitting alone changes no rendered motion | Creating another editable block must not introduce a visual jump or redundant smoothing. |
| Editable recipes plus a sampled combined export | Artists need both round-trip editing and a portable final animation. |
| One bounded LLM generation per explicit Submit; no automatic paid retries | Prevents repeated large paid requests without an explicit submission. |
| Disabled optional media stay loaded but are not consumed | Users can experiment without clearing/reuploading files or spending their reference budget. |
| All enabled camera passes use one synchronized clip window | Color, depth, normals, and pose must describe the same action and camera. |
| Distinct source-audio preservation and creative audio guidance | A generator interpreting audio is not the same as retaining the actual soundtrack. |
| No shared Cartwheel account-wide history in the app | A shared service key is not an end-user ownership boundary. |

## 4. Current node inventory

Names in backticks are registration IDs; labels in the full workflow may be friendlier.

| Node | Inputs and result / role |
| --- | --- |
| `LoadVideo` (ComfyUI core) | Local source file → `VIDEO`. |
| `Video Slice` (ComfyUI core) | Source `VIDEO`, trim controls → selected `VIDEO` before capture. |
| `CartwheelPerformanceCapture` | Source `VIDEO` + capture/export controls → preview, capture manifest, first GLB/path, exact source video/metadata, `MOTION`, `CAMERA`. |
| `CartwheelSwingChoreo` | Prompt, duration, loop, export options → `MOTION`, optional/default `CAMERA`, capture manifest, first GLB, optional service preview. |
| `CartwheelLoadMotionAndCamera` | Individual animated actor files (GLB preferred; compatible FBX accepted) or a whole scene, up to four actors + optional camera JSON/FBX override, or saved-job selection → `MOTION`, `CAMERA`, motion-info JSON. |
| `CartwheelMotionSource` | Three lazy motion inputs + source choice → one `MOTION`; browser manages unused source roots. |
| `CartwheelWorkflowStep` | Camera video, lazy generated video, action → selected `VIDEO` + generation `BOOLEAN`. Display: Preview or Generate. |
| `CartwheelCameraPreview` | `MOTION`, optional starting `CAMERA`, serialized editor state, size/FPS → edited `VIDEO`, baked `CAMERA`, camera JSON/file path, first/last `IMAGE`, depth/normal/pose `VIDEO`, compatibility image-use Boolean. |
| `CartwheelControlPreview` | Depth/normal/pose videos → separate local display; does not submit AI requests. |
| `CartwheelCameraData` | Sampled camera JSON string → JSON strings for positions, targets, path/samples+recipe, focal lengths, FOVs, full camera. |
| `CartwheelReferenceLibrary` | Ordered local image/video/audio upload entries, enable switches, optional windows → `CARTWHEEL_REFERENCES`. Display: Creative References. |
| `CartwheelPrepareVideoReferences` | Edited camera, model/prompt/window, optional references/passes/images + flags → packed references, metadata, and legacy individual outputs. Does not generate. |
| `CartwheelGenerateVideo` | `CARTWHEEL_PREPARED_REFERENCES`, seed, generated-audio option → expands native selected video node + finalizer → `VIDEO`. |
| `CartwheelFinalizeVideo` | Generated video + prepared delivery settings → locally trimmed/audio-assembled video. Normally internal expansion. |
| `SaveVideo` (ComfyUI core, two instances) | Saves edited camera separately and saves/displays the selected preview or final result. |
| `CartwheelCompareVideos` | Enabled flag + edited and generated videos → silent synchronized side-by-side `VIDEO`. |
| `CartwheelImageReferences` | Up to five enabled local images → role-tagged `CARTWHEEL_FRAME_REFERENCES`. |
| `CartwheelEndpointImage` (first and last instances) | Raw camera frame, opt-in generation, service/prompt/seed, shared or individual appearance references → raw pass-through or styled `IMAGE`. |
| `CartwheelMatchFirstFrame` | Raw first + styled first + generic appearance references → ordered continuity-reference collection for last-frame styling. |
| `CartwheelEndpointReview` | Optional first/last preview + inclusion flag → image display and `use_frame_images` Boolean wired to Prepare. |
| `CartwheelCameraInstructionResult` | Native LLM response + scope metadata → validated camera-result event consumed by the embedded editor; internal output node. |
| `Note` (ComfyUI core) | Workflow guidance only. |

Compatibility nodes remain registered: `CartwheelLoadCapture` loads a local capture manifest; `CartwheelCamera` and `CartwheelControlRender` support a split editor/render layout. `CartwheelLoadHistory` is retired and errors with guidance toward local Saved jobs. It is not a supported starting point. Hidden old sockets/fields can remain to load older workflows; do not reproduce them as product requirements.

## 5. Public Cartwheel API integration

### Authoritative public references

The API uses the production base `https://external-mogen.api.getcartwheel.com` and `x-api-key` authentication in the reference client (`config.py`, `client.py`). For account creation and production API-key setup, see [Accounts and credits](README.md#accounts-and-credits). Comfy-native image/video/text integrations use the separately signed-in Comfy account and credits.

| Operation | Public endpoint / documentation | Used by current path |
| --- | --- | --- |
| Register upload | `POST /media/upload` — [media upload docs](https://api-docs.getcartwheel.com/api/create-media-upload/) | Performance Capture, followed by PUT to returned signed URL. |
| Capture video | `POST /motion/fromVideo` — [video motion docs](https://api-docs.getcartwheel.com/api/motion-from-video/) | Performance Capture / Comic 4. |
| Generate text motion | `POST /motion/fromText` — [text motion docs](https://api-docs.getcartwheel.com/api/motion-from-text/) | Swing Choreo. |
| Poll accepted batch | `GET /batch/:batchID` — [batch docs](https://api-docs.getcartwheel.com/api/get-batch-by-id/) | Both fresh sources. |
| Retrieve results and exports | `GET /motions/:batchID`, paginated — [batch motions docs](https://api-docs.getcartwheel.com/api/get-motions-by-batch/) | Both fresh sources; follow `nextToken`. |
| Inspect accessible characters | `GET /characters` — [character docs](https://api-docs.getcartwheel.com/api/get-characters/) | Entitlement/setup reference, not required on every generation. |

The bundled client implements these request mappings; the linked public endpoint documentation defines the service contract.

Signed upload/download transfers do **not** receive the Cartwheel API key. Submit once, retain the acknowledged batch ID, poll that batch, page through its motion results, and download the returned assets. Do not use another POST as a status check.

### Performance Capture request shape implemented here

```json
{
  "mediaIDs": ["<registered uploaded video ID>"],
  "comicModel": "comic4",
  "numPeople": 2,
  "facialCapture": true,
  "footPlanting": true,
  "qualityPreset": "smoothed",
  "loop": false,
  "exportSettings": {
    "characterID": "char-upload-MHR",
    "exportType": "glb",
    "frameRate": 60,
    "includeMesh": true,
    "keyframeCleaning": "none",
    "forward": "-Z",
    "up": "Y",
    "frameStepSize": 1,
    "moveInPlace": false
  }
}
```

`mediaIDs` is added after upload registration. The configured production API key must have access to the required MHR export character. The request omits optional `batchName`; there is no user-facing name field. Integrators may include it for organizational labels. Actor choices are 1–4; faces and foot stabilization default on; quality choices map Smoothed/Balanced/Detailed to `smoothed/balanced/detailed`; export FPS is 24/30/60/120, default 60. Spline cleaning maps None/Rebuild curves to `none/simplify`.

Input validation limits the submitted source to 30 seconds and less than 250,000,000 bytes. Source inspection retains exact timing, rational FPS, frame count, dimensions, VFR detection, and audio start information. These are this client’s accepted limits, and do not define the service’s quotas.

### Swing Choreo request shape implemented here

```json
{
  "prompts": ["Two performers play rock paper scissors"],
  "requestedModel": "swing_choreo",
  "swingChoreoProperties": {"duration": 8},
  "loop": false,
  "exportSettings": {
    "characterID": "char-upload-MHR",
    "exportType": "glb",
    "frameRate": 60,
    "includeMesh": true,
    "keyframeCleaning": "none",
    "forward": "-Z",
    "up": "Y",
    "frameStepSize": 1,
    "moveInPlace": false
  }
}
```

Swing Choreo also omits optional `batchName` by default. Exactly one prompt entry is sent; there is no variation or model selector. Duration is a whole 5–15 seconds, default 8; loop defaults off. Actor count comes from the service/prompt; the editor accepts at most four returned actor GLBs. A returned camera/thumbnail is optional. The node returns motion even without a service preview.

### Batch naming, job identity, and user ownership

A batch is the asynchronous submission container returned by `/motion/fromVideo` or `/motion/fromText`; its ID is used for polling and result lookup. Individual jobs/motions live within the batch and can contain multiple actor exports. The reference submits one video or one prompt, not an artist-visible collection of named jobs. A batch label is not a unique identifier: separate submissions can share a label or omit it and still have different IDs.

The public request schemas make `batchName` optional for both endpoints; both handlers accept omission and use an empty name. Both source nodes omit the field entirely, without sending a default label, empty string, or null. Integrators can include optional `batchName` if useful for their organization. The retired `batchName` widget is removed from schemas and example workflows. Frontend migration removes the old first widget before positional widget restoration, so actor options and Swing prompts retain their values. Stale API-workflow keyword names are accepted and ignored. Named local scenes remain a separate feature. Local catalog defaults use the source video title or motion prompt, independently of optional API batch labels. Batch labels are excluded from new local request identity hashes; verified older journals are adopted by their exact account/source/options hash to retain completed captures and resumable requests. Older custom-named Swing submissions can be identified from a completed local manifest; unfinished pre-upgrade custom-named Swing requests without a saved name require recovery by the key owner, rather than an automatic resubmission.

Optional batch names can follow an integrator’s conventions for organization or request correlation. That convention must not be treated as authorization. Maintain server-side ownership mapping for each batch ID, motion/job ID, and derived asset; never expose a shared-key account history to end users. No shared production credentials belong in a workflow or browser bundle.

### Assets and capture alignment

The client preserves ordered actor indices across `exportURLs`/`exportFilenames`, body BVH, MHR metadata, native actor references, and optional `cameraFbxURL`. Public response fields include `mhrBvhURLs`, `mhrIdentityJsonURLs`, and native MHR FBX in the historical `faceURLs[i].bvhURL` slot. Do not treat that field name as proof that the file is BVH.

The viewer prefers exported GLBs. For Cartwheel captures it verifies skeleton/timing against native references; when a compatible complete native MHR FBX exists, it can render that original asset instead of incorrectly retiming an incompatible GLB. This fallback is capture-specific. Independent uploads can also use compatible animated FBX actors; this does not change the service export requests. Preserve setup-frame/body alignment separately from independent facial/morph timing. Relative actor placement must remain shared, not centered per actor.

## 6. Paid-job durability, progress, and interruption

- **Performance Capture reuse:** input bytes + connection fingerprint + options identify an existing local request. Matching completed jobs with valid assets are reused. `capture_version` explicitly requests another paid take. Missing assets can be redownloaded from an acknowledged batch rather than recaptured.
- **Swing Choreo:** unfinished acknowledged jobs resume; a completed request is not a permanent same-prompt cache because new generations are intentionally distinct. Normal ComfyUI session caching may reuse an unchanged executed node. Saved jobs is the deliberate reuse path.
- Submission intent is journaled before POST, with a file lock preventing concurrent duplicate submission. An unknown submission outcome without a batch ID stops for investigation instead of sending another POST automatically.
- A failed/rejected job and a lost response are different states. Existing accepted batch IDs survive local wait/download failure. Definitively failed jobs can require a new paid request; do not imply refunds.
- The reference polls about every five seconds for up to one hour. These are client choices, not service guarantees.
- Progress displays stage, elapsed time, and an approximate locally calculated wait. The estimate is not queue telemetry and can be exceeded.
- Interruption stops local work/waiting. The current client does not issue a remote cancellation or promise refund/rollback after submission. An accepted request remains subject to the provider’s cancellation and billing rules.

Implementation: `client.py`, `text_generation.py`, `job_progress.py`. Submission journals live in ComfyUI’s system user area; assets live under its output directory. Hosted equivalents need durable, user-owned server records.

## 7. Source-independent data contracts

### Shared scene conventions

Use a versioned, right-handed, **Y-up world in meters**, seconds from clip start, and unique actor IDs 1–4. Camera quaternions are `[x,y,z,w]`; local camera forward is −Z, up is +Y. Keep source and output timing separate; export FPS is not permission to retime performers.

An asset reference is `{filename, subfolder, type:"output"}` within the configured output root. Paths must resolve under that root and exist. Hosted implementations should replace this local-reference mechanism with authorized asset IDs, keeping equivalent ownership checks.

`CARTWHEEL_MOTION` is a custom socket label, not a provenance restriction. Its main shape is:

```json
{
  "schema_version": 1,
  "world_frame": {"id": "<scene identity>", "units": "meters", "up": "Y", "handedness": "right"},
  "timeline": {"duration": 8, "start_seconds": 0, "basis": "glb"},
  "actors": [{"id": 1, "glb": {"filename": "actor_1.glb", "subfolder": "cartwheel/scenes/<id>", "type": "output"}}],
  "scene": {
    "duration": 8,
    "material_policy": "preserve",
    "actors": ["<validated actor descriptors: asset reference, actor ID, format, animation metadata>"],
    "camera": "<default / camera_json / FBX descriptor>"
  }
}
```

The placeholder strings explain nested records; they are not valid import payloads. `scene.actors` contains the full evaluated asset descriptors, not just the simplified public actor list. Implementation: `motion_io.py`, `scene.py`, `glb_metadata.py`, `fbx_metadata.py`.

Upload mode is GLB-first and accepts 1–4 animated actor files, positive duration up to 120 seconds, with shared coordinate/timing conventions. Multiple actors use the maximum clip duration. Do not promise arbitrary-rig retargeting, unit/axis repair, or semantic anatomical mapping for arbitrary names. Mesh playback, manual camera positioning, fixed markers, and depth/normals do not require MHR semantics; body-part targeting and pose visualization need recognizable joints.

### FBX upload compatibility

GLB remains the primary interchange format. Performance Capture and Swing Choreo continue requesting GLB with a mesh; accepting uploaded FBX does not alter either service request or the native capture-alignment fallback.

Independent actor uploads also accept **binary FBX 7.x** containing an animated mesh and an animation take with a positive duration up to 120 seconds. FBX must declare a positive unit scale and a supported Y-up, X-right coordinate frame (front-axis sign may be positive or negative). Units are converted to meters without resizing actors individually. Export baked animation and include the mesh. ASCII FBX, camera-only/static actor files, negative take starts, arbitrary axis repair, and automatic rig retargeting are not supported. External texture paths are not fetched; package textures in the asset or use GLB.

The first animation take is used; FBX animation should be baked into one layer (the bundled loader uses the first layer). Its nonnegative LocalStart/LocalStop interval (or global time span fallback) is rebased to clip time zero; interpolated boundary samples preserve the starting and final poses. This mapping applies only to uploaded FBX actor descriptors; existing capture and camera-FBX timing is unchanged. Uploaded files remain FBX on disk and in saved-scene exports. An actor descriptor contains `format:"fbx"`, `meters_per_unit`, `duration`, and `animation_start` in source seconds; its public actor record uses `fbx` rather than `glb`. Timeline basis is `fbx` for all-FBX imports or `imported` for mixed GLB/FBX imports. Existing all-GLB contracts remain unchanged.

Individual actor files and a separate optional camera are the expected input layout. A whole GLB or compatible FBX scene is also accepted. The importer groups skin-connected meshes into character rigs, or identifies independently animated hierarchy branches for rigid characters, retaining their parent transforms and relative placement. Up to four characters are supported across all selected files. A file containing five actors is rejected rather than silently truncated. Unassigned static meshes are retained as background geometry, outside actor targeting. Ambiguous hierarchies are not semantically retargeted; export individual characters if the automatic grouping does not match the intended actors.

A compatible embedded perspective camera is used automatically when no separate camera is supplied. The first available one is the default; supported cameras remain available in the source descriptor. A separate uploaded camera overrides embedded cameras. Orthographic embedded cameras are ignored. Uploaded GLB cameras retain glTF’s camera basis; FBX cameras keep the existing FBX-to-viewer basis. An embedded camera descriptor references the same source asset with `embedded:true`, compatible camera metadata, and a node selection.

Each separated actor descriptor uses `selection:{nodes:[...]}` containing FBX model IDs or GLB node indices. All needed parent transforms and skin joints remain. `background_nodes` on one actor descriptor retains the file’s unassigned geometry exactly once. Saved scenes preserve these selectors and original source files, so reopening restores individual targets and the embedded camera. FBX animation tracks additionally retain source model IDs in the bundled loader; the import adapter binds selected tracks by object UUID to handle repeated bone names across characters. External textures are not fetched. Shared world placement and synchronized take starts must be authored in the files. Recognizable bone names are still required for anatomical aiming and pose visualization; manual positioning and fixed aim markers remain available for other rigs.

### Optional starting camera and separate reuse

Without a camera, import creates a default perspective view. With one, accept supported camera JSON or perspective-camera FBX. A `CARTWHEEL_CAMERA` wrapper carries `schema_version`, `world_frame`, `timeline`, and validated editor `settings`; starting-camera wrappers additionally carry a source descriptor and optional anchor. Camera Preview can accept it separately from motion.

When a camera belongs to a different source scene and carries an actor anchor, registration transfers its relative camera relationship to a target actor in the new motion. The current adapter uses the first target actor and supports duration fitting/holding internally. A plain JSON file without source-actor registration metadata is an absolute camera path; do not claim automatic semantic registration for every arbitrary import. An edited recipe requires its matching motion, or must first be sampled to a reusable camera path.

### Portable sampled camera JSON

```json
{
  "schema_version": 1,
  "units": "meters",
  "up": "Y",
  "fps": 24,
  "aspect": 1.7777777778,
  "lens_projection": "perspective",
  "frames": [
    {"time": 0, "position": [0, 2, 6], "quaternion": [0, 0, 0, 1], "fov": 37.85},
    {"time": 8, "position": [1, 2, 6], "quaternion": [0, 0, 0, 1], "fov": 37.85}
  ]
}
```

The first frame is time zero; times strictly increase. Use quaternions consistently, or `target:[x,y,z]` consistently, throughout an imported document. Optional fields include roll, per-frame projection, `cut`, focal length, sensor height, and `editor_recipe`. The current validator accepts 1–14,401 samples, FPS 1–120, aspect 0.1–10, sample times up to 120 seconds, and finite coordinates bounded to ±100,000 m. Perspective FOV is 5–150°; fisheye can extend to 180°. JSON upload is capped at 10 MiB. A target must differ from camera position; quaternions must be nonzero and are normalized.

Rendered samples include a `target` one meter down the optical axis, marked `target_semantics:"optical_axis_1m"`. This is not necessarily the selected performer/body point. Preserve orientation, rather than assuming this target encodes anatomical intent.

The output includes exact clip-end camera state in addition to regular rendered-frame samples. `cut:true` preserves discontinuities. `editor_recipe` holds editable state; consumers that only need animation can ignore it. The Blender helper imports perspective samples into one animated camera; it is not a native Blender camera JSON format and does not reproduce the fisheye shader. Actor imports are separate.

## 8. Camera editor behavior and controls

### Startup, toolbar, and input modes

The primary editor opens ready to edit the starting camera, preserving its path/lens rather than replacing every import with a generic shot. Internally `mode` may be `captured`, `bookends` (manual/source path), or `preset`; `history` remains compatibility-only.

Toolbar: Edit camera / Starting camera, orientation, aspect ratio, Visibility, View, named Save scene, Undo/Redo. Starting-camera viewing can retain the prior edit. Inspection orbit/pan is separate from the authored output camera. Scene-only labels, gizmos, paths, thirds, and tracking guides never enter the camera render. `F` frames the selected camera/path/aim control in the inspection view.

Reset camera restores the selected block to the scene’s static starting view and default editing settings, retaining its interval. Existing neighbor poses are frozen before detaching its connections, so resetting it does not move other shots. Reset scene returns to one full-length starting block. Both are one undoable operation. They do not delete source assets or refund jobs.

The editor is intentionally large (minimum node approximately 1560×1700 in the current frontend), prioritizing settings space and a larger player. Load-time spacing repair handles the supplied full workflow’s enlarged/dynamic nodes and groups without editing links or camera settings. It is not a generic auto-layout system for arbitrary graphs.

### Visible controls

| Control | Current behavior / values |
| --- | --- |
| Camera | Static, Moving, Follow subjects. Moving defaults to Manual path. |
| Target | Single actor; both actors/full group; selected subset for larger scenes; fixed custom marker. Redundant actor selectors hide when irrelevant. |
| Aim | Face; chest; both hands/left/right hand; shoulders; hips; both feet/left/right foot. Uses evaluated animation landmarks. Hidden for a custom marker. |
| Composition | Auto, center, upper/lower centered thirds, left/right thirds, four corner-third intersections. These place the selected focus at image coordinates, not inside an unspecified quadrant. |
| Camera follow strength | 0–1, default 0.25. Steady to tight following; hidden for a fixed marker. |
| Camera distance | Horizontal distance to the selected-root pivot. Slider Far → Close, 0–30.48 m physical range; numeric/gizmo placement can exceed that. Moving beyond slider range is retained until the slider is used again. |
| Orbit | Counterclockwise-positive bearing, displayed 0–360°, around the selected actor(s)’ average roots or fixed marker. It and the gizmo update one another. |
| Height | World Y, slider −5–15 m with typed placement beyond the slider where valid. |
| Lens | 10–200 mm focal-length slider, initially 35 mm for ordinary new shots; supplied cameras retain their actual lens. New recipes use cropped/rotated 36×24 mm filmback calibration. |
| Fisheye | Separate projection toggle; diagonal FOV slider 120–180°, initially 160°, replacing the lens slider in place. |
| Horizon tilt | −90° to +90°, one-degree UI increments. |
| Output frame | Original input, Landscape, Portrait; 16:9, 4:3, 1:1, 21:9 with portrait inversion. |
| Video render | Short-side 720p/1080p, default 720p; 24/30/60/120 FPS, default 24. Even output dimensions; long side capped at 4096. |
| Movement | Manual path, pan, tilt, push, pull, truck, pedestal, orbit, crane, zoom, dolly zoom; follow behavior handles traveling subjects. Relevant amount/direction controls appear alongside it. |
| Path | Straight/curve, Ease in/out, Add/Remove point; at most five added adjustment points. |
| Custom start/end settings | Optional target, aim, composition, follow strength, focal length, horizon tilt, fisheye FOV changes. Position is controlled by the path. |

A custom marker is finite world-space XYZ and remains fixed. Its marker/arrow overlays are excluded from output. It supports Static or Moving, not Follow subjects. Old held-reference aiming migrates to an equivalent fixed marker instead of exposing the confusing reference-frame picker again.

The orbit pivot is distinct from the aim point: selecting hands changes aim, not the group’s root-based position controls. Facing uses chest/shoulder orientation for new edits. Hidden compatibility options such as POV/over-shoulder, pelvis basis, whole-clip widening, and custom tracking must not be presented as current visible features.

### Tracking and lens invariants

Follow focus uses actual world-space tracks from the selected body parts, averaged across selected actors/parts. A local temporal fit considers nearby action, with an approximately 1.8-second maximum neighborhood shortened by travel/acceleration and the visible shot size. Follow strength blends that stable target toward the instantaneous pose. A projected action envelope nudges framing when feasible; it does not force an impossible close-up to fit by zooming out. Endpoint filtering and feasibility transitions avoid brief start/end flickers.

Authored position and lens remain fixed during ordinary manual movement/follow aiming. A close hand shot can need more visible aim correction than a wide shot; this is view-dependent framing, not a hidden focal-length change. Deliberate Zoom/Dolly zoom or per-block lens animation are explicit exceptions. Imported camera lens animation is retained until overridden.

### Manual curves and movement presets

Default manual motion starts as a roughly ten-foot straight path, not coincident endpoints. Positive XYZ translation arrows manipulate selected controls. Curve handles display at one-third of their effective offset to reduce clutter. Only the selected marker’s handles show; added adjustment points have independent incoming/outgoing handles, with Smooth joins optional. Clicking markers selects them; no edit-marker dropdown is required.

Imported or LLM-authored source samples remain the base curve; handles/points deform that curve rather than discarding it. Cubic source interpolation is explicit; legacy/linear paths remain linear. A fast drag guide is replaced with the full curve after release or a completed asynchronous edit. Pointer release/cancel/lost-capture cleanup must not leave stale interaction state.

Preset position math uses the placed camera’s relationship to the selected pivot rather than assuming it is in front. A push-in ends at the placed camera; increasing travel extends its start backward. Pull-out starts there and extends away. Rare timing lives in Custom start/end settings. Start moving at delays motion; Finish moving at completes it, with zero meaning clip end. In timeline mode these map to the selected block’s interval.

Start/end settings interpolate numeric values and the resulting target positions. Actor identities/body-part enum names are not numerically interpolated. Actor-to-marker or actor-to-actor aim changes interpolate evaluated spatial targets. Camera cuts/projection changes are discrete where required.

## 9. Multi-camera timeline and editable persistence

`camera_timeline` schema 1 contains `fps`, full `duration`, scene `world_frame_id`, `selected_id`, `next_id`, ordered `segments`, and adjacent `joins`.

Each segment stores stable `id`, visible `name`, `start/end`, `source_start/source_end`, a complete single-camera `settings` recipe, `offset_start/offset_end`, optional `animation_range`, and optional `ease_start/ease_end` with frame counts. Visible names renumber Camera 1…N left to right; IDs remain stable.

- Maximum 64 segments. Times snap to output frames, minimum one frame; fractional exact clip end remains legal.
- Right-click Split at the playhead creates/selects the right block. An untouched split preserves position, orientation, lens, and pacing. Source intervals and a `preserve` join prevent unnecessary smoothing from changing an already continuous path.
- Drag body through free time; drag individual edges without pushing neighbors. Blocks cannot overlap or reorder. A shared seam handle adjusts both neighboring timing boundaries together.
- Resizing changes how fast the retained movement interval plays; it does not trim the performance.
- Gaps hold the preceding final camera pose, or the first camera’s starting pose before the first block. Actors continue animating. Right-click empty time can fill the interval with a static camera matching the held view.
- Delete leaves a hold and preserves surviving paths. At least one block remains. Disconnect does not silently reposition either path.
- A join stores `left/right`, `connected`, `smooth`, `frames`, `preserve`, and optional shared `point`. Connected endpoints share position. New split joins default connected/smooth with **30 frames**; explicit saved lengths and disabled preferences remain.
- Touching transitions straddle the boundary and shorten to fit short blocks. Across a gap, outgoing and incoming hold easing are independent; the gap itself stays still. New unconfigured hold edges default smooth. Duration fields are hidden while smoothing is off.
- Filling/rejoining around existing explicit preferences retains conservative connection choices and shorter saved transition lengths. Missing prior connections now default to smooth connected insertion; do not copy the older documentation’s disconnected-by-default rule.
- Smooth changes blend camera position, orientation, and lens. Fisheye/perspective projection switches at a defined midpoint; it is not a physically continuous projection morph.
- Playback’s active block and the user-selected editable block are independent. Only the selected block’s path controls are interactive.

Undo/Redo retains up to 80 camera states within a roughly 32 MiB bound. One drag or an entire valid LLM result is one edit. Text fields retain native text undo. Playback, scrubbing, and inspection navigation are not recorded as authored camera edits. Undo changes local camera state; it does not undo a paid service call.

Save scene retains the full timeline plus sampled camera animation and actor references/assets in local saved output. Loading current timeline-bearing snapshots restores editable blocks. Matching uploaded GLBs plus exported JSON with `editor_recipe` can restore them too, with scene-identity validation. New unrelated motion resets incompatible camera edits.

## 10. Embedded LLM camera authoring

### User experience and model dispatch

The AI panel is inside Camera Preview. It offers installed native GPT/Claude/Gemini choices, defaulting to `gpt-6-sol` when available and retaining explicit saved choices. The system prompt is **hidden** in the UI; user/system roles remain separate internally. It is a working default that has performed well in testing, not a proven optimum. Refining the system prompt can improve results. User instructions may reference actor numbers, camera numbers, frame numbers (interpreted against the supplied FPS), and absolute shot timings. More specific instructions generally produce more controllable results; the model still has to interpret them and may need another user-directed revision. Users can change the entire sequence or selected cameras, and preserve existing blocks if desired. The request can create multiple blocks when explicitly requested; default instructions prefer one continuous camera per permitted range.

Whole-clip reference extraction/token preparation happens only on **Submit**, not while scrubbing, moving the camera, typing, or selecting blocks. This is important for responsiveness. The button does not require a preexisting background-preflight cache.

Native ComfyUI account/workspace authentication is resolved at submission. The extension queues native text nodes and an internal result output through ComfyUI’s normal prompt execution. It does not accept or save LLM provider secrets in camera data. Model availability depends on installed node adapters and the reference rate/output-cap catalog; it is not a universal model marketplace.

Exactly **one provider model generation per Submit**, with no automatic time chunks, retries, repair calls, continuations, or parallel scene fragments. A local one-use review ticket expires after 180 seconds and is consumed before native queue submission. Duplicate clicks/request IDs are rejected. Output is bounded to 8,192 tokens including reasoning; a local tokenizer reserves that output within a 120,000-token total allowance. Unknown/unbounded adapters are excluded. There is no dollar cap or cost/token/count banner in the UI. Revisit adapter/catalog logic when changing native ComfyUI integrations.

### Numerical scene reference

The live request does not send raw BVH text, all raw bones at every frame, or a video/screenshot attachment. It evaluates the existing animated scene and sends a **compact numerical whole-clip document**:

- Context `schema_version:2`, `format:"compact_world_tracks"`, millimeters, Y-up, right-handed, duration/FPS/aspect.
- Per actor: IDs, available semantic labels, and main body joint tracks. Positions are `[source_frame_index,x_mm,y_mm,z_mm]`; time is `min(frame_index/fps,duration)`.
- Tracks simplify the evaluated source poses within 10 mm positional error at source frames, plus millimeter rounding. Recognized rigs omit procedural/twist/finger joints. Unknown rigs retain usable actual joints without pretending all semantic labels exist.
- Head quaternion tracks, when mapped, use scale 10,000 and approximately two-degree tolerance.
- Existing camera rows: `[time_seconds,x_mm,y_mm,z_mm,qx,qy,qz,qw,vertical_fov_degrees,projection]`.
- Existing camera block IDs/names/times/type/movement, allowed edit ranges, `keep_blocks`, and protected boundary samples.

This is a reference approximation; original animation remains untouched. It provides spatial action context, not exhaustive finger/contact/occlusion or arbitrary collision geometry. The model knows the numerical output format and can author beyond the movement presets; it does not have to call those presets to aim or move.

### Model response contract

```json
{
  "schema_version": 1,
  "summary": "One continuous move",
  "blocks": [{
    "start": 0,
    "end": 8,
    "position_interpolation": "cubic",
    "transition": "continue",
    "frames": [
      {"time": 0, "position": [0, 2, 6], "quaternion": [0, 0, 0, 1], "fov": 37.85, "lens_projection": "perspective"},
      {"time": 8, "position": [1, 2, 6], "quaternion": [0, 0, 0, 1], "fov": 37.85, "lens_projection": "perspective"}
    ]
  }]
}
```

Output positions are **meters**, unlike millimeter input tracks. Times are absolute clip seconds. `transition` is `continue` or `cut` into a block. Samples strictly increase and include exact block start/end. One or more blocks must cover each permitted range exactly, with no gaps, overlaps, or out-of-scope data; an entire-sequence request covers the exact whole clip. Continuous neighboring blocks must match boundary position, quaternion, FOV, and projection. Keep-blocks scope preserves required block timing. Protected neighboring camera poses remain unchanged.

`position_interpolation:"cubic"` uses time-aware Hermite curves through authored points with shared, limited tangents. `linear`, or omission, preserves intentional straight/angular paths. Two points are still a straight move. FOV is linear and orientation uses shortest quaternion slerp. Source cuts remain cuts; repeated positions can hold. There is no automatic aim, collision avoidance, or hidden preset tracker applied after the model authors orientation.

Strict validation rejects malformed/truncated data, nonfinite coordinates, bad quaternions, invalid FOV/projection, sample overflow, changed scope, and mismatched continuous boundaries. Nothing executes returned code. A valid result applies atomically as one Undo step; green Completed clears on subsequent prompt/model/scope/camera edits. Errors, local application failure, Stop, or a stale scene do not overwrite the shot or trigger another model call. Stop ends local waiting; an accepted model job can still finish/be billed.

Implementation: `camera_instructions.py`, `instruction_budget.py`, `instruction_routes.py`, `instruction_nodes.py`, `web/camera_instructions.js`, `web/instruction_motion.js`, `web/instruction_compact.js`, `web/instruction_animation.js`, `web/instruction_queue.js`.

## 11. Local video, data passes, and endpoint frames

The browser evaluates animated Three.js geometry at output times, renders WebGL frames, and streams sequential PNGs to the local Python encoder. The requesting browser must remain connected. This is not headless server rendering and does not require a separate AI inference model. Local CPU/GPU/encoding time remains real work.

One camera sequence drives edited video, depth, normal, pose, sampled camera export, and endpoint extraction. Scene inspection gizmos, labels, markers, and guides are excluded. Color render retains performer colors as useful prompt identifiers; there is no separate required grayscale-beauty output.

| Pass | Actual encoding and limits |
| --- | --- |
| Edited camera | Rendered animated scene, including intentional lens/projection changes and cuts. |
| Depth | Grayscale **radial camera distance**, not camera-Z or a standardized metric-depth file. Background black; actor foreground mapped approximately 0.12–0.98. One fixed range per clip is estimated from sampled animated actor bounds and camera positions, including block boundaries; padded near/far prevents distant actors fading to background merely because of a shallow fixed range. Not an exhaustive per-frame coverage guarantee; inspect metadata for range. |
| Normal | Animated world-space normals mapped RGB = normal×0.5+0.5, black background. Do not assume tangent-space or camera-space normal conventions. |
| Pose | Colored major-joint skeleton segments from recognized names/aliases, black background. It is not an OpenPose/COCO JSON contract or a learned detector. Unknown joint mappings can omit actors and produce a warning. |

Each pass uses the same projection, aspect, timestamps, and cuts. Depth/normal/pose render and display locally but are **not enabled as AI references by default**. They are visual MP4 guidance, not lossless numerical EXR buffers.

Camera video sidecars retain sampled camera JSON, render provenance, source-media/audio reference, available passes, depth range, and pose mapping status. First/last IMAGE outputs are raw camera-render frames, not automatic generative images. They describe the camera render’s endpoints, not automatically the endpoints of a later shortened Prepare window; if trim changes the intended endpoints, regenerate/select appropriate images rather than assuming automatic rematching.

## 12. Creative-reference preparation and final generation

### Collection and toggles

Creative References is an ordered local collection of image/video/audio items with `file`, `name`, `enabled`, and optional `start/duration`. Formats include PNG/JPG/JPEG/WebP; MP4/MOV/WebM/MKV; WAV/MP3/M4A/FLAC/OGG. Upload is local and does not call model services. Disabled entries are skipped, not removed.

Prepare also accepts individual optional image/video/audio sockets for older/custom graphs. There is no original-source-video input here. The primary input is the edited camera video; an additional creative video is independent guidance. Source-audio recovery uses render provenance, not another visible source-video socket.

Four independent camera-video switches: edited camera **on**; depth, normal, pose **off**. Any combination can be enabled, including none if another image/video guide exists. At least one image/video reference is required. Missing disabled inputs should not execute or consume a provider slot. Browser graph helpers disconnect legacy optional gates where necessary; lazy branches protect optional operations.

### Current installed-adapter limits

| Model | Images | Videos total | Audio total | Shared video seconds | Separate shared audio seconds | Generated seconds |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Seedance 2.5 | 30 | 10 | 10 | 30 | 30 | Whole 4–30 |
| MiniMax H3 | 9 | 3 | 3 | 15 | 15 | Whole 4–15 |

These are reference-client/native-adapter limits, not Cartwheel API quotas or guarantees for every future provider version. Enabled camera passes and endpoint images count in totals. Video limits are aggregate duration, not a separate full allowance for every input. Each enabled video/audio reference needs at least 1.8 seconds. Native resolution/FPS/content validation still applies. Media wired directly to a provider outside Prepare bypasses its budget accounting.

Prepare knobs: model (default Seedance 2.5), prompt, start seconds (0), duration (0 = maximum available), optional end (0 = use duration; mutually exclusive with explicit duration), requested output whole seconds (0 = auto), optional creative-video start/duration, audio start, individual-reference switches, original-audio preservation (on), endpoint inclusion (off), and independent pass flags.

Automatic windows share the model allowance while respecting shorter media and reserved minimum lengths. Multiple camera passes all use **the same** selected start/duration and each consumes that duration from the shared budget. Adding passes can shorten the performance window; report the actual window clearly. Creative video/audio windows can be independent. A 7.5-second primary window requests a supported whole duration (normally 8 seconds), then final assembly trims the extra tail. Output ratio is adaptive.

Prepared pack (`CARTWHEEL_PREPARED_REFERENCES`) contains `model`, `images`, `videos`, `audios`, supported integer `duration`, `ratio`, `prompt`, `info`, and `delivery`. `info` records actual windows, counts, notices, camera-pass numbering, and delivery duration. `delivery` records exact selected start/duration and an optional original-audio source reference.

Default prompt:

> Follow Video 1 exactly for motion, timing, blocking and camera movement. Keep the same framing from start to finish, with no added zooms, cuts or close-ups. Use Video 1 for motion only, not for its look. Re-render the scene to match the reference images or description.
> 
> Cinematic, photoreal, shot on film. Natural, motivated lighting that fits the scene, with film grain and realistic texture.
> 
> Avoid: changing the motion or framing, added zooms or cuts, letterbox bars, a CGI or digital look.

When edited camera is included it is Video 1. Other enabled camera passes precede creative videos; use the displayed actual numbering. Generic images precede appended endpoint images. Disabling the camera with the untouched default prompt switches to a generic creative-reference prompt rather than referring to a nonexistent camera video.

### Native generation and delivery

`CartwheelGenerateVideo` expands **one** installed native node: `ByteDance2ReferenceNodeV2` for Seedance 2.5 or `MinimaxHailuo03ReferenceNode` for H3, then `CartwheelFinalizeVideo`. The native adapters handle account authentication, uploads, billing, and provider errors. Default generation seed is 42. The generator selects 720p for Seedance and 768P for H3; provider capabilities may change.

Original audio is a final soundtrack operation. When requested and a retained source has audio, final assembly selects the corresponding source interval and replaces/restores that soundtrack; it is not uploaded as AI audio guidance by that flag. Without a selected available original soundtrack, generated audio can remain. No audio is invented for a silent GLB or text-only source.

Finalization respects the selected fractional duration, preserves frame timing, and does not stretch insufficient generated footage. A too-short provider result errors. Container timestamps/encoding retain the exact intended window where supported; do not promise a different provider FPS or sub-frame image synthesis. Side-by-side comparison is silent, starts both sides together, and holds the shorter side’s final frame.

## 13. Optional endpoint-image styling

Styling is opt-in independently on first and last nodes. Disabled means raw frame pass-through, no paid image call. A shared uploader or individual sockets supplies **at most five generic appearance references total**. These represent characters, wardrobe, environment, or style; they are not mandatory separate first/style slots.

The last styling request uses:

1. Its own raw **last camera frame**, defining camera, crop, pose, performer count, and layout.
2. The same generic appearance references, in stable numbering.
3. The raw first frame and styled first frame as a before/after identity mapping.

The continuity pair must not replace the last frame’s angle or pose. This supports mapping colored source performers to reference identities across shots. Prompts reinforce the hierarchy, but generative fidelity is not guaranteed.

Current adapters: OpenAI `OpenAIGPTImageNodeV2` (`gpt-image-2`, low quality, one image), Google `GeminiImageNode` (`gemini-2.5-flash-image`), BFL `Flux2ImageNode` (`Flux.2 [pro]`). These are installed adapter choices, not contractual future model names. RGB, grayscale, and RGBA tensors are normalized to usable RGB; alpha composites over white. Generic batch images are split consistently; target and continuity frame inputs must be single frames.

`CartwheelEndpointReview` separately controls local preview and **Use start/end frame images for video**, initially off. This Boolean feeds Prepare. Including the images consumes ordinary image-reference slots; current video wrappers send them as references, not as a guarantee of a provider-native locked first/last-frame interpolation mode.

## 14. Files, local reuse, and security boundary

Typical storage:

| Location under ComfyUI output | Contents |
| --- | --- |
| `cartwheel/<capture-or-generation-id>/` | Captured/generated assets and manifests; retained source when applicable. |
| `cartwheel/scenes/<identity>/motion.json` | Source-independent scene descriptors and imported assets. |
| `cartwheel/saved_jobs/<snapshot>/` | Named/automatic snapshots, retained scene assets, sampled camera, recipe, previews. |
| `cartwheel/renders/` | Local render cache and provenance sidecars. |
| `cartwheel/comparisons/` | Synchronized comparisons. |

Save scene actively renders the current edited view and saves a separately named local snapshot without recapturing/re-generating motion. It stores the motion/camera references, sampled output and editable timeline, and updates the extension’s local Saved jobs catalog. Camera Preview execution also persists a result. This explicit save/catalog behavior is implemented by the extension, not an assumption about ComfyUI’s generic history or Assets browser. Local job listing scans saved snapshots, local capture manifests, and standalone imported scenes. It does not call `GET /motions` or another account-history API. Missing/deleted entries are skipped. Keep referenced assets/output to retain reuse; a workflow JSON alone is not an asset bundle. Portable local job archives can include actor files, native fallbacks, camera, recipes, and the perspective Blender helper. Video players provide download controls; local file-bundle utilities are also available.

### Security boundary and hosted deployments

The extension is a **single-user local ComfyUI integration**. Its key setting is production-only; multi-user credential loading is refused. An environment variable can override the local saved key. This is not a hosted credentials/account design.

A hosted deployment using shared service credentials needs additional controls:

- Keep the organization key server-side. Never put it in browser settings, workflow JSON, exports, screenshots, or logs.
- Record user ownership of every submitted batch/job and every derived asset. Authorize lookup/poll/download/save operations against that ownership.
- Do not expose shared account-wide motion listing and filter it in the browser. API credentials alone do not establish ownership by an application user.
- Replace local output-root trust with user-isolated storage and authenticated asset IDs. Same-origin checks alone do not provide hosted authorization.
- Keep durable request identity, acknowledged batch IDs, and idempotent/resumable behavior across proxy restarts.
- Minimize retained prompts/assets, set retention/access policy, and explain that motion/camera data go to the chosen LLM and enabled references go to image/video providers.
- Preserve public-HTTPS/SSRF protection for returned URLs, no redirects for authenticated/transferred requests, no API key on storage transfers, path traversal protection, upload/download bounds, and atomic file writes.
- Map provider failures to useful public errors. The reference deliberately avoids echoing raw Cartwheel worker details, private paths, or signed links.

The extension uses the public service endpoints and bundled scene/render code. Runtime assets and account credentials belong to the current installation.

### Local routes are implementation details, not Cartwheel cloud endpoints

| Local route | Purpose |
| --- | --- |
| `POST /cartwheel/scene/upload` | Actor/camera upload to local input storage; 250 MB per file, format validation. Optional `kind=motion|camera` distinguishes FBX roles; absent means legacy auto detection. |
| `POST /cartwheel/references/upload` | Local creative/frame reference upload; suffix/path/size checks. |
| `GET /cartwheel/local-jobs` | Local saved output catalog. |
| `GET /cartwheel/local-jobs/download?job=…` | Authorized-local-root bundle utility. |
| `POST /cartwheel/local-jobs/save-camera` | Named scene save using loaded motion and browser render. |
| `POST /cartwheel/camera/prepare` | Prepare compatible scene/camera for the editor. |
| `POST /cartwheel/render/{token}/{action}` | Token-bound render start, sequential frame/pass upload, finish/error. |
| `GET /cartwheel/camera-instructions/models` | Installed model catalog and internal prompt/contract. Hidden in UI does not mean the prompt is an access secret. |
| `POST /cartwheel/camera-instructions/review` | Local scope/token validation; short-lived single-use ticket, no paid execution. |
| `POST /cartwheel/camera-instructions/prepare` | Consume ticket and return one native ComfyUI graph. |
| ComfyUI native `/prompt`, events, `/view` | Native authenticated execution, result events, and local asset serving. |

Local routes reject cross-site browser origins; calls without Origin can still be local/CLI. Render requests are dispatched to the requesting browser; token-indexed callbacks expire and enforce frame order/size/count. The callback route itself is a same-origin local token mechanism, not independent user/session authorization. They do not replace authentication in a hosted system. Remote asset streaming is capped at 1 GiB per asset. Local upload paths are server-generated; failed uploads remove partial files.

## 15. Source map and compatibility guidance

All paths below are relative to the repository root.

| Concern | Files |
| --- | --- |
| Node registration/current workflow | `__init__.py`, `nodes.py`, `Cartwheel-Motion-to-Video.json` |
| Public API, credentials, recovery | `config.py`, `client.py`, `transport.py`, `text_generation.py`, `swing_choreo.py`, `job_progress.py` |
| Source selection / preview checkpoint | `source_selector.py`, `workflow_step.py`, `web/source_selector*.js`, `web/workflow_step.js` |
| Scene formats / native alignment | `motion_io.py`, `scene.py`, `glb_metadata.py`, `fbx_metadata.py`, `web/camera_scene.js`, `web/glb_timing.js` |
| Camera recipe / target / optics | `camera.py`, `camera_presets.py`, `camera_format.py`, `web/camera_editor.js`, `web/priority_controls.js`, `web/camera_position.js`, `web/camera_presets.js`, `web/camera_composition.js`, `web/action_follow.js`, `web/manual_tracking.js`, `web/lens_projection.js` |
| Manual paths and gizmos | `web/manual_path.js`, `web/manual_path_editor.js`, `web/positive_axes.js`, `web/scene_focus.js` |
| Timeline / animation | `camera_timeline.py`, `web/camera_timeline.js`, `web/camera_timeline_editor.js`, `web/camera_sequence.js`, `web/camera_transition.js`, `web/camera_reset.js` |
| Drag/scrub / layout | `web/slider_interaction.js`, `web/workflow_spacing.js`, `web/workflow_spacing_extension.js`, `web/source_naming.js`, `web/source_naming_extension.js`, `web/camera_preview.css` |
| Local rendering / passes | `video_render.py`, `delivery.py`, `control_preview.py`, `web/camera_preview.js`, `web/control_passes.js`, `web/lens_renderer.js` |
| Reference prep / native generation | `media.py`, `reference_library.py`, `web/reference_library.js`, `web/reference_info.js`, `web/reference_toggle_state.js` |
| Frame-image branch | `endpoint_images.py`, `frame_references.py`, `web/endpoint_images.js`, `web/frame_reference_library.js` |
| Save/reload/export | `local_jobs.py`, `local_job_routes.py`, `comparison.py`, `blender_camera_import.py` |
| LLM | Files listed in §10; native adapter choices depend on installed ComfyUI. |

Retain schema-version checks and distinguish current visible UX from accepted legacy storage fields. Do not reintroduce API history, a manual marker dropdown, constant-size auto-zoom, automatic LLM batching, Apply/Discard, confusing reference-frame controls, or hidden-parameter panels simply because old enums/code still support earlier workflows.

Redistribution and reuse are subject to the applicable source and dependency licenses; retain the bundled vendor notices.

## 16. Validation, known limits, and acceptance checklist

The automated baseline contains **181 Python unit tests**, **53 self-contained JavaScript checks**, and native ComfyUI integration scripts using synthetic media and mocked paid services. The suite covers workflow layout, camera controls, scene imports, save/reload, provider dispatch, and local transport safeguards. See [Validation](docs/validation.md) for commands and platform/service limits.

Run from `custom_nodes/` with ComfyUI’s Python environment and Node.js 22 or newer:

```text
python -m unittest discover -s tests -v
node tests/check_whole_scene.mjs
node tests/check_fbx_scene.mjs
node tests/check_workflow_spacing.mjs
node tests/check_slider_interaction.mjs
node tests/check_source_naming.mjs
node tests/check_camera_resets.mjs
node tests/check_camera_timeline.mjs
node tests/check_timeline_editor.mjs
node tests/check_instruction_auto_apply.mjs
node tests/check_instruction_curves.mjs
node tests/check_instruction_spend_guard.mjs
node tests/check_instruction_compact.mjs
node tests/check_instruction_queue.mjs
```

Other standalone `tests/check*.mjs` cover optics, anatomy, timing, source routing, passes, framing, and compatibility. Some scene/GLB scripts require fixture paths rather than a bare invocation. Use ComfyUI’s Python for node/native integration checks. Required extra packages are `aiohttp`, `filelock`, and `tiktoken`; tiktoken may download its public encoding data on first use; Torch, AV, Pillow, NumPy, ComfyUI APIs, and graph execution are supplied by the compatible ComfyUI installation. The reference uses the V3 node/VIDEO/File3D APIs and native Partner nodes; validate against ComfyUI’s actual release rather than assuming every version matches.

### Behavior checks for changes

1. Select Load motion with a fresh source video still loaded: zero unused capture/text submissions.
2. Preview first with fresh and saved motion; final video branch stays unexecuted until selected.
3. One, two, and four actors; native capture, Swing Choreo, and non-Cartwheel GLB; no-camera import; shared actor placement and duration preserved.
4. Raised hands, bouncing gestures, walking/running, close/wide framing, unknown joint names; no implicit lens changes or endpoint flickers.
5. Manual/preset camera at front/side/back and custom position; all lens/projection/aspect combinations; intentional straight versus cubic moves.
6. Repeated slider/gizmo drag, release outside controls, cancellation, scrub immediately after split; no stuck capture or heavy automatic LLM extraction.
7. Split/resize/gap/fill/delete/connect/disconnect; exact split equivalence, frame boundaries, default 30-frame smoothing, explicit off, independent hold edges, no neighbor movement after deletion/reset.
8. Save/reload multiple editable blocks and all settings; sampled perspective export matches playback; camera/scene Reset and Undo/Redo.
9. Depth/normal/pose and endpoint images share camera/timing/cuts; distant actor depth range and unmapped-pose warning.
10. Enable several passes and creative references; synchronized camera windows, aggregate counts/durations, disabled inputs skipped, minimum lengths, clear limit errors.
11. Fractional selected duration with longer whole-second generated output; correct trim/audio offset; silent source; too-short result rejected; comparison start synchronization and last-frame hold.
12. First/last styling off makes no paid call; enabled branch sees every chosen appearance image and first-frame identity pair without overriding last-camera viewpoint.
13. LLM one-call behavior, stale edit, Stop, invalid/truncated JSON, token overflow, duplicate click, one-use review expiry/replay; no hidden retries; unselected cameras preserved; one-step Undo.
14. For any separately implemented hosted deployment, verify user-to-job/media authorization and storage isolation. The local extension does not provide those hosted controls.
15. Actual Windows/macOS/browser/native ComfyUI versions and provider sign-in. Windows hardware execution and the Blender helper are not established by offline installer tests.

### Known limits

- Hosted multi-user authentication, authorization and billing are outside this local integration’s scope. Service quotas and cancellation/refund policies come from the respective providers.
- No universal skeleton retargeter, automatic arbitrary-unit/axis fixer, or guaranteed body-part mapping for unknown rigs.
- No full DCC keyframe editor, editable aim Bézier timeline, native camera interchange standard, or guaranteed fisheye Blender import. More blocks plus optional start/end changes provide the intended lightweight control.
- LLM shot quality, motion collisions, performer clipping, and generative image/video fidelity need human review; numeric validation is not cinematic QA.
- Control-pass visual conventions and reference limits are specific to this implementation/installed adapters; revalidate them when changing providers or adapters.
- First/last-frame references do not automatically follow a later changed trim window or guarantee provider-native endpoint locking.
- Local saved jobs depend on retained files and are not cloud sync or account history. Source JSON, source ZIP, and a workflow JSON alone do not carry a user’s downloaded/generated assets.

## Appendix A. Stored camera-field catalog

The following catalog is generated from the current Python validator’s accepted single-camera `preset` fields. **It includes compatibility-only fields.** It is a format map for reading saved data, not a recommendation to expose every field in the app. Visible controls and new-shot defaults are defined in §8 and the current browser editor; Python fallback defaults often say `legacy` to preserve older files.

| Stored key | Validator fallback | Accepted values / numeric range |
| --- | --- | --- |
| `aim_source` | `"legacy"` | `legacy`, `live`, `reference` |
| `follow_strength` | `0.25` | 0 to 1 |
| `tracking_mode` | `"legacy"` | `auto`, `custom`, `exact`, `legacy`, `off` |
| `vertical_tracking` | `"auto"` | `auto`, `exact`, `gentle`, `grounded` |
| `room_horizontal` | `0.12` | 0 to 0.6 |
| `room_vertical` | `0.16` | 0 to 0.6 |
| `pan_smoothing` | `0.3` | 0.05 to 3 |
| `tilt_smoothing` | `0.75` | 0.05 to 3 |
| `framing_motion` | `false` | Boolean. |
| `framing_start_x` | `0.333333` | 0.1 to 0.9 |
| `framing_start_y` | `0.333333` | 0.1 to 0.9 |
| `framing_end_x` | `0.666667` | 0.1 to 0.9 |
| `framing_end_y` | `0.333333` | 0.1 to 0.9 |
| `target_mode` | `"actors"` | `actors`, `marker` |
| `custom_target` | `null` | Optional finite XYZ, ±100,000 m; required in the corresponding marker/manual-placement mode. |
| `custom_position` | `null` | Optional finite XYZ, ±100,000 m; required in the corresponding marker/manual-placement mode. |
| `camera_transition` | `null` | Optional enabled/fields/start/end object; fields described in §8. |
| `lens_calibration` | `"legacy"` | `full_frame`, `legacy` |
| `fisheye_fov` | `160` | 90 to 180 |
| `elevation_angle` | `0` | -89.9 to 89.9 |
| `focus_point` | `"legacy"` | `auto`, `back`, `chest`, `eyes`, `feet`, `hands`, `hips`, `knees`, `left_foot`, `left_hand`, `left_knee`, `left_shoulder`, `left_thigh`, `legacy`, `right_foot`, `right_hand`, `right_knee`, `right_shoulder`, `right_thigh`, `shoulders`, `thighs` |
| `frame_reference` | `"auto"` | `auto`, `center`, `custom`, `left_third`, `lower_left`, `lower_right`, `lower_third`, `right_third`, `upper_left`, `upper_right`, `upper_third` |
| `frame_x` | `0.5` | 0.1 to 0.9 |
| `frame_y` | `0.333333` | 0.1 to 0.9 |
| `framing_scale` | `1` | 0.03 to 20 |
| `focus_fill` | `0` | 0 to 1.5 |
| `framing_version` | `1` | 1 or 2; new semantic focus uses version 2. |
| `behavior` | `"legacy"` | `follow`, `legacy`, `move`, `static` |
| `selection` | `"legacy"` | `all`, `legacy`, `selected`, `single` |
| `follow_direction` | `"reference"` | `facing`, `reference` |
| `position_offset` | `[0,0,0]` | XYZ offsets, each −100 to +100 m. |
| `framing_mode` | `"reference"` | `reference`, `whole_clip` |
| `path_anchor` | `"follow"` | `fixed`, `follow` |
| `reference_time` | `0` | 0 to 120 |
| `reference_actor` | `null` | Available actor ID; additional composition rules apply. |
| `reference_basis` | `"legacy_chest"` | `chest`, `legacy_chest`, `pelvis` |
| `composition` | `"single"` | `detail`, `group`, `ots`, `pov`, `single`, `two` |
| `actors` | `[]` | 1–4 distinct available actor IDs. |
| `foreground_actor` | `null` | Available actor ID; additional composition rules apply. |
| `shot` | `"full"` | `chest`, `close`, `cowboy`, `extreme_close`, `extreme_wide`, `full`, `medium_full`, `waist`, `wide` |
| `aim` | `"auto"` | `auto`, `body`, `chest`, `custom`, `head`, `hips`, `left_hand`, `right_hand` |
| `horizontal` | `"front"` | `back`, `custom`, `front`, `front_left`, `front_right`, `left`, `rear_left`, `rear_right`, `right` |
| `vertical` | `"eye"` | `auto`, `custom`, `eye`, `ground`, `high`, `low`, `slight_high`, `slight_low`, `top` |
| `lens` | `"natural"` | `custom`, `fisheye`, `natural`, `portrait`, `telephoto`, `ultra_wide`, `wide` |
| `focal_length` | `35` | 10 to 200 |
| `sensor_height` | `24` | 18 to 36 |
| `roll` | `0` | -90 to 90 |
| `padding` | `1.12` | 1 to 2 |
| `bearing_offset` | `0` | -180 to 180 |
| `target_offset` | `[0,0,0]` | XYZ offsets, each −100 to +100 m. |
| `movement` | `"fixed"` | `alongside`, `crane`, `dolly_zoom`, `fixed`, `follow`, `lead`, `orbit`, `pan`, `pedestal`, `pull`, `push`, `tilt`, `track_subjects`, `truck`, `zoom` |
| `direction` | `"left"` | `down`, `in`, `left`, `out`, `right`, `up` |
| `travel` | `1` | 0 to 100 |
| `orbit_degrees` | `90` | 0 to 360 |
| `rotation_degrees` | `20` | 0 to 160 |
| `end_focal_length` | `85` | 10 to 200 |
| `crane_forward` | `1` | -100 to 100 |
| `start_time` | `0` | 0 to 120 |
| `end_time` | `0` | 0 to 120 |
| `pacing` | `"ease_in_out"` | `constant`, `ease_in`, `ease_in_out`, `ease_out` |
| `aim_behavior` | `"track"` | `fixed`, `target`, `track` |
| `response` | `"smooth"` | `direct`, `smooth` |
| `responsiveness` | `0.35` | 0 to 1 |
| `follow_response` | `"smooth"` | `direct`, `smooth` |
| `follow_responsiveness` | `0.35` | 0 to 1 |
| `max_turn_speed` | `35` | 1 to 180 |
| `dead_zone` | `1.5` | 0 to 10 |
| `max_follow_speed` | `4` | 0.1 to 30 |
| `shoulder_side` | `"right"` | `left`, `right` |
| `shoulder_offset` | `0.3` | 0.05 to 2 |
| `shoulder_back` | `0.6` | 0.1 to 3 |


### Manual path and outer recipe fields

| Field | Meaning / constraints |
| --- | --- |
| `schema_version` | Camera recipe version 1. |
| `mode` | `captured`, `bookends`, `preset`; `history` accepted for compatibility only. |
| `camera_index` | Available source camera index. Hidden in the primary UI. |
| `world_frame_id` | Must match the motion scene for authored presets/manual paths. |
| `target_actor` | Older direct actor targeting or null; modern subject selection is in the preset. |
| `start`, `end` | Manual endpoint objects: finite XYZ `position`, XYZ `target`, vertical `fov`. |
| `output_frame` | Orientation and aspect-ratio choice; see §8. |
| `preset` | Subject/aim/lens/movement state described above, including optional per-block start/end animation. |
| `manual_path.kind` | `line` or `curve`. |
| `manual_path.aim` | `source` (authored quaternion samples), `shot` (modern targeting), or legacy `blend`/`fixed`. |
| `manual_path.pacing` | `linear` or `smooth`. |
| `manual_path.controls` | Optional two XYZ endpoint Bézier controls. Display handles use a shorter visual offset. |
| `manual_path.points` | At most five intermediate XYZ adjustment markers. |
| `manual_path.point_handles` | Two independent XYZ handle deltas per adjustment point. Count must match points. |
| `manual_path.smooth_handles` | Explicit Boolean coupling of incoming/outgoing point handles. |
| `manual_path.source_frames` | 2–14,401 ordered source samples, spanning 0 to this motion duration; position, normalized quaternion, FOV, optional cut/projection. |
| `manual_path.position_interpolation` | Explicit `linear` or `cubic` for source position samples. |
| `manual_path.source_static` | Source is a stationary camera; editor exposes direct static placement. |
| `manual_path.lens_override` | Explicitly replace an imported/authored source lens. |
| `manual_path.reference_fov` | Retained manual lens used by the framing path; not distance compensation during movement. |
| `manual_path.framing_priority` | Stored modern value `reference`; older `shot`/`lens` values can be read and normalized. |
| `camera_timeline` | Full editable sequence object from §9, with complete per-segment recipes. |
| `history_camera` | Compatibility import/transfer metadata; not a current cloud-history picker. |

Cross-field validation matters: a fixed marker needs coordinates; custom placement needs position; Follow subjects requires actor targets; fisheye does not use perspective Zoom/Dolly zoom; selected actor lists must be valid; a camera cannot sit exactly on its look-at target. Numeric bounds alone are not sufficient validation.

### Native socket compatibility

`CARTWHEEL_CAPTURE` is the original retained service/local manifest. `CARTWHEEL_MOTION` and `CARTWHEEL_CAMERA` are the source-independent scene/camera wrappers. `CARTWHEEL_REFERENCES` is the enabled creative-media list; `CARTWHEEL_FRAME_REFERENCES` is an image+role list for endpoint styling; `CARTWHEEL_PREPARED_REFERENCES` is the complete validated generation/delivery pack. Core `VIDEO`, `IMAGE`, `AUDIO`, and `FILE_3D_GLB` keep their native ComfyUI meanings; images use floating batch/height/width/channel tensors, audio uses waveform/sample-rate objects, and video can be a file-backed or trimmed native object. Do not pass string paths where the native video/image/audio nodes expect those objects.
