import {bindSliderDrag,syncSliderValue} from './slider_interaction.js?v=20261029-position-drag-r2';
import {chooseAimMarker} from './target_controls.js?v=20261028-curved-camera-paths';
import { FOCUS_POINTS, FRAME_REFERENCES, DETAIL_SHOTS, FOCUS_FILL, hasFocus } from "./camera_composition.js";
import { timeAtFrame } from "./frame_timeline.js";
import {
  CHOICES,
  AZIMUTH,
  presetDefaults,
  effectivePreset,
  fixedBearing,
  subjectTravel,
  presetPlan,
  focusWarnings,
} from "./camera_presets.js";
import {
  subjectSelection,
  cameraBehavior,
  selectSubjects,
  selectBehavior,
  selectShot,
  restoreShotFraming,
  nearestFramingReference,
} from "./shot_controls.js?v=20261028-delivery";

import * as THREE from "./vendor/build/three.module.js";
import {cameraAspect} from "./camera_format.js";
import {manualReferenceLens} from "./manual_framing.js?v=20261028-curved-camera-paths";
import { manualPosition, pathProgress, shotFraming } from "./manual_path.js?v=20261028-curved-camera-paths";



import {PriorityControls} from "./priority_controls.js?v=20261029-position-drag-r2";
import {TrackingControls} from "./tracking_controls.js?v=20261028-curved-camera-paths";

