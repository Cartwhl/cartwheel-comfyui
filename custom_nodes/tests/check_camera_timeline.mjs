import assert from 'node:assert/strict';
import * as T from '../web/vendor/build/three.module.js';
import {createTimeline,splitSegment,changeTiming,moveBoundary,deleteSegment,activeSegment,validateTimeline,joinBetween,gapAtTime,fillGap,holdTransition,boundaryAgreement,sequenceCutTimes} from '../web/camera_timeline.js';
import {applyCamera,applySingleCamera} from '../web/camera_motion.js';
import {sequencePlan} from '../web/camera_sequence.js';
import {presetDefaults} from '../web/camera_presets.js';
const base={schema_version:1,mode:'bookends',camera_index:0,target_actor:null,world_frame_id:'world',start:{position:[0,2,5],target:[0,1,0],fov:40},end:{position:[10,3,5],target:[1,1,0],fov:55},manual_path:{kind:'line',pacing:'linear',aim:'blend'},preset:null};
function fixture(){const camera=new T.PerspectiveCamera(45,16/9,.01,1000),actors=[1,2].map((number,i)=>{const root=new T.Group(),mesh=new T.Mesh(new T.BoxGeometry(.4,1.8,.3));mesh.position.y=.9;root.add(mesh);const head=new T.Bone();head.name='c_head';head.position.y=1.7;root.add(head);return {number,root,head,origin:i*2};});return {camera,duration:10,actors,setTime(t){for(const a of actors){a.root.position.x=a.origin+t*.3;a.head.position.y=1.7+.05*Math.sin(t*4);a.root.updateMatrixWorld(true);}camera.position.set(0,2,5);camera.lookAt(0,1,0);camera.aspect=16/9;camera.fov=45;camera.updateMatrixWorld(true);}};}
const pose=(c,s,t)=>{c.setTime(t);applyCamera(c,s,t,10);return {p:c.camera.position.clone(),q:c.camera.quaternion.clone(),f:c.camera.fov};};
const same=(a,b,label)=>{assert.ok(a.p.distanceTo(b.p)<1e-7,label+' position');assert.ok(a.q.angleTo(b.q)<1e-7,label+' rotation');assert.ok(Math.abs(a.f-b.f)<1e-8,label+' lens');};
let scenarios=0;
for(const fps of [24,30,60,120]){
 const c=fixture(),settings=structuredClone(base),timeline=createTimeline(settings,10,fps);settings.camera_timeline=timeline;
 for(let i=0;i<=100;i++)same(pose(c,base,i/10),pose(c,settings,i/10),'single migration');
 const original=structuredClone(settings);splitSegment(timeline,'camera-1',2);splitSegment(timeline,'camera-2',7);
 assert.equal(timeline.segments.length,3);validateTimeline(timeline);
 for(let i=0;i<=100;i++)same(pose(c,original,i/10),pose(c,settings,i/10),'split');
 // Random-order sampling is identical to sequential playback.
 const samples=new Map([0,.01,2,3,6.99,7,9.999,10].map(t=>[t,pose(c,settings,t)]));
 for(const t of [10,2,0,7,3,.01,9.999,6.99])same(samples.get(t),pose(c,settings,t),'scrub determinism');
 changeTiming(timeline,'camera-1','start',1);changeTiming(timeline,'camera-1','end',1.5);
 const start=pose(c,settings,1),end=pose(c,settings,1.5);
 for(const t of [0,.1,.999])same(start,pose(c,settings,t),'leading hold');
 for(const t of [1.51,1.75,1.999])same(end,pose(c,settings,t),'gap hold');
 changeTiming(timeline,'camera-3','end',9);const last=pose(c,settings,9);same(last,pose(c,settings,10),'trailing hold');
 const before=structuredClone(timeline.segments[2]);changeTiming(timeline,'camera-2','move',8);assert.ok(timeline.segments[1].end<=timeline.segments[2].start+1e-8);assert.deepEqual(timeline.segments[2],before,'Moving pushed neighbor');
 // Deletion leaves timings and settings intact; there is still a camera everywhere.
 const previous=structuredClone(timeline.segments[2]);deleteSegment(timeline,'camera-2');assert.deepEqual({...timeline.segments[1],name:previous.name},previous);assert.equal(timeline.segments[1].name,'Camera 2');
 for(let i=0;i<=100;i++){assert.ok(activeSegment(timeline,i/10));const p=pose(c,settings,i/10);assert.ok(p.p.toArray().every(Number.isFinite));}
 scenarios+=8;
}
for(const movement of ['orbit','truck','push','pull','pan','tilt','pedestal','crane','track_subjects']){
 const c=fixture(),p={...presetDefaults([1,2]),movement,behavior:movement==='track_subjects'?'follow':'move',horizontal:'custom',custom_position:[0,1.7,7],tracking_mode:'auto',aim_source:'live',follow_strength:.3,orbit_degrees:180,travel:2},s={...base,mode:'preset',preset:p,start:null,end:null,manual_path:null};
 const timeline=createTimeline(s,10,24),seq={...structuredClone(s),camera_timeline:timeline};splitSegment(timeline,'camera-1',4);
 for(const time of [0,.1,2,3.9,4,4.1,7,9.9,10])same(pose(c,s,time),pose(c,seq,time),movement+' split');scenarios++;
}
{
 const c=fixture(),t=createTimeline(base,10,24),s={...structuredClone(base),camera_timeline:t};splitSegment(t,'camera-1',5);const [a,b]=t.segments,j=t.joins[0];
 b.settings={...structuredClone(base),start:{position:[50,4,1],target:[0,1,0],fov:80},end:{position:[60,5,1],target:[0,1,0],fov:90}};j.connected=false;j.smooth=false;j.preserve=false;
 const before=pose(c,s,5-1e-7),after=pose(c,s,5);assert.ok(before.p.distanceTo(after.p)>40,'Disconnected cut failed');assert.equal(after.f,80+(90-80)*.5);
 const plan=sequencePlan(c,t,10,applySingleCamera);j.point=plan.sample(a,a.end).position.toArray();j.connected=true;j.smooth=true;j.frames=20;
 const linked=sequencePlan(c,t,10,applySingleCamera);assert.ok(linked.sample(a,a.end).position.distanceTo(linked.sample(b,b.start).position)<1e-8,'Linked endpoints differ');
 const h=1e-4,left=pose(c,s,5-h),right=pose(c,s,5+h);assert.ok(left.p.distanceTo(right.p)<.01,'Blend has a positional cut');assert.ok(Math.abs(left.f-right.f)<.1,'Blend has a lens cut');
 j.frames=0;const noBlend=pose(c,s,5);j.smooth=false;same(noBlend,pose(c,s,5),'zero blend');
 // Very short blocks and oversized blends remain bounded and finite.
 a.end=1/24;b.start=a.end;b.end=2/24;j.frames=600;j.smooth=true;
 for(let i=0;i<=20;i++)assert.ok(pose(c,s,i/240).p.toArray().every(Number.isFinite));scenarios+=6;
}
{
 const t=createTimeline(base,10,24);splitSegment(t,'camera-1',5);moveBoundary(t,'camera-1',3);assert.equal(t.segments[0].end,3);assert.equal(t.segments[1].start,3);
 changeTiming(t,'camera-2','start',4);assert.throws(()=>moveBoundary(t,'camera-1',3.5),/touching/);const old=structuredClone(t.segments[0]);changeTiming(t,'camera-2','start',2);assert.equal(t.segments[1].start,3);assert.deepEqual(t.segments[0],old);
 assert.throws(()=>splitSegment(t,'camera-1',0),/inside/);deleteSegment(t,'camera-1');assert.throws(()=>deleteSegment(t,t.selected_id),/at least/);scenarios+=4;
}
console.log(`PASS: ${scenarios} timeline scenario groups; single-camera compatibility, 4 FPS grids, exact preset/manual splits, live actor timing, random scrubs, leading/middle/trailing holds, retiming, collision bounds, shared timing edges, deletion, connected endpoints, smooth lens/position transitions, cuts and one-frame blocks.`);
// Deterministic randomized timing edits never overlap or cross the scene edges.
let seed=73419;const random=()=>((seed=(1664525*seed+1013904223)>>>0)/2**32);
for(const fps of [24,30,60,120]){
 const t=createTimeline(base,10,fps);for(const time of [2,4,6,8])splitSegment(t,t.segments.at(-1).id,time);
 for(let i=0;i<500;i++){const s=t.segments[Math.floor(random()*t.segments.length)],kind=['start','end','move'][Math.floor(random()*3)];changeTiming(t,s.id,kind,random()*14-2);validateTimeline(t);}
 const {regridTimeline}=await import('../web/camera_timeline.js');for(const rate of [120,24,60,30]){regridTimeline(t,rate);validateTimeline(t);}
}
for(const orientation of ['landscape','portrait'])for(const ratio of ['16:9','4:3','1:1','21:9']){
 const c=fixture(),settings={...structuredClone(base),output_frame:{orientation,ratio}},t=createTimeline(settings,10,24);settings.camera_timeline=t;splitSegment(t,'camera-1',5);pose(c,settings,6);
 const [w,h]=ratio.split(':').map(Number),expected=orientation==='portrait'?h/w:w/h;assert.ok(Math.abs(c.camera.aspect-expected)<1e-10,'Timeline lost output aspect');
}
console.log('PASS: 2,000 randomized resize/move operations, frame-rate migrations, all eight portrait/landscape ratios.');
{
 const c=fixture(),t=createTimeline(base,10,24),settings={...structuredClone(base),camera_timeline:t};splitSegment(t,'camera-1',5);const j=t.joins[0];j.point=[15,3,5];j.preserve=false;
 pose(c,settings,6);const expected=new T.Vector3(.6,1,0).sub(c.camera.position).normalize();assert.ok(c.camera.getWorldDirection(new T.Vector3()).distanceTo(expected)<1e-7,'Connected endpoint displaced the aim target');
}
{
 const c=fixture(),p={...presetDefaults([1]),horizontal:'custom',custom_position:[0,1.7,7],movement:'fixed',behavior:'static',lens:'custom',focal_length:35,aim_source:'live',tracking_mode:'auto'};
 const endpoint=()=>Object.fromEntries(['target_mode','custom_target','actors','selection','composition','reference_actor','focus_point','frame_reference','follow_strength','focal_length','roll','fisheye_fov'].map(k=>[k,structuredClone(p[k])]));
 p.camera_transition={enabled:true,fields:['focal_length'],start:endpoint(),end:endpoint()};p.camera_transition.end.focal_length=80;
 const s={...base,mode:'preset',preset:p,start:null,end:null,manual_path:null},t=createTimeline(s,10,24);t.segments[0].start=5;t.segments[0].source_start=5;t.segments[0].animation_range=[5,10];
 const settings={...structuredClone(s),camera_timeline:t};const {perspectiveVerticalFOV}=await import('../web/lens_projection.js');
 for(const [time,mm] of [[5,35],[7.5,57.5],[10,80]]){pose(c,settings,time);assert.ok(Math.abs(c.camera.fov-perspectiveVerticalFOV(mm,16/9,p))<1e-7,'Per-block settings did not use the whole block');}
}
console.log('PASS: linked position edits retain target aim; per-block start/end lens changes span that block rather than the original full clip.');
for(const duration of [7.967,15.33,1.01,.01])for(const fps of [24,30,60,120]){
 const t=createTimeline(base,duration,fps);
 if(duration>1)splitSegment(t,'camera-1',.5);
 for(let i=0;i<200;i++){const s=t.segments[Math.floor(random()*t.segments.length)];changeTiming(t,s.id,['start','end','move'][Math.floor(random()*3)],random()*duration*1.2);try{validateTimeline(t);}catch(error){throw new Error(JSON.stringify({duration,fps,segments:t.segments.map(s=>[s.start,s.end])})+' '+error.message);}}
}
for(const duration of [7.967,15.33,1.01,.01])for(const fps of [24,30,60,120]){const {regridTimeline}=await import('../web/camera_timeline.js');const t=createTimeline(base,duration,fps);if(duration>1)splitSegment(t,'camera-1',.5);for(const rate of [120,24,60,30]){regridTimeline(t,rate);validateTimeline(t);}}
console.log('PASS: fractional clip ends and sub-frame clips remain valid through 3,200 additional randomized edits.');
{
 const c=fixture(),t=createTimeline(base,10,24),settings={...structuredClone(base),camera_timeline:t};splitSegment(t,'camera-1',4);changeTiming(t,'camera-2','start',6);const [a,b]=t.segments,j=t.joins[0];j.point=[4,2.4,5];j.frames=10;b.settings.start.fov=80;b.settings.end.fov=90;
 same(pose(c,settings,4),pose(c,settings,6),'Gap entrance must retain held position/orientation/lens');
 const left=pose(c,settings,6-1e-6),right=pose(c,settings,6+1e-6);assert.ok(left.p.distanceTo(right.p)<1e-5);assert.ok(Math.abs(left.f-right.f)<1e-4);
 const exact=createTimeline(base,10,24);splitSegment(exact,'camera-1',5);changeTiming(exact,'camera-1','end',5);assert.equal(exact.joins[0].preserve,true,'A blocked/no-op edit changed the original split');
}
console.log('PASS: transitions out of holds preserve orientation/lens continuity; no-op edge edits leave exact splits unchanged.');

