import * as THREE from "./vendor/build/three.module.js";
import { GLTFLoader } from "./vendor/examples/jsm/loaders/GLTFLoader.js";
import { ensureNormals } from "./mesh_normals.js";
import { alignGLB, retimeBodyTracks } from "./glb_timing.js";
import { selectImport } from "./import_selection.js";
import { actorClip } from "./fbx_clip.js";
import { FBXLoader } from "./vendor/examples/jsm/loaders/FBXLoader.js?v=20261029-scene";
import { actorRegistration } from "./camera_presets.js";
import { defaultView, sampleInputCamera } from "./input_camera.js";
import { cameraRegistration, registerCamera, cameraSourceTime } from "./camera_transfer.js";

// Display colors in linear space, balanced for the viewer's studio lighting.
const BODY_COLOR = [0.105, 0.095, 0.085];
const ACTOR_PALETTES = [
  { shirt: [0.14, 0.065, 0.025], pants: [0.085, 0.018, 0.008] }, // orange / red
  { shirt: [0.02, 0.10, 0.065], pants: [0.008, 0.055, 0.026] }, // green
  { shirt: [0.025, 0.07, 0.14], pants: [0.008, 0.027, 0.085] }, // blue
  { shirt: [0.095, 0.045, 0.14], pants: [0.05, 0.014, 0.085] }, // purple
];

const CAMERA_BASIS = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);

async function importedScene(buffer, descriptor) {
  const manager = new THREE.LoadingManager();
  // Load embedded textures only; do not fetch arbitrary paths named in an actor file.
  const blobURLs = new Set();
  manager.setURLModifier((url) => {
    if (url.startsWith("blob:")) blobURLs.add(url);
    return url.startsWith("blob:") || url.startsWith("data:") ? url : "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1sAAAAASUVORK5CYII=";
  });
  let loading = false;
  let resolveTextures;
  const ready = new Promise((resolve, reject) => {
    resolveTextures = resolve;
    manager.onStart = () => { loading = true; };
    manager.onLoad = resolve;
    manager.onError = () => reject(new Error("An embedded actor texture could not be loaded."));
  });
  ready.catch(() => {});
  const glb = descriptor.format === "glb";
  const loaded = glb ? await new GLTFLoader(manager).parseAsync(buffer, "") : new FBXLoader(manager).parse(buffer, "");
  let root = glb ? loaded.scene : loaded;
  if (!loading) resolveTextures();

  const selection = selectImport(loaded, root, descriptor, (glb ? loaded.animations : root.animations)[0]);
  const clip = actorClip(selection.clip, descriptor);
  // Keep unit conversion outside authored transforms, including an animated or
  // translated top-level FBX group. Its own position must be scaled as well.
  if (!glb && descriptor.animation_start !== undefined) {
    const sourceRoot=root;root=new THREE.Group();root.add(sourceRoot);
    root.scale.setScalar(descriptor.meters_per_unit);
  } else root.scale.multiplyScalar(descriptor.meters_per_unit);
  if (glb) root.traverse(object => { const id=loaded.parser.associations.get(object)?.nodes; if(id!==undefined)object.userData.cartwheelGLBNode=id; });
  const mixer = clip ? new THREE.AnimationMixer(root) : null;
  const action = mixer ? mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1).play() : null;
  if (action) action.clampWhenFinished = true;
  const imported = { root, clip, mixer, action, blobURLs, format: glb ? "glb" : "fbx", discarded:selection.discarded };
  try { await ready; } catch (error) { disposeImported(imported); throw error; }
  return imported;
}

function seek(imported, seconds) {
  if (!imported.mixer) return;
  imported.action.paused = false;
  imported.action.enabled = true;
  imported.mixer.setTime(Math.min(Math.max(0, seconds), Math.max(0, imported.clip.duration - 1e-7)));
  imported.root.updateMatrixWorld(true);
}

