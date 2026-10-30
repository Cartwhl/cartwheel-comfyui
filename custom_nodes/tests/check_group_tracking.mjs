import assert from "node:assert/strict";
import * as T from "../web/vendor/build/three.module.js";
import { presetDefaults, presetPlan, effectivePreset } from "../web/camera_presets.js";
import { applyCamera } from "../web/camera_motion.js";
function fixture({ split = true, tie = false, unselected = 0, aspect = 16 / 9, rejoin = false, blink = false } = {}) {
  const actors = [1, 2, 3, 4].map((number, i) => {
    const root = new T.Group();
    const mesh = new T.Mesh(new T.BoxGeometry(0.35, 1.8, 0.25));
    mesh.position.y = 0.9;
    root.add(mesh);
    const bone = (name, x, y, z = 0) => {
      const b = new T.Bone();
      b.name = name;
      b.position.set(x, y, z);
      root.add(b);
    };
    for (const [n, x, y, z] of [
      ["c_spine0", 0, 0.9],
      ["c_spine1", 0, 1.1],
      ["c_spine2", 0, 1.35],
      ["c_spine3", 0, 1.45],
      ["c_neck", 0, 1.55],
      ["c_head", 0, 1.65],
      ["l_eye", -0.032, 1.69, 0.1],
      ["r_eye", 0.032, 1.69, 0.1],
      ["l_uparm", -0.2, 1.4],
      ["r_uparm", 0.2, 1.4],
      ["l_upleg", 0.1, 0.85],
      ["r_upleg", -0.1, 0.85],
      ["l_lowleg", 0.1, 0.5],
      ["r_lowleg", -0.1, 0.5],
      ["l_foot", 0.1, 0.04],
      ["r_foot", -0.1, 0.04],
    ])
      bone(n, x, y, z);
    return { number, root, origin: (i - 1.5) * 0.4 };
  });
  const camera = new T.PerspectiveCamera(45, aspect, 0.01, 1000);
  return {
    actors,
    camera,
    duration: 3,
    cameraMetadata: [{ aspect }],
    setTime(t = 0) {
      for (const a of actors) {
        const spread = blink
          ? t > 1 && t < 1.1
            ? 2
            : 0
          : rejoin
            ? Math.max(0, Math.min(t - 0.5, 2.5 - t))
            : split
              ? Math.max(0, t - 0.5)
              : 0;
        a.root.position.set(
          a.origin +
            (tie
              ? (a.number <= 2 ? -1 : 1) * spread * 20
              : a.number === 1
                ? spread * 30
                : rejoin || blink
                  ? 0
                  : t * 0.2),
          0.02 * Math.sin(t * 4),
          0,
        );
        if (a.number === 1) a.root.position.x += unselected;
        a.root.updateMatrixWorld(true);
      }
      camera.aspect = aspect;
      camera.position.set(0, 2, 5);
      camera.quaternion.identity();
      camera.fov = 45;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
    },
  };
}
const recipe = (patch = {}, ids = [1, 2, 3, 4]) => ({
  mode: "preset",
  preset: {
    ...presetDefaults(ids),
    behavior: "move",
    movement: "fixed",
    aim_behavior: "track",
    response: "direct",
    ...patch,
  },
});
for (const aspect of [16 / 9, 9 / 16])
  for (const lens of ["natural", "fisheye"]) {
    const c = fixture({ aspect }),
      s = recipe({ lens }),
      p = presetPlan(c, s, 3);
    assert.deepEqual(p.tracking.members[p.referenceIndex], [1, 2, 3, 4]);
    assert.deepEqual(
      p.tracking.members.at(-1),
      [2, 3, 4],
      `Failed to favor three over reference Actor 1: ${lens} ${aspect}`,
    );
    assert.ok(p.targets.at(-1).x < 2, "Outlier dragged the final target");
    for (const pos of p.positions) assert.ok(pos.distanceTo(p.positions[0]) < 1e-10, "Aiming moved the camera");
    assert.ok(p.fovs.every((v) => v === p.fovs[0]));
    const frozen = presetPlan(fixture({ aspect }), recipe({ lens, aim_behavior: "target" }), 3);
    p.positions.forEach((v, i) => assert.ok(v.distanceTo(frozen.positions[i]) < 1e-9));
    const follow = presetPlan(fixture({ aspect }), recipe({ lens, behavior: "follow", follow_response: "direct" }), 3);
    assert.deepEqual(follow.tracking.members.at(-1), [2, 3, 4]);
    const d = follow.positions[0].distanceTo(follow.targets[0]);
    follow.positions.forEach((v, i) =>
      assert.ok(Math.abs(v.distanceTo(follow.targets[i]) - d) < 1e-8, "Follow inflated distance"),
    );
    const smooth = presetPlan(fixture({ aspect }), recipe({ lens, response: "smooth" }), 3);
    const maxTurn = 35 * T.MathUtils.DEG2RAD;
    for (let i = 1; i < smooth.quaternions.length; i++)
      assert.ok(
        smooth.quaternions[i - 1].angleTo(smooth.quaternions[i]) <=
          maxTurn * (smooth.times[i] - smooth.times[i - 1]) + 1e-6,
      );
    const same = presetPlan(fixture({ aspect }), JSON.parse(JSON.stringify(s)), 3, 2.7);
    assert.deepEqual(p.tracking.members, same.tracking.members);
    p.quaternions.forEach((q, i) => assert.ok(q.angleTo(same.quaternions[i]) < 1e-7));
    for (const time of [2.7, 0, 1.1, 3, 0.5, 2.7]) {
      c.setTime(time);
      applyCamera(c, s, time, 3);
      assert.ok([...c.camera.position.toArray(), ...c.camera.quaternion.toArray()].every(Number.isFinite));
    }
  }
