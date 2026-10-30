import {resetCameraSettings} from './camera_reset.js?v=20261029-fbx';
import {CameraInstructions} from './camera_instructions.js?v=20261029-fbx';
import {CameraTimelineEditor} from './camera_timeline_editor.js?v=20261029-position-drag-r2';
import {CAMERA_COLORS,selectedSegment,regridTimeline,recipe as singleRecipe} from './camera_timeline.js?v=20261029-fbx';
import {sequencePlan,sequencePose} from './camera_sequence.js?v=20261029-fbx';
import {applySingleCamera} from './camera_motion.js?v=20261029-fbx';
import {migrateHeldAim} from './target_controls.js?v=20261028-curved-camera-paths';
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import * as THREE from "./vendor/build/three.module.js";
import { DEFAULT_OUTPUT_FRAME, RATIOS } from "./camera_format.js";
import { CameraPreview } from "./camera_preview.js?v=20261029-fbx";
import { PresetControls } from "./preset_controls.js?v=20261029-position-drag-r2";
import { nearestFramingReference, cameraBehavior } from "./shot_controls.js?v=20261028-delivery";
import { applyCamera, cameraPath, capturePose } from "./camera_motion.js?v=20261029-fbx";
import { defaultEditorSettings as defaults, settingsForMotion } from "./editor_settings.js";

import { ManualPathEditor } from "./manual_path_editor.js?v=20261029-auto-apply";
import { defaultManualPath, manualPath, moveMarker, shotFraming, resetCurve } from "./manual_path.js?v=20261028-curved-camera-paths";

import { perspectiveVerticalFOV } from "./lens_projection.js";
import { lockManualLens, manualLensKey } from "./manual_framing.js?v=20261028-curved-camera-paths";

import { presetDefaults, effectivePreset, presetPlan } from "./camera_presets.js";

const renderers = new Map();

export class CameraEditor extends CameraPreview {
  constructor(node) {
    super(node);
    this.element.classList.add('cw-camera-editor');
    this.combined = (node.comfyClass ?? node.type) === "CartwheelCameraPreview";
    this.settingsWidget = node.widgets.find((widget) => widget.name === "camera_settings");
    try { this.settings = JSON.parse(this.settingsWidget.value || JSON.stringify(defaults())); }
    catch { this.settings = { ...defaults(), output_frame: this.settings?.output_frame ?? { ...DEFAULT_OUTPUT_FRAME } }; }
    this.element.querySelector(".cw-toolbar strong").textContent = "Camera editor";
    this.editor = document.createElement("div");
    this.editor.className = "cw-editor";
    this.editor.innerHTML = `<div class="cw-editor-options"><strong class="cw-source-status">Starting camera</strong><button class="cw-open-presets">Edit camera</button><button class="cw-reset-camera">Use starting camera</button></div><div class="cw-output-frame"><label>Orientation <select aria-label="Output orientation"><option value="original">Original input</option><option value="landscape">Landscape</option><option value="portrait">Portrait</option></select></label><label>Aspect ratio <select aria-label="Output aspect ratio"></select></label></div><div class="cw-endpoints"></div><div class="cw-edit-hint" role="status">Run this node once to load motion.</div>`;
    this.element.querySelector(".cw-timeline").after(this.editor);
    this.orientation = this.editor.querySelector('[aria-label="Output orientation"]');
    this.aspectRatio = this.editor.querySelector('[aria-label="Output aspect ratio"]');
    this.orientation.onchange = () => this.edit(() => { this.settings.output_frame = { ...DEFAULT_OUTPUT_FRAME, ...this.settings.output_frame, orientation: this.orientation.value }; });
    this.aspectRatio.onchange = () => this.edit(() => { this.settings.output_frame = { ...DEFAULT_OUTPUT_FRAME, ...this.settings.output_frame, ratio: this.aspectRatio.value }; });
    this.hint = this.editor.querySelector(".cw-edit-hint");
    this.openPresets = this.editor.querySelector(".cw-open-presets");
    this.openPresets.onclick = () => this.edit(() => {
      const saved=this.savedEdit??this.node.properties.cartwheel_saved_edit;
      if(saved?.world_frame_id===this.motion.world_frame.id){this.settings=structuredClone(saved);this.savedEdit=null;}
      else if(this.settings.mode==='captured')this.beginStartingEdit();
    });
    this.editor.querySelector(".cw-reset-camera").onclick = () => this.useCapturedCamera();
    for (const endpoint of ["start", "end"]) {
      const card = document.createElement("div");
      card.className = "cw-endpoint";
      card.innerHTML = `<div class="cw-endpoint-title"><strong>${endpoint === "start" ? "Start" : "End"}</strong><button data-set="${endpoint}">Use scene position</button><button data-jump="${endpoint}">Go to ${endpoint}</button></div>`;
      this.editor.querySelector(".cw-endpoints").append(card);
      card.querySelector("[data-set]").onclick = () => this.edit(() => {
        this.initializeBookends();
        const pose = capturePose(this.overviewCamera, this.controls.target);
        moveMarker(this.settings, `${endpoint}_position`, pose.position);
        this.settings[endpoint].target = pose.target; this.settings[endpoint].fov = pose.fov;
        this.setTime(endpoint === "start" ? 0 : this.capture.duration);
      });
      card.querySelector("[data-jump]").onclick = () => this.setTime(endpoint === "start" ? 0 : this.capture.duration);
    }
    this.manualPathEditor = new ManualPathEditor(this);
    this.presets = new PresetControls(this);
    this.cameraSelect.onchange = () => this.edit(() => { this.settings.camera_index = Number(this.cameraSelect.value); });
    this.sequence=new CameraTimelineEditor(this);
    this.instructions=new CameraInstructions(this);
    if(this.combined)this.installSaveControls();
    this.syncControls();
  }

