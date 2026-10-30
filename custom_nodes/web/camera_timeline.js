// Timeline intervals use seconds; ends are exclusive except for the final sample.
// Every segment keeps a source interval so a split never restarts a move/easing.
export const TIMELINE_VERSION=1;
export const DEFAULT_BLEND_FRAMES=30;
export const CAMERA_COLORS=['#f0c36a','#78cba5','#9fa9f5','#eb9da8','#80c9de','#cda4e5'];
export const clone=value=>structuredClone(value);
export function recipe(settings){const {camera_timeline,...rest}=settings;return clone(rest);}
export function createTimeline(settings,duration,fps=24){return {schema_version:1,fps,duration,selected_id:'camera-1',next_id:2,segments:[{id:'camera-1',name:'Camera 1',start:0,end:duration,source_start:0,source_end:duration,settings:recipe(settings),offset_start:[0,0,0],offset_end:[0,0,0]}],joins:[]};}
export function renumberCameras(timeline){timeline.segments.forEach((s,i)=>{s.name=`Camera ${i+1}`;});return timeline;}
export const selectedSegment=timeline=>timeline.segments.find(s=>s.id===timeline.selected_id)??timeline.segments[0];
export const joinBetween=(timeline,left,right)=>timeline.joins.find(j=>j.left===left&&j.right===right);
export const snapTime=(time,timeline)=>Math.max(0,Math.min(timeline.duration,Math.round(time*timeline.fps)/timeline.fps));
export function splitSegment(timeline,id,time){
 const i=timeline.segments.findIndex(s=>s.id===id),a=timeline.segments[i],at=snapTime(time,timeline),minimum=1/timeline.fps;
 if(!a||at-a.start<minimum-1e-8||a.end-at<minimum-1e-8)throw new Error('Place the playhead at least one frame inside this camera.');
 if(timeline.segments.length>=64)throw new Error('A scene supports up to 64 camera moves.');
 const b=clone(a),u=(at-a.start)/(a.end-a.start),source=a.source_start+(a.source_end-a.source_start)*u;
 b.id=`camera-${timeline.next_id++}`;b.name=`Camera ${b.id.slice(7)}`;b.start=at;b.source_start=source;
 const offset=a.offset_start.map((v,k)=>v+(a.offset_end[k]-v)*u);a.offset_end=[...offset];b.offset_start=[...offset];
 a.end=at;a.source_end=source;
 // Exterior hold preferences survive a split; the new interior boundary is exact.
 delete a.ease_end;delete a.ease_end_frames;delete b.ease_start;delete b.ease_start_frames;
 const next=timeline.segments[i+1];if(next){const join=joinBetween(timeline,a.id,next.id);if(join)join.left=b.id;}
 timeline.segments.splice(i+1,0,b);timeline.joins.push({left:a.id,right:b.id,connected:true,smooth:true,frames:DEFAULT_BLEND_FRAMES,preserve:true,point:null});timeline.selected_id=b.id;
 renumberCameras(timeline);return b;
}
export function changeTiming(timeline,id,kind,time){
 const i=timeline.segments.findIndex(s=>s.id===id),s=timeline.segments[i];if(!s)throw new Error('Select a camera.');
 const previous=timeline.segments[i-1],next=timeline.segments[i+1],minimum=1/timeline.fps;
 const oldStart=s.start,oldEnd=s.end;
 const low=previous?.end??0,high=next?.start??timeline.duration,at=snapTime(time,timeline),length=s.end-s.start;
 if(kind==='move'){
  const endFrame=Math.abs(s.end-timeline.duration)<1e-7?Math.ceil(s.end*timeline.fps-1e-8):Math.round(s.end*timeline.fps),frames=endFrame-Math.round(s.start*timeline.fps);
  const highFrame=Math.floor(high*timeline.fps+1e-8),lowFrame=Math.round(low*timeline.fps);if(highFrame-lowFrame<frames)return s;
  const startFrame=Math.max(lowFrame,Math.min(highFrame-frames,Math.round(at*timeline.fps)));
  s.start=startFrame/timeline.fps;s.end=Math.min(timeline.duration,(startFrame+frames)/timeline.fps);
 }
 else if(kind==='start')s.start=Math.max(low,Math.min(Math.floor((s.end-Math.min(minimum,timeline.duration)+1e-8)*timeline.fps)/timeline.fps,at));
 else if(kind==='end')s.end=Math.min(high,Math.max(Math.ceil((s.start+Math.min(minimum,timeline.duration)-1e-8)*timeline.fps)/timeline.fps,at));
 else throw new Error('Unknown timeline adjustment.');
 if(Math.abs(s.start-oldStart)>1e-8||Math.abs(s.end-oldEnd)>1e-8){for(const j of timeline.joins)if(j.left===id||j.right===id)j.preserve=false;
  for(const [left,right,wasGap] of [[previous,s,previous&&oldStart>previous.end+1e-7],[s,next,next&&next.start>oldEnd+1e-7]])if(left&&right&&wasGap&&Math.abs(left.end-right.start)<1e-7)reconcileTouching(timeline,left,right);
 }
 return s;
}
export function moveBoundary(timeline,leftId,time){
 const i=timeline.segments.findIndex(s=>s.id===leftId),a=timeline.segments[i],b=timeline.segments[i+1];
 if(!a||!b||Math.abs(a.end-b.start)>1e-7)throw new Error('Shared timing handles require touching cameras.');
 const low=Math.ceil((a.start+1/timeline.fps-1e-8)*timeline.fps)/timeline.fps,high=Math.floor((b.end-1/timeline.fps+1e-8)*timeline.fps)/timeline.fps;
 const at=Math.max(low,Math.min(high,snapTime(time,timeline)));
 if(Math.abs(a.end-at)<1e-8)return;
 a.end=b.start=at;for(const j of timeline.joins)if([a.id,b.id].includes(j.left)||[a.id,b.id].includes(j.right))j.preserve=false;
}
export function deleteSegment(timeline,id){
 if(timeline.segments.length===1)throw new Error('Keep at least one camera in the scene.');
 const i=timeline.segments.findIndex(s=>s.id===id);if(i<0)return;
 timeline.segments.splice(i,1);timeline.joins=timeline.joins.filter(j=>j.left!==id&&j.right!==id);
 // Deletion changes no neighbor's duration, transform or settings.
 if(timeline.selected_id===id)timeline.selected_id=timeline.segments[Math.min(i,timeline.segments.length-1)].id;renumberCameras(timeline);
}
// Hold edges ease by default, independently of whether paths are connected.
export function holdTransition(timeline,segment,side){
 const i=timeline.segments.indexOf(segment),neighbor=timeline.segments[i+(side==='start'?-1:1)],join=neighbor&&(side==='start'?joinBetween(timeline,neighbor.id,segment.id):joinBetween(timeline,segment.id,neighbor.id));
 return {smooth:segment[`ease_${side}`]??true,frames:segment[`ease_${side}_frames`]??join?.frames??DEFAULT_BLEND_FRAMES};
}
export function boundaryAgreement(timeline,left,right){
 const join=left&&right&&joinBetween(timeline,left.id,right.id),out=left&&holdTransition(timeline,left,'end'),incoming=right&&holdTransition(timeline,right,'start');
 const connected=join?!!join.connected:true;
 return {connected,smooth:connected&&(out?.smooth??true)&&(incoming?.smooth??true),frames:Math.min(out?.frames??DEFAULT_BLEND_FRAMES,incoming?.frames??DEFAULT_BLEND_FRAMES)};
}
function reconcileTouching(timeline,left,right){
 const agreement=boundaryAgreement(timeline,left,right);let join=joinBetween(timeline,left.id,right.id);
 if(!join){join={left:left.id,right:right.id,point:null};timeline.joins.push(join);}
 Object.assign(join,agreement,{preserve:false});
}
export function gapAtTime(timeline,time){
 if(!Number.isFinite(time)||time<0||time>timeline.duration)return null;
 let previous=null;
 for(const next of timeline.segments){
  if(time>= (previous?.end??0)&&time<next.start)return {start:previous?.end??0,end:next.start,left:previous?.id??null,right:next.id};
  if(time>=next.start&&time<next.end)return null;previous=next;
 }
 return time>=previous.end&&previous.end<timeline.duration?{start:previous.end,end:timeline.duration,left:previous.id,right:null}:null;
}
export function fillGap(timeline,time,settings){
 const gap=gapAtTime(timeline,time);if(!gap)throw new Error('Right-click an empty interval to add a camera.');
 if(gap.end-gap.start<Math.min(1/timeline.fps,timeline.duration)-1e-7)throw new Error('A camera needs at least one frame.');
 if(timeline.segments.length>=64)throw new Error('A scene supports up to 64 camera moves.');
 const left=timeline.segments.find(s=>s.id===gap.left),right=timeline.segments.find(s=>s.id===gap.right),old=left&&right&&joinBetween(timeline,left.id,right.id),agreement=boundaryAgreement(timeline,left,right);
 const item={id:`camera-${timeline.next_id++}`,name:'',start:gap.start,end:gap.end,source_start:0,source_end:timeline.duration,settings:recipe(settings),offset_start:[0,0,0],offset_end:[0,0,0],ease_start:agreement.smooth,ease_end:agreement.smooth,ease_start_frames:agreement.frames,ease_end_frames:agreement.frames};item.name=`Camera ${item.id.slice(7)}`;
 timeline.joins=timeline.joins.filter(j=>j!==old);
 const index=right?timeline.segments.indexOf(right):timeline.segments.length;timeline.segments.splice(index,0,item);
 for(const [a,b] of [[left,item],[item,right]])if(a&&b)timeline.joins.push({left:a.id,right:b.id,...agreement,preserve:false,point:old?.point?clone(old.point):null});
 timeline.selected_id=item.id;renumberCameras(timeline);return item;
}
export function activeSegment(timeline,time){
 let chosen=timeline.segments[0];for(const s of timeline.segments){if(s.start>time)break;chosen=s;}return chosen;
}
export function validateTimeline(timeline){
 if(timeline?.schema_version!==1||!Number.isFinite(timeline.duration)||timeline.duration<=0||!Number.isFinite(timeline.fps)||![24,30,60,120].includes(timeline.fps)||!Array.isArray(timeline.segments)||!timeline.segments.length||timeline.segments.length>64)throw new Error('Invalid camera timeline.');
 let previous=0;const ids=new Set();
 for(const s of timeline.segments){if(typeof s.id!=='string'||ids.has(s.id)||![s.start,s.end,s.source_start,s.source_end].every(Number.isFinite)||s.start<previous-1e-7||s.end>timeline.duration+1e-7||s.end-s.start<Math.min(1/timeline.fps,timeline.duration)-1e-7||s.source_start<0||s.source_end>timeline.duration+1e-7||s.source_end<=s.source_start||s.settings?.camera_timeline)throw new Error('Camera moves must be ordered, nonoverlapping, and at least one frame long.');for(const time of [s.start,s.end])if(Math.abs(time-timeline.duration)>1e-7&&Math.abs(time*timeline.fps-Math.round(time*timeline.fps))>1e-5)throw new Error('Camera boundaries must snap to frames.');previous=s.end;ids.add(s.id);}
 if(!ids.has(timeline.selected_id))throw new Error('The selected camera is unavailable.');return timeline;
}

