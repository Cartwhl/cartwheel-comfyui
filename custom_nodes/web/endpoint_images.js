import {app} from '../../scripts/app.js';
export function ensureContinuityInputs(node){
 if((node.comfyClass??node.type)!=='CartwheelEndpointImage')return;
 // Keep connected legacy recipes working; new nodes expose only generic images.
 for(let i=(node.inputs?.length??0)-1;i>=0;i--){const input=node.inputs[i];
  if(!['style_reference','first_frame','styled_first_frame'].includes(input.name))continue;
  if(input.link==null)node.removeInput(i);else input.label=input.name==='style_reference'?'Appearance image · saved connection':`Match first frame · ${input.name==='first_frame'?'original':'styled'}`;
 }
 const image=node.inputs?.find(i=>i.name==='image');if(image)image.label='Camera reference';
 for(let i=1;i<=5;i++)if(!node.inputs?.some(s=>s.name===`reference_${i}`))node.addInput(`reference_${i}`,'IMAGE',{label:`Image reference ${i}`});
 if(!node.inputs?.some(s=>s.name==='references'))node.addInput('references','CARTWHEEL_FRAME_REFERENCES',{label:'Image references'});
}
app.registerExtension({name:'Cartwheel.EndpointContinuity',nodeCreated:ensureContinuityInputs,
 loadedGraphNode(node){ensureContinuityInputs(node);if((node.comfyClass??node.type)==='CartwheelEndpointReview'){
  const value=node.widgets?.find(w=>w.name==='use_frame_images');if(value&&typeof value.value!=='boolean')value.value=value.value===1||value.value==='true';
  if(!node.outputs?.some(o=>o.name==='use_frame_images'))node.addOutput('use_frame_images','BOOLEAN');
 }},
 afterConfigureGraph(){for(const node of app.graph?._nodes??[])ensureContinuityInputs(node);}
});
