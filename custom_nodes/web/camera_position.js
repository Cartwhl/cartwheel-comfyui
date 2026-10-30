import * as THREE from './vendor/build/three.module.js';
import {manualFramingState,presetPlan} from './camera_presets.js';
import {manualPath,moveMarker} from './manual_path.js?v=20261028-curved-camera-paths';
export const DISTANCE_LIMIT=30.48;
export function positionCoordinates(position,target,forward=[0,0,1]) {
 const dx=position[0]-target[0],dz=position[2]-target[2];
 let orbit=(Math.atan2(forward[0],forward[2])-Math.atan2(dx,dz))*180/Math.PI;
 orbit=((orbit%360)+360)%360;
 return {distance:Math.hypot(dx,dz),height:position[1],orbit};
}
export function positionFromCoordinates(values,target,forward=[0,0,1]) {
 const angle=Math.atan2(forward[0],forward[2])-THREE.MathUtils.degToRad(values.orbit);
 return [target[0]+Math.sin(angle)*values.distance,values.height,target[2]+Math.cos(angle)*values.distance];
}
function rawSelectedPosition(e) {
 if(e.settings.mode==='bookends') {
  if(e.settings.manual_path?.source_static)return {id:'start_position',position:e.settings.start.position};
  const raw=(e.manualPathEditor.selected==='aim_marker'?e.manualPathEditor.lastCameraMarker:e.manualPathEditor.selected)??'start_position';
  const id=raw==='handle1'?'start_position':raw==='handle2'?'end_position':raw.replace(/_(in|out)$/,'');
  if(/^point\d+$/.test(id))return {id,position:manualPath(e.settings).points[Number(id.slice(5))]};
  return {id:id==='end_position'?id:'start_position',position:e.settings[id==='end_position'?'end':'start'].position};
 }
 const plan=presetPlan(e.capture,e.settings,e.capture.duration,e.time);
 return {id:'camera_position',position:plan.anchorPosition.toArray()};
}
export function selectedPosition(e){const p=rawSelectedPosition(e);return e.sequence?.timeline?{...p,position:e.sequence.displayPosition(p.id,p.position)}:p;}
export function positionContext(e) {
 const p=e.settings.preset,selected=selectedPosition(e),restore=e.time;
 let state;
 try {e.capture.setTime(p.aim_source==='live'?e.currentFrameTime():p.reference_time);state=manualFramingState(e.capture,p);}
 finally {e.sampleTime(restore);}
 const target=state.body.toArray(),forward=state.forward.toArray();
 return {...selected,target,forward,...positionCoordinates(selected.position,target,forward)};
}
export function setCameraPosition(e,position,id=selectedPosition(e).id) {
 if(e.sequence?.timeline)position=e.sequence.recipePosition(id,position);
 if(e.settings.mode==='bookends') {
  moveMarker(e.settings,id,position);
  if(e.settings.manual_path?.source_static){moveMarker(e.settings,'end_position',position);}
  e.activateAim();
 }else Object.assign(e.settings.preset,{horizontal:'custom',custom_position:position,position_offset:[0,0,0]});
}

export const distanceSliderValue=distance=>Math.max(0,Math.min(DISTANCE_LIMIT,DISTANCE_LIMIT-distance));
export const sliderDistance=value=>DISTANCE_LIMIT-Math.max(0,Math.min(DISTANCE_LIMIT,value));
