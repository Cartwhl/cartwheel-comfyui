import * as THREE from "./vendor/build/three.module.js";

import { imageRay, imagePoint } from "./lens_projection.js";

export const FOCUS_POINTS = {
  auto: "Face",
  chest: "Chest",
  back: "Upper back",
  hands: "Both hands",
  left_hand: "Left hand",
  right_hand: "Right hand",
  shoulders: "Both shoulders",
  left_shoulder: "Left shoulder",
  right_shoulder: "Right shoulder",
  hips: "Hips",
  thighs: "Both thighs",
  left_thigh: "Left thigh",
  right_thigh: "Right thigh",
  knees: "Both knees",
  left_knee: "Left knee",
  right_knee: "Right knee",
  feet: "Both feet",
  left_foot: "Left foot",
  right_foot: "Right foot",
};
export const FRAME_REFERENCES = {
  auto: "Auto · balanced composition",
  center: "Center",
  upper_third: "Upper third · centered",
  lower_third: "Lower third · centered",
  left_third: "Left third",
  right_third: "Right third",
  upper_left: "Upper-left thirds",
  upper_right: "Upper-right thirds",
  lower_left: "Lower-left thirds",
  lower_right: "Lower-right thirds",
};
export const DETAIL_SHOTS = {
  extreme_close: "Extreme close · cropped detail",
  close: "Close · focus area",
  chest: "Medium close · focus area",
  waist: "Medium · focus area",
  cowboy: "Loose · focus area",
  medium_full: "Wider · focus area",
  full: "Wide · focus area",
  wide: "Very wide · focus area",
  extreme_wide: "Establishing · focus area",
};
// These are dimensionless region/frame ratios, independent of rig/world size.
export const FOCUS_FILL = {
  extreme_close: 1.5,
  close: 0.85,
  chest: 0.65,
  waist: 0.5,
  cowboy: 0.35,
  medium_full: 0.25,
  full: 0.18,
  wide: 0.1,
  extreme_wide: 0.06,
};
export const hasFocus = (p) => p.target_mode==='marker' || p.focus_point && p.focus_point !== "legacy" && p.composition !== "pov";
export function regionFocus(actor, key) {
  const a = actor.anatomy,
    h = actor.height;
  if (key === "auto" || key === "eyes")
    return { point: a.eyeCenter.clone(), points: [a.eyeCenter.clone()], radius: h * 0.075 };
  if (key === "chest" || key === "back") {
    const point = a.chestPoint.clone();
    if (key === "back") point.addScaledVector(actor.chest, -h * 0.065);
    return { point, points: [point], radius: h * 0.12 };
  }
  let points,
    radius = h * 0.035;
  const sides = key.startsWith("left_") ? [0] : key.startsWith("right_") ? [1] : [0, 1];
  if (key.includes("hand")) {
    points = sides.flatMap((i) => a.handPoints[i]);
    radius = h * (a.missingHandDetail ? 0.025 : 0.008);
  } else if (key.includes("shoulder")) {
    points = sides.map((i) => a.shoulders[i]);
    radius = h * 0.055;
  } else if (key === "hips") {
    points = a.hips;
    radius = h * 0.07;
  } else if (key.includes("thigh")) {
    points = sides.map((i) => a.hips[i].clone().lerp(a.knees[i], 0.5));
    radius = h * 0.085;
  } else if (key.includes("knee")) {
    points = sides.map((i) => a.knees[i]);
    radius = h * 0.055;
  } else if (key.includes("foot") || key === "feet") {
    points = sides.flatMap((i) => a.footPoints[i]);
    radius = h * 0.045;
  } else throw new Error("Choose a supported focus point.");
  return { point: new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3()), points, radius };
}
export function focusRegion(actor, p) {
  const focus = regionFocus(actor, p.focus_point);
  const box = new THREE.Box3().setFromPoints(focus.points).expandByScalar(focus.radius);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).multiplyScalar(p.framing_scale / (p.focus_fill || FOCUS_FILL[p.shot]));
  return { focus: focus.point, bounds: new THREE.Box3().setFromCenterAndSize(center, size) };
}
export function screenPlacement(p) {
  if (!hasFocus(p)) return null;
  let key = p.frame_reference;
  if (key === "auto") {
    // Close-up centers its eye/head region to preserve a tight crop. Pinning the
    // same crown to the upper third can make head and chest shots converge.
    // Wider anatomical shots keep natural headroom/feet rather than shrinking
    // the body merely to put its eyes exactly a third down the image.
    if(p.target_mode==='marker')return [.5,.5];
    if (p.focus_point === "auto" && !["extreme_close", "close", "chest"].includes(p.shot)) return null;
    key =
      p.focus_point === "auto" && ["extreme_close", "close"].includes(p.shot)
        ? "center"
        : ["auto", "eyes"].includes(p.focus_point)
          ? "upper_third"
          : "center";
  }
  if (key === "custom") return [p.frame_x, p.frame_y];
  const positions = {
    center: [0.5, 0.5],
    upper_third: [0.5, 1 / 3],
    lower_third: [0.5, 2 / 3],
    left_third: [1 / 3, 0.5],
    right_third: [2 / 3, 0.5],
    upper_left: [1 / 3, 1 / 3],
    upper_right: [2 / 3, 1 / 3],
    lower_left: [1 / 3, 2 / 3],
    lower_right: [2 / 3, 2 / 3],
  };
  if (!positions[key]) throw new Error("Choose a supported framing reference.");
  return positions[key];
}
const up = new THREE.Vector3(0, 1, 0),
  optical = new THREE.Vector3(0, 0, -1);
