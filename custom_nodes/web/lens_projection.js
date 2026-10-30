import * as THREE from "./vendor/build/three.module.js";
export const isFisheye = (p) => p?.lens === "fisheye";
export const fisheyeVerticalFOV = (diagonal, aspect) => diagonal / Math.hypot(aspect, 1);
// Shared image/ray mapping for fitting, thirds placement and the render shader.
// Equidistant fisheye: image radius is proportional to the angle from optical -Z.
export function imageRay(x, y, fov, aspect, fisheye = false) {
  const half = THREE.MathUtils.degToRad(fov) / 2;
  if (!fisheye) return new THREE.Vector3(x * Math.tan(half) * aspect, y * Math.tan(half), -1).normalize();
  const u = x * aspect,
    r = Math.hypot(u, y),
    theta = r * half;
  return r < 1e-10
    ? new THREE.Vector3(0, 0, -1)
    : new THREE.Vector3((u / r) * Math.sin(theta), (y / r) * Math.sin(theta), -Math.cos(theta));
}
export function imagePoint(local, fov, aspect, fisheye = false) {
  const half = THREE.MathUtils.degToRad(fov) / 2;
  if (!fisheye)
    return new THREE.Vector2(local.x / -local.z / Math.tan(half) / aspect, local.y / -local.z / Math.tan(half));
  const r = Math.hypot(local.x, local.y),
    theta = Math.atan2(r, -local.z),
    scale = r < 1e-10 ? 0 : theta / half / r;
  return new THREE.Vector2((local.x * scale) / aspect, local.y * scale);
}
export function levelElevation(placement, fov, aspect, roll, fisheye = false) {
  if (!placement) return 0;
  const ray = imageRay(placement[0] * 2 - 1, 1 - placement[1] * 2, fov, aspect, fisheye);
  ray.applyAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(roll));
  return -Math.asin(THREE.MathUtils.clamp(ray.y, -1, 1));
}

// A full-frame 36×24 mm filmback is cropped to the output aspect and rotated
// for portrait. This keeps focal lengths physical across every output format.
export function perspectiveVerticalFOV(mm,aspect,preset) {
  const height=preset.lens_calibration==='full_frame'?(aspect>=1?Math.min(24,36/aspect):Math.min(36,24/aspect)):preset.sensor_height;
  return THREE.MathUtils.radToDeg(2*Math.atan(height/(2*mm)));
}
