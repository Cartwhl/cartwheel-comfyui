import assert from 'node:assert/strict';
import * as THREE from '../web/vendor/build/three.module.js';
import {applyManualFraming,fitManualReference} from '../web/manual_framing.js';
import {presetDefaults as basePresetDefaults, manualFramingState} from '../web/camera_presets.js';
const presetDefaults=(...args)=>({...basePresetDefaults(...args),lens_calibration:'legacy'});
import {imagePoint} from '../web/lens_projection.js';
import {addPathPoint,MAX_PATH_POINTS,manualCurve,manualPosition,moveMarker,removePathPoint,resetCurve} from '../web/manual_path.js';
const p={...presetDefaults([1]),frame_reference:'upper_third',focus_point:'eyes',shot:'close',padding:1.06};
const box=new THREE.Box3(new THREE.Vector3(-.15,1.4,-.1),new THREE.Vector3(.15,1.8,.1));
const state={preset:p,bounds:box,focus:new THREE.Vector3(0,1.65,0),target:new THREE.Vector3(0,1.65,0),placement:[.5,1/3]};
const settings={mode:'bookends',preset:p,target_actor:null,manual_path:{aim:'shot',kind:'curve',pacing:'linear',framing_priority:'shot'},start:{position:[-2,1.5,5],target:[0,1.5,0],fov:45},end:{position:[2,1.5,5],target:[0,1.5,0],fov:45}};
const camera=new THREE.PerspectiveCamera(45,16/9,.01,1000);
camera.position.set(0,1.65,2);const referenceLens=fitManualReference(camera,state);
for(const position of [[0,1.65,2],[0,1.65,8],[2,2,-4],[-3,.5,4]]){
 camera.position.set(...position);const before=camera.position.clone();applyManualFraming(camera,settings,state,referenceLens);
 assert.ok(before.equals(camera.position));assert.equal(camera.fov,referenceLens.fov);
 const local=state.focus.clone().sub(camera.position).applyQuaternion(camera.quaternion.clone().invert());const point=imagePoint(local,camera.fov,camera.aspect);
 assert.ok(Math.abs(point.x)<1e-7);assert.ok(Math.abs(point.y-1/3)<1e-7);
}
camera.position.copy(state.target);const impossible=fitManualReference(camera,state);assert.ok(impossible.limited);assert.ok(camera.quaternion.toArray().every(Number.isFinite));
// Adjustment markers start equally spaced on a straight route, then remain freely editable.
settings.start.position=[0,2,4];settings.end.position=[12,2,4];resetCurve(settings,0);settings.manual_path.kind='line';
for(let i=1;i<=5;i++){
 addPathPoint(settings);assert.equal(settings.manual_path.points.length,i);
 for(let j=0;j<i;j++)assert.ok(Math.abs(settings.manual_path.points[j][0]-12*(j+1)/(i+1))<1e-5);
 const curve=manualCurve(settings);
 for(let j=0;j<i;j++)assert.ok(curve.getPoint((j+1)/(i+1)).distanceTo(new THREE.Vector3(...settings.manual_path.points[j]))<1e-6);
}
assert.throws(()=>addPathPoint(settings),/at most 5/);assert.equal(MAX_PATH_POINTS,5);
moveMarker(settings,'point4',[5,6,7]);assert.ok(manualCurve(settings).getPoint(5/6).distanceTo(new THREE.Vector3(5,6,7))<1e-8);
const restored=JSON.parse(JSON.stringify(settings));for(let i=0;i<=100;i++)assert.ok(manualPosition(settings,i/100).distanceTo(manualPosition(restored,i/100))<1e-9);
removePathPoint(settings,4);assert.equal(settings.manual_path.points.length,4);
console.log('Manual aim/thirds, reference-frame fit, constant playback zoom, fixed path, impossible-position warning, max-5 equidistant adjustments, exact waypoint passage, marker editing and JSON restore passed.');
// A curved route's new markers initialize at equal distance fractions of its current shape.
const curved={...settings,start:{...settings.start,position:[0,2,4]},end:{...settings.end,position:[10,2,4]},manual_path:{kind:'curve',controls:[[0,8,5],[8,-2,3]],aim:'shot',framing_priority:'shot'}};
for(let count=1;count<=5;count++){
 const prior=manualCurve(curved),expected=Array.from({length:count},(_,i)=>prior.getPointAt((i+1)/(count+1)));
 addPathPoint(curved);curved.manual_path.points.forEach((point,i)=>assert.ok(new THREE.Vector3(...point).distanceTo(expected[i])<1e-8));
}
for(const aspect of [16/9,9/16,1])for(const lens of ['natural','fisheye'])for(const priority of ['shot','lens']){
 camera.aspect=aspect;camera.position.set(1,2,3);settings.manual_path.framing_priority=priority;
 const projected={...state,preset:{...p,lens}};const reference=fitManualReference(camera,projected);applyManualFraming(camera,settings,projected,reference);
 assert.ok([...camera.position.toArray(),...camera.quaternion.toArray(),camera.fov].every(Number.isFinite));
 assert.equal(camera.userData.cartwheelFisheye,lens==='fisheye');
}
console.log('Equal-distance initialization on curved routes and legacy settings and both projections in landscape, portrait and square passed.');
