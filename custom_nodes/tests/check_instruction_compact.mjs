import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import * as T from '../web/vendor/build/three.module.js';
import {compactMotion,compactCamera,compactContext,simplifyTrack,positionError} from '../web/instruction_compact.js';
const times=Array.from({length:121},(_,i)=>i/24),values=times.map(t=>[t*100,Math.sin(t*9)*300,Math.cos(t)*50]);
const indices=simplifyTrack(times,values,positionError,10);assert.ok(indices.length<times.length);assert.equal(indices[0],0);assert.equal(indices.at(-1),120);
for(let i=0;i<times.length;i++){let a=indices.findLastIndex(j=>j<=i),b=Math.min(a+1,indices.length-1);a=indices[a];b=indices[b];assert.ok(positionError(values[i],values[a],values[b],a===b?0:(times[i]-times[a])/(times[b]-times[a]))<=10+1e-6);}
const names=['root','c_head','l_wrist','r_wrist','l_foot','r_foot','c_spine2','c_neck','l_upleg','r_upleg','l_lowleg','r_lowleg','finger_1','twist_0_proc'];
const doc={duration:5,fps:24,environment:{geometry_available:false},actors:[{id:1,bones:names.map((name,id)=>({id,name,parent:id?0:null})),semantic_labels:{root:0,face:1,left_hand:2,right_hand:3}}],frames:times.map(time=>({time,actors:[{id:1,bones:names.map((_,j)=>[time*.2,j*.1+Math.sin(time*8)*.3,0,...new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),time*.2).toArray()])}]}))};
const motion=compactMotion(doc);assert.equal(motion.schema_version,2);assert.equal(motion.actors[0].joints.length,12);assert.ok(motion.actors[0].head_orientation.samples.length<121);assert.equal(motion.actors[0].joints[0].positions.at(-1)[0],120);assert.equal(motion.actors[0].joints[0].positions.at(-1)[1],1000);assert.equal(doc.frames.length,121);
const unknown=structuredClone(doc);unknown.actors[0].bones=unknown.actors[0].bones.map((b,i)=>({...b,name:'unknown_'+i}));unknown.actors[0].semantic_labels={};assert.equal(compactMotion(unknown).actors[0].joints.length,names.length);
const frames=times.map(time=>({time,position:[time*.5,2,6],quaternion:[0,0,0,1],fov:45,lens_projection:'perspective'}));frames[60]={...frames[60],position:[100,2,6]};const compressed=compactCamera(frames,{segments:[{start:0,end:2.5},{start:2.5,end:5}]});assert.ok(compressed.some(f=>f[0]===2.5&&f[1]===100000));assert.ok(compressed.some(f=>Math.abs(f[0]-59/24)<1e-6));assert.ok(compressed.length<frames.length);
const timeline={segments:[{id:'one',name:'Camera 1',start:0,end:2.5,settings:{mode:'bookends'}},{id:'two',name:'Camera 2',start:2.5,end:5,settings:{mode:'preset',preset:{movement:'orbit'}}}]};
const ranges=[{start:2.5,end:5,ids:['two']}],context=compactContext(doc,timeline,frames,ranges,true,[],16/9);
assert.deepEqual(context.current_camera,compressed);assert.equal(context.camera_blocks[1].movement,'orbit');assert.deepEqual(context.allowed_ranges,ranges);assert.equal(context.keep_blocks,true);assert.equal(context.current_camera.at(-1)[4],0);assert.equal(context.current_camera.at(-1)[8],45);assert.equal(context.output_aspect,16/9);
console.log('PASS: existing edited camera positions, orientations, lens/FOV, timing, movement and selected edit scope are included for model edits.');
console.log('PASS: all source poses stay within 1 cm track error; source motion is unchanged; landmarks, head orientation, unknown rigs and camera-cut boundaries survive compact encoding.');
if(process.argv[2]){
 const audit=JSON.parse(readFileSync(process.argv[2],'utf8'));let offset=0;const actors=audit.actors.map(a=>({id:a.id,bones:a.bones.map((name,id)=>({id,name,parent:null})),semantic_labels:{}}));
 const frames=audit.frames.map(row=>{let k=1;return {time:Math.min(row[0]/audit.fps,audit.duration),actors:actors.map(a=>({id:a.id,bones:a.bones.map(()=>[...row.slice(k,k+=3),0,0,0,1])}))};});
 const compact=compactMotion({duration:audit.duration,fps:audit.fps,actors,frames,environment:{geometry_available:false,ground_reference_y:0}});
 compact.allowed_ranges=[{start:0,end:7.5,ids:['camera-1']}];compact.keep_blocks=false;compact.output_aspect=16/9;compact.camera_blocks=[{id:'camera-1',name:'Camera 1',start:0,end:7.5}];compact.current_camera=[[0,0,1700,6000,0,0,0,1,45,'perspective'],[7.5,0,1700,6000,0,0,0,1,45,'perspective']];compact.locked_camera_samples=[];
 writeFileSync(process.argv[3],JSON.stringify(compact));console.log(`Actual boxing fixture: ${compact.actors.length} actors, ${compact.actors.map(a=>a.joints.length)} joints, ${JSON.stringify(compact).length} characters; whole 7.5 seconds in one context.`);
}
