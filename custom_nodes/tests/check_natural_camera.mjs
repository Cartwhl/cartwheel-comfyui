import assert from 'node:assert/strict';
import * as THREE from '../web/vendor/build/three.module.js';
import {presetDefaults,presetPlan,manualFramingState} from '../web/camera_presets.js';
import {applyCamera} from '../web/camera_motion.js';
import {manualPosition,pathProgress,resetCurve} from '../web/manual_path.js';
import {manualTrackingPlan} from '../web/manual_tracking.js';
import {imagePoint} from '../web/lens_projection.js';
import {manualReferenceLens} from '../web/manual_framing.js';
function scene({
  moving = true,
  bounce = true,
  aspect = 16 / 9,
  spacing = 1.5,
  turning = false,
  shoulderTwist = false,
} = {}) {
  const actors = [2, 4, 7].map((number, i) => {
    const root = new THREE.Group(),
      mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.8, 0.3));
    mesh.position.y = 0.9;
    root.add(mesh);
    const bone = (name, x, y, z = 0) => {
      const b = new THREE.Bone();
      b.name = name;
      b.position.set(x, y, z);
      root.add(b);
      return b;
    };
    const head = bone("c_head", 0, 1.65),
      hips = bone("c_spine0", 0, 0.9);
    const left = bone("l_uparm", -0.22, 1.4),
      right = bone("r_uparm", 0.22, 1.4);
    bone("l_upleg", 0.12, 0.85);
    bone("r_upleg", -0.12, 0.85);
    bone("l_foot", -0.12, 0.05);
    bone("r_foot", 0.12, 0.05);
    bone("l_wrist", -0.4, 0.85);
    bone("r_wrist", 0.4, 0.85);
    return { number, root, head, hips, left, right, origin: i * spacing };
  });
  const camera = new THREE.PerspectiveCamera(45, aspect, 0.01, 100);
  return {
    actors,
    camera,
    duration: 3,
    setTime(t) {
      for (const a of actors) {
        a.root.position.x = a.origin + (moving ? t : 0);
        a.root.rotation.y = turning ? (t * Math.PI) / 2 + (a.number === 4 ? Math.PI : 0) : 0;
        if (shoulderTwist) {
          a.left.position.set(0, 1.4, -0.22);
          a.right.position.set(0, 1.4, 0.22);
        }
        a.root.position.y = bounce ? 0.12 * Math.sin(t * 18) : 0;
        a.head.position.y = 1.65 + (bounce ? 0.04 * Math.sin(t * 31) : 0);
        a.root.updateMatrixWorld(true);
      }
      camera.position.set(0, 2, 5);
      camera.quaternion.identity();
      camera.fov = 45;
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
    },
  };
}

for(const lens of ['natural','fisheye'])for(const aspect of [16/9,9/16]){
 const c=scene({aspect,moving:true,bounce:true}),duration=3;
 const s={mode:'bookends',target_actor:null,preset:{...presetDefaults([2],1),tracking_mode:'auto',shot:'cowboy',lens},manual_path:{kind:'curve',aim:'shot',pacing:'smooth'},start:{position:[-2,1.2,5],target:[0,1,0],fov:45},end:{position:[2,1.2,5],target:[0,1,0],fov:45}};
 resetCurve(s);c.setTime(2);applyCamera(c,s,2,duration);const fov=c.camera.fov;
 for(const t of [2,0,1.7,.1,3,.5]){
  c.setTime(t);applyCamera(c,s,t,duration);const pos=c.camera.position.clone(),q=c.camera.quaternion.clone();
  assert.ok(pos.distanceTo(manualPosition(s,pathProgress(s,t,duration)))<1e-9);assert.equal(c.camera.fov,fov);
  const other=scene({aspect,moving:true,bounce:true});other.setTime(t);applyCamera(other,JSON.parse(JSON.stringify(s)),t,duration);
  assert.ok(pos.distanceTo(other.camera.position)<1e-9);assert.ok(q.angleTo(other.camera.quaternion)<1e-7);assert.equal(other.camera.fov,fov);
  assert.ok(Math.abs(c.actors[0].root.position.x-t)<1e-8);
 }
 s.preset.tracking_mode='exact';s.preset.framing_motion=true;
 for(const [t,x] of [[0,1/3],[3,2/3]]){
   c.setTime(t);applyCamera(c,s,t,duration);const state=manualFramingState(c,s.preset),local=state.target.clone().sub(c.camera.position).applyQuaternion(c.camera.quaternion.clone().invert());
   const projected=imagePoint(local,c.camera.fov,c.camera.aspect,lens==='fisheye');
   assert.ok(Math.abs((projected.x+1)/2-x)<1e-5);assert.ok(Math.abs((1-projected.y)/2-1/3)<1e-5);
 }
 const p={...presetDefaults([2],1),tracking_mode:'auto',behavior:'follow',movement:'track_subjects',shot:'cowboy',lens};
 const follow=presetPlan(c,{mode:'preset',preset:p},duration);
 assert.ok(Math.max(...follow.positions.map(v=>v.y))-Math.min(...follow.positions.map(v=>v.y))<1e-8,'Auto Follow should not rise and fall with running bounce');
 const locked=presetPlan(c,{mode:'preset',preset:{...p,tracking_mode:'exact'}},duration);
 assert.ok(Math.max(...locked.positions.map(v=>v.y))-Math.min(...locked.positions.map(v=>v.y))>.05,'Exact Follow should retain deliberate locked-on behavior');
 const fixed=presetPlan(c,{mode:'preset',preset:{...p,behavior:'static',movement:'fixed'}},duration);
 assert.ok(fixed.quaternions.every(q=>q.angleTo(fixed.quaternions[0])<1e-7));
}
console.log('Manual Auto keeps authored paths/fixed zoom and restores actor time; JSON and arbitrary seeks agree; Auto Follow removes vertical bounce; Static remains fixed in both projections and orientations.');

