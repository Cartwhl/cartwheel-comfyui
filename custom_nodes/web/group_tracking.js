import * as THREE from "./vendor/build/three.module.js";
import { boxCorners, hasFocus, screenPlacement } from "./camera_composition.js";
import { imagePoint, isFisheye } from "./lens_projection.js";
const HOLD = 0.25,
  TRANSITION = 0.35;
const mean = (points) => points.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / points.length);
// Build the complete timeline around its saved reference pose. Group membership
// never depends on playback/seek order, and unselected actors never participate.
export function trackMajority(frames, fullTargets, times, anchor, p, aspect, fovs, positionFor, orientationFor) {
  const ids = p.actors,
    all = (1 << ids.length) - 1;
  const useBounds = hasFocus(p) ? !screenPlacement(p) : p.aim === "auto";
  const prepared = frames.map((frame) =>
    frame.map((s) => ({ ...s, points: s.bounds.framingPoints || boxCorners(s.bounds) })),
  );
  const cache = prepared.map(() => new Map());
  const candidate = (index, mask) => {
    if (cache[index].has(mask)) return cache[index].get(mask);
    const chosen = prepared[index].filter((s, i) => mask & (1 << i));
    const target =
      mask === all
        ? fullTargets[index].clone()
        : useBounds
          ? chosen.reduce((b, s) => b.union(s.bounds), new THREE.Box3()).getCenter(new THREE.Vector3())
          : mean(chosen.map((s) => s.target));
    const value = { mask, target, ids: ids.filter((id, i) => mask & (1 << i)) };
    cache[index].set(mask, value);
    return value;
  };
  const assess = (index, c) => {
    const position = positionFor(index, c.target),
      inverse = orientationFor(position, c.target, fovs[index]).invert();
    const fits = (s) => {
      const project = (point) => {
        const local = point.clone().sub(position).applyQuaternion(inverse);
        if (-local.z <= 0.015) return false;
        const xy = imagePoint(local, fovs[index], aspect, isFisheye(p));
        return Math.abs(xy.x) <= 1.00001 && Math.abs(xy.y) <= 1.00001;
      };
      // A region may be deliberately cropped (e.g. eyes). Require its center and
      // at least half its boundary samples, not every finger or silhouette vertex.
      return project(s.target) && s.points.filter(project).length >= Math.ceil(s.points.length / 2);
    };
    const visible = prepared[index].map(fits);
    return {
      ...c,
      visible: visible.filter(Boolean).length,
      cohesive: c.ids.every((id) => visible[ids.indexOf(id)]),
      count: c.ids.length,
    };
  };
  const choices = new Array(times.length),
    targets = new Array(times.length),
    members = new Array(times.length);
  choices[anchor] = all;
  targets[anchor] = fullTargets[anchor].clone();
  members[anchor] = ids.slice();
  const scan = (direction) => {
    let current = all,
      pending = null,
      held = 0,
      fromWeights = new Map([[all, 1]]),
      previousWeights = new Map([[all, 1]]),
      blend = TRANSITION;
    for (let index = anchor + direction; index >= 0 && index < times.length; index += direction) {
      const dt = Math.abs(times[index] - times[index - direction]);
      let best;
      const previous = candidate(index, current);
      const rank = (c) => [
        c.cohesive ? c.count : 0,
        c.visible,
        c.mask === current ? 1 : 0,
        c.ids.filter((id) => previous.ids.includes(id)).length,
        c.ids.includes(p.reference_actor) ? 1 : 0,
      ];
      const better = (a, b) => {
        const x = rank(a),
          y = rank(b);
        for (let j = 0; j < x.length; j++) if (x[j] !== y[j]) return x[j] > y[j];
        return a.mask < b.mask;
      };
      let whole;
      try {
        whole = assess(index, candidate(index, all));
      } catch {
        whole = { cohesive: false };
      }
      if (whole.cohesive) best = whole;
      for (let mask = 1; !whole.cohesive && mask <= all; mask++) {
        let c;
        try {
          c = assess(index, candidate(index, mask));
        } catch {
          continue;
        }
        if (!best || better(c, best)) best = c;
      }
      const desired = best?.mask ?? current;
      if (desired !== current) {
        if (pending !== desired) {
          pending = desired;
          held = 0;
        }
        held += dt;
        if (held >= HOLD) {
          fromWeights = new Map(previousWeights);
          current = desired;
          blend = 0;
          pending = null;
          held = 0;
        }
      } else {
        pending = null;
        held = 0;
      }
      blend = Math.min(TRANSITION, blend + dt);
      const t = blend / TRANSITION,
        ease = t * t * (3 - 2 * t);
      const weights = new Map([...fromWeights].map(([mask, weight]) => [mask, weight * (1 - ease)]));
      weights.set(current, (weights.get(current) || 0) + ease);
      targets[index] = new THREE.Vector3();
      for (const [mask, weight] of weights)
        if (weight > 1e-8) targets[index].addScaledVector(candidate(index, mask).target, weight);
      previousWeights = weights;
      choices[index] = current;
      members[index] = candidate(index, current).ids;
    }
  };
  scan(1);
  scan(-1);
  return { targets, members, hold_seconds: HOLD, transition_seconds: TRANSITION };
}
