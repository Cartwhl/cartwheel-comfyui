import {focusInspection} from './scene_focus.js';
import * as THREE from "./vendor/build/three.module.js";
import { TransformControls } from "./vendor/examples/jsm/controls/TransformControls.js";
import { manualPath, resetCurve, markerPosition, moveMarker, shotFraming, addPathPoint, removePathPoint, MAX_PATH_POINTS, displayMarkerPosition, moveDisplayMarker, handleAnchor } from "./manual_path.js?v=20261028-curved-camera-paths";

import { presetPlan } from "./camera_presets.js";

import {setCameraPosition} from "./camera_position.js?v=20261028-curved-camera-paths";
import {isAimMarker} from './aim_marker.js?v=20261028-delivery';
import { positiveTranslateAxes } from "./positive_axes.js";

let activeEditor=null;
const POINT_HANDLES=Object.fromEntries(Array.from({length:5},(_,i)=>[[`point${i}_in`,`Point ${i+1} · incoming`],[`point${i}_out`,`Point ${i+1} · outgoing`]]).flat());
const MARKERS = { ...POINT_HANDLES, ...Object.fromEntries(Array.from({length:5},(_,i)=>[`point${i}`,`Point ${i+1}`])), aim_start_marker:'Start aim marker',aim_end_marker:'End aim marker',aim_marker:'Aim marker', camera_position:"Camera", start_position: "Start", end_position: "End", handle1: "Curve handle 1", handle2: "Curve handle 2" };
const COLORS = { ...Object.fromEntries(Object.keys(POINT_HANDLES).map(id=>[id,0xdec2ff])), ...Object.fromEntries(Array.from({length:5},(_,i)=>[`point${i}`,0xffe69c])), aim_start_marker:0x000000,aim_end_marker:0x000000,aim_marker:0x000000, camera_position:0x7bf5ac, start_position: 0x7bf5ac, end_position: 0xffb66b, handle1: 0xdec2ff, handle2: 0xdec2ff };

