import assert from 'node:assert/strict';
import * as THREE from '../web/vendor/build/three.module.js';
import { cameraRegistration, registerCamera, cameraSourceTime } from '../web/camera_transfer.js';

const vec = a => new THREE.Vector3(...a);
for (const angle of [0, .5, Math.PI/2, Math.PI, -Math.PI/2]) {
  const rotation = new THREE.Quaternion().setFromAxisAngle(vec([0,1,0]),angle);
  const source = {position:vec([20,1,-5]),forward:vec([0,0,1])};
  const target = {position:vec([-12,1.4,8]),forward:source.forward.clone().applyQuaternion(rotation)};
  const registration = cameraRegistration(source,target);
  for (let t=0;t<=1;t+=.1) {
    const camera = new THREE.PerspectiveCamera(35,16/9,.01,1000);
    camera.position.copy(source.position).add(vec([3.048+t*2,1,2-t]));
    camera.lookAt(source.position);
    const position=camera.position.clone(), orientation=camera.quaternion.clone();
    const local=position.clone().sub(source.position);
    registerCamera(camera,registration);
    camera.updateMatrixWorld(true);
    assert.ok(camera.position.distanceTo(target.position.clone().add(local.applyQuaternion(rotation)))<1e-8);
    assert.ok(Math.abs(camera.position.distanceTo(target.position)-position.distanceTo(source.position))<1e-8);
    assert.ok(camera.quaternion.angleTo(rotation.clone().multiply(orientation))<1e-7);
    assert.equal(camera.fov,35);assert.equal(camera.aspect,16/9);
    const targetScreen=target.position.clone().project(camera);
    assert.ok(Math.abs(targetScreen.x)<1e-8&&Math.abs(targetScreen.y)<1e-8);
  }
}
const transfer={source_duration:5,target_duration:20,timing:'stretch'};
assert.equal(cameraSourceTime(10,transfer),2.5);
assert.equal(cameraSourceTime(20,transfer),5);
assert.equal(cameraSourceTime(-1,transfer),0);
assert.equal(cameraSourceTime(10,{...transfer,timing:'hold'}),5);
assert.equal(cameraSourceTime(3,{...transfer,timing:'hold'}),3);
console.log('Camera transfer: rigid alignment, facing, metric distances, lens, framing and both timing modes passed.');
