import * as THREE from './vendor/build/three.module.js';
import {composedOrientation} from './camera_composition.js';
import {imagePoint} from './lens_projection.js';

const clamp=THREE.MathUtils.clamp;
const average=points=>points.reduce((sum,p)=>sum.add(p),new THREE.Vector3()).multiplyScalar(1/points.length);
function nearest(times,t){let a=0,b=times.length-1;while(a<b){const m=Math.ceil((a+b)/2);if(times[m]<=t)a=m;else b=m-1;}return a;}
function weights(times,i,half){
  if(half<1e-5)return [[i,1]];
  const sigma=half/2.5,entries=[];
  for(let j=nearest(times,times[i]-half);j<times.length&&times[j]<=times[i]+half;j++){
    const dt=times[j]-times[i];if(Math.abs(dt)>half)continue;
    const width=(times[Math.min(j+1,times.length-1)]-times[Math.max(0,j-1)])/2||1;
    entries.push([j,Math.exp(-.5*(dt/sigma)**2)*width]);
  }
  return entries;
}
// A local linear fit avoids leading/lagging constant travel at clip boundaries.
// The fit is in world space: authored camera motion never enters this filter.
function fit(points,times,i,entries){
  let w=0,t=0,tt=0;const x=new THREE.Vector3(),tx=new THREE.Vector3();
  for(const [j,weight] of entries){const dt=times[j]-times[i];w+=weight;t+=weight*dt;tt+=weight*dt*dt;x.addScaledVector(points[j],weight);tx.addScaledVector(points[j],weight*dt);}
  const d=w*tt-t*t;
  return Math.abs(d)>1e-12?x.multiplyScalar(tt).addScaledVector(tx,-t).multiplyScalar(1/d):x.multiplyScalar(1/Math.max(w,1e-12));
}
function interpolate(points,times,t){const a=nearest(times,t),b=Math.min(a+1,times.length-1),f=a===b?0:clamp((t-times[a])/(times[b]-times[a]),0,1);return points[a].clone().lerp(points[b],f);}
function motion(points,times,i){
  const h=.2,a=Math.max(times[0],times[i]-h),b=Math.min(times.at(-1),times[i]+h),dt=Math.max(1e-6,b-a);
  const left=interpolate(points,times,a),right=interpolate(points,times,b),center=points[i];
  // Root travel adapts the window; vertical pose bob should not disable smoothing.
  const delta=right.clone().sub(left);delta.y*=.2;
  const speed=delta.length()/dt;
  const dl=times[i]-a,dr=b-times[i];
  const change=dl>.01&&dr>.01?right.sub(center).multiplyScalar(1/dr).sub(center.clone().sub(left).multiplyScalar(1/dl)):new THREE.Vector3();change.y*=.2;
  const acceleration=change.length()*2/dt;
  return {speed,acceleration};
}
function boxPoints(box){return [-1,1].flatMap(x=>[-1,1].flatMap(y=>[-1,1].map(z=>new THREE.Vector3(x<0?box.min.x:box.max.x,y<0?box.min.y:box.max.y,z<0?box.min.z:box.max.z))));}
function projectedBounds(points,position,q,fov,aspect,fisheye){
  const inverse=q.clone().invert();let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity,behind=false;
  for(const point of points){const local=point.clone().sub(position).applyQuaternion(inverse);if(!fisheye&&-local.z<=.005)behind=true;const uv=imagePoint(local,fov,aspect,fisheye);if(!Number.isFinite(uv.x)||!Number.isFinite(uv.y)){behind=true;continue;}const x=(uv.x+1)/2,y=(1-uv.y)/2;left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
  return {left,right,top,bottom,behind};
}
function shift(low,high,margin){
  const min=margin-low,max=1-margin-high;
  // An oversized envelope cannot fit by aiming. Do not chase its moving edges.
  if(min>max)return 0;
  // Fade the framing nudge out continuously before a region becomes too wide.
  // A hard feasible/infeasible switch can snap the camera for a single frame.
  const room=clamp((max-min)/.12,0,1),fade=room*room*(3-2*room);
  return clamp(0,min,max)*fade;
}

export function actionFollowPlan({positions,states,times,p,aspect,fovs,placements,duration,referenceIndex=0,strengths,rolls}){
  const strengthAt=i=>clamp(strengths?.[i]??p.follow_strength??.25,0,1);
  const count=Math.min(...states.map(s=>s.focusTargets?.length||1));
  const tracks=Array.from({length:count},(_,k)=>states.map(s=>s.focusTargets?.[k]?.point??s.target));
  const raw=times.map((_,i)=>average(tracks.map(track=>track[i])));

  const bodies=states.map((s,i)=>s.body??raw[i]);
  const coarseBody=bodies.map((_,i)=>fit(bodies,times,i,weights(times,i,.8)));
  const targets=[],quaternions=[],focusLimited=[],windows=[],screenWindows=[],baseOrientations=[],corrections=[];
  const fisheye=p.lens==='fisheye',baseHalf=.9;
  for(let i=0;i<times.length;i++){
    const strength=strengthAt(i),exact=strength>=.999;
    const distance=Math.max(.01,positions[i].distanceTo(raw[i]));
    const viewHeight=2*distance*Math.tan(THREE.MathUtils.degToRad(Math.min(fovs[i],150))/2);
    const {speed,acceleration}=motion(coarseBody,times,i);
    const half=exact?0:Math.min(baseHalf,Math.max(.06,.35*viewHeight/Math.max(speed,.001)),Math.max(.06,Math.sqrt(.15*viewHeight/Math.max(acceleration,.001))));
    windows.push(half*2);
    const entries=weights(times,i,half);
    const smooth=average(tracks.map(track=>fit(track,times,i,entries)));
    // Strength controls how much gesture motion survives, across the full range.
    // Changing a filter radius alone compresses most visible change near 100%.
    const target=exact?raw[i].clone():smooth.lerp(raw[i],strength);
    targets.push(target);
    const point=positions[i].distanceToSquared(target)<1e-10?positions[i].clone().add(new THREE.Vector3(0,0,-1)):target;
    const place=[...(placements?.[i]??states[i].placement??[.5,.5])];
    const orient=where=>composedOrientation(positions[i],point,rolls?.[i]??p.roll,fovs[i],aspect,where,fisheye);
    let q=orient(place);const uncorrected=q.clone();
    // Reserve room for each selected part's nearby motion, independently. A
    // bouncing gesture yields a stable envelope rather than a moving bullseye.
    const envelope=[];
    for(let k=0;k<count;k++){
      const box=new THREE.Box3();
      for(const [j] of entries){const region=states[j].focusTargets?.[k];const center=tracks[k][j],radius=region?.radius??0,extent=region?.halfSize??new THREE.Vector3(radius,radius,radius);box.expandByPoint(center.clone().add(extent));box.expandByPoint(center.clone().sub(extent));}
      envelope.push(...boxPoints(box));
    }
    const points=[...envelope,...(states[i].focusPoints??[])];
    const margin=.04;
    if(!exact){
      const box=projectedBounds(points,positions[i],q,fovs[i],aspect,fisheye);
      if(!box.behind){
        const x=shift(box.left,box.right,margin),y=shift(box.top,box.bottom,margin);
        if(Math.abs(x)+Math.abs(y)>=1e-5){
          place[0]=clamp(place[0]+x,.02,.98);place[1]=clamp(place[1]+y,.02,.98);q=orient(place);
        }
      }
    }
    if(!exact)q=uncorrected.clone().slerp(q,1-strength);
    baseOrientations.push(uncorrected.clone());
    corrections.push(uncorrected.clone().invert().multiply(q));
    screenWindows.push({left:margin,right:1-margin,top:margin,bottom:1-margin});
    quaternions.push(q);
  }
  for(let i=0;i<times.length;i++){
    if(strengthAt(i)>=.999)continue;
    // Filter only the local framing offset. Filtering final camera orientations
    // would reintroduce lag when the authored camera moves along its path.
    const reference=corrections[i],sum=new THREE.Vector4(0,0,0,0);
    for(const [j,weight] of weights(times,i,.2)){
      const offset=corrections[j],sign=reference.dot(offset)<0?-1:1;
      sum.addScaledVector(new THREE.Vector4(offset.x,offset.y,offset.z,offset.w),weight*sign);
    }
    const offset=sum.lengthSq()>1e-12?new THREE.Quaternion(sum.x,sum.y,sum.z,sum.w).normalize():reference;
    quaternions[i]=baseOrientations[i].clone().multiply(offset).normalize();
  }
  for(let i=0;i<times.length;i++){
    const current=projectedBounds(states[i].focusPoints?.length?states[i].focusPoints:tracks.map(track=>track[i]),positions[i],quaternions[i],fovs[i],aspect,fisheye);
    focusLimited.push(current.behind||current.left<-.005||current.right>1.005||current.top<-.005||current.bottom>1.005);
  }
  return {quaternions,targets,times,referenceIndex,options:{live:true,worldSpace:true},focusLimited,windows,screenWindows,duration};
}
export function actionFeedback(plan,time){
  if(!plan?.focusLimited)return null;
  const i=nearest(plan.times,time);return {limited:plan.focusLimited[i],window:plan.windows[i],screenWindow:plan.screenWindows[i]};
}
