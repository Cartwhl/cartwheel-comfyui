import {activeSegment,joinBetween,sequenceCutTimes} from './camera_timeline.js?v=20261029-usability-r2';
import { api } from "../../scripts/api.js";
import * as THREE from "./vendor/build/three.module.js";
import { OrbitControls } from "./vendor/examples/jsm/controls/OrbitControls.js";
import { CapturedScene } from "./camera_scene.js?v=20261029-fbx";
import { ActorTags } from "./actor_tags.js";
import {ControlPasses} from "./control_passes.js?v=20261028-delivery-final";
import { applyCamera } from "./camera_motion.js?v=20261029-usability-r2";
import { frameGrid, frameAtTime, timeAtFrame, frameReadout } from "./frame_timeline.js";
import { withCameraVisibility } from "./camera_presets.js";

import { renderCamera, disposeLensRenderer } from "./lens_renderer.js";

import {renderTrackingGuide} from "./tracking_controls.js?v=20261028-curved-camera-paths";

const style = document.createElement("link");
style.rel = "stylesheet";
style.href = new URL("./camera_preview.css?v=20261029-usability-r2", import.meta.url).href;
document.head.append(style);
const SCENE_BACKGROUND = 0x6099c2;
const FRAME_SURROUND = 0x3e6c8d;

function assetURL(asset) {
  return api.apiURL(`/view?${new URLSearchParams({ filename: asset.filename, subfolder: asset.subfolder, type: asset.type })}`);
}

export class CameraPreview {
  constructor(node) {
    this.node = node;
    this.mode = "split";
    this.time = 0;
    this.playing = false;
    this.loadVersion = 0;
    this.element = document.createElement("div");
    this.element.className = "cartwheel-camera-preview";
    this.element.innerHTML = `<div class="cw-toolbar"><div class="cw-heading"><strong>Starting camera</strong><span class="cw-asset-summary" hidden></span></div><div class="cw-modes"><button data-view="split" class="active">Split</button><button data-view="camera">Camera</button><button data-view="scene">Scene</button></div><button class="cw-fit">Fit scene</button></div>
      <div class="cw-viewport"><div class="cw-orbit-input"></div><div class="cw-camera-frame" hidden></div><span class="cw-scene-label">Scene · drag to inspect</span><span class="cw-camera-label">Starting camera</span><div class="cw-empty">Connect a motion source and run this node.</div></div>
      <div class="cw-timeline"><button class="cw-play" disabled>Play</button><input class="cw-scrub" type="range" min="1" max="1" step="1" value="1" disabled aria-label="Shot frame"><span class="cw-time">0 / 0 frames · 0s</span><label class="cw-timeline-rate" hidden>FPS <select aria-label="Timeline frame rate"><option>24</option><option>30</option><option>60</option><option>120</option></select></label></div>
      <div class="cw-footer"><label><input class="cw-path" type="checkbox" checked> Camera path</label><label><input class="cw-actor-labels" type="checkbox" checked> Actor labels</label><label><input class="cw-thirds" type="checkbox"> Thirds guide</label><select class="cw-camera-select" aria-label="Captured camera" hidden></select><span class="cw-status">Original input · read-only</span></div>`;
    this.viewport = this.element.querySelector(".cw-viewport");
    this.orbitInput = this.element.querySelector(".cw-orbit-input");
    this.actorTags = new ActorTags(this.viewport);
    this.empty = this.element.querySelector(".cw-empty");
    this.slider = this.element.querySelector(".cw-scrub");
    this.playButton = this.element.querySelector(".cw-play");
    this.status = this.element.querySelector(".cw-status");
    this.assetSummary = this.element.querySelector(".cw-asset-summary");
    this.cameraSelect = this.element.querySelector(".cw-camera-select");
    this.cameraFrame = this.element.querySelector(".cw-camera-frame");
    for (const event of ["pointerdown", "pointermove", "pointerup", "wheel", "dblclick"]) this.element.addEventListener(event, (event) => event.stopPropagation());
    this.element.querySelectorAll("[data-view]").forEach((button) => button.onclick = () => {
      this.mode = button.dataset.view;
      this.element.querySelectorAll("[data-view]").forEach((item) => item.classList.toggle("active", item === button));
      this.render();
    });
    this.element.querySelector(".cw-fit").onclick = () => this.fitScene();
    this.element.querySelector(".cw-path").onchange = () => this.render();
    this.element.querySelector(".cw-actor-labels").onchange = () => this.render();
    const thirds=this.element.querySelector(".cw-thirds");
    thirds.checked=Boolean(node.properties.cartwheel_thirds_guide);
    thirds.onchange=()=>{node.properties.cartwheel_thirds_guide=thirds.checked;this.render();node.graph?.afterChange?.(node);};
    this.playButton.onclick = () => this.setPlaying(!this.playing);
    this.slider.oninput = () => this.seekFrame(Number(this.slider.value));
    this.fpsWidget = node.widgets.find(widget => widget.name === "render_fps");
    this.fpsSelect = this.element.querySelector(".cw-timeline-rate select");
    this.element.querySelector(".cw-timeline-rate").hidden = Boolean(this.fpsWidget);
    this.fpsSelect.value = String(this.timelineFPS);
    this.fpsSelect.title = "Timeline FPS · match Control Render's Video frame rate. Frame 1 is the clip start.";
    this.fpsSelect.onchange = () => {
      node.properties.cartwheel_timeline_fps = Number(this.fpsSelect.value);
      this.frameRateChanged();
      node.graph?.incrementVersion?.(); node.graph?.afterChange?.(node);
    };
    if (this.fpsWidget) {
      this.originalFPSCallback = this.fpsWidget.callback;
      const preview = this;
      this.fpsCallback = function (...args) {
        const result = preview.originalFPSCallback?.apply(this, args);
        queueMicrotask(() => { if (!preview.disposed) preview.frameRateChanged(); });
        return result;
      };
      this.fpsWidget.callback = this.fpsCallback;
    }
    this.cameraSelect.onchange = () => {
      this.capture.cameraIndex = Number(this.cameraSelect.value);
      const widget = this.node.widgets.find((widget) => widget.name === "render_camera");
      if (widget) widget.value = this.capture.cameraIndex;
      this.makePath();
      this.setTime(this.time);
    };
    this.resizeObserver = new ResizeObserver(() => this.render());
    this.resizeObserver.observe(this.viewport);
  }

