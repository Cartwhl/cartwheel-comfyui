import assert from 'node:assert/strict';
import * as THREE from '../web/vendor/build/three.module.js';
import { manualPath, manualPosition, pathProgress, resetCurve, moveMarker } from '../web/manual_path.js';
import { applyCamera, cameraPath } from '../web/camera_motion.js';
const recipe = () => ({ schema_version:1, mode:'bookends', target_actor:null,
 start:{position:[0,2,5],target:[0,1,0],fov:45},end:{position:[4,3,5],target:[1,1,0],fov:60} });
const settings = recipe();
assert.equal(manualPath(settings).kind,'line');
assert.deepEqual(manualPosition(settings,0.5).toArray(),[2,2.5,5]);
resetCurve(settings); settings.manual_path.kind='curve';
assert.ok(manualPosition(settings,0).distanceTo(new THREE.Vector3(...settings.start.position))<1e-10);
assert.ok(manualPosition(settings,1).distanceTo(new THREE.Vector3(...settings.end.position))<1e-10);
assert.ok(manualPosition(settings,0.5).z>5.1);
// Arc-length sampling: constant pacing means nearly equal traveled distances at equal time steps.
settings.manual_path.controls = [[0,8,5],[3,-2,8]];
const samples = Array.from({length:101},(_,i)=>manualPosition(settings,i/100));
const distances=samples.slice(1).map((p,i)=>p.distanceTo(samples[i]));
assert.ok(Math.max(...distances)/Math.min(...distances)<1.04);
const oldHandle = [...settings.manual_path.controls[0]];
moveMarker(settings,'start_position',[1,3,6]);
assert.deepEqual(settings.manual_path.controls[0],oldHandle.map(v=>v+1));
moveMarker(settings,'handle2',[3,2,6]);
assert.deepEqual(settings.manual_path.controls[1],[3,2,6]);
assert.throws(()=>moveMarker(settings,'handle1',[NaN,1,1]),/finite/);
settings.manual_path.pacing='smooth';
assert.equal(pathProgress(settings,-1,10),0);assert.equal(pathProgress(settings,100,10),1);
assert.ok(pathProgress(settings,1,10)<0.1);assert.ok(pathProgress(settings,9,10)>0.9);
assert.equal(pathProgress(settings,5,10),0.5);
const camera=new THREE.PerspectiveCamera(45,16/9,0.01,1000);
const capture={ camera,aspect:16/9,actors:[],setTime(){} };
settings.manual_path.aim='fixed';
for(const t of [0,2,5,7,10]) {
 applyCamera(capture,settings,t,10);
 const direction=new THREE.Vector3(...settings.start.target).sub(camera.position).normalize();
 assert.ok(camera.getWorldDirection(new THREE.Vector3()).distanceTo(direction)<1e-10);
 assert.ok([...camera.position.toArray(),...camera.quaternion.toArray(),camera.fov].every(Number.isFinite));
}
const restored=JSON.parse(JSON.stringify(settings));
const path=cameraPath(capture,settings,10), after=cameraPath(capture,restored,10);
path.forEach((p,i)=>assert.ok(p.distanceTo(after[i])<1e-10));
for(const t of [8.5,1.2,4,9.9]) {
 applyCamera(capture,settings,t,10); const position=camera.position.clone(),q=camera.quaternion.clone();
 applyCamera(capture,restored,t,10); assert.ok(position.distanceTo(camera.position)<1e-10);assert.ok(q.angleTo(camera.quaternion)<1e-7);
}
// Old saved bookends retain the exact linear position / target / lens evaluator.
const legacy=recipe();applyCamera(capture,legacy,5,10);assert.deepEqual(camera.position.toArray(),[2,2.5,5]);assert.equal(camera.fov,52.5);
const zero=recipe();zero.end.position=[...zero.start.position];resetCurve(zero);zero.manual_path.kind='curve';
for(let i=0;i<100;i++) assert.ok(manualPosition(zero,i/99).toArray().every(Number.isFinite));
console.log('Manual straight/curve endpoints, distance pacing, easing, independent aim, handle carrying, stationary endpoints, JSON restore, seeking and legacy bookends passed.');
// Both path shapes and pacing choices keep spatial motion independent of aiming.
const actorRoot=new THREE.Group(),head=new THREE.Bone();head.name='head';head.position.set(0,1.7,0);actorRoot.add(head);actorRoot.updateMatrixWorld(true);
const actorCapture={camera:new THREE.PerspectiveCamera(45,16/9,.01,1000),actors:[{number:1,root:actorRoot}],setTime(t){actorRoot.position.x=t*.1;actorRoot.updateMatrixWorld(true);}};
for(const kind of ['line','curve']) for(const pacing of ['linear','smooth']) for(const aim of ['blend','fixed','actor']) {
 const s=recipe();resetCurve(s);s.manual_path={...s.manual_path,kind,pacing,aim:aim==='actor'?'blend':aim};s.target_actor=aim==='actor'?1:null;
 for(const time of [0,1,2,5,9,10]){
  actorCapture.setTime(time);applyCamera(actorCapture,s,time,10);
  assert.ok(actorCapture.camera.position.distanceTo(manualPosition(s,pathProgress(s,time,10)))<1e-10);
  assert.ok([...actorCapture.camera.position.toArray(),...actorCapture.camera.quaternion.toArray()].every(Number.isFinite));
 }
}
console.log('All 12 line/curve × constant/eased × blended/fixed/actor-aim combinations share the expected path.');
