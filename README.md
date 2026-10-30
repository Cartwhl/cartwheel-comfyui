# Cartwheel ComfyUI

The included **Motion to Video** workflow turns video or text into animated 3D characters, lets you direct the camera in an interactive scene, and uses the resulting shot to guide AI video generation. You can also import existing actor motion and an optional camera.

**Motion → 3D camera direction → AI video**

## Start here

- **[Workflow JSON](Cartwheel-Motion-to-Video.json)** — drag this file onto the ComfyUI canvas after installation.
- **[Overview](OVERVIEW.md)** — a high-level walkthrough for artists and general users, from motion input to final video.
- **[Technical reference](TECHNICAL_REFERENCE.md)** — the detailed guide for developers and coding agents: node contracts, formats, APIs, settings, source map, and validation.

This README covers installation and first use. Additional implementation notes are under [docs/](docs/README.md).

## What it does

- Creates motion through **Performance Capture (Comic 4)** or **Swing Choreo**, or loads animated actors and saved scenes. GLB is primary; compatible FBX and whole-scene imports are supported.
- Provides a 3D camera editor with targeting, composition, manual paths, movement presets, a camera timeline, lens controls, and optional LLM instructions.
- Renders the edited shot, depth/normal/pose passes, and endpoint images; prepares selected references for Seedance or MiniMax H3.
- Saves named scenes and camera data, generates final videos, and produces synchronized comparisons.

## Repository layout

```text
Cartwheel-Motion-to-Video.json    Importable ComfyUI workflow
README.md                        Setup and first use
OVERVIEW.md                      Human-readable walkthrough
TECHNICAL_REFERENCE.md           Detailed developer and agent reference
docs/                            Focused implementation guides
custom_nodes/                    Installable extension package
├── __init__.py
├── requirements.txt
├── *.py                         Nodes, API clients, and scene handling
├── web/                         Camera editor and 3D viewer
├── tests/                       Automated checks and synthetic fixtures
└── examples/                    Smaller compatibility fixtures
```

The repository contains the workflow and extension source. Install the `custom_nodes/` package into your existing ComfyUI installation; import the root-level workflow JSON separately.

## Requirements

- An existing local, single-user ComfyUI installation with the V3 node, VIDEO, and File3D APIs. The tested baseline is ComfyUI 0.40.0 with Python 3.12; compatibility varies by version.
- A browser with WebGL, kept connected while camera videos render.
- A Cartwheel production account with API access, a project API key, and sufficient Cartwheel credits for **new** Performance Capture or Swing Choreo jobs. Local imports, saved scenes, and camera rendering do not require a Cartwheel account.
- The corresponding native ComfyUI integrations, account sign-in, and credits for optional AI image/video/LLM services. Available services depend on the installed ComfyUI version.

## Accounts and credits