// Direct scene placement translates the planned camera, preserves its lens and
// keeps a static camera aimed at the selected reference composition.
for(const aspect of [16/9,9/16]) {
 const capture=scene({aspect,moving:false,bounce:false});
 const preset={...presetDefaults([2],0),behavior:'static',shot:'full',tracking_mode:'auto'};
 const settings={mode:'preset',camera_index:0,preset};capture.setTime(0);
 const before=presetPlan(capture,settings,3,0),point=before.positions[0].clone();
 preset.position_offset=[1,.5,-.25];
 const after=presetPlan(capture,settings,3,0);
 assert.ok(after.positions[0].distanceTo(point.clone().add(new THREE.Vector3(1,.5,-.25)))<1e-9);
 assert.equal(after.fovs[0],before.fovs[0]);
 const target=manualFramingState(capture,preset).target;
 const local=target.clone().sub(after.positions[0]).applyQuaternion(after.quaternions[0].clone().invert());
 const projected=imagePoint(local,after.fovs[0],aspect);
 assert.ok(projected.length()<1e-7,'Static placement must re-aim toward its reference composition');
 for(const q of after.quaternions)assert.ok(q.angleTo(after.quaternions[0])<1e-7);
}
console.log('Visual placement moves static cameras without changing their lens and preserves reference aiming.');

// A placed camera is the movement origin, not an offset applied after the move.
for(const ids of [[2],[2,4,7]])for(const aspect of [16/9,9/16])for(const lens of ['natural','fisheye'])for(const position of [[4,2,-3],[-5,1.2,2],[0,5,-4]]) {
 const c=scene({aspect,moving:false,bounce:false,spacing:.3});c.setTime(0);
 const p={...presetDefaults(ids,1.1),horizontal:'custom',custom_position:position,position_offset:[0,0,0],lens,
  behavior:'move',movement:'fixed',aim_behavior:'target',pacing:'constant',travel:.5,orbit_degrees:70,path_anchor:'fixed',direction:'left'};
 const state=manualFramingState(c,p),target=state.target,pivot=state.body,at=new THREE.Vector3(...position),direction=target.clone().sub(at).normalize();
 for(const movement of ['fixed','push','pull','truck','orbit','pedestal','crane']) {
  const recipe={...p,movement,direction:['pedestal','crane'].includes(movement)?'up':'left'},plan=presetPlan(c,{mode:'preset',preset:recipe},3,0),anchor=plan.referenceIndex;
  assert.ok(plan.positions[movement==='push'?plan.positions.length-1:movement==='pull'?0:anchor].distanceTo(at)<1e-8,`${movement} must begin from the actual placed reference position`);
  const right=new THREE.Vector3(1,0,0).applyQuaternion(plan.quaternions[anchor]);
  for(let i=0;i<plan.positions.length;i++) {
   const phase=(plan.times[i]-p.reference_time)/3,expected=at.clone();
   if(movement==='push')expected.addScaledVector(direction,.5*(plan.times[i]/3-1));
   if(movement==='pull')expected.addScaledVector(direction,-.5*plan.times[i]/3);
   if(movement==='truck')expected.addScaledVector(right,-.5*phase);
   if(movement==='pedestal'||movement==='crane')expected.y+=.5*phase;
   if(movement==='crane')expected.addScaledVector(direction,p.crane_forward*phase);
   if(movement==='orbit')expected.sub(pivot).applyAxisAngle(new THREE.Vector3(0,1,0),THREE.MathUtils.degToRad(-70*phase)).add(pivot);
   assert.ok(plan.positions[i].distanceTo(expected)<1e-7,`${movement} must use the placed camera's basis for singles and groups`);
   assert.equal(plan.fovs[i],plan.fovs[anchor],'Placement and movement must not add automatic zoom');
  }
  const restored=presetPlan(c,{mode:'preset',preset:JSON.parse(JSON.stringify(recipe))},3,0);
  assert.ok(restored.positions.at(-1).distanceTo(plan.positions.at(-1))<1e-9);
 }
}
console.log('Custom front/rear/side/high placements drive push/pull/truck/orbit/pedestal/crane from their actual reference position; single/group, perspective/fisheye, portrait/landscape and saved reload all retain fixed lenses.');

for(const ids of [[2],[2,4,7]])for(const tracking_mode of ['auto','exact'])for(const follow_direction of ['reference','facing']) {
 const c=scene({moving:true,bounce:true,spacing:4});c.setTime(0);
 const p={...presetDefaults(ids,1.1),horizontal:'custom',custom_position:[4,2,-3],behavior:'follow',movement:'track_subjects',tracking_mode,follow_direction};
 const plan=presetPlan(c,{mode:'preset',preset:p},3,0);
 assert.ok(plan.positions[plan.referenceIndex].distanceTo(new THREE.Vector3(...p.custom_position))<1e-7,'Custom Follow must retain its authored reference even when a group selects a tracking cluster');
 assert.ok(plan.fovs.every(f=>f===plan.fovs[0]));
}
console.log('Custom Follow retains the placed reference for Auto/Exact, fixed/facing directions and separated groups.');
