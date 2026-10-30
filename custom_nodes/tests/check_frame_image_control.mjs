import assert from 'node:assert/strict';
import {connectFrameImageControl} from '../web/frame_image_control.js';
function setup(old=false){
 const camera={type:'CartwheelCameraPreview',widgets:[{name:'auto_frame_images',value:old}]},first={},last={};
 const review={type:'CartwheelEndpointReview',properties:{},widgets:[{name:'use_frame_images',value:false}],inputs:[{name:'first'},{name:'last'}],outputs:[],getInputNode:i=>[first,last][i],addOutput(name,type){this.outputs.push({name,type});},connect(output,target,input){target.inputs[input].link=77;target.inputs[input].source=this;}};
 const prepare={type:'CartwheelPrepareVideoReferences',widgets:[{name:'use_endpoint_images',value:old}],inputs:[{name:'control_video'},{name:'first_frame_image'},{name:'last_frame_image'},{name:'use_endpoint_images',link:13,source:camera}],getInputNode(i){return i===0?camera:i===1?first:i===2?last:this.inputs[i].source;},addInput(name,type,opts){this.inputs.push({name,type,...opts});}};
 return {camera,review,prepare};
}
for(const old of [false,true]){
 const {camera,review,prepare}=setup(old);connectFrameImageControl([camera,review,prepare]);connectFrameImageControl([camera,review,prepare]);
 assert.equal(review.widgets[0].value,old);assert.equal(camera.widgets[0].type,'converted-widget');assert.equal(prepare.widgets[0].type,'converted-widget');assert.equal(review.outputs.length,1);assert.equal(prepare.inputs[3].source,review);
}
const external=setup();external.prepare.inputs[3].source={type:'ExternalBoolean'};connectFrameImageControl(Object.values(external));assert.equal(external.prepare.inputs[3].link,13);
const absent=setup();connectFrameImageControl([absent.camera,absent.prepare]);assert.notEqual(absent.prepare.widgets[0].type,'converted-widget','Hand-wired workflow lost its only visible switch.');
console.log('PASS: image-review Boolean wiring, migration of previous true/false choices, duplicate hiding, preserved external controls and hand-wired fallback.');
