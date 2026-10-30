import assert from 'node:assert/strict';
import * as T from '../web/vendor/build/three.module.js';
import {presetDefaults,presetPlan,manualFramingState} from '../web/camera_presets.js';
import {applyCamera} from '../web/camera_motion.js';
import {chooseAimMarker,migrateHeldAim} from '../web/target_controls.js';
import {positionContext} from '../web/camera_position.js';
import {imagePoint} from '../web/lens_projection.js';
const root=new T.Group();const bones={};for(const [name,x,y,z] of [['c_spine0',0,.9,0],['c_head',0,1.7,0],['l_uparm',-.2,1.4,0],['r_uparm',.2,1.4,0],['l_wrist',-.4,1.3,.4],['r_wrist',.4,1.3,.4]]){const b=new T.Bone();b.name=name;b.position.set(x,y,z);root.add(b);bones[name]=b;}
const capture={actors:[{number:1,root}],duration:3,camera:new T.PerspectiveCamera(45,16/9,.01,1000),setTime(t){root.position.x=t*2;root.position.y=.2*Math.sin(t*8);bones.l_wrist.position.y=1.3+.4*Math.sin(t*10);root.updateMatrixWorld(true);this.time=t;}};
const marker=[1,1.4,.4],recipe={...presetDefaults([1]),target_mode:'marker',custom_target:marker,aim_source:'reference',tracking_mode:'exact',horizontal:'custom',custom_position:[2,2,5],reference_time:1,frame_reference:'upper_left',behavior:'move',movement:'orbit',orbit_degrees:60,path_anchor:'fixed',pacing:'constant'};
for(const lens of ['natural','fisheye'])for(const mode of ['preset','bookends']){
 const s={mode,preset:{...recipe,lens},manual_path:{kind:'line',aim:'shot',pacing:'linear'},start:{position:[2,2,5]},end:{position:[-2,3,4]}};
 const values=[];
 for(const time of [0,.23,1,2.95,3,.23]){
  capture.setTime(time);applyCamera(capture,s,time,3);
  const local=new T.Vector3(...marker).sub(capture.camera.position).applyQuaternion(capture.camera.quaternion.clone().invert());const screen=imagePoint(local,capture.camera.fov,capture.camera.aspect,lens==='fisheye');
  assert.ok(Math.abs(screen.x+1/3)<1e-5&&Math.abs(screen.y-1/3)<1e-5,`${mode} ${lens}: fixed marker left its composition anchor`);
  const state=manualFramingState(capture,s.preset);assert.deepEqual(state.target.toArray(),marker);assert.deepEqual(state.body.toArray(),marker);
  values.push({q:capture.camera.quaternion.toArray(),fov:capture.camera.fov});
 }
 assert.deepEqual(values[1],values.at(-1),'Seeking changed fixed-marker aiming');assert.ok(values.every(v=>v.fov===values[0].fov),'Marker targeting changed lens during playback');
 const fresh=structuredClone(s);fresh.preset.custom_target=[-1,1,.5];capture.setTime(.23);applyCamera(capture,fresh,.23,3);assert.ok(capture.camera.quaternion.angleTo(new T.Quaternion(...values[1].q))>.1,'Moving the marker did not invalidate the cached aiming target');
}
const held={mode:'bookends',preset:{...presetDefaults([1]),focus_point:'hands',aim_source:'reference',reference_time:1.2,tracking_mode:'auto',frame_reference:'center'},manual_path:{kind:'line',aim:'shot',pacing:'linear'},start:{position:[0,2,5]},end:{position:[2,2,5]}};
const e={capture,settings:structuredClone(held),time:2.5,currentFrameTime:()=>2.5,sampleTime:t=>capture.setTime(t),manualPathEditor:{selected:'end_position'},activateAim(){this.settings.manual_path.aim='shot';}};
capture.setTime(1.2);const expected=manualFramingState(capture,held.preset).focus.toArray();
const old=structuredClone(e.settings);const poses=[0,.7,2.4,3].map(t=>{capture.setTime(t);applyCamera(capture,old,t,3);return capture.camera.quaternion.clone();});
assert.equal(migrateHeldAim(e),true);assert.deepEqual(e.settings.preset.custom_target,expected);assert.equal(e.manualPathEditor.selected,'aim_marker');assert.equal(e.manualPathEditor.lastCameraMarker,'end_position');
for(const [i,t] of [0,.7,2.4,3].entries()){capture.setTime(t);applyCamera(capture,e.settings,t,3);assert.ok(poses[i].angleTo(capture.camera.quaternion)<1e-7,'Migrating a held pose changed its authored aim');}
assert.equal(migrateHeldAim(e),false,'Migration repeated');assert.equal(positionContext(e).id,'end_position','Selecting the aim marker changed which camera endpoint position controls edit');
const live={...e,settings:structuredClone(held),manualPathEditor:{selected:'start_position'}};live.settings.preset.aim_source='live';live.settings.preset.custom_target=null;chooseAimMarker(live);capture.setTime(2.5);assert.deepEqual(live.settings.preset.custom_target,manualFramingState(capture,{...held.preset,aim_source:'live'}).focus.toArray(),'New marker was seeded from a different frame');
assert.deepEqual(live.settings.start.position,held.start.position);assert.deepEqual(live.settings.end.position,held.end.position);
for(const bad of [null,[0,1],[NaN,0,0],[true,0,0],[100001,0,0]])assert.throws(()=>presetPlan(capture,{mode:'preset',preset:{...recipe,custom_target:bad}},3),/aim marker/);
console.log('PASS: fixed world-space marker, manual/preset paths, perspective/fisheye thirds, fixed lenses, deterministic seeking/cache invalidation, held-pose migration and current-pose marker seeding.');
// The same visibility hook is used for camera preview and every exported VIDEO frame.
const {ManualPathEditor}=await import('../web/manual_path_editor.js');
const overlay=()=>({hidden:false,style:{}}),dot=new T.Mesh(new T.SphereGeometry(.01),new T.MeshBasicMaterial({color:0}));dot.position.fromArray(marker);
const editor={capture,settings:{mode:'preset',preset:recipe},overviewCamera:new T.PerspectiveCamera(45,1,.01,100),viewport:{clientWidth:1000}};editor.overviewCamera.position.set(0,2,6);editor.overviewCamera.lookAt(0,1,0);editor.overviewCamera.updateMatrixWorld(true);
const path=Object.assign(Object.create(ManualPathEditor.prototype),{editor,root:new T.Group(),overlay:overlay(),nav:overlay(),gizmo:{enabled:false},framingStatus:{},refit:{},active:()=>true,markers:new Map([['aim_marker',dot]]),buttons:new Map([['aim_marker',{style:{},classList:{toggle(){}}}]])});path.root.add(dot);
path.sceneVisibility(true,500,400);assert.equal(path.root.visible,true);assert.equal(path.buttons.get('aim_marker').hidden,true,'The aim marker unexpectedly displayed a label');
path.sceneVisibility(false,500,400);assert.equal(path.root.visible,false,'Marker/gizmo leaked into the camera pass');assert.deepEqual(dot.position.toArray(),marker);
console.log('PASS: marker and shared gizmo are scene-only, with no marker label in the camera preview or VIDEO visibility pass.');
const following={...e,settings:{mode:'preset',preset:{...held.preset,behavior:'follow',movement:'track_subjects',horizontal:'custom',custom_position:[0,2,5]}},manualPathEditor:{selected:'camera_position'}};
const beforeFollow=[0,.7,2.4,3].map(t=>{capture.setTime(t);applyCamera(capture,following.settings,t,3);return {position:capture.camera.position.clone(),fov:capture.camera.fov};});
assert.equal(migrateHeldAim(following),true);assert.equal(following.settings.mode,'bookends');
for(const [i,t] of [0,.7,2.4,3].entries()){capture.setTime(t);applyCamera(capture,following.settings,t,3);assert.ok(beforeFollow[i].position.distanceTo(capture.camera.position)<1e-7,'A held Follow shot lost its route during migration');assert.ok(Math.abs(beforeFollow[i].fov-capture.camera.fov)<1e-8);}
console.log('PASS: saved Follow routes retain their positions and lenses when their held aim becomes a fixed marker.');
