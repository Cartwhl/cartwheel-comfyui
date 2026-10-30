"""Local review, then a single-use prepared graph. Execution uses native Comfy auth."""
import json
import secrets
import time
from aiohttp import web
from .route_security import same_origin
from .camera_instructions import provider_catalog,prepared_request,SYSTEM_PROMPT,OUTPUT_CONTRACT,MAX_CONTEXT_CHARS,CAMERA_AI_SUBMISSIONS_ENABLED,CAMERA_AI_PAUSE_REASON
from .instruction_budget import BUDGET_USD
from .legacy_instruction_prompt import LEGACY_SYSTEM_PROMPT,PREVIOUS_COMPACT_SYSTEM_PROMPT,PREVIOUS_SINGLE_CAMERA_SYSTEM_PROMPT


def register_instruction_routes(server):
    reviews={}
    used_ids={}
    def prune():
        now=time.monotonic()
        for table in (reviews,used_ids):
            for key,item in list(table.items()):
                if item['expires']<now:del table[key]
    async def body(request):
        limit=3*1024*1024
        if request.content_length is not None and request.content_length>limit:raise web.HTTPRequestEntityTooLarge(max_size=limit,actual_size=request.content_length)
        raw=bytearray()
        async for chunk in request.content.iter_chunked(65536):
            raw.extend(chunk)
            if len(raw)>limit:raise web.HTTPRequestEntityTooLarge(max_size=limit,actual_size=len(raw))
        return json.loads(raw)
    def error_response(error):
        return web.json_response({'error':str(error) if isinstance(error,ValueError) else 'Camera request could not be prepared. Check the prompts, selected model and scene.'},status=400,headers={'Cache-Control':'no-store'})

    @server.routes.get('/cartwheel/camera-instructions/models')
    async def models(request):
        same_origin(request)
        return web.json_response({'protocol_version':2,'models':provider_catalog(),'system_prompt':SYSTEM_PROMPT,'legacy_system_prompt':LEGACY_SYSTEM_PROMPT,'legacy_system_prompts':[LEGACY_SYSTEM_PROMPT,PREVIOUS_COMPACT_SYSTEM_PROMPT,PREVIOUS_SINGLE_CAMERA_SYSTEM_PROMPT],'output_contract':OUTPUT_CONTRACT,'max_context_chars':MAX_CONTEXT_CHARS,'submissions_enabled':CAMERA_AI_SUBMISSIONS_ENABLED,'pause_reason':CAMERA_AI_PAUSE_REASON,'budget_usd':BUDGET_USD},headers={'Cache-Control':'no-store'})

    @server.routes.post('/cartwheel/camera-instructions/review')
    async def review(request):
        same_origin(request);prune()
        try:
            data=await body(request)
            if not isinstance(data,dict) or data.get('protocol_version')!=2:raise ValueError('Refresh ComfyUI to use the single-request camera adapter.')
            prepared=prepared_request(data,provider_catalog())
            # Bound local memory; reviews expire quickly and never execute a provider.
            if len(reviews)>=16:del reviews[next(iter(reviews))]
            ticket=secrets.token_urlsafe(32)
            reviews[ticket]={'expires':time.monotonic()+180,'request_id':data['request_id'],'graph':prepared['graph']}
            return web.json_response({'review_id':ticket,'expires_in':180,'review':prepared['review']},headers={'Cache-Control':'no-store'})
        except (ValueError,TypeError,KeyError,RecursionError) as error:return error_response(error)

    @server.routes.post('/cartwheel/camera-instructions/prepare')
    async def prepare(request):
        same_origin(request);prune()
        try:
            data=await body(request)
            if not isinstance(data,dict) or data.get('protocol_version')!=2:raise ValueError('Raw camera batching is disabled. Refresh ComfyUI.')
            ticket=data.get('review_id')
            if not isinstance(ticket,str):raise ValueError('Review the camera request locally before submitting.')
            item=reviews.pop(ticket,None)
            if not item or item['request_id']!=data.get('request_id'):raise ValueError('Camera cost review expired or was already used. Submit again to review the current scene.')
            if item['request_id'] in used_ids:raise ValueError('This camera job was already submitted. No duplicate request was prepared.')
            used_ids[item['request_id']]={'expires':time.monotonic()+24*3600}
            return web.json_response({'graph':item['graph']},headers={'Cache-Control':'no-store'})
        except (ValueError,TypeError,KeyError,RecursionError) as error:return error_response(error)