export function selectionAfterClick(id,selected,last,ids){
  if(!id?.startsWith('aim_')||id!==selected)return id;
  const owner=last==='handle1'?'start_position':last==='handle2'?'end_position':last?.replace(/_(in|out)$/,'');
  return ids.includes(owner)?last:ids.find(id=>id!=='aim_marker')??'aim_marker';
}
export class ManualPathEditor {
  constructor(editor) {
    this.editor = editor; this.selected = "start_position";
    this.panel = document.createElement("div"); this.panel.className = "cw-manual-path";
    this.panel.innerHTML = `<h3 class="cw-camera-section-title">Path</h3><div class="cw-manual-path-fields cw-preset-grid"><label class="cw-preset-field cw-inline-toggle"><span>Curved path</span><input type="checkbox" aria-label="Curved path"></label><label class="cw-preset-field cw-inline-toggle"><span>Ease in / out</span><input type="checkbox" aria-label="Ease in / out"></label></div><div class="cw-manual-actions"><button class="cw-add-point">Add point</button><button class="cw-remove-point">Remove point</button><span class="cw-point-count"></span><label><input type="checkbox" class="cw-show-handles" checked> Show path controls</label></div>`;
    this.smoothToggle=document.createElement('input');this.smoothToggle.type='checkbox';this.smoothToggle.setAttribute('aria-label','Smooth joins');
    const smoothLabel=document.createElement('label');smoothLabel.append(this.smoothToggle,' Smooth joins');this.panel.querySelector('.cw-manual-actions').append(smoothLabel);
    this.smoothToggle.onchange=()=>editor.edit(()=>{editor.settings.manual_path.smooth_handles=this.smoothToggle.checked;});
    this.shapeToggle=this.panel.querySelector('[aria-label="Curved path"]');
    this.pacingToggle=this.panel.querySelector('[aria-label="Ease in / out"]');
    this.panel.querySelector('.cw-manual-actions').prepend(...this.panel.querySelector('.cw-manual-path-fields').children);
    this.framingStatus=document.createElement('p');this.framingStatus.setAttribute('role','status');this.panel.append(this.framingStatus);
    this.refit=document.createElement('button');this.refit.textContent='Refit saved shot';this.refit.onclick=()=>editor.edit(()=>{delete editor.settings.manual_path.reference_fov;});this.panel.append(this.refit);

    this.shapeToggle.onchange=()=>{const curved=this.shapeToggle.checked;editor.edit(()=>{editor.settings.manual_path={...manualPath(editor.settings),kind:curved?'curve':'line'};if(!curved){delete editor.settings.manual_path.source_frames;delete editor.settings.manual_path.source_static;editor.activateAim();}if(curved&&!editor.settings.manual_path.controls)resetCurve(editor.settings);});};
    this.pacingToggle.onchange=()=>{const smooth=this.pacingToggle.checked;editor.edit(()=>{editor.settings.manual_path={...manualPath(editor.settings),pacing:smooth?'smooth':'linear'};});};
    this.panel.querySelector('.cw-add-point').onclick=()=>editor.edit(()=>{addPathPoint(editor.settings);this.selected=`point${editor.settings.manual_path.points.length-1}`;});
    this.panel.querySelector('.cw-remove-point').onclick=()=>editor.edit(()=>{const match=/^point(\d+)/.exec(this.selected);if(match)removePathPoint(editor.settings,Number(match[1]));this.selected='start_position';});
    this.showHandles=this.panel.querySelector('.cw-show-handles');
    this.showHandles.onchange=()=>editor.render();
    this.overlay = document.createElement('div'); this.overlay.className = 'cw-path-overlay'; editor.viewport.append(this.overlay);
    this.nav = document.createElement('div'); this.nav.className = 'cw-scene-navigation'; this.nav.setAttribute('aria-label','Scene navigation');
    this.nav.innerHTML = `<select aria-label="Scene inspection view"><option value="">Scene view…</option><option value="perspective">Perspective</option><option value="top">Top · XZ</option><option value="front">Front · XY</option><option value="side">Side · YZ</option></select><button>Frame path</button>`;
    editor.viewport.append(this.nav);
    this.nav.querySelector('select').onchange = event => { this.navigate(event.target.value); event.target.value = ''; };
    this.nav.querySelector('button').onclick = () => this.navigate('perspective');
    this.panel.hidden = this.nav.hidden = true;
    editor.orbitInput.tabIndex=0;editor.orbitInput.setAttribute('aria-label','Scene navigation · F focuses selected control');
    this.activateKeyboard=()=>{activeEditor=this;};
    editor.viewport.addEventListener('pointerenter',this.activateKeyboard);
    editor.viewport.addEventListener('pointerdown',this.activateKeyboard,true);
    this.focusKey=event=>{
      if(activeEditor!==this||event.key.toLowerCase()!=='f'||event.ctrlKey||event.metaKey||event.altKey||editor.renderController||!editor.element.isConnected)return;
      if(!editor.element.matches(':hover')&&!editor.element.contains(document.activeElement)&&!editor.node.is_selected)return;
      if(event.target?.closest?.('input,textarea,select,[contenteditable="true"]'))return;
      event.preventDefault();event.stopImmediatePropagation();this.focusSelected();
    };
    window.addEventListener('keydown',this.focusKey,true);

  }

