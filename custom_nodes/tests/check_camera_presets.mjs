import assert from "node:assert/strict";
import * as THREE from "../web/vendor/build/three.module.js";
import { applyCamera } from "../web/camera_motion.js";
import { PRESET_DEFAULTS, presetPlan, presetDefaults, effectivePreset, withCameraVisibility } from "../web/camera_presets.js";

function scene({ moving = true, bounce = true, aspect = 16 / 9, spacing = 1.5, turning = false, shoulderTwist = false } = {}) {
  const actors = [2, 4, 7].map((number, i) => {
    const root = new THREE.Group(), mesh = new THREE.Mesh(new THREE.BoxGeometry(.5, 1.8, .3)); mesh.position.y = .9; root.add(mesh);
    const bone = (name, x, y, z = 0) => { const b = new THREE.Bone(); b.name = name; b.position.set(x, y, z); root.add(b); return b; };
    const head = bone('c_head', 0, 1.65), hips = bone('c_spine0', 0, .9);
    const left = bone('l_uparm', -.22, 1.4), right = bone('r_uparm', .22, 1.4);
    bone('l_upleg', .12, .85); bone('r_upleg', -.12, .85);
    bone('l_foot', -.12, .05); bone('r_foot', .12, .05);
    bone('l_wrist', -.4, .85); bone('r_wrist', .4, .85);
    return { number, root, head, hips, left, right, origin: i * spacing };
  });
  const camera = new THREE.PerspectiveCamera(45, aspect, .01, 100);
  return { actors, camera, duration: 3, setTime(t) {
    for (const a of actors) {
      a.root.position.x = a.origin + (moving ? t : 0);
      a.root.rotation.y = turning ? t * Math.PI / 2 + (a.number === 4 ? Math.PI : 0) : 0;
      if (shoulderTwist) { a.left.position.set(0, 1.4, -.22); a.right.position.set(0, 1.4, .22); }
      a.root.position.y = bounce ? .12 * Math.sin(t * 18) : 0;
      a.head.position.y = 1.65 + (bounce ? .04 * Math.sin(t * 31) : 0);
      a.root.updateMatrixWorld(true);
    }
    camera.position.set(0, 2, 5); camera.quaternion.identity(); camera.fov = 45; camera.aspect = aspect; camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  } };
}
const settings = patch => ({ mode: 'preset', preset: { ...structuredClone(PRESET_DEFAULTS), actors: [2], ...patch } });
const capture = scene();
function pose(c, s, t) { c.setTime(t); applyCamera(c, s, t, c.duration); return { position: c.camera.position.toArray(), q: c.camera.quaternion.toArray(), fov: c.camera.fov }; }

