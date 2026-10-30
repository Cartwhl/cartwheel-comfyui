import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {CapturedScene} from '../web/camera_scene.js';
import * as THREE from '../web/vendor/build/three.module.js';
globalThis.window??={innerWidth:1920,innerHeight:1080};
const root=mkdtempSync(join(tmpdir(),'cw-whole-scene-'));
try{
 const source=`
import sys,types,importlib,json
from pathlib import Path
sys.path.insert(0,'tests')
from fbx_fixture import scene_fbx
from motion_fixture import scene_glb
pkg=types.ModuleType('whole_scene_check');pkg.__path__=[str(Path.cwd())];sys.modules[pkg.__name__]=pkg
io=importlib.import_module(pkg.__name__+'.motion_io')
root=Path(sys.argv[1]);out=root/'output';out.mkdir();results=[]
for kind,data in [('glb',scene_glb()),('fbx',scene_fbx()),('fbx',scene_fbx(skinned=True)),('fbx',scene_fbx(skinned=True,start=5)),('fbx',scene_fbx(skinned=True,world_x=500))]:
 path=root/('scene.'+kind);path.write_bytes(data);results.append(io.import_motion([path],None,out))
print(json.dumps(results))
`;
 const motions=JSON.parse(execFileSync('python3',['-c',source,root],{cwd:fileURLToPath(new URL('..',import.meta.url)),encoding:'utf8'}));
 const bytes=asset=>{const b=readFileSync(join(root,'output',asset.subfolder,asset.filename));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);};
 for(const motion of motions){
  const descriptor=motion.scene,scene=new CapturedScene(descriptor,[...descriptor.actors.map(bytes),bytes(descriptor.camera)]);
  try{
   await scene.ready;
   assert.equal(scene.actors.length,2);assert.equal(scene.backgrounds.length,1);assert.equal(scene.cameras.length,1);
   for(const actor of scene.actors){let meshes=0;actor.root.traverse(n=>{if(n.isMesh)meshes++;});assert.equal(meshes,1,'Other actors and background are excluded from the target rig.');}
   let cameraMeshes=0;scene.cameraScene.root.traverse(n=>{if(n.isMesh)cameraMeshes++;});assert.equal(cameraMeshes,0,'Embedded camera does not render duplicate geometry.');
   const position=actor=>{let object;actor.root.traverse(n=>{if(n.isBone || (!object&&n.isMesh))object=n;});return object.getWorldPosition(new THREE.Vector3());};
   scene.setTime(0);const before=scene.actors.map(position);
   scene.setTime(1);const middle=scene.actors.map(position);
   scene.group.updateMatrixWorld(true);
   scene.actors.forEach((actor,i)=>{let mesh;actor.root.traverse(n=>{if(n.isMesh)mesh=n;});
    const vertex=mesh.getVertexPosition(0,new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
    assert.ok(vertex.toArray().every(Number.isFinite),'Skinned geometry remains renderable after separation.');
   });
   assert.ok(Math.abs(before[1].x-before[0].x-3)<1e-5,'Original relative placement survives scene separation.');
   const expected=descriptor.camera.format==='glb'?[.4,.4]:[.5,1];
   for(let i=0;i<2;i++)assert.ok(Math.abs(middle[i].x-before[i].x-expected[i])<1e-4,`Actor ${i+1} keeps its own animation: ${middle[i].x-before[i].x}`);
   assert.ok(scene.camera.position.distanceTo(new THREE.Vector3(1.5+before[0].x,1.5,10))<1e-5,'Embedded camera position uses original world coordinates.');
   const actual=scene.camera.quaternion.clone();assert.ok(actual.angleTo(new THREE.Quaternion())<1e-5,'Embedded camera basis is correct.');
   scene.setTime(0);scene.actors.map(position).forEach((p,i)=>assert.ok(p.distanceTo(before[i])<1e-6));
  }finally{scene.dispose();}
 }
 console.log('Whole GLB/FBX scenes: independent targets, repeated names, skinning, nonzero starts, background, embedded cameras, coordinate bases, reverse seek and disposal passed.');
}finally{rmSync(root,{recursive:true,force:true});}