  initialize() {
    if (this.root || !this.editor.scene) return;
    const e = this.editor;
    this.root = new THREE.Group(); this.root.name = 'Manual path controls · scene only'; e.scene.add(this.root);
    this.gizmo = new TransformControls(e.overviewCamera, e.orbitInput);
    positiveTranslateAxes(this.gizmo);
    this.gizmo.setMode('translate'); this.gizmo.setSpace('world'); this.gizmo.setSize(0.65);
    for (const axis of ['X','Y','Z']) { this.gizmo[`min${axis}`] = -100000; this.gizmo[`max${axis}`] = 100000; }
    this.root.add(this.gizmo.getHelper());
    this.markers = new Map(); this.buttons = new Map();
    for (const [id, title] of Object.entries(MARKERS)) {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: COLORS[id], depthTest: false }));
      mesh.renderOrder = 900; mesh.userData.marker = id; this.root.add(mesh); this.markers.set(id, mesh);
      const button = document.createElement('button'); button.textContent = title; button.title = `Select ${title.toLowerCase()} marker`; button.setAttribute('aria-label',`Select ${title} marker`);
      button.onclick = () => this.select(id); this.overlay.append(button); this.buttons.set(id, button);
    }
    this.handleLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0xd3b9ff, dashSize: 0.08, gapSize: 0.05, depthTest: false }));
    this.handleLines.renderOrder = 899; this.root.add(this.handleLines);
    this.gizmo.addEventListener('dragging-changed', event => {
      e.sceneInteractionLocked = event.value; e.controls.enabled = !event.value;
      if (event.value) e.setPlaying(false);
      else { this.flushDrag?.();e.makePath(true);e.setTime(e.time);this.sync();e.render(); }
    });
    this.flushDrag=()=>{if(this.dragFrame!==undefined){cancelAnimationFrame(this.dragFrame);this.dragFrame=undefined;}const position=this.pendingPosition;if(!position)return;this.pendingPosition=null;
      if(e.renderController)return;
      e.edit(() => {
        if(this.selected.startsWith('aim_')){e.activateAim();if(this.selected==='aim_marker')e.settings.preset.custom_target=[...position];else e.settings.preset.camera_transition[this.selected==='aim_start_marker'?'start':'end'].custom_target=[...position];}
        else if(this.placing()) {
          setCameraPosition(e,position);
        } else {e.activateAim();moveDisplayMarker(e.settings, this.selected, e.sequence?.timeline?e.sequence.recipePosition(this.selected,position):position);}
      });
    };
    this.gizmo.addEventListener('objectChange',()=>{if(!this.gizmo.dragging||e.renderController)return;this.pendingPosition=this.gizmo.object.position.toArray();if(this.dragFrame===undefined)this.dragFrame=requestAnimationFrame(()=>this.flushDrag());});
    // This capture listener runs before OrbitControls, preventing camera orbit on a gizmo drag.
    this.pointerDown = event => {
      if (!this.active() || event.button !== 0) return;
      e.orbitInput.focus({preventScroll:true});
      const rect = e.orbitInput.getBoundingClientRect();
      const pointer = { x: (event.clientX - rect.left) / rect.width * 2 - 1, y: -(event.clientY - rect.top) / rect.height * 2 + 1, button: 0 };
      const ray=new THREE.Raycaster();ray.setFromCamera(pointer,e.overviewCamera);
      const hit=ray.intersectObjects([...this.markers.values()].filter(mesh=>mesh.visible))[0];
      if(hit){
        const id=hit.object.userData.marker;
        if(id!==this.selected||id.startsWith('aim_')){
          event.stopImmediatePropagation();this.select(selectionAfterClick(id,this.selected,this.lastCameraMarker,this.ids()));return;
        }
      }
      this.gizmo.pointerHover(pointer);
      if(this.gizmo.axis){e.controls.enabled=false;return;}

    };
    e.orbitInput.addEventListener('pointerdown', this.pointerDown, true);
    this.gizmo.addEventListener('change', () => { if (!this.syncing&&!this.gizmo.dragging) e.render(); });
  }

  placing() { return this.editor.settings.mode==='preset' && this.editor.settings.preset.horizontal==='custom' || !!this.editor.settings.manual_path?.source_static; }
  position(id) { if(id==='aim_marker')return this.editor.settings.preset.custom_target;if(id==='aim_start_marker'||id==='aim_end_marker')return this.editor.settings.preset.camera_transition[id==='aim_start_marker'?'start':'end'].custom_target;const p=id==='camera_position'?this.referencePosition:displayMarkerPosition(this.editor.settings,id);return this.editor.sequence?.timeline?this.editor.sequence.displayPosition(id,p):p; }
  transitionMarkers(){const t=this.editor.settings.preset?.camera_transition;return t?.enabled&&t.fields?.includes('target')?['start','end'].filter(side=>t[side].target_mode==='marker').map(side=>`aim_${side}_marker`):[];}

  active() { return !this.editor.renderController && (this.placing() || this.transitionMarkers().length>0 || this.editor.settings.mode === 'bookends' && this.showHandles.checked || isAimMarker(this.editor.settings.preset)&&['preset','bookends'].includes(this.editor.settings.mode)); }

  ids() {
    const marker=[...(isAimMarker(this.editor.settings.preset)?['aim_marker']:[]),...this.transitionMarkers()];
    if(this.placing()) return ['camera_position',...marker];
    if (this.editor.settings.mode !== 'bookends'||!this.showHandles.checked) return marker;
    const s = this.editor.settings, p = manualPath(s);
    const anchors=['start_position','end_position',...(p.kind==='curve'?(p.points??[]).map((_,i)=>`point${i}`):[])];
    if(p.kind!=='curve')return [...anchors,...marker];
    const requested=this.selected==='handle1'?'start_position':this.selected==='handle2'?'end_position':this.selected.replace(/_(in|out)$/,'');
    const owner=anchors.includes(requested)?requested:'start_position';
    const handles=owner==='start_position'?['handle1']:owner==='end_position'?['handle2']:/^point\d+$/.test(owner)?[`${owner}_in`,`${owner}_out`]:[];
    return [...anchors,...handles,...marker];
  }

  select(id) {
    if(!id.startsWith('aim_'))this.lastCameraMarker=id;
    this.selected = id; this.editor.setPlaying(false); this.sync();
    if (id.startsWith('start_')) this.editor.setTime(this.editor.sequence?.selected?.start??0);
    else if (id.startsWith('end_')) this.editor.setTime(this.editor.sequence?.selected?.end??this.editor.capture.duration);
    else this.editor.render();
    this.editor.presets?.priority?.sync();
  }

  sync() {
    const e = this.editor, placing=this.placing(), active = (e.settings.mode === 'bookends'||placing||isAimMarker(e.settings.preset)&&e.settings.mode==='preset'||this.transitionMarkers().length>0) && Boolean(e.capture);
    this.panel.hidden = !active||placing;
    if (!active) { if(this.gizmo) { this.syncing = true; this.gizmo.detach(); this.root.visible = false; this.syncing = false; } this.overlay.hidden = this.nav.hidden = true; return; }
    this.initialize(); this.syncing = true;
    const p = manualPath(e.settings), ids = this.ids();
    if(placing) {
      if(e.settings.mode==='bookends')this.referencePosition=e.settings.start.position;
      else {const plan=presetPlan(e.capture,e.settings,e.capture.duration,e.time);this.referencePosition=plan.anchorPosition.toArray();}
    }
    if (!ids.includes(this.selected)) this.selected = ids[0];
    this.panel.querySelector('.cw-manual-path-fields').hidden=placing;
    this.panel.querySelector('.cw-manual-actions').hidden=placing;
    this.panel.querySelector('h3').hidden=placing;
    this.nav.querySelector('button').textContent=placing?'Frame camera':'Frame path';
    this.panel.querySelector('.cw-point-count').textContent = `${p.points?.length ?? 0} / ${MAX_PATH_POINTS} points`;
    this.panel.querySelector('.cw-add-point').disabled = (p.points?.length ?? 0) >= MAX_PATH_POINTS;
    this.panel.querySelector('.cw-remove-point').hidden=false;
    this.panel.querySelector('.cw-remove-point').disabled=!/^point\d+/.test(this.selected)||p.kind!=='curve';
    this.smoothToggle.checked=!!p.smooth_handles;this.smoothToggle.closest('label').hidden=p.kind!=='curve'||!(p.points?.length);
    this.shapeToggle.checked=p.kind==='curve';this.pacingToggle.checked=p.pacing==='smooth';

    for (const [id, mesh] of this.markers) {
      mesh.visible = ids.includes(id); const point = mesh.visible?this.position(id):null; if(point) mesh.position.fromArray(point);
    }
    if (this.gizmo.object !== this.markers.get(this.selected)) this.gizmo.attach(this.markers.get(this.selected));
    const positions=!placing&&p.kind==='curve'?ids.filter(id=>handleAnchor(e.settings,id)).flatMap(id=>[...handleAnchor(e.settings,id),...this.position(id)]):[];
    this.handleLines.geometry.dispose(); this.handleLines.geometry = new THREE.BufferGeometry(); this.handleLines.geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3)); this.handleLines.computeLineDistances();
    this.syncing = false;
  }

  sceneVisibility(visible, sceneWidth, height) {
    const info = this.editor.capture?.camera.userData.cartwheelManualFraming;
    this.framingStatus.hidden = !shotFraming(this.editor.settings)||!info?.limited;
    this.refit.hidden = !shotFraming(this.editor.settings)||this.editor.settings.preset?.lens_calibration==='full_frame';
    this.framingStatus.textContent=info?.limited?'This camera position cannot fit the selected framing.':'';
    const show = visible && this.active();
    this.overlay.hidden = this.nav.hidden = !show;
    if (!this.root) return;
    this.root.visible = show;
    const syncing = this.syncing; this.syncing = true; this.gizmo.enabled = show; this.syncing = syncing;
    if (!show) return;
    this.overlay.style.width = `${sceneWidth}px`;
    this.nav.style.right = `${this.editor.viewport.clientWidth - sceneWidth + 8}px`;
    const e = this.editor, c = e.overviewCamera;
    for (const [id, mesh] of this.markers) {
      const depth = mesh.position.clone().sub(c.position).dot(c.getWorldDirection(new THREE.Vector3()));
      mesh.scale.setScalar(Math.max(0.002, depth * Math.tan(THREE.MathUtils.degToRad(c.fov / 2)) * 12 / height));
      const point = mesh.position.clone().project(c), button = this.buttons.get(id);
      button.hidden = id.startsWith('aim_') || Boolean(handleAnchor(e.settings,id)) || id === this.selected || !mesh.visible || point.z < -1 || point.z > 1 || Math.abs(point.x) > 1 || Math.abs(point.y) > 1;
      button.classList.toggle('active',id === this.selected);
      button.style.left = `${(point.x + 1) * sceneWidth / 2}px`; button.style.top = `${(1 - point.y) * height / 2 - 14}px`;
    }
    this.root.updateMatrixWorld(true);
  }

  focusSelected(){
    if(!this.editor.capture)return;
    this.sync();const id=this.ids().includes(this.selected)?this.selected:null;
    this.nav.querySelector('button').title=`Focused ${MARKERS[id]??'camera'} · F`;
    focusInspection(this.editor,id?this.position(id):this.editor.capture.camera.position.toArray());
  }

  navigate(view) {
    if (!this.editor.capture || !this.active() || !view) return;
    const e = this.editor, bounds = new THREE.Box3();
    for (const id of this.ids()) bounds.expandByPoint(new THREE.Vector3().fromArray(this.position(id)));
    for (const actor of e.capture.actors) bounds.expandByObject(actor.root);
    const center = bounds.getCenter(new THREE.Vector3());
    const sceneWidth = e.mode === 'split' ? e.viewport.clientWidth / 2 : e.viewport.clientWidth;
    const aspect = Math.max(0.1,sceneWidth / e.viewport.clientHeight), fov = THREE.MathUtils.degToRad(e.overviewCamera.fov / 2);
    const distance = Math.max(1,bounds.getSize(new THREE.Vector3()).length()) / (2 * Math.tan(fov) * Math.min(1,aspect)) * 1.25;
    const direction = { top: [0,1,0.00001], front: [0,0,1], side: [1,0,0], perspective: [0.8,0.6,1] }[view];
    if(!direction) return;
    e.controls.target.copy(center); e.overviewCamera.position.copy(center).add(new THREE.Vector3(...direction).normalize().multiplyScalar(distance));
    e.overviewCamera.far = Math.max(1000,distance * 10); e.overviewCamera.updateProjectionMatrix(); e.controls.update(); e.render();
  }

  dispose() {
    if(this.dragFrame!==undefined)cancelAnimationFrame(this.dragFrame);
    window.removeEventListener('keydown',this.focusKey,true);
    this.editor.viewport.removeEventListener('pointerenter',this.activateKeyboard);
    this.editor.viewport.removeEventListener('pointerdown',this.activateKeyboard,true);
    if(activeEditor===this)activeEditor=null;
    if (this.pointerDown) this.editor.orbitInput.removeEventListener('pointerdown',this.pointerDown,true);
    if (this.gizmo) { this.syncing = true; this.gizmo.detach(); this.gizmo.dispose(); }
    this.root?.removeFromParent();
    this.root?.traverse(object => { object.geometry?.dispose(); if(Array.isArray(object.material)) object.material.forEach(m=>m.dispose()); else object.material?.dispose(); });
    this.overlay.remove(); this.nav.remove();
  }
}
