import assert from 'node:assert/strict';
import * as T from '../web/vendor/build/three.module.js';
import {actionFollowPlan} from '../web/action_follow.js';
import {composedOrientation} from '../web/camera_composition.js';
import {imagePoint} from '../web/lens_projection.js';
const mean=p=>p.reduce((s,v)=>s.add(v),new T.Vector3()).multiplyScalar(1/p.length);
const corners=(point,r)=>[-1,1].flatMap(x=>[-1,1].flatMap(y=>[-1,1].map(z=>point.clone().add(new T.Vector3(x*r,y*r,z*r)))));
function fixture({duration=6,hz=60,strength=0,bounce=.18,travel=t=>new T.Vector3(),camera=t=>new T.Vector3(0,1.3,4),aspect=16/9,fov=45}={}){
 const times=Array.from({length:duration*hz+1},(_,i)=>i/hz);
 const states=times.map(t=>{
  const body=travel(t),parts=[[-.35,-.08],[-.12,.04],[.12,-.04],[.35,.08]].map(([x,z],k)=>new T.Vector3(x,1.3+bounce*Math.sin(t*2*Math.PI*3+k*.1),z).add(body));
  return {target:mean(parts),body:body.clone(),placement:[.5,.5],focusTargets:parts.map(point=>({point,radius:.035})),focusPoints:parts.flatMap(p=>corners(p,.035))};
 });
 const positions=times.map(camera),fovs=times.map(()=>fov),p={aim_source:'live',follow_strength:strength,roll:0};
 return {positions,states,times,p,aspect,fovs,duration};
}
const variation=q=>q.slice(1).reduce((sum,v,i)=>sum+v.angleTo(q[i]),0);
const steady=actionFollowPlan(fixture()),tight=actionFollowPlan(fixture({strength:1}));
assert.ok(variation(steady.quaternions)<variation(tight.quaternions)*.08,'Steady should average repeated gestures, not chase them.');
const exactFixture=fixture({strength:1});
for(let i=0;i<tight.targets.length;i++)assert.ok(tight.targets[i].distanceTo(exactFixture.states[i].target)<1e-10);
// Every part of the slider must change the surviving gesture, not just 90–100%.
const sweep=[];
for(const strength of [0,.2,.4,.6,.8,1]){
 const f=fixture({strength}),result=actionFollowPlan(f);sweep.push({strength,result,rotation:variation(result.quaternions)});
 for(let i=0;i<result.targets.length;i++){
  const expected=steady.targets[i].clone().lerp(exactFixture.states[i].target,strength);
  assert.ok(result.targets[i].distanceTo(expected)<1e-8,'The adaptive filter flattened the strength range.');
 }
}
for(let i=1;i<sweep.length;i++)assert.ok(sweep[i].rotation>sweep[i-1].rotation,'Increasing follow strength must progressively reveal the gesture.');
const range=sweep.at(-1).rotation-sweep[0].rotation;
assert.ok(sweep[2].rotation-sweep[0].rotation>.25*range,'The middle of the slider still behaves like 0%.');
assert.ok(sweep[4].rotation-sweep[0].rotation>.65*range,'80% still behaves like 0%.');
console.log('Slider sweep:',sweep.map(s=>({strength:s.strength,gestureRotation:s.rotation})));
const path=t=>new T.Vector3(2*Math.sin(t*2.2),1.3+1.5*Math.sin(t*1.7),2.3+Math.cos(t*2.2));
const moving=fixture({strength:.8,camera:path}),plan=actionFollowPlan(moving);
let maxCenterError=0;
for(let i=0;i<plan.quaternions.length;i++){
 const projected=imagePoint(new T.Vector3(0,1.3,0).sub(moving.positions[i]).applyQuaternion(plan.quaternions[i].clone().invert()),45,16/9);
 maxCenterError=Math.max(maxCenterError,Math.abs(projected.x),Math.abs(projected.y));
 assert.ok(plan.quaternions[i].toArray().every(Number.isFinite));
}
assert.ok(maxCenterError<.2,`A complex camera path lost the action center: ${maxCenterError}`);
// Pure camera travel must never be delayed by the follow-strength slider.
for(const strength of [0,.25,.8,.95,1]){
 const f=fixture({strength,bounce:0,camera:path}),p=actionFollowPlan(f);
 for(let i=0;i<p.quaternions.length;i++){
  const expected=composedOrientation(f.positions[i],f.states[i].target,0,45,16/9,[.5,.5]);
  assert.ok(expected.angleTo(p.quaternions[i])<1e-6,`Camera travel lag at strength ${strength}`);
 }
}
const walk=fixture({travel:t=>new T.Vector3(t,0,0),bounce:0,camera:t=>new T.Vector3(t,1.3,3)}),walking=actionFollowPlan(walk);
for(let i=0;i<walking.targets.length;i++)assert.ok(walking.targets[i].distanceTo(walk.states[i].target)<1e-7,'Straight travel leads/lags at an endpoint.');
const circle=fixture({travel:t=>new T.Vector3(2*Math.cos(t*2*Math.PI/3),0,2*Math.sin(t*2*Math.PI/3)),bounce:0,camera:t=>new T.Vector3(2*Math.cos(t*2*Math.PI/3),1.3,2*Math.sin(t*2*Math.PI/3)+1.5)}),circling=actionFollowPlan(circle);
const circleError=Math.max(...circling.targets.map((v,i)=>v.distanceTo(circle.states[i].target)));
assert.ok(circleError<.2,`Averaging cut across the runner's circle: ${circleError}`);
assert.ok(Math.min(...circling.windows)<1,'Travel did not shorten the averaging window.');
// Changing distance adjusts anticipation and containment, without changing lens/path.
const near=fixture({strength:.3,camera:t=>new T.Vector3(0,1.3,.85),fov:60}),close=actionFollowPlan(near);
assert.ok(close.focusLimited.every(v=>!v),'A feasible tight hand shot lost visible focus targets.');
const impossible=actionFollowPlan(fixture({camera:t=>new T.Vector3(0,1.3,.1),fov:15}));assert.ok(impossible.focusLimited.some(Boolean),'An impossible crop needs visible feedback.');
assert.ok(near.fovs.every(v=>v===60));assert.ok(near.positions.every(v=>v.z===.85));
const sampled=actionFollowPlan(fixture({hz:24}));
for(let i=1;i<sampled.targets.length-1;i++)assert.ok(sampled.targets[i].distanceTo(steady.targets[Math.round(i/24*60)])<.015,'Temporal averaging depends on sample rate.');
for(const lens of ['fisheye','focal'])for(const aspect of [9/16,1,21/9]){
 const f=fixture({camera:path,aspect});f.p.lens=lens;f.p.roll=35;
 const p=actionFollowPlan(f);assert.ok(p.quaternions.every(q=>q.toArray().every(Number.isFinite)));
}
console.log(JSON.stringify({steady_to_exact_rotation:variation(steady.quaternions)/variation(tight.quaternions),complex_path_center_error:maxCenterError,circle_target_error_m:circleError,minimum_circle_window_s:Math.min(...circling.windows)},null,2));
console.log('PASS: four hand tracks, repetitive gestures, 80% complex-path aim, zero camera-travel lag at five strengths, linear travel boundaries, adaptive circular travel, close coverage, impossible-crop feedback, fixed path/lens, sample-rate stability and projection/aspect/roll finiteness.');
