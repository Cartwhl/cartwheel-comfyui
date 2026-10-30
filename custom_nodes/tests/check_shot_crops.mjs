import assert from 'node:assert/strict';
import * as T from '../web/vendor/build/three.module.js';
import {presetDefaults,presetPlan,PRESET_DEFAULTS} from '../web/camera_presets.js';
import {applyCamera} from '../web/camera_motion.js';
import {selectShot,restoreShotFraming} from '../web/shot_controls.js';

// Saved centered framing retains its calibrated anatomical crop.
// Modern focus/thirds composition is checked separately.
// Measured anatomical cutoffs are tested in screen space, not just 'head fits'.
function fixture(aspect, mhrAxes=false) {
  const actors=[1,2].map((number,index)=>{
    const root=new T.Group();root.position.x=index*2;
    const mesh=new T.Mesh(new T.BoxGeometry(.45,1.8,.25));mesh.position.y=.9;root.add(mesh);
    const bone=(name,x,y,z=0)=>{const b=new T.Bone();b.name=name;b.position.set(x,y,z);root.add(b);return b};
    const head=bone('c_head',0,1.6);
    if(mhrAxes) head.quaternion.setFromAxisAngle(new T.Vector3(0,0,1),Math.PI/2);
    bone('c_neck',0,1.5);bone('l_eye',-.032,1.69,.10);bone('r_eye',.032,1.69,.10);
    bone('c_spine0',0,.98);bone('c_spine2',0,1.35);
    bone('l_uparm',.22,1.43);bone('r_uparm',-.22,1.43);
    bone('l_upleg',.10,.94);bone('r_upleg',-.10,.94);
    bone('l_lowleg',-.1,.52);bone('r_lowleg',.1,.52);
    bone('l_foot',-.1,.05);bone('r_foot',.1,.05);
    // Hands held wide must not turn chest-up into a wide shot.
    bone('l_wrist',-1,1.40);bone('r_wrist',1,1.4);
    root.updateMatrixWorld(true);return {number,root};
  });
  const camera=new T.PerspectiveCamera(45,aspect,.001,100);
  return {actors,camera,duration:.25,setTime(){actors.forEach(a=>a.root.updateMatrixWorld(true));camera.aspect=aspect;camera.updateProjectionMatrix();camera.updateMatrixWorld(true)}};
}
const results={};
for(const aspect of [21/9,16/9,4/3,1,9/16]) for(const axes of [false,true]) {
  const capture=fixture(aspect,axes);
  const yAt=(y,z=.10)=>new T.Vector3(0,y,z).project(capture.camera).y;
  const heights={};
  for(const shot of ['extreme_close','close','chest','waist','cowboy','medium_full','full']) {
    const settings={mode:'preset',preset:{...presetDefaults([1]),focus_point:"legacy",shot,reference_basis:'chest'}};
    capture.setTime();applyCamera(capture,settings,0,capture.duration);
    const crown=yAt(1.79),chin=yAt(1.56),eyes=yAt(1.69),chest=yAt(1.35),waist=yAt(1.05),thigh=yAt(.73),knee=yAt(.52),foot=yAt(.05);
    heights[shot]=Math.abs(new T.Vector3(-.032,1.69,.1).project(capture.camera).x-new T.Vector3(.032,1.69,.1).project(capture.camera).x);
    assert.ok(Math.abs(eyes)<1,`${shot} loses eyes`);
    if(shot==='extreme_close') {assert.ok(crown>1 && chin < -1,'ECU must crop both forehead and chin');assert.ok(chest < -2,'ECU must not include torso');}
    if(shot==='close') {assert.ok(crown<1 && chin > -1,`CU must include head ${crown} ${chin}`);assert.ok(chest < -1,'CU must crop chest');assert.ok(crown-chin>1.5,'CU leaves too much room around head');}
    if(shot==='chest') assert.ok(chest > -1 && waist < -1,'MCU should cut between chest and waist');
    if(shot==='waist') assert.ok(waist > -1 && thigh < -1,'Medium should cut at waist');
    if(shot==='cowboy') assert.ok(thigh > -1 && knee < -1,`Cowboy should cut at mid-thigh ${thigh} ${knee}`);
    if(shot==='medium_full') assert.ok(knee > -1 && foot < -1,'Medium full should cut below knee');
    if(shot==='full') {assert.ok(foot > -1 && crown<1,'Full should include head and feet');if(aspect>=4/3)assert.ok(crown-foot>1.6,`Full-body shot leaves too much vertical room ${aspect}: ${crown-foot}`);}
  }
  assert.ok(Object.values(heights).every((h,i,all)=>!i||h<all[i-1]),`Shot sizes must get progressively wider ${JSON.stringify(heights)}`);
  if(aspect===21/9&&!axes)Object.assign(results,heights);
  // Group framing still fits the horizontal separation, even for tight sizes.
  const group={mode:'preset',preset:{...presetDefaults([1,2]),shot:'close'}};
  capture.setTime();applyCamera(capture,group,0,capture.duration);
  for(const x of [0,2])assert.ok(Math.abs(new T.Vector3(x,1.69,.10).project(capture.camera).x)<1);
}
const p={...presetDefaults([1]),framing_version:1,aim:'chest',position_offset:[1,2,3],target_offset:[2,3,4],padding:1.8};
selectShot(p,'extreme_close');assert.equal(p.aim,'auto');assert.equal(p.framing_version,2);
restoreShotFraming(p);assert.deepEqual(p.position_offset,[0,0,0]);assert.deepEqual(p.target_offset,[0,0,0]);assert.equal(p.padding,1.06);
const detail={...presetDefaults([1]),composition:'detail',aim:'left_hand'};selectShot(detail,'extreme_close');assert.equal(detail.aim,'left_hand');
assert.equal(PRESET_DEFAULTS.framing_version,1,'Unversioned saved shots must retain legacy math');
console.log('Anatomical crop cutoffs, two head-axis conventions, five aspect ratios, group fitting and explicit framing reset passed.',results);
