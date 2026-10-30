import assert from 'node:assert/strict';
import * as T from '../web/vendor/build/three.module.js';
import {depthValue,poseJoints,ControlPasses} from '../web/control_passes.js';
assert.equal(depthValue(.1),.98);assert.equal(depthValue(50),.12);assert.ok(depthValue(3)>depthValue(10));
for(const names of [['c_spine0','c_spine2','c_neck','c_head','l_uparm','l_lowarm','l_hand'],['mixamorig:Hips','mixamorig:Spine2','mixamorig:Neck','mixamorig:Head','mixamorig:LeftArm','mixamorig:LeftForeArm','mixamorig:LeftHand']]){
 const root=new T.Group();for(const name of names){const b=new T.Bone();b.name=name;root.add(b);}
 const joints=poseJoints({root});for(const key of ['hips','chest','neck','head','la','le','lh'])assert.ok(joints[key],key);
 const passes=new ControlPasses({actors:[{root,number:1}]});assert.equal(passes.rigs.length,1);passes.dispose();
}
const empty=new ControlPasses({actors:[{root:new T.Group(),number:1}]});assert.equal(empty.rigs.length,0);empty.dispose();
console.log('PASS: fixed metric depth scale, MHR/Mixamo animated joint mapping, explicit unsupported-rig detection.');

const {sampleInputCamera}=await import('../web/input_camera.js');
const camera=new T.PerspectiveCamera(),q=new T.Quaternion().setFromEuler(new T.Euler(.2,.3,.7));
sampleInputCamera(camera,{frames:[{time:0,position:[0,1,5],quaternion:q.toArray(),target:[100,100,100],roll:0,fov:40}]},0);
assert.ok(camera.quaternion.angleTo(q)<1e-7,'An informational target overrode the exported quaternion/roll.');
console.log('PASS: sampled camera round-trip retains exact orientation when informational targets are present.');

// A referee behind the foreground actors remains visibly above black, even at
// extreme camera distances. The clip range never pumps from frame to frame.
for(const distance of [4,61,200]){
 const actors=[0,1,4].map((z,i)=>{const root=new T.Group(),mesh=new T.Mesh(new T.BoxGeometry(.5,1.8,.4));mesh.position.set(i*.7,.9,-z);root.add(mesh);return {root,number:i+1};});
 const camera=new T.PerspectiveCamera();camera.position.set(0,1,distance);camera.updateMatrixWorld();
 const passes=new ControlPasses({actors});passes.configureDepth(t=>{actors[2].root.position.z=Math.sin(t*3)*2;for(const a of actors)a.root.updateMatrixWorld(true);return camera;},2);
 const near=passes.uniforms.near.value,far=passes.uniforms.far.value;
 assert.ok(far-near>=9.144-1e-8);assert.ok(far>distance+4);
 assert.ok(depthValue(distance+4,near,far)>.12);assert.ok(depthValue(distance,near,far)>depthValue(distance+4,near,far));
 assert.equal(depthValue(far+100,near,far),.12,'Clamped geometry vanished into the background.');passes.dispose();
}
console.log('PASS: 30-foot minimum clip range, precise animated geometry bounds, foreground/background separation and 200m establishing camera.');