export function composedOrientation(position, focus, roll, fov, aspect, placement, fisheye = false) {
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(position, focus, up));
  const horizon = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(roll));
  if (!placement) return q.multiply(horizon);
  const ray = imageRay(placement[0] * 2 - 1, 1 - placement[1] * 2, fov, aspect, fisheye);
  const unrolled = ray.clone().applyQuaternion(horizon);
  const direction = focus.clone().sub(position).normalize();
  const span = Math.hypot(unrolled.y, unrolled.z);
  if (Math.abs(direction.y) <= span + 1e-10) {
    // Solve yaw/pitch with the chosen horizon roll, rather than introducing an
    // accidental Dutch angle when both placement axes are offset.
    const pitch = Math.asin(THREE.MathUtils.clamp(direction.y / span, -1, 1)) - Math.atan2(unrolled.y, -unrolled.z);
    const z = unrolled.y * Math.sin(pitch) + unrolled.z * Math.cos(pitch);
    const yaw = Math.atan2(unrolled.x, -z) - Math.atan2(direction.x, -direction.z);
    return new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, "YXZ")).multiply(horizon);
  }
  // Near vertical views have no unique level horizon. Preserve exact placement
  // with the smallest optical correction when a level yaw/pitch solution fails.
  return q.multiply(horizon).multiply(new THREE.Quaternion().setFromUnitVectors(ray, optical));
}
export function boxCorners(bounds) {
  const points = [];
  for (const x of [bounds.min.x, bounds.max.x])
    for (const y of [bounds.min.y, bounds.max.y])
      for (const z of [bounds.min.z, bounds.max.z]) points.push(new THREE.Vector3(x, y, z));
  return points;
}
export function fitComposition(
  bounds,
  focus,
  normal,
  fov,
  aspect,
  roll,
  padding,
  placement,
  verticalOnly = false,
  fisheye = false,
) {
  const points = bounds.framingPoints || boxCorners(bounds),
    tan = Math.tan(THREE.MathUtils.degToRad(fov) / 2);
  const fits = (distance) => {
    const position = focus.clone().addScaledVector(normal, distance);
    const inverse = composedOrientation(position, focus, roll, fov, aspect, placement, fisheye).invert();
    return points.every((point) => {
      const local = point.clone().sub(position).applyQuaternion(inverse),
        depth = -local.z,
        projected = fisheye ? imagePoint(local, fov, aspect, true) : null;
      return (
        depth > 0.015 &&
        (projected ? Math.abs(projected.y) : Math.abs(local.y) / depth / tan) * padding <= 1 &&
        (verticalOnly || (projected ? Math.abs(projected.x) : Math.abs(local.x) / depth / tan / aspect) * padding <= 1)
      );
    });
  };
  let lower = 0.04,
    upper = 0.08;
  while (!fits(upper) && upper < 4096) {
    lower = upper;
    upper *= 2;
  }
  if (!fits(upper)) throw new Error("This focus and framing position cannot fit. Move the frame reference inward.");
  for (let i = 0; i < 22; i++) {
    const middle = (lower + upper) / 2;
    if (fits(middle)) upper = middle;
    else lower = middle;
  }
  return upper;
}
