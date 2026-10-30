import assert from 'node:assert/strict';
import {syncMotionSources,SOURCE_INPUTS,cleanMotionSourceInputs} from '../web/source_selector_state.js';
import {syncReferenceToggles,referenceEnabled,REFERENCES} from '../web/reference_toggle_state.js';

assert.deepEqual(Object.keys(SOURCE_INPUTS),['Performance Capture','Swing Choreo','Load motion']);
const video={id:1,type:'LoadVideo',mode:2,inputs:[]};
const fresh={id:2,type:'CartwheelPerformanceCapture',mode:2,inputs:[{}],getInputNode:()=>video};
const history={id:3,type:'CartwheelLoadHistory',mode:0,inputs:[]};
const upload={id:4,type:'CartwheelLoadMotionAndCamera',mode:2,inputs:[]};
const swing={id:6,type:'CartwheelSwingChoreo',mode:2,inputs:[]};
const source={id:5,type:'CartwheelMotionSource',mode:0,inputs:['fresh_motion','history_motion','uploaded_motion','swing_motion'].map(name=>({name})),
  widgets:[{name:'source',value:'Cartwheel history'}],getInputNode:i=>[fresh,history,upload,swing][i]};
for(const [choice,selected] of [['Cartwheel history',upload],['Performance Capture',fresh],['Fresh Comic video',fresh],['Uploaded GLB motion',upload],['Swing Choreo',swing],['Swing Choreo (coming soon)',swing]]){
  source.widgets[0].value=choice;syncMotionSources([source]);
  for(const n of [fresh,history,upload,swing])assert.equal(n.mode,n===selected?0:2);
}
assert.equal(video.mode,0,'Choosing fresh video must also activate its file-loader chain.');
source.mode=2;syncMotionSources([source]);for(const n of [fresh,history,upload,swing])assert.equal(n.mode,2);
source.mode=0;source.widgets[0].value='Cartwheel history';
const other={...source,widgets:[{name:'source',value:'Fresh Comic video'}]};
syncMotionSources([source,other]);assert.equal(history.mode,2);assert.equal(upload.mode,0);assert.equal(fresh.mode,0);

const links=new Map(),nodes=[];
const prep={id:10,type:'CartwheelPrepareVideoReferences',inputs:REFERENCES.map(r=>({name:r.input})),
  widgets:REFERENCES.map(r=>({name:r.toggle,value:false})),getInputNode:i=>loaders[i]};
const loaders=REFERENCES.map((r,i)=>({id:20+i,type:['LoadImage','LoadVideo','LoadAudio'][i],mode:2,
  widgets:[{value:['saved-image.png','saved-reference.mp4','saved-audio.wav'][i]}],outputs:[{links:[i]}],graph:{links}}));
for(const [i,loader] of loaders.entries())links.set(i,{target_id:prep.id,target_slot:i});
const gates=REFERENCES.map((r,i)=>({id:30+i,mode:2,properties:{cartwheel_reference_gate:{prepare:10,input:r.input}}}));
nodes.push(prep,...loaders,...gates);
for(let mask=0;mask<8;mask++){
  for(const [i,w] of prep.widgets.entries())w.value=Boolean(mask&(1<<i));
  syncReferenceToggles([prep],nodes);
  for(let i=0;i<3;i++){
    assert.equal(loaders[i].mode,mask&(1<<i)?0:2);
    assert.equal(gates[i].mode,loaders[i].mode);
    assert.equal(loaders[i].widgets[0].value,['saved-image.png','saved-reference.mp4','saved-audio.wav'][i]);
  }
}
// An older saved DOM-widget placeholder can occupy the first toggle slot.
// Match the Boolean serializer, including when the user never clicks it.
for(const value of ['',false,0,null,undefined,'false']){
  prep.widgets[0].value=value;
  assert.equal(referenceEnabled(prep,'use_reference_image'),false);
  syncReferenceToggles([prep],nodes);
  assert.equal(loaders[0].mode,2);assert.equal(gates[0].mode,2);
  assert.equal(loaders[0].widgets[0].value,'saved-image.png');
}
for(const value of [true,1,'true']){
  prep.widgets[0].value=value;syncReferenceToggles([prep],nodes);
  assert.equal(loaders[0].mode,0);assert.equal(gates[0].mode,0);
}
loaders[0].mode=0;loaders[0].outputs[0].links.push(999);links.set(999,{target_id:999,target_slot:0});
prep.widgets[0].value=false;syncReferenceToggles([prep],nodes);
assert.equal(loaders[0].mode,0,'Do not mute a loader shared with another output.');assert.equal(gates[0].mode,2);
delete gates[0].properties.cartwheel_reference_gate;gates[0].mode=0;syncReferenceToggles([prep],nodes);
assert.equal(gates[0].mode,0,'Existing hand-wired gates must remain unchanged.');
console.log('Source selection, shared selectors, file-loader activation, eight reference combinations, retained filenames, shared references and legacy gates passed.');

// Loading an older workflow removes History while preserving other links.
const oldSlots=['fresh_motion','history_motion','uploaded_motion','swing_motion'];
const oldLinks=oldSlots.map((name,i)=>({id:i+1,target_slot:i}));
const legacy={inputs:oldSlots.map((name,i)=>({name,link:i+1})),widgets:[{name:'source',options:{values:['Cartwheel history']}}],
 removeInput(index){const [removed]=this.inputs.splice(index,1);oldLinks.splice(oldLinks.findIndex(l=>l.id===removed.link),1);for(const l of oldLinks)if(l.target_slot>index)l.target_slot--;}};
assert.equal(cleanMotionSourceInputs(legacy),true);
assert.deepEqual(legacy.inputs.map(i=>i.name),['fresh_motion','uploaded_motion','swing_motion']);
assert.deepEqual(oldLinks.map(l=>[l.id,l.target_slot]),[[1,0],[3,1],[4,2]]);
assert.deepEqual(legacy.widgets[0].options.values,Object.keys(SOURCE_INPUTS));
assert.equal(cleanMotionSourceInputs(legacy),false);
console.log('Legacy History socket removed; other links, labels and three choices preserved.');
