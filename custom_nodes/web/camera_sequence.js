import * as THREE from './vendor/build/three.module.js';
import {manualPosition,pathProgress} from './manual_path.js?v=20261028-curved-camera-paths';
import {presetPlan} from './camera_presets.js';
import {activeSegment,joinBetween,holdTransition} from './camera_timeline.js?v=20261029-usability-r2';
const entryCaches=new WeakMap(),caches=new WeakMap(),clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const vector=a=>new THREE.Vector3().fromArray(a??[0,0,0]);
const copy=p=>({...p,position:p.position.clone(),quaternion:p.quaternion.clone()});
function read(camera){return {position:camera.position.clone(),quaternion:camera.quaternion.clone(),fov:camera.fov,aspect:camera.aspect,near:camera.near,far:camera.far,fisheye:!!camera.userData.cartwheelFisheye,aim:camera.userData.cartwheelAimPoint?.clone(),feedback:camera.userData.cartwheelActionFollow};}
export function writeCameraPose(camera,p){camera.position.copy(p.position);camera.quaternion.copy(p.quaternion);camera.fov=p.fov;camera.aspect=p.aspect;camera.near=p.near;camera.far=p.far;camera.userData.cartwheelFisheye=p.fisheye;camera.userData.cartwheelActionFollow=p.feedback;camera.updateProjectionMatrix();camera.updateMatrixWorld(true);}
function build(capture,timeline,duration,single){
 const entries=new Map();let reusable=entryCaches.get(capture);if(!reusable){reusable=new Map();entryCaches.set(capture,reusable);}const live=new Set();
 for(const item of timeline.segments){
  live.add(item.id);const signature=JSON.stringify([item.settings,item.start,item.end,item.source_start,item.source_end,item.animation_range,duration,capture.camera.aspect]);
  const existing=reusable.get(item.id);if(existing?.signature===signature&&existing.single===single){entries.set(item.id,existing.entry);continue;}
  const segment=structuredClone(item);
  // Position/aim edits share the same actor-time mapping. Retain its sampled
  // anatomy cache instead of resampling every actor at 60 Hz for every drag.
  const mapping=JSON.stringify([item.start,item.end,item.source_start,item.source_end,item.settings.camera_index,duration]);
  const proxy=existing?.mapping===mapping?existing.entry.proxy:Object.create(capture);proxy.inputCamera=null;
  if(existing?.mapping!==mapping)proxy.setTime=time=>{capture.cameraIndex=segment.settings.camera_index;capture.setTime(clamp(segment.start+(time-segment.source_start)/(segment.source_end-segment.source_start)*(segment.end-segment.start),0,duration));};
  const poses=new Map();
  const raw=time=>{const local=clamp((time-segment.start)/(segment.end-segment.start)),source=segment.source_start+(segment.source_end-segment.source_start)*local,key=source.toFixed(10);
   let p=poses.get(key);if(!p){proxy.cameraIndex=segment.settings.camera_index;proxy.setTime(source);single(proxy,segment.animation_range?{...segment.settings,camera_animation_range:segment.animation_range}:segment.settings,source,duration);p=read(capture.camera);poses.set(key,p);}return copy(p);};
  const entry={segment,proxy,raw,start:raw(segment.start),end:raw(segment.end)};entries.set(segment.id,entry);reusable.set(item.id,{signature,entry,mapping,single});
 }
 for(const id of reusable.keys())if(!live.has(id))reusable.delete(id);
 const offsets=new Map();
 for(const s of timeline.segments)offsets.set(s.id,{start:vector(s.offset_start),end:vector(s.offset_end)});
 for(const join of timeline.joins){if(!join.connected)continue;const left=entries.get(join.left),right=entries.get(join.right);if(!left||!right)continue;
  const point=join.point?vector(join.point):left.end.position.clone().add(offsets.get(left.segment.id).end);
  offsets.get(left.segment.id).end.copy(point).sub(left.end.position);offsets.get(right.segment.id).start.copy(point).sub(right.start.position);
 }
 const position=(s,time)=>{
  const entry=entries.get(s.id),u=clamp((time-s.start)/(s.end-s.start)),source=s.source_start+(s.source_end-s.source_start)*u;let p;
  if(s.settings.mode==='bookends')p=manualPosition(entry.segment.settings,pathProgress(entry.segment.settings,source,duration));
  else if(s.settings.mode==='preset'){
   const plan=presetPlan(entry.proxy,entry.segment.settings,duration,source);let a=0,b=plan.times.length-1;
   while(a<b){const m=Math.ceil((a+b)/2);if(plan.times[m]<=source)a=m;else b=m-1;}b=Math.min(a+1,plan.times.length-1);
   const v=a===b?0:clamp((source-plan.times[a])/(plan.times[b]-plan.times[a]));p=plan.positions[a].clone().lerp(plan.positions[b],v);
  }else p=entry.raw(time).position;
  const o=offsets.get(s.id);return p.add(o.start.clone().lerp(o.end,u));
 };
 const sample=(s,time)=>{const p=entries.get(s.id).raw(time),u=clamp((time-s.start)/(s.end-s.start)),o=offsets.get(s.id);const offset=o.start.clone().lerp(o.end,u);if(p.aim&&offset.lengthSq()>1e-18){const before=p.aim.clone().sub(p.position),after=before.clone().sub(offset);if(before.lengthSq()>1e-10&&after.lengthSq()>1e-10)p.quaternion.premultiply(new THREE.Quaternion().setFromUnitVectors(before.normalize(),after.normalize()));}p.position.add(offset);return p;};
 return {entries,offsets,sample,position};
}
export function sequencePlan(capture,timeline,duration,single){
 const key=JSON.stringify([timeline,duration,capture.camera.aspect]);let cached=caches.get(capture);
 if(cached?.key!==key){cached={key,...build(capture,timeline,duration,single)};caches.set(capture,cached);}return cached;
}
function easeTime(timeline,s,time){
 const i=timeline.segments.indexOf(s),previous=timeline.segments[i-1],next=timeline.segments[i+1];
 const startGap=s.start>0&&(!previous||previous.end<s.start-1e-7),endGap=s.end<timeline.duration&&(!next||s.end<next.start-1e-7),length=s.end-s.start;
 const incoming=holdTransition(timeline,s,'start'),outgoing=holdTransition(timeline,s,'end');
 const enter=startGap&&incoming.smooth?Math.min(incoming.frames/timeline.fps,length/2):0;
 const exit=endGap&&outgoing.smooth?Math.min(outgoing.frames/timeline.fps,length/2):0;
 let t=clamp(time,s.start,s.end);
 if(enter&&t<s.start+enter){const x=(t-s.start)/enter;t=s.start+enter*x*x*(2-x);}
 if(exit&&t>s.end-exit){const x=(s.end-t)/exit;t=s.end-exit*x*x*(2-x);}return t;
}
function blend(a,b,u){
 const p=copy(a);p.position.lerp(b.position,u);p.quaternion.slerp(b.quaternion,u);
 // Blend lens power, giving a linear focal-length change for one filmback.
 const power=(1-u)/Math.tan(THREE.MathUtils.degToRad(a.fov)/2)+u/Math.tan(THREE.MathUtils.degToRad(b.fov)/2);
 p.fov=THREE.MathUtils.radToDeg(2*Math.atan(1/power));p.fisheye=u<.5?a.fisheye:b.fisheye;p.feedback=null;return p;
}
export function sequencePose(capture,timeline,time,duration,single,compiled=null){
 const plan=compiled??sequencePlan(capture,timeline,duration,single),s=activeSegment(timeline,time);let pose=plan.sample(s,easeTime(timeline,s,time));
 for(const j of timeline.joins){if(!j.connected)continue;
  const a=plan.entries.get(j.left)?.segment,b=plan.entries.get(j.right)?.segment;if(!a||!b)continue;
  if(b.start-a.end>1e-7){
   const incoming=holdTransition(timeline,timeline.segments.find(s=>s.id===b.id),'start');const window=incoming.smooth?Math.min(incoming.frames/timeline.fps,(b.end-b.start)/2):0;if(window&&time>=b.start&&time<=b.start+window){const u=clamp((time-b.start)/window);pose=blend(plan.sample(a,a.end),plan.sample(b,time),u*u*(3-2*u));break;}continue;
  }
  if(Math.abs(a.end-b.start)>1e-7||!j.smooth||!j.frames||j.preserve)continue;
  const half=Math.min(j.frames/(2*timeline.fps),(a.end-a.start)/2,(b.end-b.start)/2),start=a.end-half,end=b.start+half;
  if(!half||time<start||time>end)continue;
  const pa=plan.sample(a,start),pb=plan.sample(b,end),u=clamp((time-start)/(end-start)),span=end-start,eps=Math.min(1/120,half/4);
  const va=plan.sample(a,start+eps).position.sub(plan.sample(a,start-eps).position).multiplyScalar(span/(2*eps));
  const vb=plan.sample(b,end+eps).position.sub(plan.sample(b,end-eps).position).multiplyScalar(span/(2*eps));
  pose=blend(pa,pb,u*u*(3-2*u));pose.position.copy(pa.position).multiplyScalar(2*u**3-3*u*u+1).addScaledVector(va,u**3-2*u*u+u).addScaledVector(pb.position,-2*u**3+3*u*u).addScaledVector(vb,u**3-u*u);break;
 }
 capture.cameraIndex=s.settings.camera_index;capture.setTime(clamp(time,0,duration));return pose;
}
export function applySequence(capture,settings,time,duration,single){const pose=sequencePose(capture,settings.camera_timeline,time,duration,single);writeCameraPose(capture.camera,pose);}
