import { app } from '../../scripts/app.js';
import { api } from '../../scripts/api.js';
const providers={CartwheelPerformanceCapture:9,CartwheelLoadHistory:6,CartwheelLoadCapture:6};
const kind=node=>node.comfyClass??node.type;
function outputs(node){
 const offset=providers[kind(node)];if(offset===undefined)return;
 for(const [i,[name,type]] of [['motion','CARTWHEEL_MOTION'],['camera','CARTWHEEL_CAMERA']].entries()){
  if(node.outputs?.some(output=>output.name===name))continue;
  if(node.outputs?.length===offset+i)node.addOutput(name,type);
 }
}
const assetURL=file=>api.apiURL(`/view?${new URLSearchParams({filename:file.filename,subfolder:file.subfolder,type:'output'})}`);
export const savedJobDownloadURL=id=>api.apiURL(`/cartwheel/local-jobs/download?${new URLSearchParams({job:id})}`);
app.registerExtension({
 name:'Cartwheel.MotionInputs',loadedGraphNode:outputs,
 afterConfigureGraph(){for(const node of app.graph?._nodes??[])outputs(node);},
 nodeCreated(node){
  if(kind(node)!=='CartwheelLoadMotionAndCamera')return;
  const find=name=>node.widgets.find(w=>w.name===name);
  const panel=document.createElement('div');panel.className='cw-motion-loader';
  Object.assign(panel.style,{padding:'12px',display:'flex',flexDirection:'column',gap:'10px',font:'12px/1.4 system-ui',color:'#d7e5ee',background:'#12212d',borderRadius:'6px',boxSizing:'border-box',height:'100%',minHeight:'0'});
  const tabs=document.createElement('div');tabs.style.display='flex';tabs.style.gap='8px';
  const uploads=document.createElement('div');uploads.style.display='flex';uploads.style.gap='8px';
  const library=document.createElement('div');Object.assign(library.style,{display:'flex',flexDirection:'column',gap:'8px',minHeight:'0',flex:'1'});
  const toolbar=document.createElement('div');toolbar.style.display='flex';toolbar.style.gap='8px';
  const filter=document.createElement('input');filter.type='search';filter.placeholder='Filter saved jobs';filter.setAttribute('aria-label','Filter saved jobs');filter.style.flex='1';filter.style.minWidth='0';
  const refresh=document.createElement('button');refresh.textContent='Refresh saved jobs';toolbar.append(filter,refresh);
  const list=document.createElement('select');list.size=5;list.setAttribute('aria-label','Saved local jobs');Object.assign(list.style,{width:'100%',minHeight:'110px',flex:'1',boxSizing:'border-box'});
  const video=document.createElement('video');video.controls=true;video.muted=true;video.preload='metadata';Object.assign(video.style,{width:'100%',height:'145px',objectFit:'contain',background:'#0a1720',flexShrink:'0'});video.hidden=true;
  library.append(toolbar,list,video);
  const status=document.createElement('div');status.setAttribute('role','status');panel.append(tabs,uploads,library,status);
  let items=[],controller=null,disposed=false;
  const dirty=()=>{node.graph?.incrementVersion?.();node.graph?.afterChange?.(node);node.setDirtyCanvas?.(true,true);};
  const native=new Map();
  for(const name of ['actor_1','actor_2','actor_3','actor_4','camera_file']){
   const w=find(name);native.set(w,{type:w.type,computeSize:w.computeSize});
  }
  for(const name of ['load_mode','saved_job']){const w=find(name);w.hidden=true;w.type='hidden';w.computeSize=()=>[0,-4];}
  const selected=()=>{
   const item=items.find(i=>i.id===find('saved_job').value);list.value=item?.id??'';
   video.hidden=!item?.preview;
   if(item?.preview){const src=assetURL(item.preview);if(video.getAttribute('src')!==src)video.src=src;}else{video.pause();video.removeAttribute('src');}
   if(item)status.textContent=`${item.actors} actor${item.actors===1?'':'s'}${item.duration?` · ${item.duration.toFixed(2)}s`:''} · ${item.has_edits?'Saved edited camera':item.has_camera?'Saved starting camera':'Default camera'}. Run to load. No API request.`;
  };
  const renderList=()=>{
   const query=filter.value.trim().toLowerCase();list.replaceChildren();
   for(const item of items.filter(i=>i.title.toLowerCase().includes(query))){const option=document.createElement('option');option.value=item.id;option.textContent=`${item.title} · ${new Date(item.created_at).toLocaleString()} · ${item.actors} actors${item.has_edits?' · edited camera':''}`;list.append(option);}
   selected();
  };
  const load=async()=>{
   controller?.abort();controller=new AbortController();refresh.disabled=true;status.textContent='Reading saved files from this ComfyUI output folder…';
   try{const response=await api.fetchApi('/cartwheel/local-jobs',{cache:'no-store',signal:controller.signal});const value=await response.json();if(!response.ok)throw new Error(value.error||'Saved jobs could not be read.');if(disposed)return;items=value.items;renderList();if(!items.length)status.textContent='No saved local jobs yet. Generate or upload motion, then run Camera Preview to save one.';else if(!find('saved_job').value)status.textContent='Choose a saved job, then Run. Files are loaded locally.';}
   catch(error){if(error.name!=='AbortError')status.textContent=error.message;}
   finally{if(!disposed)refresh.disabled=false;}
  };
  const sync=()=>{
   const mode=find('load_mode').value==='Saved jobs'?'Saved jobs':'Upload files';find('load_mode').value=mode;
   uploads.hidden=mode!=='Upload files';library.hidden=mode!=='Saved jobs';uploads.style.display=uploads.hidden?'none':'flex';library.style.display=library.hidden?'none':'flex';
   for(const [w,original] of native){w.hidden=mode==='Saved jobs';w.type=w.hidden?'hidden':original.type;w.computeSize=w.hidden?()=>[0,-4]:original.computeSize;}
   for(const button of tabs.children){const active=button.textContent===mode;button.setAttribute('aria-pressed',String(active));button.style.background=active?'#326b93':'#233448';}
   if(mode==='Upload files')status.textContent='Choose individual actor files (GLB preferred) and an optional camera file. Whole scenes also work, up to 4 actors. No API key required.';
   else selected();
   node.setSize([Math.max(640,node.size[0]),mode==='Saved jobs'?560:360]);
   node.setDirtyCanvas?.(true,true);
  };
  for(const mode of ['Upload files','Saved jobs']){const button=document.createElement('button');button.textContent=mode;button.onclick=()=>{find('load_mode').value=mode;sync();dirty();if(mode==='Saved jobs')load();};tabs.append(button);}
  refresh.onclick=load;filter.oninput=renderList;list.onchange=()=>{find('saved_job').value=list.value;selected();dirty();};
  const choose=camera=>{
   const input=document.createElement('input');input.type='file';input.accept=camera?'.json,.fbx':'.glb,.fbx';input.multiple=!camera;input.style.display='none';panel.append(input);
   input.onchange=async()=>{
    const files=[...input.files];if(!files.length){input.remove();return;}if(files.length>4){status.textContent='Choose at most four actor files.';input.remove();return;}
    for(const button of uploads.children)button.disabled=true;
    try{status.textContent='Uploading and checking local files…';const results=[];for(const file of files){
     const body=new FormData();body.append('file',file);const response=await api.fetchApi(`/cartwheel/scene/upload?kind=${camera?'camera':'motion'}`,{method:'POST',body});const result=await response.json();if(!response.ok)throw new Error(result.error||'Upload failed.');results.push(result);
    }
    const actors=results.reduce((count,result)=>count+(result.actors??1),0);
    if(!camera&&actors>4)throw new Error('Choose files containing at most four actors in total.');
    for(const [i,result] of results.entries()){
     const w=find(camera?'camera_file':`actor_${i+1}`);if(!w.options.values.includes(result.filename))w.options.values.push(result.filename);w.value=result.filename;w.callback?.(result.filename);
    }
    if(!camera)for(let i=files.length+1;i<=4;i++)find(`actor_${i}`).value='';
    status.textContent=camera?'Camera override selected. Run to load.':`${actors} actor(s) selected${results.some(r=>r.embedded_camera)?' · embedded camera available':''}. Run to load motion.`;dirty();}
    catch(error){status.textContent=error.message;}
    finally{for(const button of uploads.children)button.disabled=false;input.remove();}
   };input.click();
  };
  for(const [text,camera] of [['Upload actors',false],['Upload camera (optional)',true]]){const button=document.createElement('button');button.textContent=text;button.onclick=()=>choose(camera);uploads.append(button);}
  const widget=node.addDOMWidget('motion_uploads','cartwheel_motion_uploads',panel,{serialize:false,getMinHeight:()=>find('load_mode').value==='Saved jobs'?360:105,getHeight:()=>find('load_mode').value==='Saved jobs'?360:105});
  Object.defineProperty(widget,'width',{configurable:true,get:()=>node.width??node.size[0],set(){}});
  node.setSize([640,620]);sync();
  const configured=node.onConfigure;node.onConfigure=function(){configured?.apply(this,arguments);sync();if(find('load_mode').value==='Saved jobs')load();};
  const executed=node.onExecuted;node.onExecuted=function(message){executed?.apply(this,arguments);const info=message.cartwheel_motion_info?.[0];if(info)status.textContent=`Loaded ${info.title||'motion'} · ${info.actors} actor(s) · ${info.duration.toFixed(2)}s · ready for Camera Preview.`;};
  const saved=()=>{if(find('load_mode').value==='Saved jobs')load();};window.addEventListener('cartwheel-camera-saved',saved);
  const removed=node.onRemoved;node.onRemoved=function(){disposed=true;window.removeEventListener('cartwheel-camera-saved',saved);controller?.abort();video.pause();video.removeAttribute('src');removed?.apply(this,arguments);};
 }
});
