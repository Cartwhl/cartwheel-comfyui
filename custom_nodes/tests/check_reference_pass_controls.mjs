import assert from 'node:assert/strict';
import {cameraVideoReferences,installCameraPassToggles,restoreCameraPassToggles,connectCameraPasses,CAMERA_VIDEO_TOGGLES} from '../web/reference_pass_controls.js';
function fixture(legacy='Color') {
 const saved=[{name:'prompt',value:'Keep my prompt'},{name:'camera_reference',value:legacy}];
 return {widgets:[...saved],properties:{},addWidget(type,name,value,callback,options){const widget={type,name,value,callback,options};this.widgets.push(widget);return widget;}};
}
let node=fixture();const originals=[...node.widgets];installCameraPassToggles(node);installCameraPassToggles(node);
assert.equal(node.widgets.length,6);assert.equal(node.widgets[0],originals[0]);assert.equal(node.widgets[1],originals[1]);
assert.equal(node.widgets[1].type,'converted-widget');assert.deepEqual(cameraVideoReferences(node),['Edited camera video']);
node.widgets.find(w=>w.name==='use_depth').value=true;
assert.deepEqual(cameraVideoReferences(node),['Edited camera video','Depth pass']);
for(const legacy of ['Color','Depth','Normal','Pose','None']) {
 node=fixture(legacy);const saved=Array(17).fill(null);saved[13]=legacy;
 restoreCameraPassToggles(node,{widgets_values:saved});
 assert.deepEqual(cameraVideoReferences(node),legacy==='None'?[]:[legacy==='Color'?'Edited camera video':legacy+' pass']);
 assert.equal(node.widgets[0].value,'Keep my prompt');
}
// A modern save keeps any independent combination, regardless of old selector value.
node=fixture('Pose');installCameraPassToggles(node);node.widgets.find(w=>w.name==='use_depth').value=true;
restoreCameraPassToggles(node,{properties:{cartwheel_camera_video_toggles:1}});
assert.deepEqual(cameraVideoReferences(node),['Edited camera video','Depth pass']);
for(let mask=0;mask<16;mask++) {
 for(const [i,[name]] of CAMERA_VIDEO_TOGGLES.entries())node.widgets.find(w=>w.name===name).value=Boolean(mask&(1<<i));
 assert.equal(cameraVideoReferences(node).length,[0,1,2,3].filter(i=>mask&(1<<i)).length);
}
const inputs=['control_video','depth_video','normal_video','pose_video'].map((name,i)=>({name,link:i===0?8:null}));
const connected=[];const source={type:'CartwheelCameraPreview',outputs:['video','depth','normal','pose'].map(name=>({name})),
 connect(output,target,input){connected.push([output,input]);target.inputs[input].link=output+100;}};
const prepare={inputs,getInputNode:()=>source};connectCameraPasses(prepare);connectCameraPasses(prepare);
assert.deepEqual(connected,[[1,1],[2,2],[3,3]]);inputs[2].link=999;connectCameraPasses(prepare);assert.equal(inputs[2].link,999);
prepare.getInputNode=()=>({type:'LoadVideo'});inputs[1].link=null;connectCameraPasses(prepare);assert.equal(inputs[1].link,null);
console.log('PASS: 16 independent toggle combinations, RGB/pass numbering, legacy migration, saved values and safe connections.');
