"""Internal output endpoint for an editor-initiated Comfy text-generation graph."""
import json
from comfy_api.latest import io
from .camera_instructions import camera_response,scoped_camera_response


class CartwheelCameraInstructionResult(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(node_id='CartwheelCameraInstructionResult',display_name='Camera Instructions · Internal Result',category='Cartwheel/internal',is_output_node=True,
            inputs=[io.String.Input('text',force_input=True),io.String.Input('request_id'),io.Float.Input('start',min=0,max=120),io.Float.Input('end',min=0,max=120),io.Float.Input('fps',min=1,max=120),io.Boolean.Input('keep_blocks',default=False),io.String.Input('ranges_json',default='',optional=True)],outputs=[])

    @classmethod
    def execute(cls,text,request_id,start,end,fps,keep_blocks=False,ranges_json=""):
        result=scoped_camera_response(text,json.loads(ranges_json),fps,keep_blocks) if ranges_json else camera_response(text,start,end,fps,keep_blocks)
        return io.NodeOutput(ui={'cartwheel_camera_instruction':[{'request_id':request_id,'result':result}]})
