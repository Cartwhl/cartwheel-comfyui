"""An explicit preview/generation checkpoint using native lazy evaluation."""
from comfy_api.latest import io

PREVIEW = "Preview camera"
GENERATE = "Generate final video"


class CartwheelWorkflowStep(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="CartwheelWorkflowStep", display_name="Preview or Generate", category="Cartwheel",
            description="Preview camera renders only the local camera video. Generate final video requests the selected model. Choose an action, then press Run. No manual node muting is needed.",
            inputs=[
                io.Combo.Input("action", options=[PREVIEW, GENERATE], default=PREVIEW, display_name="What to do"),
                io.Video.Input("camera_video", display_name="Camera preview video"),
                io.Video.Input("generated_video", optional=True, lazy=True, display_name="Generated model video"),
            ],
            outputs=[io.Video.Output("video"),io.Boolean.Output("generate")],
        )

    @classmethod
    def check_lazy_status(cls, action, **inputs):
        if action == GENERATE and "generated_video" in inputs and inputs["generated_video"] is None:
            return ["generated_video"]
        return []

    @classmethod
    def execute(cls, action, camera_video, generated_video=None):
        if action == PREVIEW:
            return io.NodeOutput(camera_video,False)
        if action != GENERATE:
            raise ValueError("Choose Preview camera or Generate final video, then Run.")
        if generated_video is None:
            raise ValueError("Connect the selected model's video output to Generated model video.")
        return io.NodeOutput(generated_video,True)
