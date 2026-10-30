"""Small local image-reference collection for optional endpoint styling."""
import json
from pathlib import Path
from comfy_api.latest import io
FrameReferences=io.Custom('CARTWHEEL_FRAME_REFERENCES')

class CartwheelImageReferences(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(node_id='CartwheelImageReferences',display_name='Frame Image References · Optional',category='Cartwheel',
            description='Upload up to five character, environment or appearance images. Shared by first- and last-frame styling; no paid requests here.',
            inputs=[io.String.Input('files',default='[]',socketless=True,extra_dict={'hidden':True})],outputs=[FrameReferences.Output('references')])
    @classmethod
    def execute(cls,files='[]'):
        from .reference_library import local_path
        from PIL import Image,ImageOps
        import numpy as np,torch
        items=json.loads(files)
        if not isinstance(items,list) or len(items)>5:raise ValueError('Choose up to five frame reference images.')
        refs=[]
        for item in items:
            if not isinstance(item,dict):raise ValueError('Invalid image reference.')
            if item.get('enabled',True) is not True:continue
            path=local_path(item.get('file',''))
            if path.suffix.lower() not in {'.png','.jpg','.jpeg','.webp'}:raise ValueError('Frame references accept images only.')
            with Image.open(path) as source:
                rgb=ImageOps.exif_transpose(source).convert('RGB')
                image=torch.from_numpy(np.asarray(rgb).copy()).float().div_(255).unsqueeze(0)
            refs.append({'image':image,'name':Path(str(item.get('name',path.name))).name[:200],'role':'style'})
        return io.NodeOutput(refs)

class CartwheelMatchFirstFrame(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(node_id='CartwheelMatchFirstFrame',display_name='Match First Frame · Automatic continuity',category='Cartwheel',
            description='Keeps character identity across first/last images. Generic appearance references retain the same numbering on both frames.',
            inputs=[io.Image.Input('original_first'),io.Image.Input('styled_first'),FrameReferences.Input('references',optional=True)],outputs=[FrameReferences.Output('references')])
    @classmethod
    def execute(cls,original_first,styled_first,references=None):
        return io.NodeOutput([*(references or []),{'image':original_first,'role':'first'},{'image':styled_first,'role':'styled_first'}])
