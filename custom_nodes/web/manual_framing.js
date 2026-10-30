import * as THREE from './vendor/build/three.module.js';
import { composedOrientation, hasFocus } from './camera_composition.js';
import { imagePoint, fisheyeVerticalFOV, perspectiveVerticalFOV } from './lens_projection.js';

import { manualFramingState } from './camera_presets.js';
import { manualPosition, pathProgress } from './manual_path.js?v=20261028-curved-camera-paths';
import { cameraAspect } from './camera_format.js';

import { trackingPlacement } from "./aim_tracking.js";

const LENSES = { ultra_wide:18, wide:24, natural:35, portrait:50, telephoto:85 };
function corners(bounds) {
  if (bounds.framingPoints) return bounds.framingPoints;
  const points=[];
  for(const x of [bounds.min.x,bounds.max.x]) for(const y of [bounds.min.y,bounds.max.y]) for(const z of [bounds.min.z,bounds.max.z]) points.push(new THREE.Vector3(x,y,z));
  return points;
}

// Fit a lens at a fixed, user-authored position. Never modify that position to
// satisfy a crop, angle preset, collision or group coverage constraint.
export function fitManualReference(camera, state) {
  const p=state.preset, fisheye=p.lens==='fisheye', aspect=camera.aspect;
  const priority='shot';
  const target=state.target.clone();
  const placement=state.placement;
  const deg=THREE.MathUtils.degToRad, rad=THREE.MathUtils.radToDeg;
  const nominal=fisheye ? fisheyeVerticalFOV(p.fisheye_fov,aspect) : rad(2*Math.atan(p.sensor_height/(2*(LENSES[p.lens] ?? p.focal_length))));
  const minFov=fisheye?fisheyeVerticalFOV(90,aspect):5, maxFov=fisheye?fisheyeVerticalFOV(180,aspect):150;
  const coincident=camera.position.distanceToSquared(target)<1e-10;
  if(coincident) target.copy(camera.position).add(new THREE.Vector3(0,0,-1));
  const orientation=fov=>composedOrientation(camera.position,target,p.roll,fov,aspect,placement,fisheye);
  const points=corners(state.bounds);
  const verticalOnly=p.framing_version===2 && (!hasFocus(p)||p.focus_point==='auto') && p.actors.length===1 && !['full','wide','extreme_wide'].includes(p.shot);
  const wide=hasFocus(p)&&p.focus_point!=='auto'?1:p.shot==='wide'?1.7:p.shot==='extreme_wide'?3:1;
  const fits=fov=>{
    if(coincident) return false;
    const inverse=orientation(fov).invert();
    return points.every(point=>{
      const local=point.clone().sub(camera.position).applyQuaternion(inverse);
      if(-local.z<=0.005) return false;
      const image=imagePoint(local,fov,aspect,fisheye), room=p.padding*wide;
      return Number.isFinite(image.x)&&Number.isFinite(image.y)&&Math.abs(image.y)*room<=1&&(verticalOnly||Math.abs(image.x)*room<=1);
    });
  };
  let fov=nominal, limited=false;
  if(priority==='shot') {
    // Search the first feasible field of view. Exact thirds can change the
    // orientation with FOV; a coarse bracket avoids assuming global monotonicity.
    let lower=minFov, upper=minFov, found=fits(minFov);
    if(!found) for(let i=1;i<=48;i++) {
      upper=THREE.MathUtils.lerp(minFov,maxFov,i/48);
      if(fits(upper)){found=true;break;}
      lower=upper;
    }
    if(found) {
      for(let i=0;i<20;i++){const middle=(lower+upper)/2;if(fits(middle))upper=middle;else lower=middle;}
      fov=upper; limited=fits(minFov); // An extremely distant crop may exceed the telephoto limit.
    } else { fov=maxFov; limited=true; }
  }
  camera.fov=fov;camera.quaternion.copy(orientation(fov));camera.up.set(0,1,0);camera.near=.01;
  camera.far=Math.max(camera.far,camera.position.length()+200);
  camera.userData.cartwheelFisheye=fisheye;
  camera.userData.cartwheelManualFraming={priority,limited,vertical_fov:fov,focal_length:fisheye?null:p.sensor_height/(2*Math.tan(deg(fov)/2))};
  camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
  return { ...camera.userData.cartwheelManualFraming, fov, reference_time:p.reference_time };
}

