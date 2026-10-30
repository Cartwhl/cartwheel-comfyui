import {app} from '../../scripts/app.js';
import {spaceCameraWorkflow} from './workflow_spacing.js?v=20261029-workflow-spacing';
app.registerExtension({
 name:'Cartwheel.CameraWorkflowSpacing',
 afterConfigureGraph(){
  const graph=app.graph;
  // Allow DOM widgets to establish their minimum sizes before measuring them.
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
   if(graph!==app.graph)return;
   const nodes=graph?._nodes??[],groups=graph?._groups??[];
   const document={nodes:nodes.map(n=>({id:n.id,type:n.comfyClass??n.type,pos:Array.from(n.pos),size:Array.from(n.size)})),groups:groups.map(g=>({title:g.title,bounding:[...g.pos,...g.size]}))};
   const result=spaceCameraWorkflow(document);if(!result.changed)return;
   graph.beforeChange?.();
   for(const node of nodes){const adjusted=result.nodes.find(n=>n.id===node.id);if(adjusted){node.pos[0]=adjusted.pos[0];node.pos[1]=adjusted.pos[1];}}
   groups.forEach((g,i)=>{const b=result.groups[i].bounding;g.pos[0]=b[0];g.pos[1]=b[1];g.size[0]=b[2];g.size[1]=b[3];});
   graph.incrementVersion?.();graph.afterChange?.();graph.setDirtyCanvas?.(true,true);
  }));
 }
});
