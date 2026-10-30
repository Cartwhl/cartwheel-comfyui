import {bindScrubber} from './slider_interaction.js?v=20261029-position-drag-r2';
import {presetPlan} from './camera_presets.js';
import {movementProgress} from './movement_timing.js';
import * as THREE from './vendor/build/three.module.js';
import {DEFAULT_BLEND_FRAMES,CAMERA_COLORS,createTimeline,selectedSegment,joinBetween,recipe,clone,splitSegment,changeTiming,moveBoundary,deleteSegment,activeSegment,gapAtTime,fillGap,holdTransition,renumberCameras} from './camera_timeline.js?v=20261029-usability-r2';
import {sequencePlan} from './camera_sequence.js?v=20261029-usability-r2';
import {applySingleCamera} from './camera_motion.js?v=20261029-usability-r2';
import {manualPath,resetCurve} from './manual_path.js?v=20261028-curved-camera-paths';
const zero=[0,0,0],TWO_PI=Math.PI*2;
export class CameraTimelineEditor{
 constructor(editor){
  this.editor=editor;this.undoStack=[];this.redoStack=[];
  const bar=editor.element.querySelector('.cw-timeline');bar.classList.add('cw-block-timeline');
  this.track=document.createElement('div');this.track.className='cw-camera-track';this.track.setAttribute('aria-label','Camera moves');this.track.tabIndex=0;
  this.track.innerHTML='<div class="cw-time-ruler"></div><div class="cw-camera-blocks"></div><div class="cw-camera-playhead" aria-hidden="true"></div>';
  this.blocks=this.track.querySelector('.cw-camera-blocks');this.head=this.track.querySelector('.cw-camera-playhead');this.ruler=this.track.querySelector('.cw-time-ruler');
  editor.slider.setAttribute('aria-label','Shot frame');this.ruler.append(editor.slider);bar.append(this.track);this.disposeScrubber=bindScrubber(editor.slider,frame=>editor.seekFrame(frame));
  this.undo=document.createElement('button');this.undo.textContent='↶';this.undo.setAttribute('aria-label','Undo camera edit');this.redo=document.createElement('button');this.redo.textContent='↷';this.redo.setAttribute('aria-label','Redo camera edit');
  this.undo.onclick=()=>this.restoreHistory(false);this.redo.onclick=()=>this.restoreHistory(true);editor.element.querySelector('.cw-toolbar').append(this.undo,this.redo);
  this.track.addEventListener('contextmenu',event=>{event.preventDefault();event.stopPropagation();const id=event.target.closest('[data-camera-id]')?.dataset.cameraId;if(id)this.select(id);const rect=this.blocks.getBoundingClientRect(),at=(event.clientX-rect.left)/rect.width*this.timeline?.duration;this.openMenu(event.clientX,event.clientY,id?null:at);});
  this.track.addEventListener('pointerdown',event=>this.pointerDown(event));
  this.key=event=>{
   const input=event.target?.closest?.('input');if(event.target?.closest?.('textarea,[contenteditable="true"]')||input&&!['range','checkbox','button'].includes(input.type))return;
   if(!editor.element.contains(document.activeElement)||!['z','y'].includes(event.key.toLowerCase())||!(event.ctrlKey||event.metaKey))return;
   event.preventDefault();event.stopImmediatePropagation();this.restoreHistory(event.shiftKey||event.key.toLowerCase()==='y');
  };
  window.addEventListener('keydown',this.key,true);
  this.gestureStart=()=>{if(!editor.renderController){this.gesture=true;this.recorded=false;}};
  this.gestureEnd=()=>queueMicrotask(()=>{if(!this.gesture)return;const changed=this.recorded;this.gesture=false;this.recorded=false;if(changed&&!editor.manualPathEditor?.gizmo?.dragging&&editor.capture){editor.makePath(true);editor.setTime(editor.time);}});
  editor.element.addEventListener('pointerdown',this.gestureStart,true);for(const event of ['pointerup','pointercancel'])window.addEventListener(event,this.gestureEnd,true);window.addEventListener('blur',this.gestureEnd);
  this.dismiss=event=>{if(this.menu&&!this.menu.contains(event.target))this.closeMenu();};document.addEventListener('pointerdown',this.dismiss,true);
 }
 get timeline(){return this.editor.settings.camera_timeline;}
 get selected(){return this.timeline&&selectedSegment(this.timeline);}
 ensure(){const e=this.editor;if(!e.capture||!e.motion)return;if(!this.timeline){const t=createTimeline(e.settings,e.capture.duration,e.timelineFPS);t.world_frame_id=e.motion.world_frame.id;e.settings.camera_timeline=t;}if(this.timeline)renumberCameras(this.timeline);this.sync();}
 plan(){return sequencePlan(this.editor.capture,this.timeline,this.editor.capture.duration,applySingleCamera);}
 effectiveOffsets(){return this.plan().offsets;}
 record(before){if(this.restoring||before===JSON.stringify(this.editor.settings)||this.gesture&&this.recorded)return;this.undoStack.push(before);while(this.undoStack.length>1&&(this.undoStack.length>80||this.undoStack.reduce((n,s)=>n+s.length,0)>32*1024*1024))this.undoStack.shift();this.redoStack=[];this.recorded=true;}
 resetHistory(){this.undoStack=[];this.redoStack=[];this.sync();}
 restoreHistory(redo){
  const from=redo?this.redoStack:this.undoStack,to=redo?this.undoStack:this.redoStack;if(!from.length||this.editor.renderController)return;
  to.push(JSON.stringify(this.editor.settings));this.editor.settings=JSON.parse(from.pop());if(this.editor.fpsWidget&&this.timeline)this.editor.fpsWidget.value=String(this.timeline.fps);this.restoring=true;try{this.refresh();}finally{this.restoring=false;}
 }
 persist(){const e=this.editor;e.settingsWidget.value=JSON.stringify(e.settings);e.node.graph?.incrementVersion?.();e.node.graph?.afterChange?.(e.node);e.node.graph?.setDirtyCanvas?.(true,true);}
 // Committed edits (including async LLM results and Undo) need the full guide.
 // A pending pointer gesture must not leave the eight-span drag preview on screen.
 refresh(){const e=this.editor;e.setPlaying(false);this.persist();e.makePath(true);e.setTime(e.time);e.syncControls();}
 select(id){
  if(this.editor.renderController)return;
  const e=this.editor,t=this.timeline,s=t?.segments.find(s=>s.id===id);if(!s||t.selected_id===id)return;
  t.selected_id=id;e.settings={...clone(s.settings),output_frame:clone(e.settings.output_frame),camera_timeline:t};e.manualPathEditor.selected='start_position';e.capturedPreset=null;e.editingCaptured=false;this.refresh();
 }
 commit(before){
  const e=this.editor,t=this.timeline;if(!t)return;const s=selectedSegment(t),old=JSON.parse(before),previous=old.camera_timeline?.segments.find(x=>x.id===s.id);
  // A newly selected movement starts with its whole recipe, while ordinary
  // parameter edits retain the source interval created by an exact split.
  if(previous&&(previous.settings.mode!==e.settings.mode||previous.settings.preset?.movement!==e.settings.preset?.movement)){s.source_start=0;s.source_end=t.duration;}
  if(previous&&JSON.stringify(previous.settings.preset?.camera_transition)!==JSON.stringify(e.settings.preset?.camera_transition))s.animation_range=[s.source_start,s.source_end];
  s.settings=recipe(e.settings);for(const segment of t.segments)segment.settings.output_frame=clone(e.settings.output_frame);
  if(previous){
   const oldPlan=sequencePlan(e.capture,old.camera_timeline,t.duration,applySingleCamera),oldEntry=oldPlan.entries.get(s.id);
   const newPlan=this.plan(),newEntry=newPlan.entries.get(s.id);
   for(const side of ['start','end']){
    const delta=newEntry[side].position.clone().sub(oldEntry[side].position);
    if(delta.lengthSq()>1e-16)for(const j of t.joins)if(j.connected&&(side==='start'?j.right===s.id:j.left===s.id)){
     const anchor=oldPlan.sample(previous,previous[side]).position;j.point=anchor.add(delta).toArray();
    }
   }
   if(JSON.stringify(previous.settings)!==JSON.stringify(s.settings))for(const j of t.joins)if(j.left===s.id||j.right===s.id)j.preserve=false;
  }
 }
 freezeOffsets(){const offsets=this.effectiveOffsets();for(const s of this.timeline.segments){const o=offsets.get(s.id);s.offset_start=o.start.toArray();s.offset_end=o.end.toArray();}}
 mutate(change){if(this.editor.renderController)return;const before=JSON.stringify(this.editor.settings);try{change();this.record(before);this.refresh();}catch(error){this.editor.settings=JSON.parse(before);this.editor.hint.textContent=error.message;this.sync();}}
 split(){
  this.mutate(()=>{const t=this.timeline,a=this.selected,wasManual=a.settings.mode==='bookends',oldPlan=wasManual?this.plan():null,original=clone(a),cut=this.editor.currentFrameTime();
   this.freezeOffsets();const b=splitSegment(t,a.id,cut);
   if(wasManual){
    // Bake only manual subdivisions, retaining their exact sampled orientation
    // and lens. Editable short handles are rebuilt around the cropped path.
    for(const s of [a,b]){
     const start=s.start,end=s.end,steps=Math.ceil((end-start)*120),times=new Set([start,end]);
     for(let i=1;i<steps;i++)times.add(start+(end-start)*i/steps);
     for(let frame=Math.ceil(start*t.fps);frame/t.fps<end;frame++)times.add(frame/t.fps);
     const sourceTimes=original.settings.manual_path?.source_frames?.map(f=>original.start+(f.time-original.source_start)/(original.source_end-original.source_start)*(original.end-original.start))??[];
     for(const time of sourceTimes)if(time>start&&time<end)times.add(time);
     const cuts=(original.settings.manual_path?.source_frames??[]).filter(f=>f.cut).map(f=>original.start+(f.time-original.source_start)/(original.source_end-original.source_start)*(original.end-original.start));
     let ordered=[...new Set([...times].map(t=>Number(t.toFixed(9))))].sort((a,b)=>a-b);ordered[0]=start;ordered[ordered.length-1]=end;
     if(ordered.length>14401){const required=new Set([start,end]);for(let f=Math.ceil(start*t.fps);f/t.fps<end;f++)required.add(Number((f/t.fps).toFixed(9)));const spare=ordered.filter(t=>!required.has(t)),remaining=14401-required.size;ordered=[...required,...Array.from({length:Math.max(0,remaining)},(_,i)=>spare[Math.floor(i*spare.length/remaining)])].sort((a,b)=>a-b);}
     const samples=ordered.map(time=>{const p=oldPlan.sample(original,time);return {lens_projection:p.fisheye?'fisheye_equidistant':'perspective',cut:cuts.some(t=>Math.abs(t-time)<1e-8),time:(time-start)/(end-start)*t.duration,position:p.position.toArray(),quaternion:p.quaternion.toArray(),fov:p.fov};});
     const q=samples[0],z=samples.at(-1),pose=f=>({position:[...f.position],target:new THREE.Vector3(0,0,-5).applyQuaternion(new THREE.Quaternion().fromArray(f.quaternion)).add(new THREE.Vector3().fromArray(f.position)).toArray(),fov:Math.min(150,f.fov)});
     s.settings.start=pose(q);s.settings.end=pose(z);s.settings.manual_path={kind:'curve',aim:'source',pacing:'linear',source_frames:samples,source_static:samples.every(f=>f.position.every((v,i)=>Math.abs(v-samples[0].position[i])<1e-8)&&Math.abs(new THREE.Quaternion().fromArray(f.quaternion).dot(new THREE.Quaternion().fromArray(samples[0].quaternion)))>1-1e-10&&Math.abs(f.fov-samples[0].fov)<1e-8),framing_priority:'reference'};
     if(s.settings.preset){s.settings.preset.start_time=0;s.settings.preset.end_time=0;s.settings.preset.pacing='constant';s.settings.preset.framing_motion=false;if(s.settings.preset.camera_transition)s.settings.preset.camera_transition.enabled=false;}
     delete s.animation_range;resetCurve(s.settings);s.source_start=0;s.source_end=t.duration;s.offset_start=[...zero];s.offset_end=[...zero];
    }
   }
   const join=joinBetween(t,a.id,b.id);join.point=oldPlan?oldPlan.sample(original,cut).position.toArray():this.plan().sample(a,a.end).position.toArray();
   this.editor.settings={...clone(b.settings),camera_timeline:t};this.editor.manualPathEditor.selected='start_position';
  });
 }
 fill(time){this.mutate(()=>{
  const t=this.timeline,gap=gapAtTime(t,time);if(!gap)throw new Error('Choose an empty interval.');
  const anchor=t.segments.find(s=>s.id===(gap.left??gap.right)),at=gap.left?anchor.end:anchor.start,pose=this.plan().sample(anchor,at);
  // Match the held view exactly; filling time must never move either neighbor.
  this.freezeOffsets();const settings=clone(anchor.settings),target=new THREE.Vector3(0,0,-5).applyQuaternion(pose.quaternion).add(pose.position).toArray();
  settings.mode='bookends';settings.start={position:pose.position.toArray(),target:[...target],fov:Math.min(150,pose.fov)};settings.end=clone(settings.start);
  settings.manual_path={kind:'line',aim:'source',pacing:'linear',source_static:true,framing_priority:'reference',source_frames:[0,t.duration].map(time=>({time,position:pose.position.toArray(),quaternion:pose.quaternion.toArray(),fov:pose.fov,lens_projection:pose.fisheye?'fisheye_equidistant':'perspective'}))};
  if(settings.preset){settings.preset.start_time=0;settings.preset.end_time=0;settings.preset.pacing='constant';settings.preset.framing_motion=false;if(settings.preset.camera_transition)settings.preset.camera_transition.enabled=false;}
  const added=fillGap(t,time,settings);this.editor.settings={...clone(added.settings),camera_timeline:t};this.editor.manualPathEditor.selected='camera_position';
 });}
 setHold(segment,side,changes){this.mutate(()=>{
  const old=holdTransition(this.timeline,segment,side);segment[`ease_${side}`]=changes.smooth??old.smooth;segment[`ease_${side}_frames`]=changes.frames??old.frames;
 });}
 remove(){this.mutate(()=>{this.freezeOffsets();const t=this.timeline;deleteSegment(t,t.selected_id);this.editor.settings={...clone(selectedSegment(t).settings),camera_timeline:t};});}
 setJoin(join,changes){this.mutate(()=>{
  this.freezeOffsets();if(!join){throw new Error('Select neighboring cameras.');}
  if(changes.connected===true&&!join.connected){const left=this.timeline.segments.find(s=>s.id===join.left);join.point=this.plan().sample(left,left.end).position.toArray();}
  Object.assign(join,changes,{preserve:false});if(!join.connected)join.smooth=false;
 });}
 offset(id){if(!this.timeline||!this.editor.capture)return new THREE.Vector3();const s=this.selected,o=this.effectiveOffsets().get(s.id);const u=id==='end_position'||id==='handle2'?1:id?.startsWith('point')?(Number(id.match(/\d+/)?.[0])+1)/((manualPath(this.editor.settings).points?.length??0)+1):0;return o.start.clone().lerp(o.end,u);}
 displayPosition(id,position){if(id==='camera_position'&&this.editor.settings.mode==='preset')return this.plan().sample(this.selected,this.selected.start).position.toArray();return new THREE.Vector3().fromArray(position).add(this.offset(id)).toArray();}
 recipePosition(id,position){
  if(id==='camera_position'&&this.editor.settings.mode==='preset'){
   const e=this.editor,s=this.selected,p=e.settings.preset,old=this.plan().sample(s,s.start).position,delta=new THREE.Vector3().fromArray(position).sub(old);
   if(p.movement==='orbit'){const turn=movementProgress(s.source_start,p,this.timeline.duration)-movementProgress(p.reference_time,p,this.timeline.duration);delta.applyAxisAngle(new THREE.Vector3(0,1,0),-TWO_PI*p.orbit_degrees/360*turn*(p.direction==='left'?-1:1));}
   return presetPlan(e.capture,e.settings,e.capture.duration,e.time).anchorPosition.clone().add(delta).toArray();
  }
  return new THREE.Vector3().fromArray(position).sub(this.offset(id)).toArray();
 }
 sync(){
  const t=this.timeline;if(t)renumberCameras(t);this.undo.disabled=!this.undoStack.length||!!this.editor.renderController;this.redo.disabled=!this.redoStack.length||!!this.editor.renderController;if(!t)return;
  const structure=JSON.stringify([t.selected_id,t.duration,t.segments.map(s=>[s.id,s.name,s.start,s.end])]);if(this.structure===structure&&this.structureTimeline===t){this.playhead();return;}this.structure=structure;this.structureTimeline=t;
  this.blocks.replaceChildren();const duration=t.duration;
  t.segments.forEach((s,i)=>{
   const block=document.createElement('div');block.className='cw-camera-block';block.dataset.cameraId=s.id;block.tabIndex=0;block.setAttribute('role','button');block.setAttribute('aria-label',`${s.name} · ${s.start.toFixed(2)}–${s.end.toFixed(2)} seconds`);block.setAttribute('aria-pressed',String(s.id===t.selected_id));
   block.style.left=`${s.start/duration*100}%`;block.style.width=`${(s.end-s.start)/duration*100}%`;block.style.setProperty('--camera-color',CAMERA_COLORS[i%CAMERA_COLORS.length]);
   block.title=`${s.name} · ${s.start.toFixed(2)}–${s.end.toFixed(2)}s · Right-click for options`;
   const label=document.createElement('span');label.textContent=s.name;block.append(label);
   for(const side of ['start','end']){const edge=document.createElement('span');edge.className=`cw-camera-edge cw-camera-edge-${side}`;edge.dataset.edge=side;edge.setAttribute('role','slider');edge.tabIndex=0;edge.setAttribute('aria-label',`${s.name} ${side} time`);edge.setAttribute('aria-valuenow',String(s[side]));edge.setAttribute('aria-valuemin','0');edge.setAttribute('aria-valuemax',String(duration));block.append(edge);edge.onkeydown=event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();event.stopPropagation();this.mutate(()=>changeTiming(t,s.id,side,s[side]+(event.key==='ArrowRight'?1:-1)/t.fps));};}
   block.onkeydown=event=>{if(event.target!==block)return;if(event.key==='Enter'||event.key===' '){event.preventDefault();this.select(s.id);}if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();this.select(s.id);const r=block.getBoundingClientRect();this.openMenu(r.left,r.bottom);}};
   this.blocks.append(block);
   const b=t.segments[i+1];if(b&&Math.abs(s.end-b.start)<1e-7){const seam=document.createElement('div');seam.className='cw-camera-seam';seam.dataset.boundary=s.id;seam.style.left=`${s.end/duration*100}%`;seam.title='Adjust both cameras’ timing';seam.setAttribute('aria-label',`Shared timing boundary · ${s.name} / ${b.name}`);seam.setAttribute('role','slider');seam.tabIndex=0;seam.onkeydown=event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();event.stopPropagation();this.mutate(()=>moveBoundary(t,s.id,s.end+(event.key==='ArrowRight'?1:-1)/t.fps));};this.blocks.append(seam);}
  });
  this.playhead();
 }
 playhead(){if(!this.timeline)return;const t=this.timeline;this.head.style.left=`${Math.max(0,Math.min(1,this.editor.time/t.duration))*100}%`;const active=activeSegment(t,this.editor.time);this.editor.element.querySelector('.cw-camera-label').textContent=`${active.name} · Preview`;for(const block of this.blocks.querySelectorAll('[data-camera-id]'))block.classList.toggle('cw-camera-playing',block.dataset.cameraId===active.id);}
 pointerDown(event){
  if(event.button!==0||!this.timeline||this.editor.renderController)return;
  const seam=event.target.closest('[data-boundary]'),block=event.target.closest('[data-camera-id]');if(!seam&&!block)return;
  event.preventDefault();event.stopPropagation();this.closeMenu();const id=seam?.dataset.boundary??block.dataset.cameraId;if(!seam)this.select(id);this.track.focus();this.editor.setPlaying(false);
  const initial=clone(this.timeline),before=JSON.stringify(this.editor.settings),r=this.blocks.getBoundingClientRect(),x=event.clientX,s=initial.segments.find(s=>s.id===id),kind=event.target.dataset.edge??'move';let moved=false;
  this.track.setPointerCapture(event.pointerId);
  let pending=null,frame=null;const flush=()=>{frame=null;if(!pending)return;const e=pending;pending=null;
   const delta=(e.clientX-x)/r.width*initial.duration;if(Math.abs(e.clientX-x)<2&&!moved)return;moved=true;
   const t=clone(initial);if(seam)moveBoundary(t,id,s.end+delta);else changeTiming(t,id,kind,(kind==='end'?s.end:s.start)+delta);
   this.editor.settings.camera_timeline=t;this.editor.makePath();this.editor.setTime(this.editor.time);this.sync();
  };
  const move=e=>{pending={clientX:e.clientX};if(frame===null)frame=requestAnimationFrame(flush);};
  const end=e=>{if(frame!==null)cancelAnimationFrame(frame);flush();this.track.removeEventListener('pointermove',move);this.track.removeEventListener('pointerup',end);this.track.removeEventListener('pointercancel',cancel);this.track.removeEventListener('lostpointercapture',end);if(this.track.hasPointerCapture(event.pointerId))this.track.releasePointerCapture(event.pointerId);if(moved){this.record(before);this.persist();}this.editor.makePath(true);this.editor.setTime(this.editor.time);this.editor.syncControls();};
  const cancel=()=>{pending=null;if(frame!==null)cancelAnimationFrame(frame);this.editor.settings=JSON.parse(before);this.refresh();end();};
  this.track.addEventListener('pointermove',move);this.track.addEventListener('pointerup',end);this.track.addEventListener('pointercancel',cancel);this.track.addEventListener('lostpointercapture',end);
 }
 openMenu(x,y,gapTime=null){
  this.closeMenu();if(!this.timeline||this.editor.renderController)return;const t=this.timeline,s=this.selected,i=t.segments.indexOf(s);
  const menu=document.createElement('div');menu.className='cw-camera-context';menu.setAttribute('role','menu');menu.style.left=`${x}px`;menu.style.top=`${y}px`;this.menu=menu;document.body.append(menu);
  const action=(text,fn,disabled=false)=>{const b=document.createElement('button');b.textContent=text;b.setAttribute('role','menuitem');b.disabled=disabled;b.onclick=()=>{this.closeMenu();fn();};menu.append(b);return b;};
  const gap=gapTime===null?null:gapAtTime(t,gapTime);
  if(gap){action('Fill gap with camera',()=>this.fill(gapTime),t.segments.length>=64);}
  else {
  action('Split into new camera',()=>this.split(),this.editor.time-s.start<1/t.fps-1e-7||s.end-this.editor.time<1/t.fps-1e-7);
  for(const [neighbor,left,right,label] of [[t.segments[i-1],t.segments[i-1],s,'previous'],[t.segments[i+1],s,t.segments[i+1],'next']])if(neighbor){
   let join=joinBetween(t,left.id,right.id);
   const connect=()=>{if(!join){join={left:left.id,right:right.id,connected:false,smooth:false,frames:DEFAULT_BLEND_FRAMES,preserve:false,point:null};t.joins.push(join);}return join;};
   action(`${join?.connected?'✓ ':''}Connect to ${label} camera`,()=>this.setJoin(connect(),{connected:!join?.connected}));
   const isGap=right.start>left.end+1e-7;
   if(!isGap){
    action(`${join?.smooth?'✓ ':''}Smooth transition ${label==='previous'?'from previous':'to next'}`,()=>this.setJoin(connect(),{smooth:!join?.smooth}),!join?.connected);
    if(join?.connected&&join.smooth){const row=document.createElement('label');row.textContent=`Transition ${label} · frames`;const input=document.createElement('input');Object.assign(input,{type:'number',min:0,max:600,step:1,value:join?.frames??DEFAULT_BLEND_FRAMES});input.setAttribute('aria-label',`Transition ${label} frames`);input.disabled=!join?.connected;row.append(input);menu.append(row);input.oninput=input.onchange=()=>{if(!input.checkValidity()||input.value==='')return;this.setJoin(connect(),{frames:Number(input.value),smooth:Number(input.value)>0});};}
   }
  }
  for(const side of ['start','end']){
   const neighbor=t.segments[i+(side==='start'?-1:1)],hasHold=side==='start'?s.start>0&&(!neighbor||neighbor.end<s.start-1e-7):s.end<t.duration&&(!neighbor||neighbor.start>s.end+1e-7);if(!hasHold)continue;
   const pref=holdTransition(t,s,side),text=side==='start'?'Ease in from hold':'Ease out to hold';
   action(`${pref.smooth?'✓ ':''}${text}`,()=>this.setHold(s,side,{smooth:!pref.smooth}));
   if(pref.smooth){const row=document.createElement('label');row.textContent=`${side==='start'?'Ease in':'Ease out'} · frames`;const input=document.createElement('input');Object.assign(input,{type:'number',min:0,max:600,step:1,value:pref.frames});input.setAttribute('aria-label',`${text} frames`);row.append(input);menu.append(row);input.oninput=input.onchange=()=>{if(input.value!==''&&input.checkValidity())this.setHold(s,side,{frames:Number(input.value)});};}
  }
  action('Delete camera',()=>this.remove(),t.segments.length===1);
  }
  const rect=menu.getBoundingClientRect();menu.style.left=`${Math.max(4,Math.min(x,window.innerWidth-rect.width-4))}px`;menu.style.top=`${Math.max(4,Math.min(y,window.innerHeight-rect.height-4))}px`;
  menu.onkeydown=e=>{if(e.key==='Escape'){this.closeMenu();this.track.focus();}e.stopPropagation();};menu.querySelector('button:not(:disabled)')?.focus();
 }
 closeMenu(){this.menu?.remove();this.menu=null;}
 dispose(){this.closeMenu();window.removeEventListener('keydown',this.key,true);for(const event of ['pointerup','pointercancel'])window.removeEventListener(event,this.gestureEnd,true);window.removeEventListener('blur',this.gestureEnd);this.disposeScrubber?.();document.removeEventListener('pointerdown',this.dismiss,true);this.editor.element.removeEventListener('pointerdown',this.gestureStart,true);}
}
