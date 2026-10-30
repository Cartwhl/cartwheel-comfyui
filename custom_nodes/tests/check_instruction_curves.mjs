import assert from 'node:assert/strict';
import * as T from '../web/vendor/build/three.module.js';
import {sourceSample,manualPosition,resetCurve} from '../web/manual_path.js';
import {compileInstructions} from '../web/instruction_animation.js';
import {createTimeline,validateTimeline} from '../web/camera_timeline.js';
import {applyCamera,cameraPath} from '../web/camera_motion.js';
const frames=[{time:0,position:[0,2,0]},{time:.5,position:[2,2,0]},{time:1.7,position:[3,2,2]},{time:3,position:[2,2,4]},{time:4,position:[0,2,3]}].map((f,i)=>({...f,quaternion:new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),i*.2).toArray(),fov:40+i*5,lens_projection:'perspective'}));
const endpoint=f=>({position:f.position.slice(),target:[0,0,-1],fov:f.fov});
function recipe(mode){const s={schema_version:1,mode:'bookends',world_frame_id:'w',target_actor:null,preset:null,start:endpoint(frames[0]),end:endpoint(frames.at(-1)),manual_path:{kind:'curve',aim:'source',pacing:'linear',source_frames:structuredClone(frames),...(mode?{position_interpolation:mode}:{})}};resetCurve(s);return s;}
const smooth=recipe('cubic'),legacy=recipe(),linear=recipe('linear');
for(const f of frames){const p=sourceSample(smooth,f.time/4);assert.ok(p.position.distanceTo(new T.Vector3().fromArray(f.position))<1e-10);assert.ok(Math.abs(p.fov-f.fov)<1e-10);assert.ok(Math.abs(p.quaternion.dot(new T.Quaternion().fromArray(f.quaternion)))>1-1e-10);}
assert.ok(Math.abs(sourceSample(smooth,.25/4).position.z)>.01,'Cubic sweep is still a polygon');
for(const f of frames.slice(1,-1)){const h=1e-6,left=sourceSample(smooth,(f.time-h)/4).position,right=sourceSample(smooth,(f.time+h)/4).position,at=sourceSample(smooth,f.time/4).position;const a=at.clone().sub(left).divideScalar(h),b=right.sub(at).divideScalar(h);assert.ok(a.distanceTo(b)<.0001,`Velocity jumps at ${f.time}`);}
for(let i=0;i<=400;i++){const t=i/400,p=sourceSample(smooth,t);assert.ok(manualPosition(smooth,t).distanceTo(p.position)<1e-8);assert.ok(sourceSample(legacy,t).position.distanceTo(sourceSample(linear,t).position)<1e-12);assert.ok(Math.abs(p.fov-sourceSample(linear,t).fov)<1e-12);assert.ok(Math.abs(p.quaternion.dot(sourceSample(linear,t).quaternion))>1-1e-10);}
const hold=recipe('cubic');hold.manual_path.source_frames=[{...frames[0],time:0,position:[0,2,0]},{...frames[1],time:1,position:[1,2,0]},{...frames[2],time:2,position:[1,2,0]},{...frames[3],time:4,position:[2,2,0]}];for(let i=10;i<=20;i++)assert.ok(sourceSample(hold,i/10/4).position.distanceTo(new T.Vector3(1,2,0))<1e-10);
const toggled=recipe('cubic');toggled.manual_path.kind='line';for(let i=0;i<=40;i++)assert.ok(sourceSample(toggled,i/40).position.distanceTo(sourceSample(linear,i/40).position)<1e-10);
const two=recipe('cubic');two.manual_path.source_frames=[frames[0],frames.at(-1)];for(let i=0;i<=50;i++){const u=i/50,expected=new T.Vector3().fromArray(frames[0].position).lerp(new T.Vector3().fromArray(frames.at(-1).position),u);assert.ok(sourceSample(two,u).position.distanceTo(expected)<1e-10);}
const original=recipe(),timeline=createTimeline(original,4,24);timeline.world_frame_id='w';original.camera_timeline=timeline;
const group=[{range:{start:0,end:4,ids:[timeline.segments[0].id]},blocks:[{start:0,end:4,position_interpolation:'cubic',transition:'continue',frames}]}];
const compiled=compileInstructions(original,group),restored=JSON.parse(JSON.stringify(compiled));validateTimeline(restored.camera_timeline);assert.equal(restored.manual_path.position_interpolation,'cubic');
const camera=new T.PerspectiveCamera(45,16/9,.01,1000),capture={camera,actors:[],duration:4,setTime(){camera.quaternion.identity();camera.userData={};}};
for(let i=0;i<=96;i++){const time=i/24;applyCamera(capture,restored,time,4);assert.ok(camera.position.distanceTo(sourceSample(smooth,time/4).position)<1e-7);}
const guide=cameraPath(capture,restored,4);assert.ok(guide.some(p=>p.z<-.01));
console.log('PASS: cubic paths curve between authored poses with continuous velocity at unevenly timed knots; key poses, lens and orientation remain exact; holds, two-point moves and legacy linear paths behave predictably; compile, save/reload, timeline playback and path guide use the same curve.');
