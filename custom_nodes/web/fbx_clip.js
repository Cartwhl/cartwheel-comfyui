import * as THREE from "./vendor/build/three.module.js";

// Only uploaded FBX actor descriptors carry animation_start. Legacy captures and
// camera FBXs retain their established time mapping. Include boundary samples so
// a take beginning away from frame zero plays from its first pose without a hold.
export function actorClip(clip, descriptor) {
  if (descriptor.format !== 'fbx' || descriptor.animation_start === undefined) return clip;
  if (!clip?.tracks?.length) {
    if (descriptor.embedded || descriptor.background) return null;
    throw new Error('The FBX has no playable animation. Export a baked animated mesh or use GLB.');
  }
  const start = descriptor.animation_start, duration = descriptor.duration, end = start + duration;
  if (![start, duration, end].every(Number.isFinite) || duration <= 0) throw new Error('Invalid FBX animation take timing.');
  const tracks = clip.tracks.map(track => {
    const sample = track.createInterpolant(), size = track.getValueSize();
    const times = [0], values = [...sample.evaluate(start)];
    for (let i = 0; i < track.times.length; i++) {
      const t = track.times[i];
      if (t > start && t < end) {
        times.push(t - start);
        values.push(...track.values.subarray(i * size, (i + 1) * size));
      }
    }
    times.push(duration); values.push(...sample.evaluate(end));
    const copy = track.clone();
    copy.times = new track.times.constructor(times);
    copy.values = new track.values.constructor(values);
    return copy;
  });
  return new THREE.AnimationClip(clip.name, duration, tracks, clip.blendMode);
}
