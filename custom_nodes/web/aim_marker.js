import * as THREE from './vendor/build/three.module.js';
export const isAimMarker=p=>p?.target_mode==='marker';
export function markerPoint(p) {
 const point=p.custom_target;
 if(!Array.isArray(point)||point.length!==3||point.some(v=>typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>100000))throw new Error('Place a valid aim marker in Scene.');
 return new THREE.Vector3().fromArray(point);
}
export function markerState(p) {
 const point=markerPoint(p),radius=.01;
 return {bounds:new THREE.Box3().setFromCenterAndSize(point,new THREE.Vector3(radius*2,radius*2,radius*2)),target:point.clone(),focus:point.clone(),focusPoints:[point.clone()],focusTargets:[{point:point.clone(),radius,halfSize:new THREE.Vector3(radius,radius,radius)}],body:point.clone(),head:point.clone(),eyes:point.clone(),height:1.7,forward:new THREE.Vector3(0,0,1)};
}
