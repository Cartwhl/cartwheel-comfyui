# Video-generation references

Prepare Video References selects Seedance 2.5 or MiniMax H3, trims the camera window, collects enabled creative references, and validates aggregate limits. It prepares the request without submitting a video-generation job.

## Camera and creative references

Use edited camera video is enabled by default. Depth, normal, and pose are independent switches, initially off. Creative References accepts ordered images, videos, and audio, with individual enable switches. Disabled files remain loaded but are not decoded or submitted.

The selected camera references precede creative videos; the edited video is Video 1 when enabled. Describe each reference’s intended role in the prompt. Use original audio is separate: it restores an available source soundtrack during final assembly rather than adding it as a model reference.

## Model budgets

The installed adapters define count, duration, and output constraints. Enabled video references share a total duration allowance, including camera passes and creative videos. Automatic windows divide that allowance while keeping selected camera passes synchronized. More passes can require a shorter camera clip. Audio references have a separate aggregate allowance.

Current adapter limits are documented in the [technical reference](../TECHNICAL_REFERENCE.md#current-installed-adapter-limits); provider validation also applies. These values are not guarantees for all future service versions.

## Optional images and generation

First/last styling uses the rendered endpoint frames plus enabled appearance references. The last-frame request also receives the raw and styled first frames for identity continuity. Style generation and inclusion in the video request are separate opt-ins.

After reviewing the camera, select Generate final video in Preview or Generate and run again. The chosen native ComfyUI model integration uses the signed-in Comfy account and Comfy credits. Final assembly trims excess output duration to the selected camera window and restores original audio when requested and available.

See [accounts and credits](../README.md#accounts-and-credits), [control passes](delivery-and-control-passes.md), and the [overview](../OVERVIEW.md).
