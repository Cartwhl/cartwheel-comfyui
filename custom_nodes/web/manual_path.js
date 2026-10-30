import {movementProgress} from './movement_timing.js?v=20261028-delivery';
import * as THREE from "./vendor/build/three.module.js";

export const defaultManualPath = () => ({ kind: "line", controls: null, pacing: "linear", aim: "blend" });
export const shotFraming = settings => settings?.mode === "bookends" && settings.preset != null && settings.manual_path?.aim === "shot";
export function manualPath(settings) { return { ...defaultManualPath(), ...settings.manual_path }; }
export function resetCurve(settings, bend = 0.2) {
  const a = new THREE.Vector3().fromArray(settings.start.position), b = new THREE.Vector3().fromArray(settings.end.position);
  if(manualPath(settings).source_frames){
    const h=1e-5,first=sourceSample(settings,0).position,last=sourceSample(settings,1).position;
    const x=sourceSample(settings,h).position.sub(first).multiplyScalar(1/h/3).add(a);
    const y=sourceSample(settings,1-h).position.sub(last).multiplyScalar(1/h/3).add(b);
    settings.manual_path={...manualPath(settings),controls:[x.toArray(),y.toArray()],point_handles:(manualPath(settings).points??[]).map(()=>[[0,0,0],[0,0,0]])};return;
  }
  const delta = b.clone().sub(a), length = delta.length();
  // A horizontal bow works for ordinary dolly/truck paths; vertical paths bow along X.
  const side = new THREE.Vector3().crossVectors(delta, new THREE.Vector3(0, 1, 0));
  if (side.lengthSq() < 1e-10) side.set(1, 0, 0);
  side.normalize().multiplyScalar(Math.max(length, 1) * bend);
  settings.manual_path = { ...manualPath(settings), ...(manualPath(settings).points?{point_handles:manualPath(settings).points.map(()=>[[0,0,0],[0,0,0]])}:{}), controls: [a.clone().lerp(b, 1 / 3).add(side).toArray(), a.clone().lerp(b, 2 / 3).add(side).toArray()] };
}
export const MAX_PATH_POINTS = 5;
export function addPathPoint(settings) {
  const p = manualPath(settings), count = (p.points?.length ?? 0) + 1;
  if (count > MAX_PATH_POINTS) throw new Error('A path supports at most 5 intermediate adjustment markers.');
  const curve = manualCurve(settings);
  const points = Array.from({length:count}, (_,i) => (curve && !p.source_frames ? curve.getPointAt((i+1)/(count+1)) : manualPosition(settings,(i+1)/(count+1))).toArray());
  settings.manual_path = { ...p, kind:'curve', points, point_handles:points.map(()=>[[0,0,0],[0,0,0]]) };
  if (!p.controls) resetCurve(settings,p.kind==='line'?0:.2);
}
export function removePathPoint(settings, index) {
  settings.manual_path.points.splice(index,1);
  settings.manual_path.point_handles?.splice(index,1);
}
class AdjustedCurve extends THREE.Curve {
  constructor(base, points) {
    super(); this.base=base;
    const offsets=points.map((point,i)=>new THREE.Vector3().fromArray(point).sub(base.getPoint((i+1)/(points.length+1))));
    this.offsets=new THREE.CatmullRomCurve3([new THREE.Vector3(),...offsets,new THREE.Vector3()],false,'catmullrom',.5);
  }
  getPoint(t,result=new THREE.Vector3()) { return this.base.getPoint(t,result).add(this.offsets.getPoint(t)); }
}
// The existing curve remains the baseline. Zero tangent edits reproduce it
// exactly; local cubic corrections change its derivative without moving knots.
class TangentCurve extends THREE.Curve {
  constructor(base,handles){super();this.base=base;this.handles=handles;}
  getPoint(t,result=new THREE.Vector3()){
    const spans=this.handles.length+1,index=Math.min(spans-1,Math.floor(t*spans)),u=t*spans-index;
    this.base.getPoint(t,result);
    if(index>0)result.addScaledVector(new THREE.Vector3().fromArray(this.handles[index-1][1]),3*(1-u)*(1-u)*u);
    if(index<this.handles.length)result.addScaledVector(new THREE.Vector3().fromArray(this.handles[index][0]),3*(1-u)*u*u);
    return result;
  }
}
// Tangents are velocities in source time, shared on both sides of each knot.
// Limiting their length reduces bowing at uneven/short spans. Holds and reversals
// stop at the authored point; no curve can cross a marked cut.
function sourceVelocity(frames,index){
 const point=i=>new THREE.Vector3().fromArray(frames[i].position);
 if(index===0)return frames[1].cut?new THREE.Vector3():point(1).sub(point(0)).divideScalar(frames[1].time-frames[0].time);
 if(index===frames.length-1)return frames[index].cut?new THREE.Vector3():point(index).sub(point(index-1)).divideScalar(frames[index].time-frames[index-1].time);
 if(frames[index].cut||frames[index+1].cut)return new THREE.Vector3();
 const leftTime=frames[index].time-frames[index-1].time,rightTime=frames[index+1].time-frames[index].time;
 const left=point(index).sub(point(index-1)).divideScalar(leftTime),right=point(index+1).sub(point(index)).divideScalar(rightTime),a=left.length(),b=right.length();
 if(a<1e-10||b<1e-10)return new THREE.Vector3();
 const velocity=left.clone().multiplyScalar(rightTime).addScaledVector(right,leftTime).divideScalar(leftTime+rightTime);
 if(velocity.dot(left)<0||velocity.dot(right)<0)return new THREE.Vector3();
 return velocity.clampLength(0,3*Math.min(a,b));
}
function sourcePosition(frames,index,u,result=new THREE.Vector3()){
 const a=frames[index],b=frames[Math.min(index+1,frames.length-1)];
 if(a===b)return result.fromArray(a.position);
 if(b.cut)return result.fromArray(a.position);
 const span=b.time-a.time,m0=sourceVelocity(frames,index).multiplyScalar(span),m1=sourceVelocity(frames,index+1).multiplyScalar(span);
 return result.fromArray(a.position).multiplyScalar(2*u*u*u-3*u*u+1).addScaledVector(m0,u*u*u-2*u*u+u).addScaledVector(new THREE.Vector3().fromArray(b.position),-2*u*u*u+3*u*u).addScaledVector(m1,u*u*u-u*u);
}
export function sourceSample(settings, t) {
  const frames=manualPath(settings).source_frames;
  if(!frames?.length)return null;
  const time=THREE.MathUtils.clamp(t,0,1)*frames.at(-1).time;
  let lo=0,hi=frames.length-1;
  while(lo<hi){const m=Math.ceil((lo+hi)/2);if(frames[m].time<=time)lo=m;else hi=m-1;}
  const a=frames[lo],b=frames[Math.min(lo+1,frames.length-1)];
  const u=a===b?0:(time-a.time)/(b.time-a.time);
  return {lens_projection:a.lens_projection,position:manualPath(settings).kind==='curve'&&manualPath(settings).position_interpolation==='cubic'?sourcePosition(frames,lo,u):new THREE.Vector3().fromArray(a.position).lerp(new THREE.Vector3().fromArray(b.position),u),quaternion:new THREE.Quaternion().fromArray(a.quaternion).slerp(new THREE.Quaternion().fromArray(b.quaternion),u),fov:THREE.MathUtils.lerp(a.fov,b.fov,u)};
}
class SourceCurve extends THREE.Curve {
 constructor(settings){super();this.settings=settings;}
 getPoint(t,result=new THREE.Vector3()) {return result.copy(sourceSample(this.settings,t).position);}
}
class SourceEditedCurve extends THREE.Curve {
 constructor(settings){super();this.settings=settings;const p=manualPath(settings);this.base=new SourceCurve(settings);
 const anchors=[settings.start.position,...(p.points??[]),settings.end.position];
 this.offsets=new THREE.CatmullRomCurve3(anchors.map((v,i)=>new THREE.Vector3().fromArray(v).sub(this.base.getPoint(i/(anchors.length-1)))),false,'catmullrom',.5);
 }
 getPoint(t,result=new THREE.Vector3()) {
  this.base.getPoint(t,result).add(this.offsets.getPoint(t));
  const p=manualPath(this.settings);
  if(p.kind==='curve'&&p.controls){const a=sourceSample(this.settings,0).position,b=sourceSample(this.settings,1).position;
   const h=1e-5,d0=this.base.getPoint(h).sub(a).multiplyScalar(1/h/3),d1=this.base.getPoint(1-h).sub(b).multiplyScalar(1/h/3);
   const c0=new THREE.Vector3().fromArray(p.controls[0]).sub(new THREE.Vector3().fromArray(this.settings.start.position)).sub(d0);
   const c1=new THREE.Vector3().fromArray(p.controls[1]).sub(new THREE.Vector3().fromArray(this.settings.end.position)).sub(d1);
   result.addScaledVector(c0,3*(1-t)*(1-t)*t).addScaledVector(c1,3*(1-t)*t*t);
  }return result;
 }
}
function baselineCurve(settings){
 if(manualPath(settings).source_frames)return new SourceEditedCurve(settings);
  const p=manualPath(settings),vectors=[settings.start.position,...p.controls,settings.end.position].map(v=>new THREE.Vector3().fromArray(v));
  const base=new THREE.CubicBezierCurve3(...vectors);
  return p.points?.length?new AdjustedCurve(base,p.points):base;
}
const cache = new WeakMap();
export function manualCurve(settings) {
  const p = manualPath(settings);
  if (p.kind !== "curve" && !p.source_frames) return null;
  if (!p.controls && !p.source_frames) throw new Error("Set both curve handles before rendering this path.");
  const key=JSON.stringify([settings.start.position,p.controls,settings.end.position,p.points,p.point_handles,p.source_frames,p.position_interpolation,p.kind]);
  let entry=cache.get(settings);
  if(!entry||entry.key!==key){
    const base=baselineCurve(settings);
    const curve=p.points?.length&&p.point_handles?.length?new TangentCurve(base,p.point_handles):base;
    curve.arcLengthDivisions=p.points?.length?2048:512;
    entry={key,curve};cache.set(settings,entry);
  }
  return entry.curve;
}
export const HANDLE_DISPLAY_SCALE=1/3;
const tangentID=id=>/^point(\d+)_(in|out)$/.exec(id);
export function handleAnchor(settings,id){
  if(id==='handle1')return settings.start?.position ?? null;
  if(id==='handle2')return settings.end?.position ?? null;
  const match=tangentID(id);return match?manualPath(settings).points?.[Number(match[1])]:null;
}
function pointHandle(settings,index,side){
  const p=manualPath(settings),base=baselineCurve(settings),span=1/(p.points.length+1),t=(index+1)*span,h=1e-5;
  const derivative=base.getPoint(t+h).sub(base.getPoint(t-h)).multiplyScalar(1/(2*h));
  const anchor=new THREE.Vector3().fromArray(p.points[index]);
  const offset=derivative.multiplyScalar(span/3*(side==='in'?-1:1));
  const delta=p.point_handles?.[index]?.[side==='in'?0:1];if(delta)offset.add(new THREE.Vector3().fromArray(delta));
  return anchor.add(offset).toArray();
}
export function displayMarkerPosition(settings,id){
  const value=markerPosition(settings,id),anchor=handleAnchor(settings,id);
  return value&&anchor?new THREE.Vector3().fromArray(anchor).lerp(new THREE.Vector3().fromArray(value),HANDLE_DISPLAY_SCALE).toArray():value;
}
export function moveDisplayMarker(settings,id,values){
  const anchor=handleAnchor(settings,id);
  const actual=anchor?new THREE.Vector3().fromArray(anchor).add(new THREE.Vector3().fromArray(values).sub(new THREE.Vector3().fromArray(anchor)).divideScalar(HANDLE_DISPLAY_SCALE)).toArray():values;
  moveMarker(settings,id,actual);
}
export function pathProgress(settings, time, duration) {
  return duration>0?movementProgress(time,settings.preset??{},duration,manualPath(settings).pacing):0;
}
export function manualPosition(settings, blend, result = new THREE.Vector3()) {
  // Distance-based curve sampling prevents accidental speed changes at handle bends.
  const curve = manualCurve(settings);
  return curve ? (manualPath(settings).source_frames ? curve.getPoint(blend,result) : curve.getPointAt(blend, result)) : result.fromArray(settings.start.position).lerp(new THREE.Vector3().fromArray(settings.end.position), blend);
}
export function markerPosition(settings, id) {
  const tangent=tangentID(id);if(tangent)return pointHandle(settings,Number(tangent[1]),tangent[2]);
  if (id.startsWith("point")) return manualPath(settings).points?.[Number(id.slice(5))];
  if (id === "handle1" || id === "handle2") return manualPath(settings).controls?.[id === "handle1" ? 0 : 1];
  const [endpoint, key] = id.split("_"); return settings[endpoint]?.[key];
}
export function moveMarker(settings, id, values) {
  if (values.length !== 3 || !values.every(v => Number.isFinite(v) && Math.abs(v) <= 100000)) throw new Error("Marker coordinates must be finite values between -100000 and 100000 meters.");
  const tangent=tangentID(id);
  if(tangent){
    const index=Number(tangent[1]),side=tangent[2]==='in'?0:1,p=manualPath(settings);
    const old=pointHandle(settings,index,tangent[2]);
    p.point_handles??=p.points.map(()=>[[0,0,0],[0,0,0]]);
    const current=p.point_handles[index][side];
    const delta=values.map((v,i)=>current[i]+v-old[i]);
    p.point_handles[index][side]=delta;
    if(p.smooth_handles) p.point_handles[index][1-side]=delta.map(v=>-v);
    settings.manual_path=p;return;
  }
  if (id.startsWith("point")) { settings.manual_path.points[Number(id.slice(5))] = [...values]; return; }
  if (id === "handle1" || id === "handle2") { settings.manual_path.controls[id === "handle1" ? 0 : 1] = [...values]; return; }
  const [endpoint, key] = id.split("_");
  const old = settings[endpoint][key];
  // Carry the attached tangent with its endpoint, preserving the curve's local shape.
  if (key === "position" && manualPath(settings).controls) {
    const handle = settings.manual_path.controls[endpoint === "start" ? 0 : 1];
    for (let i = 0; i < 3; i++) handle[i] += values[i] - old[i];
  }
  settings[endpoint][key] = [...values];
}
