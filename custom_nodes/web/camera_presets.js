import {movementProgress as progress} from './movement_timing.js?v=20261028-delivery';
import {isAimMarker,markerState,markerPoint} from './aim_marker.js?v=20261028-delivery';
import {actionFeedback} from './action_follow.js';
import * as THREE from "./vendor/build/three.module.js";
import { cameraAspect } from "./camera_format.js";
import { trackMajority } from "./group_tracking.js";
import { hasFocus, regionFocus, focusRegion, screenPlacement, composedOrientation, fitComposition } from "./camera_composition.js";

import { isFisheye, fisheyeVerticalFOV, levelElevation, perspectiveVerticalFOV } from "./lens_projection.js";

import { TRACKING_DEFAULTS,trackingPlan,steadyTargets,trackingPlacement } from "./aim_tracking.js";

export const CHOICES = {
  composition: { single: "Single actor", two: "Two actors", group: "Group", ots: "Over the shoulder", pov: "Actor POV", detail: "Body detail" },
  shot: { extreme_close: "Extreme close-up · eyes", close: "Close-up · head", chest: "Medium close-up · chest up", waist: "Medium · waist up", cowboy: "Cowboy · mid-thigh up", medium_full: "Medium full · below knees", full: "Full body", wide: "Wide", extreme_wide: "Extreme wide" },
  aim: { auto: "Auto · match shot size", head: "Head / face", chest: "Chest", hips: "Hips", body: "Whole-body center", left_hand: "Left hand", right_hand: "Right hand", custom: "Custom offset from body" },
  horizontal: { front: "Front", front_left: "Front three-quarter · actor's left", front_right: "Front three-quarter · actor's right", left: "Profile · actor's left", right: "Profile · actor's right", rear_left: "Rear three-quarter · actor's left", rear_right: "Rear three-quarter · actor's right", back: "Back", custom: "Custom · place camera in scene" },
  vertical: { auto: "Auto · level with framing", top: "Top-down", high: "High angle", slight_high: "Slight high angle", eye: "Eye level", slight_low: "Slight low angle", low: "Low angle", ground: "Ground level" },
  lens: { fisheye: "Fisheye · curved wide view", ultra_wide: "Ultra wide · 18 mm", wide: "Wide · 24 mm", natural: "Natural · 35 mm", portrait: "Portrait · 50 mm", telephoto: "Telephoto · 85 mm", custom: "Custom focal length" },
  movement: { fixed: "Fixed position", pan: "Pan", tilt: "Tilt", push: "Push in", pull: "Pull out", truck: "Truck sideways", pedestal: "Pedestal vertically", orbit: "Orbit", follow: "Follow behind", lead: "Lead from ahead", alongside: "Follow alongside", crane: "Crane", zoom: "Zoom", dolly_zoom: "Dolly zoom", track_subjects: "Follow subjects" },
  pacing: { constant: "Constant", ease_in: "Ease in", ease_out: "Ease out", ease_in_out: "Ease in / out" },
  aim_behavior: { target: "Fixed scene target · no tracking", fixed: "Fixed direction · no tracking", track: "Track selected actors" },
  framing_mode: { reference: "Fit reference frame", whole_clip: "Keep actors in frame · whole clip" },
  path_anchor: { fixed: "Fixed scene center · clean arc", follow: "Follow selected actors" },
  response: { direct: "Direct", smooth: "Smooth" },
};
export const AZIMUTH = { front: 0, front_left: -45, front_right: 45, left: -90, right: 90, rear_left: -135, rear_right: 135, back: 180 };
const ELEVATION = { top: 89.9, high: 40, slight_high: 15, eye: 0, slight_low: -10, low: -25, ground: -65 };
const LENSES = { ultra_wide: 18, wide: 24, natural: 35, portrait: 50, telephoto: 85 };
export const PRESET_DEFAULTS = {
  ...TRACKING_DEFAULTS,
  target_mode:'actors',custom_target:null,
  custom_position: null, camera_transition: null,
  lens_calibration: "legacy", fisheye_fov: 160,
  focus_point: "legacy", frame_reference: "auto", frame_x: .5, frame_y: 1/3, framing_scale: 1, focus_fill: 0,
  framing_version: 1, behavior: "legacy", selection: "legacy", follow_direction: "reference", position_offset: [0, 0, 0],
  framing_mode: "reference", path_anchor: "follow",
  reference_time: 0, reference_actor: null, reference_basis: "legacy_chest",
  composition: "single", actors: [], foreground_actor: null, shot: "full", aim: "auto", horizontal: "front", vertical: "eye",
  lens: "natural", focal_length: 35, sensor_height: 24, roll: 0, padding: 1.12, bearing_offset: 0, target_offset: [0, 0, 0],
  movement: "fixed", direction: "left", travel: 1, orbit_degrees: 90, rotation_degrees: 20, end_focal_length: 85, crane_forward: 1,
  start_time: 0, end_time: 0, pacing: "ease_in_out", aim_behavior: "track", response: "smooth", responsiveness: 0.35,
  follow_response: "smooth", follow_responsiveness: 0.35, max_turn_speed: 35, dead_zone: 1.5, max_follow_speed: 4,
  shoulder_side: "right", shoulder_offset: 0.3, shoulder_back: 0.6,
};
export const forcedAim = p => p.composition === "pov";
export const fixedBearing = p => ["ots", "pov"].includes(p.composition) || ["follow", "lead", "alongside"].includes(p.movement);
export const subjectTravel = p => p.composition === "pov" || (["track_subjects", "follow", "lead", "alongside"].includes(p.movement) || p.movement === "orbit" && !isAimMarker(p));
export function presetDefaults(actors, referenceTime = 0) {
  return { ...structuredClone(PRESET_DEFAULTS), lens_calibration:"full_frame", focus_point: "auto", vertical: "auto", framing_version: 2, padding: 1.06, behavior: "static", selection: actors.length > 1 ? "all" : "single", composition: actors.length > 1 ? "group" : "single", actors: actors.slice(),
    reference_time: referenceTime, reference_actor: actors[0], reference_basis: "chest", aim_behavior: "fixed", path_anchor: "fixed" };
}
export function effectivePreset(value) {
  const p = { ...structuredClone(PRESET_DEFAULTS), ...value };
  if(isAimMarker(p)){markerPoint(p);Object.assign(p,{aim_source:'reference',tracking_mode:'exact',aim_behavior:'target',path_anchor:'fixed'});if(p.behavior==='follow'||['track_subjects','follow','lead','alongside'].includes(p.movement))Object.assign(p,{behavior:'static',movement:'fixed'});}
  // Missing fields preserve recipes saved before reference controls existed.
  p.reference_actor ??= p.actors[0];
  p.framing_mode = "reference"; // Read old recipes without restoring retired whole-clip pullback.
  if (hasFocus(p)) { p.framing_version = 2; p.aim = "auto"; }
  if (p.behavior === "static") { p.movement = "fixed"; p.aim_behavior = "fixed"; }
  if (p.behavior === "follow" && p.composition !== "pov") { p.movement = "track_subjects"; p.aim_behavior = "track"; p.framing_mode = "reference"; }
  if (p.composition === "detail" && !hasFocus(p)) {
    if (!["close", "extreme_close"].includes(p.shot)) p.shot = "close";
    if (!["auto", "head", "left_hand", "right_hand"].includes(p.aim)) p.aim = "head";
  }
  if (p.movement === "zoom") p.direction = p.end_focal_length >= (LENSES[p.lens] ?? p.focal_length) ? "in" : "out";
  if (p.composition === "pov") { p.movement = "fixed"; p.aim_behavior = "track"; }
  if (forcedAim(p)) p.aim_behavior = "track";
  if (["pov", "ots"].includes(p.composition)) p.framing_mode = "reference";
  if (["pan", "tilt"].includes(p.movement)) p.aim_behavior = "fixed";
  if(p.movement==='orbit')p.path_anchor=isAimMarker(p)?'fixed':'follow';
  return p;
}
const radians = THREE.MathUtils.degToRad;
const up = new THREE.Vector3(0, 1, 0);
const rigCache = new WeakMap(), samplesCache = new WeakMap(), planCache = new WeakMap();
const clamp = THREE.MathUtils.clamp;
const vec = a => new THREE.Vector3().fromArray(a);

