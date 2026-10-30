import assert from 'node:assert/strict';
import * as T from '../web/vendor/build/three.module.js';
import {presetDefaults,presetPlan,manualFramingState} from '../web/camera_presets.js';
import {positionContext,positionFromCoordinates} from '../web/camera_position.js';
import {pathProgress} from '../web/manual_path.js';
import {movementProgress} from '../web/movement_timing.js';
import {applyCamera} from '../web/camera_motion.js';
const actors=[1,2,3].map((number,i)=>{
 const root=new T.Group();root.position.x=i===2?50:i*4;
 for(const [name,x,y,z] of [['c_spine0',0,.9,0],['c_head',0,1.7,0],['l_uparm',-.2,1.4,0],['r_uparm',.2,1.4,0],['l_wrist',-.4,1.5,.8],['r_wrist',.4,1.5,.8]]){const b=new T.Bone();b.name=name;b.position.set(x,y,z);root.add(b);}
 root.updateMatrixWorld(true);return{number,root};
});
const capture={actors,duration:4,camera:new T.PerspectiveCamera(45,16/9,.01,1000),setTime(){for(const a of actors)a.root.updateMatrixWorld(true);}};
const p={...presetDefaults([1,2]),horizontal:'custom',custom_position:[2,1.4,2],position_offset:[0,0,0],movement:'push',behavior:'move',aim_source:'reference',reference_time:1,pacing:'constant',aim_behavior:'target',lens:'natural'};
for(const reference_time of [0,1,3.9])for(const travel of [0,1,20,100]){
 const plan=presetPlan(capture,{mode:'preset',preset:{...p,reference_time,travel}},4);
 assert.ok(plan.positions.at(-1).distanceTo(new T.Vector3(...p.custom_position))<1e-8,'Push end moved when travel changed');
 assert.ok(Math.abs(plan.positions[0].distanceTo(plan.positions.at(-1))-travel)<1e-7);
 assert.ok(plan.fovs.every(f=>Math.abs(f-plan.fovs[0])<1e-9),'Push added zoom');
 assert.ok(plan.anchorPosition.distanceTo(plan.positions.at(-1))<1e-8);
}
const e={settings:{mode:'preset',preset:p},capture,time:0,currentFrameTime:()=>0,sampleTime:()=>{}};
const face=positionContext(e);e.settings.preset={...p,focus_point:'hands'};const hands=positionContext(e);
assert.deepEqual(face.target,[2,.9,0],'Orbit must average the selected roots, excluding the third actor');
assert.deepEqual(face.target,hands.target,'Changing aim moved the orbit pivot');
assert.deepEqual(face.position,hands.position,'Reading the push controls moved its endpoint');
const orbit=presetPlan(capture,{mode:'preset',preset:{...p,movement:'orbit',orbit_degrees:120}},4);
const pivot=manualFramingState(capture,p).body;
for(const pos of orbit.positions)assert.ok(Math.abs(Math.hypot(pos.x-pivot.x,pos.z-pivot.z)-2)<1e-8,'Orbit radius changed around the selected roots');
for(const smooth of [false,true]){
 const s={mode:'bookends',target_actor:null,preset:{...p,start_time:1,end_time:3},manual_path:{kind:'line',aim:'blend',pacing:smooth?'smooth':'linear'},start:{position:[0,1,4],target:[0,1,0],fov:45},end:{position:[4,1,4],target:[0,1,0],fov:45}};
 for(let t=0;t<=4;t+=.1)assert.equal(pathProgress(s,t,4),movementProgress(t,s.preset,4,smooth?'ease_in_out':'constant'));
 for(const [time,x] of [[0,0],[1,0],[2,2],[3,4],[4,4]]){applyCamera(capture,s,time,4);assert.ok(Math.abs(capture.camera.position.x-x)<1e-8);}
}
// Retimed imported paths must use sampled orientation, not the unretimed native camera.
const source={mode:'bookends',preset:{start_time:1,end_time:3},manual_path:{kind:'line',pacing:'linear',aim:'source',source_frames:[{time:0,position:[0,1,4],quaternion:[0,0,0,1],fov:45},{time:4,position:[4,1,4],quaternion:new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),.8).toArray(),fov:45}]},start:{position:[0,1,4]},end:{position:[4,1,4]}};
capture.inputCamera={format:'fbx'};capture.camera.quaternion.setFromAxisAngle(new T.Vector3(1,0,0),1);applyCamera(capture,source,.5,4);assert.ok(capture.camera.quaternion.angleTo(new T.Quaternion())<1e-8);
console.log('PASS: long end-anchored push-ins, fixed lenses, selected-root orbit pivot independent of aim, shared manual/preset timing/easing and retimed imported orientation.');