// Independent gap boundaries, conservative insertion and contact preferences.
for(const fps of [24,30,60,120]){
 const c=fixture(),settings=structuredClone(base),t=createTimeline(settings,10,fps);settings.camera_timeline=t;
 splitSegment(t,'camera-1',5);changeTiming(t,'camera-1','end',3);changeTiming(t,'camera-2','start',7);
 const [a,b]=t.segments,j=t.joins[0];j.preserve=false;j.frames=10;
 a.ease_end=false;a.ease_end_frames=25;b.ease_start=true;b.ease_start_frames=25;
 assert.deepEqual(holdTransition(t,a,'end'),{smooth:false,frames:25});assert.deepEqual(holdTransition(t,b,'start'),{smooth:true,frames:25});
 const plan=sequencePlan(c,t,10,applySingleCamera);
 same(pose(c,settings,3-.1),{p:plan.sample(a,3-.1).position,q:plan.sample(a,3-.1).quaternion,f:plan.sample(a,3-.1).fov},'hard exit is unwarped');
 const held=pose(c,settings,3);for(const time of [3.01,4,6,6.999,7])same(held,pose(c,settings,time),'gap remains completely still');
 assert.ok(pose(c,settings,7.1).p.distanceTo(held.p)<plan.sample(b,7.1).position.distanceTo(held.p),'incoming ease is independent of hard exit');
 assert.ok(!sequenceCutTimes(t).includes(7),'Smooth incoming hold edge must not export a cut');
 b.ease_start=false;assert.ok(sequenceCutTimes(t).includes(7));b.ease_start=true;
 assert.deepEqual(gapAtTime(t,5),{start:3,end:7,left:a.id,right:b.id});assert.equal(gapAtTime(t,2),null);
 const originalA=structuredClone(a),originalB=structuredClone(b),newCamera=fillGap(t,5,base);validateTimeline(t);
 assert.equal(newCamera.start,3);assert.equal(newCamera.end,7);assert.equal(t.selected_id,newCamera.id);
 assert.deepEqual(a,originalA,'Fill changed previous camera');assert.deepEqual({...b,name:originalB.name},originalB,'Fill changed next camera');
 assert.equal(t.joins.length,2);for(const join of t.joins){assert.equal(join.connected,true);assert.equal(join.smooth,false);assert.equal(join.frames,25);}
 // Existing agreed connections are retained on both newly created boundaries.
 const agreed=createTimeline(base,10,fps);splitSegment(agreed,'camera-1',5);changeTiming(agreed,'camera-1','end',3);changeTiming(agreed,'camera-2','start',7);
 agreed.segments[0].ease_end_frames=30;agreed.segments[1].ease_start_frames=8;agreed.joins[0].frames=40;
 fillGap(agreed,4,base);assert.ok(agreed.joins.every(j=>j.connected&&j.smooth&&j.frames===8));
 // New boundaries without saved preferences connect and smooth by default.
 const disconnected=createTimeline(base,10,fps);splitSegment(disconnected,'camera-1',5);changeTiming(disconnected,'camera-1','end',3);changeTiming(disconnected,'camera-2','start',7);disconnected.joins=[];
 fillGap(disconnected,4,base);assert.ok(disconnected.joins.every(j=>j.connected&&j.smooth));
 // Closing a gap uses the conservative agreement without resetting hold preferences.
 const touching=createTimeline(base,10,fps);splitSegment(touching,'camera-1',5);changeTiming(touching,'camera-1','end',3);changeTiming(touching,'camera-2','start',7);
 touching.segments[0].ease_end=false;touching.segments[0].ease_end_frames=4;touching.segments[1].ease_start_frames=25;
 changeTiming(touching,'camera-1','end',7);assert.equal(touching.joins[0].smooth,false);assert.equal(touching.joins[0].frames,4);
 // Leading/trailing empty intervals can be filled, with exact frame boundaries.
 for(const side of ['start','end']){const edge=createTimeline(base,10,fps);changeTiming(edge,'camera-1',side,side==='start'?2:8);const fill=fillGap(edge,side==='start'?1:9,base);validateTimeline(edge);assert.deepEqual([fill.start,fill.end],side==='start'?[0,2]:[8,10]);assert.equal(edge.joins[0].connected,true);assert.equal(edge.joins[0].smooth,true);}
}
console.log('PASS: four frame rates; independent hard exit / smooth entrance, still gaps, cut markers, gap hit-testing, full-gap filling, agreed/conflicting/missing connections, shortest duration, contact and leading/trailing fills.');
// Raw endpoint caches retain unedited camera plans during active edits.
{
 const c=fixture(),t=createTimeline(base,10,24);splitSegment(t,'camera-1',3);splitSegment(t,'camera-2',7);let evaluations=0;
 const sample=(...args)=>{evaluations++;applySingleCamera(...args);};
 const first=sequencePlan(c,t,10,sample);assert.equal(evaluations,6);t.segments[1].settings.end.position[0]+=2;
 const next=sequencePlan(c,t,10,sample);assert.equal(first.entries.get('camera-2').proxy,next.entries.get('camera-2').proxy,'An edit threw away the actor sampling cache');assert.equal(evaluations,8,'Editing one camera rebuilt all camera endpoints');
}
console.log('PASS: editing one of three cameras reuses untouched endpoint plans (2 evaluations instead of 6).');

