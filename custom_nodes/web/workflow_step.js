import { app } from "../../scripts/app.js";

const style=document.createElement('link');style.rel='stylesheet';style.href=new URL('./workflow_step.css',import.meta.url).href;document.head.append(style);
const PREVIEW='Preview camera',GENERATE='Generate final video';
app.registerExtension({
  name: "Cartwheel.WorkflowStep",
  nodeCreated(node) {
    if ((node.comfyClass ?? node.type) !== "CartwheelWorkflowStep") return;
    const action = node.widgets.find(w => w.name === "action");
    action.hidden=true;action.type='hidden';action.computeSize=()=>[0,-4];
    const panel=document.createElement('div');panel.className='cw-workflow-step';
    const heading=document.createElement('strong');heading.textContent='Choose what Run does';
    const choices=document.createElement('div');choices.className='cw-step-choices';
    const status=document.createElement('p');status.setAttribute('role','status');
    const buttons=new Map();
    const update = () => {
      const generate=action.value===GENERATE;panel.dataset.mode=generate?'generate':'preview';
      for(const [value,button] of buttons)button.setAttribute('aria-pressed',String(action.value===value));
      status.textContent=generate?'Next Run generates with your selected AI model and can spend credits.':'Next Run previews your camera. Edit it below before generating.';
      node.setDirtyCanvas?.(true, true);
    };
    for(const [value,title,detail] of [[PREVIEW,'1 · Preview & edit camera','Start here'],[GENERATE,'2 · Generate final video','When the camera is ready']]){
      const button=document.createElement('button');button.type='button';button.setAttribute('aria-label',value);
      const label=document.createElement('strong');label.textContent=title;
      const hint=document.createElement('span');hint.textContent=detail;button.append(label,hint);
      button.onclick=()=>{action.value=value;action.callback?.(value);node.graph?.incrementVersion?.();node.graph?.afterChange?.(node);update();};
      choices.append(button);buttons.set(value,button);
    }
    panel.append(heading,choices,status);
    for(const event of ['pointerdown','pointermove','pointerup','wheel','dblclick','keydown'])panel.addEventListener(event,e=>e.stopPropagation());
    const widget=node.addDOMWidget('workflow_step_controls','cartwheel_workflow_step_controls',panel,{serialize:false,getMinHeight:()=>135,getHeight:()=>135});
    Object.defineProperty(widget,'width',{configurable:true,get:()=>node.width??node.size[0],set:()=>{}});
    const callback=action.callback;action.callback=function(){callback?.apply(this,arguments);update();};
    const resize=()=>node.setSize([Math.max(node.size[0],520),Math.max(node.size[1],240)]);
    const configured=node.onConfigure;node.onConfigure=function(){configured?.apply(this,arguments);resize();update();};
    node.color??='#24516e';node.bgcolor??='#163348';resize();update();
  },
});
