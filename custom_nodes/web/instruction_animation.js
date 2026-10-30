import * as THREE from './vendor/build/three.module.js';
import {clone,renumberCameras,joinBetween,recipe,DEFAULT_BLEND_FRAMES} from './camera_timeline.js?v=20261029-usability-r2';
import {resetCurve} from './manual_path.js?v=20261028-curved-camera-paths';
import {presetDefaults} from './camera_presets.js';
import {cameraFrameAt,frameTimes} from './instruction_motion.js?v=20261029-usability-r2';
const samePose=(a,b)=>a&&b&&new THREE.Vector3().fromArray(a.position).distanceTo(new THREE.Vector3().fromArray(b.position))<1e-4&&Math.abs(new THREE.Quaternion().fromArray(a.quaternion).dot(new THREE.Quaternion().fromArray(b.quaternion)))>1-1e-6&&Math.abs(a.fov-b.fov)<1e-4&&a.lens_projection===b.lens_projection;
export function mergeInstructionChunks(results,keepBlocks){
 const groups=[];
 for(const {range,result} of results){
  if(result?.schema_version!==1||!Array.isArray(result.blocks)||!result.blocks.length)throw new Error('The model returned no camera animation.');
  if(keepBlocks&&result.blocks.length!==1)throw new Error('The response changed a protected camera block.');
  const key=JSON.stringify(range.ids);let group=groups.at(-1);if(group?.key!==key){group={key,range:clone(range),blocks:[]};groups.push(group);}
  for(const original of result.blocks){const b=clone(original),previous=group.blocks.at(-1);
   if(previous&&Math.abs(previous.end-b.start)>1e-6)throw new Error('Generated time chunks have a gap or overlap.');
   if(previous&&(keepBlocks||b.continue_previous)){
    if(b.transition==='cut'||!samePose(previous.frames.at(-1),b.frames[0]))throw new Error('A continued camera chunk must match the preceding endpoint.');
    previous.end=b.end;previous.frames.push(...b.frames.slice(1));
   }else{if(previous&&b.transition!=='cut'&&!samePose(previous.frames.at(-1),b.frames[0]))throw new Error('Continuous cameras must meet at the same camera pose.');group.blocks.push(b);}
  }
 }
 for(const g of groups){if(Math.abs(g.blocks[0].start-g.range.start)>1e-6||Math.abs(g.blocks.at(-1).end-g.range.end)>1e-6)throw new Error('Generated camera data must span the entire requested range.');if(keepBlocks&&g.blocks.length!==1)throw new Error('The response changed a protected camera block.');}
 return groups;
}
// Preserve the old transition's numerical endpoint/velocity samples on the selected
// side of a protected neighbor. The LLM can author the interior freely.
export function boundaryLocks(editor,selected){
 const timeline=editor.sequence.timeline,plan=editor.sequence.plan(),locks=[];
 for(const j of timeline.joins){if(!j.connected)continue;const a=timeline.segments.find(s=>s.id===j.left),b=timeline.segments.find(s=>s.id===j.right);if(selected.includes(a.id)===selected.includes(b.id))continue;
  const s=selected.includes(a.id)?a:b,side=s===a?'end':'start',touching=Math.abs(a.end-b.start)<1e-7;
  const half=touching&&j.smooth&&j.frames&&!j.preserve?Math.min(j.frames/(2*timeline.fps),(a.end-a.start)/2,(b.end-b.start)/2):0,eps=half?Math.min(1/120,half/4):0;
  const from=side==='start'?s.start:Math.max(s.start,s.end-half-eps),to=side==='end'?s.end:Math.min(s.end,s.start+half+eps);
  const times=new Set([from,to,s[side]]);for(const time of frameTimes(timeline.duration,timeline.fps))if(time>=from&&time<=to)times.add(time);
  if(half){const boundary=side==='start'?s.start+half:s.end-half;for(const delta of [-eps,0,eps])times.add(boundary+delta);}
  const frames=[...times].sort((a,b)=>a-b).map(time=>{const p=plan.sample(s,time);return {time,position:p.position.toArray(),quaternion:p.quaternion.toArray(),fov:p.fov,lens_projection:p.fisheye?'fisheye_equidistant':'perspective'};});
  locks.push({id:s.id,from,to,frames});
 }
 return locks;
}
function lockedFrames(block,range,locks){
 let frames=clone(block.frames);
 for(const lock of locks.filter(l=>range.ids.includes(l.id)&&l.to>=block.start-1e-8&&l.from<=block.end+1e-8)){
  const from=Math.max(block.start,lock.from),to=Math.min(block.end,lock.to);
  frames=frames.filter(f=>f.time<from-1e-9||f.time>to+1e-9);
  frames.push(cameraFrameAt(lock.frames,from),...lock.frames.filter(f=>f.time>from+1e-9&&f.time<to-1e-9),cameraFrameAt(lock.frames,to));
 }
 const sorted=new Map(frames.map(f=>[Number(f.time.toFixed(9)),f]));return [...sorted.values()].sort((a,b)=>a.time-b.time);
}
export function compileInstructions(original,groups,locks=[],actorIds=[]){
 const settings=clone(original),t=settings.camera_timeline;if(!t)throw new Error('Load a camera timeline first.');
 const old=clone(t),selectedIds=new Set(groups.flatMap(g=>g.range.ids)),generated=new Map(),replacements=new Map();
 for(const group of groups){
  const originals=old.segments.filter(s=>group.range.ids.includes(s.id));if(!originals.length)throw new Error('The selected camera no longer exists.');
  const coversWhole=group.range.start===0&&group.range.end===t.duration&&originals.length===old.segments.length;
  if(!coversWhole&&(Math.abs(originals[0].start-group.range.start)>1e-7||Math.abs(originals.at(-1).end-group.range.end)>1e-7))throw new Error('Generated animation changed the permitted editing range.');
  const created=group.blocks.map((b,i)=>{
   const id=i===0?originals[0].id:`camera-${t.next_id++}`,frames=lockedFrames(b,group.range,locks),first=frames[0],last=frames.at(-1),template=recipe(originals[Math.min(i,originals.length-1)].settings);
   if(frames.length>14401)throw new Error('Generated camera has too many samples after preserving its boundaries.');
   const p=template.preset?clone(template.preset):(actorIds.length?presetDefaults(actorIds):null);
   if(p){Object.assign(p,{roll:0,start_time:0,end_time:0,pacing:'constant',framing_motion:false});if(p.camera_transition)p.camera_transition.enabled=false;}
   const endpoint=f=>({position:[...f.position],target:new THREE.Vector3(0,0,-1).applyQuaternion(new THREE.Quaternion().fromArray(f.quaternion)).add(new THREE.Vector3().fromArray(f.position)).toArray(),fov:Math.min(150,f.fov)});
   Object.assign(template,{mode:'bookends',world_frame_id:t.world_frame_id,target_actor:null,preset:p,start:endpoint(first),end:endpoint(last),manual_path:{kind:'curve',aim:'source',pacing:'linear',framing_priority:'reference',position_interpolation:b.position_interpolation??'linear',source_frames:frames.map(f=>({...f,time:(f.time-b.start)/(b.end-b.start)*t.duration})),source_static:frames.every(f=>samePose(f,first))}});resetCurve(template);
   const segment={id,name:'Camera',start:b.start,end:b.end,source_start:0,source_end:t.duration,settings:template,offset_start:[0,0,0],offset_end:[0,0,0],ease_start:false,ease_end:false};generated.set(id,{segment,transition:b.transition,range:group.range});return segment;
  });
  replacements.set(originals[0].id,created);
 }
 t.segments=old.segments.flatMap(s=>replacements.get(s.id)??(selectedIds.has(s.id)?[]:[s]));
 if(!t.segments.length||t.segments.length>64)throw new Error('The final scene needs 1–64 camera blocks.');
 t.joins=[];
 for(let i=0;i<t.segments.length-1;i++){
  const a=t.segments[i],b=t.segments[i+1],ga=generated.get(a.id),gb=generated.get(b.id);
  if(!ga&&!gb){const j=joinBetween(old,a.id,b.id);if(j)t.joins.push(clone(j));continue;}
  if(ga&&gb){const cut=gb.transition==='cut';if(!cut&&!samePose(a.settings.manual_path.source_frames.at(-1),b.settings.manual_path.source_frames[0]))throw new Error('Neighboring generated cameras must match their boundary poses or use an explicit cut.');t.joins.push({left:a.id,right:b.id,connected:!cut,smooth:!cut,frames:DEFAULT_BLEND_FRAMES,preserve:true,point:cut?null:a.settings.end.position.slice()});continue;}
  const range=(ga??gb).range,oldA=ga?range.ids.at(-1):a.id,oldB=gb?range.ids[0]:b.id,j=joinBetween(old,oldA,oldB);
  if(j)t.joins.push({...clone(j),left:a.id,right:b.id});
 }
 t.selected_id=t.segments.find(s=>generated.has(s.id)).id;renumberCameras(t);
 return {...clone(t.segments.find(s=>s.id===t.selected_id).settings),camera_timeline:t};
}
