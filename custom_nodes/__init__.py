from comfy_api.latest import ComfyExtension
from server import PromptServer

from .nodes import CartwheelPerformanceCapture, CartwheelLoadCapture, CartwheelLoadHistory, CartwheelCameraPreview, CartwheelCamera, CartwheelControlRender, CartwheelPrepareVideoReferences, CartwheelLoadMotionAndCamera, connection
from .video_render import bridge
from .delivery import CartwheelFinalizeVideo,CartwheelCameraData
from .frame_references import CartwheelImageReferences,CartwheelMatchFirstFrame
from .control_preview import CartwheelControlPreview
from .endpoint_images import CartwheelEndpointImage,CartwheelEndpointReview
from .source_selector import CartwheelMotionSource
from .workflow_step import CartwheelWorkflowStep
from .swing_choreo import CartwheelSwingChoreo
from .reference_library import CartwheelReferenceLibrary, CartwheelGenerateVideo, register_reference_routes
from .comparison import CartwheelCompareVideos
from .local_job_routes import register_local_jobs
from .camera_routes import register_camera_routes
from .motion_routes import register_motion_routes
from .instruction_nodes import CartwheelCameraInstructionResult
from .instruction_routes import register_instruction_routes
import folder_paths

WEB_DIRECTORY = "./web"


class CartwheelExtension(ComfyExtension):
    async def get_node_list(self):
        return [CartwheelCameraInstructionResult, CartwheelPerformanceCapture, CartwheelLoadCapture, CartwheelLoadHistory, CartwheelCameraPreview, CartwheelCamera, CartwheelControlRender, CartwheelPrepareVideoReferences, CartwheelLoadMotionAndCamera, CartwheelMotionSource, CartwheelWorkflowStep, CartwheelSwingChoreo, CartwheelReferenceLibrary, CartwheelGenerateVideo, CartwheelCompareVideos,CartwheelFinalizeVideo,CartwheelCameraData,CartwheelEndpointImage,CartwheelEndpointReview,CartwheelControlPreview,CartwheelImageReferences,CartwheelMatchFirstFrame]


async def comfy_entrypoint():
    register_instruction_routes(PromptServer.instance)
    bridge.register(PromptServer.instance)
    register_reference_routes(PromptServer.instance)
    register_motion_routes(PromptServer.instance, folder_paths.get_input_directory)
    register_local_jobs(PromptServer.instance, folder_paths.get_output_directory)
    register_camera_routes(PromptServer.instance, folder_paths.get_output_directory)
    return CartwheelExtension()