// Rejoining actors are restored, while brief excursions do not churn membership.
const returning = presetPlan(fixture({ rejoin: true }), recipe(), 3);
assert.deepEqual(returning.tracking.members[Math.floor(returning.times.length / 2)], [2, 3, 4]);
assert.deepEqual(returning.tracking.members.at(-1), [1, 2, 3, 4]);
const blinking = presetPlan(fixture({ blink: true }), recipe(), 3);
assert.ok(
  blinking.tracking.members.every((m) => m.length === 4),
  "A brief excursion changed group membership",
);
// 2-v-2 ties stick to a stable pair instead of alternating every frame.
const tied = presetPlan(fixture({ tie: true }), recipe(), 3);
let switches = 0;
for (let i = 1; i < tied.tracking.members.length; i++)
  if (tied.tracking.members[i].join() != tied.tracking.members[i - 1].join()) switches++;
assert.ok(switches <= 2, `Equal clusters switched ${switches} times`);
const ids = [2, 3, 4],
  selected = recipe({}, ids),
  a = presetPlan(fixture(), selected, 3),
  b = presetPlan(fixture({ unselected: 1000 }), selected, 3);
a.positions.forEach((v, i) => {
  assert.ok(v.distanceTo(b.positions[i]) < 1e-9);
  assert.ok(a.quaternions[i].angleTo(b.quaternions[i]) < 1e-7);
});
for (const behavior of ["static", "move", "follow"]) {
  const old = recipe({ behavior, framing_mode: "whole_clip", movement: behavior === "move" ? "orbit" : "fixed" }),
    now = structuredClone(old);
  now.preset.framing_mode = "reference";
  const p = presetPlan(fixture(), old, 3),
    q = presetPlan(fixture(), now, 3);
  assert.equal(p.coverage, undefined);
  assert.equal(p.preset.framing_mode, "reference");
  p.positions.forEach((v, i) => {
    assert.ok(v.distanceTo(q.positions[i]) < 1e-10);
    assert.ok(p.quaternions[i].angleTo(q.quaternions[i]) < 1e-7);
  });
}
assert.equal(effectivePreset({ actors: [1], framing_mode: "whole_clip" }).framing_mode, "reference");
console.log(
  "Stable three-over-one and equal-cluster ties; selected-only aiming; fixed paths/lens; constant Follow offset; turn-speed limits; seek/JSON determinism; retired whole-clip migration passed.",
);
