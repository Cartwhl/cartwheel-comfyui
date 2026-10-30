import {app} from '../../scripts/app.js';
import {api} from '../../scripts/api.js';
import {cameraVideoReferences} from './reference_pass_controls.js';
import {REFERENCE_LIMITS_NOTICE} from './reference_limits_notice.js';
app.registerExtension({name:'Cartwheel.ReferenceLibrary',nodeCreated(node){
 if((node.comfyClass??node.type)!=='CartwheelReferenceLibrary')return;
 const widget=node.widgets.find(w=>w.name==='files');if(!widget)return;
 widget.type='hidden';widget.computeSize=()=>[0,-4];
 const root=document.createElement('div');root.className='cw-reference-library';
 const note=document.createElement('p');
 const limitsNote=document.createElement('p');limitsNote.className='cw-reference-limits';limitsNote.textContent=REFERENCE_LIMITS_NOTICE;Object.assign(limitsNote.style,{color:'#c5d8e9',font:'12px/1.4 system-ui',margin:'8px 0'});
 const status=document.createElement('div');status.setAttribute('role','status');const list=document.createElement('div');
 const input=document.createElement('input');input.type='file';input.multiple=true;input.accept='image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm,video/x-matroska,audio/*';input.setAttribute('aria-label','Add creative reference files');
 const read=()=>{try{return JSON.parse(widget.value||'[]');}catch{return [];}};
 const save=items=>{widget.value=JSON.stringify(items);node.graph?.incrementVersion?.();node.graph?.afterChange?.(node);draw();};
 function draw(){list.replaceChildren();
  const links=node.outputs?.find(o=>o.name==='references')?.links??[];
  const prepare=(node.graph?._nodes??[]).find(n=>(n.comfyClass??n.type)==='CartwheelPrepareVideoReferences'&&n.inputs?.some(i=>i.name==='reference_library'&&links.includes(i.link)));
  const value=name=>prepare?.widgets?.find(w=>w.name===name)?.value;
  const legacy=(name,toggle)=>value(toggle)!==false&&prepare?.inputs?.some(i=>i.name===name&&i.link!=null)?1:0;
  const cameras=cameraVideoReferences(prepare);
  note.textContent=(cameras.length?cameras.map((name,index)=>`Video ${index+1}: ${name}`).join(' · ')+'. Creative videos follow.':'Camera references are off; creative videos start at Video 1.')+' Describe enabled reference numbers in the prompt. Endpoint images, when enabled, follow creative images.';
  let count={image:legacy('reference_image','use_reference_image'),video:cameras.length,audio:legacy('reference_audio','use_reference_audio')};read().forEach((item,index)=>{
  const row=document.createElement('div');row.className='cw-reference-row';
  const enabled=document.createElement('input');enabled.type='checkbox';enabled.checked=item.enabled!==false;enabled.setAttribute('aria-label',`Use ${item.name}`);enabled.onchange=()=>{const items=read();items[index].enabled=enabled.checked;save(items);};
  const name=document.createElement('span');name.textContent=`${item.enabled!==false?`${item.kind} ${++count[item.kind]}`:'Off'} · ${item.name}`;
  const remove=document.createElement('button');remove.textContent='×';remove.setAttribute('aria-label',`Remove ${item.name}`);remove.onclick=()=>{const items=read();items.splice(index,1);save(items);};
  row.append(enabled,name,remove);
  if(item.kind!=='image')for(const [key,label]of[['start','Start · s'],['duration','Duration · 0 = auto']]){const field=document.createElement('label');field.textContent=label;const box=document.createElement('input');Object.assign(box,{type:'number',min:0,step:.1,value:item[key]??0});box.setAttribute('aria-label',`${item.name} ${label}`);box.onchange=()=>{if(!box.checkValidity())return;const items=read();items[index][key]=Number(box.value);save(items);};field.append(box);row.append(field);}
  list.append(row);
 });}
 input.onchange=async()=>{input.disabled=true;try{for(const file of input.files){status.textContent=`Loading ${file.name} locally…`;const body=new FormData();body.append('file',file);const response=await api.fetchApi('/cartwheel/references/upload',{method:'POST',body});const result=await response.json();if(!response.ok)throw new Error(result.error);save([...read(),{...result,enabled:true,start:0,duration:0}]);}status.textContent='Loaded locally. No generation job submitted.';}catch(error){status.textContent=error.message;}finally{input.value='';input.disabled=false;}};
 root.append(note,limitsNote,input,list,status);const dom=node.addDOMWidget('reference_library','cartwheel_references',root,{serialize:false,getMinHeight:()=>345,getHeight:()=>Math.min(765,Math.max(345,205+read().length*90))});Object.defineProperty(dom,'width',{configurable:true,get:()=>node.width??node.size[0],set:()=>{}});
 const layout=()=>draw();window.addEventListener('cartwheel-reference-layout',layout);const removed=node.onRemoved;node.onRemoved=function(){window.removeEventListener('cartwheel-reference-layout',layout);return removed?.apply(this,arguments);};
 const configure=node.onConfigure;node.onConfigure=function(){configure?.apply(this,arguments);draw();};draw();
}});
