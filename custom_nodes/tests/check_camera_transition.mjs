import assert from 'node:assert/strict';
import * as T from '../web/vendor/build/three.module.js';
import {presetDefaults,manualFramingState} from '../web/camera_presets.js';
import {applyCamera} from '../web/camera_motion.js';
import {endpointRecipe} from '../web/camera_transition.js';
import {perspectiveVerticalFOV} from '../web/lens_projection.js';
function fixture(aspect=16/9) {
 const actors=[1,2].map((number,i)=>{
  const root=new T.Group();const bones={};
  const mesh=new T.Mesh(new T.BoxGeometry(.45,1.8,.25));mesh.position.y=.9;root.add(mesh);
  const bone=(name,x,y,z=0)=>{const b=new T.Bone();b.name=name;b.position.set(x,y,z);root.add(b);bones[name]=b;return b;};
  bone('c_head',0,1.6);bone('c_neck',0,1.5);bone('l_eye',.032,1.69,.1);bone('r_eye',-.032,1.69,.1);
  bone('c_spine0',0,.98);bone('c_spine2',0,1.35);bone('l_uparm',.22,1.43);bone('r_uparm',-.22,1.43);
  for(const [side,sign] of [['l',1],['r',-1]]) {
   bone(side+'_upleg',sign*.1,.94);bone(side+'_lowleg',sign*.1,.52);bone(side+'_foot',sign*.1,.05);
   bone(side+'_toe',sign*.1,.035,.15);bone(side+'_lowarm',sign*.3,1.15);
   bone(side+'_wrist',sign*.35,1.05,.15);
   bone(side+'_index0',sign*.35,1.02,.21);bone(side+'_index1',sign*.35,1.0,.26);bone(side+'_thumb0',sign*.40,1.04,.19);
  }
  return {number,root,bones,origin:i*1.5};
 });
 const camera=new T.PerspectiveCamera(45,aspect,.01,100);
 return {actors,camera,duration:1,setTime(t){
  for(const a of actors){a.root.position.x=a.origin+t*.2;for(const name of ['l_wrist','l_index0','l_index1','l_thumb0'])a.bones[name].position.y=1.05+.15*Math.sin(t*4)+(name==='l_wrist'?0:-.05);a.root.updateMatrixWorld(true);}
  camera.aspect=aspect;camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
 }};
}

const c=fixture(),base={mode:'bookends',preset:{...presetDefaults([1]),follow_strength:1,focus_point:'hands',frame_reference:'center',tracking_mode:'auto',aim_source:'live',pacing:'constant'},manual_path:{kind:'line',aim:'shot'},start:{position:[0,1.5,5],target:[0,1,0],fov:45},end:{position:[1,2,4],target:[0,1,0],fov:45}};
const snapshot=p=>Object.fromEntries(['target_mode','custom_target','actors','selection','composition','reference_actor','focus_point','frame_reference','follow_strength','focal_length','roll','fisheye_fov'].map(k=>[k,structuredClone(p[k])]));
const s=structuredClone(base),a=snapshot(base.preset),b=snapshot(base.preset);
s.preset.camera_transition={enabled:true,fields:['target','focus_point','frame_reference','focal_length','roll','follow_strength'],start:a,end:b};
Object.assign(b,{actors:[2],reference_actor:2,focus_point:'chest',frame_reference:'upper_right',focal_length:80,roll:20});
const poses=new Map();
for(const time of [0,.25,.5,.75,1,.1,.9]){
 c.setTime(time);applyCamera(c,base,time,1);const position=c.camera.position.clone();
 c.setTime(time);applyCamera(c,s,time,1);assert.ok(position.distanceTo(c.camera.position)<1e-12,'Transition altered camera position.');
 assert.ok(Math.abs(c.camera.fov-perspectiveVerticalFOV(35+45*time,16/9,s.preset))<1e-8,'Lens interpolation is incorrect.');
 assert.ok(c.camera.quaternion.toArray().every(Number.isFinite));poses.set(time,c.camera.quaternion.clone());
}
for(const time of [0,1]){
 c.setTime(time);applyCamera(c,s,time,1);const p=endpointRecipe(s.preset,s.preset.camera_transition,time?'end':'start'),state=manualFramingState(c,p),uv=state.focus.clone().project(c.camera);
 const expected=time?[1/3,1/3]:[0,0];assert.ok(Math.abs(uv.x-expected[0])<1e-5&&Math.abs(uv.y-expected[1])<1e-5,`Wrong endpoint target/aim/composition at ${time}: ${uv.toArray()}`);
}
for(const time of [.9,.25,1,0,.1]){c.setTime(time);applyCamera(c,s,time,1);assert.ok(c.camera.quaternion.angleTo(poses.get(time))<1e-7,'Random access changed output.');}
const lensOnly=structuredClone(s);lensOnly.preset.camera_transition.fields=['focal_length'];
for(const time of [0,.5,1]){c.setTime(time);applyCamera(c,base,time,1);const q=c.camera.quaternion.clone();c.setTime(time);applyCamera(c,lensOnly,time,1);assert.ok(q.angleTo(c.camera.quaternion)<1e-7,'Lens-only animation changed aim.');}
for(const fields of [[],['target','focus_point','frame_reference','follow_strength','roll']]){
 const fixed=structuredClone(s);fixed.preset.camera_transition.fields=fields;
 for(const time of [0,.5,1]){c.setTime(time);applyCamera(c,base,time,1);const fov=c.camera.fov;c.setTime(time);applyCamera(c,fixed,time,1);assert.equal(c.camera.fov,fov,'Unselected lens changed.');}
}
const disabled=structuredClone(s);disabled.preset.camera_transition.enabled=false;
for(const time of [0,.5,1]){c.setTime(time);applyCamera(c,base,time,1);const q=c.camera.quaternion.clone(),f=c.camera.fov;c.setTime(time);applyCamera(c,disabled,time,1);assert.ok(q.angleTo(c.camera.quaternion)<1e-7);assert.equal(c.camera.fov,f);}
const marker=structuredClone(s);marker.preset.camera_transition.fields=['target'];Object.assign(marker.preset.camera_transition.end,{target_mode:'marker',custom_target:[3,1,0]});
for(const time of [0,.5,1]){c.setTime(time);applyCamera(c,marker,time,1);assert.ok(c.camera.quaternion.toArray().every(Number.isFinite));}
console.log('PASS: smoothly changing actors/joints/composition/strength/lens/tilt, exact endpoint framing, unchanged path, no implicit zoom, lens-only isolation, marker transition, deterministic scrubbing and disabled compatibility.');
