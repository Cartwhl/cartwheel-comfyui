import * as THREE from "./vendor/build/three.module.js";

// Verify a possible exported setup frame against the same actor's native motion.
// Never infer padding from a rest-looking pose or assume an export frame rate.
export function alignGLB(actor, reference, seek) {
  const pairs = [];
  actor.root.traverse((node) => {
    const native = reference.root.getObjectByName(node.name);
    if (node.isBone && native?.isBone) pairs.push([node, native]);
  });
  const raw = { start: 0, scale: 1, verified: false };
  if (pairs.length < 8 || !actor.clip || !reference.clip) return raw;
  const error = (sourceTime, nativeTime) => {
    seek(actor, sourceTime); seek(reference, nativeTime);
    const errors = pairs.map(([a, b]) => a.getWorldPosition(new THREE.Vector3()).distanceTo(b.getWorldPosition(new THREE.Vector3())));
    return { max: Math.max(...errors), rms: Math.sqrt(errors.reduce((sum, e) => sum + e*e, 0) / errors.length) };
  };
  const first = error(0, 0);
  const last = error(actor.clip.duration, reference.clip.duration);
  const matchesInterior = (start, scale) => [0.25, 0.5, 0.75].every((fraction) => {
    const time = reference.clip.duration * fraction;
    const e = error(start + time * scale, time);
    // GLB resampling can change interpolated joint positions by a few cm.
    return e.max <= 0.05 && e.rms <= 0.025;
  });
  // Keep a legitimate first pose, including a static/rest pose, untouched.
  if (first.max < 0.0001 && last.max < 0.0001 && matchesInterior(0, 1)) {
    return { ...raw, verified: true };
  }
  const candidates = [...new Set(actor.clip.tracks.filter((track) => !track.name.endsWith(".morphTargetInfluences")).map((track) => Array.from(track.times).find((time) => time > 0)))];
  const firstSample = candidates.sort((a, b) => a - b).find((time) =>
    Number.isFinite(time) && time <= 0.1 && error(time, 0).max < 0.0001);
  if (firstSample === undefined || first.rms < 0.001 ||
      Math.abs(actor.clip.duration - firstSample - reference.clip.duration) > firstSample * 1.1 ||
      last.max >= 0.0001) return raw;
  const scale = (actor.clip.duration - firstSample) / reference.clip.duration;
  if (!matchesInterior(firstSample, scale)) return raw;
  return { start: firstSample, scale, verified: true };
}

export function retimeBodyTracks(clip, timing) {
  if (timing.start === 0 && timing.scale === 1) return;
  for (const track of clip.tracks) {
    // Face channels retain their independent source timestamps.
    if (!track.name.endsWith(".morphTargetInfluences")) {
      track.times = Float32Array.from(track.times, (time) => (time - timing.start) / timing.scale);
    }
  }
  clip.resetDuration();
}
