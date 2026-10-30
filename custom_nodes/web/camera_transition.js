import * as THREE from './vendor/build/three.module.js';
import {manualFramingSamples} from './camera_presets.js';
import {actionFollowPlan,actionFeedback} from './action_follow.js';
import {screenPlacement} from './camera_composition.js';
import {perspectiveVerticalFOV,fisheyeVerticalFOV} from './lens_projection.js';
import {movementProgress} from './movement_timing.js';

const cache=new WeakMap();
const targetKeys=['target_mode','custom_target','actors','selection','composition','reference_actor'];
export const TRANSITION_FIELDS=['target','focus_point','frame_reference','follow_strength','focal_length','roll','fisheye_fov'];
export function endpointRecipe(p,transition,side){
 const recipe={...p,camera_transition:null,framing_motion:false,aim_source:'live',reference_time:0},endpoint=transition[side]??{};
 for(const field of transition.fields??[])for(const key of field==='target'?targetKeys:[field])if(endpoint[key]!==undefined)recipe[key]=structuredClone(endpoint[key]);
 if((transition.fields??[]).includes('focal_length')&&p.lens!=='fisheye')recipe.lens='custom';
 return recipe;
}
const mean=s=>s.focusTargets?.length?s.focusTargets.reduce((v,r)=>v.add(r.point),new THREE.Vector3()).multiplyScalar(1/s.focusTargets.length):s.target.clone();
export function blendFocusStates(a,b,t){
 const left=mean(a),right=mean(b),target=left.clone().lerp(right,t);
 // Pair each part with the opposite endpoint's center. Every selected hand or
 // actor contributes to containment, even when endpoint actor counts differ.
 const focusPoints=[...(a.focusPoints??[]).map(v=>v.clone().lerp(right,t)),...(b.focusPoints??[]).map(v=>left.clone().lerp(v,t))];
 return {target,body:(a.body??left).clone().lerp(b.body??right,t),focusTargets:[{point:target,radius:0}],focusPoints};
}
export function applyCameraTransition(capture,settings,time,duration,baseApply){
 const p=settings?.preset,transition=p?.camera_transition;
 if(!transition?.enabled||!transition.fields?.length||['captured','history'].includes(settings.mode))return;
 const camera=capture.camera,aspect=camera.aspect,key=JSON.stringify([settings,duration,aspect]);
 let plan=cache.get(capture);
 if(plan?.key!==key){
  const saved={position:camera.position.clone(),quaternion:camera.quaternion.clone(),fov:camera.fov,userData:{...camera.userData}};
  try{
   const start=endpointRecipe(p,transition,'start'),end=endpointRecipe(p,transition,'end');
   const a=manualFramingSamples(capture,start,duration,time),b=manualFramingSamples(capture,end,duration,time);
   const times=a.times,positions=[],baseQuaternions=[],fovs=[],rolls=[],strengths=[],placements=[],states=[];
   for(let i=0;i<times.length;i++){
    const t=times[i],u=movementProgress(t,settings.camera_animation_range?{...p,start_time:settings.camera_animation_range[0],end_time:settings.camera_animation_range[1]}:p,duration);capture.setTime(t);baseApply(capture,settings,t,duration);
    positions.push(camera.position.clone());baseQuaternions.push(camera.quaternion.clone());
    states.push(blendFocusStates(a.states[i],b.states[i],u));
    const placeA=screenPlacement(start)??[.5,.5],placeB=screenPlacement(end)??[.5,.5];
    placements.push(placeA.map((v,k)=>THREE.MathUtils.lerp(v,placeB[k],u)));
    strengths.push(THREE.MathUtils.lerp(start.follow_strength??.25,end.follow_strength??.25,u));
    rolls.push(THREE.MathUtils.lerp(start.roll??0,end.roll??0,u));
    const animatedFov=p.lens==='fisheye'&&transition.fields.includes('fisheye_fov')?fisheyeVerticalFOV(THREE.MathUtils.lerp(start.fisheye_fov,end.fisheye_fov,u),aspect)
      :p.lens!=='fisheye'&&transition.fields.includes('focal_length')?perspectiveVerticalFOV(THREE.MathUtils.lerp(start.focal_length,end.focal_length,u),aspect,p):camera.fov;
    fovs.push(animatedFov);
   }
   const changesAim=transition.fields.some(k=>['target','focus_point','frame_reference','follow_strength'].includes(k));
   const follow=changesAim?actionFollowPlan({positions,states,times,p,aspect,fovs,placements,duration,strengths,rolls}):{times,quaternions:baseQuaternions.map((q,i)=>q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),THREE.MathUtils.degToRad(rolls[i]-(p.roll??0)))))};
   plan={key,...follow,fovs};cache.set(capture,plan);
  }finally{capture.setTime(time);camera.position.copy(saved.position);camera.quaternion.copy(saved.quaternion);camera.fov=saved.fov;Object.assign(camera.userData,saved.userData);camera.updateMatrixWorld(true);}
 }
 let a=0,b=plan.times.length-1;while(a<b){const m=Math.ceil((a+b)/2);if(plan.times[m]<=time)a=m;else b=m-1;}
 b=Math.min(a+1,plan.times.length-1);const u=a===b?0:THREE.MathUtils.clamp((time-plan.times[a])/(plan.times[b]-plan.times[a]),0,1);
 camera.quaternion.copy(plan.quaternions[a]).slerp(plan.quaternions[b],u);
 camera.fov=THREE.MathUtils.lerp(plan.fovs[a],plan.fovs[b],u);
 camera.userData.cartwheelActionFollow=actionFeedback(plan,time);camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
}
