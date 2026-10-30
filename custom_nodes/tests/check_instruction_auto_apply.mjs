import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {compileInstructions} from '../web/instruction_animation.js';
import {createTimeline,renumberCameras} from '../web/camera_timeline.js';
const classSource=(file,name)=>readFileSync(new URL(file,import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replaceAll('export function ','function ').replace(`export class ${name}`,`globalThis.${name}=class ${name}`);
class Element{
 constructor(tag){this.tag=tag;this.children=[];this.parts=new Map();this.hidden=false;this.value='';this.checked=false;this.textContent='';this.open=false;}
 querySelector(key){if(!this.parts.has(key))this.parts.set(key,new Element(key));return this.parts.get(key);}
 querySelectorAll(selector){const all=[];const walk=e=>{for(const x of e.children){if(x instanceof Element){all.push(x);walk(x);}}};walk(this);return all.filter(x=>x.tag==='input'&&(selector!=='input:checked'||x.checked));}
 append(...items){this.children.push(...items);}replaceChildren(...items){this.children=items;}addEventListener(){}setAttribute(){}before(){}remove(){}
}
let queues=0,handler=()=>result(),makePathFails=false;
const sandbox={api:{fetchApi:async()=>({ok:true,json:async()=>({graph:{model:{class_type:'OpenAIChatNode'},result:{class_type:'CartwheelCameraInstructionResult'}}})})},document:{createElement:tag=>new Element(tag),createTextNode:s=>s},setTimeout,clearTimeout,AbortController,clone:structuredClone,renumberCameras,compileInstructions};
vm.runInNewContext(classSource('../web/camera_timeline_editor.js','CameraTimelineEditor'),sandbox);
vm.runInNewContext(classSource('../web/camera_instructions.js','CameraInstructions'),sandbox);
sandbox.fakeQueue=async()=>{queues++;return await handler();};vm.runInNewContext('queuedInstruction=fakeQueue;',sandbox);
function result(x=2){return {schema_version:2,groups:[{range:{start:0,end:4,ids:['camera-1']},blocks:[{start:0,end:4,transition:'continue',position_interpolation:'cubic',frames:[{time:0,position:[0,2,6],quaternion:[0,0,0,1],fov:45},{time:4,position:[x,2,6],quaternion:[0,0,0,1],fov:45}]}]}]};}
function fixture(){
 const base={schema_version:1,mode:'bookends',world_frame_id:'w',target_actor:null,preset:null,start:{position:[0,2,6],target:[0,1,0],fov:45},end:{position:[1,2,6],target:[0,1,0],fov:45},manual_path:{kind:'line',pacing:'linear',aim:'blend'}};const timeline=createTimeline(base,4,24);timeline.world_frame_id='w';
 const editor={node:{properties:{},graph:{incrementVersion(){},afterChange(){},setDirtyCanvas(){}}},editor:new Element('editor'),motion:{world_frame:{id:'w'}},timelineFPS:24,capture:{actors:[{number:1}],duration:4},settings:{...base,camera_timeline:timeline},settingsWidget:{value:''},setPlaying(){},setTime(){},makePath(){if(makePathFails&&this.settings.manual_path?.source_frames)throw new Error('Failed to build candidate path');},syncControls(){this.instructions?.sync();}};
 const sequence=Object.create(sandbox.CameraTimelineEditor.prototype);Object.assign(sequence,{editor,undoStack:[],redoStack:[],sync(){}});editor.sequence=sequence;
 const c=new sandbox.CameraInstructions(editor);editor.instructions=c;Object.assign(c,{submissionsEnabled:true,catalog:[{}]});c.user.value='Edit this camera';c.system.value='System';c.model.value='openai:gpt-6-astra';c.panel.open=false;c.sync();
 c.prepare=async()=>({key:c.requestKey(),fingerprint:c.fingerprint(),requestId:'test-request',reviewId:'review-ticket',review:{model_calls:1},context:{allowed_ranges:[{start:0,end:4,ids:['camera-1']}]},original:structuredClone(editor.settings),locks:[]});
 return {editor,sequence,c,before:JSON.stringify(editor.settings)};
}
let f=fixture();await f.c.run();assert.equal(queues,1);assert.equal(f.c.complete.hidden,false);assert.ok(f.c.completionKey);assert.equal(f.c.generate.disabled,false);assert.equal(f.sequence.undoStack.length,1);assert.equal(f.editor.settings.manual_path.source_frames.at(-1).position[0],2);assert.deepEqual(JSON.parse(f.editor.settingsWidget.value),f.editor.settings);assert.equal(f.c.status.textContent,'');
const applied=JSON.stringify(f.editor.settings);f.sequence.restoreHistory(false);assert.equal(JSON.stringify(f.editor.settings),f.before);assert.equal(f.c.complete.hidden,true);f.sequence.restoreHistory(true);assert.equal(JSON.stringify(f.editor.settings),applied);
f=fixture();await f.c.run();f.c.user.value+=' revised';f.c.user.oninput();assert.equal(f.c.complete.hidden,true);assert.equal(f.sequence.undoStack.length,1);assert.equal(queues,2);
f=fixture();await f.c.run();f.c.system.value+=' revised';f.c.system.oninput();assert.equal(f.c.complete.hidden,true);
f=fixture();await f.c.run();const count=queues;await new Promise(r=>setTimeout(r,25));assert.equal(queues,count);assert.equal(f.c.complete.hidden,false);await f.c.run();assert.equal(queues,count+1,'An explicit second submission remains available');assert.equal(f.sequence.undoStack.length,1,'Identical results do not create empty undo steps');
handler=()=>{throw new Error('Provider failed');};f=fixture();await f.c.run();assert.equal(JSON.stringify(f.editor.settings),f.before);assert.equal(f.sequence.undoStack.length,0);assert.equal(f.c.complete.hidden,true);assert.match(f.c.status.textContent,/Provider failed/);
handler=()=>result();makePathFails=true;f=fixture();await f.c.run();assert.equal(JSON.stringify(f.editor.settings),f.before);assert.equal(f.sequence.undoStack.length,0);assert.equal(f.c.complete.hidden,true);assert.match(f.c.status.textContent,/Failed to build/);makePathFails=false;
f=fixture();handler=()=>{f.editor.settings.end.position[0]=7;return result();};await f.c.run();assert.equal(f.editor.settings.end.position[0],7);assert.equal(f.sequence.undoStack.length,0);assert.equal(f.c.complete.hidden,true);assert.match(f.c.status.textContent,/scene changed/);
handler=()=>result();f=fixture();f.editor.renderController={};await f.c.run();assert.equal(f.sequence.undoStack.length,0);assert.equal(f.c.complete.hidden,true);assert.match(f.c.status.textContent,/render is running/);
console.log('PASS: success immediately persists the generated camera and enables editing, records one undoable edit, and displays completion; Undo/Redo restore correct shots; prompt edits clear completion; explicit resubmission works; no automatic repeats; provider, rendering and stale-result failures preserve the camera and never show completion.');

// Editing never rebuilds joint tracks or performs preflight HTTP work in the background.
{const {c}=fixture();let preparations=0;c.prepare=async()=>{preparations++;};c.panel.open=true;c.prepared=null;c.sync();assert.equal(c.generate.disabled,false,'Submit must work before preflight');c.user.value+=' changed';c.user.oninput();c.system.oninput();await new Promise(r=>setTimeout(r,450));assert.equal(preparations,0);}
console.log('PASS: prompt/camera edits do not automatically rebuild whole-clip references; Submit is enabled without a preflight cache.');