export function sequenceCutTimes(timeline){
 const cuts=[];
 for(const [i,s] of timeline.segments.entries()){
  if(i){const j=joinBetween(timeline,timeline.segments[i-1].id,s.id);const previous=timeline.segments[i-1],incoming=holdTransition(timeline,s,'start'),gap=s.start>previous.end+1e-7;if(!j?.connected||!(gap?incoming.smooth:j.smooth)||!(gap?incoming.frames:j.frames))cuts.push(s.start);}
  for(const frame of s.settings.manual_path?.source_frames??[])if(frame.cut&&frame.time>=s.source_start&&frame.time<=s.source_end)cuts.push(s.start+(frame.time-s.source_start)/(s.source_end-s.source_start)*(s.end-s.start));
 }
 return [...new Set(cuts)].sort((a,b)=>a-b);
}
export function regridTimeline(timeline,fps){
 if(![24,30,60,120].includes(fps))throw new Error('Choose a supported frame rate.');
 const minimum=Math.min(1/fps,timeline.duration);
 if(timeline.segments.length*minimum>timeline.duration+1e-7)throw new Error('This sequence has more camera moves than frames at that rate.');
 timeline.fps=fps;
 if(timeline.duration<1/fps){timeline.segments[0].start=0;timeline.segments[0].end=timeline.duration;return;}
 const count=Math.floor(timeline.duration*fps+1e-8);let previous=0;
 timeline.segments.forEach((s,i)=>{const remaining=timeline.segments.length-1-i,maxEnd=count-remaining,terminal=Math.abs(s.end-timeline.duration)<1e-7;
  const start=Math.max(previous,Math.min(Math.round(s.start*fps),maxEnd-1)),end=Math.min(maxEnd,Math.max(start+1,Math.round(s.end*fps)));
  s.start=start/fps;s.end=terminal&&!remaining?timeline.duration:end/fps;previous=end;
 });
}
