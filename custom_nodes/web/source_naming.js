// Remove the retired first widget before LiteGraph restores widgets by index.
// Old names must never replace the actor count or the Swing motion prompt.
export function migrateSourceNames(graph){
 if(!graph||typeof graph!=='object')return 0;
 let changed=0;
 for(const node of graph.nodes??[]){
  if(!['CartwheelPerformanceCapture','CartwheelSwingChoreo'].includes(node.type))continue;
  const values=node.widgets_values;
  if(Array.isArray(values)){
   const legacy=node.type==='CartwheelPerformanceCapture'
    ?typeof values[0]==='string'&&typeof values[1]==='number'
    :typeof values[0]==='string'&&typeof values[1]==='string'&&typeof values[2]==='number';
   if(legacy){values.shift();changed++;}
  }else if(values&&Object.hasOwn(values,'batchName')){delete values.batchName;changed++;}
  // Also cover workflows where the old widget was converted to an input.
  const slot=node.inputs?.findIndex(input=>input.name==='batchName')??-1;
  if(slot>=0){
   node.inputs.splice(slot,1);changed++;
   graph.links=(graph.links??[]).filter(link=>{
    const target=Array.isArray(link)?link[3]:link.target_id,index=Array.isArray(link)?link[4]:link.target_slot;
    if(target!==node.id)return true;
    if(index===slot){const origin=graph.nodes.find(n=>n.id===(Array.isArray(link)?link[1]:link.origin_id));const output=origin?.outputs?.[Array.isArray(link)?link[2]:link.origin_slot];if(output?.links)output.links=output.links.filter(id=>id!==(Array.isArray(link)?link[0]:link.id));return false;}
    if(index>slot){if(Array.isArray(link))link[4]--;else link.target_slot--;}
    return true;
   });
  }
 }
 for(const subgraph of graph.definitions?.subgraphs??[])changed+=migrateSourceNames(subgraph);
 return changed;
}