function disposeImported(imported) {
  if (!imported) return;
  imported.mixer?.stopAllAction();
  imported.mixer?.uncacheRoot(imported.root);
  for (const url of imported.blobURLs) URL.revokeObjectURL(url);
  const textures = new Set();
  const materials = new Set();
  for (const root of [imported.root, ...(imported.discarded??[])]) root.traverse((object) => {
    object.geometry?.dispose();
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (material) materials.add(material);
    }
  });
  for (const material of materials) {
    for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    material.dispose();
  }
  for (const texture of textures) { texture.source?.data?.close?.(); texture.dispose(); }
}

// A Cartwheel capture's original MHR asset can be authoritative even when its
// downloadable GLB has been resized, retargeted or given an extra setup frame.
export function hasNativeMHRActor(actor) {
  const bones = new Set();
  let skinned = false;
  actor?.root?.traverse((node) => {
    if (node.isBone) bones.add(node.name);
    if (node.isSkinnedMesh) skinned = true;
  });
  return Boolean(actor?.clip?.duration > 0 && skinned && [
    "c_spine0", "c_spine1", "c_spine2", "c_neck", "c_head",
    "l_upleg", "r_upleg", "l_lowleg", "r_lowleg", "l_uparm", "r_uparm",
    "l_lowarm", "r_lowarm", "l_foot", "r_foot",
  ].every((name) => bones.has(name)));
}

export class CapturedScene {
  constructor(descriptor, buffers, referenceBuffers = [], transferBuffer = null) {
    this.group = new THREE.Group();
    this.actors = [];
    this.backgrounds = [];
    this.camera = new THREE.PerspectiveCamera();
    this.cameraIndex = 0;
    this.ready = this.initialize(descriptor, buffers, referenceBuffers, transferBuffer);
  }

