import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../web/camera_instructions.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export function queuedInstruction','function queuedInstruction').replace('export class CameraInstructions','globalThis.CameraInstructions=class CameraInstructions');
let queues=0,network=0,prepares=0,fail=false;
const sandbox={api:{async fetchApi(){network++;return {ok:true,json:async()=>({graph:{model:{class_type:'OpenAIChatNode',inputs:{}},result:{class_type:'CartwheelCameraInstructionResult',inputs:{}}}})};}},clone:structuredClone,compileInstructions:()=>({generated:true}),setTimeout,clearTimeout,AbortController};
vm.runInNewContext(source,sandbox);sandbox.result={schema_version:2,groups:[{blocks:[]}]};sandbox.fakeQueue=async()=>{queues++;if(fail)throw new Error('Provider failed');return sandbox.result;};vm.runInNewContext('queuedInstruction=fakeQueue;',sandbox);
function target(){const t=Object.create(sandbox.CameraInstructions.prototype);Object.assign(t,{submissionsEnabled:true,pauseReason:'Paused',status:{textContent:''},model:{value:'openai:gpt-6-sol'},user:{value:'camera'},system:{value:'system'},world:'w',persist(){},sync(){},fingerprint:()=> 'scene',requestKey:()=> 'key',editor:{capture:{actors:[{number:1}]},makePath(){},setTime(){},syncControls(){},sequence:{refresh(){},record(){},sync(){}}},prepare:async()=>{prepares++;return {key:'key',fingerprint:'scene',requestId:'id',reviewId:'ticket',review:{model_calls:1,estimated_ceiling_usd:.4},context:{allowed_ranges:[{}]},original:{},locks:[]};}});return t;}
let t=target();t.submissionsEnabled=false;await t.run();assert.equal(prepares,0);assert.equal(queues,0);
t=target();const normal=t.prepare;t.prepare=async()=>{const p=await normal();p.review.model_calls=2;return p;};await t.run();assert.equal(queues,0);assert.equal(network,0);
t=target();t.prepare=async()=>{const p=await normal();p.key='stale';return p;};await t.run();assert.equal(queues,0);
t=target();t.prepare=async()=>{const p=await normal();p.review.estimated_ceiling_usd=12.50;p.review.budget_usd=null;return p;};await t.run();assert.equal(queues,1);assert.equal(network,1);assert.deepEqual(t.editor.settings,{generated:true});assert.equal(t.completionKey,'key');assert.equal(t.status.textContent,'');
t=target();fail=true;await t.run();assert.equal(queues,2);assert.equal(network,2);assert.equal(t.running,false);assert.equal(t.prepared.review.model_calls,1);assert.match(t.status.textContent,/Provider failed/);await new Promise(r=>setTimeout(r,20));assert.equal(queues,2,'A failed request must never auto-retry');
t=target();let resolve;t.prepare=()=>new Promise(r=>resolve=r);const pending=t.run();await t.run();assert.equal(queues,2,'Double-click during preparation must not submit another request');resolve(null);await pending;
console.log('PASS: paused, multi-call and stale plans queue zero models; an expensive whole-clip plan queues exactly once with no dollar cap; successful application, failure and double-click never create an automatic repeat.');

// Updating a known default must not overwrite an intentionally edited system prompt.
sandbox.document={createElement:()=>({})};
sandbox.api.fetchApi=async()=>({ok:true,json:async()=>({protocol_version:2,submissions_enabled:true,models:[{id:'openai:gpt-6-astra',provider:'openai',model:'gpt-6-astra',label:'GPT · gpt-6-astra'}],system_prompt:'new one-camera default',legacy_system_prompts:['old raw default','old compact default']})});
for(const [before,after] of [['old raw default','new one-camera default'],['old compact default','new one-camera default'],['my custom system prompt','my custom system prompt']]){
 const v=target();v.model={replaceChildren(){},append(){}};v.system.value=before;v.savedModel='openai:gpt-6-astra';v.schedulePrepare=()=>{};await v.loadModels();assert.equal(v.system.value,after);assert.equal(v.model.value,'openai:gpt-6-astra');assert.equal(v.submissionsEnabled,true);
}
console.log('PASS: old defaults migrate to the one-camera prompt, custom prompts are retained, and a saved expensive model remains selected.');

{const v=target();v.model={replaceChildren(){},append(){}};v.system.value='custom';v.savedModel=null;v.schedulePrepare=()=>{};sandbox.api.fetchApi=async()=>({ok:true,json:async()=>({models:[{id:'gemini:flash',provider:'gemini',model:'Flash'},{id:'openai:gpt-6-sol',provider:'openai',model:'gpt-6-sol'}],protocol_version:2,submissions_enabled:true,system_prompt:'system'})});await v.loadModels();assert.equal(v.model.value,'openai:gpt-6-sol');}
console.log('PASS: new AI panels prefer GPT-6 Sol when available; saved explicit model choices still win.');
