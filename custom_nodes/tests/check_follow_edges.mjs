import assert from 'node:assert/strict';
import * as T from '../web/vendor/build/three.module.js';
import {actionFollowPlan} from '../web/action_follow.js';
import {composedOrientation} from '../web/camera_composition.js';
const smooth=t=>{t=T.MathUtils.clamp(t,0,1);return t*t*(3-2*t);};
function fixture(hz=60,strength=.28){
 const duration=4,times=Array.from({length:duration*hz+1},(_,i)=>i/hz);
 const parts=[-.35,-.30,-.25,.45].map((x,i)=>({point:new T.Vector3(x,1.3,0),halfSize:new T.Vector3(i===3?.65:.08,.1,.02)}));
 const focusPoints=parts.flatMap(r=>[-1,1].flatMap(x=>[-1,1].flatMap(y=>[-1,1].map(z=>r.point.clone().add(new T.Vector3(x*r.halfSize.x,y*r.halfSize.y,z*r.halfSize.z))))));
 const target=parts.reduce((sum,r)=>sum.add(r.point),new T.Vector3()).multiplyScalar(.25);
 return {times,duration,p:{aim_source:'live',follow_strength:strength,roll:0},aspect:1,fovs:times.map(()=>45),
 positions:times.map(t=>new T.Vector3(0,1.3,2+.7*(1-smooth(t/.55)+smooth((t-3.45)/.55)))),
 states:times.map(()=>({body:new T.Vector3(),target:target.clone(),focusTargets:parts,focusPoints,placement:[.5,.5]}))};
}
function offsets(input,plan){return plan.quaternions.map((q,i)=>composedOrientation(input.positions[i],plan.targets[i],0,45,1,[.5,.5]).invert().multiply(q));}
const metrics=[];
for(const hz of [24,30,60,120])for(const strength of [0,.25,.28,.8,1]){
 const input=fixture(hz,strength),plan=actionFollowPlan(input),delta=offsets(input,plan);
 const jumps=delta.slice(1).map((q,i)=>q.angleTo(delta[i]));
 const peak=Math.max(...jumps);
 assert.ok(plan.quaternions.every(q=>q.toArray().every(Number.isFinite)));
 assert.ok(peak*hz<.8,`Framing feasibility caused an abrupt correction at ${hz} FPS / ${strength}: ${peak}`);
 // The middle is unchanged: no framing correction when it cannot fit.
 for(let i=0;i<delta.length;i++)if(input.times[i]>1&&input.times[i]<3)assert.ok(delta[i].angleTo(new T.Quaternion())<1e-6);
 if(strength===1)assert.ok(delta.every(q=>q.angleTo(new T.Quaternion())<1e-6),'Exact follow was altered.');
 metrics.push({hz,strength,maxCorrectionDegrees:T.MathUtils.radToDeg(peak)});
}
// An offset filter must be deterministic at boundaries and leave path/lens alone.
const input=fixture(),copy=JSON.stringify({positions:input.positions,fovs:input.fovs}),first=actionFollowPlan(input),again=actionFollowPlan(input);
assert.equal(JSON.stringify({positions:input.positions,fovs:input.fovs}),copy);
for(const i of [0,1,2,7,237,238,239,240,80])assert.ok(first.quaternions[i].angleTo(again.quaternions[i])<1e-7);
for(const duration of [0,.03,.12]){
 const short=fixture();const count=duration===0?1:Math.max(2,Math.ceil(duration*60)+1);
 short.times=Array.from({length:count},(_,i)=>count===1?0:duration*i/(count-1));short.positions=short.times.map(()=>new T.Vector3(0,1.3,2.4));short.states=short.times.map(()=>short.states[0]);short.fovs=short.times.map(()=>45);short.duration=duration;
 assert.ok(actionFollowPlan(short).quaternions.every(q=>q.toArray().every(Number.isFinite)),'Short-clip edge support is invalid.');
}
console.log(JSON.stringify(metrics,null,2));
console.log('PASS: continuous fit-boundary transitions near both clip ends, 0/25/28/80/100%, 24/30/60/120 FPS, stable middle, unchanged exact follow, deterministic boundary seeking and fixed path/lens.');