// Group bounds must fit the actual camera frustum, including horizontal limits
// in portrait captures. This catches fitting only one actor or only image height.
for (const aspect of [16/9, 9/16]) for (const shot of ['close', 'chest', 'waist', 'cowboy', 'full', 'wide']) {
  const c = scene({ moving: false, bounce: false, aspect }); c.setTime(0);
  const s = settings({ actors: [2, 4, 7], composition: 'group', shot, response: 'direct' });
  const plan = presetPlan(c, s, 3); pose(c, s, 0);
  for (const a of c.actors) {
    const head = a.head.getWorldPosition(new THREE.Vector3()).project(c.camera);
    assert.ok(Math.abs(head.x) < 1 && Math.abs(head.y) < 1, `${shot} ${aspect}: a selected head is outside the group shot`);
    if (shot === 'full' || shot === 'wide') {
      const foot = new THREE.Vector3(a.origin, 0, 0).project(c.camera);
      assert.ok(Math.abs(foot.x) < 1 && Math.abs(foot.y) < 1, 'Full-body group crops feet');
    }
  }
  assert.ok(plan.positions[0].toArray().every(Number.isFinite));
}
// Placement and horizon tilt keep every preset camera finite, including top-down.
for (const vertical of ['top','high','slight_high','eye','slight_low','low','ground']) for (const horizontal of ['front','front_left','front_right','left','right','rear_left','rear_right','back']) {
  const s = settings({ vertical, horizontal, roll: 15, response: 'direct' });
  const result = pose(capture, s, 0);
  assert.ok([...result.position,...result.q,result.fov].every(Number.isFinite));
  for (const point of [new THREE.Vector3(0,0,0),new THREE.Vector3(0,1.75,0)]) {
    point.project(capture.camera);
    assert.ok(Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1, `${vertical}/${horizontal}: full-body framing cropped a subject`);
  }
}
// Lens changes preserve starting framing by moving the camera, not by merely
// widening FOV at a fixed position.
const still = scene({ moving: false, bounce: false });
const wide = pose(still, settings({ lens: 'wide' }), 0), tele = pose(still, settings({ lens: 'telephoto' }), 0);
assert.ok(tele.position[2] > wide.position[2] * 2); assert.ok(tele.fov < wide.fov);
const headOnly = settings({aim:'head',target_offset:[10,5,2],response:'direct'});
assert.deepEqual(pose(still,headOnly,0),pose(still,settings({aim:'head',response:'direct'}),0),'An inactive custom offset changed head targeting');
// Locked means no camera/lens changes even with rapidly moving subjects.
const locked = settings({ aim_behavior: 'fixed', movement: 'fixed' });
assert.deepEqual(pose(capture, locked, 0), pose(capture, locked, 2.83));
// Time-based smoothing is seek/order/render-FPS independent.
const smooth = settings({ movement: 'follow', response: 'smooth', follow_response: 'smooth', dead_zone: 0, max_turn_speed: 20 });
const middle = pose(capture, smooth, 1.37);
pose(capture, smooth, 2.9); pose(capture, smooth, .2);
assert.deepEqual(pose(capture, smooth, 1.37), middle);
const reloaded = JSON.parse(JSON.stringify(smooth)); assert.deepEqual(pose(capture, reloaded, 1.37), middle);
const p = presetPlan(capture, smooth, 3);
for (let i = 1; i < p.positions.length; i++) {
  assert.ok(p.quaternions[i-1].angleTo(p.quaternions[i]) <= THREE.MathUtils.degToRad(20) * p.dt + 1e-7, 'Aim exceeded its turn-speed limit');
  assert.ok(p.positions[i].distanceTo(p.positions[i-1]) <= 4 * p.dt + 1e-7, 'Follow exceeded its speed limit');
}
const direct = presetPlan(capture, settings({ movement: 'follow', response: 'direct', follow_response: 'direct' }), 3);
const movementY = points => points.slice(1).reduce((v, p, i) => v + Math.abs(p.y - points[i].y), 0);
assert.ok(movementY(p.positions) < movementY(direct.positions) * .4, 'Smooth follow still reproduces body bobbing');
assert.ok(Math.abs(p.positions.at(-1).x - direct.positions.at(-1).x) > .2, 'Smooth follow has no gradual catch-up');
const windowed = settings({ movement: 'follow', follow_response: 'direct', start_time: 1, end_time: 2 });
assert.deepEqual(pose(capture, windowed, 0).position, pose(capture, windowed, .9).position);
assert.deepEqual(pose(capture, windowed, 2).position, pose(capture, windowed, 3).position);
// Rotation-only moves never translate; orbit uses a curved path.
const pan = settings({ movement: 'pan', direction: 'left' });
assert.deepEqual(pose(capture, pan, 0).position, pose(capture, pan, 3).position);
assert.notDeepEqual(pose(capture, pan, 0).q, pose(capture, pan, 3).q);
const orbit = settings({ movement: 'orbit', direction: 'right', orbit_degrees: 180, follow_response: 'direct', response: 'direct' });
const arc = presetPlan(still, orbit, 3);
assert.ok(arc.positions[0].distanceTo(arc.positions.at(-1)) > 1);
assert.ok(arc.positions[Math.floor(arc.positions.length/2)].distanceTo(arc.positions[0].clone().lerp(arc.positions.at(-1), .5)) > .5, 'Orbit was replaced by a straight chord');
// Dolly zoom compensates perspective at a stationary target; zoom alone does not travel.
const dz = settings({ movement: 'dolly_zoom', direction: 'in', travel: .5, response: 'direct' });
const d0 = pose(still, dz, 0), d1 = pose(still, dz, 3);
const projectHeight = () => new THREE.Vector3(0, 1.6, 0).project(still.camera).y - new THREE.Vector3(0, .2, 0).project(still.camera).y;
pose(still, dz, 0); const h0 = projectHeight(); pose(still, dz, 3); const h1 = projectHeight();
assert.ok(Math.abs(h0-h1) < .035, 'Dolly zoom did not preserve approximate subject framing'); assert.ok(d1.fov > d0.fov);
const zoom = settings({ movement: 'zoom', end_focal_length: 85 });
assert.deepEqual(pose(still, zoom, 0).position, pose(still, zoom, 3).position);
assert.ok(pose(still, zoom, 3).fov < pose(still, zoom, 0).fov);
for (const movement of ['push','pull','truck','pedestal','crane','lead','alongside']) {
  const direction = ['pedestal','crane'].includes(movement) ? 'up' : 'left';
  const s = settings({ movement, direction, travel: .3 });
  assert.notDeepEqual(pose(capture,s,0).position,pose(capture,s,3).position,`${movement} did not move`);
}
const ots = settings({ composition: 'ots', foreground_actor: 4 });
assert.ok(pose(still, ots, 0).position.every(Number.isFinite));
assert.throws(()=>pose(still,settings({ composition: 'ots', foreground_actor: 2 }),0), /different foreground/);
const pov2 = pose(still, settings({ composition: 'pov', actors: [2] }), 0);
const pov7 = pose(still, settings({ composition: 'pov', actors: [7] }), 0);
assert.ok(Math.abs(pov7.position[0]-pov2.position[0]) > 2);
assert.throws(()=>pose(still,settings({ start_time: 2, end_time: 1 }),0),/end must/);
const longPush=presetPlan(still,settings({movement:'push',travel:100}),3);assert.ok(Math.abs(longPush.positions[0].distanceTo(longPush.positions.at(-1))-100)<1e-8);
assert.throws(()=>withCameraVisibility(still, settings({composition:'pov'}), ()=>{assert.equal(still.actors[0].root.visible,false);throw Error('test restoration');}),/test restoration/);
assert.equal(still.actors[0].root.visible,true,'POV hid the viewpoint actor from later Scene rendering');
console.log('Preset frustum fitting (single/group, portrait/landscape), lens reframing, locked shots, deterministic smoothing/reverse seeks/JSON reload, speed limits, follow timing, every travel family, curved orbit, OTS/POV and dolly zoom passed.');

