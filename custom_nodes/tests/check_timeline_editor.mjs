import assert from 'node:assert/strict';
import * as T from '../web/vendor/build/three.module.js';
import {CameraTimelineEditor} from '../web/camera_timeline_editor.js';
import {createTimeline,selectedSegment} from '../web/camera_timeline.js';
import {applyCamera} from '../web/camera_motion.js';
import {sampleInputCamera} from '../web/input_camera.js';
const duration=10,camera=new T.PerspectiveCamera(45,16/9,.01,1000),capture={camera,duration,actors:[],setTime(t){camera.position.set(0,2,5);camera.lookAt(t*.1,1,0);camera.aspect=16/9;camera.fov=45;camera.updateMatrixWorld(true);}};
const frames=Array.from({length:601},(_,i)=>{const time=i/60;return {time,position:[Math.sin(time)*3,2+.1*time,5+Math.cos(time)],quaternion:new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),time*.1).toArray(),fov:40+time};});
const base={schema_version:1,mode:'bookends',camera_index:0,target_actor:null,world_frame_id:'world',preset:null,start:{position:frames[0].position,target:[0,1,0],fov:40},end:{position:frames.at(-1).position,target:[0,1,0],fov:50},manual_path:{kind:'curve',pacing:'linear',aim:'source',source_frames:frames,controls:[frames[0].position,frames.at(-1).position]}};
// Zero source handle corrections preserve the sampled path.
const {resetCurve}=await import('../web/manual_path.js');resetCurve(base);
function fixture(){const controller=Object.create(CameraTimelineEditor.prototype),settings=structuredClone(base);settings.camera_timeline=createTimeline(settings,10,24);controller.editor={capture,settings,time:4,currentFrameTime(){return this.time;},manualPathEditor:{selected:'start_position'},hint:{}};controller.undoStack=[];controller.redoStack=[];controller.refresh=()=>{};controller.sync=()=>{};return controller;}
const pose=(settings,time)=>{capture.setTime(time);applyCamera(capture,settings,time,10);return {p:camera.position.clone(),q:camera.quaternion.clone(),f:camera.fov};};
const c=fixture(),before=Array.from({length:241},(_,i)=>pose(c.editor.settings,i/24));c.split();assert.equal(c.timeline.segments.length,2,c.editor.hint.textContent);
for(let i=0;i<=240;i++){const result=pose(c.editor.settings,i/24);assert.ok(result.p.distanceTo(before[i].p)<1e-7,`Manual split moved frame ${i}`);assert.ok(result.q.angleTo(before[i].q)<1e-7,`Manual split rotated frame ${i}`);assert.ok(Math.abs(result.f-before[i].f)<1e-8);}
assert.equal(c.timeline.selected_id,'camera-2');assert.equal(c.undoStack.length,1);
// Editing a connected start moves the previous endpoint to the shared point.
const old=JSON.stringify(c.editor.settings),start=c.editor.settings.start.position;c.editor.settings.start.position=[start[0]+2,start[1]+1,start[2]];c.commit(old);
const plan=c.plan(),[a,b]=c.timeline.segments;assert.ok(plan.sample(a,a.end).position.distanceTo(plan.sample(b,b.start).position)<1e-8);
const neighborBefore=Array.from({length:20},(_,i)=>plan.sample(a,a.start+(a.end-a.start)*i/19).position);
const j=c.timeline.joins[0];c.setJoin(j,{connected:false});const unlinked=c.plan();for(let i=0;i<20;i++)assert.ok(neighborBefore[i].distanceTo(unlinked.sample(a,a.start+(a.end-a.start)*i/19).position)<1e-8,'Disconnect moved neighbor');
assert.equal(j.smooth,false);
// Deleting keeps the remaining camera's constrained path exactly where it was.
c.setJoin(j,{connected:true,smooth:true});const connected=c.plan(),saved=connected.sample(a,1).position;c.remove();assert.equal(c.timeline.segments.length,1);assert.ok(c.plan().sample(c.timeline.segments[0],1).position.distanceTo(saved)<1e-8,'Delete moved surviving path');
// Discontinuous imported cameras hold the preceding sample until the cut.
const descriptor={lens_projection:'perspective',frames:[{time:0,position:[0,2,5],quaternion:[0,0,0,1],fov:40},{time:1,cut:true,position:[50,2,5],quaternion:[0,0,0,1],fov:60}]};sampleInputCamera(camera,descriptor,.99);assert.equal(camera.position.x,0);sampleInputCamera(camera,descriptor,1);assert.equal(camera.position.x,50);
console.log('PASS: actual editor split preserves 241 imported/manual frame poses and lenses, selects right block, stores undo, propagates connected endpoints, disconnect/delete leave neighbors untouched, imported cuts remain cuts.');
{
 const c=fixture();c.editor.settings.preset={start_time:2,end_time:8,pacing:'ease_in_out'};c.timeline.segments[0].settings.preset=structuredClone(c.editor.settings.preset);
 const original=Array.from({length:241},(_,i)=>pose(c.editor.settings,i/24));c.split();assert.equal(c.timeline.segments.length,2,c.editor.hint.textContent);
 for(let i=0;i<=240;i++){const p=pose(c.editor.settings,i/24);assert.ok(p.p.distanceTo(original[i].p)<1e-7,`Legacy timed split moved frame ${i}`);assert.ok(Math.abs(p.f-original[i].f)<1e-8);}
}
console.log('PASS: splitting an existing timed manual move preserves its leading/trailing holds and source lens without applying timing twice.');

{
 const c=fixture();c.split();const [a,b]=c.timeline.segments;a.end=2;b.start=6;c.timeline.joins[0].preserve=false;a.ease_end=false;b.ease_start=true;b.ease_start_frames=25;
 const beforeA=c.plan().sample(a,1),beforeB=c.plan().sample(b,8);c.fill(4);assert.equal(c.timeline.segments.length,3,c.editor.hint.textContent);
 const added=c.selected;assert.deepEqual([added.start,added.end],[2,6]);assert.equal(added.settings.manual_path.source_static,true);assert.equal(c.undoStack.length,2);
 assert.ok(c.plan().sample(a,1).position.distanceTo(beforeA.position)<1e-8);assert.ok(c.plan().sample(b,8).position.distanceTo(beforeB.position)<1e-8);
 for(const time of [2,3,5.99,6]){const p=c.plan().sample(added,time);assert.ok(p.position.distanceTo(c.plan().sample(a,2).position)<1e-8);}
 c.setHold(added,'end',{smooth:true,frames:17});assert.equal(added.ease_end,true);assert.equal(added.ease_end_frames,17);
}
console.log('PASS: actual gap-fill controller preserves both neighboring paths, fills with the exact held view, records undo and stores independent endpoint preferences.');