  async initialize(descriptor, buffers, referenceBuffers, transferBuffer) {
    const styledMaterials = new Set();
    for (const [index, asset] of descriptor.actors.entries()) {
      let actor = await importedScene(buffers[index], asset);
      if (asset.native_reference && referenceBuffers[index]) {
        let reference;
        try {
          reference = await importedScene(referenceBuffers[index], asset.native_reference);
          const timing = alignGLB(actor, reference, seek);
          if (!timing.verified) {
            if (!hasNativeMHRActor(reference))
              throw new Error(`Actor ${asset.actor}: The exported GLB could not be aligned, and a complete original MHR character is unavailable.`);
            // Keep the original capture's scale, world placement, animation and
            // facial channels together. Do not guess an export time/scale fix.
            disposeImported(actor);
            actor = reference;
            reference = null;
            actor.sourceFallback = { from: "glb", to: "native_mhr", reason: "export_alignment" };
          } else {
            actor.timing = timing;
            if (timing.start !== 0 || timing.scale !== 1) {
              actor.mixer.stopAllAction();
              actor.mixer.uncacheRoot(actor.root);
              retimeBodyTracks(actor.clip, timing);
              actor.action = actor.mixer.clipAction(actor.clip).setLoop(THREE.LoopOnce, 1).play();
              actor.action.clampWhenFinished = true;
            }
          }
        } catch (error) {
          disposeImported(actor);
          throw error;
        } finally {
          disposeImported(reference);
        }
      }
      if (asset.background_nodes?.length) {
        const background = await importedScene(buffers[index], {...asset, selection:{nodes:asset.background_nodes}, background:true});
        this.backgrounds.push(background);this.group.add(background.root);
        background.root.traverse(object=>{if(object.isMesh){ensureNormals(object.geometry);object.frustumCulled=false;}});
      }
      this.actors.push(actor);
      this.group.add(actor.root);
      const actorNumber = Number.isInteger(asset.actor) && asset.actor > 0 ? asset.actor : index + 1;
      actor.number = actorNumber;
      const palette = ACTOR_PALETTES[(actorNumber - 1) % ACTOR_PALETTES.length];
      actor.root.traverse((object) => {
        if (object.isMesh) {
          ensureNormals(object.geometry);
          // Keep the exported material slots and face assignments, including clothing.
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) {
            material.side = THREE.DoubleSide;
            if (!styledMaterials.has(material)) {
              // Preserve clothing assignments while applying a stable actor palette.
              const name = material.name.toLowerCase();
              const color = descriptor.material_policy === "preserve" ? null : name === "body" ? BODY_COLOR : ["shirt", "pants"].includes(name) ? palette[name] : null;
              if (color) material.color.setRGB(...color);
              styledMaterials.add(material);
            }
          }
          object.frustumCulled = false;
        }
      });
    }
    for (const actor of this.actors) seek(actor, 0);
    this.inputCamera = descriptor.camera;
    this.cameraMetadata = descriptor.camera.cameras;
    if (["default", "camera_json"].includes(descriptor.camera.format)) {
      this.cameraScene = null;
      this.cameras = this.cameraMetadata.map(metadata => {
        const camera = new THREE.PerspectiveCamera(metadata.fov, metadata.aspect, metadata.near, metadata.far);
        if (descriptor.camera.format === "default") defaultView(camera, this.actors, metadata);
        return camera;
      });
    } else {
      this.cameraScene = await importedScene(buffers.at(-1), descriptor.camera);
      this.group.add(this.cameraScene.root);
      this.cameras = this.cameraMetadata.map((metadata) => {
        let camera;
        this.cameraScene.root.traverse((object) => {
          if (object.isPerspectiveCamera && (descriptor.camera.format === "glb" ? object.userData.cartwheelGLBNode === metadata.node_id : object.ID === metadata.model_id)) camera = object;
        });
        if (!camera) throw new Error("The embedded or supplied camera could not be loaded.");
        return camera;
      });
    }
    this.duration = descriptor.duration ?? Math.max(0, ...this.actors.map((actor, index) => descriptor.actors[index].duration || actor.clip?.duration || 0), this.cameraScene?.clip?.duration || 0);
    if (descriptor.camera_transfer) {
      this.transfer = descriptor.camera_transfer;
      this.transferActor = await importedScene(transferBuffer, this.transfer.source_actor);
      seek(this.transferActor, 0);
      for (const actor of this.actors) seek(actor, 0);
      const target = this.actors.find(actor => actor.number === this.transfer.reference_actor);
      if (!target) throw new Error("The motion reference actor is unavailable.");
      this.registration = cameraRegistration(actorRegistration(this.transferActor), actorRegistration(target));
      this.duration = this.transfer.target_duration;
    }
    this.setTime(0);
  }

  setTime(seconds) {
    for (const actor of [...this.actors,...this.backgrounds]) seek(actor, seconds);
    if (this.cameraScene) seek(this.cameraScene, this.transfer ? cameraSourceTime(seconds, this.transfer) : seconds);
    this.group.updateMatrixWorld(true);
    const source = this.cameras[this.cameraIndex];
    const metadata = this.cameraMetadata[this.cameraIndex];
    const sampleTime = this.transfer ? cameraSourceTime(seconds, this.transfer) : seconds;
    if (this.inputCamera.format === "camera_json") sampleInputCamera(this.camera, this.inputCamera, sampleTime);
    else {
      source.getWorldPosition(this.camera.position);
      source.getWorldQuaternion(this.camera.quaternion);
      if (this.cameraScene?.format === "fbx") this.camera.quaternion.multiply(CAMERA_BASIS);
    }
    this.camera.aspect = metadata.aspect;
    if (this.inputCamera.format !== "camera_json") this.camera.fov = metadata.fov;
    this.camera.near = Math.max(metadata.near, 1e-5);
    this.camera.far = Math.max(metadata.far, this.camera.near + 1);
    if (this.registration) registerCamera(this.camera, this.registration);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
  }

  path() {
    const points = [];
    const steps = Math.min(512, Math.max(1, Math.ceil(this.duration * 30)));
    for (let step = 0; step <= steps; step++) {
      this.setTime(this.duration * step / steps);
      points.push(this.camera.position.clone());
    }
    this.setTime(0);
    return points;
  }

  dispose() {
    for (const imported of [...this.actors, ...this.backgrounds, this.cameraScene, this.transferActor]) disposeImported(imported);
  }
}
