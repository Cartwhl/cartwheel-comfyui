import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const extensions=[];
globalThis.app={registerExtension:e=>extensions.push(e),graph:{_nodes:[],setDirtyCanvas(){}}};
for(const file of ['endpoint_images.js','reference_info.js']) {
  let code=await readFile(new URL('../web/'+file,import.meta.url),'utf8');
  code=code.replace(/^import .*;\n/gm,'');
  await import('data:text/javascript;base64,'+Buffer.from('const app=globalThis.app; const connectCameraPasses=()=>{}; const connectFrameImageControl=()=>{};\n'+code).toString('base64'));
}
const make=(type,inputs)=>({type,inputs:inputs.map(name=>({name,type:'IMAGE',link:42})),outputs:[],addInput(name,type){this.inputs.push({name,type,link:null});}});
const last=make('CartwheelEndpointImage',['image','style_reference']);
last.widgets=[{name:'prompt',value:'My original creative prompt'}];
const prepare=make('CartwheelPrepareVideoReferences',['control_video','reference_image','secondary_video','reference_audio']);
app.graph._nodes=[last,prepare];
for(const extension of extensions){extension.loadedGraphNode?.(last);extension.loadedGraphNode?.(prepare);}
for(const extension of extensions)extension.afterConfigureGraph?.();
assert.deepEqual(last.inputs.map(i=>i.name),['image','style_reference','reference_1','reference_2','reference_3','reference_4','reference_5','references']);
assert.equal(last.inputs[0].link,42);assert.equal(last.widgets[0].value,'My original creative prompt');
assert.deepEqual(prepare.inputs.map(i=>i.name),['control_video','reference_image','secondary_video','reference_audio','depth_video','normal_video','pose_video']);
// Also survive a configuration pass restoring the old saved input list.
last.inputs=last.inputs.slice(0,2);prepare.inputs=prepare.inputs.slice(0,4);
for(const extension of extensions)extension.afterConfigureGraph?.();
assert.equal(last.inputs.length,8);assert.equal(prepare.inputs.length,7);
console.log('PASS: existing-node socket migration is idempotent and preserves prompts and links.');
