const kind=node=>node?.comfyClass??node?.type;
const widget=(node,name)=>node.widgets?.find(w=>w.name===name);
const enabled=value=>value===true||value===1||value==='true';
const hide=w=>{if(w){w.type='converted-widget';w.computeSize=()=>[0,-4];}};
export function connectFrameImageControl(nodes){
 for(const camera of nodes.filter(n=>kind(n)==='CartwheelCameraPreview'))hide(widget(camera,'auto_frame_images'));
 for(const target of nodes.filter(n=>kind(n)==='CartwheelPrepareVideoReferences')){
  const endpoints=['first_frame_image','last_frame_image'].map(name=>{const i=target.inputs?.findIndex(s=>s.name===name);return i>=0?target.getInputNode?.(i):null;});
  const reviews=nodes.filter(n=>kind(n)==='CartwheelEndpointReview'&&['first','last'].every((name,i)=>{const slot=n.inputs?.findIndex(s=>s.name===name);return slot>=0&&endpoints[i]&&n.getInputNode?.(slot)===endpoints[i];}));
  if(reviews.length!==1)continue;
  const review=reviews[0],value=widget(review,'use_frame_images'),old=widget(target,'use_endpoint_images');if(!value||!old)continue;
  let input=target.inputs.findIndex(s=>s.name==='use_endpoint_images');const source=input>=0?target.getInputNode?.(input):null;
  // Preserve externally supplied Boolean controls. Migrate only the retired camera flag.
  if(input>=0&&target.inputs[input].link!=null&&source!==review&&kind(source)!=='CartwheelCameraPreview'){hide(old);continue;}
  review.properties??={};
  if(!review.properties.cartwheel_endpoint_frame_control){value.value=enabled(value.value)||enabled(old.value)||enabled(widget(source,'auto_frame_images')?.value);review.properties.cartwheel_endpoint_frame_control=1;}
  if(!review.outputs?.some(s=>s.name==='use_frame_images'))review.addOutput('use_frame_images','BOOLEAN');
  if(input<0){target.addInput('use_endpoint_images','BOOLEAN',{label:'First/last frame images'});input=target.inputs.length-1;}
  if(source!==review)review.connect(review.outputs.findIndex(s=>s.name==='use_frame_images'),target,input);
  hide(old);
 }
}