1. Create or sign in to your [Cartwheel account](https://app.getcartwheel.com/). API access depends on your plan and workspace permissions; check the [current plans](https://getcartwheel.com/pricing). Open [API keys](https://app.getcartwheel.com/api-keys) and create or obtain a production project key. Copy the secret key value, not a project ID or key ID.
2. Enter that key in **ComfyUI Settings → Cartwheel → Connection → API key**. Performance Capture and Swing Choreo use your Cartwheel account and credits. The connection uses the production API.
3. For Seedance, MiniMax H3, optional image styling, or LLM camera instructions, sign in with your **Comfy account** through **Settings → User**, and add **Comfy credits** through **Settings → Credits**. These native integrations use Comfy’s billing, separately from Cartwheel. See [Comfy’s account and credit requirements](https://docs.comfy.org/tutorials/partner-nodes/overview#2-account-and-credits-requirements).

Local actor imports, camera editing, control-video rendering, and saved scenes do not submit a paid model job. Enabled cloud services receive the media or motion/camera context needed for the selected task; see the [data-flow reference](TECHNICAL_REFERENCE.md#14-files-local-reuse-and-security-boundary).

## Set up with an agent

Open this project folder in your coding assistant and give it this instruction:

> Read README.md and the technical reference. Install the included custom_nodes/ package into my ComfyUI setup, install its requirements with ComfyUI’s Python, and verify that its nodes load without submitting paid jobs. Preserve existing files and local edits. Show me how to open Cartwheel-Motion-to-Video.json and configure the required accounts. Ask for my ComfyUI location if needed.

The assistant needs access to your local files. Enter credentials yourself through the documented settings and sign-in flows. If multiple ComfyUI installations exist, specify which one you use.

## Manual setup

### 1. Get the source

Keep the cloned `cartwheel-comfyui` project in a normal source-code folder, outside ComfyUI's installed `custom_nodes` directory. If obtained through Git, use its clone URL; a downloaded source ZIP works too.

### 2. Install the node package

Copy **this project's** `custom_nodes/` folder into a named extension folder under **your chosen ComfyUI installation's** `custom_nodes/` directory. Replace `YOUR_COMFYUI` and `YOUR_EXTENSION_FOLDER` below with your own installation location and chosen extension folder name. Do not merge the Python files directly into ComfyUI's top-level `custom_nodes` directory. The resulting layout is:

```text
YOUR_COMFYUI/custom_nodes/YOUR_EXTENSION_FOLDER/__init__.py
```

Do not copy the entire project root there. For Desktop, use its configured data folder; for Windows Portable, use `ComfyUI_windows_portable/ComfyUI/custom_nodes`. Back up an existing extension and preserve local edits before updating it. Keep the source folder and installed copy separate. Input files, output files, and user settings do not need to be replaced.

### 3. Install dependencies

Use ComfyUI's Python environment. For Desktop, use its built-in terminal; for a manual installation, activate its environment. From ComfyUI's data/install directory:

```sh
python -m pip install -r custom_nodes/YOUR_EXTENSION_FOLDER/requirements.txt
```

For Windows Portable, from `ComfyUI_windows_portable`:

```powershell
.\python_embeded\python.exe -m pip install -r .\ComfyUI\custom_nodes\YOUR_EXTENSION_FOLDER\requirements.txt
```

The [official custom-node guide](https://docs.comfy.org/basic-concepts/custom-nodes) explains the different runtime environments. A normal system Python may not be the one ComfyUI uses.

### 4. Restart and open a workflow

Restart ComfyUI and hard-refresh its browser page. Drag [Cartwheel-Motion-to-Video.json](Cartwheel-Motion-to-Video.json) onto the canvas.

For new Cartwheel jobs, enter your key in **Settings → Cartwheel → Connection → API key**. Optional AI services use ComfyUI's normal sign-in. Keys stay outside this source project and workflow JSON.

## First use

1. Select Performance Capture, Swing Choreo, or Load Motion in **Choose Motion Source**.
2. Leave **Preview or Generate** on **Preview camera**. Load an animated file to try the editor without a new motion-generation job.
3. Adjust the shot in **Camera Preview**. Run again to update its videos; use **Save scene** to keep a named local version.
4. Choose your model and references in **Prepare Video References**, then select **Generate final video** when ready.

Preview can still run a paid job if a fresh motion source is selected. Local camera rendering uses your computer's resources; AI services use their respective accounts and credits. Optional control-video and endpoint-image references start disabled for final generation.

## Updates and development

To update an installation, copy the updated `custom_nodes/` package into its extension folder, reinstall requirements if needed, and restart ComfyUI and refresh the browser. Source edits do not automatically update an installed copy. Back up local changes before replacing files.

The workflow is `Cartwheel-Motion-to-Video.json` at the repository root. Python and browser code live in `custom_nodes/`; supporting guides live in `docs/`. Smaller graphs under `custom_nodes/examples/` are compatibility fixtures.

## Security and local data

Use this extension in a trusted, local, single-user ComfyUI installation. Its local routes and output catalog do not provide hosted multi-user authorization. Keep API keys in ComfyUI settings or the documented process environment, outside workflow JSON and source files. Settings are stored on disk; a masked input does not encrypt them.

Public API clients use credentials supplied by the user. Local scene rendering does not require a model-service call. The camera system prompt is public client code, not a secret. Upload only media you are authorized to process.

Report suspected vulnerabilities privately to the maintainer, with a synthetic reproduction. Keep keys, signed asset URLs, private job IDs, and user media out of public reports, logs, and screenshots.

## Help and verification

- [Implementation guides](docs/README.md)
- [Workflow overview](OVERVIEW.md)
- [Technical reference](TECHNICAL_REFERENCE.md)

For local tests, use ComfyUI's Python and run these from `custom_nodes/` **inside this project**:

```sh
python -m unittest discover -s tests -v
node tests/check_fbx_scene.mjs
node tests/check_whole_scene.mjs
```

Node.js 22 or newer is needed for the JavaScript checks. The first LLM token-count operation may download tiktoken’s public encoding data; subsequent operations use its cache. These use local/synthetic data without paid generation. If nodes are missing, check startup errors, the installed folder, and the Python environment. Missing native AI services may require a compatible ComfyUI version or account access. Saved scenes are in ComfyUI's output folder, not in this source project or a shared API history.

Licensed under the [MIT License](LICENSE). Bundled dependency notices are retained in [the node package’s vendor directory](custom_nodes/web/vendor/README.md); the installable package includes its own copy of the source license. User media, credentials, downloaded captures, and model weights are not included.
