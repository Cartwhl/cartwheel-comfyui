"""The text-to-motion starting point for the common Cartwheel camera workflow."""
from pathlib import Path
from .transport import api_session
from comfy_api.latest import ComfyAPI, InputImpl, Types, io, ui
from comfy.model_management import throw_exception_if_processing_interrupted
from comfy_execution.graph import ExecutionBlocker
import folder_paths

from .nodes import Capture, Motion, Camera, connection, EXPORT_FPS, SPLINE_OPTIONS, MHR_CHARACTER_ID, scene_outputs
from .text_generation import generate_motion
from .job_progress import JobProgress
from .client import Client


def generation_options(prompt, duration, loop, frameRate, keyframeCleaning):
    if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError('Enter a motion prompt describing the actors and their actions.')
    if type(duration) is not int or not 5 <= duration <= 15:
        raise ValueError('Motion duration must be a whole number from 5 to 15 seconds.')
    if type(loop) is not bool:
        raise ValueError('Loop motion must be on or off.')
    if str(frameRate) not in EXPORT_FPS or keyframeCleaning not in SPLINE_OPTIONS:
        raise ValueError('Choose a supported export frame rate and spline simplification setting.')
    return {'prompts': [prompt.strip()], 'requestedModel': 'swing_choreo',
            'swingChoreoProperties': {'duration': duration}, 'loop': loop,
            'exportSettings': {'characterID': MHR_CHARACTER_ID, 'exportType': 'glb', 'frameRate': float(frameRate),
                               'includeMesh': True, 'keyframeCleaning': SPLINE_OPTIONS[keyframeCleaning],
                               'forward': '-Z', 'up': 'Y', 'frameStepSize': 1, 'moveInPlace': False}}


class CartwheelSwingChoreo(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(node_id='CartwheelSwingChoreo', display_name='Cartwheel Swing Choreo', category='Cartwheel',
                         is_experimental=True, is_output_node=True, hidden=[io.Hidden.unique_id],
                         description='Generate animated actors from a motion prompt with Swing Choreo. Uses your saved Cartwheel connection and credits. Describe the actors in the prompt; the service determines actor count. Connect MOTION to Choose Motion Source or Camera Preview.',
                         inputs=[
                             io.String.Input('prompt', display_name='Motion prompt', default='', multiline=True, tooltip='Describe the actors, actions and interactions you want to generate.'),
                             io.Int.Input('duration', display_name='Motion duration · seconds', default=8, min=5, max=15, step=1),
                             io.Boolean.Input('loop', display_name='Loop motion', default=False),
                             io.Combo.Input('frameRate', display_name='Export frame rate', options=EXPORT_FPS, default='60'),
                             io.Combo.Input('keyframeCleaning', display_name='Spline simplification', options=list(SPLINE_OPTIONS), default='None', advanced=True),
                         ], outputs=[Motion.Output('motion'), Camera.Output('camera'), Capture.Output('capture'),
                                     io.File3DGLB.Output('glb', tooltip='First actor GLB; MOTION retains all actors.'),
                                     io.Video.Output('preview', tooltip='Cartwheel thumbnail video when available. Render the camera editor VIDEO for model input.')])

    @classmethod
    def fingerprint_inputs(cls, **kwargs):
        try:
            return connection().fingerprint
        except ValueError:
            return 'unconfigured'

    @classmethod
    async def execute(cls, prompt, duration=8, loop=False, frameRate='60', keyframeCleaning='None',batchName=None):
        options = generation_options(prompt, duration, loop, frameRate, keyframeCleaning)
        configured = connection()
        progress = JobProgress(cls, "swing", duration, api=ComfyAPI)
        await progress(0)
        async with api_session() as session:
            result = await generate_motion(Client(configured, session), options,
                                           Path(folder_paths.get_system_user_directory('cartwheel')) / 'text_jobs',
                                           Path(folder_paths.get_output_directory()) / 'cartwheel',
                                           throw_exception_if_processing_interrupted, progress)
        motion, camera = scene_outputs(result)
        assets = result['motions'][0]['assets']
        preview_path = Path(assets['preview']) if assets.get('preview') else None
        preview = InputImpl.VideoFromFile(str(preview_path)) if preview_path else ExecutionBlocker('No Cartwheel thumbnail was returned. Use the Camera Preview VIDEO output.')
        display = ui.PreviewVideo([ui.SavedResult(preview_path.name, str(preview_path.parent.relative_to(folder_paths.get_output_directory())), io.FolderType.output)]) if preview_path else None
        return io.NodeOutput(motion, camera, result, Types.File3D(assets['export_0']), preview, ui=display)