// A reference is an exact pose, independent of the 60 Hz table and render FPS.
// Mixed group facings are never averaged; one explicitly selected actor wins.
const referenceTime = 1.37123;
const turned = scene({ moving: true, bounce: false, turning: true, aspect: 9 / 16 });
const frontSettings = settings({ composition: 'group', actors: [2,4,7], reference_time: referenceTime,
  reference_actor: 4, reference_basis: 'pelvis', response: 'smooth', follow_response: 'smooth' });
const frontPlan = presetPlan(turned, frontSettings, 3);
assert.equal(frontPlan.times[frontPlan.referenceIndex], referenceTime);
const refIndex = frontPlan.referenceIndex;
const expectedFront = new THREE.Vector3(0,0,1).applyAxisAngle(new THREE.Vector3(0,1,0), referenceTime * Math.PI / 2 + Math.PI);
assert.ok(frontPlan.initialFront.distanceTo(expectedFront) < 1e-9, 'Reference facing was snapped or taken from the wrong actor');
const referenceOffset = frontPlan.positions[refIndex].clone().sub(frontPlan.targets[refIndex]).setY(0).normalize();
assert.ok(referenceOffset.distanceTo(expectedFront) < 1e-9, 'Front placement does not use the saved reference actor');
pose(turned, frontSettings, referenceTime);
for (const actor of turned.actors) {
  for (const point of [actor.head.getWorldPosition(new THREE.Vector3()), new THREE.Vector3(actor.origin + referenceTime,0,0)]) {
    point.project(turned.camera);
    assert.ok(Math.abs(point.x) < 1 && Math.abs(point.y) < 1, 'Reference group framing crops a selected actor');
  }
}
const switched = presetPlan(turned, { ...frontSettings, preset: {...frontSettings.preset, reference_actor:2} },3);
assert.ok(switched.initialFront.dot(frontPlan.initialFront) < -.999999, 'Changing reference actor did not reverse mixed-group facing');
const twisted = scene({ moving:false, bounce:false, shoulderTwist:true });
const bodyRef = settings({reference_basis:'pelvis'}), chestRef = settings({reference_basis:'chest'});
const bodyFront = presetPlan(twisted,bodyRef,3).initialFront, chestFront = presetPlan(twisted,chestRef,3).initialFront;
assert.ok(Math.abs(bodyFront.dot(chestFront)) < 1e-9, 'Body facing still followed the shoulders');
const legacy = effectivePreset({actors:[2]});
assert.deepEqual([legacy.reference_time,legacy.reference_actor,legacy.reference_basis],[0,2,'legacy_chest']);
const fresh = presetDefaults([4,7],referenceTime);
assert.deepEqual([fresh.reference_time,fresh.reference_actor,fresh.reference_basis],[referenceTime,4,'chest']);
// Explicit frame-zero chest values leave old saved recipe poses unchanged.
assert.deepEqual(pose(twisted,settings({}),1.2),pose(twisted,settings({reference_time:0,reference_actor:2,reference_basis:'legacy_chest'}),1.2));
// Smooth movement and aim pass through the reference, with speed bounds in
// both time directions, and restore identically after reverse seeks/reload.
const followsRef = {...frontSettings,preset:{...frontSettings.preset,movement:'follow',max_turn_speed:20,max_follow_speed:2,dead_zone:0}};
const refFollowPlan = presetPlan(turned,followsRef,3);
const followPose = pose(turned,followsRef,referenceTime);
const directRef = {...followsRef,preset:{...followsRef.preset,response:'direct',follow_response:'direct'}};
assert.deepEqual(pose(turned,directRef,referenceTime),followPose,'Smoothing shifted the reference pose');
for(let i=1;i<refFollowPlan.times.length;i++) {
  const dt=refFollowPlan.times[i]-refFollowPlan.times[i-1];
  assert.ok(refFollowPlan.quaternions[i-1].angleTo(refFollowPlan.quaternions[i]) <= THREE.MathUtils.degToRad(20)*dt+1e-7);
  assert.ok(refFollowPlan.positions[i-1].distanceTo(refFollowPlan.positions[i]) <= 2*dt+1e-7);
}
pose(turned,followsRef,3);pose(turned,followsRef,0);
assert.deepEqual(pose(turned,JSON.parse(JSON.stringify(followsRef)),referenceTime),followPose);
const fixedRef = {...frontSettings,preset:{...frontSettings.preset,aim_behavior:'fixed'}};
assert.deepEqual(pose(turned,fixedRef,0),pose(turned,fixedRef,3),'Playback reanchored a locked reference shot');
for (const [movement,direction] of [['orbit','right'],['pan','left'],['tilt','up'],['truck','left'],['pedestal','up'],['crane','up'],['push','left'],['pull','left'],['dolly_zoom','out']]) {
  const reference = settings({reference_time:referenceTime,reference_basis:'pelvis',response:'direct',follow_response:'direct'});
  const atReference = pose(turned,reference,referenceTime);
  const withMove = {...reference,preset:{...reference.preset,movement,direction,travel:.2}};
  const movedPose=pose(turned,withMove,movement==='push'?3:movement==='pull'?0:referenceTime);
  for(let j=0;j<3;j++) assert.ok(Math.abs(movedPose.position[j]-atReference.position[j])<1e-9,`${movement} missed reference placement`);
  if(!['push','pull'].includes(movement))assert.ok(new THREE.Quaternion().fromArray(movedPose.q).angleTo(new THREE.Quaternion().fromArray(atReference.q))<1e-7,`${movement} missed reference direction`);
}
const zoomRef=settings({reference_time:referenceTime,movement:'zoom',end_focal_length:85,response:'direct'});
pose(turned,zoomRef,referenceTime);
for(const point of [turned.actors[0].head.getWorldPosition(new THREE.Vector3()),new THREE.Vector3(referenceTime,0,0)]) {
  point.project(turned.camera); assert.ok(Math.abs(point.x)<1&&Math.abs(point.y)<1,'Zoom used the wrong reference lens to fit framing');
}
for(const patch of [{reference_time:-1},{reference_time:4},{reference_time:NaN},{reference_actor:7,actors:[2]},{reference_basis:'invalid'}])
  assert.throws(()=>pose(turned,settings(patch),0),/reference|facing/i);
