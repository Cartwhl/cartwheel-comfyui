import assert from 'node:assert/strict';
import * as T from '../web/vendor/build/three.module.js';
import {presetDefaults,presetPlan,subjectTravel,effectivePreset} from '../web/camera_presets.js';
function scene(moving){const actors=[1,2,3].map((number,i)=>{const root=new T.Group();for(const [name,x,y] of [['c_spine0',0,.9],['c_head',0,1.7],['l_uparm',-.2,1.4],['r_uparm',.2,1.4]]){const b=new T.Bone();b.name=name;b.position.set(x,y,0);root.add(b);}return{number,root};});return{actors,duration:3,camera:new T.PerspectiveCamera(45,16/9,.01,1000),setTime(t){for(const a of actors){a.root.position.set(a.number*1.5+(moving?t*a.number:0),0,moving?t*.4:0);a.root.updateMatrixWorld(true);}}};}
for(const ids of [[1],[1,2],[1,3],[1,2,3]]){
 const p={...presetDefaults(ids),horizontal:'custom',custom_position:[0,2,5],aim_source:'live',behavior:'move',movement:'orbit',orbit_degrees:70,path_anchor:'fixed',pacing:'constant',follow_response:'direct'};
 const moving=scene(true),still=scene(false),a=presetPlan(moving,{mode:'preset',preset:p},3),b=presetPlan(still,{mode:'preset',preset:p},3),speed=ids.reduce((sum,id)=>sum+id,0)/ids.length;
 assert.equal(subjectTravel(p),true);assert.equal(effectivePreset(p).path_anchor,'follow');
 for(let i=0;i<a.times.length;i++){const expected=new T.Vector3(a.times[i]*speed,0,a.times[i]*.4);assert.ok(a.positions[i].clone().sub(b.positions[i]).distanceTo(expected)<1e-7,'Orbit did not follow the average roots of only its selected actors');assert.equal(a.fovs[i],b.fovs[i]);}
 const marker={...p,target_mode:'marker',custom_target:[1,1,0]},m=presetPlan(moving,{mode:'preset',preset:marker},3),s=presetPlan(still,{mode:'preset',preset:marker},3);
 assert.equal(subjectTravel(marker),false);assert.equal(effectivePreset(marker).path_anchor,'fixed');
 for(let i=0;i<m.times.length;i++)assert.ok(m.positions[i].distanceTo(s.positions[i])<1e-8,'A fixed marker orbit followed the actors');
}
console.log('PASS: orbit always follows selected single/group/subset root averages; unselected actors do not contribute; custom-marker orbits stay fixed and lenses do not change.');

const {positionCoordinates,positionFromCoordinates}=await import('../web/camera_position.js');
for(const [point,angle] of [[[0,0,1],0],[[1,0,0],270],[[0,0,-1],180],[[-1,0,0],90]])assert.equal(positionCoordinates(point,[0,0,0]).orbit,angle);
for(let angle=-720;angle<=720;angle+=7){const point=positionFromCoordinates({distance:4,height:2,orbit:angle},[0,0,0]);const measured=positionCoordinates(point,[0,0,0]);assert.ok(measured.orbit>=0&&measured.orbit<360);assert.ok(new T.Vector3(...positionFromCoordinates(measured,[0,0,0])).distanceTo(new T.Vector3(...point))<1e-8);}
console.log('PASS: counterclockwise-positive orbit readouts stay within 0–360 degrees, including negative input, multiple turns, and angle wraparound.');
