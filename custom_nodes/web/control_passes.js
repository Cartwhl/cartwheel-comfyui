import * as THREE from './vendor/build/three.module.js';
import {renderCamera} from './lens_renderer.js';

// Data passes share the evaluated animated meshes and exact output projection.
// Depth is radial distance in metres; one fixed range is used for the whole clip.
export function depthValue(distance,near=.1,far=50){return .12+.86*Math.max(0,Math.min(1,(far-distance)/(far-near)));}
const JOINTS={hips:['cspine0','hips','pelvis'],chest:['cspine2','spine2','chest','upperchest'],neck:['cneck','neck'],head:['chead','head'],ls:['lclavicle','leftshoulder'],rs:['rclavicle','rightshoulder'],la:['luparm','leftarm','leftupperarm'],ra:['ruparm','rightarm','rightupperarm'],le:['llowarm','leftforearm','leftlowerarm'],re:['rlowarm','rightforearm','rightlowerarm'],lh:['lhand','lefthand','leftwrist'],rh:['rhand','righthand','rightwrist'],ll:['lupleg','leftupleg','leftupperleg'],rl:['rupleg','rightupleg','rightupperleg'],lk:['llowleg','leftleg','leftlowerleg'],rk:['rlowleg','rightleg','rightlowerleg'],lf:['lfoot','leftfoot','leftankle'],rf:['rfoot','rightfoot','rightankle']};
const EDGES=[['hips','chest'],['chest','neck'],['neck','head'],['neck','la'],['neck','ra'],['la','le'],['le','lh'],['ra','re'],['re','rh'],['hips','ll'],['ll','lk'],['lk','lf'],['hips','rl'],['rl','rk'],['rk','rf']];
export function poseJoints(actor){const bones=[];actor.root.traverse(n=>{if(n.isBone)bones.push(n);});return Object.fromEntries(Object.entries(JOINTS).map(([key,names])=>[key,bones.find(b=>names.some(n=>b.name.toLowerCase().replace(/[^a-z0-9]/g,'').replace(/^mixamorig/,'')===n))]));}
export class ControlPasses{
 constructor(capture){
  this.capture=capture;this.depth=new THREE.MeshBasicMaterial({color:0xffffff});
  this.uniforms={origin:{value:new THREE.Vector3()},near:{value:.1},far:{value:50}};
  this.depth.onBeforeCompile=shader=>{Object.assign(shader.uniforms,this.uniforms);shader.vertexShader='varying vec3 cwWorld;\n'+shader.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\ncwWorld=(modelMatrix*vec4(transformed,1.0)).xyz;');shader.fragmentShader='varying vec3 cwWorld; uniform vec3 origin; uniform float near; uniform float far;\n'+shader.fragmentShader.replace('#include <opaque_fragment>','float d=clamp((far-length(cwWorld-origin))/(far-near),0.0,1.0);gl_FragColor=vec4(vec3(0.12+0.86*d),1.0);');};
  this.normals=new THREE.MeshNormalMaterial();this.normals.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('packNormalToRGB( normal )','packNormalToRGB( vec3(dot(viewMatrix[0].xyz,normal),dot(viewMatrix[1].xyz,normal),dot(viewMatrix[2].xyz,normal)) )');};
  this.pose=new THREE.Scene();this.pose.background=new THREE.Color(0);this.rigs=[];
  for(const actor of capture.actors){const joints=poseJoints(actor),edges=EDGES.filter(([a,b])=>joints[a]&&joints[b]);if(edges.length<4)continue;
   const position=new THREE.Float32BufferAttribute(new Float32Array(edges.length*6),3),colors=new Float32Array(edges.length*6);
   edges.forEach((edge,i)=>{const color=new THREE.Color().setHSL(i/EDGES.length,.9,.55);for(let k=0;k<2;k++)color.toArray(colors,i*6+k*3);});
   const lines=new THREE.Group(),segments=[];
   for(let i=0;i<edges.length;i++){const mesh=new THREE.Mesh(new THREE.CylinderGeometry(1,1,1,6),new THREE.MeshBasicMaterial({color:new THREE.Color().setHSL(i/EDGES.length,.9,.55),toneMapped:false}));lines.add(mesh);segments.push(mesh);}
   this.pose.add(lines);this.rigs.push({actor:actor.number,joints,edges,position,lines,segments});
  }
 }
 configureDepth(sample,duration,extraTimes=[]){
  let near=Infinity,far=0;const steps=Math.min(120,Math.max(12,Math.ceil(duration*2)));
  const times=new Set(extraTimes.filter(t=>Number.isFinite(t)&&t>=0&&t<=duration));for(let i=0;i<=steps;i++)times.add(duration*i/steps);
  for(const time of times){
   const camera=sample(time),origin=camera.getWorldPosition(new THREE.Vector3());
   for(const actor of this.capture.actors){
    const box=new THREE.Box3().setFromObject(actor.root,true);if(box.isEmpty())continue;
    near=Math.min(near,box.distanceToPoint(origin));
    for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){const distance=origin.distanceTo(new THREE.Vector3(x,y,z));far=Math.max(far,distance);}
   }
  }
  if(Number.isFinite(near)&&far>0){this.uniforms.near.value=Math.max(.01,near-2);this.uniforms.far.value=Math.max(this.uniforms.near.value+9.144,far+3);}
 }
 render(renderer,scene,camera,kind){
  const background=scene.background,override=scene.overrideMaterial,tone=renderer.toneMapping,space=renderer.outputColorSpace;
  try{renderer.toneMapping=THREE.NoToneMapping;renderer.outputColorSpace=THREE.LinearSRGBColorSpace;
   if(kind==='pose'){const origin=camera.getWorldPosition(new THREE.Vector3()),height=renderer.getDrawingBufferSize(new THREE.Vector2()).y;
    for(const rig of this.rigs)rig.edges.forEach(([a,b],i)=>{const start=rig.joints[a].getWorldPosition(new THREE.Vector3()),end=rig.joints[b].getWorldPosition(new THREE.Vector3()),mid=start.clone().add(end).multiplyScalar(.5),delta=end.clone().sub(start),mesh=rig.segments[i];const radius=Math.max(.002,origin.distanceTo(mid)*Math.tan(THREE.MathUtils.degToRad(camera.fov)/2)*2.5/height);mesh.position.copy(mid);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.clone().normalize());mesh.scale.set(radius,delta.length(),radius);});
    renderCamera(renderer,this.pose,camera);}
   else{scene.background=new THREE.Color(0);scene.overrideMaterial=kind==='depth'?this.depth:this.normals;this.uniforms.origin.value.copy(camera.getWorldPosition(new THREE.Vector3()));renderCamera(renderer,scene,camera);}
  }finally{scene.background=background;scene.overrideMaterial=override;renderer.toneMapping=tone;renderer.outputColorSpace=space;}
 }
 dispose(){this.depth.dispose();this.normals.dispose();for(const r of this.rigs){for(const mesh of r.segments){mesh.geometry.dispose();mesh.material.dispose();}}}
}