// Only deliberate changes to the requested shot invalidate the saved lens.
// Path positions, handles, tracking and start/end placement never do.
export function manualLensKey(settings) {
  const p=settings.preset;
  return JSON.stringify([settings.output_frame,p?.actors,p?.composition,p?.shot,p?.focus_point,p?.focus_fill,
    p?.framing_scale,p?.padding,p?.reference_time,p?.lens,p?.fisheye_fov,p?.sensor_height,p?.focal_length,p?.lens_calibration]);
}
export function lockManualLens(capture,settings,duration,time) {
  if(settings.manual_path.reference_fov == null) {
    const lens=manualReferenceLens(capture,settings,duration,time);
    settings.manual_path.reference_fov=lens.fov;
  }
}
const referenceCache=new WeakMap();
export function manualReferenceLens(capture,settings,duration,restoreTime) {
  const aspect=cameraAspect(capture,settings);
  const p=settings.preset;
  if(settings.manual_path?.source_frames&&!settings.manual_path.lens_override){
    const fov=settings.manual_path.source_frames[0].fov;
    const height=p.lens_calibration==='full_frame'?(aspect>=1?Math.min(24,36/aspect):Math.min(36,24/aspect)):p.sensor_height;
    return {fov,vertical_fov:fov,focal_length:p.lens==='fisheye'?null:height/(2*Math.tan(THREE.MathUtils.degToRad(fov)/2)),priority:'starting lens',reference_time:p.reference_time,limited:false};
  }
  if(p.lens_calibration==='full_frame') {
    const fov=p.lens==='fisheye'?fisheyeVerticalFOV(p.fisheye_fov,aspect):perspectiveVerticalFOV(LENSES[p.lens]??p.focal_length,aspect,p);
    return {fov,vertical_fov:fov,focal_length:p.lens==='fisheye'?null:(LENSES[p.lens]??p.focal_length),priority:'fixed lens',reference_time:p.reference_time,limited:false};
  }
  const saved=settings.manual_path?.reference_fov;
  if(saved != null) return {fov:saved,vertical_fov:saved,priority:'reference',reference_time:settings.preset.reference_time,
    focal_length:settings.preset.lens==='fisheye'?null:settings.preset.sensor_height/(2*Math.tan(THREE.MathUtils.degToRad(saved)/2)),limited:false};
  const key=JSON.stringify([settings,aspect,duration]);
  let cached=referenceCache.get(capture);
  if(cached?.key!==key) {
    const referenceTime=THREE.MathUtils.clamp(settings.preset.reference_time ?? 0,0,duration);
    try {
      capture.setTime(referenceTime);
      const camera=new THREE.PerspectiveCamera(45,aspect,.01,1000);
      manualPosition(settings,pathProgress(settings,referenceTime,duration),camera.position);
      const state=manualFramingState(capture,settings.preset);
      state.placement=trackingPlacement(settings.preset,referenceTime,duration,state.placement);
      const lens=fitManualReference(camera,state);
      cached={key,lens:{...lens,priority:'reference',reference_time:referenceTime}};
    } finally { capture.setTime(restoreTime); }
    referenceCache.set(capture,cached);
  }
  return cached.lens;
}

// Only aim is evaluated during playback. The lens is fitted at the selected
// reference pose/path position and is never refitted for later actor movement.
export function applyManualFraming(camera,settings,state,lens) {
  if(!lens) throw new Error('The manual camera needs a reference-frame lens.');
  const target=state.target.clone();
  if(camera.position.distanceToSquared(target)<1e-10) target.copy(camera.position).add(new THREE.Vector3(0,0,-1));
  const fisheye=state.preset.lens==='fisheye';
  camera.fov=lens.fov;
  camera.quaternion.copy(composedOrientation(camera.position,target,state.preset.roll,lens.fov,camera.aspect,state.placement,fisheye));
  camera.up.set(0,1,0);camera.near=.01;camera.far=Math.max(camera.far,camera.position.length()+200);
  camera.userData.cartwheelFisheye=fisheye;
  camera.userData.cartwheelManualFraming={...lens,priority:'reference',vertical_fov:lens.fov};
  camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
}
