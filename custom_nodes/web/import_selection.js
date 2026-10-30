import * as THREE from './vendor/build/three.module.js';

// Retain a character's mesh/rig plus its original parent transforms. Node IDs
// avoid treating duplicate bone names across characters as the same target.
export function selectImport(loaded, root, descriptor, sourceClip) {
  if (!descriptor.selection) return {clip:sourceClip, discarded:[]};
  const ids=new Set(descriptor.selection.nodes), keep=new Set(), objects=[];
  root.traverse(object=>objects.push(object));
  const sourceID=object=>descriptor.format==='glb'?loaded.parser.associations.get(object)?.nodes:object.ID;
  const byID=new Map();for(const object of objects){const id=sourceID(object);if(id!==undefined&&!byID.has(id))byID.set(id,object);}
  const include=object=>{keep.add(object);for(const child of object.children)if(sourceID(child)===undefined)include(child);};
  for(const object of objects)if(ids.has(sourceID(object)))include(object);
  if(!keep.size)throw new Error('The imported scene no longer contains the selected actor or camera. Upload the scene again.');
  for(const object of [...keep])for(let parent=object.parent;parent;parent=parent.parent)keep.add(parent);
  keep.add(root);
  const tracks=[];
  for(const original of sourceClip?.tracks??[]){
    let track=original;
    if(descriptor.format==='fbx' && original.cartwheelFBXModelID!==undefined){
      const object=byID.get(original.cartwheelFBXModelID);
      if(!object||!keep.has(object))continue;
      track=original.clone();track.name=object.uuid+original.name.slice(original.name.indexOf('.'));
    }else{
      const name=THREE.PropertyBinding.parseTrackName(original.name).nodeName;
      const object=THREE.PropertyBinding.findNode(root,name);
      if(!object||!keep.has(object))continue;
    }
    tracks.push(track);
  }
  const discarded=[];
  for(const object of objects)for(const child of [...object.children])if(keep.has(object)&&!keep.has(child)){object.remove(child);discarded.push(child);}
  const clip=tracks.length?new THREE.AnimationClip(sourceClip.name,sourceClip.duration,tracks,sourceClip.blendMode):null;
  return {clip,discarded};
}
