import * as THREE from './vendor/build/three.module.js';
import { composedOrientation } from './camera_composition.js';
import { imagePoint } from './lens_projection.js';
import {actionFollowPlan} from './action_follow.js';

export const TRACKING_DEFAULTS={aim_source:'legacy',follow_strength:.25,tracking_mode:'legacy',vertical_tracking:'auto',room_horizontal:.12,room_vertical:.16,pan_smoothing:.3,tilt_smoothing:.75,framing_motion:false,framing_start_x:1/3,framing_start_y:1/3,framing_end_x:2/3,framing_end_y:1/3};
export function trackingOptions(p) {
  if(p.aim_source==='live'){
    const tight=THREE.MathUtils.clamp(p.follow_strength??.25,0,1),blend=tight*tight;
    return {live:true,vertical:'gentle',horizontal:.8*(1-blend),verticalRoom:.7*(1-blend),
      pan:THREE.MathUtils.lerp(2.8,.035,blend),tilt:THREE.MathUtils.lerp(3.2,.035,blend),
      maxPan:THREE.MathUtils.lerp(12,240,blend),maxTilt:THREE.MathUtils.lerp(10,240,blend),acceleration:THREE.MathUtils.lerp(20,1200,blend)};
  }
  const custom=p.tracking_mode==='custom';
  const broad=(!p.focus_point||['auto','legacy'].includes(p.focus_point))&&!['extreme_close','close','chest'].includes(p.shot);
  const vertical=custom&&p.vertical_tracking!=='auto'?p.vertical_tracking:broad?'grounded':'gentle';
  // Tight shots get less drift and quicker reactions than broad body shots.
  return {vertical,horizontal:custom?p.room_horizontal:broad?.12:.06,verticalRoom:custom?p.room_vertical:broad?.16:.08,
    pan:custom?p.pan_smoothing:broad?.3:.18,tilt:custom?p.tilt_smoothing:broad?.75:.45};
}
export function trackingWindow(opt,center) {
  return {left:Math.max(0,center[0]-opt.horizontal/2),right:Math.min(1,center[0]+opt.horizontal/2),top:Math.max(0,center[1]-opt.verticalRoom/2),bottom:Math.min(1,center[1]+opt.verticalRoom/2)};
}
export function trackingPlacement(p,time,duration,fallback) {
  if(!p.framing_motion) return fallback;
  const t=THREE.MathUtils.clamp(duration>0?time/duration:0,0,1),s=t*t*(3-2*t);
  return [THREE.MathUtils.lerp(p.framing_start_x,p.framing_end_x,s),THREE.MathUtils.lerp(p.framing_start_y,p.framing_end_y,s)];
}
export function steadyTargets(states,p,times,anchor) {
  const opt=trackingOptions(p),reference=states[anchor],grounded=opt.vertical==='grounded';
  if(p.aim_source==='live')return states.map(s=>s.target.clone());
  if(p.aim_source==='reference')return states.map(()=>reference.target.clone());
  const exact=['exact','legacy'].includes(p.tracking_mode);
  const desired=states.map(s=>{
    if(p.tracking_mode==='off') return reference.target.clone();
    if(exact||opt.vertical==='exact')return s.target.clone();
    if(grounded)return new THREE.Vector3(reference.target.x+s.body.x-reference.body.x,reference.target.y,reference.target.z+s.body.z-reference.body.z);
    return s.target.clone();
  });
  if(exact||p.tracking_mode==='off')return desired;
  const out=[];out[anchor]=desired[anchor].clone();
  for(const direction of [1,-1])for(let i=anchor+direction;i>=0&&i<desired.length;i+=direction){
    const j=i-direction,dt=Math.abs(times[i]-times[j]),point=desired[i].clone();
    // Horizontal filtering removes pose noise without sacrificing travel. Grounded
    // height is exact; gentle height follows sustained changes rather than steps.
    const xz=1-Math.exp(-dt/.12),y=opt.vertical==='gentle'?1-Math.exp(-dt/opt.tilt):1;
    point.x=THREE.MathUtils.lerp(out[j].x,point.x,xz);point.z=THREE.MathUtils.lerp(out[j].z,point.z,xz);point.y=THREE.MathUtils.lerp(out[j].y,point.y,y);out[i]=point;
  }
  return out;
}
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
function easeAxis(current,desired,velocity,dt,tau,maxSpeed,maxAcceleration) {
  const delta=wrap(desired-current);
  const wanted=THREE.MathUtils.clamp(delta*(1-Math.exp(-dt/Math.max(.001,tau)))/dt,-maxSpeed,maxSpeed);
  const speed=THREE.MathUtils.clamp(wanted,velocity-maxAcceleration*dt,velocity+maxAcceleration*dt);
  const step=speed*dt;
  // Stop cleanly at the desired angle, with no inertial overshoot.
  if(step*delta>=0&&Math.abs(step)>Math.abs(delta))return{angle:current+delta,speed:0};
  return {angle:current+step,speed};
}
export function trackingPlan({positions,states,times,referenceIndex:anchor,p,aspect,fovs,duration,placements}) {
  const opt=trackingOptions(p),targets=steadyTargets(states,p,times,anchor),fisheye=p.lens==='fisheye';
  const placement=i=>trackingPlacement(p,times[i],duration,placements?.[i]??states[i].placement??null);
  const orient=(i,point,where=placement(i))=>composedOrientation(positions[i],positions[i].distanceToSquared(point)<1e-10?positions[i].clone().add(new THREE.Vector3(0,0,-1)):point,p.roll,fovs[i],aspect,where,fisheye);
  if(p.aim_source==='live')return actionFollowPlan({positions,states,times,p,aspect,fovs,duration,referenceIndex:anchor,placements:times.map((_,i)=>placement(i))});
  const quaternions=[];quaternions[anchor]=orient(anchor,targets[anchor]);
  const exact=p.aim_source==='live'?(p.follow_strength??.25)>=.999:p.aim_source==='reference'||['exact','legacy','off'].includes(p.tracking_mode);
  if(exact){for(let i=0;i<times.length;i++)quaternions[i]=orient(i,targets[i]);return{quaternions,targets,options:opt,times,referenceIndex:anchor};}
  for(const direction of [1,-1]){
    let vx=0,vy=0;
    for(let i=anchor+direction;i>=0&&i<times.length;i+=direction){
      const j=i-direction,dt=Math.max(1e-6,Math.abs(times[i]-times[j]));
      const previous=quaternions[j],center=placement(i)??[.5,.5];
      const local=targets[i].clone().sub(positions[i]).applyQuaternion(previous.clone().invert());
      const projected=imagePoint(local,fovs[i],aspect,fisheye),x=(projected.x+1)/2,y=(1-projected.y)/2;
      let window=trackingWindow(opt,center);
      const {left,right,top,bottom}=window;
      const inside=-local.z>.005&&Number.isFinite(x)&&Number.isFinite(y)&&x>=left&&x<=right&&y>=top&&y<=bottom;
      let desired;
      if(inside){desired=previous;vx=0;vy=0;}
      else {
        const edge=-local.z>.005&&Number.isFinite(x)&&Number.isFinite(y)?[THREE.MathUtils.clamp(x,left,right),THREE.MathUtils.clamp(y,top,bottom)]:center;
        desired=orient(i,targets[i],edge);
      }
      const a=new THREE.Euler().setFromQuaternion(previous,'YXZ'),b=new THREE.Euler().setFromQuaternion(desired,'YXZ');
      const pan=easeAxis(a.y,b.y,vx,dt,opt.pan,THREE.MathUtils.degToRad(opt.maxPan??60),THREE.MathUtils.degToRad(opt.acceleration??180));
      const tilt=easeAxis(a.x,b.x,vy,dt,opt.tilt,THREE.MathUtils.degToRad(opt.maxTilt??35),THREE.MathUtils.degToRad(opt.acceleration??100));
      vx=pan.speed;vy=tilt.speed;
      const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt.angle,pan.angle,b.z,'YXZ'));
      // Near a vertical look direction Euler yaw is ill-conditioned; limit a
      // quaternion step instead of allowing a sudden pole/roll flip.
      quaternions[i]=Math.abs(b.x)>1.45?previous.clone().rotateTowards(desired,THREE.MathUtils.degToRad(opt.maxTilt??35)*dt):q;
    }
  }
  return{quaternions,targets,options:opt,times,referenceIndex:anchor};
}
export function sampleTracking(plan,time) {
  const times=plan.times;let a=0,b=times.length-1;
  while(a<b){const m=Math.ceil((a+b)/2);if(times[m]<=time)a=m;else b=m-1;}
  b=Math.min(a+1,times.length-1);const t=a===b?0:THREE.MathUtils.clamp((time-times[a])/(times[b]-times[a]),0,1);
  return plan.quaternions[a].clone().slerp(plan.quaternions[b],t);
}
