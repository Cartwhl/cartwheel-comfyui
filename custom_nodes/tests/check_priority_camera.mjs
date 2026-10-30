import assert from 'node:assert/strict';
import * as T from '../web/vendor/build/three.module.js';
import {manualPosition,resetCurve,sourceSample,addPathPoint,displayMarkerPosition,moveDisplayMarker} from '../web/manual_path.js';
import {positionCoordinates,positionFromCoordinates,DISTANCE_LIMIT} from '../web/camera_position.js';
import {applyCamera} from '../web/camera_motion.js';
import {presetDefaults} from '../web/camera_presets.js';
const frames=[0,.2,1,1.7,2].map(time=>({time,position:[time,Math.sin(time),4],quaternion:new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),time*.3).toArray(),fov:35+time}));
const s={mode:'bookends',preset:{...presetDefaults([1]),roll:0},start:{position:[...frames[0].position]},end:{position:[...frames.at(-1).position]},manual_path:{kind:'curve',aim:'source',source_frames:frames}};resetCurve(s);
const capture={camera:new T.PerspectiveCamera(45,16/9,.01,1000)};
for(let i=0;i<=200;i++){
 const t=i/200,source=sourceSample(s,t);assert.ok(manualPosition(s,t).distanceTo(source.position)<1e-8);
 applyCamera(capture,s,t*2,2);assert.ok(capture.camera.position.distanceTo(source.position)<1e-8);assert.ok(capture.camera.quaternion.angleTo(source.quaternion)<1e-7);assert.equal(capture.camera.fov,source.fov);
}
const originalOrientation=new T.Quaternion().setFromAxisAngle(new T.Vector3(1,0,0),.123);capture.inputCamera={format:'fbx'};capture.camera.quaternion.copy(originalOrientation);applyCamera(capture,s,.37,2);assert.ok(capture.camera.quaternion.angleTo(originalOrientation)<1e-7,'Opening an imported camera changed its native orientation.');delete capture.inputCamera;
addPathPoint(s);for(let i=0;i<=200;i++)assert.ok(manualPosition(s,i/200).distanceTo(sourceSample(s,i/200).position)<1e-8,'Adding a point changed the imported path.');
const incoming=displayMarkerPosition(s,'point0_in'),finish=[...s.manual_path.controls[1]],out=displayMarkerPosition(s,'point0_out');out[1]+=.25;moveDisplayMarker(s,'point0_out',out);
assert.deepEqual(displayMarkerPosition(s,'point0_in'),incoming,'Free outgoing handle moved the incoming handle.');assert.deepEqual(s.manual_path.controls[1],finish);
const saved=structuredClone(s);for(let i=0;i<=100;i++)assert.ok(manualPosition(saved,i/100).distanceTo(manualPosition(s,i/100))<1e-8);
for(const point of [[0,2,0],[100,9,-50],[-3,-2,4]])for(const forward of [[0,0,1],[1,0,0],[-1,0,-1]]){const target=[1,1,1];assert.ok(new T.Vector3(...positionFromCoordinates(positionCoordinates(point,target,forward),target,forward)).distanceTo(new T.Vector3(...point))<1e-8);}
assert.ok(positionCoordinates([0,3,100],[0,0,0]).distance>DISTANCE_LIMIT);
console.log('PASS: imported positions/rotations/lens and timing, free handles, lossless added points, serialized restore, and shared position coordinates beyond slider range.');
