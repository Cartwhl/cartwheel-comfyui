// Layout-only repair for the supplied full workflow. Camera recipes and links
// are deliberately absent from this small geometry document.
const TITLE=32,GAP=72,GROUP_PAD=50,GROUP_HEADER=74;
const rect=n=>({left:n.pos[0],top:n.pos[1]-TITLE,right:n.pos[0]+n.size[0],bottom:n.pos[1]+n.size[1]});
const intersects=(a,b,gap=0)=>a.left<b.right+Math.min(gap,40)&&a.right+Math.min(gap,40)>b.left&&a.top<b.bottom+gap&&a.bottom+gap>b.top;
const groupRect=g=>({left:g.bounding[0],top:g.bounding[1],right:g.bounding[0]+g.bounding[2],bottom:g.bounding[1]+g.bounding[3]});
export function spaceCameraWorkflow(document){
 const next=structuredClone(document),nodes=next.nodes??[],groups=next.groups??[];
 const camera=nodes.find(n=>n.type==='CartwheelCameraPreview');
 if(!camera||!nodes.some(n=>n.type==='CartwheelWorkflowStep')||!nodes.some(n=>n.type==='CartwheelPrepareVideoReferences'))return {...next,changed:false};
 const original=JSON.stringify([nodes.map(n=>n.pos),groups.map(g=>g.bounding)]);
 const membership=new Map(groups.map(g=>[g,[]]));
 for(const node of nodes){const x=node.pos[0]+node.size[0]/2,y=node.pos[1]+node.size[1]/2;
  const owner=groups.filter(g=>{const r=groupRect(g);return x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom;}).sort((a,b)=>a.bounding[2]*a.bounding[3]-b.bounding[2]*b.bounding[3])[0];if(owner)membership.get(owner).push(node);
 }
 // Keep the preparation/generation columns beside the enlarged camera column.
 const right=nodes.filter(n=>n!==camera&&n.pos[0]>=camera.pos[0]+camera.size[0]/2);
 if(right.length){const delta=Math.max(0,camera.pos[0]+camera.size[0]+180-Math.min(...right.map(n=>n.pos[0])));for(const node of right)node.pos[0]+=delta;}
 // Keep each row in its column. Pushing a lower card down propagates through
 // previews below it, including dynamically enlarged Comfy video widgets.
 const placed=[];
 for(const node of [...nodes].sort((a,b)=>a.pos[1]-b.pos[1]||a.pos[0]-b.pos[0])){
  let blockers;
  while((blockers=placed.filter(n=>intersects(rect(node),rect(n),GAP))).length)node.pos[1]=Math.max(...blockers.map(n=>rect(n).bottom))+GAP+TITLE;
  placed.push(node);
 }
 const moved=JSON.stringify(nodes.map(n=>n.pos))!==JSON.stringify((document.nodes??[]).map(n=>n.pos));
 if(moved){
  for(const group of groups){const members=membership.get(group);if(!members.length)continue;const boxes=members.map(rect),left=Math.min(...boxes.map(r=>r.left))-GROUP_PAD,top=Math.min(...boxes.map(r=>r.top))-GROUP_HEADER;group.bounding=[left,top,Math.max(...boxes.map(r=>r.right))+GROUP_PAD-left,Math.max(...boxes.map(r=>r.bottom))+GROUP_PAD-top];}
  // Group headers need breathing room too. Move a whole lower group, rather
  // than letting its background or title cover the preceding section.
  const owned=new Set([...membership.values()].flat());
  const items=[...groups.map(group=>({group,getRect:()=>groupRect(group),move:delta=>{group.bounding[1]+=delta;for(const node of membership.get(group))node.pos[1]+=delta;}})),...nodes.filter(n=>!owned.has(n)).map(node=>({getRect:()=>rect(node),move:delta=>{node.pos[1]+=delta;}}))];
  const done=[];
  for(const item of items.sort((a,b)=>a.getRect().top-b.getRect().top||a.getRect().left-b.getRect().left)){
   let blockers;
   while((blockers=done.filter(other=>intersects(item.getRect(),other.getRect(),40))).length)item.move(Math.max(...blockers.map(other=>other.getRect().bottom))+60-item.getRect().top);
   done.push(item);
  }
 }
 return {...next,changed:original!==JSON.stringify([nodes.map(n=>n.pos),groups.map(g=>g.bounding)])};
}
