import assert from 'node:assert/strict';
import * as THREE from '../web/vendor/build/three.module.js';
import {presetDefaults as basePresetDefaults} from '../web/camera_presets.js';
const presetDefaults=(...args)=>({...basePresetDefaults(...args),lens_calibration:'legacy'});
import {applyCamera} from '../web/camera_motion.js';
import {manualReferenceLens,lockManualLens,manualLensKey} from '../web/manual_framing.js';
import {manualPosition,pathProgress,resetCurve,addPathPoint} from '../web/manual_path.js';
function scene({
  moving = true,
  bounce = true,
  aspect = 16 / 9,
  spacing = 1.5,
  turning = false,
  shoulderTwist = false,
} = {}) {
  const actors = [2, 4, 7].map((number, i) => {
    const root = new THREE.Group(),
      mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.8, 0.3));
    mesh.position.y = 0.9;
    root.add(mesh);
    const bone = (name, x, y, z = 0) => {
      const b = new THREE.Bone();
      b.name = name;
      b.position.set(x, y, z);
      root.add(b);
      return b;
    };
    const head = bone("c_head", 0, 1.65),
      hips = bone("c_spine0", 0, 0.9);
    const left = bone("l_uparm", -0.22, 1.4),
      right = bone("r_uparm", 0.22, 1.4);
    bone("l_upleg", 0.12, 0.85);
    bone("r_upleg", -0.12, 0.85);
    bone("l_foot", -0.12, 0.05);
    bone("r_foot", 0.12, 0.05);
    bone("l_wrist", -0.4, 0.85);
    bone("r_wrist", 0.4, 0.85);
    return { number, root, head, hips, left, right, origin: i * spacing };
  });
  const camera = new THREE.PerspectiveCamera(45, aspect, 0.01, 100);
  return {
    actors,
    camera,
    duration: 3,
    setTime(t) {
      for (const a of actors) {
        a.root.position.x = a.origin + (moving ? t : 0);
        a.root.rotation.y = turning ? (t * Math.PI) / 2 + (a.number === 4 ? Math.PI : 0) : 0;
        if (shoulderTwist) {
          a.left.position.set(0, 1.4, -0.22);
          a.right.position.set(0, 1.4, 0.22);
        }
        a.root.position.y = bounce ? 0.12 * Math.sin(t * 18) : 0;
        a.head.position.y = 1.65 + (bounce ? 0.04 * Math.sin(t * 31) : 0);
        a.root.updateMatrixWorld(true);
      }
      camera.position.set(0, 2, 5);
      camera.quaternion.identity();
      camera.fov = 45;
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
    },
  };
}

const duration=3;
for(const aspect of [16/9,9/16])for(const lens of ['natural','fisheye']){
 const capture=scene({aspect}), settings={mode:'bookends',camera_index:0,target_actor:null,
   preset:{...presetDefaults([2,4],1),composition:'group',selection:'selected',shot:'cowboy',lens},
   manual_path:{kind:'curve',pacing:'smooth',aim:'shot',framing_priority:'shot'},
   start:{position:[-3,2,6],target:[0,1,0],fov:45},end:{position:[5,3,2],target:[0,1,0],fov:60}};
 resetCurve(settings);addPathPoint(settings);settings.manual_path.points[0][1]=5;
 // Begin with an arbitrary seek; the fit must still use the authored reference.
 capture.setTime(2.75);applyCamera(capture,settings,2.75,duration);
 const expected=capture.camera.fov;assert.equal(capture.camera.userData.cartwheelManualFraming.reference_time,1);
 for(const t of [0,1,2.9,.1,2,1.5,3]){
   capture.setTime(t);applyCamera(capture,settings,t,duration);
   assert.equal(capture.camera.fov,expected);
   assert.ok(capture.camera.position.distanceTo(manualPosition(settings,pathProgress(settings,t,duration)))<1e-9);
   assert.ok(Math.abs(capture.actors[0].root.position.x-t)<1e-9,'Reference sampling must restore current actor time');
 }
 const restored=JSON.parse(JSON.stringify(settings)), other=scene({aspect});other.setTime(.3);applyCamera(other,restored,.3,duration);assert.equal(other.camera.fov,expected);
 settings.preset.reference_time=2.5;capture.setTime(.5);applyCamera(capture,settings,.5,duration);
 const changed=capture.camera.fov;assert.ok(Number.isFinite(changed));if(lens==='natural')assert.notEqual(changed,expected);
 settings.manual_path.framing_priority='lens';capture.setTime(2);applyCamera(capture,settings,2,duration);assert.equal(capture.camera.fov,changed,'Old priority settings must never re-enable varying zoom');
}
console.log('Reference-frame lens stays exactly constant through arbitrary seeks, movement, actor bobbing, curve adjustments, JSON restore and old zoom settings; reference edits refit and actor time is restored.');

// Reproduce editing the reference path point, which used to refit the lens on
// every gizmo event and cancel out the change in apparent subject size.
for(const aspect of [16/9,9/16])for(const lens of ['natural','fisheye'])for(const ids of [[2],[2,4]]) {
 const capture=scene({aspect,moving:false,bounce:false});
 const settings={mode:'bookends',camera_index:0,target_actor:null,
  preset:{...presetDefaults(ids,0),composition:ids.length>1?'group':'single',selection:ids.length>1?'selected':'single',shot:'full',lens,tracking_mode:'exact'},
  manual_path:{kind:'line',aim:'shot'},start:{position:[0,1,6],target:[0,1,0],fov:45},end:{position:[0,1,8],target:[0,1,0],fov:60}};
 capture.setTime(0);lockManualLens(capture,settings,3,0);
 const fov=settings.manual_path.reference_fov,key=manualLensKey(settings);
 const height=()=>{const a=new THREE.Vector3(0,.85,0).project(capture.camera),b=new THREE.Vector3(0,.95,0).project(capture.camera);return a.distanceTo(b);};
 applyCamera(capture,settings,0,3);const nearSize=height();
 settings.start.position=[0,1,12];resetCurve(settings);addPathPoint(settings);
 assert.equal(manualLensKey(settings),key,'Spatial edits must not invalidate a saved lens');
 lockManualLens(capture,settings,3,0);capture.setTime(0);applyCamera(capture,settings,0,3);
 assert.equal(capture.camera.fov,fov,'Moving the reference marker must not compensate with zoom');
 if(lens==='natural')assert.ok(Math.abs(height()/nearSize-.5)<.02,'Doubling distance must approximately halve apparent size');
 for(const t of [3,0,2,1]){capture.setTime(t);applyCamera(capture,settings,t,3);assert.equal(capture.camera.fov,fov);}
 const restored=JSON.parse(JSON.stringify(settings)),other=scene({aspect,moving:false,bounce:false});
 other.setTime(1);applyCamera(other,restored,1,3);assert.equal(other.camera.fov,fov,'The lens lock must survive saved workflow reload');
 delete settings.manual_path.reference_fov;lockManualLens(capture,settings,3,0);
 if(lens==='natural')assert.notEqual(settings.manual_path.reference_fov,fov,'Only an explicit refit should compensate for the new path distance');
}
console.log('Manual marker/curve edits preserve the serialized lens for singles/groups in perspective/fisheye and portrait/landscape; doubled distance reduces apparent size; explicit refit changes the lens.');
