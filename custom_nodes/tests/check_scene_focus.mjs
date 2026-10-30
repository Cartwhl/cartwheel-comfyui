import assert from 'node:assert/strict';
import * as T from '../web/vendor/build/three.module.js';
import {focusInspection} from '../web/scene_focus.js';
const overviewCamera=new T.PerspectiveCamera(45,1,.01,1000);overviewCamera.position.set(8,6,10);overviewCamera.lookAt(1,2,3);overviewCamera.updateMatrixWorld(true);
const camera=new T.PerspectiveCamera();camera.position.set(30,15,20);
const e={capture:{camera},overviewCamera,controls:{target:new T.Vector3(1,2,3),update(){}},render(){}};
const direction=overviewCamera.getWorldDirection(new T.Vector3()),original=camera.position.clone();
for(const point of [[100,25,-70],[0,1,0],[-90,50,300]]){
 focusInspection(e,point);assert.ok(e.controls.target.distanceTo(new T.Vector3(...point))<1e-9);assert.ok(Math.abs(e.overviewCamera.position.distanceTo(e.controls.target)-2)<1e-9);assert.ok(direction.distanceTo(e.overviewCamera.getWorldDirection(new T.Vector3()))<1e-9);assert.deepEqual(camera.position,original);
}
console.log('PASS: focus inspects selected controls from 2m, retains overview angle and never changes output camera.');

const {distanceSliderValue,sliderDistance,DISTANCE_LIMIT}=await import('../web/camera_position.js');
assert.equal(distanceSliderValue(0),DISTANCE_LIMIT);assert.equal(distanceSliderValue(DISTANCE_LIMIT),0);assert.equal(distanceSliderValue(DISTANCE_LIMIT+100),0);
for(const d of [0,1,3,10,DISTANCE_LIMIT])assert.ok(Math.abs(sliderDistance(distanceSliderValue(d))-d)<1e-8);
console.log('PASS: distance slider fills left-to-right from far to close, with unchanged physical distances.');

const {selectionAfterClick}=await import('../web/manual_path_editor.js');
assert.equal(selectionAfterClick('aim_marker','camera_position','camera_position',['camera_position','aim_marker']),'aim_marker');
assert.equal(selectionAfterClick('aim_marker','aim_marker','camera_position',['camera_position','aim_marker']),'camera_position');
assert.equal(selectionAfterClick('aim_marker','aim_marker','point1_out',['start_position','end_position','point1','aim_marker']),'point1_out');
assert.equal(selectionAfterClick('aim_marker','aim_marker','point3_out',['start_position','end_position','aim_marker']),'start_position');
console.log('PASS: custom aim marker toggles back to the last valid camera/path/curve control; one control stays selected.');
