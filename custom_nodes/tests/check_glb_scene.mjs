// Local capture fixture: {descriptor, files:[actorGLBs...,cameraFBX], references:[nativeFBXs...]}
// No source media, job identifiers, or account credentials are bundled with tests.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from '../web/vendor/build/three.module.js';
import {FBXLoader} from '../web/vendor/examples/jsm/loaders/FBXLoader.js';
import {GLTFLoader} from '../web/vendor/examples/jsm/loaders/GLTFLoader.js';
import {CapturedScene} from '../web/camera_scene.js';
import {applyCamera} from '../web/camera_motion.js';

globalThis.window={innerWidth:1920,innerHeight:1080};
const fixture=JSON.parse(readFileSync(process.argv[2]));
const bytes=(path)=>{const b=readFileSync(path);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};
const buffers=fixture.files.map(bytes),references=fixture.references.map((p)=>p?bytes(p):null);
const capture=new CapturedScene(fixture.descriptor,buffers,references);
try {
  await capture.ready;
  assert.deepEqual(capture.actors.map(a=>a.number),fixture.descriptor.actors.map(a=>a.actor));
  assert.ok(capture.actors.every(a=>a.format==='glb'&&a.timing.verified));
  let largestJointError=0,faceChannels=0;
  const shirtColors=[];
  for(const [index,actor] of capture.actors.entries()) {
    const original=await new GLTFLoader().parseAsync(buffers[index],'');
    const native=new FBXLoader().parse(references[index],'');
    native.scale.multiplyScalar(fixture.descriptor.actors[index].native_reference.meters_per_unit);
    const clip=native.animations[0];
    const mixer=new THREE.AnimationMixer(native),action=mixer.clipAction(clip).setLoop(THREE.LoopOnce,1).play();action.clampWhenFinished=true;
    const pairs=[];
    actor.root.traverse(n=>{if(n.isBone){const match=native.getObjectByName(n.name);if(match?.isBone)pairs.push([n,match])}});
    assert.ok(pairs.length>=8);
    const meshes=[],sourceMeshes=[],facePairs=[];
    original.scene.traverse(n=>{if(n.isMesh)sourceMeshes.push(n)});
    const nativeMeshes=[];native.traverse(n=>{if(n.morphTargetInfluences)nativeMeshes.push(n)});
    actor.root.traverse(n=>{if(n.isMesh)meshes.push(n)});
    for(const [i,mesh] of meshes.entries()) {
      const source=sourceMeshes[i];
      assert.equal(mesh.name,source.name);
      assert.deepEqual(mesh.geometry.groups,source.geometry.groups);
      const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];
      const sourceMaterials=Array.isArray(source.material)?source.material:[source.material];
      assert.deepEqual(materials.map(m=>m.name),sourceMaterials.map(m=>m.name));
      const normals=mesh.geometry.getAttribute('normal');
      assert.ok(normals);
      assert.ok(Array.from(normals.array).some((value,i)=>Math.abs(value-normals.array[i%3])>1e-3),'Placeholder normals were not rebuilt.');
      for(const m of materials) {
        if(m.name.toLowerCase()==='shirt')shirtColors.push(m.color.toArray());
        if(m.name.toLowerCase()==='body')assert.ok(m.color.r>.05);
      }
      const counterpart=nativeMeshes.find(n=>n.name===mesh.name)??nativeMeshes[0];
      for(const [name,i] of Object.entries(mesh.morphTargetDictionary??{})) {
        const j=counterpart?.morphTargetDictionary?.[name];
        if(j!==undefined)facePairs.push([mesh,i,counterpart,j]);
      }
    }
    assert.ok(facePairs.length>=72,'Facial morph channels were lost.');faceChannels+=facePairs.length;
    for(const time of [0,1,5,clip.duration*.75,clip.duration]) {
      capture.setTime(time);action.paused=false;action.enabled=true;mixer.setTime(Math.min(time,clip.duration-1e-7));native.updateMatrixWorld(true);
      for(const [a,b] of pairs) {
        const error=a.getWorldPosition(new THREE.Vector3()).distanceTo(b.getWorldPosition(new THREE.Vector3()));
        largestJointError=Math.max(largestJointError,error);
        assert.ok(error<.05,`Actor ${actor.number} deviated ${error} m at ${time}.`);
        if(time===0||time===clip.duration)assert.ok(error<.0001,'First/last poses are not aligned.');
      }
      for(const [a,i,b,j] of facePairs)assert.ok(Math.abs(a.morphTargetInfluences[i]-b.morphTargetInfluences[j])<1e-5,'Facial timestamps changed.');
    }
    mixer.stopAllAction();mixer.uncacheRoot(native);
    for(const root of [native,original.scene])root.traverse(n=>{n.geometry?.dispose();for(const m of Array.isArray(n.material)?n.material:[n.material])m?.dispose()});
  }
  assert.equal(new Set(shirtColors.map(c=>c.join(','))).size,capture.actors.length);
  capture.setTime(0);const initial=capture.camera.position.clone();
  capture.setTime(capture.duration);capture.setTime(0);
  assert.ok(capture.camera.position.distanceTo(initial)<1e-7);
  const settings={mode:'bookends',target_actor:capture.actors[2]?.number??capture.actors[0].number,
    start:{position:[0,2,5],target:[0,1,0],fov:45},end:{position:[2,2,5],target:[0,1,0],fov:60}};
  for(const t of [0,capture.duration/2,capture.duration]){capture.setTime(t);applyCamera(capture,settings,t,capture.duration);assert.ok(capture.camera.quaternion.toArray().every(Number.isFinite));}
  console.log(JSON.stringify({actors:capture.actors.length,loadedFormat:'GLB',faceChannels,largestJointErrorMeters:largestJointError,
    verified:'material regions, palettes, meter scale/world placement, first/last pose, resampled motion, original facial timestamps, reverse seek, captured and edited cameras'}));
} finally {capture.dispose();}
