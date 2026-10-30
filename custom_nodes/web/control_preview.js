import {app} from '../../scripts/app.js';
import {api} from '../../scripts/api.js';
app.registerExtension({name:'Cartwheel.ControlPreview',nodeCreated(node){
 if((node.comfyClass??node.type)!=='CartwheelControlPreview')return;
 const root=document.createElement('div');Object.assign(root.style,{padding:'12px',color:'#dce9f0',font:'12px system-ui',height:'100%',boxSizing:'border-box',display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:'12px',alignContent:'start'});
 for(const name of ['Depth','Normal','Pose']){const cell=document.createElement('div');cell.textContent=name+' · Run Camera Preview to load';root.append(cell);}
 const widget=node.addDOMWidget('control_previews','cartwheel_control_previews',root,{serialize:false,getMinHeight:()=>230,getHeight:()=>260});Object.defineProperty(widget,'width',{configurable:true,get:()=>node.width??node.size[0],set:()=>{}});
 const saved=event=>{const slot=node.inputs?.findIndex(i=>i.name==='depth'),camera=slot>=0?node.getInputNode?.(slot):null;if(camera&&String(camera.id)===String(event.detail.nodeId))node.onExecuted?.({cartwheel_control_previews:[event.detail.artifacts?.passes??{}]});};window.addEventListener('cartwheel-camera-saved',saved);
 const removed=node.onRemoved;node.onRemoved=function(){window.removeEventListener('cartwheel-camera-saved',saved);return removed?.apply(this,arguments);};
 const executed=node.onExecuted;node.onExecuted=function(message){executed?.apply(this,arguments);const passes=message.cartwheel_control_previews?.[0];if(!passes)return;root.replaceChildren();for(const name of ['depth','normal','pose']){
  const cell=document.createElement('div'),title=document.createElement('strong');cell.style.minWidth='0';title.textContent=name[0].toUpperCase()+name.slice(1);cell.append(title);root.append(cell);const asset=passes[name];if(!asset)continue;
  const video=document.createElement('video');video.controls=true;video.preload='auto';video.muted=true;video.src=api.apiURL('/view?'+new URLSearchParams(asset));Object.assign(video.style,{width:'100%',height:'175px',objectFit:'contain',display:'block',background:'#08121a',margin:'8px 0'});
  cell.append(video);
 }};
}});