function rig(actor) {
  if (rigCache.has(actor)) return rigCache.get(actor);
  const bones = [], named = new Map();
  actor.root.traverse(o => { if (o.isBone) { bones.push(o); named.set(o.name.toLowerCase().replace(/^.*:/, ""), o); } });
  // Prefer bones used by the rendered skeleton, avoiding duplicate helper rigs.
  actor.root.traverse(o => { if(o.isSkinnedMesh) for(const bone of o.skeleton.bones) named.set(bone.name.toLowerCase().replace(/^.*:/, ""),bone); });
  const canonical=n=>n.toLowerCase().replace(/^.*:/,"").replace(/[^a-z0-9]/g,"");
  const aliases=new Map([...named].map(([name,bone])=>[canonical(name),bone]));
  const find = (...names) => names.map(n => named.get(n) ?? aliases.get(canonical(n))).find(Boolean);
  const head = find("c_head", "head"), hips = find("c_spine0", "hips", "pelvis", "root_1");
  const left = find("l_uparm", "leftarm", "leftshoulder"), right = find("r_uparm", "rightarm", "rightshoulder");
  const bounds = new THREE.Box3().setFromObject(actor.root);
  const point = o => o?.getWorldPosition(new THREE.Vector3());
  const chain = ["c_spine0", "c_spine1", "c_spine2", "c_spine3", "c_neck", "c_head"].map(n => find(n)).filter(Boolean);
  const leg = [find("l_upleg"), find("l_lowleg"), find("l_foot")].filter(Boolean);
  const length = list => list.slice(1).reduce((sum, b, i) => sum + point(b).distanceTo(point(list[i])), 0);
  const measured = length(chain) + length(leg) + 0.2;
  const height = clamp(leg.length >= 3 && chain.length >= 2 && measured > 0.8 ? measured : bounds.getSize(new THREE.Vector3()).y || 1.8, 0.3, 5);
  const eyes = [find("l_eye", "lefteye"), find("r_eye", "righteye")].filter(Boolean);
  const result = { bones, head, neck: find("c_neck", "neck"), hips, left, right, height, eyes,
    chestBone: find("c_spine2", "spine2", "chest"),
    leftKnee: find("l_lowleg", "leftleg", "leftshin"), rightKnee: find("r_lowleg", "rightleg", "rightshin"),
    leftFoot: find("l_foot", "leftfoot"), rightFoot: find("r_foot", "rightfoot"),
    leftHip: find("l_upleg", "leftupleg", "leftthigh"), rightHip: find("r_upleg", "rightupleg", "rightthigh"),
    leftHand: find("l_wrist", "lefthand", "left_wrist", "hand_l", "wrist_l"), rightHand: find("r_wrist", "righthand", "right_wrist", "hand_r", "wrist_r"),
    elbows: [find("l_lowarm", "leftforearm"), find("r_lowarm", "rightforearm")],
    fingers: [/^(l_|left)/, /^(r_|right)/].map(side => bones.filter(b => side.test(b.name.toLowerCase().replace(/^.*:/,"")) && /thumb|index|middle|ring|pinky|little|finger/i.test(b.name))),
    toes: [/^(l_|left)/, /^(r_|right)/].map(side => bones.filter(b => side.test(b.name.toLowerCase().replace(/^.*:/,"")) && /toe|ball/i.test(b.name))),
    fallback: actor.root.worldToLocal(bounds.getCenter(new THREE.Vector3())) };
  rigCache.set(actor, result);
  return result;
}
function snapshot(actor) {
  const r = rig(actor), point = o => o.getWorldPosition(new THREE.Vector3());
  const body = r.hips ? point(r.hips) : actor.root.localToWorld(r.fallback.clone());
  const head = r.head ? point(r.head) : body.clone().addScaledVector(up, r.height * 0.4);
  const forward = r.left && r.right ? point(r.right).sub(point(r.left)).cross(up).normalize()
    : new THREE.Vector3(0, 0, 1).applyQuaternion(actor.root.getWorldQuaternion(new THREE.Quaternion()));
  forward.y = 0; if (forward.lengthSq() < 1e-8) forward.set(0, 0, 1); forward.normalize();
  // Hip landmarks avoid arm gestures changing the body's front. If unavailable,
  // use the existing shoulder bearing rather than guessing a rig-local axis.
  const chest = r.left && r.right ? forward.clone().negate() : forward.clone();
  const pelvis = r.leftHip && r.rightHip ? point(r.leftHip).sub(point(r.rightHip)).cross(up) : chest.clone();
  pelvis.y = 0; const pelvisAvailable = !!(r.leftHip && r.rightHip) && pelvis.lengthSq() >= 1e-8;
  if (!pelvisAvailable) pelvis.copy(chest); pelvis.normalize();
  const points = r.bones.length ? r.bones.filter(b => !/twist|tongue|jaw|teeth|eye|finger|thumb|pinky|ring|index|middle/i.test(b.name)).map(point)
    : [body.clone().add(new THREE.Vector3(-r.height * .2, -r.height * .5, -r.height * .12)), body.clone().add(new THREE.Vector3(r.height * .2, r.height * .5, r.height * .12))];
  const bounds = new THREE.Box3().setFromPoints(points).expandByScalar(r.height * 0.055);
  bounds.expandByPoint(head.clone().addScaledVector(up, r.height * .12));
  const eyes = r.eyes.length ? r.eyes.map(point).reduce((sum, v) => sum.add(v), new THREE.Vector3()).multiplyScalar(1 / r.eyes.length)
    : head.clone().addScaledVector(up, r.height * .06);
  const eyeRight = r.eyes.length === 2 ? point(r.eyes[1]).sub(point(r.eyes[0])).normalize()
    : new THREE.Vector3(1, 0, 0).applyQuaternion(actor.root.getWorldQuaternion(new THREE.Quaternion()));
  // Bone-axis conventions differ across rigs (MHR head-up is local X). Pick
  // the head axis closest to neck→head, then make it perpendicular to the eyes.
  const neckToHead = r.neck ? head.clone().sub(point(r.neck)).normalize() : up.clone();
  const headRotation = r.head?.getWorldQuaternion(new THREE.Quaternion()) ?? actor.root.getWorldQuaternion(new THREE.Quaternion());
  const axes = [new THREE.Vector3(1,0,0), up.clone(), new THREE.Vector3(0,0,1)].map(axis => axis.applyQuaternion(headRotation));
  let faceUp = axes.reduce((best, axis) => Math.abs(axis.dot(neckToHead)) > Math.abs(best.dot(neckToHead)) ? axis : best).clone();
  if (faceUp.dot(neckToHead) < 0) faceUp.negate();
  faceUp.addScaledVector(eyeRight, -faceUp.dot(eyeRight)).normalize();
  if (faceUp.lengthSq() < .1) faceUp.copy(up);
  const faceForward = eyeRight.clone().cross(faceUp).normalize();
  if (faceForward.dot(eyes.clone().sub(head)) < 0) faceForward.negate();
  const eyeSpacing = r.eyes.length === 2 ? clamp(point(r.eyes[0]).distanceTo(point(r.eyes[1])), r.height * .02, r.height * .07) : r.height * .037;
  const eyeCenter = r.eyes.length ? eyes.clone() : head.clone().addScaledVector(faceUp, eyeSpacing * .7).addScaledVector(faceForward, eyeSpacing);
  const anatomy = { eyeCenter, eyeRight, faceUp, faceForward, eyeSpacing,
    crown: eyeCenter.clone().addScaledVector(faceUp, eyeSpacing * 2.0).addScaledVector(faceForward, -eyeSpacing * .4),
    chestPoint: r.chestBone ? point(r.chestBone) : body.clone().lerp(head, .65),
    shoulders: [r.left ? point(r.left) : head.clone().addScaledVector(eyeRight, -r.height*.12), r.right ? point(r.right) : head.clone().addScaledVector(eyeRight, r.height*.12)],
    hips: [r.leftHip ? point(r.leftHip) : body.clone().addScaledVector(eyeRight, -r.height*.08), r.rightHip ? point(r.rightHip) : body.clone().addScaledVector(eyeRight, r.height*.08)],
    knees: [r.leftKnee ? point(r.leftKnee) : body.clone().addScaledVector(up, -r.height*.25), r.rightKnee ? point(r.rightKnee) : body.clone().addScaledVector(up, -r.height*.25)],
    feet: [r.leftFoot ? point(r.leftFoot) : body.clone().addScaledVector(up, -r.height*.5), r.rightFoot ? point(r.rightFoot) : body.clone().addScaledVector(up, -r.height*.5)] };
  anatomy.handJoints=[Boolean(r.leftHand),Boolean(r.rightHand)];
  anatomy.handPoints = [r.leftHand,r.rightHand].map((hand,i) => {
    const wrist = hand ? point(hand) : r.fingers[i].length ? point(r.fingers[i][0]) : body.clone();
    if (r.fingers[i].length) return [wrist,...r.fingers[i].map(point)];
    const direction = r.elbows[i] ? wrist.clone().sub(point(r.elbows[i])).normalize() : up.clone().negate();
    return [wrist,wrist.clone().addScaledVector(direction,r.height*.10)];
  });
  anatomy.footPoints = [r.leftFoot,r.rightFoot].map((foot,i)=>[foot ? point(foot) : anatomy.feet[i],...r.toes[i].map(point)]);
  anatomy.missingHandDetail = r.fingers.some((fingers,i)=>!fingers.length || ![r.leftHand,r.rightHand][i]);
  return { anatomy, body, head, eyes, forward, chest, pelvis, pelvisAvailable, bounds, points, height: r.height,
    left_hand: r.leftHand ? point(r.leftHand) : body.clone(), right_hand: r.rightHand ? point(r.rightHand) : body.clone() };
}
export function actorRegistration(actor) {
  const state = snapshot(actor);
  return { position: state.body, forward: state.pelvis };
}

