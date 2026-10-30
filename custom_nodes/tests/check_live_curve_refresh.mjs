import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../web/vendor/build/three.module.js';
import {createTimeline,selectedSegment,CAMERA_COLORS} from '../web/camera_timeline.js';
import {sequencePlan,sequencePose} from '../web/camera_sequence.js';
import {applySingleCamera} from '../web/camera_motion.js';
import {compileInstructions} from '../web/instruction_animation.js';
const sandbox={THREE,selectedSegment,CAMERA_COLORS,sequencePlan,sequencePose,applySingleCamera,CameraPreview:class {}};
for(const [file,name] of [['camera_editor.js','CameraEditor'],['camera_timeline_editor.js','CameraTimelineEditor']]){
 const source=readFileSync(new URL(`../web/${file}`,import.meta.url),'utf8').split('\nfunction hide(')[0].replace(/^import .*;\n/gm,'').replace(`export class ${name}`,`globalThis.${name}=class ${name}`);
 vm.runInNewContext(source,sandbox);
}
const base={schema_version:1,mode:'bookends',world_frame_id:'w',target_actor:null,preset:null,start:{position:[0,2,0],target:[0,1,-1],fov:45},end:{position:[0,2,3],target:[0,1,-1],fov:45},manual_path:{kind:'line',pacing:'linear',aim:'blend'}};
base.camera_timeline=createTimeline(base,4,24);base.camera_timeline.world_frame_id='w';
const frames=[{time:0,position:[0,2,0]},{time:.5,position:[2,2,0]},{time:1.7,position:[3,2,2]},{time:3,position:[2,2,4]},{time:4,position:[0,2,3]}].map(f=>({...f,quaternion:[0,0,0,1],fov:45}));
function candidate(mode){return compileInstructions(base,[{range:{start:0,end:4,ids:['camera-1']},blocks:[{start:0,end:4,transition:'continue',position_interpolation:mode,frames}]}]);}
function fixture(settings,gesture){
 const e=Object.create(sandbox.CameraEditor.prototype),camera=new THREE.PerspectiveCamera(45,16/9,.01,1000);
 Object.assign(e,{settings,capture:{camera,actors:[],duration:4,setTime(){camera.quaternion.identity();camera.userData={};}},scene:new THREE.Scene(),time:1,settingsWidget:{},node:{graph:{}},status:{},manualPathEditor:{gizmo:{dragging:false}},setPlaying(){},setTime(){},syncControls(){}});
 const sequence=Object.create(sandbox.CameraTimelineEditor.prototype);Object.assign(sequence,{editor:e,gesture,undoStack:[],redoStack:[]});e.sequence=sequence;
 // A live editor already has a path group; reload starts without one.
 if(gesture){e.path=new THREE.Group();e.path.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3(1,0,0)]),new THREE.LineBasicMaterial()));e.scene.add(e.path);}
 return e;
}
const positions=e=>Array.from(e.path.children[0].geometry.attributes.position.array);
for(const mode of ['cubic','linear']){
 const settings=candidate(mode),live=fixture(settings,true),reloaded=fixture(JSON.parse(JSON.stringify(settings)),false);
 live.sequence.refresh();reloaded.sequence.refresh();
 assert.deepEqual(positions(live),positions(reloaded),`${mode}: a completed edit must draw the full path immediately, even while an interaction flag is set`);
 assert.equal(live.path.children[0].geometry.attributes.position.count,49);
 assert.deepEqual(JSON.parse(live.settingsWidget.value),settings,'Full redraw does not change the camera recipe');
 for(const time of [.25,.7,2.3,3.5]){
  const a=sequencePose(live.capture,settings.camera_timeline,time,4,applySingleCamera),b=sequencePose(reloaded.capture,reloaded.settings.camera_timeline,time,4,applySingleCamera);
  assert.ok(a.position.distanceTo(b.position)<1e-12,'Live and reloaded playback match');
 }
}
// The low-cost redraw remains available for actual active drags.
const dragging=fixture(candidate('cubic'),true);dragging.makePath();assert.equal(dragging.path.children[0].geometry.attributes.position.count,9);dragging.makePath(true);assert.equal(dragging.path.children[0].geometry.attributes.position.count,49);
const curved=fixture(candidate('cubic'),false),straight=fixture(candidate('linear'),false);curved.sequence.refresh();straight.sequence.refresh();assert.notDeepEqual(positions(curved),positions(straight),'Intentional straight paths must not be converted to curves');
console.log('PASS: completed live curve/linear edits draw identically to reload despite pending interaction flags; sampled playback and persisted settings match; active drags retain their fast preview.');
