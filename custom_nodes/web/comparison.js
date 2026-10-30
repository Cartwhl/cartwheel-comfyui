import {app} from '../../scripts/app.js';
import {api} from '../../scripts/api.js';
app.registerExtension({name:'Cartwheel.Comparison',nodeCreated(node){
 if((node.comfyClass??node.type)!=='CartwheelCompareVideos')return;
 const root=document.createElement('div');Object.assign(root.style,{padding:'10px',color:'#dce9f0',font:'12px system-ui',height:'100%',boxSizing:'border-box',display:'flex',flexDirection:'column',gap:'8px'});root.textContent='Generate final video to save a synchronized side-by-side. The shorter side holds its final frame. Comparison is silent; individual videos retain their own audio.';
 const widget=node.addDOMWidget('comparison_preview','cartwheel_comparison',root,{serialize:false,getMinHeight:()=>240,getHeight:()=>300});Object.defineProperty(widget,'width',{configurable:true,get:()=>node.width??node.size[0],set:()=>{}});
 const executed=node.onExecuted;node.onExecuted=function(message){executed?.apply(this,arguments);const file=message.cartwheel_comparison?.[0];if(!file)return;const url=api.apiURL('/view?'+new URLSearchParams(file));const video=document.createElement('video');video.src=url;video.controls=true;video.style.width='100%';video.style.maxHeight='245px';video.style.objectFit='contain';root.replaceChildren(video);};
}});
