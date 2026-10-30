import {applySequence} from './camera_sequence.js?v=20261029-usability-r2';
import {applyCameraTransition} from './camera_transition.js';
import * as THREE from "./vendor/build/three.module.js";

import { cameraAspect } from "./camera_format.js";
import { applyPreset, manualFramingState } from "./camera_presets.js";

import { manualPath, manualPosition, pathProgress, shotFraming, sourceSample } from "./manual_path.js?v=20261028-curved-camera-paths";

import { applyManualFraming, manualReferenceLens } from "./manual_framing.js?v=20261028-curved-camera-paths";

import {manualAimAt} from "./manual_tracking.js?v=20261028-curved-camera-paths";

const focusPoints = new WeakMap();

export function actorTarget(capture, actorId) {
  const actor = capture.actors.find((item) => item.number === actorId);
  if (!actor) throw new Error("Choose an actor available in this capture.");
  let focus = focusPoints.get(actor.root);
  if (!focus) {
    let head;
    actor.root.traverse((object) => {
      if (!head && object.isBone && /(^|[:_])head$/i.test(object.name)) head = object;
    });
    focus = head ? { head } : { local: actor.root.worldToLocal(new THREE.Box3().setFromObject(actor.root).getCenter(new THREE.Vector3())) };
    focusPoints.set(actor.root, focus);
  }
  if (!focus.head) return actor.root.localToWorld(focus.local.clone());
  const point = focus.head.getWorldPosition(new THREE.Vector3());
  point.y -= 0.3;
  return point;
}

function baseApplyCamera(capture, settings, time, duration) {
  capture.camera.userData.cartwheelActionFollow=null;
  capture.camera.userData.cartwheelAimPoint=null;
  capture.camera.userData.cartwheelFisheye = !settings || ["captured","history"].includes(settings.mode)
    ? Boolean(capture.camera.userData.cartwheelInputFisheye)
    : (settings.mode === "preset" || shotFraming(settings)) && settings.preset?.lens === "fisheye";
  capture.camera.aspect = cameraAspect(capture, settings);
  capture.camera.updateProjectionMatrix();
  if (!settings || ["captured", "history"].includes(settings.mode)) return;
  if (settings.mode === "preset") { applyPreset(capture, settings, time, duration); return; }
  const blend = pathProgress(settings, time, duration);
  const camera = capture.camera;
  if(manualPath(settings).source_frames && manualPath(settings).aim==='source') {
    const source=sourceSample(settings,blend);
    const orientation=capture.inputCamera&&manualPath(settings).pacing==='linear'&&Math.abs(blend-time/duration)<1e-9?camera.quaternion.clone():source.quaternion;
    manualPosition(settings,blend,camera.position);camera.quaternion.copy(orientation);
    if(settings.preset?.roll)camera.rotateZ(THREE.MathUtils.degToRad(settings.preset.roll));
    camera.fov=manualPath(settings).lens_override?manualReferenceLens(capture,settings,duration,time).fov:source.fov;
    camera.userData.cartwheelFisheye=!manualPath(settings).lens_override&&source.lens_projection?source.lens_projection==='fisheye_equidistant':settings.preset?.lens==='fisheye';
    camera.updateProjectionMatrix();camera.updateMatrixWorld(true);return;
  }
  if (shotFraming(settings)) {
    const lens=manualReferenceLens(capture,settings,duration,time);
    const q=settings.preset.tracking_mode && settings.preset.tracking_mode !== 'legacy'
      ? manualAimAt(capture,settings,duration,lens,time) : null;
    camera.aspect=cameraAspect(capture,settings);
    manualPosition(settings,blend,camera.position);
    applyManualFraming(camera, settings, manualFramingState(capture, settings.preset),lens);
    if(q){camera.quaternion.copy(q);camera.updateMatrixWorld(true);}
    return;
  }
  manualPosition(settings,blend,camera.position);
  const target = settings.target_actor !== null ? actorTarget(capture, settings.target_actor)
    : new THREE.Vector3().fromArray(settings.start.target).lerp(new THREE.Vector3().fromArray(settings.end.target), manualPath(settings).aim === "fixed" ? 0 : blend);
  if (camera.position.distanceToSquared(target) < 1e-10) throw new Error("The camera is on its look-at target. Adjust the camera position.");
  camera.up.set(0, 1, 0);
  camera.lookAt(target);
  camera.userData.cartwheelAimPoint=target.clone();
  camera.fov = THREE.MathUtils.lerp(settings.start.fov, settings.end.fov, blend);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
}

export function applySingleCamera(capture,settings,time,duration){
  baseApplyCamera(capture,settings,time,duration);
  applyCameraTransition(capture,settings,time,duration,baseApplyCamera);
}

export function applyCamera(capture,settings,time,duration){
 if(settings?.camera_timeline)return applySequence(capture,settings,time,duration,applySingleCamera);
 return applySingleCamera(capture,settings,time,duration);
}

export function cameraPath(capture, settings, duration) {
  const points = [];
  const steps = Math.min(128, Math.max(1, Math.ceil(duration * 10)));
  if (settings?.mode === 'bookends') {
    // Path guides only need position, not an anatomical/lens fit at each sample.
    for (let step=0;step<=steps;step++) points.push(manualPosition(settings,pathProgress(settings,duration*step/steps,duration)));
    return points;
  }
  for (let step = 0; step <= steps; step++) {
    const time = duration * step / steps;
    capture.setTime(time);
    applyCamera(capture, settings, time, duration);
    points.push(capture.camera.position.clone());
  }
  return points;
}

export function capturePose(camera, target) {
  return { position: camera.position.toArray(), target: target.toArray(), fov: camera.fov };
}
