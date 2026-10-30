import * as THREE from './vendor/build/three.module.js';
import {applyCamera} from './camera_motion.js?v=20261029-usability-r2';
import {clone} from './camera_timeline.js?v=20261029-usability-r2';
const cache=new WeakMap();
const rounded=(values,digits)=>values.map(v=>{if(!Number.isFinite(v))throw new Error('The scene contains a nonfinite joint transform.');return Number(v.toFixed(digits));});
const pose=object=>[...rounded(object.getWorldPosition(new THREE.Vector3()).toArray(),6),...rounded(object.getWorldQuaternion(new THREE.Quaternion()).toArray(),9)];
const alias=name=>name.toLowerCase().split(':').at(-1).replace(/[^a-z0-9]/g,'');
const labels={root:['root1','root','pelvis','hips','cspine0'],face:['chead','head'],chest:['cspine2','chest','spine2'],left_hand:['lhand','lwrist','lefthand'],right_hand:['rhand','rwrist','righthand'],left_foot:['lfoot','leftfoot'],right_foot:['rfoot','rightfoot']};
export function sceneSkeleton(capture){return capture.actors.map(actor=>{
 const used=new Set();actor.root.traverse(o=>{if(o.isSkinnedMesh)for(const bone of o.skeleton.bones)used.add(bone);});
 const bones=[];actor.root.traverse(o=>{if(o.isBone&&(!used.size||used.has(o)))bones.push(o);});
 if(!bones.length)throw new Error(`Actor ${actor.number} has no animated skeleton to send to the model.`);
 const indices=new Map(bones.map((b,i)=>[b,i])),semantic={};
 for(const [label,names] of Object.entries(labels)){const i=bones.findIndex(b=>names.includes(alias(b.name)));if(i>=0)semantic[label]=i;}
 return {actor,objects:bones,metadata:{id:actor.number,bones:bones.map((b,i)=>({id:i,name:b.name,parent:indices.get(b.parent)??null})),semantic_labels:semantic}};
});}
export function frameTimes(duration,fps){const times=Array.from({length:Math.ceil(duration*fps)},(_,i)=>i/fps);if(Math.abs(times.at(-1)-duration)>1e-9)times.push(duration);return times;}
export async function motionDocument(capture,fps,onProgress=()=>{},yieldFrame=()=>new Promise(resolve=>requestAnimationFrame(resolve))){
 const previous=cache.get(capture);if(previous?.fps===fps&&previous.duration===capture.duration)return previous.document;
 const rigs=sceneSkeleton(capture),times=frameTimes(capture.duration,fps),values=times.length*rigs.reduce((n,r)=>n+r.objects.length*7,0);
 if(values>12_000_000)throw new Error('This full-resolution skeleton is too large to prepare in memory. Use a shorter motion or a lower output frame rate. No model call was made.');
 const frames=[],overview=[];
 for(let i=0;i<times.length;i++){
  const time=times[i];capture.setTime(time);
  frames.push({time,actors:rigs.map(r=>({id:r.actor.number,root:pose(r.objects[r.metadata.semantic_labels.root]??r.actor.root),actor_transform:pose(r.actor.root),bones:r.objects.map(pose)}))});
  if(i===0||i===times.length-1||Math.floor(time*2)>Math.floor((times[i-1]??-1)*2))overview.push({time,actors:rigs.map(r=>({id:r.actor.number,root:pose(r.objects[r.metadata.semantic_labels.root]??r.actor.root),landmarks:Object.fromEntries(Object.entries(r.metadata.semantic_labels).map(([name,index])=>[name,rounded(r.objects[index].getWorldPosition(new THREE.Vector3()).toArray(),6)]))}))});
  if(i%8===0){onProgress(i,times.length);await yieldFrame();}
 }
 const document={schema_version:1,units:'meters',up:'Y',handedness:'right',duration:capture.duration,fps,numeric_precision:{position_decimals:6,quaternion_decimals:9},actors:rigs.map(r=>r.metadata),environment:{geometry_available:false,ground_reference_y:0},overview,frames};cache.set(capture,{fps,duration:capture.duration,document});onProgress(times.length,times.length);return document;
}
export async function currentCameraFrames(editor,onProgress=()=>{}){
 const settings=clone(editor.settings),time=editor.time,frames=[];try{
  const times=frameTimes(editor.capture.duration,editor.timelineFPS);
  for(let i=0;i<times.length;i++){
   const t=times[i];editor.capture.setTime(t);applyCamera(editor.capture,settings,t,editor.capture.duration);const c=editor.capture.camera;
   frames.push({time:t,position:c.position.toArray(),quaternion:c.quaternion.toArray(),fov:c.fov,lens_projection:c.userData.cartwheelFisheye?'fisheye_equidistant':'perspective'});
   if(i%16===0){onProgress(i,times.length);await new Promise(resolve=>requestAnimationFrame(resolve));}
  }
 }finally{editor.setTime(time);}return frames;
}
export function cameraFrameAt(frames,time){
 let a=0,b=frames.length-1;while(a<b){const m=Math.ceil((a+b)/2);if(frames[m].time<=time)a=m;else b=m-1;}b=Math.min(a+1,frames.length-1);const x=frames[a],y=frames[b],u=x===y?0:(time-x.time)/(y.time-x.time);
 return {time,position:new THREE.Vector3().fromArray(x.position).lerp(new THREE.Vector3().fromArray(y.position),u).toArray(),quaternion:new THREE.Quaternion().fromArray(x.quaternion).slerp(new THREE.Quaternion().fromArray(y.quaternion),u).toArray(),fov:x.fov+(y.fov-x.fov)*u,lens_projection:x.lens_projection};
}
export function instructionRanges(timeline,selected,keepBlocks){
 if(selected.length===timeline.segments.length&&!keepBlocks)return [{start:0,end:timeline.duration,ids:[...selected]}];
 return timeline.segments.filter(s=>selected.includes(s.id)).map(s=>({start:s.start,end:s.end,ids:[s.id]}));
}
export function prepareChunks(document,timeline,cameraFrames,ranges,keepBlocks,maxChars=240000){
 const chunks=[],actors=document.actors,header={schema_version:1,units:document.units,up:document.up,handedness:document.handedness,duration:document.duration,fps:document.fps,numeric_precision:document.numeric_precision,actors,environment:document.environment,overview:document.overview,
  camera_blocks:timeline.segments.map(s=>({id:s.id,name:s.name,start:s.start,end:s.end,type:s.settings.mode,movement:s.settings.preset?.movement??'authored path'})),keep_blocks:keepBlocks,
  output_aspect:null};
 const overhead=JSON.stringify(header).length+12000;if(overhead>=maxChars)throw new Error('The scene skeleton/overview exceeds this adapter’s request limit. No model call was made.');
 for(const range of ranges){
  const indices=document.frames.map((f,i)=>f.time>=range.start-1e-8&&f.time<=range.end+1e-8?i:-1).filter(i=>i>=0);
  let start=0;
  while(start<indices.length-1){let end=start+1,chars=overhead+JSON.stringify(document.frames[indices[start]]).length;
   while(end<indices.length){const row=document.frames[indices[end]],size=JSON.stringify(row).length+JSON.stringify(cameraFrames[indices[end]]).length+2;if(chars+size>maxChars)break;chars+=size;end++;}
   end--;if(end<=start)throw new Error('A single scene frame is too large for the selected adapter. No motion data was omitted.');
   // Fractional terminal durations must not produce a block shorter than one frame.
   if(end===indices.length-2&&range.end-document.frames[indices[end]].time<1/document.fps-1e-7){end--;if(end<=start)throw new Error('Increase the request context limit for this final fractional frame.');}
   const first=document.frames[indices[start]].time,last=document.frames[indices[end]].time;
   chunks.push({range:clone(range),context:{...header,requested_range:[first,last],motion_frames:document.frames.slice(indices[start],indices[end]+1),current_camera:cameraFrames.slice(indices[start],indices[end]+1),previous_camera:null}});start=end;
  }
 }
 if(!chunks.length)throw new Error('Select at least one camera with a valid motion interval.');
 if(chunks.length>64)throw new Error(`This scene needs ${chunks.length} model calls at full joint detail. Use a shorter clip or edit fewer cameras. No model call was made.`);
 return chunks;
}
