import * as THREE from "./vendor/build/three.module.js";

// One rigid registration at frame one. Never scale the route, refit a shot,
// or subtract per-frame actor movement from the original camera animation.
export function cameraRegistration(source, target) {
  const yaw = point => Math.atan2(point.forward.x, point.forward.z);
  return {
    rotation: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw(target) - yaw(source)),
    source: source.position.clone(), target: target.position.clone(),
  };
}

export function registerCamera(camera, registration) {
  camera.position.sub(registration.source).applyQuaternion(registration.rotation).add(registration.target);
  camera.quaternion.premultiply(registration.rotation).normalize();
}

export function cameraSourceTime(seconds, transfer) {
  const time = transfer.timing === "stretch" ? seconds * transfer.source_duration / transfer.target_duration : seconds;
  return Math.max(0, Math.min(transfer.source_duration, time));
}
