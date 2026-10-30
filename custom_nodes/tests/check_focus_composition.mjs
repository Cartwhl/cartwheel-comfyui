import assert from 'node:assert/strict';
import * as T from '../web/vendor/build/three.module.js';
import {presetDefaults,presetPlan} from '../web/camera_presets.js';
import {applyCamera} from '../web/camera_motion.js';
import {FOCUS_POINTS,FOCUS_FILL,composedOrientation,screenPlacement} from '../web/camera_composition.js';

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
const settings=patch=>({mode:'preset',preset:{...presetDefaults([1]),...patch}});
const project=(capture,point)=>{const v=point.clone().project(capture.camera);return[(v.x+1)/2,(1-v.y)/2];};
for(const aspect of [21/9,9/16]) {
 const c=fixture(aspect);
 for(const key of Object.keys(FOCUS_POINTS).filter(key=>key!=='auto'))for(const horizontal of ['front','back','left','right']) {
  const s=settings({focus_point:key,horizontal,frame_reference:'upper_right',shot:'close'});
  c.setTime(0);applyCamera(c,s,0,1);const plan=presetPlan(c,s,1);
  const uv=project(c,plan.targets[0]);assert.ok(Math.abs(uv[0]-2/3)<1e-6&&Math.abs(uv[1]-1/3)<1e-6,`${key}/${horizontal}/${aspect} did not land on selected thirds`);
  assert.ok(c.camera.position.toArray().every(Number.isFinite));
 }
 // Independent ratio presets for a hand must get progressively looser.
 const spans=[];
 for(const shot of Object.keys(FOCUS_FILL)) {
  const s=settings({focus_point:'left_hand',frame_reference:'center',shot});
  c.setTime(0);applyCamera(c,s,0,1);
  const a=c.actors[0],w=a.bones.l_wrist.getWorldPosition(new T.Vector3()).project(c.camera),f=a.bones.l_index1.getWorldPosition(new T.Vector3()).project(c.camera);
  spans.push(w.distanceTo(f));
 }
 assert.ok(spans.every((span,i)=>!i||span<spans[i-1]),'Hand shot ratios did not change apparent size independently');
 // Direct Follow pins the moving focus; Static remains locked.
 const follow=settings({focus_point:'left_hand',frame_reference:'custom',frame_x:.4,frame_y:.25,behavior:'follow',follow_response:'direct'});
 for(const time of [0,.3,.8,1]) {c.setTime(time);applyCamera(c,follow,time,1);const plan=presetPlan(c,follow,1);const index=plan.times.findIndex(t=>Math.abs(t-time)<1e-8);const uv=project(c,plan.targets[index]);assert.ok(Math.abs(uv[0]-.4)<1e-6&&Math.abs(uv[1]-.25)<1e-6);}
 const locked=settings({focus_point:'hands',frame_reference:'upper_third'});c.setTime(0);applyCamera(c,locked,0,1);const pose=[...c.camera.position.toArray(),...c.camera.quaternion.toArray()];c.setTime(.8);applyCamera(c,locked,.8,1);assert.deepEqual([...c.camera.position.toArray(),...c.camera.quaternion.toArray()],pose);
}
// Auto keeps close-up tight; medium close-up favors the eye/upper-third line.
assert.deepEqual(screenPlacement({...presetDefaults([1]),shot:'close'}),[.5,.5]);
assert.deepEqual(screenPlacement({...presetDefaults([1]),shot:'chest'}),[.5,1/3]);
assert.equal(screenPlacement({...presetDefaults([1]),shot:'full'}),null);
assert.equal(screenPlacement({...presetDefaults([1]),focus_point:'legacy'}),null);
const c=fixture();const s=settings({focus_point:'auto',shot:'close'});c.setTime(0);applyCamera(c,s,0,1);
const eyes=c.actors[0].bones.l_eye.getWorldPosition(new T.Vector3()).add(c.actors[0].bones.r_eye.getWorldPosition(new T.Vector3())).multiplyScalar(.5);
assert.ok(Math.abs(project(c,eyes)[1]-.5)<1e-6,'Auto did not use actual eye landmarks');
// Full quaternion calculation includes roll, aspect and both placement axes.
for(const roll of [-20,0,25]) {
 const camera=new T.PerspectiveCamera(50,16/9,.01,100),point=new T.Vector3(1,1,0);camera.position.set(-2,3,5);camera.quaternion.copy(composedOrientation(camera.position,point,roll,50,16/9,[.3,.7]));camera.updateMatrixWorld(true);const uv=project({camera},point);assert.ok(Math.abs(uv[0]-.3)<1e-6&&Math.abs(uv[1]-.7)<1e-6);
}
console.log('Every body focus from front/back/sides in landscape/portrait, exact/custom thirds, hand size ratios, direct Follow, locked Static, eye landmarks and roll passed.');
const group=fixture(9/16);
const groupSettings={mode:'preset',preset:{...presetDefaults([1,2]),focus_point:'hands',shot:'close',frame_reference:'upper_right'}};
group.setTime(0);applyCamera(group,groupSettings,0,1);
for(const a of group.actors)for(const name of ['l_wrist','r_wrist','l_index1','r_index1']) {
 const point=a.bones[name].getWorldPosition(new T.Vector3()).project(group.camera);assert.ok(Math.abs(point.x)<1&&Math.abs(point.y)<1,'Portrait group hand framing lost a selected hand');
}
const whole=settings({focus_point:'left_hand',shot:'close',frame_reference:'upper_right',framing_mode:'whole_clip'});
const plan=presetPlan(group,whole,1),reference=presetPlan(group,{...whole,preset:{...whole.preset,framing_mode:'reference'}},1);
assert.equal(plan.coverage,undefined);assert.equal(plan.preset.framing_mode,'reference');
plan.positions.forEach((p,i)=>assert.ok(p.distanceTo(reference.positions[i])<1e-10));
console.log('Selected group hands fit portrait; retired whole-clip settings retain the reference shot without distance inflation.');

