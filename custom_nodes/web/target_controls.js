import {manualFramingState,presetPlan,subjectTravel} from './camera_presets.js';
import {resetCurve} from './manual_path.js?v=20261028-curved-camera-paths';
import {selectedPosition} from './camera_position.js?v=20261028-curved-camera-paths';
// Seed a world-space point from the pose currently on screen, or an older held pose.
export function chooseAimMarker(editor,point=null) {
 const p=editor.settings.preset;
 const following=p.behavior==='follow'||['track_subjects','follow','lead','alongside'].includes(p.movement);
 const position=editor.settings.mode==='preset'?(following?editor.capture.camera.position.toArray():selectedPosition(editor).position):null;
 if(!point&&!p.custom_target){
  const restore=editor.time;
  try{editor.capture.setTime(editor.currentFrameTime());const state=manualFramingState(editor.capture,{...p,target_mode:'actors',aim_source:'live'});point=(state.focus??state.target).toArray();}
  finally{editor.sampleTime(restore);}
 }
 editor.activateAim();
 Object.assign(p,{target_mode:'marker',custom_target:[...(point??p.custom_target)],aim_source:'reference',tracking_mode:'exact',aim_behavior:'target',path_anchor:'fixed'});
 if(position)Object.assign(p,{horizontal:'custom',custom_position:[...position],position_offset:[0,0,0]});
 if(p.behavior==='follow'||p.movement==='track_subjects')Object.assign(p,{behavior:'static',movement:'fixed'});
 const path=editor.manualPathEditor;
 if(path){if(path.selected!=='aim_marker')path.lastCameraMarker=path.selected;path.selected='aim_marker';}
}
export function migrateHeldAim(editor) {
 const p=editor.settings.preset;
 if(!p||p.target_mode==='marker'||p.aim_source!=='reference'||editor.settings.manual_path?.aim==='source')return false;
 const restore=editor.time;let point;
 try{editor.capture.setTime(p.reference_time);const state=manualFramingState(editor.capture,p);point=state.focus.toArray();}
 finally{editor.sampleTime(restore);}
 // A previously authored Follow route can still move while holding a point.
 // Retain its sampled route rather than turning that saved shot into a static camera.
 if(editor.settings.mode==='preset'&&subjectTravel(p)){
  const plan=presetPlan(editor.capture,editor.settings,editor.capture.duration,restore);
  const frames=plan.times.map((time,i)=>({time,position:plan.positions[i].toArray(),quaternion:plan.quaternions[i].toArray(),fov:plan.fovs[i]}));
  const pose=f=>({position:[...f.position],target:[...point],fov:f.fov});
  Object.assign(editor.settings,{mode:'bookends',start:pose(frames[0]),end:pose(frames.at(-1)),target_actor:null,manual_path:{kind:'curve',pacing:'linear',aim:'shot',source_frames:frames,framing_priority:'reference'}});
  Object.assign(p,{behavior:'move',movement:'fixed',start_time:0,end_time:0,pacing:'constant'});resetCurve(editor.settings);
 }
 chooseAimMarker(editor,point);return true;
}
