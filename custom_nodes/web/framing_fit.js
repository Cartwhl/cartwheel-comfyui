import * as THREE from "./vendor/build/three.module.js";

import { imagePoint, isFisheye } from "./lens_projection.js";

const corners = box => {
  const result = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) result.push(new THREE.Vector3(x, y, z));
  return result;
};
// Fit one constant camera-distance adjustment over the complete planned move.
// This never adds per-frame zoom, orientation corrections, or path deviations.
export function fitWholeClip(makePlan, states, p, aspect) {
  const boxes = states.map(state => corners(state.bounds));
  const local = new THREE.Vector3(), inverse = new THREE.Quaternion();
  const assess = plan => {
    let score = 0, visible = 0;
    for (let i = 0; i < boxes.length; i++) {
      inverse.copy(plan.quaternions[i]).invert();
      const tanV = Math.tan(THREE.MathUtils.degToRad(plan.fovs[i]) / 2), tanH = tanV * aspect;
      let edge = 0;
      for (const point of boxes[i]) {
        local.copy(point).sub(plan.positions[i]).applyQuaternion(inverse);
        const depth = -local.z;
        const projected = isFisheye(p) ? imagePoint(local, plan.fovs[i], aspect, true) : null;
        edge = Math.max(edge, depth <= .02 ? Infinity : projected ? Math.max(Math.abs(projected.x), Math.abs(projected.y)) : Math.max(Math.abs(local.x) / (depth * tanH), Math.abs(local.y) / (depth * tanV)));
      }
      if (edge <= 1 + 1e-6) visible++;
      score = Math.max(score, edge * p.padding);
    }
    return { score, visible_fraction: visible / boxes.length };
  };
  const attempt = scale => {
    try { const plan = makePlan(scale); return { plan, scale, ...assess(plan) }; }
    catch (error) { return { scale, score: Infinity, visible_fraction: 0, error }; }
  };
  const first = attempt(1);
  const fov = first.plan?.fovs[0];
  const angularLimit = isFisheye(p) ? (p.movement === "pan" ? fov * aspect : fov) : p.movement === "pan" ? THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fov) / 2) * aspect)) : fov;
  const impossibleSweep = ["pan", "tilt"].includes(p.movement) && Math.abs(p.roll) < 1e-6 && p.rotation_degrees >= angularLimit;
  const search = limit => {
    let best = first, useful = first, lower = 1, upper = 1;
    if (!impossibleSweep) while (best.score > limit && upper < 64) {
      lower = upper; upper *= 2;
      const next = attempt(upper);
      if (next.score < best.score) best = next;
      if (upper <= 8 && next.score < useful.score) useful = next;
      if (next.score <= limit) {
        best = next;
        for (let pass = 0; pass < 10; pass++) {
          const middle = (lower + upper) / 2, candidate = attempt(middle);
          if (candidate.score <= limit) { upper = middle; best = candidate; } else lower = middle;
        }
        break;
      }
    }
    return best.score <= limit ? best : useful.plan ? useful : best;
  };
  let best = search(1);
  const marginFits = best.score <= 1 + 1e-6;
  // If the requested padding cannot fit, prefer keeping bodies visible with
  // a small safety margin over declaring failure solely because of padding.
  const visibilityLimit = p.padding * .995;
  if (!marginFits && !impossibleSweep) {
    const relaxed = search(visibilityLimit);
    if (relaxed.score < best.score) best = relaxed;
  }
  if (!best.plan) throw best.error ?? new Error("This framing could not be fitted. Reduce travel or choose a wider shot.");
  const plan = best.plan;
  plan.coverage = { fits: best.score <= p.padding + 1e-6, margin_fits: marginFits, visible_fraction: best.visible_fraction, distance_scale: best.scale, samples: boxes.length };
  if (plan.coverage.fits) plan.warnings.push("Whole-clip fit: selected body regions stay in view at the checked frame times. One camera-distance adjustment is used; lens and move amounts are unchanged.");
  if (plan.coverage.fits && !marginFits) plan.warnings.push("Framing margin was reduced to keep the selected regions visible with this lens and move.");
  if (!plan.coverage.fits) plan.warnings.push(impossibleSweep
    ? "This pan/tilt sweeps wider than the lens can cover. Some actors may leave frame. Reduce the turn angle or choose a wider lens."
    : "This combination can still crop selected actors. Try a wider lens, smaller travel/turn angle, or a wider output ratio.");
  if (best.scale > 4) plan.warnings.push("Keeping this move in frame needs a distant camera. A smaller move or wider lens can keep the actors larger.");
  return plan;
}
