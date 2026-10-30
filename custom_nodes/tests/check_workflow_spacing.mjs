import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spaceCameraWorkflow} from '../web/workflow_spacing.js';
const workflow=JSON.parse(readFileSync(new URL('../../Cartwheel-Motion-to-Video.json',import.meta.url),'utf8'));
const overlaps=(a,b)=>a.pos[0]<b.pos[0]+b.size[0]+40&&a.pos[0]+a.size[0]+40>b.pos[0]&&a.pos[1]-32<b.pos[1]+b.size[1]+40&&a.pos[1]+a.size[1]+40>b.pos[1]-32;
function verify(original){const result=spaceCameraWorkflow(original);for(let i=0;i<result.nodes.length;i++)for(let j=i+1;j<result.nodes.length;j++)assert.ok(!overlaps(result.nodes[i],result.nodes[j]),`${result.nodes[i].id} overlaps ${result.nodes[j].id}`);
 for(let i=0;i<result.groups.length;i++)for(let j=i+1;j<result.groups.length;j++){const a=result.groups[i].bounding,b=result.groups[j].bounding;assert.ok(!(a[0]<b[0]+b[2]&&a[0]+a[2]>b[0]&&a[1]<b[1]+b[3]&&a[1]+a[3]>b[1]),'Group backgrounds overlap');}
 const clean=w=>JSON.stringify({...w,changed:undefined,nodes:w.nodes.map(n=>({...n,pos:undefined})),groups:w.groups.map(g=>({...g,bounding:undefined}))});assert.equal(clean(result),clean(original),'Layout changed workflow settings/connections');assert.equal(spaceCameraWorkflow(result).changed,false,'Repeated loading must not shift nodes again');return result;}
verify(workflow);
const legacy=structuredClone(workflow);for(const n of legacy.nodes){if(n.pos[0]>=3200)n.pos[0]-=480;if([54,55].includes(n.id))n.pos[1]-=660;}verify(legacy);
const dynamic=structuredClone(workflow);dynamic.nodes.find(n=>n.id===2).size=[1700,2200];dynamic.nodes.find(n=>n.id===47).size[1]=700;verify(dynamic);
assert.equal(spaceCameraWorkflow({nodes:[{id:1,type:'CartwheelCameraPreview',pos:[0,0],size:[1560,1700]}],groups:[]}).changed,false,'Custom non-full workflows are left alone');
console.log('PASS: full, legacy enlarged and taller dynamic-widget layouts have no node/group overlaps; 40px minimum node clearance, idempotent loading, all links/settings preserved; unrelated workflows unchanged.');
