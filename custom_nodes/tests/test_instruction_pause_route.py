import asyncio,importlib,json,sys,types,unittest
from pathlib import Path
from unittest.mock import patch
pkg=types.ModuleType('instruction_pause_route_test');pkg.__path__=[str(Path(__file__).resolve().parents[1])];sys.modules[pkg.__name__]=pkg
routes=importlib.import_module(pkg.__name__+'.instruction_routes')
class RouteTable:
    def __init__(self):self.handlers={}
    def get(self,path):return lambda fn:self.handlers.setdefault(('GET',path),fn)
    def post(self,path):return lambda fn:self.handlers.setdefault(('POST',path),fn)
class Content:
    def __init__(self,value):self.value=json.dumps(value).encode()
    async def iter_chunked(self,n):yield self.value
class Request:
    content_length=None
    def __init__(self,value):self.content=Content(value)
class ReviewRouteTests(unittest.TestCase):
    def test_no_raw_graphs_single_use_review_and_expiry(self):
        table=RouteTable();routes.register_instruction_routes(types.SimpleNamespace(routes=table));review=table.handlers['POST','/cartwheel/camera-instructions/review'];prepare=table.handlers['POST','/cartwheel/camera-instructions/prepare']
        with patch.object(routes,'same_origin'),patch.object(routes,'provider_catalog',return_value=[]),patch.object(routes,'prepared_request',return_value={'graph':{'model':'one'},'review':{'model_calls':1}}) as build:
            rejected=asyncio.run(prepare(Request({'request_id':'old','context':{}})));self.assertEqual(rejected.status,400);self.assertEqual(build.call_count,0)
            r=asyncio.run(review(Request({'protocol_version':2,'request_id':'one'})));ticket=json.loads(r.body)['review_id'];self.assertEqual(build.call_count,1)
            payload={'protocol_version':2,'request_id':'one','review_id':ticket}
            accepted=asyncio.run(prepare(Request(payload)));self.assertEqual(json.loads(accepted.body)['graph'],{'model':'one'})
            rejected=asyncio.run(prepare(Request(payload)));self.assertEqual(rejected.status,400)
            r=asyncio.run(review(Request({'protocol_version':2,'request_id':'two'})));ticket=json.loads(r.body)['review_id']
            with patch.object(routes.time,'monotonic',return_value=10**12):
                expired=asyncio.run(prepare(Request({'protocol_version':2,'request_id':'two','review_id':ticket})));self.assertEqual(expired.status,400)
    def test_token_failure_never_returns_a_submission_ticket(self):
        table=RouteTable();routes.register_instruction_routes(types.SimpleNamespace(routes=table))
        with patch.object(routes,'same_origin'),patch.object(routes,'provider_catalog',return_value=[]),patch.object(routes,'prepared_request',side_effect=ValueError('exceeds single-request token allowance')):
            result=asyncio.run(table.handlers['POST','/cartwheel/camera-instructions/review'](Request({'protocol_version':2})))
        self.assertEqual(result.status,400);self.assertNotIn('review_id',json.loads(result.body));self.assertNotIn('graph',json.loads(result.body))
if __name__=='__main__':unittest.main()