console.log('Exact reference poses, independent group facing, body/chest basis, legacy migration, anchored travel/smoothing, speed limits, zoom fitting and seek persistence passed.');

// Anatomical left/right: an actor facing +Z has their left on world +X.
const anatomical=scene({moving:false,bounce:false});
for (const [horizontal, expected] of [['front',[0,0,1]],['back',[0,0,-1]],['left',[1,0,0]],['right',[-1,0,0]]]) {
  const plan=presetPlan(anatomical,settings({reference_basis:'pelvis',horizontal}),3);
  const offset=plan.positions[0].clone().sub(plan.targets[0]).setY(0).normalize();
  assert.ok(offset.distanceTo(new THREE.Vector3().fromArray(expected))<1e-9,`${horizontal} uses the wrong anatomical side`);
}
console.log('Anatomical front/back and actor-left/right bearings passed.');

const smoothWindow = settings({reference_time:referenceTime,reference_basis:'pelvis',movement:'follow',start_time:1,end_time:2});
assert.deepEqual(pose(capture,smoothWindow,0).position,pose(capture,smoothWindow,.9).position,'Reference filtering moved before the travel window');
assert.deepEqual(pose(capture,smoothWindow,2.1).position,pose(capture,smoothWindow,3).position,'Reference filtering moved after the travel window');
const anatomicChest=scene({moving:false,bounce:false});
for(const actor of anatomicChest.actors) { actor.left.position.x=.22;actor.right.position.x=-.22; }
const chestPlan=presetPlan(anatomicChest,settings({reference_basis:'chest'}),3);
assert.ok(chestPlan.initialFront.distanceTo(new THREE.Vector3(0,0,1))<1e-9,'Chest facing is anatomically reversed');
const fallback=scene({moving:false,bounce:false});
for(const actor of fallback.actors) {
  actor.left.position.x=.22;actor.right.position.x=-.22;
  for(const bone of [...actor.root.children]) if(['l_upleg','r_upleg'].includes(bone.name))actor.root.remove(bone);
}
const fallbackPlan=presetPlan(fallback,settings({reference_basis:'pelvis'}),3);
assert.ok(fallbackPlan.initialFront.distanceTo(new THREE.Vector3(0,0,1))<1e-9);
assert.ok(fallbackPlan.warnings.some(text=>text.startsWith('Pelvis landmarks')));
console.log('Reference follow-window holds, anatomical chest facing and reported shoulder fallback passed.');
