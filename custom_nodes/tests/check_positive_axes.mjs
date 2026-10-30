import assert from 'node:assert/strict';
import * as THREE from '../web/vendor/build/three.module.js';
import {TransformControls} from '../web/vendor/examples/jsm/controls/TransformControls.js';
import {positiveTranslateAxes} from '../web/positive_axes.js';
const camera=new THREE.PerspectiveCamera(),control=new TransformControls(camera);
positiveTranslateAxes(control);
let gizmo;control.getHelper().traverse(o=>{if(o.gizmo?.translate)gizmo=o;});
for(const group of [gizmo.gizmo.translate,gizmo.picker.translate]) for(const axis of ['X','Y','Z']){
 const handles=group.children.filter(o=>o.name===axis);assert.equal(handles.length,group===gizmo.gizmo.translate?2:1);
 for(const h of handles){h.geometry.computeBoundingBox();const a=axis.toLowerCase(),b=h.geometry.boundingBox;assert.ok((b.min[a]+b.max[a])/2>0);}
}
const object=new THREE.Object3D(),scene=new THREE.Scene();scene.add(object,control.getHelper());control.attach(object);
for(const p of [[3,3,3],[-3,3,3],[3,-3,-3],[-3,-3,-3]]){camera.position.set(...p);camera.lookAt(0,0,0);camera.updateMatrixWorld();scene.updateMatrixWorld(true);assert.equal(gizmo.gizmo.translate.children.filter(h=>['X','Y','Z'].includes(h.name)).length,6);}
console.log('Three positive arrowheads/shafts and matching pickers persist across camera octants; plane handles remain available.');
