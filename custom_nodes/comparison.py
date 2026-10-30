"""Stream a synchronized, silent side-by-side. Shorter footage holds its last frame."""
import math
from contextlib import ExitStack
from fractions import Fraction
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4
import av
from PIL import Image, ImageOps, ImageDraw
import folder_paths
from comfy_api.latest import io, InputImpl
from comfy_execution.graph import ExecutionBlocker


def compare_files(left,right,destination,height=480,fps=24):
    with ExitStack() as stack:
        sources=[stack.enter_context(av.open(str(path))) for path in [left,right]]
        streams=[source.streams.video[0] for source in sources]
        durations=[float(s.duration*s.time_base) if s.duration else float(s.frames/(s.average_rate or fps)) for s in streams]
        if not all(math.isfinite(t) and t>0 for t in durations):raise ValueError('Comparison videos need readable positive durations.')
        pane_width=round(max(s.width/s.height for s in streams)*height/2)*2
        pane_width=max(2,min(1920,pane_width));height=height//2*2
        target=stack.enter_context(av.open(str(destination),'w',format='mp4',options={'movflags':'+faststart'}))
        output=target.add_stream('libx264',rate=fps);output.width=pane_width*2;output.height=height+32;output.pix_fmt='yuv420p';output.options={'crf':'19','preset':'fast'}
        iterators=[iter(source.decode(video=0)) for source in sources]
        current=[next(iterator) for iterator in iterators]
        upcoming=[next(iterator,None) for iterator in iterators]
        starts=[float(frame.time or 0) for frame in current]
        for index in range(math.ceil(max(durations)*fps)):
            time=index/fps;canvas=Image.new('RGB',(pane_width*2,height+32),'#18212a');draw=ImageDraw.Draw(canvas)
            for side in range(2):
                while upcoming[side] is not None and float(upcoming[side].time or 0)-starts[side]<=time+1e-7:
                    current[side]=upcoming[side];upcoming[side]=next(iterators[side],None)
                image=ImageOps.contain(current[side].to_image().convert('RGB'),(pane_width,height))
                canvas.paste(image,(side*pane_width+(pane_width-image.width)//2,32+(height-image.height)//2))
                draw.text((side*pane_width+12,10),'Edited camera' if side==0 else 'Generated video',fill='white')
            frame=av.VideoFrame.from_image(canvas);frame.pts=index;frame.time_base=Fraction(1,fps)
            for packet in output.encode(frame):target.mux(packet)
        for packet in output.encode():target.mux(packet)


class CartwheelCompareVideos(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(node_id='CartwheelCompareVideos',display_name='Save Camera / Generated Comparison',category='Cartwheel',is_output_node=True,
            description='Saves a silent side-by-side, synchronized from the start. The shorter side holds its last frame. Only runs for Generate final video.',
            inputs=[io.Boolean.Input('enabled',default=False),io.Video.Input('camera_video',lazy=True),io.Video.Input('generated_video',lazy=True)],outputs=[io.Video.Output('comparison')])
    @classmethod
    def check_lazy_status(cls,enabled,**inputs):
        return [key for key in ['camera_video','generated_video'] if enabled and inputs.get(key) is None]
    @classmethod
    def execute(cls,enabled,camera_video=None,generated_video=None):
        if not enabled:return io.NodeOutput(ExecutionBlocker(None))
        root=Path(folder_paths.get_output_directory())/'cartwheel'/'comparisons';root.mkdir(parents=True,exist_ok=True)
        destination=root/f'comparison_{uuid4().hex[:12]}.mp4'
        try:
            with TemporaryDirectory(prefix='cartwheel-comparison-') as directory:
                left,right=[Path(directory)/name for name in ['camera.mp4','generated.mp4']]
                camera_video.save_to(str(left));generated_video.save_to(str(right))
                compare_files(left,right,destination)
        except Exception:
            destination.unlink(missing_ok=True);raise
        saved={'filename':destination.name,'subfolder':'cartwheel/comparisons','type':'output'}
        return io.NodeOutput(InputImpl.VideoFromFile(str(destination)),ui={'cartwheel_comparison':[saved]})