function samples(capture, duration, restoreTime, hz = 60) {
  let cached = samplesCache.get(capture);
  if (cached?.duration === duration && cached.hz === hz) return cached;
  const steps = Math.max(1, Math.ceil(duration * hz));
  const rows = [], times = [];
  try {
    for (let i = 0; i <= steps; i++) {
      const time = hz === 120 ? Math.min(duration, i / hz) : duration * i / steps;
      times.push(time); capture.setTime(time);
      rows.push(new Map(capture.actors.map(actor => [actor.number, snapshot(actor)])));
    }
  } finally { capture.setTime(restoreTime); }
  cached = { duration, rows, times, hz, dt: hz === 120 ? 1 / hz : duration / steps };
  samplesCache.set(capture, cached);
  return cached;
}
function faceRegion(actor, extreme) {
  const a = actor.anatomy, spacing = a.eyeSpacing;
  const center = a.eyeCenter.clone().addScaledVector(a.faceUp, spacing * (extreme ? .12 : .05));
  const halfWidth = spacing * (extreme ? 1.05 : 1.45), halfHeight = spacing * (extreme ? .38 : 2.05);
  const points = [];
  // A thin facial plane avoids fitting an arbitrary, oversized head-bone cube.
  for (const x of [-1,1]) for (const y of [-1,1]) for (const z of [-1,1]) points.push(center.clone()
    .addScaledVector(a.eyeRight, x*halfWidth).addScaledVector(a.faceUp, y*halfHeight).addScaledVector(a.faceForward, z*spacing*.12));
  return Object.assign(new THREE.Box3().setFromPoints(points), { framingPoints: points });
}
function anatomicalRegion(actor, p) {
  const a = actor.anatomy;
  if (p.composition === "detail" && ["left_hand", "right_hand"].includes(p.aim)) {
    const size = actor.height * (p.shot === "extreme_close" ? .05 : .10);
    return new THREE.Box3().setFromCenterAndSize(actor[p.aim], new THREE.Vector3(size,size,size));
  }
  if (["close", "extreme_close"].includes(p.shot)) return faceRegion(actor, p.shot === "extreme_close");
  if (["full", "wide", "extreme_wide"].includes(p.shot)) return new THREE.Box3().setFromPoints([...actor.points,a.crown]).expandByScalar(actor.height*.02);
  const box = faceRegion(actor, false);
  const waist = actor.body.clone().lerp(a.chestPoint, .2);
  const lower = p.shot === "chest" ? [a.chestPoint]
    : p.shot === "waist" ? [waist]
    : p.shot === "cowboy" ? a.hips.map((hip,i) => hip.clone().lerp(a.knees[i], .5))
    : a.knees.map((knee,i) => knee.clone().lerp(a.feet[i], .18));
  // Torso framing intentionally crops gesturing hands rather than backing away
  // until every raised or outstretched arm fits in a nominal chest-up shot.
  [...a.shoulders,...a.hips,...lower].forEach(point => { if (point.y >= Math.min(...lower.map(v=>v.y))) { box.expandByPoint(point); box.framingPoints.push(point); } });
  return box.expandByScalar(actor.height*.01);
}
function region(actor, p) {
  if (p.framing_version === 2) return anatomicalRegion(actor, p);
  if (p.composition === "detail" || ["close", "extreme_close"].includes(p.shot)) {
    const hand = ["left_hand", "right_hand"].includes(p.aim);
    const center = hand ? actor[p.aim].clone() : actor.head.clone().addScaledVector(up, actor.height * .035);
    const radius = actor.height * (p.shot === "extreme_close" ? .055 : hand ? .075 : .12);
    return new THREE.Box3().setFromCenterAndSize(center, new THREE.Vector3(radius * 1.65, radius * 2, radius * 1.6));
  }
  const box = actor.bounds.clone();
  const coverage = { chest: .32, waist: .52, cowboy: .78 }[p.shot];
  if (coverage) {
    const cutoff = Math.max(box.min.y, box.max.y - actor.height * coverage);
    const upper = actor.points.filter(point => point.y >= cutoff);
    if (upper.length) box.setFromPoints(upper).expandByScalar(actor.height * .055);
    box.max.y = actor.bounds.max.y; box.min.y = cutoff;
  }
  return box;
}
const mean = vectors => vectors.reduce((sum, v) => sum.add(v), new THREE.Vector3()).multiplyScalar(1 / vectors.length);
const facing = (actor, p) => actor[p.reference_basis === "legacy_chest" ? "forward" : p.reference_basis];
function subjects(row, p) {
  if(isAimMarker(p))return markerState(p);
  const actors = p.actors.map(id => row.get(id));
  if (!actors.length || actors.some(a => !a)) throw new Error("Select actors available in this capture.");
  const focused = hasFocus(p), placement = screenPlacement(p);
  const regions = actors.map(a => {
    if (focused && p.focus_point !== "auto") return focusRegion(a,p).bounds;
    const bounds = region(a,p);
    if (focused && p.framing_scale !== 1) {
      const center = bounds.getCenter(new THREE.Vector3());
      bounds.min.sub(center).multiplyScalar(p.framing_scale).add(center);
      bounds.max.sub(center).multiplyScalar(p.framing_scale).add(center);
      if(bounds.framingPoints) bounds.framingPoints=bounds.framingPoints.map(point=>point.clone().sub(center).multiplyScalar(p.framing_scale).add(center));
    }
    return bounds;
  });
  const bounds = new THREE.Box3(); regions.forEach(r => bounds.union(r));
  if (regions.length === 1 && regions[0].framingPoints) bounds.framingPoints = regions[0].framingPoints;
  const body = mean(actors.map(a => a.body)), head = mean(actors.map(a => a.head));
  let target = bounds.getCenter(new THREE.Vector3());
  if (!focused && p.aim === "head") target = p.framing_version === 2 ? mean(actors.map(a => a.anatomy.eyeCenter.clone().addScaledVector(a.anatomy.faceUp, -a.anatomy.eyeSpacing*.15))) : head;
  if (!focused && (p.aim === "hips" || p.aim === "custom")) target = body;
  if (!focused && p.aim === "chest") target = p.framing_version === 2 ? mean(actors.map(a=>a.anatomy.chestPoint)) : body.clone().lerp(head, .65);
  if (!focused && p.aim === "body") target = mean(actors.map(a => a.bounds.getCenter(new THREE.Vector3())));
  if (!focused && ["left_hand", "right_hand"].includes(p.aim)) target = mean(actors.map(a => a[p.aim]));
  const focusRegions=focused?actors.map(actor=>regionFocus(actor,p.focus_point)):[];
  const focusBounds=new THREE.Box3();for(const region of focusRegions)focusBounds.union(new THREE.Box3().setFromPoints(region.points).expandByScalar(region.radius));
  const focusPoints=focusRegions.length?[-1,1].flatMap(x=>[-1,1].flatMap(y=>[-1,1].map(z=>new THREE.Vector3(x<0?focusBounds.min.x:focusBounds.max.x,y<0?focusBounds.min.y:focusBounds.max.y,z<0?focusBounds.min.z:focusBounds.max.z)))):[];
  const focusTargets=focused?actors.flatMap(actor=>{
    const key=p.focus_point,parts=key==='hands'?['left_hand','right_hand']:key==='feet'?['left_foot','right_foot']:[key];
    return parts.map(part=>{const r=regionFocus(actor,part);const box=new THREE.Box3().setFromPoints(r.points).expandByScalar(r.radius);return {point:r.point.clone(),radius:r.radius,halfSize:box.getSize(new THREE.Vector3()).multiplyScalar(.5)};});
  }):[];
  if(p.aim_source==='live')focusPoints.splice(0,focusPoints.length,...focusTargets.flatMap(r=>[-1,1].flatMap(x=>[-1,1].flatMap(y=>[-1,1].map(z=>r.point.clone().add(new THREE.Vector3(x*r.halfSize.x,y*r.halfSize.y,z*r.halfSize.z)))))));
  const focus = focused ? (p.aim_source==='live'?mean(focusTargets.map(r=>r.point)):mean(actors.map(actor=>regionFocus(actor,p.focus_point).point))) : target.clone();
  if (focused && (placement || p.framing_motion)) target = focus.clone();
  target = target.clone();
  if (!focused && p.aim === "custom") target.add(vec(p.target_offset));
  return { bounds, target, focus, focusPoints, focusTargets, body, head, eyes: mean(actors.map(a=>a.anatomy.eyeCenter)), height: Math.max(...actors.map(a => a.height)), forward: facing(row.get(p.reference_actor), p) };
}
function orientation(position, target, roll = 0) {
  if (position.distanceToSquared(target) < 1e-10) throw new Error("Camera and target overlap. Adjust the shot or travel distance.");
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(position, target, up));
  return q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), radians(roll)));
}
function fit(bounds, target, normal, fov, aspect, roll, padding, clearance = .05) {
  const q = orientation(target.clone().add(normal), target, roll);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q), vertical = up.clone().applyQuaternion(q);
  const tanV = Math.tan(radians(fov) / 2), tanH = tanV * aspect;
  let distance = clearance < .05 ? .08 : .15;
  const corners = [];
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) corners.push(new THREE.Vector3(x,y,z));
  // Use oriented facial / anatomical landmarks for tight crops. A world-axis
  // box invents extreme corners when a head is tilted and makes the shot loose.
  const points = aspect === Infinity && bounds.framingPoints ? bounds.framingPoints : corners;
  for (const corner of points) {
    const point = corner.clone().sub(target);
    distance = Math.max(distance, point.dot(normal) + padding * Math.max(Math.abs(point.dot(right)) / tanH, Math.abs(point.dot(vertical)) / tanV) + clearance);
  }
  return distance;
}
// Filters are seeded at the reference pose and evaluated in both time directions.
// They are deterministic when seeking, and pass through the chosen reference pose.
function anchoredFilter(values, times, anchor, step) {
  const out = []; out[anchor] = values[anchor].clone();
  for (const direction of [1, -1]) for (let i = anchor + direction; i >= 0 && i < values.length; i += direction) {
    const previous = i - direction;
    out[i] = step(out[previous], values[i], Math.abs(times[i] - times[previous]));
  }
  return out;
}
function smoothPoints(points, p, times, anchor) {
  const tau = .12 + (1 - p.follow_responsiveness) * 1.8;
  return anchoredFilter(points, times, anchor, (previous, desired, dt) => {
    const delta = desired.clone().sub(previous).multiplyScalar(1 - Math.exp(-dt / tau));
    delta.clampLength(0, p.max_follow_speed * dt);
    return previous.clone().add(delta);
  });
}
function buildPlan(capture, value, duration, restoreTime, aspect) {
  const p = effectivePreset(value);
  if(p.horizontal==='custom'&&p.aim_source==='live')p.reference_time=0;
  if (!p.actors.length) throw new Error("Select at least one actor for this shot.");
  if (p.start_time >= (p.end_time || duration) || (p.end_time || duration) > duration + 1e-6) throw new Error("Movement end must be after its start and within the clip. Zero means clip end.");
  if (!Number.isFinite(p.reference_time) || p.reference_time < 0 || p.reference_time > duration) throw new Error("Shot reference time must be within the clip.");
  if (!p.actors.includes(p.reference_actor)) throw new Error("Choose a facing reference actor from the selected subjects.");
  if (!["chest", "pelvis", "legacy_chest"].includes(p.reference_basis)) throw new Error("Choose Body / pelvis or Chest / shoulders for facing.");
  const source = samples(capture, duration, restoreTime, 60), rows = source.rows.slice();
  const times = source.times.slice();
  let anchor = times.findIndex(t => Math.abs(t - p.reference_time) < 1e-9);
  // Include an exact reference knot, even between the 60 Hz samples. Never snap
  // the saved time to the VIDEO output FPS or a nearby pose.
  if (anchor < 0) {
    anchor = times.findIndex(t => t > p.reference_time);
    try {
      capture.setTime(p.reference_time);
      rows.splice(anchor, 0, new Map(capture.actors.map(actor => [actor.number, snapshot(actor)])));
      times.splice(anchor, 0, p.reference_time);
    } finally { capture.setTime(restoreTime); }
  }
  const placement = trackingPlacement(p,p.reference_time,duration,screenPlacement(p)), fisheye = isFisheye(p);
  if (fisheye && ["zoom", "dolly_zoom"].includes(p.movement)) throw new Error("Fisheye supports camera movement, but Zoom and Dolly zoom require a perspective lens.");
  const orient = (position,target,roll,fov) => placement
    ? composedOrientation(position,target,roll,fov,aspect,placement,fisheye) : orientation(position,target,roll);
  const fitAt = (bounds,target,normal,fov,fitAspect,roll,padding,clearance) => placement || fisheye
    ? fitComposition(bounds,target,normal,fov,aspect,roll,padding,placement,fitAspect === Infinity,fisheye)
    : fit(bounds,target,normal,fov,fitAspect,roll,padding,clearance);
  const states = rows.map(row => subjects(row, p));
  const first = states[anchor];
  const cropAspect = p.framing_version === 2 && (!hasFocus(p) || p.focus_point === "auto") && p.actors.length === 1 && !["full","wide","extreme_wide"].includes(p.shot) && !["ots","pov"].includes(p.composition) ? Infinity : aspect;
  const fitClearance = p.framing_version === 2 ? (cropAspect === Infinity ? .005 : .02) : .05;
  const eyeLevel = hasFocus(p) && p.focus_point !== "auto" ? first.focus : p.framing_version === 2 ? first.eyes : first.head;
  const focal = LENSES[p.lens] ?? p.focal_length;
  const fovAt = mm => fisheye ? fisheyeVerticalFOV(p.fisheye_fov, aspect) : perspectiveVerticalFOV(mm,aspect,p);
  const referenceProgress = progress(p.reference_time, p, duration);
  // Zoom's start/end focal lengths still describe the movement interval. Fit
  // the reference framing using the lens actually reached at that instant.
  const initialFov = fovAt(p.movement === "zoom" ? THREE.MathUtils.lerp(focal, p.end_focal_length, referenceProgress) : focal);
  let basePosition;
  if(p.horizontal==='custom') {
    if(!p.custom_position) throw new Error('Place the custom camera in Scene.');
    basePosition=vec(p.custom_position);
    if(basePosition.distanceToSquared(first.target)<1e-10) throw new Error('Move the camera away from its subject target.');
  } else {
    // Anatomical left is a positive Y-axis rotation from forward. Preserve the
    // old reversed front/sides only for recipes predating reference controls.
    const bearingSign = p.reference_basis === "legacy_chest" ? 1 : -1;
    let bearing = bearingSign * AZIMUTH[p.horizontal] + p.bearing_offset;
    if (p.movement === "follow") bearing = 180 + p.bearing_offset;
    if (p.movement === "lead") bearing = p.bearing_offset;
    if (p.movement === "alongside") bearing = bearingSign * (p.direction === "left" ? -90 : 90) + p.bearing_offset;
    let normal = first.forward.clone().applyAxisAngle(up, radians(bearing));
    let distance = fitAt(first.bounds, first.target, normal, initialFov, cropAspect, p.roll, p.padding, fitClearance);
    const wide = hasFocus(p) && p.focus_point !== "auto" ? 1 : p.shot === "wide" ? 1.7 : p.shot === "extreme_wide" ? 3 : 1;
    for (let pass = 0; pass < 4; pass++) {
      const elevation = p.vertical === "custom" ? radians(p.elevation_angle ?? 0) : p.vertical === "auto" ? levelElevation(placement, initialFov, aspect, p.roll, fisheye) : p.vertical === "eye" ? Math.atan2(eyeLevel.y - first.target.y, distance) : radians(ELEVATION[p.vertical]);
      normal = first.forward.clone().applyAxisAngle(up, radians(bearing)).multiplyScalar(Math.cos(elevation)).addScaledVector(up, Math.sin(elevation));
      distance = fitAt(first.bounds, first.target, normal, initialFov, cropAspect, p.roll, p.padding, fitClearance) * wide;
    }
    basePosition = first.target.clone().addScaledVector(normal, distance);
    const ground = Math.min(...p.actors.map(id => rows[anchor].get(id).bounds.min.y));
    if(p.vertical!=="custom")basePosition.y = Math.max(basePosition.y, ground + .06, .06);
    if (p.composition === "ots") {
      const foreground = rows[anchor].get(p.foreground_actor);
      if (!foreground || p.actors.includes(p.foreground_actor)) throw new Error("Choose different foreground and target actors for over-the-shoulder framing.");
      const direction = first.target.clone().sub(foreground.head); direction.y = 0;
      if (direction.lengthSq() < .0001) direction.copy(first.forward); direction.normalize();
      const side = direction.clone().cross(up).multiplyScalar(p.shoulder_side === "left" ? -1 : 1);
      basePosition = foreground.head.clone().addScaledVector(direction, -p.shoulder_back).addScaledVector(side, p.shoulder_offset);
      basePosition.y += ["auto", "eye"].includes(p.vertical) ? 0 : Math.tan(radians(ELEVATION[p.vertical])) * p.shoulder_back;
      const fromTarget = basePosition.clone().sub(first.target).normalize();
      const needed = fitAt(first.bounds, first.target, fromTarget, initialFov, cropAspect, p.roll, p.padding, fitClearance) * wide;
      if (basePosition.distanceTo(first.target) < needed) basePosition.copy(first.target).addScaledVector(fromTarget, needed);
      normal = basePosition.clone().sub(first.target).normalize(); distance = basePosition.distanceTo(first.target);
    }
    // Ground clamping changes the viewing direction. Refit at the clamped
    // height rather than cropping the feet/head in a very low-angle full shot.
    if(p.vertical!=="custom")basePosition.y = Math.max(basePosition.y, ground + .06, .06);
    for (let pass = 0; pass < 10; pass++) {
      const offset = basePosition.clone().sub(first.target), actual = offset.length();
      const needed = fitAt(first.bounds, first.target, offset.clone().normalize(), initialFov, cropAspect, p.roll, p.padding, fitClearance) * wide;
      if (needed <= actual + .00001) break;
      const horizontal = offset.clone().setY(0).normalize();
      const planar = Math.sqrt(Math.max(.0001, needed * needed - offset.y * offset.y));
      basePosition.copy(first.target).addScaledVector(horizontal, planar); basePosition.y = first.target.y + offset.y;
    }
  }
  let centers = states.map(s => s.body);
  if (p.composition === "pov") centers = rows.map(row => {
    const actor = row.get(p.actors[0]);
    return actor.eyes.clone().addScaledVector(facing(actor, p), actor.height * .025);
  });
  if (subjectTravel(p) && p.composition !== "pov") {
    const at = time => {
      const { a, b, t } = interval(times, time);
      return centers[a].clone().lerp(centers[b], t);
    };
    const anchor = at(p.start_time), original = centers[0].clone();
    const gated = centers.map((_, i) => original.clone().add(at(clamp(times[i], p.start_time, p.end_time || duration)).sub(anchor)));
    centers = gated;
  }
  if (p.follow_response === "smooth") centers = smoothPoints(centers, p, times, anchor);
  if (subjectTravel(p) && p.composition !== "pov" && p.start_time && anchor > 0) {
    const startIndex = times.findIndex(time => time >= p.start_time);
    for (let i = 0; i < startIndex; i++) centers[i] = centers[startIndex].clone();
  }
  if (subjectTravel(p) && p.composition !== "pov" && p.end_time) {
    const endIndex = Math.min(centers.length - 1, interval(times, p.end_time).a);
    for (let i = endIndex + 1; i < centers.length; i++) centers[i] = centers[endIndex].clone();
  }
  // Framing is established once. Following transports this reference offset;
  // neither group aiming nor later separation increases the camera distance.
  let followFacing = p.movement === "track_subjects" && p.follow_direction === "facing" ? rows.map(row => {
    const forward = facing(row.get(p.reference_actor), p);
    return new THREE.Quaternion().setFromAxisAngle(up, Math.atan2(forward.x, forward.z));
  }) : [];
  if (followFacing.length && p.follow_response === "smooth") {
    followFacing = anchoredFilter(followFacing, times, anchor, (previous, desired, dt) => {
      const alpha = 1 - Math.exp(-dt / (.12 + (1 - p.follow_responsiveness) * 1.8));
      return previous.clone().rotateTowards(desired, Math.min(previous.angleTo(desired) * alpha, radians(p.max_turn_speed) * dt));
    });
  }
  const fittedPosition = basePosition.clone();
  const makePlan = () => {
    const basePosition = fittedPosition.clone();
    const normal = basePosition.clone().sub(first.target).normalize(), distance = basePosition.distanceTo(first.target);
    const initialQ = orient(basePosition.clone().add(vec(p.position_offset)), first.target, p.roll, initialFov);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(initialQ);
    const inDirection = first.target.clone().sub(basePosition).normalize();
    const positions = [], targets = [], quaternions = [], fovs = [], followNormals = [];
    const warnings = [];
    if (!isAimMarker(p) && hasFocus(p) && p.focus_point.includes("hand") && p.actors.some(id=>rows[anchor].get(id).anatomy.missingHandDetail)) warnings.push("Finger landmarks unavailable for some hands; hand framing uses wrist/forearm proportions. This capture may not contain finger animation.");
    if (placement && p.focus_point === "auto" && !["extreme_close","close","chest"].includes(p.shot)) warnings.push("Pinning the face to this frame reference may loosen a wider anatomical shot to retain its body region.");
    if (!isAimMarker(p) && p.actors.length > 1) warnings.push("Group framing fits the selected bodies or faces together; separated actors require a wider composition.");
    if (p.composition === "pov") warnings.push("POV follows the selected actor's eye position and body bearing. Shot size and free placement do not apply.");
    if (p.composition === "ots") warnings.push("OTS keeps the foreground shoulder and target relationship; no scene collision or occlusion correction is applied.");
    if (p.reference_basis === "pelvis" && !rows[anchor].get(p.reference_actor).pelvisAvailable) warnings.push("Pelvis landmarks unavailable; facing uses this actor's shoulders instead.");
    const initialFront = first.forward;
    for (let i = 0; i < rows.length; i++) {
      const time = times[i], phase = progress(time, p, duration), t = phase - referenceProgress, state = states[i];
      const turnProgress = t;
      const position = basePosition.clone();
      let target = p.aim_behavior === "track" ? state.target.clone() : first.target.clone();
      let fov = initialFov;
      if (subjectTravel(p)) position.add(centers[i].clone().sub(centers[anchor]));
      if (p.movement === "track_subjects") {
        const followNormal = normal.clone();
        if (p.follow_direction === "facing") {
          const referenceYaw = followFacing[anchor].clone().invert();
          followNormal.applyQuaternion(followFacing[i].clone().multiply(referenceYaw));
        }
        followNormals.push(followNormal);
        target = state.target.clone();
        position.copy(target).addScaledVector(followNormal, distance);
      }
      // The placed camera is the close/end position of a push-in. Longer travel
      // extends its start backward, without moving through the subject or zooming.
      if (p.movement === 'push') position.addScaledVector(inDirection,p.travel*(phase-1));
      if (p.movement === 'pull') position.addScaledVector(inDirection,-p.travel*phase);
      if (p.movement === "truck") position.addScaledVector(right, p.travel * t * (p.direction === "left" ? -1 : 1));
      if (p.movement === "pedestal" || p.movement === "crane") position.addScaledVector(up, p.travel * t * (p.direction === "down" ? -1 : 1));
      if (p.movement === "crane") position.addScaledVector(inDirection, p.crane_forward * t);
      if (p.movement === "orbit") {
        const center = first.body.clone();
        if (subjectTravel(p)) center.add(centers[i].clone().sub(centers[anchor]));
        position.copy(basePosition).sub(first.body).applyAxisAngle(up, radians(p.orbit_degrees * t * (p.direction === "left" ? -1 : 1))).add(center);
      }
      if (p.movement === "zoom") fov = fovAt(THREE.MathUtils.lerp(focal, p.end_focal_length, phase));
      if (p.movement === "dolly_zoom") {
        const remaining = distance + p.travel * t * (p.direction === "out" ? 1 : -1);
        if (remaining < .15) throw new Error("Dolly zoom travels through its target. Reduce travel or adjust the reference time.");
        position.copy(first.target).addScaledVector(normal, remaining);
        fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(radians(initialFov) / 2) * distance / remaining));
      }
      if (p.composition === "pov") {
        const actor = rows[i].get(p.actors[0]);
        position.copy(centers[i]);
        target.copy(position).addScaledVector(facing(actor, p), 5);
      }
      if (p.movement !== "track_subjects") position.add(vec(p.position_offset));
      if (!Number.isFinite(fov) || fov < 5 || fov > (fisheye ? 180 : 150)) throw new Error("This lens move exceeds its supported field of view. Reduce travel or change the lens.");
      let q = p.aim_behavior === "fixed" && p.composition !== "pov" ? initialQ.clone() : orient(position, target, p.roll, fov);
      if (["pan", "tilt"].includes(p.movement)) {
        q = initialQ.clone().multiply(new THREE.Quaternion().setFromAxisAngle(p.movement === "pan" ? up : new THREE.Vector3(1, 0, 0), radians(p.rotation_degrees * turnProgress * (["left", "up"].includes(p.direction) ? 1 : -1))));
      }
      positions.push(position); targets.push(target); quaternions.push(q); fovs.push(fov);
    }
    let tracking = null;
    if (p.aim_behavior === "track" && p.actors.length > 1) {
      const actorFrames = rows.map(row => p.actors.map(id => subjects(row, {...p, actors:[id]})));
      const positionFor = (i, target) => {
        if (p.movement !== "track_subjects") return positions[i];
        const position = target.clone().addScaledVector(followNormals[i], distance).add(vec(p.position_offset));
        position.y = Math.max(position.y,.06); return position;
      };
      tracking = trackMajority(actorFrames, states.map(s=>s.target), times, anchor, p, aspect, fovs, positionFor,
        (position,target,fov)=>orient(position,target,p.roll,fov));
      targets.splice(0,targets.length,...tracking.targets);
      if (tracking.members.some(m=>m.length<p.actors.length)) warnings.push("Group tracking favors the largest stable group that fits this shot. Departing actors may leave frame; camera distance and lens are preserved.");
    }
    // A group can choose a smaller tracking cluster. Keep the authored camera
    // at its reference point when that changes the follow target.
    let followDistance=distance;
    if(p.movement==='track_subjects' && p.horizontal==='custom') {
      const offset=basePosition.clone().sub(targets[anchor]);followDistance=offset.length();
      for(let i=0;i<followNormals.length;i++) {
        followNormals[i].copy(offset).normalize();
        if(p.follow_direction==='facing')followNormals[i].applyQuaternion(followFacing[i].clone().multiply(followFacing[anchor].clone().invert()));
      }
    }
    const trackingTargets=targets.map(target=>target.clone());
    if (p.movement === "track_subjects") {
      const aimed = p.follow_response === "smooth" && p.tracking_mode !== "exact" ? smoothPoints(targets,p,times,anchor) : targets.map(t=>t.clone());
      for (let i=0;i<positions.length;i++) {
        targets[i]=aimed[i];
        positions[i].copy(targets[i]).addScaledVector(followNormals[i],followDistance).add(vec(p.position_offset));
        positions[i].y=Math.max(positions[i].y,.06);
        quaternions[i]=orient(positions[i],targets[i],p.roll,fovs[i]);
      }
    } else if (p.aim_behavior === "track") {
      for (let i=0;i<positions.length;i++) quaternions[i]=orient(positions[i],targets[i],p.roll,fovs[i]);
    }
    let actionFollow=null;
    let filtered = p.aim_behavior === "track" && p.response === "smooth" && p.movement !== "track_subjects"
      ? anchoredFilter(quaternions, times, anchor, (previous, desired, dt) => {
        const angle = previous.angleTo(desired), deadZone = radians(p.dead_zone);
        const alpha = 1 - Math.exp(-dt / (.08 + (1 - p.responsiveness) * 1.7));
        return previous.clone().rotateTowards(desired, Math.min(Math.max(0, angle - deadZone) * alpha, radians(p.max_turn_speed) * dt));
      }) : quaternions;
    if (p.tracking_mode !== "legacy" && p.behavior !== "static" && p.composition !== "pov" && (p.aim_behavior === "track" || p.framing_motion) && !["pan","tilt"].includes(p.movement)) {
      const currentStates=states.map((s,i)=>{
        const members=tracking?.members[i];
        const body=members?.length?subjects(rows[i],{...p,actors:members}).body:s.body;
        return {...s,body,target:p.aim_behavior === 'track'?trackingTargets[i]:states[anchor].target,placement:screenPlacement(p)};
      });
      if(p.movement==='track_subjects' && ['auto','custom'].includes(p.tracking_mode)) {
        const steady=steadyTargets(currentStates,{...p,aim_source:'legacy'},times,anchor);
        for(let i=0;i<positions.length;i++) {
          positions[i].copy(steady[i]).addScaledVector(followNormals[i],followDistance).add(vec(p.position_offset));
          positions[i].y=Math.max(.06,positions[i].y);
        }
      }
      const natural=trackingPlan({positions,states:currentStates,times,referenceIndex:anchor,p,aspect,fovs,duration});
      filtered=natural.quaternions;
    }
    if(['live','reference'].includes(p.aim_source)&&p.composition!=='pov'&&!['pan','tilt'].includes(p.movement)){
      const currentStates=states.map(s=>({...s,target:s.focus.clone(),placement:screenPlacement(p)}));
      const natural=trackingPlan({positions,states:currentStates,times,referenceIndex:p.aim_source==='live'?0:anchor,p,aspect,fovs,duration});
      filtered=natural.quaternions;actionFollow=natural;
      for(let i=0;i<targets.length;i++)targets[i].copy(natural.targets[i]);
    }
    return { anchorPosition:fittedPosition.clone().add(vec(p.position_offset)), positions, targets, quaternions: filtered, fovs, times, referenceIndex: anchor, dt: source.dt, duration, warnings, actionFollow, preset: p, initialFront, tracking: tracking ? {members:tracking.members,hold_seconds:tracking.hold_seconds,transition_seconds:tracking.transition_seconds} : null };
  };
  return makePlan();
}
export function presetPlan(capture, settings, duration, restoreTime = 0) {
  const aspect = cameraAspect(capture, settings);
  const key = JSON.stringify([settings.preset, duration, aspect]);
  let cached = planCache.get(capture);
  if (cached?.key !== key) {
    cached = { key, plan: buildPlan(capture, settings.preset, duration, restoreTime, aspect) };
    planCache.set(capture, cached);
  }
  return cached.plan;
}
function interval(times, time) {
  let lo = 0, hi = times.length - 1;
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (times[mid] <= time) lo = mid; else hi = mid - 1; }
  const a = lo, b = Math.min(a + 1, times.length - 1);
  return { a, b, t: b === a ? 0 : clamp((time - times[a]) / (times[b] - times[a]), 0, 1) };
}
export function applyPreset(capture, settings, time, duration) {
  const plan = presetPlan(capture, settings, duration, time);
  const { a, b, t } = interval(plan.times, time);
  const camera = capture.camera;
  camera.userData.cartwheelActionFollow=actionFeedback(plan.actionFollow,time);
  const aim=plan.actionFollow?.targets??plan.targets;camera.userData.cartwheelAimPoint=aim?.[a]?.clone().lerp(aim[b],t)??null;
  camera.aspect = cameraAspect(capture, settings);
  camera.position.copy(plan.positions[a]).lerp(plan.positions[b], t);
  camera.quaternion.copy(plan.quaternions[a]).slerp(plan.quaternions[b], t);
  camera.fov = THREE.MathUtils.lerp(plan.fovs[a], plan.fovs[b], t);
  camera.up.set(0, 1, 0); camera.near = .01;
  camera.far = Math.max(camera.far, camera.position.length() + 200);
  camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
}