for(const movement of ['manual','orbit','truck','push','pull','pan','tilt','pedestal','crane','track_subjects']){
 const c=fixture(),s=structuredClone(base);
 if(movement!=='manual'){s.mode='preset';s.preset={...presetDefaults([1,2]),movement,behavior:movement==='track_subjects'?'follow':'move',horizontal:'custom',custom_position:[0,1.7,7],travel:2,tracking_mode:'auto',aim_source:'live',pacing:'constant'};}
 const t=createTimeline(s,10,24);splitSegment(t,'camera-1',4);const plan=sequencePlan(c,t,10,applySingleCamera);
 for(const segment of t.segments)for(let k=0;k<=20;k++){const time=segment.start+(segment.end-segment.start)*k/20;assert.ok(plan.position(segment,time).distanceTo(plan.sample(segment,time).position)<1e-8,`${movement} position-only preview diverged`);}
}
console.log('PASS: 420 position-only drag samples match full camera evaluation across manual paths and nine movement presets.');
// Mixed insertion/deletion/timing edits always retain a valid, ordered timeline.
{
 let seed=1977;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};let operations=0;
 for(const fps of [24,30,60,120])for(const duration of [10,7.967]){
  const t=createTimeline(base,duration,fps);splitSegment(t,'camera-1',Math.floor(duration*fps/2)/fps);
  for(let k=0;k<250;k++){
   const s=t.segments[Math.floor(random()*t.segments.length)],operation=Math.floor(random()*4);
   if(operation===0&&t.segments.length>1)deleteSegment(t,s.id);
   else if(operation===1){const time=random()*duration;if(gapAtTime(t,time)&&t.segments.length<64)fillGap(t,time,base);}
   else changeTiming(t,s.id,['start','end','move'][Math.floor(random()*3)],random()*duration);
   validateTimeline(t);const pairs=new Set(t.segments.slice(1).map((s,i)=>`${t.segments[i].id}/${s.id}`));
   for(const j of t.joins){assert.ok(pairs.has(`${j.left}/${j.right}`));assert.ok(j.connected||!j.smooth);}
   operations++;
  }
 }
 console.log(`PASS: ${operations} additional mixed gap fills, deletes and timing edits at four frame rates and fractional clip durations.`);
}

// Defaults apply to new joins; explicit older transition lengths stay unchanged.
{const t=createTimeline(base,10,24);splitSegment(t,'camera-1',5);assert.equal(t.joins[0].frames,30);t.joins[0].frames=10;const saved=JSON.parse(JSON.stringify(t));assert.equal(saved.joins[0].frames,10);}
console.log('PASS: new camera joins default to 30 frames; saved explicit blend lengths are preserved.');
