// API History is retired. Existing graphs get an actionable local-file message.
import { app } from '../../scripts/app.js';
app.registerExtension({name:'Cartwheel.RetiredHistory',nodeCreated(node){
 if((node.comfyClass??node.type)!=='CartwheelLoadHistory')return;
 const message=document.createElement('div');message.textContent='Use Load Motion → Saved jobs to reopen saved local output. API History is no longer used.';message.style.padding='12px';
 node.addDOMWidget('retired_history','cartwheel_retired_history',message,{serialize:false,getMinHeight:()=>70,getHeight:()=>70});
}});
