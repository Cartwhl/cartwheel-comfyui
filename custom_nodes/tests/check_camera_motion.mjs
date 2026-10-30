import assert from "node:assert/strict";
import * as THREE from "../web/vendor/build/three.module.js";
import { applyCamera, cameraPath } from "../web/camera_motion.js";

const root = new THREE.Group();
const head = new THREE.Bone(); head.name = "c_head"; head.position.y = 1.7; root.add(head); root.updateMatrixWorld(true);
const camera = new THREE.PerspectiveCamera(50, 16/9, .01, 100);
const capture = { actors: [{number:3,root}], camera, duration:2,
  setTime(t) { head.position.x = t; root.updateMatrixWorld(true); camera.position.set(0,2,5); camera.lookAt(0,1,0); camera.fov=50; camera.updateMatrixWorld(true); }
};
const settings = {mode:"bookends",target_actor:null,
  start:{position:[0,2,5],target:[0,1,0],fov:40},end:{position:[4,4,5],target:[2,1,0],fov:60}};
for (const [time,position,fov] of [[0,[0,2,5],40],[1,[2,3,5],50],[2,[4,4,5],60]]) {
  capture.setTime(time); applyCamera(capture,settings,time,2);
  assert.deepEqual(camera.position.toArray(),position); assert.equal(camera.fov,fov);
  const target = new THREE.Vector3(time,1,0);
  const direction = target.sub(camera.position).normalize();
  assert.ok(camera.getWorldDirection(new THREE.Vector3()).distanceTo(direction)<1e-8);
}
const roundTrip = JSON.parse(JSON.stringify(settings));
capture.setTime(1);applyCamera(capture,roundTrip,1,2);
assert.deepEqual(camera.position.toArray(),[2,3,5]);
const following = {...settings,target_actor:3};
capture.setTime(0);applyCamera(capture,following,0,2);
const initialDirection = camera.getWorldDirection(new THREE.Vector3());
capture.setTime(2);applyCamera(capture,following,2,2);
const actual = camera.getWorldDirection(new THREE.Vector3());
const expected = new THREE.Vector3(2,1.4,0).sub(camera.position).normalize();
assert.ok(actual.distanceTo(expected)<1e-8);assert.ok(actual.distanceTo(initialDirection)>.01);
assert.throws(()=>applyCamera(capture,{...following,target_actor:1},1,2),/available/);
capture.setTime(1);const original = camera.position.clone();applyCamera(capture,{mode:"captured"},1,2);assert.ok(camera.position.equals(original));
const points = cameraPath(capture,settings,2);
assert.deepEqual(points[0].toArray(),settings.start.position);assert.deepEqual(points.at(-1).toArray(),settings.end.position);
console.log("Camera endpoints, midpoint position/aim/FOV, JSON reload, sparse actor targeting, moving target, captured-camera preservation and render-path sampling passed.");
