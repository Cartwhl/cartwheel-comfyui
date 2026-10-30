import assert from "node:assert/strict";
import * as T from "../web/vendor/build/three.module.js";
import { presetDefaults, PRESET_DEFAULTS, presetPlan } from "../web/camera_presets.js";
import { applyCamera } from "../web/camera_motion.js";
import { imagePoint, imageRay, fisheyeVerticalFOV } from "../web/lens_projection.js";
const aspects = [16 / 9, 4 / 3, 1, 21 / 9, 9 / 16, 3 / 4, 9 / 21];
for (const aspect of aspects)
  for (const diagonal of [90, 160, 180])
    for (const x of [-1, -0.7, 0, 0.6, 1])
      for (const y of [-1, -0.5, 0, 0.8, 1]) {
        const fov = fisheyeVerticalFOV(diagonal, aspect),
          ray = imageRay(x, y, fov, aspect, true),
          p = imagePoint(ray.clone().multiplyScalar(3), fov, aspect, true);
        assert.ok(Math.abs(p.x - x) < 1e-8 && Math.abs(p.y - y) < 1e-8);
      }
const a = imagePoint(new T.Vector3(1, 0, -2), 75, 1.7, true),
  b = imagePoint(new T.Vector3(1, 2, -2), 75, 1.7, true);
assert.ok(Math.abs(a.x - b.x) > 0.02, "Fisheye must curve off-axis straight lines");
assert.equal(PRESET_DEFAULTS.vertical, "eye");
assert.equal(presetDefaults([1]).vertical, "auto");
function fixture(aspect) {
  const actors = [1, 2].map((number, i) => {
    const root = new T.Group();
    root.position.x = i * 1.2;
    const mesh = new T.Mesh(new T.BoxGeometry(0.5, 1.8, 0.3));
    mesh.position.y = 0.9;
    root.add(mesh);
    const bone = (name, x, y, z = 0) => {
      const b = new T.Bone();
      b.name = name;
      b.position.set(x, y, z);
      root.add(b);
      return b;
    };
    bone("c_spine0", 0, 0.95);
    bone("c_spine1", 0, 1.1);
    bone("c_spine2", 0, 1.35);
    bone("c_spine3", 0, 1.45);
    bone("c_neck", 0, 1.55);
    bone("c_head", 0, 1.66);
    bone("l_eye", -0.032, 1.69, 0.1);
    bone("r_eye", 0.032, 1.69, 0.1);
    bone("l_uparm", -0.22, 1.4);
    bone("r_uparm", 0.22, 1.4);
    bone("l_upleg", 0.1, 0.9);
    bone("r_upleg", -0.1, 0.9);
    bone("l_lowleg", 0.1, 0.5);
    bone("r_lowleg", -0.1, 0.5);
    bone("l_foot", 0.1, 0.04);
    bone("r_foot", -0.1, 0.04);
    root.updateMatrixWorld(true);
    return { root, number };
  });
  const camera = new T.PerspectiveCamera(45, aspect, 0.01, 1000);
  return {
    actors,
    camera,
    duration: 2,
    cameraMetadata: [{ aspect }],
    setTime(t = 0) {
      for (const a of actors) {
        a.root.position.z = t * 0.15;
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
const shots = ["extreme_close", "close", "chest", "waist", "cowboy", "medium_full", "full", "wide", "extreme_wide"];
for (const aspect of aspects)
  for (const lens of ["natural", "fisheye"])
    for (const shot of shots) {
      const c = fixture(aspect),
        s = { mode: "preset", preset: { ...presetDefaults([1]), lens, shot } };
      c.setTime();
      applyCamera(c, s, 0, 2);
      const dir = c.camera.getWorldDirection(new T.Vector3());
      assert.ok(Math.abs(dir.y) < 1e-6, `Auto tilted ${aspect} ${lens} ${shot}: ${dir.y}`);
      const autoY = c.camera.position.y;
      if (shot === "full") {
        s.preset.vertical = "eye";
        c.setTime();
        applyCamera(c, s, 0, 2);
        assert.ok(c.camera.position.y > autoY + 0.3);
        assert.ok(c.camera.getWorldDirection(new T.Vector3()).y < -0.02);
      }
      if (shot === "close") assert.ok(Math.abs(autoY - 1.69) < 0.03);
    }
for (const aspect of aspects)
  for (const lens of ["natural", "fisheye"])
    for (const placement of ["upper_third", "upper_left", "custom"])
      for (const roll of [0, 12, -12]) {
        const c = fixture(aspect),
          p = {
            ...presetDefaults([1]),
            lens,
            shot: "waist",
            frame_reference: placement,
            frame_x: 0.4,
            frame_y: 0.3,
            roll,
          },
          s = { mode: "preset", preset: p };
        c.setTime();
        applyCamera(c, s, 0, 2);
        assert.ok(
          Math.abs(c.camera.getWorldDirection(new T.Vector3()).y) < 1e-6,
          `Placed Auto tilted ${aspect} ${lens} ${placement} ${roll}`,
        );
      }
for (const aspect of [16 / 9, 9 / 16])
  for (const movement of ["fixed", "orbit", "pan", "truck", "track_subjects"]) {
    const c = fixture(aspect),
      p = {
        ...presetDefaults([1, 2]),
        lens: "fisheye",
        shot: "full",
        behavior: movement === "track_subjects" ? "follow" : movement === "fixed" ? "static" : "move",
        movement,
        framing_mode: "reference",
        follow_response: "direct",
        aim_behavior: movement === "pan" ? "fixed" : "target",
        rotation_degrees: 15,
        travel: 0.2,
      },
      s = { mode: "preset", preset: p };
    const plan = presetPlan(c, s, 2);
    assert.equal(plan.coverage, undefined);
    for (let frame = 0; frame < 240; frame++) {
      const t = frame / 120;
      c.setTime(t);
      applyCamera(c, s, t, 2);
      assert.ok(
        [...c.camera.position.toArray(), ...c.camera.quaternion.toArray(), c.camera.fov].every(Number.isFinite),
      );
    }
  }
assert.throws(
  () =>
    presetPlan(
      fixture(1.7),
      { mode: "preset", preset: { ...presetDefaults([1]), lens: "fisheye", behavior: "move", movement: "zoom" } },
      2,
    ),
  /perspective lens/,
);
console.log(
  "Auto level across 9 shots, 7 aspects, both projections, thirds and roll; explicit eye-level retained; fisheye ray round trips/curvature and moving-camera finiteness passed.",
);