  initializeRenderer() {
    if (this.renderer) return;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(SCENE_BACKGROUND);
    this.viewport.prepend(this.renderer.domElement);
    this.scene = new THREE.Scene();
    // Broad studio lighting keeps exported clothing and body materials readable
    // as the captured camera moves around the actor. No shadow maps are needed.
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xc8d3df, 8));
    this.scene.add(new THREE.AmbientLight(0xffffff, 2));
    const key = new THREE.DirectionalLight(0xffffff, 8);
    key.position.set(3, 5, 4);
    const fill = new THREE.DirectionalLight(0xffffff, 4);
    fill.position.set(-4, 3, -5);
    this.scene.add(key, fill);
    this.overviewCamera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
    this.controls = new OrbitControls(this.overviewCamera, this.orbitInput);
    this.controls.addEventListener("change", () => this.render());
    this.grid = new THREE.GridHelper(20, 80, 0xc1deef, 0x8ab6d4);
    this.scene.add(this.grid);
    this.guideCamera = new THREE.PerspectiveCamera();
    this.helper = new THREE.CameraHelper(this.guideCamera);
    this.scene.add(this.helper);
  }

  async load(descriptor) {
    const version = ++this.loadVersion;
    this.setPlaying(false);
    this.empty.hidden = false;
    this.empty.textContent = "Loading motion and starting camera…";
    this.assetSummary.hidden = true;
    try {
      this.initializeRenderer();
      const files = [...descriptor.actors, descriptor.camera];
      const references = descriptor.actors.map((actor) => actor.native_reference);
      const pendingAssets = new Map();
      const fetchAsset = async (file) => {
        if (!file || ["default", "camera_json"].includes(file.format)) return null;
        const url = assetURL(file);
        if (!pendingAssets.has(url)) pendingAssets.set(url, (async () => {
          const response = await fetch(url);
          if (!response.ok) throw new Error("A captured asset is unavailable. Run the preview node to check its files.");
          return response.arrayBuffer();
        })());
        return pendingAssets.get(url);
      };
      const [buffers, referenceBuffers, transferBuffer] = await Promise.all([Promise.all(files.map(fetchAsset)), Promise.all(references.map(fetchAsset)), fetchAsset(descriptor.camera_transfer?.source_actor)]);
      if (version !== this.loadVersion) return;
      const capture = new CapturedScene(descriptor, buffers, referenceBuffers, transferBuffer);
      try { await capture.ready; } catch (error) { capture.dispose(); throw error; }
      if (version !== this.loadVersion) { capture.dispose(); return; }
      if (this.capture) { this.scene.remove(this.capture.group); this.capture.dispose(); }
      this.capture = capture;
      const formats = [...new Set(capture.actors.map((actor) => actor.format.toUpperCase()))].join(" / ");
      this.assetSummary.textContent = `${capture.actors.length} actor${capture.actors.length === 1 ? "" : "s"} · ${formats}${capture.transfer ? " · Imported camera" : ""}`;
      const originalActors = capture.actors.filter((actor) => actor.sourceFallback);
      if (originalActors.length) this.assetSummary.textContent += " · Original capture";
      this.assetSummary.dataset.fallback = String(originalActors.length > 0);
      this.assetSummary.title = originalActors.length
        ? `Actor${originalActors.length === 1 ? "" : "s"} ${originalActors.map((actor) => actor.number).join(", ")}: the GLB export differed from the native animation. Preview and VIDEO use the original captured MHR character${originalActors.length === 1 ? "" : "s"}, including facial animation.`
        : "";
      this.assetSummary.hidden = false;
      const cameraWidget = this.node.widgets.find((widget) => widget.name === "render_camera");
      capture.cameraIndex = Math.min(Number(cameraWidget?.value) || 0, capture.cameras.length - 1);
      if (cameraWidget) cameraWidget.value = capture.cameraIndex;
      this.scene.add(capture.group);
      this.actorTags.load(capture);
      this.slider.max = String(Math.max(1, this.timeline.count));
      this.slider.disabled = !capture.duration;
      this.playButton.disabled = !capture.duration;
      this.cameraSelect.replaceChildren(...capture.cameraMetadata.map((camera, index) => {
        const option = document.createElement("option");
        option.value = String(index);
        option.textContent = camera.name;
        return option;
      }));
      this.cameraSelect.hidden = capture.cameras.length < 2;
      this.cameraSelect.value = String(capture.cameraIndex);
      this.makePath();
      this.fitScene();
      this.setTime(0);
      this.empty.hidden = true;
      this.node.properties.cartwheel_scene = descriptor;
      this.render();
      return true;
    } catch (error) {
      if (version !== this.loadVersion) return;
      this.empty.hidden = false;
      this.empty.textContent = error.message;
      this.status.textContent = "Scene could not be loaded";
      return false;
    }
  }

  makePath() {
    if (this.path) { this.scene.remove(this.path); this.path.geometry.dispose(); this.path.material.dispose(); }
    const points = this.samplePath();
    this.path = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0xffbd62 }));
    this.scene.add(this.path);
    let length = 0;
    for (let index = 1; index < points.length; index++) length += points[index].distanceTo(points[index - 1]);
    this.status.textContent = `${this.capture.actors.length} actor${this.capture.actors.length === 1 ? "" : "s"} · ${length > 0.00001 ? `Camera path ${length.toFixed(2)} m` : "Static camera"} · read-only`;
  }

  fitScene() {
    if (!this.capture) return;
    this.sampleTime(this.currentFrameTime());
    const bounds = new THREE.Box3();
    for (const actor of this.capture.actors) bounds.expandByObject(actor.root);
    bounds.expandByPoint(this.capture.camera.position);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = Math.max(bounds.getSize(new THREE.Vector3()).length(), 1);
    this.controls.target.copy(center);
    this.overviewCamera.position.copy(center).add(new THREE.Vector3(size * 0.8, size * 0.5, size));
    this.overviewCamera.far = Math.max(size * 50, 100);
    this.overviewCamera.updateProjectionMatrix();
    this.controls.update();
    this.render();
  }

  sampleTime(seconds) { this.capture.setTime(seconds); this.capture.camera.userData.cartwheelFisheye = false; }

  samplePath() { return this.capture.path(); }

  get timelineFPS() {
    const rate = Number(this.fpsWidget?.value ?? this.node.properties.cartwheel_timeline_fps ?? 24);
    return [24, 30, 60, 120].includes(rate) ? rate : 24;
  }
  get timeline() { return frameGrid(this.capture?.duration ?? 0, this.timelineFPS); }
  get currentFrame() { return frameAtTime(this.time, this.timeline); }
  currentFrameTime() { return timeAtFrame(this.currentFrame, this.timeline); }
  referenceFrame(time) { return frameAtTime(time, this.timeline, true); }
  referenceTime(time) { return timeAtFrame(this.referenceFrame(time), this.timeline); }
  seekFrame(frame) {
    if (!this.capture) return;
    this.setPlaying(false);
    this.setTime(timeAtFrame(frame, this.timeline));
  }
  frameRateChanged() {
    if (!this.capture) return;
    const time = this.time;
    this.setPlaying(false);
    this.setTime(this.referenceTime(time));
  }
  setTime(seconds) {
    this.time = Math.max(0, Math.min(seconds, this.capture.duration));
    const grid = this.timeline, frame = frameAtTime(this.time, grid);
    this.fpsSelect.value = String(grid.fps);
    this.sampleTime(timeAtFrame(frame, grid));
    const maximum=String(Math.max(1,grid.count)),value=String(frame||1);
    if(this.slider.max!==maximum)this.slider.max=maximum;
    if(this.slider.value!==value)this.slider.value=value;
    this.slider.setAttribute("aria-valuetext", `Frame ${frame} of ${grid.count} at ${grid.fps} FPS`);
    this.element.querySelector(".cw-time").textContent = frameReadout(this.time, grid);
    this.element.querySelector(".cw-time").title = `${grid.fps} FPS · Frame 1 is the clip start. Use the slider's arrow keys to step one frame.`;
    this.render();
  }

  setPlaying(playing) {
    this.playing = playing;
    this.playButton.textContent = playing ? "Pause" : "Play";
    cancelAnimationFrame(this.animationFrame);
    if (!playing) { if (this.capture) this.time = this.currentFrameTime(); return; }
    let previous;
    const tick = (timestamp) => {
      if (!this.playing) return;
      if (previous !== undefined && this.element.isConnected) {
        const next = this.time + Math.min((timestamp - previous) / 1000, 0.1);
        this.setTime(next > this.capture.duration ? 0 : next);
      }
      previous = timestamp;
      this.animationFrame = requestAnimationFrame(tick);
    };
    this.animationFrame = requestAnimationFrame(tick);
  }

  async renderVideo(request) {
    const endpoint = `/cartwheel/render/${request.token}`;
    let dataPasses=null;
    const controller = new AbortController();
    this.renderController = controller;
    const send = async (action, body, headers) => {
      const response = await api.fetchApi(`${endpoint}/${action}`, { method: "POST", body, headers, signal: controller.signal });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    };
    let renderer;
    let states;
    const previousTime = this.time;
    const previousStatus = this.status.textContent;
    this.setPlaying(false);
    try {
      if (!this.capture || JSON.stringify(this.node.properties.cartwheel_scene) !== JSON.stringify(request.scene)) {
        if (!await this.load(request.scene)) throw new Error("The captured scene could not be loaded for rendering.");
      }
      this.capture.cameraIndex = request.camera_index;
      const duration = request.camera?.timeline.duration ?? this.capture.duration;
      states = [...this.element.querySelectorAll("button,input,select")].map((control) => [control, control.disabled]);
      for (const [control] of states) control.disabled = true;
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(1);
      renderer.setSize(request.width, request.height);
      renderer.setClearColor(SCENE_BACKGROUND);
      if(request.control_passes?.length){dataPasses=new ControlPasses(this.capture);dataPasses.configureDepth(time=>{this.capture.setTime(time);applyCamera(this.capture,request.camera?.settings,time,duration);return this.capture.camera;},duration,request.camera?.settings?.camera_timeline?.segments.flatMap(s=>[s.start,s.end,Math.max(s.start,s.end-1/request.fps)])??[]);}
      const { frames } = await send("start", JSON.stringify({ duration }), { "Content-Type": "application/json" });
      const cameraFrames = [];
      const recordCamera = (time) => {
        const camera = this.capture.camera;
        camera.updateMatrixWorld(true);
        const position=camera.getWorldPosition(new THREE.Vector3()),quaternion=camera.getWorldQuaternion(new THREE.Quaternion());
        const target=new THREE.Vector3(0,0,-1).applyQuaternion(quaternion).add(position);
        const timeline=request.camera?.settings?.camera_timeline;const active=timeline?activeSegment(timeline,time):null;
        const p=active?.settings?.preset??request.camera?.settings?.preset;const filmback=p?.lens_calibration==='full_frame'?(camera.aspect>=1?Math.min(24,36/camera.aspect):Math.min(36,24/camera.aspect)):(p?.sensor_height??24);
        const cut=timeline?sequenceCutTimes(timeline).some(boundary=>boundary>0&&time>=boundary-1e-8&&(cameraFrames.at(-1)?.time??-1)<boundary-1e-8):false;
        cameraFrames.push({time,cut,lens_projection:camera.userData.cartwheelFisheye?'fisheye_equidistant':'perspective',position:position.toArray(),quaternion:quaternion.toArray(),target:target.toArray(),target_semantics:'optical_axis_1m',fov:camera.fov,focal_length:filmback/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov)/2)),sensor_height:filmback});
      };
      for (let index = 0; index < frames; index++) {
        if (controller.signal.aborted) throw new Error("Video rendering was interrupted.");
        this.capture.setTime(index / request.fps);
        applyCamera(this.capture, request.camera?.settings, index / request.fps, duration);
        recordCamera(index / request.fps);
        this.helper.visible = this.path.visible = false;
        this.manualPathEditor?.sceneVisibility(false, 0, 0);
        this.grid.visible = true;
        withCameraVisibility(this.capture, request.camera?.settings, () => renderCamera(renderer, this.scene, this.capture.camera));
        const png = await new Promise((resolve) => renderer.domElement.toBlob(resolve, "image/png"));
        if (!png) throw new Error("The browser could not capture a rendered frame.");
        this.status.textContent = `Rendering VIDEO · ${index + 1} / ${frames} frames`;
        await send(`frame?index=${index}`, png, { "Content-Type": "image/png" });
        for(const kind of request.control_passes??[]){
          this.grid.visible=false;
          withCameraVisibility(this.capture,request.camera?.settings,()=>dataPasses.render(renderer,this.scene,this.capture.camera,kind));
          const pass=await new Promise(resolve=>renderer.domElement.toBlob(resolve,'image/png'));
          if(!pass)throw new Error('A control pass could not be captured.');
          await send(`frame?index=${index}&pass=${kind}`,pass,{'Content-Type':'image/png'});
        }
        this.grid.visible=true;
      }
      this.capture.setTime(duration);
      applyCamera(this.capture, request.camera?.settings, duration, duration);
      recordCamera(duration);
      await send("finish", JSON.stringify({schema_version:1,units:'meters',up:'Y',fps:request.fps,aspect:request.width/request.height,
        lens_projection:cameraFrames.some(f=>f.lens_projection==='fisheye_equidistant')?'fisheye_equidistant':'perspective',frames:cameraFrames,
        depth_range:dataPasses?{near:dataPasses.uniforms.near.value,far:dataPasses.uniforms.far.value,foreground_floor:.12,foreground_ceiling:.98,range_policy:'clip_actor_bounds_padded'}:null,pose_status:dataPasses?{mapped_actors:dataPasses.rigs.map(r=>r.actor),total_actors:this.capture.actors.length}:null,render_actors:this.capture.actors.map(actor=>({actor:actor.number,format:actor.format}))}), {"Content-Type":"application/json"});
      this.status.textContent = "VIDEO rendered · ready for downstream nodes";
    } catch (error) {
      this.status.textContent = error.message;
      try { await send("error"); } catch { /* The execution may already have been interrupted. */ }
    } finally {
      dataPasses?.dispose();
      if (renderer) disposeLensRenderer(renderer);
      renderer?.dispose();
      renderer?.forceContextLoss();
      for (const [control, disabled] of states || []) control.disabled = disabled;
      this.renderController = null;
      if (this.capture) this.setTime(previousTime);
      if (controller.signal.aborted) this.status.textContent = previousStatus;
    }
  }

  render() {
    if (!this.renderer || !this.capture || !this.viewport.clientWidth) return;
    const width = this.viewport.clientWidth, height = this.viewport.clientHeight;
    this.renderer.setSize(width, height, false);
    this.renderer.setScissorTest(false);
    this.renderer.setClearColor(FRAME_SURROUND);
    this.renderer.clear();
    const sceneWidth = this.mode === "split" ? Math.floor(width * 0.5) : this.mode === "scene" ? width : 0;
    this.orbitInput.style.width = `${sceneWidth}px`;
    this.orbitInput.hidden = sceneWidth === 0;
    this.controls.enabled = sceneWidth > 0 && !this.sceneInteractionLocked && !this.renderController;
    this.element.querySelector(".cw-scene-label").hidden = !sceneWidth;
    const cameraLabel = this.element.querySelector(".cw-camera-label");
    cameraLabel.hidden = this.mode === "scene";
    this.cameraFrame.hidden = this.mode === "scene";
    this.element.querySelector(".cw-thirds").checked = Boolean(this.node.properties.cartwheel_thirds_guide);
    this.cameraFrame.classList.toggle("cw-thirds-visible",this.element.querySelector(".cw-thirds").checked);
    cameraLabel.style.left = `${sceneWidth + 10}px`;
    this.helper.visible = sceneWidth > 0;
    this.path.visible = sceneWidth > 0 && this.element.querySelector(".cw-path").checked;
    this.grid.visible = true;
    if (sceneWidth) {
      this.overviewCamera.aspect = sceneWidth / height;
      this.overviewCamera.updateProjectionMatrix();
      this.guideCamera.copy(this.capture.camera);
      this.guideCamera.near = 0.01;
      this.guideCamera.far = 0.35;
      this.guideCamera.updateProjectionMatrix();
      this.guideCamera.updateMatrixWorld(true);
      this.helper.update();
      this.renderer.setScissorTest(true);
      this.renderer.setViewport(0, 0, sceneWidth, height);
      this.renderer.setScissor(0, 0, sceneWidth, height);
      this.renderer.setClearColor(SCENE_BACKGROUND);
      this.manualPathEditor?.sceneVisibility(true, sceneWidth, height);
      this.renderer.render(this.scene, this.overviewCamera);
    }
    this.manualPathEditor?.sceneVisibility(false, sceneWidth, height);
    if (this.mode !== "scene") {
      this.helper.visible = this.path.visible = false;
      const areaWidth = width - sceneWidth;
      const aspect = this.capture.camera.aspect;
      const viewWidth = Math.min(Math.max(1, areaWidth - 24), Math.max(1, height - 24) * aspect), viewHeight = viewWidth / aspect;
      const x = sceneWidth + (areaWidth - viewWidth) / 2, y = (height - viewHeight) / 2;
      Object.assign(this.cameraFrame.style, { left: `${x}px`, top: `${height - y - viewHeight}px`, width: `${viewWidth}px`, height: `${viewHeight}px` });
      renderTrackingGuide(this);
      this.renderer.setScissorTest(true);
      this.renderer.setViewport(x, y, viewWidth, viewHeight);
      this.renderer.setScissor(x, y, viewWidth, viewHeight);
      this.renderer.setClearColor(SCENE_BACKGROUND);
      withCameraVisibility(this.capture, this.settings, () => renderCamera(this.renderer, this.scene, this.capture.camera));
    }
    this.manualPathEditor?.sceneVisibility(sceneWidth > 0, sceneWidth, height);
    this.renderer.setScissorTest(false);
    this.actorTags.render(this.overviewCamera, sceneWidth, height, this.element.querySelector(".cw-actor-labels").checked);
  }

  dispose() {
    this.disposed = true;
    if (this.fpsWidget && this.fpsWidget.callback === this.fpsCallback) this.fpsWidget.callback = this.originalFPSCallback;
    this.renderController?.abort();
    this.loadVersion++;
    this.setPlaying(false);
    this.resizeObserver.disconnect();
    this.controls?.dispose();
    this.capture?.dispose();
    this.scene?.traverse((object) => { object.geometry?.dispose(); object.material?.dispose?.(); });
    if (this.renderer) disposeLensRenderer(this.renderer);
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.element.remove();
  }
}