  installSaveControls(){
    const toolbar=this.element.querySelector('.cw-toolbar'),group=document.createElement('div');group.className='cw-camera-save';
    const name=document.createElement('input');name.type='text';name.maxLength=200;name.placeholder='Scene name';name.setAttribute('aria-label','Saved scene name');name.value=this.node.properties.cartwheel_camera_name??'';
    name.oninput=name.onchange=()=>{this.node.properties.cartwheel_camera_name=name.value;this.node.graph?.incrementVersion?.();this.node.graph?.afterChange?.(this.node);};
    const save=document.createElement('button');save.textContent='Save scene';save.setAttribute('aria-label','Save named scene');group.append(name,save,this.sequence.undo,this.sequence.redo);toolbar.append(group);this.saveName=name;this.saveButton=save;
    save.onclick=async()=>{
      if(!this.capture||this.savingCamera)return;
      if(!name.value.trim()){name.focus();this.hint.textContent='Name this scene before saving.';return;}
      name.oninput();this.savingCamera=true;save.disabled=true;this.setPlaying(false);
      try{
        this.hint.textContent='Saving scene and local preview…';
        const field=key=>this.node.widgets.find(w=>w.name===key)?.value;
        const response=await api.fetchApi('/cartwheel/local-jobs/save-camera',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name.value.trim(),motion:this.motion,camera_settings:this.settings,client_id:api.clientId,render_view:field('render_view'),fps:field('render_fps')??'24',size:field('render_size')??'720p'})});
        const result=await response.json();if(!response.ok)throw new Error(result.error||'Scene could not be saved.');
        this.node.onExecuted?.(result.ui);this.hint.textContent=`Saved “${result.saved.title}” to Saved jobs.`;
      }catch(error){this.hint.textContent=error.message;}finally{this.savingCamera=false;save.disabled=!this.capture;}
    };
  }

  async baseMotion() {
    // The connected CAMERA defines the starting view, including registered
    // cameras. Changing editing modes never looks up a provider/session.
    return this.motion;
  }

  async chooseCameraType(value) {
    if (value === "captured") return;
    if (value === "history") return;
    this.presets.historyCamera.cancel();
    try {
      if (this.motion.scene.camera_transfer) {
        const base = await this.baseMotion();
        await this.loadMotion(base, { ...defaults(), output_frame:structuredClone(this.settings.output_frame) });
      }
      this.edit(() => {
        if (this.settings.mode !== "preset") this.presets.initialize();
        if(value === "move") this.initializeBookends();
        else this.presets.change("behavior", value);
      });
      this.presets.activateTab("camera");
    } catch (error) { this.hint.textContent=error.message; }
  }

  async useCapturedCamera() {
    if(!this.capture)return;
    if(this.settings.mode!=='captured'){this.savedEdit=structuredClone(this.settings);this.node.properties.cartwheel_saved_edit=structuredClone(this.settings);}
    this.settings={...defaults(),output_frame:structuredClone(this.settings.output_frame)};
    this.sequence?.ensure();this.settingsWidget.value=JSON.stringify(this.settings);this.editingCaptured=false;this.capturedPreset=null;
    this.makePath();this.setTime(this.time);this.syncControls();
    this.node.graph?.incrementVersion?.();this.node.graph?.afterChange?.(this.node);
  }

  beginStartingEdit() {
    const duration=this.capture.duration,restore=this.time;
    const p=effectivePreset({...presetDefaults(this.capture.actors.map(a=>a.number),restore),aim_source:'live',reference_time:restore,tracking_mode:'auto',behavior:'move',movement:'fixed'});
    const times=new Set([0,duration]);
    const source=this.capture.inputCamera;
    if(source.format==='camera_json'&&!this.capture.transfer){for(const frame of source.frames)if(frame.time>0&&frame.time<duration)times.add(frame.time);}
    else if(this.capture.cameraScene?.clip&&!this.capture.transfer){for(const track of this.capture.cameraScene.clip.tracks)for(const time of track.times)if(time>0&&time<duration)times.add(time);}
    else for(let i=1;i<Math.ceil(duration*60);i++)times.add(i/60);
    const frames=[...times].sort((a,b)=>a-b).map(time=>{this.capture.setTime(time);return {time,lens_projection:this.capture.camera.userData.cartwheelInputFisheye?'fisheye_equidistant':'perspective',cut:!!source.frames?.find(f=>Math.abs(f.time-time)<1e-8)?.cut,position:this.capture.camera.position.toArray(),quaternion:this.capture.camera.quaternion.toArray(),fov:this.capture.camera.fov};});
    const stationary=frames.every(f=>f.position.every((v,i)=>Math.abs(v-frames[0].position[i])<1e-5)&&Math.abs(new THREE.Quaternion().fromArray(f.quaternion).dot(new THREE.Quaternion().fromArray(frames[0].quaternion)))>1-1e-9&&Math.abs(f.fov-frames[0].fov)<1e-5);
    if(stationary&&frames.length>2)frames.splice(1,frames.length-2);
    this.capture.setTime(restore);
    const pose=f=>({position:[...f.position],target:new THREE.Vector3(0,0,-5).applyQuaternion(new THREE.Quaternion().fromArray(f.quaternion)).add(new THREE.Vector3().fromArray(f.position)).toArray(),fov:Math.min(150,f.fov)});
    const aspect=this.capture.camera.aspect,height=aspect>=1?Math.min(24,36/aspect):Math.min(36,24/aspect);
    p.lens=this.capture.camera.userData.cartwheelInputFisheye?'fisheye':'custom';p.focal_length=THREE.MathUtils.clamp(height/(2*Math.tan(THREE.MathUtils.degToRad(frames[0].fov)/2)),10,200);p.fisheye_fov=Math.max(90,Math.min(180,frames[0].fov*Math.hypot(aspect,1)));
    this.settings={...this.settings,mode:'bookends',world_frame_id:this.motion.world_frame.id,target_actor:null,preset:p,start:pose(frames[0]),end:pose(frames.at(-1)),manual_path:{...defaultManualPath(),kind:'curve',source_frames:frames,source_static:stationary,aim:'source',framing_priority:'reference'}};
    resetCurve(this.settings);this.editingCaptured=false;this.capturedPreset=null;
    if(this.settings.camera_timeline)selectedSegment(this.settings.camera_timeline).settings=singleRecipe(this.settings);
  }

  startingStaticCamera() {
    const restore=this.time,duration=this.capture.duration,camera=this.capture.camera;
    let frame;
    try {this.capture.setTime(0);frame={position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),fov:camera.fov,lens_projection:camera.userData.cartwheelInputFisheye?'fisheye_equidistant':'perspective'};}
    finally {this.sampleTime(restore);}
    const aspect=camera.aspect,height=aspect>=1?Math.min(24,36/aspect):Math.min(36,24/aspect);
    const preset=effectivePreset({...presetDefaults(this.capture.actors.map(a=>a.number),0),behavior:'static',movement:'fixed',horizontal:'custom',custom_position:[...frame.position],reference_time:0,roll:0,lens:frame.lens_projection==='fisheye_equidistant'?'fisheye':'custom',focal_length:THREE.MathUtils.clamp(height/(2*Math.tan(THREE.MathUtils.degToRad(frame.fov)/2)),10,200),fisheye_fov:THREE.MathUtils.clamp(frame.fov*Math.hypot(aspect,1),120,180)});
    const pose={position:[...frame.position],target:new THREE.Vector3(0,0,-5).applyQuaternion(new THREE.Quaternion().fromArray(frame.quaternion)).add(new THREE.Vector3().fromArray(frame.position)).toArray(),fov:Math.min(150,frame.fov)};
    return {...defaults(),mode:'bookends',camera_index:this.settings.camera_index??0,world_frame_id:this.motion.world_frame.id,preset,output_frame:structuredClone(this.settings.output_frame),start:structuredClone(pose),end:structuredClone(pose),manual_path:{...defaultManualPath(),kind:'line',aim:'source',source_static:true,framing_priority:'reference',source_frames:[{...frame,time:0},{...structuredClone(frame),time:duration}]}};
  }

  resetCamera(wholeScene=false) {
    if(!this.capture||this.renderController)return;
    this.sequence.mutate(()=>{
      const starting=this.startingStaticCamera();
      this.sequence.freezeOffsets();
      this.settings=resetCameraSettings(this.settings,starting,this.capture.duration,this.timelineFPS,wholeScene);
      this.manualPathEditor.selected='camera_position';this.lastPreset=null;this.capturedPreset=null;this.editingCaptured=false;this.savedEdit=null;delete this.node.properties.cartwheel_saved_edit;
    });
  }

  activateAim() {
    const source=this.settings.manual_path?.aim==='source';
    if(this.settings.mode==='bookends')this.settings.manual_path.aim='shot';
    const p=this.settings.preset;if(p){p.aim_source=p.target_mode==='marker'?'reference':'live';p.tracking_mode=p.target_mode==='marker'?'exact':'auto';}
  }

  initializeBookends() {
    if (this.settings.mode === "bookends") { this.ensureManualRecipe(); return; }
    const fromCaptured=this.settings.mode==='captured';
    const poses = [0, this.capture.duration].map((time) => {
      this.capture.cameraIndex = this.settings.camera_index;
      this.capture.setTime(time);
      applyCamera(this.capture, this.settings, time, this.capture.duration);
      const target = this.capture.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(5).add(this.capture.camera.position);
      const pose = capturePose(this.capture.camera, target);
      pose.fov = THREE.MathUtils.clamp(pose.fov, 5, 150);
      return pose;
    });
    if (this.settings.mode === "preset") this.lastPreset = structuredClone(this.settings.preset);
    this.editingCaptured=false;
    const recipe = this.settings.preset ?? this.capturedPreset ?? this.lastPreset ?? presetDefaults(this.capture.actors.map(a => a.number), this.currentFrameTime());
    if(fromCaptured)for(const pose of poses)pose.fov=THREE.MathUtils.radToDeg(2*Math.atan(24/(2*35)));
    this.settings = { ...this.settings, preset: effectivePreset({ ...recipe, aim_source:recipe.aim_source==='reference'?'reference':'live', follow_strength:recipe.follow_strength??.25, tracking_mode:["auto","exact","off"].includes(recipe.tracking_mode) ? recipe.tracking_mode : "auto", framing_motion:false, behavior:"move", movement:"fixed", aim_behavior:"track" }), mode: "bookends", start: poses[0], end: poses[1],
      target_actor: null, manual_path: { ...defaultManualPath(), aim: "shot", framing_priority: "reference", reference_fov:poses[0].fov }, world_frame_id: this.motion.world_frame.id };
    const sideways=new THREE.Vector3().fromArray(this.settings.start.target).sub(new THREE.Vector3().fromArray(this.settings.start.position)).cross(new THREE.Vector3(0,1,0));
    if(sideways.lengthSq()<1e-10)sideways.set(1,0,0);sideways.normalize().multiplyScalar(3.048);
    this.settings.end.position=new THREE.Vector3().fromArray(this.settings.start.position).add(sideways).toArray();
    this.settings.end.target=[...this.settings.start.target];
    this.capturedPreset=null;
  }

  ensureManualRecipe() {
    this.settings.manual_path = { ...manualPath(this.settings), aim:this.settings.manual_path?.aim==='source'?'source':"shot", framing_priority: "reference" };
    this.settings.target_actor=null;
    this.settings.preset=effectivePreset(this.settings.preset ?? presetDefaults(this.capture.actors.map(a => a.number), this.currentFrameTime()));
    if(!["auto","exact","off"].includes(this.settings.preset.tracking_mode)) this.settings.preset.tracking_mode="auto";
  }

  edit(change) {
    if (!this.capture || !this.motion) return;
    this.setPlaying(false);
    const before = JSON.stringify(this.settings), wasManual=this.settings.mode==="bookends", lensKey=manualLensKey(this.settings);
    try {
      // Freeze the existing shot before a gizmo or numeric position edit.
      if(shotFraming(this.settings)) lockManualLens(this.capture,this.settings,this.capture.duration,this.time);
      change();
      if(shotFraming(this.settings)) {
        if(wasManual && lensKey!==manualLensKey(this.settings)) delete this.settings.manual_path.reference_fov;
        lockManualLens(this.capture,this.settings,this.capture.duration,this.time);
      }
      this.sequence?.commit(before);
      this.capture.cameraIndex = this.settings.camera_index;
      this.makePath();
      this.setTime(this.time);
      this.settingsWidget.value = JSON.stringify(this.settings);
      this.sequence?.record(before);
      this.node.graph?.incrementVersion?.();
      this.node.graph?.afterChange?.(this.node);
      this.node.graph?.setDirtyCanvas(true, true);
      this.hint.textContent = this.combined ? "Camera changed · Run to update video." : "Camera updated live. Run Control Render when you want a new VIDEO.";
    } catch (error) {
      this.settings = JSON.parse(before);
      this.capture.cameraIndex = this.settings.camera_index;
      this.makePath();
      this.setTime(this.time);
      this.hint.textContent = error.message;
    }
    this.syncControls();
  }

  syncControls() {
    const ready = Boolean(this.capture);
    if(this.saveButton)this.saveButton.disabled=!ready||this.savingCamera;
    const editing = this.settings.mode === "bookends";
    const output = { ...DEFAULT_OUTPUT_FRAME, ...this.settings.output_frame };
    this.orientation.value = output.orientation; this.orientation.disabled = !ready;
    const ratios = output.orientation === "original" ? { source: "From input" }
      : Object.fromEntries(Object.keys(RATIOS).map(ratio => [ratio, output.orientation === "portrait" ? ratio.split(":").reverse().join(":") : ratio]));
    this.aspectRatio.replaceChildren(...Object.entries(ratios).map(([value, text]) => { const option = document.createElement("option"); option.value = value; option.textContent = text; return option; }));
    this.aspectRatio.value = output.orientation === "original" ? "source" : output.ratio;
    this.aspectRatio.disabled = !ready || output.orientation === "original";
    this.aspectRatio.title = "The preview and exported VIDEO use this ratio. Preset shots refit to the new frame.";
    this.openPresets.hidden = false;
    this.openPresets.classList.toggle("active",this.settings.mode!=="captured");
    const sourceLabel = this.motion?.scene.camera.format === 'default' ? 'Default camera' : this.capture?.transfer || this.motion?.scene.camera.format === 'camera_json' ? 'Imported camera' : 'Input camera';
    this.element.querySelector('.cw-source-status').textContent = ['captured','history'].includes(this.settings.mode) ? sourceLabel : 'Edited camera';
    this.element.querySelector('.cw-reset-camera').textContent = 'Starting camera';
    this.openPresets.textContent='Edit camera';
    this.editor.querySelector(".cw-endpoints").hidden = true;
    this.cameraSelect.value = String(this.settings.camera_index);
    this.editor.querySelectorAll("button").forEach((button) => button.disabled = !ready && !button.classList.contains("cw-reset-camera"));
    this.element.querySelector(".cw-camera-label").textContent = ["captured","history"].includes(this.settings.mode) ? sourceLabel : "Edited camera";
    this.sequence?.sync();
    this.instructions?.sync();
    this.manualPathEditor?.sync();
    this.presets?.sync();
    if (this.capture) this.render();
  }

  async loadMotion(motion, serverSettings, serverNotice) {
    if(this.instructions){this.instructions.abort?.abort();this.instructions.completionKey=null;this.instructions.prepared=null;}
    if (this.presets.historyCamera.busy && serverSettings?.mode !== "history") this.presets.historyCamera.cancel();
    this.choosingHistory=false;
    const previousMotion = this.motion;
    const transition = settingsForMotion(this.settingsWidget.value || { ...defaults(), camera_index: this.node.widgets.find((widget) => widget.name === "render_camera")?.value || 0 }, motion);
    if (transition.changed || (previousMotion && previousMotion.world_frame.id !== motion.world_frame.id)) { this.lastPreset = null; this.editingCaptured=false; this.capturedPreset=null; }
    if(previousMotion&&previousMotion.world_frame.id!==motion.world_frame.id){this.savedEdit=null;delete this.node.properties.cartwheel_saved_edit;}
    this.motion = motion;
    this.settings = structuredClone(serverSettings ?? transition.settings);
    const newScene=!previousMotion||previousMotion.world_frame.id!==motion.world_frame.id;
    if(newScene&&motion.saved_editor_settings)this.settings=structuredClone(motion.saved_editor_settings);
    if (this.settings.mode === "history") {
      this.settings = {...defaults(), output_frame:this.settings.output_frame};
      serverNotice ||= "Camera history is now a source. Connect a History camera output to the optional camera input.";
    }
    this.editingCaptured=false; this.capturedPreset=null;
    const loaded = await super.load(motion.scene);
    if (!loaded) return;
    this.capture.duration = motion.timeline.duration;
    this.slider.max = String(Math.max(1, this.timeline.count));
    if (this.settings.mode === "bookends") this.ensureManualRecipe();
    if(this.settings.preset) { this.settings.preset=effectivePreset(this.settings.preset); if(this.settings.preset.tracking_mode === 'legacy') this.settings.preset.tracking_mode='auto'; if(this.settings.preset.focus_point==='eyes')this.settings.preset.focus_point='auto'; nearestFramingReference(this.settings.preset); }
    this.snapReferenceToFrame();
    migrateHeldAim(this);
    if(this.settings.mode==='preset' && this.settings.preset.horizontal!=='custom' && this.settings.preset.position_offset.some(v=>v!==0)) {
      const plan=presetPlan(this.capture,this.settings,this.capture.duration,0);
      Object.assign(this.settings.preset,{horizontal:'custom',custom_position:plan.positions[plan.referenceIndex].toArray(),position_offset:[0,0,0]});
    }
    if(shotFraming(this.settings)) lockManualLens(this.capture,this.settings,this.capture.duration,0);
    if (this.settingsWidget.value !== JSON.stringify(this.settings)) {
      this.settingsWidget.value = JSON.stringify(this.settings);
      this.node.graph?.incrementVersion?.(); this.node.graph?.afterChange?.(this.node);
    }
    if(this.settings.mode==='captured'&&!this.restoringInput&&!this.renderingRequest)this.beginStartingEdit();
    this.sequence?.ensure();
    if(newScene)this.sequence?.resetHistory();
    this.settingsWidget.value=JSON.stringify(this.settings);
    this.makePath();
    this.setTime(0);
    this.syncControls();
    if (this.settings.mode === "bookends") this.presets.activateTab("camera");
    this.node.properties.cartwheel_motion = motion;
    this.hint.textContent = serverNotice || transition.notice || (this.settings.mode === "preset" ? "Camera ready."
      : this.settings.mode === "bookends" ? "Camera ready."
      : this.settings.mode === "history" ? "Camera from history restored. Run to update VIDEO." : "Camera ready.");
  }

  snapReferenceToFrame() {
    if (!["preset","bookends"].includes(this.settings.mode) || !this.settings.preset || !this.capture) return;
    const p = this.settings.preset, before = p.reference_time ?? 0;
    const aligned = this.referenceTime(before);
    if (Math.abs(before - aligned) > 1e-9) {
      p.reference_time = aligned;
      return true;
    }
    return false;
  }

  frameRateChanged() {
    if(this.settings?.camera_timeline&&this.settings.camera_timeline.fps!==this.timelineFPS){
      const before=JSON.stringify(this.settings),old=this.settings.camera_timeline.fps;
      try{regridTimeline(this.settings.camera_timeline,this.timelineFPS);this.sequence?.record(before);this.settingsWidget.value=JSON.stringify(this.settings);}
      catch(error){if(this.fpsWidget)this.fpsWidget.value=String(old);this.hint.textContent=error.message;return;}
    }
    super.frameRateChanged();
    if (this.capture && this.motion) this.edit(() => this.snapReferenceToFrame());
  }

  async prepareSavedScene(scene) {
    this.hint.textContent = "Restoring saved camera controls…";
    this.prepareController?.abort();
    const controller = this.prepareController = new AbortController();
    try {
      const response = await api.fetchApi("/cartwheel/camera/prepare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scene }), signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The saved camera could not be loaded.");
      if (!controller.signal.aborted) await this.loadMotion(result.motion);
    } catch (error) { if (error.name !== "AbortError") this.hint.textContent = error.message; }
  }

  async renderVideo(request) {
    if (request.motion && (!this.capture || JSON.stringify(this.motion) !== JSON.stringify(request.motion))) {
      this.renderingRequest=true;
      try{await this.loadMotion(request.motion, request.camera?.settings);}finally{this.renderingRequest=false;}
    }
    try{return await super.renderVideo(request);}finally{this.instructions?.sync();if(this.capture&&this.settings.mode==='captured'){this.beginStartingEdit();this.settingsWidget.value=JSON.stringify(this.settings);this.makePath();this.setTime(this.time);this.syncControls();}}
  }

  dispose() { this.presets?.priority?.dispose(); this.instructions?.dispose(); this.sequence?.dispose(); this.presets.historyCamera.dispose(); this.prepareController?.abort(); this.manualPathEditor?.dispose(); super.dispose(); }

  setTime(seconds){super.setTime(seconds);this.sequence?.playhead();}

  sampleTime(seconds) {
    this.capture.cameraIndex = this.settings.camera_index;
    this.capture.setTime(seconds);
    applyCamera(this.capture, this.settings, seconds, this.motion?.timeline.duration ?? this.capture.duration);
  }

  samplePath() { return cameraPath(this.capture, this.settings, this.motion?.timeline.duration ?? this.capture.duration); }

  makePath(full=false) {
    if(this.settings?.camera_timeline&&this.sequence&&this.capture){
      const interactive=!full&&(this.manualPathEditor?.gizmo?.dragging||this.sequence.gesture);
      if(interactive&&this.path?.isGroup){const t=this.settings.camera_timeline,s=selectedSegment(t),plan=sequencePlan(this.capture,t,this.capture.duration,applySingleCamera),points=[];for(let j=0;j<=8;j++)points.push(plan.position(s,s.start+(s.end-s.start)*j/8));const line=this.path.children[t.segments.indexOf(s)];if(line){line.geometry.dispose();line.geometry=new THREE.BufferGeometry().setFromPoints(points);}return;}
      if(this.path){this.scene.remove(this.path);if(this.path.isGroup)this.path.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});else{this.path.geometry?.dispose();this.path.material?.dispose();}}
      this.path=new THREE.Group();const t=this.settings.camera_timeline,plan=sequencePlan(this.capture,t,this.capture.duration,applySingleCamera);
      for(const [i,s] of t.segments.entries()){
        const points=[],steps=Math.max(2,Math.min(128,Math.ceil((s.end-s.start)*12)));
        for(let j=0;j<=steps;j++){const time=s.start+(s.end-s.start)*j/steps;const next=t.segments[i+1],join=next&&t.joins.find(x=>x.left===s.id&&x.right===next.id);const hardEnd=j===steps&&next&&Math.abs(s.end-next.start)<1e-7&&(!join?.connected||!join.smooth||!join.frames);points.push(hardEnd?plan.sample(s,time).position:sequencePose(this.capture,t,time,this.capture.duration,applySingleCamera,plan).position);}
        const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:CAMERA_COLORS[i%CAMERA_COLORS.length],transparent:true,opacity:s.id===t.selected_id?1:.45}));this.path.add(line);
      }
      this.scene.add(this.path);this.status.textContent=`${t.segments.length} camera${t.segments.length===1?'':'s'} · ${selectedSegment(t).name} selected`;
      return;
    }
    if(this.path?.isGroup){this.scene.remove(this.path);this.path.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});this.path=null;}
    super.makePath();
    this.status.textContent = this.settings.mode === "preset" ? ({ static: "Static camera", move: "Camera move", follow: "Follow subjects" }[cameraBehavior(this.settings)]) : this.settings.mode === "bookends" ? "Manual path" : this.capture?.transfer ? `Imported camera · Source actor ${this.capture.transfer.source_actor.actor} → Actor ${this.capture.transfer.reference_actor}` : "Captured camera";
  }
}

