"""Display already rendered control videos locally without copying or uploading."""
from pathlib import Path
import folder_paths
from comfy_api.latest import io
from .delivery import render_path

class CartwheelControlPreview(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(node_id='CartwheelControlPreview',display_name='Control Videos · Depth / Normal / Pose',category='Cartwheel',is_output_node=True,
            description='Preview and download the control videos rendered by Camera Preview. AI reference selection stays in Prepare Video References. No generation or upload occurs here.',
            inputs=[io.Video.Input(name,optional=True) for name in ['depth','normal','pose']],outputs=[])
    @classmethod
    def execute(cls,depth=None,normal=None,pose=None):
        root=Path(folder_paths.get_output_directory()).resolve();passes={}
        for name,video in [('depth',depth),('normal',normal),('pose',pose)]:
            if video is None:continue
            path=render_path(video)
            if path is None:raise ValueError('Connect control videos from Camera Preview; only local Comfy output files can be displayed here.')
            relative=path.relative_to(root)
            passes[name]={'filename':path.name,'subfolder':str(relative.parent) if relative.parent!=Path('.') else '', 'type':'output'}
        return io.NodeOutput(ui={'cartwheel_control_previews':[passes]})
