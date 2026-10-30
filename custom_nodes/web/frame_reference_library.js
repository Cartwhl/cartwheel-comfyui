import {app} from '../../scripts/app.js';
import {api} from '../../scripts/api.js';
app.registerExtension({name:'Cartwheel.FrameReferenceLibrary',nodeCreated(node){
 if((node.comfyClass??node.type)!=='CartwheelImageReferences')return;
 const files=node.widgets.find(w=>w.name==='files');files.type='hidden';files.computeSize=()=>[0,-4];
 const root=document.createElement('div');root.className='cw-frame-reference-library';Object.assign(root.style,{font:'12px/1.4 system-ui',color:'#d7e5ee',padding:'12px',boxSizing:'border-box',height:'100%',overflow:'auto'});
 const note=document.createElement('p');note.textContent='Optional character and environment images · up to 5. Camera reference is Image 1; these follow as Images 2–6. Both frame generators use the same order. First-frame matching is automatic.';
 const upload=document.createElement('input');upload.type='file';upload.multiple=true;upload.accept='image/png,image/jpeg,image/webp';upload.setAttribute('aria-label','Add frame image references');const list=document.createElement('div'),status=document.createElement('div');status.setAttribute('role','status');root.append(note,upload,list,status);
 const read=()=>{try{return JSON.parse(files.value||'[]');}catch{return [];}};
 const save=items=>{files.value=JSON.stringify(items);node.graph?.incrementVersion?.();node.graph?.afterChange?.(node);draw();};
 function draw(){list.replaceChildren();let count=1;for(const [index,item] of read().entries()){
  const row=document.createElement('div');Object.assign(row.style,{display:'flex',gap:'8px',alignItems:'center',marginTop:'8px'});
  const check=document.createElement('input');check.type='checkbox';check.checked=item.enabled!==false;check.setAttribute('aria-label',`Use ${item.name}`);check.onchange=()=>{const items=read();items[index].enabled=check.checked;save(items);};
  const label=document.createElement('span');label.style.flex='1';label.textContent=`${check.checked?'Image '+(++count):'Off'} · ${item.name}`;
  const remove=document.createElement('button');remove.textContent='×';remove.setAttribute('aria-label',`Remove ${item.name}`);remove.onclick=()=>save(read().filter((_,i)=>i!==index));row.append(check,label,remove);list.append(row);
 }}
 upload.onchange=async()=>{upload.disabled=true;try{
  if(read().length+upload.files.length>5)throw new Error('Choose up to five images. Remove an image before adding another.');
  for(const file of upload.files){const body=new FormData();body.append('file',file);const response=await api.fetchApi('/cartwheel/references/upload',{method:'POST',body}),result=await response.json();if(!response.ok)throw new Error(result.error||'Upload failed.');save([...read(),{...result,enabled:true}]);}
  status.textContent='Images loaded locally. Styling runs only when enabled.';
 }catch(error){status.textContent=error.message;}finally{upload.value='';upload.disabled=false;}};
 const widget=node.addDOMWidget('frame_references','cartwheel_frame_references',root,{serialize:false,getMinHeight:()=>210,getHeight:()=>280});Object.defineProperty(widget,'width',{configurable:true,get:()=>node.width??node.size[0],set:()=>{}});
 const configured=node.onConfigure;node.onConfigure=function(){configured?.apply(this,arguments);draw();};draw();
}});