function hide(widget) { widget.hidden = true; widget.type = "hidden"; widget.computeSize = () => [0, -4]; }
function videoURL(video) { return api.apiURL(`/view?${new URLSearchParams({ filename: video.filename, subfolder: video.subfolder, type: video.type })}`); }

app.registerExtension({
  name: "Cartwheel.CameraEditor",
  setup() {
    api.addEventListener("cartwheel.render", (event) => renderers.get(event.detail.view_id)?.renderVideo(event.detail));
    for (const type of ["execution_interrupted", "execution_error"]) api.addEventListener(type, () => {
      for (const renderer of renderers.values()) renderer.renderController?.abort();
    });
  },
  nodeCreated(node) {
    const type = node.comfyClass ?? node.type;
    if (type === "CartwheelCamera" || type === "CartwheelCameraPreview") {
      let editor;try{editor=new CameraEditor(node);}catch(error){console.error('Camera editor initialization',error.stack);throw error;}
      hide(editor.settingsWidget);
      const editorWidget = node.addDOMWidget("camera_editor", "cartwheel_camera_editor", editor.element, { serialize: false, getMinHeight: () => 1460, getHeight: () => 1560 });
      // The properties panel's legacy widget renderer writes its own width onto
      // this shared widget. Keep the viewport tied to its actual canvas node.
      Object.defineProperty(editorWidget, "width", {
        configurable: true,
        get: () => node.width ?? node.size[0],
        set: () => {},
      });
      const resize = () => node.setSize([Math.max(node.size[0], 1560), Math.max(node.size[1], 1700)]);
      resize();
      const view = node.widgets.find((widget) => widget.name === "render_view");
      const cameraIndex = node.widgets.find((widget) => widget.name === "render_camera");
      // Keep legacy clip selection serialized without exposing an irrelevant
      // control: current motion sources already select the clip upstream.
      const motionIndex = node.widgets.find((widget) => widget.name === "motion_index");
      const register = () => {
        if (!view) return;
        if (view.value) renderers.delete(view.value);
        view.value = crypto.randomUUID();
        renderers.set(view.value, editor);
        node.graph?.incrementVersion?.();
      };
      if (view) hide(view);
      if (cameraIndex) hide(cameraIndex);
      if (motionIndex && type === "CartwheelCameraPreview") hide(motionIndex);
      const oldFrameToggle=node.widgets?.find(w=>w.name==='auto_frame_images');if(oldFrameToggle)hide(oldFrameToggle);
      register();
      const executed = node.onExecuted;
      node.onExecuted = function (message) {
        executed?.apply(this, arguments);
        const saved=message.cartwheel_saved_job?.[0];
        if(saved){editor.lastSavedJob=saved;window.dispatchEvent(new CustomEvent('cartwheel-camera-saved',{detail:{nodeId:node.id,saved,artifacts:message.cartwheel_render_artifacts?.[0]}}));}
        const artifacts=message.cartwheel_render_artifacts?.[0];
        if(artifacts?.pose_warning)editor.hint.textContent=artifacts.pose_warning;
        const motion = message.cartwheel_motion?.[0];
        if (motion && (JSON.stringify(this.properties.cartwheel_motion) !== JSON.stringify(motion) || !editor.capture)) editor.loadMotion(motion, message.cartwheel_camera?.[0]?.settings, message.cartwheel_camera_notice?.[0]);

      };
      const configured = node.onConfigure;
      node.onConfigure = function () {
        configured?.apply(this, arguments);
        if(editor.saveName)editor.saveName.value=this.properties.cartwheel_camera_name??'';
        for (let i=(this.inputs?.length ?? 0)-1;i>=0;i--) {
          if (["camera_source","camera_source_actor","camera_reference_actor","camera_timing","camera_source_motion_index"].includes(this.inputs[i].name)) this.removeInput(i);
        }
        const oldInput = this.inputs?.find(input => input.name === "capture");
        if (oldInput) { oldInput.name = "motion"; oldInput.label = "motion"; }
        if (!this.inputs?.some(input => input.name === "camera")) this.addInput("camera", "CARTWHEEL_CAMERA");
        const frameToggle=this.widgets?.find(widget=>widget.name==='auto_frame_images');
        if(frameToggle && typeof frameToggle.value!=='boolean')frameToggle.value=frameToggle.value===1 || frameToggle.value==='true';
        if(type==='CartwheelCameraPreview')for(const [name,kind] of [['camera','CARTWHEEL_CAMERA'],['camera_json','STRING'],['camera_file','STRING'],['first_frame','IMAGE'],['last_frame','IMAGE'],['depth','VIDEO'],['normal','VIDEO'],['pose','VIDEO'],['use_frame_images','BOOLEAN']])if(!this.outputs?.some(o=>o.name===name))this.addOutput(name,kind);
        resize();
        register();
        const savedScene = this.properties.cartwheel_motion?.scene ?? this.properties.cartwheel_scene;
        if (savedScene) editor.prepareSavedScene(savedScene);
      };
      const removed = node.onRemoved;
      node.onRemoved = function () { if (view) renderers.delete(view.value); editor.dispose(); return removed?.apply(this, arguments); };
    } else if (type === "CartwheelControlRender") {
      const worker = new CameraPreview(node);
      const view = node.widgets.find((widget) => widget.name === "render_view");
      hide(view);
      const panel = document.createElement("div");
      panel.className = "cw-render-panel";
      worker.status.textContent = "Connect motion and camera from Cartwheel Camera, then run to render VIDEO.";
      panel.append(worker.status);
      node.addDOMWidget("render_status", "cartwheel_render_status", panel, { serialize: false, getMinHeight: () => 65, getHeight: () => 85 });
      node.setSize([430, 240]);
      const register = () => { if (view.value) renderers.delete(view.value); view.value = crypto.randomUUID(); renderers.set(view.value, worker); };
      register();
      const configured = node.onConfigure;
      node.onConfigure = function () { configured?.apply(this, arguments); register(); };
      const executed = node.onExecuted;
      node.onExecuted = function (message) {
        executed?.apply(this, arguments);

      };
      const removed = node.onRemoved;
      node.onRemoved = function () { renderers.delete(view.value); worker.dispose(); return removed?.apply(this, arguments); };
    }
  },
});
