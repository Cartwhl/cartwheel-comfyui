# Validation and supported scope

The automated suite exercises the local extension with synthetic fixtures and mocked paid services. It can run from a detached source copy without another Cartwheel checkout or user media.

## Automated checks

- Python unit tests cover API request construction, job recovery, timing, camera validation, scene imports, reference budgets, local snapshots, and transport/path safeguards.
- Self-contained JavaScript checks cover camera math, optics, tracking, curves, timeline transitions, slider interactions, model dispatch, and workflow layout.
- Native integration scripts use an explicitly supplied compatible ComfyUI checkout and its Python environment. Service submissions are mocked. They check real schemas, graph execution, image/video types, local save routes, and source-independent imports.

Run the [README checks](../README.md#help-and-verification) from `custom_nodes/`. Native checks additionally take the ComfyUI checkout path, for example:

```text
python tests/check_comfy_glb.py COMFYUI_ROOT
python tests/check_motion_inputs.py COMFYUI_ROOT
python tests/check_delivery_workflow.py COMFYUI_ROOT
```

`check_delivery_workflow.py` starts an ephemeral loopback HTTP server for route tests. Some additional viewer checks accept user-supplied capture/Blender fixtures; these are optional acceptance checks, not dependencies of the automated suite. See each script’s input contract.

## Limits of these checks

Automated success does not establish live account entitlement, model-output quality, Windows GUI compatibility, or support for every browser/ComfyUI release. Validate paid-service sign-in, live motion/export alignment, image/video fidelity, and the intended target platform separately. Local rendering needs a connected browser with WebGL.

This extension is for a trusted local single-user ComfyUI installation. Hosted multi-user deployments need additional authorization and storage isolation. The [technical reference](../TECHNICAL_REFERENCE.md#security-boundary-and-hosted-deployments) documents that boundary.
