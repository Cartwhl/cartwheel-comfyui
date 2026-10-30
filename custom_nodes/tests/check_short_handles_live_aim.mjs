import assert from 'node:assert/strict';
import * as T from '../web/vendor/build/three.module.js';
import {resetCurve,manualCurve,addPathPoint,manualPosition,markerPosition,displayMarkerPosition,moveDisplayMarker,HANDLE_DISPLAY_SCALE,handleAnchor} from '../web/manual_path.js';
import {presetDefaults,presetPlan,focusWarnings,manualFramingState} from '../web/camera_presets.js';
import {manualTrackingPlan} from '../web/manual_tracking.js';
import {applyCamera} from '../web/camera_motion.js';
assert.equal(handleAnchor({mode:'preset'},'handle1'),null);
assert.equal(handleAnchor({mode:'preset'},'handle2'),null);
const s={start:{position:[0,2,4]},end:{position:[8,3,4]},manual_path:{kind:'curve'}};resetCurve(s);
const original=Array.from({length:101},(_,i)=>manualPosition(s,i/100).toArray());
const anchor=new T.Vector3(...s.start.position),effective=new T.Vector3(...markerPosition(s,'handle1')),display=new T.Vector3(...displayMarkerPosition(s,'handle1'));
assert.ok(Math.abs(display.distanceTo(anchor)/effective.distanceTo(anchor)-1/3)<1e-12);
for(let i=0;i<=100;i++)assert.deepEqual(manualPosition(s,i/100).toArray(),original[i],'Display shortening changed the saved path');
const before=s.manual_path.controls[0][1],position=displayMarkerPosition(s,'handle1');position[1]+=.2;moveDisplayMarker(s,'handle1',position);assert.ok(Math.abs(s.manual_path.controls[0][1]-before-.6)<1e-9,'A short handle must retain 3x effective reach');
addPathPoint(s);addPathPoint(s);addPathPoint(s);
const zero=JSON.parse(JSON.stringify(s));delete zero.manual_path.point_handles;
for(let i=0;i<=100;i++)assert.ok(manualCurve(s).getPoint(i/100).distanceTo(manualCurve(zero).getPoint(i/100))<1e-10,'Default local handles changed the existing curve');
for(let i=0;i<3;i++)for(const side of ['in','out']){
 const id=`point${i}_${side}`,a=new T.Vector3(...s.manual_path.points[i]),actual=new T.Vector3(...markerPosition(s,id)),shown=new T.Vector3(...displayMarkerPosition(s,id));
 assert.ok(Math.abs(shown.distanceTo(a)/actual.distanceTo(a)-1/3)<1e-9);
}
const oldCurve=manualCurve(s).getPoint(.55);let v=displayMarkerPosition(s,'point1_out');v[1]+=.3;moveDisplayMarker(s,'point1_out',v);
assert.ok(manualCurve(s).getPoint(.55).distanceTo(oldCurve)>.01,'Intermediate handles have no effect');
for(let i=0;i<3;i++)assert.ok(manualCurve(s).getPoint((i+1)/4).distanceTo(new T.Vector3(...s.manual_path.points[i]))<1e-9,'A local tangent moved its knot');
const saved=JSON.parse(JSON.stringify(s));for(let i=0;i<=100;i++)assert.ok(manualPosition(saved,i/100).distanceTo(manualPosition(s,i/100))<1e-9);
s.manual_path.smooth_handles=true;moveDisplayMarker(s,'point1_out',displayMarkerPosition(s,'point1_out'));
const h=1e-5,t=.5,curve=manualCurve(s),left=curve.getPoint(t).sub(curve.getPoint(t-h)).normalize(),right=curve.getPoint(t+h).sub(curve.getPoint(t)).normalize();assert.ok(left.dot(right)>.999,'Paired local handles broke tangent continuity');
console.log('PASS: one-third display, unchanged legacy/default curves, 3x manipulation, local handles on all adjustment points, smooth tangents, exact knots and JSON restore.');
function scene(){
 const root=new T.Group(),bones={};const mesh=new T.Mesh(new T.BoxGeometry(.5,1.8,.3));mesh.position.y=.9;root.add(mesh);
 for(const [name,x,y,z] of [['c_head',0,1.7,0],['c_spine0',0,.9,0],['l_uparm',-.2,1.4,0],['r_uparm',.2,1.4,0],['l_wrist',-.18,.95,.1],['r_wrist',.18,.95,.1]]){const b=new T.Bone();b.name=name;b.position.set(x,y,z);root.add(b);bones[name]=b;}
 const camera=new T.PerspectiveCamera(45,16/9,.01,100);return {actors:[{number:1,root}],camera,duration:4,setTime(t){const raise=.5*Math.min(1,t/1.0),bob=.08*Math.sin(t*2*Math.PI*5);bones.l_wrist.position.y=bones.r_wrist.position.y=.95+raise+bob;root.updateMatrixWorld(true);},bones};
}
const c=scene();const settings=strength=>({mode:'bookends',preset:{...presetDefaults([1]),aim_source:'live',follow_strength:strength,focus_point:'hands',frame_reference:'center',tracking_mode:'auto'},manual_path:{kind:'line',aim:'shot'},start:{position:[0,1.3,4],target:[0,1,0],fov:45},end:{position:[0,1.3,4],target:[0,1,0],fov:45}});
const variation=plan=>plan.quaternions.slice(1).reduce((sum,q,i)=>sum+q.angleTo(plan.quaternions[i]),0);
let relaxed=settings(0),tight=settings(1),lens={fov:40};const relaxedPlan=manualTrackingPlan(c,relaxed,4,lens,0),tightPlan=manualTrackingPlan(c,tight,4,lens,0);
assert.ok(variation(relaxedPlan)<variation(tightPlan)*.1,'Steady aiming still bounces with hand gestures');
assert.ok(variation(tightPlan)>.1,'Tight follow did not track animation');
for(const time of [0,80/60,2.17,3.8,1.1]){
 c.setTime(time);applyCamera(c,tight,time,4);const state=manualFramingState(c,tight.preset),uv=state.focus.clone().project(c.camera);assert.ok(Math.abs(uv.x)<1e-5&&Math.abs(uv.y)<.01,'Tight follow did not use the current hand pose');
 const fov=c.camera.fov;c.setTime(3.1);applyCamera(c,tight,3.1,4);assert.equal(c.camera.fov,fov,'Aiming changed the lens');
}
const changed=JSON.parse(JSON.stringify(tight));changed.preset.reference_time=2.17;
for(const time of [.2,1.33,3.7]){c.setTime(time);applyCamera(c,tight,time,4);const q=c.camera.quaternion.clone();c.setTime(time);applyCamera(c,changed,time,4);assert.ok(q.angleTo(c.camera.quaternion)<1e-7,'Live aiming depends on a fixed reference frame');}
const fixed=settings(.5);fixed.preset.aim_source='reference';fixed.preset.reference_time=80/60;c.setTime(0);applyCamera(c,fixed,0,4);const held=c.camera.quaternion.clone();c.setTime(3.8);applyCamera(c,fixed,3.8,4);assert.ok(held.angleTo(c.camera.quaternion)<1e-7,'Explicit held pose changed during playback');
const placed={mode:'preset',preset:{...tight.preset,horizontal:'custom',custom_position:[0,1.3,4]}};
c.setTime(80/60);applyCamera(c,placed,80/60,4);assert.ok(Math.abs(manualFramingState(c,placed.preset).focus.clone().project(c.camera).y)<.01,'Placed camera did not use live focus');
const unknown=new T.Group();unknown.add(new T.Bone());assert.ok(focusWarnings({actors:[{number:1,root:unknown}]},tight.preset)[0].includes('not recognized'));
console.log('PASS: steady gesture rejection, exact current-pose hands at frame 80, fixed lens/path, reference-frame independence, held-frame mode, placed cameras and unknown-rig feedback.');