// Keep the viewpoint actor in Scene inspection, but out of the POV camera image.
// Otherwise a smoothly following eye position can intersect its own head mesh.
export function withCameraVisibility(capture, settings, render) {
  const hiddenId = settings?.mode === "preset" && settings.preset.composition === "pov" ? settings.preset.actors[0] : null;
  const root = capture.actors.find(actor => actor.number === hiddenId)?.root;
  const visible = root?.visible;
  try { if (root) root.visible = false; return render(); }
  finally { if (root) root.visible = visible; }
}

// Reuse the same anatomical regions and composition anchors for manual routes.
// This samples the current pose without evaluating/repositioning a preset camera.
export function manualFramingState(capture, recipe) {
  const p = effectivePreset(recipe);
  const row = new Map(capture.actors.map(actor => [actor.number, snapshot(actor)]));
  return { ...subjects(row, p), preset: p, placement: screenPlacement(p) };
}

export function manualFramingSamples(capture,recipe,duration,restoreTime) {
  const p=effectivePreset(recipe),source=samples(capture,duration,restoreTime),times=[...source.times],rows=[...source.rows];
  const reference=p.aim_source==='live'?0:clamp(p.reference_time??0,0,duration);
  let anchor=times.findIndex(t=>Math.abs(t-reference)<1e-9);
  if(anchor<0){
    anchor=times.findIndex(t=>t>reference);if(anchor<0)anchor=times.length;
    try{capture.setTime(reference);rows.splice(anchor,0,new Map(capture.actors.map(a=>[a.number,snapshot(a)])));times.splice(anchor,0,reference);}finally{capture.setTime(restoreTime);}
  }
  return{times,anchor,states:rows.map(row=>{const state=subjects(row,p);return {...state,target:['live','reference'].includes(p.aim_source)?state.focus.clone():state.target,placement:screenPlacement(p)};})};
}

export function focusWarnings(capture,preset){
  const p=effectivePreset(preset),missing=[];if(isAimMarker(p))return missing;
  for(const actor of capture.actors.filter(a=>p.actors.includes(a.number))){
    const r=rig(actor),key=p.focus_point;
    const hands=key.includes('hand')?(key.startsWith('left_')?[r.leftHand]:key.startsWith('right_')?[r.rightHand]:[r.leftHand,r.rightHand]):null;
    const feet=key.includes('foot')||key==='feet'?(key.startsWith('left_')?[r.leftFoot]:key.startsWith('right_')?[r.rightFoot]:[r.leftFoot,r.rightFoot]):null;
    if(hands?.some(v=>!v))missing.push(`Actor ${actor.number}: hand joint names are not recognized; using an approximate body-based target.`);
    if(feet?.some(v=>!v))missing.push(`Actor ${actor.number}: foot joint names are not recognized; using an approximate body-based target.`);
    if(['auto','eyes'].includes(key)&&!r.head)missing.push(`Actor ${actor.number}: head joint is not recognized; face focus is approximate.`);
  }
  return missing;
}
