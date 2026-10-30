# Cartwheel Motion to Video — overview

This workflow turns a performance into an editable 3D scene, lets an artist direct its camera, and sends the resulting shot to a video generator. Cartwheel supplies motion through Performance Capture or Swing Choreo; users can also bring their own animated GLBs. The camera editor works on the shared scene data rather than requiring a Cartwheel-generated performance.

The included [Motion to Video workflow](Cartwheel-Motion-to-Video.json) connects motion sources, camera editing, optional references, and final video generation. This guide follows those steps from left to right. For data formats and implementation details, see the [technical reference](TECHNICAL_REFERENCE.md).

## 1. Choose where the motion comes from

The three starting sections feed **Choose Motion Source**, which requests only the chosen branch:

- **Performance Capture:** Load a video, trim it if needed, and capture one to four performers using **Comic 4**. Controls include actor count, facial capture, foot stabilization, quality, and export frame rate. The result includes animated actors and a starting camera when supplied by Cartwheel.
- **Swing Choreo:** Generate motion from a text prompt, with a 5–15 second duration, optional looping, and export frame rate. The model and single-result request are fixed internally.
- **Load Motion · Upload / Saved Jobs:** Load individual animated actor files (GLB preferred) and an optional camera JSON/FBX, or reopen a locally saved result. Whole scenes are also supported, up to four actors, with a compatible embedded camera used automatically. A camera is optional: the editor supplies a starting view. Saved jobs come from this ComfyUI installation’s files, not a shared Cartwheel account history.

Leaving a video loaded in an unselected source does not submit another capture. Matching completed Performance Capture inputs can reuse local results; users can explicitly request a new capture version.

## 2. Preview before generating

**Preview or Generate** makes the workflow’s two steps explicit:

1. **Preview camera** loads/renders the scene for camera editing and skips final video generation.
2. **Generate final video** sends the prepared references to the chosen video model on the next Run.

Preview is the default. It can still run the selected fresh Performance Capture or Swing Choreo job; it does not mean that every upstream operation is free. After the motion exists, camera editing and control-video rendering are local operations.

## 3. Direct the shot in Camera Preview

**Cartwheel Camera Preview** is the main app experience. A split view shows the 3D scene and the actual camera shot, with playback and a camera timeline underneath.

The artist can:

- Choose **Static**, **Moving**, or **Follow subjects**.
- Select one performer, the group, a subset of performers, or a fixed **custom aim marker**; choose a body part to aim at and its composition within the image.
- Place the camera with its 3D gizmo or synchronized distance, orbit, and height controls; adjust lens, fisheye, horizon tilt, orientation, and aspect ratio.
- Use **Camera follow strength** to move from a steady view of nearby action toward tight tracking of each movement. Camera travel keeps a fixed lens unless the user deliberately animates it.
- Draw a manual line or curve, add up to five adjustment points, and edit short, independent curve handles; or choose a movement preset such as push in, pull out, truck, orbit, pan, tilt, crane, or zoom.
- Split the timeline into separately editable camera blocks, resize or move them, connect paths, smooth transitions, or make cuts. Gaps hold the camera still while performers keep moving. Right-click a block to access splitting, deletion, connection, and transition settings. Right-click empty timeline space to fill it with a camera. All blocks become one combined camera animation.
- Optionally animate start/end target, aim, composition, follow strength, lens, or tilt settings within a block.
- Ask an LLM to create a move, edit a specific camera, or change the whole sequence. GPT, Claude, and Gemini choices come from installed ComfyUI integrations; GPT-6 Sol is the default when available. The model receives numerical motion and current-camera context. Instructions can refer to actor numbers, camera numbers, frames, and shot timings; frame numbers are interpreted using the supplied clip frame rate. Clear, detailed instructions usually give better results. The hidden system prompt is a working default that has performed well in testing; refining it may improve results further. Valid results apply immediately and can be undone.
- Use **Undo/Redo**, **Reset camera**, and **Reset scene** to revise experiments.

**Save scene** creates a named local snapshot: it renders the current edited view and stores it with the motion, camera data, and editable camera blocks. The snapshot appears in **Load Motion → Saved jobs** for quick reuse. Camera Preview also saves a result when it runs; Save scene lets an artist deliberately keep and name an experiment without generating motion again. Snapshots are stored in the extension’s local Saved jobs catalog, separately from ComfyUI’s execution history.

