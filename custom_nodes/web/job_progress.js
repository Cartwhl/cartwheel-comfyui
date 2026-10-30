import {app} from '../../scripts/app.js';
import {api} from '../../scripts/api.js';
const views=new Set();
const minutes=s=>s<60?`${Math.round(s)}s`:`${Math.floor(s/60)}m ${Math.floor(s%60)}s`;
api.addEventListener('cartwheel_job_status',event=>{
 const view=[...views].find(v=>String(v.node.id)===String(event.detail.node_id));if(!view)return;
 view.state={...event.detail,received:Date.now()};view.update();
});
app.registerExtension({name:'Cartwheel.JobStatus',nodeCreated(node){
 if(!['CartwheelPerformanceCapture','CartwheelSwingChoreo'].includes(node.comfyClass??node.type))return;
 const element=document.createElement('div');Object.assign(element.style,{padding:'10px',font:'12px/1.6 system-ui',color:'#dce9f0',boxSizing:'border-box',whiteSpace:'pre-wrap'});
 const view={node,state:null,update(){
  const s=view.state;
  if(!s){element.textContent='Cartwheel processing can take several minutes. An approximate wait and elapsed time appear when this job starts.';return;}
  const elapsed=s.elapsed+(s.done?0:(Date.now()-s.received)/1000),remaining=Math.max(0,s.estimate-elapsed);
  element.textContent=`${s.stage} · ${minutes(elapsed)} elapsed\n${s.failed?'Check the node error before trying again.':s.done?'Results downloaded.':remaining>0?`Approximately ${minutes(remaining)} remaining. Queue time and workload can vary.`:'Taking longer than the initial estimate; still waiting on the same job. Do not resubmit to check progress.'}`;
 }};
 const widget=node.addDOMWidget('job_status','cartwheel_job_status',element,{serialize:false,getMinHeight:()=>76,getHeight:()=>76});
 Object.defineProperty(widget,'width',{configurable:true,get:()=>node.width??node.size[0],set:()=>{}});
 views.add(view);const timer=setInterval(()=>{if(view.state&&!view.state.done)view.update();},1000);
 const removed=node.onRemoved;node.onRemoved=function(){clearInterval(timer);views.delete(view);return removed?.apply(this,arguments);};view.update();
}});
for(const eventName of ['execution_error','execution_interrupted'])api.addEventListener(eventName,event=>{
 const view=[...views].find(v=>String(v.node.id)===String(event.detail.node_id));if(!view?.state)return;
 const elapsed=view.state.elapsed+(Date.now()-view.state.received)/1000;
 view.state={...view.state,elapsed,received:Date.now(),done:true,failed:true,stage:eventName==='execution_error'?'Job stopped with an error':'Job interrupted'};view.update();
});
