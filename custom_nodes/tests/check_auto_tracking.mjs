import assert from 'node:assert/strict';
import * as THREE from '../web/vendor/build/three.module.js';
import {TRACKING_DEFAULTS,trackingPlan,trackingOptions,steadyTargets,trackingPlacement,sampleTracking} from '../web/aim_tracking.js';
import {composedOrientation} from '../web/camera_composition.js';
const p={...TRACKING_DEFAULTS,tracking_mode:'auto',focus_point:'auto',shot:'full',roll:0,lens:'natural'};
const times=Array.from({length:601},(_,i)=>i/60),anchor=0;
function fixture({walking=false,bob=true}={}){
 const states=times.map(t=>({target:new THREE.Vector3(walking?t*.4:0,1+(bob?.3*Math.sin(t*12):0),0),body:new THREE.Vector3(walking?t*.4:0,.9+(bob?.3*Math.sin(t*12):0),0),placement:null}));
 return{states,positions:times.map(()=>new THREE.Vector3(0,1,5)),times,referenceIndex:anchor,p,aspect:16/9,fovs:times.map(()=>45),duration:10};
}
const broad=fixture(),auto=trackingPlan(broad),exact=trackingPlan({...broad,p:{...p,tracking_mode:'exact'}});
const variation=plan=>plan.quaternions.slice(1).reduce((sum,q,i)=>sum+q.angleTo(plan.quaternions[i]),0);
assert.ok(variation(auto)<1e-8,'Ground-stable aim must ignore stationary vertical bob');assert.ok(variation(exact)>1);
const walk=fixture({walking:true}),follow=steadyTargets(walk.states,p,times,0);
assert.ok(follow.every(t=>t.y===1));assert.ok(follow.at(-1).x>3.8);
const close=trackingPlan({...broad,p:{...p,shot:'close'}});
assert.ok(variation(close)<variation(exact)*.25);assert.equal(trackingOptions({...p,shot:'close'}).vertical,'gentle');
// An actor may roam inside the window without camera corrections.
const inside=fixture({bob:false});inside.states.forEach((s,i)=>s.target.x=.08*Math.sin(times[i]*3));
assert.ok(variation(trackingPlan(inside))<1e-8);
const direct=trackingPlan({...walk,p:{...p,tracking_mode:'exact'}}),natural=trackingPlan(walk);
assert.ok(natural.quaternions.at(-1).angleTo(natural.quaternions[0])>.2,'Walking needs real pan');
assert.ok(natural.quaternions.every((q,i)=>!i||q.angleTo(natural.quaternions[i-1])<=THREE.MathUtils.degToRad(61)/60));
for(const t of [8.5,.1,4.3,9])assert.ok(sampleTracking(natural,t).angleTo(sampleTracking(natural,t))<1e-7);
const motion={...p,tracking_mode:'exact',framing_motion:true};
const transition=trackingPlan({...broad,p:motion});
assert.deepEqual(trackingPlacement(motion,0,10,null),[1/3,1/3]);assert.deepEqual(trackingPlacement(motion,10,10,null),[2/3,1/3]);
assert.ok(transition.quaternions[0].angleTo(transition.quaternions.at(-1))>.2);
const off=trackingPlan({...walk,p:{...p,tracking_mode:'off'}});assert.ok(variation(off)<1e-8);
for(const lens of ['natural','fisheye'])for(const aspect of [16/9,9/16]){
 const plan=trackingPlan({...walk,p:{...p,lens},aspect});assert.ok(plan.quaternions.every(q=>q.toArray().every(Number.isFinite)));
}
console.log('Auto rejects stationary jumping/bobbing; grounded walking follows XZ; close-ups filter bounce; screen room holds aim; panning is bounded; planned thirds, fixed aim and both projections are deterministic and finite.');
