import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CapturedScene} from '../web/camera_scene.js';
import {applyCamera} from '../web/camera_motion.js';
import {presetDefaults} from '../web/camera_presets.js';
const fixture=JSON.parse(readFileSync(process.argv[2]));
const bytes=path=>{if(!path)return null;const b=readFileSync(path);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);};
for(const motion of fixture.motions){
 const descriptor=motion.scene;
 const buffers=[...descriptor.actors.map(asset=>bytes(fixture.root+'/'+asset.subfolder+'/'+asset.filename)),null];
 const scene=new CapturedScene(descriptor,buffers);
 try{
  await scene.ready;
  assert.equal(scene.actors.length,descriptor.actors.length);
  assert.equal(scene.duration,motion.timeline.duration);
  assert.ok(scene.camera.position.toArray().every(Number.isFinite));
  let material;
  scene.actors[0].root.traverse(object=>{if(object.isMesh)material=object.material;});
  assert.equal(material.name,'OriginalMaterial');
  assert.ok(Math.abs(material.color.g-.6)<1e-6,'Original GLB colors must be preserved.');
  if(descriptor.camera.format==='camera_json'){
    scene.setTime(1);assert.ok(Math.abs(scene.camera.position.x-.5)<1e-6);
  }else{
    const first=scene.camera.position.clone();scene.setTime(2);assert.ok(scene.camera.position.distanceTo(first)<1e-8);
  }
  for(const behavior of ['static','move','follow']){
    const p={...presetDefaults(scene.actors.map(actor=>actor.number),0),behavior,movement:behavior==='move'?'orbit':behavior==='follow'?'track_subjects':'fixed'};
    const settings={schema_version:1,mode:'preset',camera_index:0,preset:p};
    for(const time of [0,.5,1,2]){
      scene.setTime(time);applyCamera(scene,settings,time,scene.duration);
      assert.ok([...scene.camera.position.toArray(),...scene.camera.quaternion.toArray(),scene.camera.fov].every(Number.isFinite));
    }
  }
 }finally{scene.dispose();}
}
console.log('Independent GLB scene: default camera, JSON path interpolation, original materials, static/orbit/follow framing and disposal passed.');
