import assert from "node:assert/strict";
import * as THREE from "../web/vendor/build/three.module.js";
import { presetDefaults, presetPlan, effectivePreset } from "../web/camera_presets.js";
import {
  subjectSelection,
  cameraBehavior,
  selectSubjects,
  selectBehavior,
  selectViewpoint,
} from "../web/shot_controls.js";
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

const recipe = (patch = {}) => ({ mode: "preset", preset: { ...presetDefaults([2], 0), ...patch } });
const p = presetDefaults([2, 4, 7], 0);
assert.equal(subjectSelection(p, [2, 4, 7]), "all");
selectSubjects(p, "selected", [2, 4, 7], [2, 7]);
assert.deepEqual(p.actors, [2, 7]);
assert.equal(p.composition, "group");
selectSubjects(p, "selected", [2, 4, 7], [7]);
assert.deepEqual(p.actors, [7]);
assert.equal(p.composition, "single");
assert.equal(p.reference_actor, 7);
assert.throws(() => selectSubjects(p, "selected", [2, 4, 7], []), /at least one/);
selectSubjects(p, "all", [2, 4, 7]);
assert.deepEqual(p.actors, [2, 4, 7]);
selectViewpoint(p, "ots", [2, 4, 7]);
assert.equal(p.actors.length, 1);
assert.notEqual(p.foreground_actor, p.actors[0]);
selectViewpoint(p, "standard", [2, 4, 7]);
selectBehavior(p, "follow");
assert.equal(p.movement, "track_subjects");
assert.equal(cameraBehavior({ mode: "preset", preset: p }), "follow");
assert.equal(cameraBehavior({ mode: "bookends" }), "move");
// Static overrides incompatible move/aim settings, and never follows body motion.
const fixed = presetPlan(scene(), recipe({ behavior: "static", movement: "orbit", aim_behavior: "track" }), 3);
for (let i = 0; i < fixed.positions.length; i++) {
  assert.ok(fixed.positions[i].distanceTo(fixed.positions[0]) < 1e-12);
  assert.ok(fixed.quaternions[i].angleTo(fixed.quaternions[0]) < 1e-7);
  assert.equal(fixed.fovs[i], fixed.fovs[0]);
}
// A new Follow can keep any chosen side, unlike the old behind/ahead families.
const followSettings = recipe({
  behavior: "follow",
  horizontal: "front_left",
  follow_response: "direct",
  response: "direct",
});
const follow = presetPlan(scene({ bounce: false }), followSettings, 3);
assert.ok(Math.abs(follow.positions.at(-1).x - follow.positions[0].x - 3) < 1e-8);
assert.ok(follow.quaternions[0].angleTo(follow.quaternions.at(-1)) < 1e-7);
assert.equal(new Set(follow.fovs).size, 1);
const turning = scene({ bounce: false, turning: true });
const frozen = presetPlan(turning, followSettings, 3);
const facing = presetPlan(turning, recipe({ ...followSettings.preset, follow_direction: "facing" }), 3);
assert.ok(frozen.quaternions[0].angleTo(frozen.quaternions.at(-1)) < 1e-7);
assert.ok(facing.quaternions[0].angleTo(facing.quaternions.at(-1)) > 1);
// Only selected actors affect the plan, including fixed Follow distance.
function separating(unselected = 0) {
  const c = scene({ bounce: false, moving: false }),
    setTime = c.setTime;
  c.setTime = (t) => {
    setTime.call(c, t);
    c.actors[1].root.position.x += t * 2;
    c.actors[2].root.position.x += unselected;
    c.actors.forEach((a) => a.root.updateMatrixWorld(true));
  };
  return c;
}
const groupSettings = recipe({
  behavior: "follow",
  composition: "group",
  actors: [2, 4],
  reference_actor: 2,
  follow_response: "direct",
  shot: "cowboy",
});
const group = presetPlan(separating(), groupSettings, 3),
  outside = presetPlan(separating(500), groupSettings, 3);
