import assert from 'node:assert/strict';
import * as THREE from '../web/vendor/build/three.module.js';
import {alignGLB, retimeBodyTracks} from '../web/glb_timing.js';

function sample(step, setup) {
  const make = (extra) => {
    const root = new THREE.Group();
    const tracks = [];
    for (let i = 0; i < 8; i++) {
      const bone = new THREE.Bone(); bone.name = `bone_${i}`; root.add(bone);
      tracks.push(new THREE.VectorKeyframeTrack(`${bone.name}.position`, extra ? [0,step,1+step] : [0,1],
        extra ? [0,0,0, i,1,0, i+1,1,0] : [i,1,0,i+1,1,0]));
    }
    const clip = new THREE.AnimationClip('test', -1, tracks);
    return {root,clip};
  };
  return [make(setup),make(false)];
}
function seek(actor,time) {
  for (const track of actor.clip.tracks) {
    const node = actor.root.getObjectByName(track.name.split('.')[0]);
    node.position.fromArray(track.createInterpolant().evaluate(time));
  }
  actor.root.updateMatrixWorld(true);
}
for (const step of [1/24,1/30,1/60,1/120]) {
  const [actor,reference] = sample(step,true);
  const timing = alignGLB(actor,reference,seek);
  assert.equal(timing.verified,true);
  assert.ok(Math.abs(timing.start-step)<1e-7);
  const face = new THREE.NumberKeyframeTrack('face.morphTargetInfluences',[0,.5,1],[.1,.4,.9]);
  const faceTimes = Array.from(face.times), faceValues = Array.from(face.values);
  actor.clip.tracks.push(face);
  retimeBodyTracks(actor.clip,timing);
  assert.deepEqual(Array.from(face.times),faceTimes);
  assert.deepEqual(Array.from(face.values),faceValues);
  actor.clip.tracks.pop();
  for (const time of [0,.5,1]) {
    seek(actor,time);seek(reference,time);
    assert.ok(actor.root.children[7].position.distanceTo(reference.root.children[7].position)<1e-6);
  }
}
const [already,reference]=sample(1/30,false);
assert.deepEqual(alignGLB(already,reference,seek),{start:0,scale:1,verified:true});
const [mismatched,native]=sample(1/30,true);
native.root.children[7].name='different-bone';
assert.equal(alignGLB(mismatched,native,seek).verified,false);
console.log('Verified setup-frame alignment derives 24/30/60/120 sampling, preserves legitimate first poses and facial timestamps, and rejects mismatched skeletons.');