const horizonQ=composedOrientation(new T.Vector3(2,2,5),new T.Vector3(0,1,0),0,50,16/9,[2/3,1/3]);assert.ok(Math.abs(new T.Vector3(1,0,0).applyQuaternion(horizonQ).y)<1e-8,'Off-center placement introduced an unwanted horizon roll');
for(const vertical of ['top','high','low','ground']) {
 const c=fixture();const s=settings({focus_point:'left_hand',frame_reference:'upper_left',vertical});c.setTime(0);applyCamera(c,s,0,1);const plan=presetPlan(c,s,1);const uv=project(c,plan.targets[0]);assert.ok(Math.abs(uv[0]-1/3)<1e-5&&Math.abs(uv[1]-1/3)<1e-5,`${vertical} lost focus placement`);
}
const sparse=fixture();for(const a of sparse.actors)for(const [name,bone]of Object.entries(a.bones))if(/index|thumb/.test(name))a.root.remove(bone);
assert.ok(presetPlan(sparse,settings({focus_point:'hands'}),1).warnings.some(text=>text.startsWith('Finger landmarks')),'Missing hand detail did not report its fallback');
console.log('Steep/ground placements remain finite and exact; absent finger landmarks report the hand fallback.');
// Regression: Auto's head, chest-up and waist-up must remain distinct crops.
// A shared exact thirds anchor previously let the same crown constraint pick
// almost identical distances for both close-up and medium close-up.
for(const aspect of [21/9,16/9,9/16]) {
 const scene=fixture(aspect),sizes={};
 for(const shot of ['close','chest','waist']) {
  const shotSettings=settings({shot});scene.setTime(0);applyCamera(scene,shotSettings,0,1);
  const crown=new T.Vector3(0,1.79,.1).project(scene.camera).y,chin=new T.Vector3(0,1.56,.1).project(scene.camera).y;
  sizes[shot]=crown-chin;
  if(shot==='close') assert.ok(new T.Vector3(0,1.35,.1).project(scene.camera).y < -1,'Auto head close-up includes chest');
  if(shot==='chest') assert.ok(scene.actors[0].bones.c_spine2.getWorldPosition(new T.Vector3()).project(scene.camera).y > -1,'Auto medium close-up crops its chest landmark');
 }
 assert.ok(sizes.close>sizes.chest*1.3,`Head/chest-up sizes converged: ${JSON.stringify(sizes)}`);
 assert.ok(sizes.close>sizes.waist*1.5,`Head/waist-up sizes converged: ${JSON.stringify(sizes)}`);
 console.log('Auto crop separation',aspect,sizes);
}
