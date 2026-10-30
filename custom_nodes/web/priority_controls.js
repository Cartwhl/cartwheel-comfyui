import {bindRangePointer,bindPointerDrag,syncSliderValue} from './slider_interaction.js?v=20261029-position-drag-r2';
import {changeTiming} from './camera_timeline.js?v=20261029-usability-r2';
import {isAimMarker} from './aim_marker.js?v=20261028-delivery';
import {positionContext,positionFromCoordinates,setCameraPosition,DISTANCE_LIMIT,distanceSliderValue,sliderDistance} from './camera_position.js?v=20261028-curved-camera-paths';
import {manualPath} from './manual_path.js?v=20261028-curved-camera-paths';
import {manualReferenceLens} from './manual_framing.js?v=20261028-curved-camera-paths';
import {cameraBehavior} from './shot_controls.js?v=20261028-delivery';

// Every numeric slider shares its value with a directly editable number field.
export function editableSlider(field,unit='') {
 if(field.numeric)return;
 const number=document.createElement('input');number.type='number';number.className='cw-slider-number';
 number.setAttribute('aria-label',`${field.input.getAttribute('aria-label')} value`);
 number.step=field.input.step||'any';
 field.output?.replaceWith(number);if(!field.output)field.label.append(number);
 field.output=null;field.numeric=number;field.unit=unit;
 const commit=()=>{const value=Number(number.value);if(number.value===''||!Number.isFinite(value))return;
  if(field.setNumber)field.setNumber(value);else{field.input.value=String(value);field.input.onchange?.();}
 };
 number.oninput=commit;number.onchange=commit;
 number.onkeydown=event=>{event.stopPropagation();if(event.key==='Enter'){event.preventDefault();commit();number.blur();}};
}
export class PriorityControls {
 constructor(controls) {
  this.controls=controls;this.editor=controls.editor;const e=this.editor;
  controls.element.classList.add('cw-priority-editor');controls.columns.hidden=true;controls.summary.hidden=true;
  this.flow=document.createElement('div');this.flow.className='cw-shot-flow';controls.element.prepend(this.flow);
  const row=(name,title)=>{const div=document.createElement('div');div.className=`cw-shot-row cw-${name}-row`;if(title){const h=document.createElement('span');h.textContent=title;h.className='cw-row-caption';div.append(h);}this.flow.append(div);return div;};
  this.behavior=row('behavior');this.subjects=row('targets');this.aim=row('aim');this.moves=row('moves');this.timing=row('move-timing');this.position=row('position');this.finish=row('finish');this.details=row('details');
  const field=key=>controls.fields.get(key).label;
  this.behavior.append(field('behavior'));
  this.resets=document.createElement('div');this.resets.className='cw-camera-resets';
  this.resetCamera=document.createElement('button');this.resetCamera.textContent='Reset camera';this.resetCamera.onclick=()=>e.resetCamera(false);
  this.resetScene=document.createElement('button');this.resetScene.textContent='Reset scene';this.resetScene.onclick=()=>e.resetCamera(true);
  this.resets.append(this.resetCamera,this.resetScene);this.behavior.append(this.resets);
  this.parameters=document.createElement('div');this.parameters.className='cw-movement-parameters';
  this.moveOptions=document.createElement('div');this.moveOptions.className='cw-movement-toggles';
  for(const [key,name] of [['behavior','Camera'],['selection','Target'],['primary','Actor'],['focus_point','Aim'],['frame_reference','Composition'],['focal_length','Lens · mm']]){
   const f=controls.fields.get(key);f.label.firstChild.textContent=name;f.input.setAttribute('aria-label',name);
  }
  this.followField=controls.trackingControls.followStrength.closest('label');
  this.subjects.append(field('selection'),field('primary'),field('focus_point'),field('frame_reference'),controls.actorGroup);
  this.aim.append(this.followField);
  controls.trackingControls.aimSource.closest('label').remove();controls.reference.remove();
  this.aim.append(controls.trackingControls.element);
  this.moves.append(field('movement'),this.parameters);
  for(const key of ['travel','orbit_degrees','rotation_degrees','end_focal_length','crane_forward'])this.parameters.append(field(key));
  this.parameters.append(e.manualPathEditor.panel);
  this.moveOptions.append(e.manualPathEditor.shapeToggle.closest('label'),e.manualPathEditor.pacingToggle.closest('label'),e.manualPathEditor.smoothToggle.closest('label'));
  for(const key of ['direction','path_anchor','aim_behavior'])this.moveOptions.append(field(key));
  this.aim.append(field('follow_direction'));
  this.distance=this.addSlider('distance','Camera distance · m',0,DISTANCE_LIMIT,.01);
  const scale=document.createElement('small');scale.className='cw-distance-scale';scale.innerHTML='<span>Far</span><span>Close</span>';this.distance.label.append(scale);
  this.orbit=document.createElement('div');this.orbit.className='cw-position-orbit';
  const orbitLabel=document.createElement('span');orbitLabel.textContent='Orbit';this.orbit.append(orbitLabel,controls.compass);
  this.positionSliders=document.createElement('div');this.positionSliders.className='cw-position-sliders';this.positionSliders.append(this.distance.label);this.position.append(this.positionSliders,this.orbit);
  this.height=this.addSlider('height','Height · m',-5,15,.01);this.height.label.classList.add('cw-height-control');this.positionSliders.append(this.height.label);
  this.angle=this.addSlider('orbit','Orbit · degrees',0,360,1);this.angle.label.classList.add('cw-orbit-value');this.orbit.append(this.angle.label);
  this.finish.append(field('focal_length'),field('fisheye_fov'),controls.fisheye,field('roll'));
  this.details.append(controls.trackingControls.framingTransition);
  this.timing.append(this.moveOptions);
  this.customTiming=document.createElement('div');this.customTiming.className='cw-custom-timing';
  this.customTiming.append(field('start_time'),field('end_time'));
  const custom=controls.trackingControls.framingTransition;custom.querySelector('summary').textContent='Custom start/end settings';custom.querySelector('summary').after(this.customTiming);
  for(const [key,label] of [['start_time','Start moving at · seconds'],['end_time','Finish moving at · seconds']]){
   field(key).firstChild.textContent=label;controls.fields.get(key).input.setAttribute('aria-label',label);
  }
  field('start_time').title='The camera waits at the start of its path until this time.';
  field('end_time').title='The camera reaches the end of its path at this time. Use 0 for the end of the clip.';
  const timingNote=document.createElement('small');timingNote.style.flexBasis='100%';timingNote.textContent='The camera waits at the start of its path until the start time. Finish at 0 means the end of the clip.';this.customTiming.append(timingNote);
  for(const key of ['start_time','end_time']){const input=controls.fields.get(key).input,original=input.onchange;input.onchange=()=>{if(!e.sequence?.timeline)return original();if(input.value===''||!input.checkValidity())return;e.sequence.mutate(()=>changeTiming(e.sequence.timeline,e.sequence.selected.id,key==='start_time'?'start':'end',key==='end_time'&&Number(input.value)===0?e.capture.duration:Number(input.value)));};}
  for(const key of ['start_time','end_time','rotation_degrees','end_focal_length','crane_forward']){const input=controls.fields.get(key).input;input.oninput=input.onchange;}
  // A single easing control is shared by manual and assisted movement.
  e.manualPathEditor.pacingToggle.onchange=()=>e.edit(()=>{const smooth=e.manualPathEditor.pacingToggle.checked;e.settings.preset.pacing=smooth?'ease_in_out':'constant';if(e.settings.mode==='bookends')e.settings.manual_path={...manualPath(e.settings),pacing:smooth?'smooth':'linear'};});
  for(const f of controls.fields.values())if(f.input.type==='range')editableSlider(f);
  editableSlider(this.distance);editableSlider(this.height);editableSlider(this.angle);
  for(const f of [this.distance,this.height,this.angle])f.numeric.removeAttribute('max');
  this.angle.numeric.min='0';this.angle.numeric.max='360';
  controls.fields.get('focal_length').input.max='200';
  controls.focalTitle='Lens · mm';
  this.installToolbar();
  // Replace the dial's old preset-bearing handler with the shared position model.
  const dial=controls.dial;
  const set=value=>this.setPosition('orbit',value);
  const pointer=event=>{const rect=dial.getBoundingClientRect();set(-Math.atan2(event.clientX-rect.left-rect.width/2,rect.top+rect.height/2-event.clientY)*180/Math.PI);};
  dial.setAttribute('aria-label','Orbit around target');dial.setAttribute('aria-valuemin','0');dial.setAttribute('aria-valuemax','360');
  dial.onpointerdown=dial.onpointermove=dial.onpointerup=null;
  this.disposeOrbit=bindPointerDrag(dial,pointer);
  dial.onkeydown=event=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(event.key))return;event.preventDefault();event.stopPropagation();set(event.key==='Home'?0:this.context.orbit+(['ArrowLeft','ArrowUp'].includes(event.key)?1:-1)*(event.shiftKey?15:1));};
 }
 addSlider(key,title,min,max,step){
  const label=document.createElement('label');label.className='cw-preset-field';const text=document.createElement('span');text.textContent=title;
  const input=document.createElement('input');Object.assign(input,{type:'range',min,max,step});input.setAttribute('aria-label',title);label.append(text,input);
  const field={label,input,setNumber:value=>this.setPosition(key,value)};input.oninput=()=>this.setPosition(key,key==='distance'?sliderDistance(Number(input.value)):Number(input.value));input.onchange=()=>{};
  field.disposeDrag=bindRangePointer(input,()=>input.oninput());return field;
 }
 dispose(){this.disposeOrbit?.();for(const field of [this.distance,this.height,this.angle])field.disposeDrag?.();}
 setPosition(key,value){
  if(!Number.isFinite(value))return;
  this.editor.edit(()=>{const context=positionContext(this.editor);const values={...context,[key]:key==='distance'?Math.max(0,Math.min(100000,value)):value};if(values.distance<.001&&Math.abs(values.height-context.target[1])<.001)values.distance=.001;setCameraPosition(this.editor,positionFromCoordinates(values,context.target,context.forward),context.id);});
 }
 installToolbar(){
  const e=this.editor,toolbar=e.element.querySelector('.cw-toolbar');
  toolbar.classList.add('cw-scene-toolbar');
  const options=e.editor.querySelector('.cw-editor-options'),format=e.editor.querySelector('.cw-output-frame');toolbar.append(options,format);
  const visibility=document.createElement('details');visibility.className='cw-toolbar-menu cw-visibility-menu';visibility.innerHTML='<summary>Visibility</summary><div></div>';
  const content=visibility.querySelector('div');
  for(const label of e.element.querySelectorAll('.cw-footer > label'))content.append(label);
  content.append(e.manualPathEditor.panel.querySelector('.cw-show-handles').closest('label'));
  toolbar.append(visibility);
  const views=document.createElement('details');views.className='cw-toolbar-menu cw-view-menu';views.innerHTML='<summary>View</summary><div></div>';
  views.querySelector('div').append(e.element.querySelector('.cw-modes'),e.element.querySelector('.cw-fit'));toolbar.append(views);
  for(const menu of [views,visibility])menu.addEventListener('toggle',()=>{if(menu.open)for(const other of [views,visibility])if(other!==menu)other.open=false;});
 }
 sync(){
  const c=this.controls,e=this.editor,ready=!!e.capture,p=e.settings.preset;
  this.resetCamera.disabled=this.resetScene.disabled=!ready||!!e.renderController;
  c.summary.hidden=true;c.columns.hidden=true;c.element.hidden=!ready||e.settings.mode==='captured';
  if(!ready||!p)return;
  const source=e.settings.manual_path?.aim==='source',type=cameraBehavior(e.settings),manual=e.settings.mode==='bookends';
  this.behavior.querySelector('[data-preset="behavior"]').value=type;
  for(const key of ['selection','primary','focus_point','frame_reference','focal_length','roll','fisheye_fov','start_time','end_time'])c.fields.get(key).input.disabled=false;
  for(const key of ['horizontal','bearing_offset','elevation_angle','closeness'])c.fields.get(key).label.hidden=true;
  c.fields.get('focus_point').label.hidden=false;c.fields.get('frame_reference').label.hidden=false;
  this.moves.hidden=type!=='move';
  const movement=c.fields.get('movement');
  const options=[...movement.input.options].filter(o=>!['custom','fixed','track_subjects'].includes(o.value)).map(o=>[o.value,o.textContent]);
  c.options(movement.input,{custom:'Manual path',...Object.fromEntries(options)});movement.input.value=manual?'custom':p.movement;movement.label.hidden=type!=='move';
  c.moveAdvanced.hidden=true;c.advanced.hidden=true;
  const path=e.manualPathEditor,panel=path.panel;panel.hidden=type!=='move'||!manual;
  const actions=panel.querySelector('.cw-manual-actions');actions.hidden=false;
  for(const item of actions.children)item.hidden=!manual;
  path.shapeToggle.closest('label').hidden=!manual;
  path.smoothToggle.closest('label').hidden=!manual;
  path.pacingToggle.closest('label').hidden=false;
  path.pacingToggle.checked=manual?manualPath(e.settings).pacing==='smooth':p.pacing!=='constant';
  if(manual){path.smoothToggle.closest('label').hidden=manualPath(e.settings).kind!=='curve'||!manualPath(e.settings).points?.length;}
  c.behaviorAdvanced.hidden=true;c.fields.get('pacing').label.hidden=true;
  this.timing.hidden=type!=='move';this.customTiming.hidden=type!=='move';c.trackingControls.framingTransition.hidden=false;c.trackingControls.transitionControls.sync();for(const key of ['start_time','end_time'])c.fields.get(key).label.hidden=type!=='move';
  if(e.sequence?.selected)for(const [key,side] of [['start_time','start'],['end_time','end']]){const input=c.fields.get(key).input;if(document.activeElement!==input)input.value=String(e.sequence.selected[side]);input.step='any';}
  e.editor.querySelector('.cw-endpoints').hidden=true;
  const marker=isAimMarker(p),tracking=c.trackingControls;
  this.subjects.classList.toggle('cw-marker-target',marker);
  const choices=e.capture.actors.length<3?{single:'Single actor',...(e.capture.actors.length>1?{all:'Both actors'}:{})}:{single:'Single actor',all:'Full group',selected:'Select actors'};
  c.options(c.fields.get('selection').input,{...choices,marker:'Custom marker'});
  c.fields.get('selection').input.value=marker?'marker':(p.selection==='selected'&&e.capture.actors.length>=3?'selected':p.actors.length>1?'all':'single');
  c.fields.get('selection').label.hidden=false;c.fields.get('selection').input.disabled=false;
  c.fields.get('primary').label.hidden=marker||e.capture.actors.length<2||c.fields.get('selection').input.value!=='single';
  c.actorGroup.hidden=marker||c.fields.get('selection').input.value!=='selected';
  c.fields.get('focus_point').label.hidden=marker;
  c.fields.get('frame_reference').label.hidden=false;
  this.followField.hidden=marker||['pan','tilt'].includes(p.movement);
  this.aim.hidden=marker||(this.followField.hidden&&type!=='follow');
  tracking.followStrength.value=String(p.follow_strength??.25);tracking.followStrength.disabled=false;
  tracking.element.hidden=true;c.reference.hidden=true;
  c.fields.get('reference_actor').label.hidden=true;
  c.fields.get('aim_behavior').label.hidden=true;c.fields.get('path_anchor').label.hidden=true;
  const behavior=c.fields.get('behavior');if(marker){c.options(behavior.input,{static:'Static',move:'Moving'});behavior.input.value=type;}
  for(const key of ['aim_behavior','path_anchor','follow_direction'])if(marker)c.fields.get(key).label.hidden=true;
  c.compass.hidden=false;
  try{this.context=positionContext(e);}catch(error){e.hint.textContent=error.message;return;}
  for(const [key,f] of [['distance',this.distance],['height',this.height],['orbit',this.angle]]){
   const value=this.context[key];syncSliderValue(f.input,key==='distance'?distanceSliderValue(value):value);if(key==='distance')f.input.setAttribute('aria-valuetext',`${value.toFixed(2)} meters from target`);if(document.activeElement!==f.numeric)f.numeric.value=String(Math.round(value*100)/100);
  }
  c.dial.setAttribute('aria-valuenow',String(this.context.orbit));c.dial.setAttribute('aria-valuetext',`${Math.round(this.context.orbit)} degrees`);c.dial.querySelector('.cw-bearing-knob').setAttribute('transform',`rotate(${-this.context.orbit} 60 60)`);
  const which=this.position.querySelector('.cw-row-caption')??document.createElement('span');which.className='cw-row-caption';which.textContent=manual&&!e.settings.manual_path?.source_static?`Position · ${this.context.id==='end_position'?'End':this.context.id.startsWith('point')?'Point '+(Number(this.context.id.slice(5))+1):'Start'}`:'Camera position';if(!which.parentElement)this.position.prepend(which);
  for(const f of c.fields.values())if(f.numeric&&document.activeElement!==f.numeric)f.numeric.value=f.input.value;
  if(e.settings.manual_path?.source_frames&&!e.settings.manual_path.lens_override&&p.lens!=='fisheye'){const focal=manualReferenceLens(e.capture,e.settings,e.capture.duration,e.time).focal_length;const f=c.fields.get('focal_length');syncSliderValue(f.input,focal);if(document.activeElement!==f.numeric)f.numeric.value=String(Math.round(focal*100)/100);}
  const strength=tracking.followStrength;
  this.strengthField??={label:strength.closest('label'),input:strength,output:strength.closest('label').querySelector('output')};editableSlider(this.strengthField);
  this.strengthField.numeric.min='0';this.strengthField.numeric.max='100';this.strengthField.numeric.step='1';this.strengthField.setNumber=value=>{strength.value=String(Math.max(0,Math.min(100,value))/100);strength.oninput();};
  if(document.activeElement!==this.strengthField.numeric)this.strengthField.numeric.value=String(Math.round(Number(strength.value)*100));
  c.note.hidden=true;
 }
}