const labels = (list) => Object.fromEntries(list.map((value) => [value, `Actor ${value}`]));
const BEHAVIORS = { static: "Static", move: "Moving", follow: "Follow subjects" };
const MOVES = Object.fromEntries(
  Object.entries(CHOICES.movement).filter(([key]) => !["track_subjects", "follow", "lead", "alongside"].includes(key)),
);
export class PresetControls {
  constructor(editor) {
    this.editor = editor;
    this.element = document.createElement("div");
    this.element.className = "cw-presets";
    this.fields = new Map();
    this.summary = document.createElement("div");
    this.summary.className = "cw-preset-summary";
    this.summary.setAttribute("aria-live", "polite");
    this.element.append(this.summary);
    this.columns=document.createElement("div");this.columns.className="cw-shot-columns";this.element.append(this.columns);
    this.panels=new Map();this.tabButtons=new Map();
    const section=(key,title)=>{
      const panel=document.createElement('section');panel.className='cw-shot-panel';
      const heading=document.createElement('h3');heading.textContent=title;heading.className='cw-camera-section-title';
      const grid=document.createElement('div');grid.className='cw-preset-grid';panel.append(heading,grid);this.columns.append(panel);this.panels.set(key,panel);return grid;
    };
    const subjects=section('subjects','Subjects & framing'),camera=section('camera','Camera & movement');
    this.panels.get('camera').querySelector('h3').textContent='Camera';
    const behavior=section('movement','Movement & tracking');
    this.panels.get('movement').classList.add('cw-movement-panel');
    const behaviorTitle=this.panels.get('movement').querySelector('h3');
    const advanced = (parent, title) => {
      const details = document.createElement("details");
      details.className = "cw-local-advanced";
      const summary = document.createElement("summary");
      summary.textContent = title;
      const grid = document.createElement("div");
      grid.className = "cw-preset-grid";
      details.append(summary, grid);
      parent.after(details);
      return grid;
    };
    const behaviorAdvanced = advanced(behavior, "Movement timing");
    this.behaviorAdvanced=behaviorAdvanced.parentElement;
    this.behaviorTitle=behaviorTitle;
    this.select(
      subjects,
      "selection",
      "Composition",
      { single: "Single actor", all: "Full group", selected: "Select actors" },
      "Only selected actors influence framing. Other actors remain visible in the scene.",
    );
    this.select(subjects, "primary", "Actor", {});
    this.actorGroup = document.createElement("fieldset");
    this.actorGroup.className = "cw-subject-checks";
    subjects.append(this.actorGroup);
    this.reference = document.createElement("div");
    this.reference.className = "cw-shot-reference";
    subjects.append(this.reference);
    const referenceGrid = document.createElement("div");
    referenceGrid.className = "cw-reference-grid";
    this.reference.append(referenceGrid);
    this.number(
      referenceGrid,
      "reference_frame",
      "Reference frame",
      1,
      1,
      1,
      "Sets the pose used for framing and actor-relative camera angles. Playback does not change it.",
    );
    this.select(
      referenceGrid,
      "reference_actor",
      "Facing reference actor",
      {},
      "Defines front and sides independently of the selected group.",
    );
    this.select(referenceGrid, "reference_basis", "Facing basis", {
      pelvis: "Body / pelvis",
      chest: "Chest / shoulders",
    });
    const actions = document.createElement("div");
    actions.className = "cw-reference-actions";
    this.reference.append(actions);
    this.useReference = document.createElement("button");
    this.useReference.textContent = "Use current frame";
    this.useReference.onclick = () =>
      editor.edit(() => {
        const p = this.recipe();
        p.reference_time = editor.currentFrameTime();
        if (p.reference_basis === "legacy_chest") p.reference_basis = "pelvis";
        editor.setTime(p.reference_time);
      });
    this.goReference = document.createElement("button");
    this.goReference.textContent = "Go to reference";
    this.goReference.onclick = () => {
      editor.setPlaying(false);
      editor.setTime(this.recipe().reference_time);
    };
    this.referenceStatus = document.createElement("small");
    actions.append(this.useReference, this.goReference, this.referenceStatus);
    this.select(
      subjects,
      "focus_point",
      "Focus point",
      FOCUS_POINTS,
      "Choose the body region used for framing and tracking. Face uses standard body-shot sizes. This controls framing, not optical focus.",
    );
    this.select(
      subjects,
      "frame_reference",
      "Framing reference",
      FRAME_REFERENCES,
      "Where the focus point sits in the image. Exact thirds use image coordinates, independent of front/side/back view. Auto balances wider body shots to retain headroom and feet.",
    );
    this.select(
      subjects,
      "shot",
      "Shot size",
      CHOICES.shot,
      "Fit these body regions together. Widely separated actors may require a looser composition.",
    );
    this.number(
      subjects,
      "focus_fill_percent",
      "Focus area size · % of frame",
      5,
      150,
      1,
      "Ratio of the selected region to frame height before fit/margin constraints. Larger values frame it closer; above 100% deliberately crops detail. Group spacing or thirds placement may require extra room.",
    );
    this.restoreFraming = document.createElement("button");
    this.restoreFraming.textContent = "Restore shot framing";
    this.restoreFraming.title =
      "Restore this focus region's preset size and Auto placement; reset extra margin and camera/target offsets. Keeps selected focus, actors, reference frame, angle, lens and movement.";
    this.restoreFraming.onclick = () => editor.edit(() => {if(editor.editingCaptured)this.initialize();restoreShotFraming(this.recipe());});
    this.framingStatus = document.createElement("small");
    this.framingStatus.setAttribute("aria-live", "polite");
    subjects.append(this.restoreFraming, this.framingStatus);
    this.select(camera, "horizontal", "Placement", CHOICES.horizontal);
    this.compass = document.createElement("div");
    this.compass.className = "cw-bearing";
    camera.append(this.compass);
    this.select(
      camera,
      "vertical",
      "Vertical angle",
      CHOICES.vertical,
      "Auto levels the view around the framed region; wider body shots use a lower camera and tight shots rise toward the face. Eye level explicitly keeps the camera at the eyes (or selected focus). Ground clearance and deliberate moves/offsets can still tilt the view.",
    );
    this.select(camera, "lens", "Lens / perspective", CHOICES.lens);
    this.number(
      camera,
      "fisheye_fov",
      "Fisheye diagonal field of view · °",
      90,
      180,
      5,
      "Equidistant fisheye projection with curved lines. Preview and VIDEO share this projection. Wider values show more surroundings. Zoom and Dolly zoom use perspective lenses.",
    );
    this.select(camera, "roll_choice", "Horizon tilt", {
      level: "Level",
      left: "Tilt left",
      right: "Tilt right",
      custom: "Custom angle",
    });
    this.number(camera, "roll", "Horizon tilt · degrees", -90, 90, 1);
    this.number(camera, "focal_length", "Custom focal length · mm", 10, 200, 1);
    this.select(behavior, "behavior", "Camera type", BEHAVIORS);
    this.select(behavior, "movement", "Movement", { ...MOVES, custom: "Manual path · Start → End" });
    this.select(
      behavior,
      "follow_direction",
      "Follow direction",
      { reference: "Keep reference direction", facing: "Follow actor facing" },
      "Reference keeps the initial side of the subject. Facing turns the camera around the reference actor as they turn.",
    );
    this.select(behavior, "direction", "Direction", {});
    this.number(behavior, "travel", "Travel distance · m", 0, 100, 0.01);
    this.number(behavior, "orbit_degrees", "Orbit · degrees", 0, 360, 5);
    this.number(behavior, "rotation_degrees", "Turn · degrees", 0, 160, 5);
    this.number(behavior, "end_focal_length", "Ending focal length · mm", 10, 200, 0.1);
    this.number(behavior, "crane_forward", "Crane forward travel · m", -100, 100, 0.1);
    this.select(behavior, "path_anchor", "Orbit center", CHOICES.path_anchor);
    this.select(
      behavior,
      "aim_behavior",
      "Aiming",
      CHOICES.aim_behavior,
      "Track selected actors pans/tilts toward them without pulling back. Groups favor the largest stable cluster; unselected actors never influence aiming. Fixed position with tracking aim can pan while staying in one place.",
    );
    this.select(behavior, "response", "Aim response", { direct: "Responsive · direct", smooth: "Gentle · smooth" });
    this.range(behavior, "responsiveness", "Aim responsiveness");
    this.select(behavior, "follow_response", "Follow response", {
      direct: "Responsive · direct",
      smooth: "Gentle · smooth",
    });
    this.range(behavior, "follow_responsiveness", "Follow responsiveness");
    this.number(behaviorAdvanced, "start_time", "Movement starts · seconds", 0, 120, 0.1);
    this.number(behaviorAdvanced, "end_time", "Movement ends · 0 = clip end", 0, 120, 0.1);
    this.select(behaviorAdvanced, "pacing", "Movement pacing", CHOICES.pacing);
    this.number(behaviorAdvanced, "max_turn_speed", "Maximum tracking turn · °/s", 1, 180, 1);
    this.number(behaviorAdvanced, "dead_zone", "Aim tolerance · degrees", 0, 10, 0.1);
    this.number(behaviorAdvanced, "max_follow_speed", "Maximum follow speed · m/s", 0.1, 30, 0.1);
    this.upgradeFollow = document.createElement("button");
    this.upgradeFollow.textContent = "Use new Follow controls";
    this.upgradeFollow.onclick = () => editor.edit(() => selectBehavior(editor.settings.preset, "follow"));
    this.panels.get("movement").append(this.upgradeFollow);
    // Old saved settings can still call these methods while being migrated.
    this.historyCamera={busy:false,cancel(){},sync(){},dispose(){}};
    this.trackingControls=new TrackingControls(editor);
    this.panels.get("movement").append(this.trackingControls.element);
    this.panels.get("movement").append(editor.manualPathEditor.panel,editor.editor.querySelector(".cw-endpoints"));
    this.note = document.createElement("div");
    this.note.className = "cw-preset-note";
    this.note.setAttribute("role", "status");
    this.element.append(this.note);
    editor.editor.querySelector(".cw-edit-hint").before(this.element);
    this.advanced=document.createElement('details');this.advanced.className='cw-assisted-controls';
    const caption=document.createElement('summary');caption.textContent='Advanced · camera placement';this.advanced.append(caption);
    const extras=document.createElement('div');extras.className='cw-preset-grid';this.advanced.append(extras);
    camera.parentElement.append(this.advanced);
    for(const key of ['horizontal','vertical'])extras.append(this.fields.get(key).label);
    extras.append(this.compass);
    this.moveAdvanced=document.createElement('details');this.moveAdvanced.className='cw-assisted-controls';
    const moveCaption=document.createElement('summary');moveCaption.textContent='Advanced · assisted moves';
    const moveExtras=document.createElement('div');moveExtras.className='cw-preset-grid';
    this.moveAdvanced.append(moveCaption,moveExtras,this.behaviorAdvanced);this.panels.get('movement').append(this.moveAdvanced);
    for(const key of ['movement','direction','travel','orbit_degrees','rotation_degrees','end_focal_length','crane_forward','path_anchor','aim_behavior','follow_direction'])moveExtras.append(this.fields.get(key).label);
    this.movementOptions=document.createElement('div');this.movementOptions.className='cw-movement-options';
    this.movementOptions.append(this.trackingControls.framingTransition,this.moveAdvanced);
    this.panels.get('movement').append(this.movementOptions);
    const slider=(key,title,min,max,step)=>{
      this.number(key==='closeness'?subjects:camera,key,title,min,max,step);
      this.fields.get(key).input.type='range';
      const output=document.createElement('output');this.fields.get(key).label.append(output);this.fields.get(key).output=output;
      this.fields.get(key).input.oninput=this.fields.get(key).input.onchange;
    };
    slider('closeness','Framing distance · far → close',0,1,.005);
    slider('elevation_angle','Vertical angle · low → top',-89.9,89.9,.1);extras.append(this.fields.get('elevation_angle').label);
    slider('bearing_offset','Around reference actor · degrees',-180,180,1);extras.append(this.fields.get('bearing_offset').label);
    // The circular control is pointer- and keyboard-accessible, with a continuous bearing.
    this.compass.replaceChildren();
    const dial=document.createElement('div');dial.className='cw-bearing-dial';dial.tabIndex=0;dial.setAttribute('role','slider');dial.setAttribute('aria-label','Circular view around reference actor');dial.setAttribute('aria-valuemin','-180');dial.setAttribute('aria-valuemax','180');
    dial.innerHTML='<svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="44" fill="none" stroke="#58718a" stroke-width="2"/><path d="M52 65 L60 47 L68 65Z" fill="#8dc7ef"/><circle class="cw-bearing-knob" cx="60" cy="16" r="7" fill="#ffbd62"/><text x="60" y="9" text-anchor="middle" fill="#b5c4d5" font-size="9">FRONT</text></svg>';
    const setBearing=angle=>{const value=Math.max(-180,Math.min(180,Math.round(angle)));editor.edit(()=>this.change('bearing_offset',value));};
    const pointer=event=>{const rect=dial.getBoundingClientRect();setBearing(Math.atan2(event.clientX-rect.left-rect.width/2,rect.top+rect.height/2-event.clientY)*180/Math.PI);};
    dial.onpointerdown=event=>{event.preventDefault();event.stopPropagation();dial.setPointerCapture(event.pointerId);pointer(event);};
    dial.onpointermove=event=>{if(dial.hasPointerCapture(event.pointerId)){event.stopPropagation();pointer(event);}};
    dial.onpointerup=event=>{if(dial.hasPointerCapture(event.pointerId))dial.releasePointerCapture(event.pointerId);};
    dial.onkeydown=event=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(event.key))return;event.preventDefault();event.stopPropagation();const now=Number(dial.getAttribute('aria-valuenow')??0);setBearing(event.key==='Home'?0:now+(['ArrowRight','ArrowUp'].includes(event.key)?1:-1)*(event.shiftKey?15:1));};
    this.dial=dial;this.compass.append(dial);
    for(const [key,min,max,step] of [['focal_length',10,100,1],['fisheye_fov',120,180,1],['roll',-90,90,1],['travel',0,100,.1],['orbit_degrees',0,360,5],['rotation_degrees',0,160,1],['end_focal_length',10,200,.1],['crane_forward',-100,100,.1]]) {
      const field=this.fields.get(key);Object.assign(field.input,{type:'range',min,max,step});field.input.oninput=field.input.onchange;
      field.output=document.createElement('output');field.label.append(field.output);
    }
    this.fields.get('focal_length').label.after(this.fields.get('fisheye_fov').label);
    this.fields.get('fisheye_fov').label.firstChild.textContent='Fisheye field of view · degrees';
    this.fields.get('fisheye_fov').input.setAttribute('aria-label','Fisheye field of view · degrees');
    this.fields.get('focal_length').label.firstChild.textContent='Lens · mm';
    this.fields.get('focal_length').input.setAttribute('aria-label','Lens · mm');
    this.fields.get('focal_length').label.title='Full-frame equivalent: 36 × 24 mm sensor, cropped to the output ratio and rotated for portrait. Changes perspective field of view; moving the camera never changes the lens.';
    this.fisheye=document.createElement('label');this.fisheye.className='cw-preset-field cw-inline-toggle';const check=document.createElement('input');check.type='checkbox';check.setAttribute('aria-label','Fisheye lens');check.onchange=()=>editor.edit(()=>this.change('lens',check.checked?'fisheye':'custom'));this.fisheye.append(check,' Fisheye');camera.append(this.fisheye);this.fisheyeInput=check;
    for(const [key,a,b,text] of [['path_anchor','fixed','follow','Orbit center follows actors'],['follow_direction','reference','facing','Follow actor facing'],['aim_behavior','target','track','Aim toward moving subjects'],['direction','left','right','Move right (off = left)']]) {
      const field=this.fields.get(key),input=document.createElement('input');input.type='checkbox';input.setAttribute('aria-label',text);field.input.replaceWith(input);field.input=input;field.toggle=[a,b];field.label.firstChild.textContent=text;input.onchange=()=>editor.edit(()=>this.change(key,input.checked?field.toggle[1]:field.toggle[0]));
    }
    this.activateTab("subjects");
    this.priority=new PriorityControls(this);
  }
  activateTab(key) {this.activeTab=key;for(const panel of this.panels.values())panel.hidden=false;}
  select(parent, key, title, choices, tooltip) {
    const input = document.createElement("select");
    this.options(input, choices);
    this.field(parent, key, title, input, tooltip);
  }
  number(parent, key, title, min, max, step, tooltip) {
    const input = document.createElement("input");
    Object.assign(input, { type: "number", min, max, step });
    this.field(parent, key, title, input, tooltip);
  }
  range(parent, key, title) {
    const input = document.createElement("input");
    Object.assign(input, { type: "range", min: 0, max: 1, step: 0.05 });
    this.field(parent, key, title, input);
  }
  field(parent, key, title, input, tooltip = "") {
    const label = document.createElement("label");
    label.className = "cw-preset-field";
    label.title = tooltip;
    const text = document.createElement("span");
    text.textContent = title;
    input.setAttribute("aria-label", title);
    input.dataset.preset = key;if(input.type==='range')bindSliderDrag(input);
    label.append(text, input);
    parent.append(label);
    this.fields.set(key, { label, input });
    input.onkeydown = (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      }
    };
    input.onchange = () => {
      if(key==="behavior") {this.editor.chooseCameraType(input.value);return;}
      const value=["number", "range"].includes(input.type)?Number(input.value):input.value;
      const valid=input.checkValidity()&&input.value!=="";
      this.editor.edit(() => {
        if (!valid) throw new Error(`Enter a valid ${title.toLowerCase()}.`);
        this.change(key,value);
      });
    };
  }
  options(input, choices) {
    if(input.type==="checkbox")return;
    input.replaceChildren(
      ...Object.entries(choices).map(([value, text]) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = text;
        return option;
      }),
    );
  }
  available() {
    return this.editor.capture?.actors.map((a) => a.number) ?? [];
  }
  change(key, value) {
    const e = this.editor,
      available = this.available();
    if(e.settings.manual_path?.source_frames && !["reference_frame","reference_actor","reference_basis","roll"].includes(key)) {
      if(key==="focal_length"||key==="lens"||key==="fisheye_fov")e.settings.manual_path.lens_override=true;
      else if(!["behavior","movement","start_time","end_time","pacing"].includes(key))e.activateAim();
    }
    if(value==='captured') return;
    if(key==='closeness') {
      if(e.editingCaptured)this.customView();
      const p=this.recipe(),previous=this.previousCloseness??.5;
      if(p.horizontal!=='custom'){
        p.framing_scale=THREE.MathUtils.clamp(p.framing_scale*Math.exp((previous-value)*5),.03,20);
        this.previousCloseness=value;return;
      }
      const plan=presetPlan(e.capture,e.settings,e.capture.duration,e.time),i=plan.referenceIndex;
      const target=plan.targets[i],delta=plan.positions[i].clone().sub(target),distance=Math.max(.1,delta.length());
      // Continuous dolly, with a fixed lens. Slider input is relative to its previous value.
      delta.multiplyScalar(Math.exp((previous-value)*5));
      Object.assign(p,{horizontal:'custom',custom_position:target.clone().add(delta).toArray(),position_offset:[0,0,0]});
      this.previousCloseness=value;return;
    }

    if(key==='horizontal' && value==='custom') {this.customView();return;}
    if (key === "movement" && value === "custom") {
      if (e.settings.mode === "preset") e.lastPreset = structuredClone(e.settings.preset);
      e.initializeBookends();
      return;
    }
    if (e.settings.mode === "bookends" && ["behavior", "movement"].includes(key)) this.initialize();
    const draftKeys=['reference_frame','reference_actor','reference_basis'];
    if(e.editingCaptured && !draftKeys.includes(key)) this.initialize();
    const p = this.recipe();
    if (key === "lens" && value === "fisheye" && ["zoom", "dolly_zoom"].includes(p.movement))
      throw new Error("Choose a movement other than Zoom or Dolly zoom before selecting Fisheye.");
    if(key==='lens' && value==='fisheye' && p.lens!=='fisheye')p.fisheye_fov=160;
    if (key === "focal_length") {p.lens="custom";p.focal_length=value;}
    else if (key === 'selection' && value==='marker'){chooseAimMarker(e);return;}
    else if (key === "selection") {e.activateAim();selectSubjects(p, value, available);}
    else if (key === "primary") {e.activateAim();selectSubjects(p, "single", available, [Number(value)]);}
    else if (key === "shot") selectShot(p, value);
    else if (key === "focus_point") {
      e.activateAim();p.focus_point = value;
      if((e.settings.mode==='bookends'||p.horizontal==='custom')&&p.aim_source==='legacy'){p.aim_source='live';p.follow_strength=.25;p.tracking_mode='auto';}
      p.framing_version = 2;
      p.aim = "auto";
      p.focus_fill = 0;
    } else if (key === "focus_fill_percent") p.focus_fill = value / 100;
    else if (key === "behavior") {selectBehavior(p,value);if(value==='follow')p.aim_source='live';else if(p.horizontal==='custom'&&p.aim_source==='legacy'){p.aim_source='live';p.follow_strength=.25;}}
    else if (key === "foreground_actor" || key === "reference_actor") p[key] = Number(value);
    else if (key === "reference_frame") p.reference_time = timeAtFrame(value, e.timeline);
    else if (key === "roll_choice")
      p.roll = value === "level" ? 0 : value === "left" ? -12 : value === "right" ? 12 : p.roll || 5;
    else p[key] = value;
    if(key==='horizontal' && value!=='custom') {p.custom_position=null;p.position_offset=[0,0,0];}
    if (!p.actors.includes(p.reference_actor)) p.reference_actor = p.actors[0];
    if (["reference_frame", "reference_actor"].includes(key) && p.reference_basis === "legacy_chest")
      p.reference_basis = "pelvis";
    const focal = { ultra_wide: 18, wide: 24, natural: 35, portrait: 50, telephoto: 85 }[p.lens] ?? p.focal_length;
    if (key === "direction" && p.movement === "zoom")
      p.end_focal_length = Math.round(Math.min(200, Math.max(10, focal * (value === "in" ? 1.5 : 2 / 3))) * 10) / 10;
    if (key === "movement") {
      p.behavior = "move";
      p.direction = { tilt: "up", pedestal: "up", crane: "up", dolly_zoom: "in", zoom: "in" }[value] ?? "left";
      p.aim_behavior = ["pan", "tilt"].includes(value) ? "fixed" : "target";
      if (value === "orbit") p.path_anchor=p.target_mode==='marker'?'fixed':'follow';
      if (value === "zoom") p.end_focal_length = Math.min(200, focal * 1.5);
      if (value === 'dolly_zoom') {
        const plan = presetPlan(
          e.capture,
          { ...e.settings, preset: { ...p, movement: "fixed" } },
          e.capture.duration,
          e.time,
        );
        p.travel = Math.min(
          p.travel,
          Math.floor(
            Math.max(0, plan.positions[plan.referenceIndex].distanceTo(plan.targets[plan.referenceIndex]) - 0.15) *
              0.4 *
              100,
          ) / 100,
        );
      }
    }
    p.reference_basis="chest";
    Object.assign(p, effectivePreset(p));
    if (key === "reference_frame") e.setTime(p.reference_time);
  }
  customView() {
    const e=this.editor,reference=this.recipe().reference_time;
    let position;
    if(e.editingCaptured) {
      try{e.capture.setTime(reference);position=e.capture.camera.position.toArray();}finally{e.sampleTime(e.time);}
      this.initialize();
    } else {
      if(e.settings.mode==='bookends')this.initialize();
      const plan=presetPlan(e.capture,e.settings,e.capture.duration,e.time);
      position=plan.positions[plan.referenceIndex].toArray();
    }
    Object.assign(e.settings.preset,{horizontal:'custom',custom_position:position,position_offset:[0,0,0]});
  }
  recipe() { return this.editor.editingCaptured?this.editor.capturedPreset:this.editor.settings.preset; }
  initialize() {
    const e = this.editor,
      p = e.capturedPreset ?? e.settings.preset ?? e.lastPreset ?? {...presetDefaults(this.available(), e.currentFrameTime()),tracking_mode:"auto"};
    let manualPositionAtReference=null,manualLens=null;
    if(e.settings.mode==='bookends') {
      manualPositionAtReference=manualPosition(e.settings,pathProgress(e.settings,p.reference_time,e.capture.duration)).toArray();
      manualLens=manualReferenceLens(e.capture,e.settings,e.capture.duration,e.time);
    }
    e.settings = {
      ...e.settings,
      mode: "preset",
      manual_path: null,
      target_actor: null,
      start: null,
      end: null,
      preset: structuredClone(p),
      world_frame_id: e.motion.world_frame.id,
    };
    e.settings.preset = effectivePreset({...e.settings.preset,reference_basis:"chest"});
    nearestFramingReference(e.settings.preset);
    if(manualPositionAtReference) {
      Object.assign(e.settings.preset,{horizontal:'custom',custom_position:manualPositionAtReference,position_offset:[0,0,0]});
      if(e.settings.preset.lens!=='fisheye') {
        const mm=e.settings.preset.lens_calibration==='full_frame'?manualLens.focal_length:e.settings.preset.sensor_height/(2*Math.tan(THREE.MathUtils.degToRad(manualLens.fov)/2));
        Object.assign(e.settings.preset,{lens:Math.abs(mm-35)<1e-6?'natural':'custom',focal_length:mm});
      } else e.settings.preset.fisheye_fov=THREE.MathUtils.clamp(manualLens.fov*Math.hypot(cameraAspect(e.capture,e.settings),1),90,180);
    }
    e.editingCaptured=false;e.capturedPreset=null;
    e.snapReferenceToFrame();
  }
  sync() {
    const e = this.editor;
    const history=false;
    this.historyCamera.sync();

    this.behaviorAdvanced.hidden=history;
    if(history) {
      this.element.hidden=false;
      this.activateTab('camera');
      for(const [key,{label,input}] of this.fields) {label.hidden=key!=='behavior';if(key==='behavior'){this.options(input,BEHAVIORS);input.value='history';input.disabled=!e.capture;}}
      this.actorGroup.hidden=this.reference.hidden=this.restoreFraming.hidden=this.framingStatus.hidden=this.compass.hidden=this.upgradeFollow.hidden=true;
      this.trackingControls.element.hidden=true;this.trackingControls.framingTransition.hidden=true;
      this.editor.manualPathEditor.panel.hidden=true;
      this.editor.editor.querySelector('.cw-endpoints').hidden=true;
      this.summary.textContent=e.settings.mode==='history'?'Camera from history · imported path and lens':'Choose a camera from history';
      this.note.textContent='';this.note.hidden=true;
      return;
    }
    const manual = e.settings.mode === "bookends",
      manualShot = shotFraming(e.settings),
      draft=e.editingCaptured && e.settings.mode==='captured',
      active = draft || manual || e.settings.mode === "preset";
    this.element.hidden = !active;
    if (!active) {this.trackingControls.sync();return;}
    const p = effectivePreset(
        e.capturedPreset ?? e.settings.preset ?? e.lastPreset ?? presetDefaults(this.available(), e.currentFrameTime()),
      ),
      available = this.available();
    const selection = available.length<3?(p.actors.length>1?"all":"single"):subjectSelection(p, available),
      type = draft?"captured":cameraBehavior(manual ? e.settings : { mode: "preset", preset: p });
    this.options(this.fields.get("behavior").input,{...(draft?{captured:"Captured camera"}:{}),...BEHAVIORS});
    this.options(this.fields.get("focus_point").input, {
      ...(p.focus_point === "legacy" ? { legacy: "Saved framing · previous center" } : {}),
      ...Object.fromEntries(Object.entries(FOCUS_POINTS).filter(([k])=>["auto","chest","shoulders","hips","hands","left_hand","right_hand","feet","left_foot","right_foot"].includes(k))),
    });
    this.options(this.fields.get("horizontal").input,{custom:"Manual",front:"Around actor",...(!["front","custom"].includes(p.horizontal)?{[p.horizontal]:CHOICES.horizontal[p.horizontal]+" · saved"}:{})});
    this.options(this.fields.get("lens").input,CHOICES.lens);
    this.options(this.fields.get("vertical").input, {
      ...(draft?{captured:"Captured angle"}:{}),
      ...CHOICES.vertical,
      eye: hasFocus(p) && p.focus_point !== "auto" ? "Level with focus" : "Eye level",
    });
    this.options(this.fields.get("shot").input,{...(draft?{captured:"Captured framing"}:{}),...(hasFocus(p) && p.focus_point !== "auto" ? DETAIL_SHOTS : CHOICES.shot)});
    const choices =
      available.length > 1
        ? available.length===2 ? {single:"Single actor",all:"Both actors"} : { single: "Single actor", all: "Full group", selected: "Select actors" }
        : { single: "Single actor" };
    this.options(this.fields.get("selection").input, choices);
    this.options(this.fields.get("primary").input, labels(available));
    this.options(this.fields.get("reference_actor").input, labels(p.actors));
    this.options(this.fields.get("reference_basis").input, {
      pelvis: "Body / pelvis",
      chest: "Chest / shoulders",
      ...(p.reference_basis === "legacy_chest" ? { legacy_chest: "Previous saved facing" } : {}),
    });
    const moves = { ...MOVES };
    if (p.lens === "fisheye") {
      delete moves.zoom;
      delete moves.dolly_zoom;
    }
    if (!MOVES[p.movement] && p.movement !== "track_subjects")
      moves[p.movement] = `${CHOICES.movement[p.movement]} · saved shot`;
    moves.custom = "Manual path · Start → End";
    this.options(this.fields.get("movement").input, moves);
    const directions = ["tilt", "pedestal", "crane"].includes(p.movement)
      ? { up: "Up", down: "Down" }
      : ["zoom", "dolly_zoom"].includes(p.movement)
        ? { in: "In", out: "Out" }
        : { left: "Left", right: "Right" };
    this.options(this.fields.get("direction").input, directions);
    const directionField=this.fields.get('direction');directionField.toggle=Object.keys(directions);
    directionField.label.firstChild.textContent=`Move ${directions[directionField.toggle[1]].toLowerCase()} (off = ${directions[directionField.toggle[0]].toLowerCase()})`;
    directionField.input.setAttribute('aria-label',directionField.label.firstChild.textContent);
    for (const [key, { label, input }] of this.fields) {
      label.hidden = false;
      const manualFields = ["reference_frame","selection","primary","focus_point","frame_reference","shot","focus_fill_percent","roll_choice","roll","lens","fisheye_fov","focal_length"];
      input.disabled = !e.capture || (manual && input.type!=='range' && !["behavior","movement"].includes(key) && !(manualShot && manualFields.includes(key)));
      syncSliderValue(input,String(
        draft && ['shot','horizontal','vertical'].includes(key) ? 'captured'
          : key === "selection"
          ? selection
          : key === "behavior"
            ? type
            : key === "movement" && manual
              ? "custom"
              : key === "primary"
                ? p.actors[0]
                : key === "reference_frame"
                  ? e.referenceFrame(p.reference_time)
                  : key.startsWith("position_")
                    ? p.position_offset[Number(key.at(-1))]
                    : key.startsWith("offset_")
                      ? p.target_offset[Number(key.at(-1))]
                      : key === "roll_choice"
                        ? p.roll === 0
                          ? "level"
                          : p.roll === -12
                            ? "left"
                            : p.roll === 12
                              ? "right"
                              : "custom"
                        : p[key],
      ));
    }
    this.fields.get("focus_fill_percent").input.value = String(Math.round((p.focus_fill || FOCUS_FILL[p.shot]) * 100));
    this.restoreFraming.hidden = (manual && !manualShot) || p.composition === "pov";
    this.restoreFraming.disabled = !e.capture;
    this.framingStatus.hidden=true;
    const show = (key, value) => { const field=this.fields.get(key); if(field) field.label.hidden = !value; };
    this.fields.get("reference_frame").input.max = String(Math.max(1, e.timeline.count));
    this.fields.get("reference_actor").input.disabled = manual || p.actors.length === 1;
    this.referenceStatus.textContent = `Frame ${e.referenceFrame(p.reference_time)} of ${e.timeline.count}`;
    this.reference.hidden = p.composition === "pov";
    show("reference_actor", !manualShot && p.composition !== "ots");
    show("reference_basis", !manualShot && p.composition !== "ots");
    show("primary", selection === "single");
    this.actorGroup.hidden = selection !== "selected";
    this.actorGroup.replaceChildren();
    const legend = document.createElement("legend");
    legend.textContent = "Actors to frame · select at least one";
    this.actorGroup.append(legend);
    for (const id of available) {
      const label = document.createElement("label"),
        input = document.createElement("input");
      input.type = "checkbox";
      input.checked = p.actors.includes(id);
      input.setAttribute("aria-label", `Frame Actor ${id}`);
      input.disabled = (manual && !manualShot) || (input.checked && p.actors.length === 1);
      input.onchange = () => e.edit(() => {
        if(e.editingCaptured)this.initialize();
        e.activateAim();
        selectSubjects(this.recipe(),"selected",available,input.checked?[...p.actors,id].sort((a,b)=>a-b):p.actors.filter(a=>a!==id));
      });
      label.append(input, `Actor ${id}`);
      this.actorGroup.append(label);
    }
    show("horizontal", !manualShot && (!fixedBearing(p)||p.horizontal==='custom'));
    // Priority layout owns the shared dial; never hide its captured pointer mid-drag.
    if(!this.priority)this.compass.hidden = draft || p.horizontal==='custom' || this.fields.get("horizontal").label.hidden;
    const angle = AZIMUTH[p.horizontal] ?? 0;
    const dialAngle=(AZIMUTH[p.horizontal]??0)+p.bearing_offset;
    this.dial.setAttribute('aria-valuenow',String(dialAngle));this.dial.setAttribute('aria-valuetext',`${dialAngle} degrees around reference actor`);
    this.dial.querySelector('.cw-bearing-knob').setAttribute('transform',`rotate(${dialAngle} 60 60)`);

    show("fisheye_fov", p.lens === "fisheye");
    
    for (const key of ["shot", "vertical"]) show(key, p.composition !== "pov");
    if (manualShot || p.horizontal==='custom') show("vertical", false);
    for (const key of [
      "focus_point",
      "frame_reference",
      "focus_fill_percent",
      
      
      
    ])
      show(key, false);
    show("focus_point", p.composition !== "pov");
    show("frame_reference", hasFocus(p));
    show("focus_fill_percent", hasFocus(p) && p.focus_point !== "auto");
    this.fields.get("behavior").input.disabled = !e.capture || p.composition === "pov";
    show("movement", type === "move");
    show("follow_direction", type === "follow" && p.movement === "track_subjects");
    show("path_anchor", !manual && p.movement === "orbit");
    show("aim_behavior", !manual && type === "move" && !["pan", "tilt"].includes(p.movement));
    const tracks = p.aim_behavior === "track" && type === "move",
      smooth = tracks && p.response === "smooth";
    show("response", !manual && tracks);
    show("responsiveness", !manual && smooth);
    show(
      "max_turn_speed",
      !manual && (smooth || (type === "follow" && p.follow_direction === "facing" && p.follow_response === "smooth")),
    );
    show("dead_zone", !manual && smooth);
    const follows = subjectTravel(p);
    show("follow_response", !manual && follows);
    show("follow_responsiveness", !manual && follows && p.follow_response === "smooth");
    show("max_follow_speed", !manual && follows && p.follow_response === "smooth");
    show(
      "direction",
      !manual &&
        ["pan", "tilt", "truck", "pedestal", "orbit", "alongside", "crane", "dolly_zoom", "zoom"].includes(p.movement),
    );
    show("travel", !manual && ["push", "pull", "truck", "pedestal", "crane", "dolly_zoom"].includes(p.movement));
    show("orbit_degrees", !manual && p.movement === "orbit");
    show("rotation_degrees", !manual && ["pan", "tilt"].includes(p.movement));
    show("end_focal_length", !manual && p.movement === "zoom");
    show("crane_forward", !manual && p.movement === "crane");
    for (const key of ["start_time", "end_time", "pacing"])
      show(key, !manual && type === "move" && p.movement !== "fixed");
    this.upgradeFollow.hidden =
      manual || type !== "follow" || p.movement === "track_subjects" || p.composition === "pov";
    this.useReference.disabled = this.goReference.disabled = !e.capture || (manual && !manualShot);
    this.trackingControls.sync();
    if(p.tracking_mode !== 'legacy') for(const key of ['response','responsiveness','follow_response','follow_responsiveness','max_turn_speed','dead_zone','max_follow_speed']) show(key,false);
    // Hide empty advanced drawers rather than presenting blank sections.
    for (const details of this.element.querySelectorAll(".cw-local-advanced"))
      details.hidden = ![...details.querySelectorAll(".cw-preset-field")].some((label) => !label.hidden);
    const framing =
      p.composition === "pov"
        ? "Actor POV"
        : `${p.composition === "ots" ? "Over the shoulder · " : p.composition === "detail" ? "Detail · " : ""}${hasFocus(p) && p.focus_point !== "auto" ? DETAIL_SHOTS[p.shot] : CHOICES.shot[p.shot]}`;
    const focusLabel = hasFocus(p) ? ` · ${FOCUS_POINTS[p.focus_point]} · ${FRAME_REFERENCES[p.frame_reference]}` : "";
    const angleLabel = fixedBearing(p) ? "" : ` · ${CHOICES.horizontal[p.horizontal]}`;
    this.summary.textContent = draft?"Captured camera · original path and lens":manual
      ? "Camera move · Manual path · Start → End"
      : `${p.actors.map((id) => `Actor ${id}`).join(", ")} · ${framing}${focusLabel}${angleLabel} · ${BEHAVIORS[type]}${type === "move" ? ` · ${CHOICES.movement[p.movement]}` : ""}`;
    this.note.textContent = '';
    if (manualShot) {
      const lensInfo=e.capture?.camera.userData.cartwheelManualFraming;

      if(lensInfo?.limited) this.note.textContent += " Lens limit or camera placement prevents the requested reference crop; adjust the path or choose a looser shot.";
    }
    if (!manual && !draft && e.capture) {
      const plan = presetPlan(e.capture, e.settings, e.capture.duration, e.time);
      const focusWarning = plan.warnings.find((text) => text.startsWith("Finger landmarks"));
      if (focusWarning) this.note.textContent += ` ${focusWarning}`;
      const fallback = plan.warnings.find((text) => text.startsWith("Pelvis landmarks"));
      if (fallback) this.note.textContent += ` ${fallback}`;
    }
    show('selection',available.length>1);show('primary',available.length>1&&selection==='single');
    show('reference_actor',available.length>1&&p.actors.length>1&&!manual&&p.horizontal!=='custom');
    for(const key of ['reference_basis','shot','focus_fill_percent','roll_choice','lens','vertical','response','responsiveness','follow_response','follow_responsiveness'])show(key,false);
    show('focal_length',p.lens!=='fisheye');show('roll',true);
    show('closeness',!manual);show('elevation_angle',!manual&&p.horizontal!=='custom');show('bearing_offset',false);
    this.fields.get('closeness').input.disabled=!e.capture;
    this.fields.get('closeness').input.value=String(this.previousCloseness??.5);
    this.fields.get('focal_length').input.disabled=!e.capture;
    syncSliderValue(this.fields.get('focal_length').input,({ultra_wide:18,wide:24,natural:35,portrait:50,telephoto:85})[p.lens]??p.focal_length);
    this.fisheyeInput.checked=p.lens==='fisheye';
    for(const [key,field] of this.fields) {
      if(field.toggle)field.input.checked=p[key]===field.toggle[1];
      if(field.output)field.output.textContent=key==='closeness'?'':`${field.input.value}${key==='focal_length'?' mm':['roll','bearing_offset','elevation_angle','fisheye_fov'].includes(key)?'°':''}`;
    }
    if(p.horizontal==='custom'||manual)this.summary.textContent=`${p.actors.map(id=>`Actor ${id}`).join(', ')} · ${FOCUS_POINTS[p.focus_point]??'Focus'} · ${manual?'Manual path':BEHAVIORS[type]} · scene placement`;
    const manualAim=manual||p.horizontal==='custom';
    this.reference.hidden=manualAim&&p.aim_source==='live';
    const referenceField=this.fields.get('reference_frame');
    referenceField.label.firstChild.textContent=manualAim&&p.aim_source==='reference'?'Target frame':'Reference frame';
    referenceField.input.setAttribute('aria-label',manualAim&&p.aim_source==='reference'?'Target frame':'Reference frame');
    this.focusNotice??=document.createElement('p');this.focusNotice.className='cw-focus-warning';
    if(!this.focusNotice.parentElement)this.fields.get('focus_point').label.after(this.focusNotice);
    this.focusNotice.textContent=focusWarnings(e.capture,p).join(' ');this.focusNotice.hidden=!this.focusNotice.textContent;
    this.restoreFraming.hidden=true;
    this.framingStatus.textContent='';this.framingStatus.hidden=true;
    this.note.hidden=!this.note.textContent.trim();
    for(const drawer of [this.advanced,this.moveAdvanced]) drawer.hidden=![...drawer.querySelectorAll('.cw-preset-field')].some(label=>!label.hidden);
    this.priority?.sync();

  }
}
