"""Choose one motion input lazily; never request the unused branches."""
from comfy_api.latest import io

Motion = io.Custom("CARTWHEEL_MOTION")
SOURCES = {
    "Performance Capture": "fresh_motion",
    "Swing Choreo": "swing_motion",
    "Load motion": "uploaded_motion",
}


LEGACY_SOURCES = {"Fresh Comic video": "Performance Capture", "Swing Choreo (coming soon)": "Swing Choreo", "Uploaded GLB motion":"Load motion", "Cartwheel history":"Load motion"}


def source_input(source):
    return SOURCES[LEGACY_SOURCES.get(source, source)]


class CartwheelMotionSource(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="CartwheelMotionSource", display_name="Choose Motion Source", category="Cartwheel",
            description="Choose the starting point in one dropdown. In ComfyUI the connected source nodes are enabled/muted automatically; only the selected branch is requested. Swing Choreo generates motion from text.",
            inputs=[
                io.Combo.Input("source", options=list(SOURCES), default="Load motion", display_name="Motion source"),
                Motion.Input("fresh_motion", optional=True, lazy=True, display_name="Performance Capture"),
                Motion.Input("swing_motion", optional=True, lazy=True, display_name="Swing Choreo"),
                Motion.Input("uploaded_motion", optional=True, lazy=True, display_name="Load motion · Upload / Saved jobs"),
            ],
            outputs=[Motion.Output("motion")],
        )

    @classmethod
    def check_lazy_status(cls, source, **inputs):
        selected = source_input(source)
        if selected in inputs and inputs[selected] is None:
            return [selected]
        return []

    @classmethod
    def execute(cls, source, **inputs):
        selected = inputs.get(source_input(source))
        if selected is None:
            raise ValueError(f"Connect the {source} motion output to Choose Motion Source, then run again.")
        return io.NodeOutput(selected)
