import assert from 'node:assert/strict';
import * as T from '../web/vendor/build/three.module.js';
import {createTimeline,splitSegment,deleteSegment,fillGap,changeTiming,renumberCameras,validateTimeline} from '../web/camera_timeline.js';
import {motionDocument,sceneSkeleton,frameTimes,prepareChunks,instructionRanges} from '../web/instruction_motion.js';
import {mergeInstructionChunks,compileInstructions,boundaryLocks} from '../web/instruction_animation.js';
import {applyCamera,applySingleCamera} from '../web/camera_motion.js';
import {sequencePlan} from '../web/camera_sequence.js';
const duration=4,camera=new T.PerspectiveCamera(45,16/9,.01,1000),root=new T.Group(),hips=new T.Bone(),head=new T.Bone();hips.name='Hips';head.name='Head';root.add(hips);hips.add(head);head.position.y=1.7;root.position.set(2,0,3);root.rotation.y=.5;
let seeks=0;const capture={camera,duration,actors:[{number:1,root}],setTime(t){seeks++;hips.position.x=t*.3;head.position.z=.1*Math.sin(t);root.updateMatrixWorld(true);camera.position.set(0,2,6);camera.lookAt(0,1,0);camera.fov=45;camera.aspect=16/9;camera.updateMatrixWorld(true);}};
const doc=await motionDocument(capture,24,()=>{},async()=>{});assert.equal(doc.frames.length,97);assert.equal(doc.frames.at(-1).time,4);assert.equal(doc.actors[0].bones[1].parent,0);assert.equal(doc.actors[0].semantic_labels.face,1);
for(const frame of [doc.frames[0],doc.frames[31],doc.frames.at(-1)]){capture.setTime(frame.time);const p=head.getWorldPosition(new T.Vector3()).toArray();assert.ok(p.every((v,i)=>Math.abs(v-frame.actors[0].bones[1][i])<=.00000051));}
assert.notDeepEqual(doc.frames[0].actors[0].root,doc.frames.at(-1).actors[0].root,'Root trajectory must follow the moving skeleton, not its static container');assert.deepEqual(doc.frames[0].actors[0].actor_transform,doc.frames.at(-1).actors[0].actor_transform);
const count=seeks;assert.equal(await motionDocument(capture,24,()=>{},async()=>{}),doc);assert.equal(seeks,count,'Unchanged motion was resampled');assert.equal(frameTimes(1.01,24).at(-1),1.01);
console.log('PASS: every-frame joint world transforms include parent/actor rotation, hierarchy and labels; terminal sample, fractional durations, numeric precision and motion cache.');
const base={schema_version:1,mode:'bookends',camera_index:0,target_actor:null,world_frame_id:'world',preset:null,start:{position:[0,2,6],target:[0,1,0],fov:45},end:{position:[4,2,6],target:[0,1,0],fov:45},manual_path:{kind:'line',pacing:'linear',aim:'blend'}};
const timeline=createTimeline(base,4,24);timeline.world_frame_id='world';const initial={...structuredClone(base),camera_timeline:timeline};
const pose=(settings,time)=>{capture.setTime(time);applyCamera(capture,settings,time,4);return {time,position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),fov:camera.fov,lens_projection:'perspective'};};
const frames=doc.frames.map(f=>pose(initial,f.time));
const chunks=prepareChunks(doc,timeline,frames,instructionRanges(timeline,['camera-1'],false),false,16500);assert.ok(chunks.length>1);let last=0;
for(const chunk of chunks){assert.equal(chunk.context.requested_range[0],last);last=chunk.context.requested_range[1];assert.equal(chunk.context.motion_frames[0].time,chunk.context.requested_range[0]);assert.equal(chunk.context.motion_frames.at(-1).time,last);assert.ok(JSON.stringify(chunk.context).length<16500);}
assert.equal(last,4);
const allTimes=new Set(chunks.flatMap(c=>c.context.motion_frames.map(f=>f.time)));assert.equal(allTimes.size,97,'Chunking silently dropped motion frames');
const results=chunks.map((c,i)=>({range:c.range,result:{schema_version:1,blocks:[{start:c.context.requested_range[0],end:c.context.requested_range[1],transition:'continue',continue_previous:i>0,frames:c.context.current_camera}]}}));
const merged=mergeInstructionChunks(results,false);assert.equal(merged.length,1);assert.equal(merged[0].blocks.length,1);const compiled=compileInstructions(initial,merged);validateTimeline(compiled.camera_timeline);
for(const f of frames){const p=pose(compiled,f.time);assert.ok(p.position.every((v,i)=>Math.abs(v-f.position[i])<1e-7));assert.ok(Math.abs(new T.Quaternion().fromArray(p.quaternion).dot(new T.Quaternion().fromArray(f.quaternion)))>1-1e-8);}
assert.equal(compiled.manual_path.aim,'source');assert.equal(compiled.world_frame_id,'world');
console.log('PASS: exact pose data is chunked without gaps or omitted frames; chunk continuations merge; authored samples survive compilation/playback without preset tracking.');
// Dense, deliberately irregular camera movement and lens animation remain untouched.
{
 const authored=frames.map((f,i)=>({...f,position:[Math.sin(i*.2),2+.02*Math.sin(i*.7),6-i*.01],quaternion:new T.Quaternion().setFromEuler(new T.Euler(.02*Math.sin(i*.5),.3*Math.sin(i*.1),.01*Math.cos(i*.4))).toArray(),fov:35+10*Math.sin(i*.02)}));
 const g=[{range:{start:0,end:4,ids:['camera-1']},blocks:[{start:0,end:4,transition:'continue',frames:authored}]}];const c=compileInstructions(initial,g);
 for(const f of authored){const p=pose(c,f.time);assert.ok(p.position.every((v,i)=>Math.abs(v-f.position[i])<1e-7));assert.ok(Math.abs(p.fov-f.fov)<1e-7);assert.ok(Math.abs(new T.Quaternion().fromArray(p.quaternion).dot(new T.Quaternion().fromArray(f.quaternion)))>1-1e-8);}
}
console.log('PASS: dense handheld-style position/orientation and intentional lens changes are preserved exactly at authored frames.');
// Stable identities with sequential left-to-right display numbering.
{
 const t=createTimeline(base,4,24);splitSegment(t,'camera-1',2);splitSegment(t,'camera-1',1);assert.deepEqual(t.segments.map(s=>s.name),['Camera 1','Camera 2','Camera 3']);const ids=t.segments.map(s=>s.id);assert.deepEqual(ids,['camera-1','camera-3','camera-2']);deleteSegment(t,'camera-3');splitSegment(t,'camera-2',3);assert.deepEqual(t.segments.map(s=>s.name),['Camera 1','Camera 2','Camera 3']);assert.equal(t.joins.at(-1).left,'camera-2');changeTiming(t,'camera-1','end',.5);fillGap(t,1,base);assert.deepEqual(t.segments.map(s=>s.name),['Camera 1','Camera 2','Camera 3','Camera 4']);
}
console.log('PASS: split, delete and gap fill renumber visible cameras left-to-right while IDs/connections stay stable.');
// Editing the interior camera protects existing neighbors, even across blends.
{
 const original=structuredClone(initial),t=original.camera_timeline;splitSegment(t,'camera-1',1);splitSegment(t,'camera-2',3);for(const j of t.joins)j.preserve=false;
 const plan=sequencePlan(capture,t,4,applySingleCamera),editor={capture,sequence:{timeline:t,plan:()=>plan}};const locks=boundaryLocks(editor,['camera-2']);assert.equal(locks.length,2);
 const oldA=structuredClone(t.segments[0]),oldC=structuredClone(t.segments[2]);const authored=frames.filter(f=>f.time>=1&&f.time<=3).map(f=>({...f,position:[f.position[0]+Math.sin((f.time-1)*Math.PI/2),2.2,6],fov:50}));
 const c=compileInstructions(original,[{range:{start:1,end:3,ids:['camera-2']},blocks:[{start:1,end:3,position_interpolation:'cubic',transition:'continue',frames:authored}]}],locks);
 assert.deepEqual(c.camera_timeline.segments[0],oldA);assert.deepEqual(c.camera_timeline.segments[2],oldC);
 for(const time of [...Array.from({length:24},(_,i)=>i/24),...Array.from({length:25},(_,i)=>3+i/24)]){const a=pose(original,time),b=pose(c,time);assert.ok(a.position.every((v,i)=>Math.abs(v-b.position[i])<1e-6),`Outside-scope camera changed at ${time}`);assert.ok(Math.abs(a.fov-b.fov)<1e-6);assert.ok(Math.abs(new T.Quaternion().fromArray(a.quaternion).dot(new T.Quaternion().fromArray(b.quaternion)))>1-1e-7);}
}
console.log('PASS: selected-camera edits retain neighboring recipes, timing, paths and rendered poses outside scope, including shared transition windows.');
// Nonadjacent selections and an explicit cut preserve untouched middle blocks.
{
 const original=structuredClone(initial),t=original.camera_timeline;splitSegment(t,'camera-1',1);splitSegment(t,'camera-2',3);for(const j of t.joins){j.connected=false;j.smooth=false;j.point=null;}
 const ranges=instructionRanges(t,['camera-1','camera-3'],true);assert.deepEqual(ranges.map(r=>[r.start,r.end]),[[0,1],[3,4]]);
 const groups=ranges.map(r=>({range:r,blocks:[{start:r.start,end:r.end,transition:'cut',frames:frames.filter(f=>f.time>=r.start&&f.time<=r.end).map(f=>({...f,position:[f.position[0]+1,3,6]}))}]}));
 const c=compileInstructions(original,groups,[],[1]);assert.deepEqual(c.camera_timeline.segments[1],t.segments[1]);assert.ok(c.camera_timeline.joins.every(j=>!j.connected));assert.deepEqual(c.camera_timeline.segments.map(s=>s.name),['Camera 1','Camera 2','Camera 3']);
 assert.throws(()=>mergeInstructionChunks([{range:ranges[0],result:{schema_version:1,blocks:[{start:0,end:.5,frames:frames.slice(0,13),transition:'cut'},{start:.5,end:1,frames:frames.slice(12,25),transition:'continue'}]}}],true),/protected camera block/);
}
console.log('PASS: nonadjacent scope, existing cuts, unchanged interior camera, actor metadata defaults and protected block counts.');