The toolbar also provides the starting camera, scene visibility controls, and inspection views. Guides, gizmos, labels, and aim markers stay out of exported videos. Press **F** to inspect the selected control more closely.

## 4. Review the camera outputs

Camera Preview produces the edited performance video, camera data, first/last images, and three additional videos:

- **Depth:** distance from the camera, shown in grayscale with a range adapted to the scene.
- **Normal:** surface directions encoded as RGB.
- **Pose:** an animated skeleton view for recognizable rigs.

**Control Videos** displays those three passes separately below the editor. They use the same camera, timing, and cuts as the edited video and require local rendering, not another AI model. **Camera Data · Export / Inspect** exposes positions, orientation-bearing samples, lens data, and the full camera JSON for reuse. A perspective-camera Blender import helper is included.

## 5. Add creative references and prepare the request

**Creative References** accepts images, videos, and audio, with individual enable switches so files can stay loaded without being used.

**Prepare Video References** selects **Seedance 2.5** or **MiniMax H3**, sets the prompt and clip window, trims references, and checks their combined limits. The edited camera video is enabled by default; depth, normal, and pose are independent optional references, initially off. Extra videos share the model’s video-duration allowance, so more references can mean a shorter usable clip.

The default prompt is:

> Follow Video 1 exactly for motion, timing, blocking and camera movement. Keep the same framing from start to finish, with no added zooms, cuts or close-ups. Use Video 1 for motion only, not for its look. Re-render the scene to match the reference images or description.
> 
> Cinematic, photoreal, shot on film. Natural, motivated lighting that fits the scene, with film grain and realistic texture.
> 
> Avoid: changing the motion or framing, added zooms or cuts, letterbox bars, a CGI or digital look.

**Use original audio** preserves an available source soundtrack during final assembly. It is separate from uploading audio as creative guidance. Prepare organizes inputs; it does not submit the video-generation job.

## 6. Optionally style the first and last images

The optional image branch can style the camera’s first and last rendered frames through **OpenAI GPT Image**, **Google Nano Banana**, or **BFL Flux.2**. A shared uploader accepts up to five character/environment images.

The first image establishes the desired appearance. The last-image request uses its own raw camera frame plus the original and styled first frames to keep performer identities consistent without copying the first frame’s viewpoint. **Review endpoint images** shows the results and controls whether they are included as video references. Image styling and video-reference inclusion are separate opt-in actions.

## 7. Generate, save, and compare

**Generate with Seedance / H3** calls the selected installed ComfyUI video integration. Final assembly trims excess generated duration to the selected performance window and restores original audio when requested and available.

Separate output players show/save the edited camera video and the selected preview or generated result. **Compare Videos** creates a synchronized, silent side-by-side video; both sides start together and the shorter side holds its final frame. Ordinary video-player controls handle downloads.

## API access and saved work

[Cartwheel’s public API documentation](https://api-docs.getcartwheel.com/api/motion-from-video/) describes Performance Capture and motion-generation requests. The [technical reference](TECHNICAL_REFERENCE.md#5-public-cartwheel-api-integration) links the individual endpoints used here. For new Cartwheel jobs, create a [Cartwheel account](https://app.getcartwheel.com/) with API access and obtain a production project key from [API keys](https://app.getcartwheel.com/api-keys). Configure it in ComfyUI Settings → Cartwheel → Connection. Cartwheel motion generation uses Cartwheel credits; Seedance/H3, image styling, and LLM services use your separately signed-in Comfy account and Comfy credits. Local imports, camera editing, and saved scenes do not submit a Cartwheel generation job; image, video, and camera-instruction services use the installed ComfyUI integrations.

Batch names are optional and omitted by default. Integrators can include the optional `batchName` API field for organization. A batch is the submission container used to track processing and exports; individual jobs/motions are results within it, and a result may contain multiple performers. Batch/job IDs identify submissions independently of names.

Named scenes use **Save scene** and are separate from API batch labels. **Load Motion → Saved jobs** browses this installation’s local output files. It does not browse the API account’s history. Keep the saved output files to retain access to those scenes.
