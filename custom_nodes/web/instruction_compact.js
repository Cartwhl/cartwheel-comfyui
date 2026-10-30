// One whole-clip numerical document. Simplification is only for the LLM reference;
// the scene and its animation are never altered.
import * as THREE from './vendor/build/three.module.js';
import {cameraFrameAt} from './instruction_motion.js?v=20261029-usability-r2';
const canonical=name=>name.toLowerCase().split(':').at(-1).replace(/[^a-z0-9]/g,'');
const mainNames=new Set(('root root1 pelvis hips cspine0 cspine1 cspine2 cspine3 spine spine1 spine2 spine3 chest upperchest neck cneck head chead lhip rhip lupleg rupleg leftupleg rightupleg llowleg rlowleg leftleg rightleg lfoot rfoot leftfoot rightfoot lball rball lefttoebase righttoebase lclavicle rclavicle leftshoulder rightshoulder luparm ruparm leftarm rightarm llowarm rlowarm leftforearm rightforearm lwrist rwrist lhand rhand lefthand righthand').split(' '));
const round=(n,d=6)=>{if(!Number.isFinite(n))throw new Error('The scene contains invalid coordinates.');return Number(n.toFixed(d));};
export function simplifyTrack(times,values,error,tolerance,required=[]){
 if(times.length!==values.length||times.length<2)throw new Error('A motion track needs at least two source poses.');
 const keep=new Set([0,times.length-1,...required]),bounds=[...keep].sort((a,b)=>a-b),pending=bounds.slice(1).map((end,i)=>[bounds[i],end]);
 while(pending.length){const [a,b]=pending.pop();let worst=tolerance,index=-1;for(let i=a+1;i<b;i++){const amount=(times[i]-times[a])/(times[b]-times[a]),deviation=error(values[i],values[a],values[b],amount);if(deviation>worst){worst=deviation;index=i;}}if(index>=0){keep.add(index);pending.push([a,index],[index,b]);}}
 return [...keep].sort((a,b)=>a-b);
}
export const positionError=(v,a,b,u)=>Math.hypot(...v.map((x,k)=>x-a[k]-(b[k]-a[k])*u));
const quaternionError=(v,a,b,u)=>new THREE.Quaternion().fromArray(v).angleTo(new THREE.Quaternion().fromArray(a).slerp(new THREE.Quaternion().fromArray(b),u));
export function compactMotion(document){
 const times=document.frames.map(f=>f.time),actors=document.actors.map((actor,actorIndex)=>{
  const preferred=actor.bones.filter(b=>mainNames.has(canonical(b.name))||Object.values(actor.semantic_labels??{}).includes(b.id));
  // Unknown rigs retain their actual joints; never claim a guessed anatomical map.
  const bones=preferred.length>=8?preferred:actor.bones.filter(b=>!/twist|proc|helper|end.?site/i.test(b.name));
  if(!bones.length)throw new Error(`Actor ${actor.id} has no usable motion joints.`);
  const tracks=bones.map(b=>{
   const values=document.frames.map(f=>{const value=f.actors[actorIndex]?.bones[b.id];if(!value||value.length!==7)throw new Error('A source pose is missing a joint.');return value.slice(0,3).map(x=>x*1000);});
   const indices=simplifyTrack(times,values,positionError,10);
   return {id:b.id,name:b.name,parent:b.parent,positions:indices.map(i=>[i,...values[i].map(Math.round)])};
  });
  const face=actor.semantic_labels?.face;let head_orientation;
  if(Number.isInteger(face)){
   const values=document.frames.map(f=>f.actors[actorIndex].bones[face].slice(3));
   for(let i=1;i<values.length;i++)if(values[i].reduce((n,v,k)=>n+v*values[i-1][k],0)<0)values[i]=values[i].map(v=>-v);
   const indices=simplifyTrack(times,values,quaternionError,Math.PI/90);
   head_orientation={bone:face,tolerance_degrees:2,quaternion_scale:10000,samples:indices.map(i=>[i,...values[i].map(x=>Math.round(x*10000))])};
  }
  return {id:actor.id,semantic_labels:actor.semantic_labels??{},joints:tracks,...(head_orientation?{head_orientation}:{})};
 });
 return {schema_version:2,format:'compact_world_tracks',units:'millimeters',up:'Y',handedness:'right',duration:document.duration,fps:document.fps,source_pose_count:times.length,position_tolerance_mm:10,position_rounding_mm:1,frame_index_time:'min(frame_index / fps, duration)',joint_selection:'Main body joints and named landmarks; procedural, twist and finger joints omitted when the rig is recognized.',environment:document.environment,actors};
}
export function compactCamera(frames,timeline){
 // Preserve both sides of cuts, block boundaries, and first/last frames.
 const required=new Set();for(const s of timeline.segments)for(const t of [s.start,s.end]){let i=frames.findIndex(f=>f.time>=t-1e-8);if(i<0)i=frames.length-1;required.add(i);if(i>0)required.add(i-1);}
 const error=(v,a,b,u)=>Math.max(positionError(v.position,a.position,b.position,u)/.01,quaternionError(v.quaternion,a.quaternion,b.quaternion,u)/.003,Math.abs(v.fov-a.fov-(b.fov-a.fov)*u)/.05,v.lens_projection===a.lens_projection&&v.lens_projection===b.lens_projection?0:2);
 const indices=simplifyTrack(frames.map(f=>f.time),frames,error,1,[...required]);
 const rows=indices.map(i=>frames[i]);for(const s of timeline.segments)for(const time of [s.start,s.end])if(!rows.some(r=>Math.abs(r.time-time)<1e-8))rows.push(cameraFrameAt(frames,time));
 return rows.sort((a,b)=>a.time-b.time).map(f=>[round(f.time),...f.position.map(x=>Math.round(x*1000)),...f.quaternion.map(x=>round(x,5)),round(f.fov,3),f.lens_projection]);
}
export function compactContext(document,timeline,frames,ranges,keep,locks=[],aspect=16/9){
 return {...compactMotion(document),camera_blocks:timeline.segments.map(s=>({id:s.id,name:s.name,start:s.start,end:s.end,type:s.settings.mode,movement:s.settings.preset?.movement??'authored path'})),current_camera:compactCamera(frames,timeline),allowed_ranges:ranges,keep_blocks:keep,output_aspect:aspect,locked_camera_samples:locks.map(l=>({range:[l.from,l.to],frames:l.frames}))};
}
