import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as T from '../web/vendor/build/three.module.js';
import {FBXLoader} from '../web/vendor/examples/jsm/loaders/FBXLoader.js';
import {CapturedScene,hasNativeMHRActor} from '../web/camera_scene.js';
const landmarks=['c_spine0','c_spine1','c_spine2','c_neck','c_head','l_upleg','r_upleg','l_lowleg','r_lowleg','l_uparm','r_uparm','l_lowarm','r_lowarm','l_foot','r_foot'];
const root=new T.Group();for(const name of landmarks){const bone=new T.Bone();bone.name=name;root.add(bone);}const mesh=new T.SkinnedMesh(new T.BoxGeometry(),new T.MeshBasicMaterial());root.add(mesh);
const candidate={root,clip:{duration:1}};assert.equal(hasNativeMHRActor(candidate),true);
root.children[0].name='unknown';assert.equal(hasNativeMHRActor(candidate),false);root.children[0].name=landmarks[0];
root.remove(mesh);assert.equal(hasNativeMHRActor(candidate),false);root.add(mesh);assert.equal(hasNativeMHRActor({...candidate,clip:null}),false);
mesh.geometry.dispose();mesh.material.dispose();
if(process.argv[2]){
 globalThis.window={innerWidth:1920,innerHeight:1080};globalThis.self=globalThis;
 // Texture pixels are irrelevant to this offline pose/facial-channel comparison.
 globalThis.createImageBitmap=async()=>({width:1,height:1,close(){}});
 const fixture=JSON.parse(readFileSync(process.argv[2]));const bytes=p=>{const b=readFileSync(p);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);};
 const buffers=fixture.files.map(bytes),refs=fixture.references.map(bytes);
 const scene=new CapturedScene(fixture.descriptor,buffers,refs);
 try{
  await scene.ready;assert.equal(scene.actors.length,fixture.descriptor.actors.length);
  let maxPositionError=0,faceChannels=0;
  for(const [i,actor] of scene.actors.entries()){
   assert.equal(actor.format,'fbx');assert.equal(actor.sourceFallback?.to,'native_mhr');
   const native=new FBXLoader().parse(refs[i],'');native.scale.multiplyScalar(fixture.descriptor.actors[i].native_reference.meters_per_unit);
   const mixer=new T.AnimationMixer(native),action=mixer.clipAction(native.animations[0]).setLoop(T.LoopOnce,1).play();action.clampWhenFinished=true;
   const pairs=[],faces=[];actor.root.traverse(n=>{const other=native.getObjectByName(n.name);if(n.isBone&&other?.isBone)pairs.push([n,other]);if(n.morphTargetInfluences&&other?.morphTargetInfluences)faces.push([n,other]);});
   assert.ok(pairs.length>=120);faceChannels+=faces.reduce((sum,[n])=>sum+n.morphTargetInfluences.length,0);
   for(let sample=0;sample<=24;sample++){
    const time=scene.duration*sample/24;scene.setTime(time);action.paused=false;action.enabled=true;mixer.setTime(Math.min(time,native.animations[0].duration-1e-7));native.updateMatrixWorld(true);
    for(const [a,b] of pairs){const error=a.getWorldPosition(new T.Vector3()).distanceTo(b.getWorldPosition(new T.Vector3()));maxPositionError=Math.max(maxPositionError,error);assert.ok(error<1e-8);}
    for(const [a,b] of faces)for(let j=0;j<a.morphTargetInfluences.length;j++)assert.ok(Math.abs(a.morphTargetInfluences[j]-b.morphTargetInfluences[j])<1e-8);
   }
   mixer.stopAllAction();mixer.uncacheRoot(native);
   native.traverse(n=>{n.geometry?.dispose();for(const m of Array.isArray(n.material)?n.material:[n.material])m?.dispose();});
  }
  assert.ok(faceChannels>=72*scene.actors.length);
  scene.setTime(0);const camera=scene.camera.position.clone();scene.setTime(scene.duration);scene.setTime(0);assert.ok(scene.camera.position.distanceTo(camera)<1e-8);
  console.log(JSON.stringify({actors:scene.actors.length,faceChannels,maxPositionError,verified:'Original native world placement, body animation, face channels and captured camera retained.'}));
 }finally{scene.dispose();}
 // A standalone GLB remains authoritative when no native reference is supplied.
 const generic=structuredClone(fixture.descriptor);for(const a of generic.actors){delete a.native_reference;a.duration=a.export_duration??a.duration;}generic.duration=Math.max(...generic.actors.map(a=>a.duration));
 const glbScene=new CapturedScene(generic,buffers);
 try{await glbScene.ready;assert.ok(glbScene.actors.every(a=>a.format==='glb'&&!a.sourceFallback));}finally{glbScene.dispose();}
}
console.log('PASS: fallback requires a complete animated MHR rig and skinned mesh; unrelated/meshless/missing animation references are rejected.');
