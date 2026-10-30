"""Local estimates and live job status. These are estimates, not remote queue telemetry."""
import math
import time
from comfy_api.latest import ComfyAPI
from server import PromptServer


def estimate_seconds(kind, duration, actors=1, faces=True):
    if kind == 'swing':
        return 60 + 25 + math.ceil(28 * duration)
    multipliers = [14,28,28,32] if faces else [10,15,17,19]
    return 25 + math.ceil(multipliers[max(0,min(3,int(actors)-1))] * duration)


class JobProgress:
    def __init__(self, owner, kind, duration, actors=1, faces=True, api=None):
        self.api=api or ComfyAPI
        self.owner=owner;self.started=time.monotonic();self.estimate=estimate_seconds(kind,duration,actors,faces)
        self.node_id=getattr(getattr(owner,'hidden',None),'unique_id',None)
    async def __call__(self, value):
        elapsed=time.monotonic()-self.started
        progress=value
        if 30<=value<90:progress=max(value,min(88,10+80*elapsed/max(1,self.estimate)))
        await self.api().execution.set_progress(progress,100)
        stage='Ready' if value>=100 else 'Downloading results' if value>=90 else 'Preparing exports' if value>=70 else 'Processing on Cartwheel' if value>=30 else 'Submitting to Cartwheel'
        server=getattr(PromptServer,'instance',None)
        if self.node_id is not None and server:
            server.send_sync('cartwheel_job_status',{'node_id':str(self.node_id),'stage':stage,'elapsed':elapsed,'estimate':self.estimate,'done':value>=100},getattr(server,'client_id',None))
