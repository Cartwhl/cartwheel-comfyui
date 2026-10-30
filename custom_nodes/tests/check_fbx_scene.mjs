import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {CapturedScene} from '../web/camera_scene.js';
import {applyCamera} from '../web/camera_motion.js';
import {presetDefaults} from '../web/camera_presets.js';
import {actorClip} from '../web/fbx_clip.js';
import * as THREE from '../web/vendor/build/three.module.js';

const root=mkdtempSync(join(tmpdir(),'cw-fbx-check-'));
try {
 const source=`
import importlib, json, sys, types
from pathlib import Path
sys.path.insert(0,'tests')
from fbx_fixture import animated_fbx
from motion_fixture import animated_glb
pkg=types.ModuleType('fbx_fixture_package');pkg.__path__=[str(Path.cwd())];sys.modules[pkg.__name__]=pkg
io=importlib.import_module(pkg.__name__+'.motion_io')
root=Path(sys.argv[1]);out=root/'output';out.mkdir()
scenes=[]
for version in [7400,7700]:
 for start in [0,5]:
  for scale in [1.,100.]:
   actor=root/'actor.fbx';actor.write_bytes(animated_fbx(version=version,start=start,scale=scale,compressed=True,distance=20000/scale))
   scenes.append(io.import_motion([actor],None,out))
glb=root/'actor.glb';glb.write_bytes(animated_glb())
scenes.append(io.import_motion([actor,glb,actor,glb],None,out))
print(json.dumps(scenes))
`;
 const motions=JSON.parse(execFileSync('python3',['-c',source,root],{cwd:fileURLToPath(new URL('..',import.meta.url)),encoding:'utf8'}));
 const bytes=asset=>{const b=readFileSync(join(root,'output',asset.subfolder,asset.filename));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);};
 for(const motion of motions){
  const descriptor=motion.scene, scene=new CapturedScene(descriptor,[...descriptor.actors.map(bytes),null]);
  try{
   await scene.ready;
   assert.equal(scene.actors.length,descriptor.actors.length);
   assert.equal(scene.duration,2);
   const actor=scene.actors[0];let mesh;
   actor.root.traverse(node=>{if(node.isMesh)mesh=node;});
   assert.ok(mesh);assert.equal(mesh.material.name,'OriginalMaterial');
   scene.setTime(0);const before=mesh.getWorldPosition(new THREE.Vector3());
   scene.setTime(1);const middle=mesh.getWorldPosition(new THREE.Vector3());
   scene.setTime(2);const after=mesh.getWorldPosition(new THREE.Vector3());
   assert.ok(Math.abs(middle.x-before.x-100)<1e-3,`FBX midpoint units/timing: ${middle.x-before.x}`);
   assert.ok(Math.abs(after.x-before.x-200)<1e-3,`FBX end units/timing: ${after.x-before.x}`);
   scene.setTime(0);assert.ok(mesh.getWorldPosition(new THREE.Vector3()).distanceTo(before)<1e-6,'Reverse seek returns to first pose.');
   for(const behavior of ['static','move','follow']){
    const settings={schema_version:1,mode:'preset',camera_index:0,preset:{...presetDefaults(scene.actors.map(a=>a.number),0),behavior,movement:behavior==='move'?'orbit':behavior==='follow'?'track_subjects':'fixed'}};
    for(const time of [0,.5,1,2]){scene.setTime(time);applyCamera(scene,settings,time,scene.duration);assert.ok([...scene.camera.position.toArray(),...scene.camera.quaternion.toArray(),scene.camera.fov].every(Number.isFinite));}
   }
  }finally{scene.dispose();}
 }
 // Takes cropped between original keys preserve interpolated boundary poses and rotation.
 const q0=new THREE.Quaternion(),q1=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI);
 const clip=new THREE.AnimationClip('Take',4,[new THREE.VectorKeyframeTrack('Actor.position',[0,4],[0,0,0,4,0,0]),new THREE.QuaternionKeyframeTrack('Actor.quaternion',[0,4],[...q0.toArray(),...q1.toArray()])]);
 const cropped=actorClip(clip,{format:'fbx',animation_start:1,duration:2});
 assert.equal(cropped.duration,2);assert.deepEqual([...cropped.tracks[0].times],[0,2]);
 assert.deepEqual([...cropped.tracks[0].values],[1,0,0,3,0,0]);
 assert.equal(clip.tracks[0].times[1],4,'Original clip stays intact.');
 assert.equal(actorClip(clip,{format:'fbx'}),clip,'Legacy timing stays intact.');
 assert.equal(actorClip(clip,{format:'glb',animation_start:1}),clip,'GLB timing stays intact.');
 assert.throws(()=>actorClip(null,{format:'fbx',animation_start:0,duration:2}),/no playable animation/);
 console.log('FBX scenes: 8 version/start/unit combinations, compressed geometry, four mixed actors, material preservation, reverse seek, camera behaviors, clip boundaries and legacy timing passed.');
}finally{rmSync(root,{recursive:true,force:true});}
