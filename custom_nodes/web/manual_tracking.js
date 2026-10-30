import {actionFeedback} from './action_follow.js';
import {manualFramingSamples} from './camera_presets.js';
import {manualPosition,pathProgress} from './manual_path.js?v=20261028-curved-camera-paths';
import {trackingPlan,sampleTracking} from './aim_tracking.js';
import {cameraAspect} from './camera_format.js';

const stateCache=new WeakMap(),planCache=new WeakMap();
export function manualTrackingPlan(capture,settings,duration,lens,restoreTime) {
  const p=settings.preset,aspect=cameraAspect(capture,settings),key=JSON.stringify([settings,aspect,duration,lens.fov]);
  let cached=planCache.get(capture);if(cached?.key===key)return cached.plan;
  const stateKey=JSON.stringify([duration,p.aim_source,p.reference_time,p.actors,p.reference_actor,p.reference_basis,p.target_mode,p.custom_target,p.composition,p.shot,p.focus_point,p.frame_reference,p.frame_x,p.frame_y,p.framing_scale,p.focus_fill,p.framing_version,p.aim,p.target_offset,p.framing_motion]);
  let source=stateCache.get(capture);
  if(source?.key!==stateKey){
    const {times,states,anchor}=manualFramingSamples(capture,p,duration,restoreTime);
    source={key:stateKey,times,states,anchor};stateCache.set(capture,source);
  }
  const positions=source.times.map(t=>manualPosition(settings,pathProgress(settings,t,duration)));
  const result=trackingPlan({positions,states:source.states,times:source.times,referenceIndex:source.anchor,p,aspect,fovs:source.times.map(()=>lens.fov),duration});
  const plan={...result,times:source.times,positions,referenceIndex:source.anchor};planCache.set(capture,{key,plan});return plan;
}
export function manualAimAt(capture,settings,duration,lens,time){const plan=manualTrackingPlan(capture,settings,duration,lens,time);capture.camera.userData.cartwheelActionFollow=actionFeedback(plan,time);
 const times=plan.times;let a=0,b=times.length-1;while(a<b){const m=Math.ceil((a+b)/2);if(times[m]<=time)a=m;else b=m-1;}b=Math.min(a+1,times.length-1);const u=a===b?0:Math.max(0,Math.min(1,(time-times[a])/(times[b]-times[a])));
 capture.camera.userData.cartwheelAimPoint=plan.targets?.[a]?.clone().lerp(plan.targets[b],u)??null;return sampleTracking(plan,time);}
