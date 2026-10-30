import assert from 'node:assert/strict';
import * as T from '../web/vendor/build/three.module.js';
import {presetDefaults,manualFramingState,presetPlan} from '../web/camera_presets.js';
import {manualReferenceLens,manualLensKey} from '../web/manual_framing.js';
const root=new T.Group();const bones={};
for(const [name,x,y,z] of [['Head',0,1.7,0],['Hips',0,.9,0],['LeftShoulder',-.2,1.4,0],['RightShoulder',.2,1.4,0],['hand_L',-.2,1.35,.3],['hand_R',.2,1.35,.3]]){const b=new T.Bone();b.name=name;b.position.set(x,y,z);root.add(b);bones[name]=b;}
const camera=new T.PerspectiveCamera(45,16/9,.01,100);const actor={number:1,root};const capture={actors:[actor],camera,duration:1,setTime(t){bones.hand_L.position.y=1.35+t*.2;bones.hand_R.position.y=1.35+t*.2;root.updateMatrixWorld(true);}};
const preset={...presetDefaults([1]),focus_point:'hands',frame_reference:'center'};
capture.setTime(0);let state=manualFramingState(capture,preset);assert.ok(state.focus.y>1.2,'Raised hands should not focus at pelvis height');
capture.setTime(1);assert.ok(manualFramingState(capture,preset).focus.y>state.focus.y+.15,'Hand focus should follow animated wrist landmarks');
assert.equal(preset.reference_basis,'chest');
for(const aspect of [16/9,9/16,1,21/9,9/21,3/4])for(const mm of [10,18,35,50,100]){
 camera.aspect=aspect;
 const settings={mode:'bookends',preset:{...preset,lens:'custom',focal_length:mm},manual_path:{kind:'line',aim:'shot'},start:{position:[0,1.4,3]},end:{position:[0,1.4,20]}};
 const expected=T.MathUtils.radToDeg(2*Math.atan((aspect>=1?Math.min(24,36/aspect):Math.min(36,24/aspect))/(2*mm)));
 assert.ok(Math.abs(manualReferenceLens(capture,settings,1,0).fov-expected)<1e-8,'Manual mm must be calibrated to a 36×24mm filmback');
 const key=manualLensKey(settings);settings.preset.focal_length=mm+1;assert.notEqual(manualLensKey(settings),key,'Explicit lens slider change must invalidate a saved lens');settings.preset.focal_length=mm;
 settings.start.position=[8,5,20];assert.equal(manualReferenceLens(capture,settings,1,0).fov,expected,'Moving manual camera must never refit lens');
 const p={mode:'preset',preset:{...preset,lens:'custom',focal_length:mm,horizontal:'custom',custom_position:[0,1.4,3]}};
 assert.ok(Math.abs(presetPlan(capture,p,1).fovs[0]-expected)<1e-8);
}
console.log('PASS: animated raised hand aliases, chest defaults, physical lens calibration at six aspects, deliberate focal changes and no distance-based zoom.');

for(const angle of [-89.9,-45,0,45,89.9]){
 const settings={mode:'preset',preset:{...preset,horizontal:'front',vertical:'custom',elevation_angle:angle}};
 const plan=presetPlan(capture,settings,1),offset=plan.positions[0].clone().sub(plan.targets[0]);
 assert.ok(offset.toArray().every(Number.isFinite));
 const actual=T.MathUtils.radToDeg(Math.atan2(offset.y,Math.hypot(offset.x,offset.z)));
 assert.ok(Math.abs(actual-angle)<.01,`Continuous vertical angle ${angle} changed to ${actual}`);
}
console.log('PASS: continuous bottom-up through top-down angles remain finite and preserve the requested angle.');
