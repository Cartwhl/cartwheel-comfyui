import * as THREE from './vendor/build/three.module.js';

export function defaultView(camera, actors, metadata) {
  for (const actor of actors) { actor.root.updateMatrixWorld(true); }
  const bounds = new THREE.Box3();
  for (const actor of actors) bounds.union(new THREE.Box3().setFromObject(actor.root));
  if (bounds.isEmpty()) throw new Error('The GLB scene contains no visible character geometry.');
  const center = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3());
  camera.fov = metadata.fov; camera.aspect = metadata.aspect;
  const tangent = Math.tan(THREE.MathUtils.degToRad(camera.fov)/2);
  const distance = 1.12*Math.max(size.y/(2*tangent),size.x/(2*tangent*camera.aspect)) + size.z/2;
  camera.position.copy(center).add(new THREE.Vector3(0,0,Math.max(distance,0.5)));
  camera.lookAt(center); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
}

export function sampleInputCamera(camera, descriptor, seconds) {
  camera.userData.cartwheelInputFisheye = descriptor.lens_projection === 'fisheye_equidistant';
  const frames = descriptor.frames;
  // Binary search keeps long sampled paths cheap to scrub and render.
  let lo=0,hi=frames.length-1;
  while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(frames[mid].time<=seconds)lo=mid;else hi=mid-1;}
  const a=frames[lo],b=frames[Math.min(lo+1,frames.length-1)];
  const t=a===b||b.cut?0:THREE.MathUtils.clamp((seconds-a.time)/(b.time-a.time),0,1);
  camera.userData.cartwheelInputFisheye=(a.lens_projection??descriptor.lens_projection)==='fisheye_equidistant';
  camera.position.fromArray(a.position).lerp(new THREE.Vector3().fromArray(b.position),t);
  if(a.target&&!a.quaternion){
    const target=new THREE.Vector3().fromArray(a.target).lerp(new THREE.Vector3().fromArray(b.target),t);
    camera.up.set(0,1,0);camera.lookAt(target);
    camera.rotateZ(THREE.MathUtils.degToRad(THREE.MathUtils.lerp(a.roll,b.roll,t)));
  }else camera.quaternion.fromArray(a.quaternion).slerp(new THREE.Quaternion().fromArray(b.quaternion),t);
  camera.fov=THREE.MathUtils.lerp(a.fov,b.fov,t);
}
