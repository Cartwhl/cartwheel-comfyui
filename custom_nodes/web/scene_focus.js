import * as THREE from './vendor/build/three.module.js';
export function focusInspection(editor,point,distance=2){
 if(!editor.capture||!point)return;
 const center=new THREE.Vector3().fromArray(point),direction=editor.overviewCamera.getWorldDirection(new THREE.Vector3()).normalize();
 editor.controls.target.copy(center);editor.overviewCamera.position.copy(center).addScaledVector(direction,-distance);
 editor.overviewCamera.near=Math.min(editor.overviewCamera.near,.01);editor.overviewCamera.far=Math.max(1000,center.length()+distance+100);
 editor.overviewCamera.updateProjectionMatrix();editor.controls.update();editor.render();
}