assert.ok(
  Math.abs(group.positions.at(-1).distanceTo(group.targets.at(-1)) - group.positions[0].distanceTo(group.targets[0])) < 1e-8,
);
for (let i = 0; i < group.times.length; i++) {
  assert.ok(group.positions[i].distanceTo(outside.positions[i]) < 1e-9);
  assert.ok(group.quaternions[i].angleTo(outside.quaternions[i]) < 1e-7);
}
// Seek order / JSON restoration produce the same camera; Gentle filters bobbing.
const gentleSettings = recipe({ behavior: "follow", follow_response: "smooth", follow_responsiveness: 0.2 });
const gentle = presetPlan(scene(), gentleSettings, 3);
const direct = presetPlan(scene(), recipe({ behavior: "follow", follow_response: "direct" }), 3);
const variation = (plan) => plan.targets.slice(1).reduce((sum, t, i) => sum + Math.abs(t.y - plan.targets[i].y), 0);
assert.ok(variation(gentle) < variation(direct) * 0.5);
const restored = presetPlan(scene(), JSON.parse(JSON.stringify(gentleSettings)), 3, 2.5);
for (let i = 0; i < gentle.times.length; i++) assert.ok(gentle.positions[i].distanceTo(restored.positions[i]) < 1e-9);
assert.equal(effectivePreset({ actors: [2], movement: "follow" }).behavior, "legacy");
console.log(
  "Subject subsets, viewpoints, strict Static, arbitrary-angle Follow, reference/facing behavior, fixed Follow distance, selection isolation, gentle response and saved-camera determinism passed.",
);

// Follow finiteness/ground safety is checked through the same evaluator used by VIDEO export,
// including interpolated 120 FPS samples and portrait output.
const { applyCamera } = await import("../web/camera_motion.js");
for (const orientation of ["landscape", "portrait"])
  for (const follow_direction of ["reference", "facing"]) {
    const c = scene({ bounce: true, turning: true });
    const settings = {
      ...recipe({
        behavior: "follow",
        composition: "group",
        actors: [2, 4],
        reference_actor: 2,
        shot: "full",
        follow_direction,
        follow_response: "direct",
      }),
      output_frame: { orientation, ratio: "4:3" },
    };
    for (let frame = 0; frame < 360; frame++) {
      const time = frame / 120;
      c.setTime(time);
      applyCamera(c, settings, time, 3);
      assert.ok([...c.camera.position.toArray(),...c.camera.quaternion.toArray(),c.camera.fov].every(Number.isFinite));
      assert.ok(c.camera.position.y >= 0.06 - 1e-9);
    }
  }
console.log("Follow reference/facing finiteness and ground safety pass at every 120 FPS sample in landscape and portrait.");

// Gentle limits translational following. Reference distance never inflates.
function rapidSeparation() {
  const c=separating(),setTime=c.setTime;
  c.setTime=t=>{setTime(t);c.actors[1].root.position.x+=t*6;c.actors[1].root.updateMatrixWorld(true);};return c;
}
const fastSettings={...groupSettings,output_frame:{orientation:'portrait',ratio:'16:9'}};
const fastDirect=presetPlan(rapidSeparation(),fastSettings,3);
const fastGentle=presetPlan(rapidSeparation(),{...fastSettings,preset:{...fastSettings.preset,follow_response:'smooth',max_follow_speed:4}},3);
const targetSpeed=plan=>Math.max(...plan.targets.slice(1).map((v,i)=>v.distanceTo(plan.targets[i])/(plan.times[i+1]-plan.times[i])));
assert.ok(targetSpeed(fastDirect)>4,'Fixture needs target motion faster than the gentle limit');
assert.ok(targetSpeed(fastGentle)<=4+1e-6,'Gentle translation exceeded its response limit');
for(const p of [fastDirect,fastGentle]){const d=p.positions[0].distanceTo(p.targets[0]);p.positions.forEach((v,i)=>assert.ok(Math.abs(v.distanceTo(p.targets[i])-d)<1e-8));}
console.log('Gentle limits target translation and both responses preserve Follow distance during rapid separation.');
