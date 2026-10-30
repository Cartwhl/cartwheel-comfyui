import {CameraTransitionControls} from './camera_transition_controls.js';
import {trackingOptions,trackingPlacement,trackingWindow} from './aim_tracking.js';
import {screenPlacement} from './camera_composition.js';
import {shotFraming} from './manual_path.js?v=20261028-curved-camera-paths';

export class TrackingControls {
  constructor(editor){
    this.editor=editor;this.element=document.createElement('div');this.element.className='cw-tracking-controls';
    this.element.innerHTML=`<label class="cw-tracking-mode">Tracking <select aria-label="Tracking mode"><option value="auto">Auto · natural</option><option value="exact">Exact · locked on</option><option value="custom">Custom</option><option value="off">Off · reference target</option><option value="legacy">Saved tracking</option></select></label><p class="cw-tracking-explanation"></p><details class="cw-tracking-details"><summary>Tracking details</summary><div class="cw-tracking-grid"><label>Vertical tracking<select aria-label="Vertical tracking"><option value="auto">Auto</option><option value="grounded">Grounded · ignore jumps / ducking</option><option value="gentle">Gentle · slow vertical follow</option><option value="exact">Exact · follow all motion</option></select></label>${[['room_horizontal','Horizontal room · %',0,60,1],['room_vertical','Vertical room · %',0,60,1],['pan_smoothing','Pan smoothing · seconds',.05,3,.05],['tilt_smoothing','Tilt smoothing · seconds',.05,3,.05]].map(([key,label,min,max,step])=>`<label>${label}<input data-track="${key}" aria-label="${label}" type="number" min="${min}" max="${max}" step="${step}"></label>`).join('')}</div></details><details class="cw-framing-transition"><summary>Start / end framing · optional</summary></details>`;
    this.liveControls=document.createElement('div');this.liveControls.className='cw-live-aim cw-preset-grid';
    this.liveControls.innerHTML='<label class="cw-preset-field"><span>Camera aim</span><select aria-label="Camera aim"><option value="live">Follow focus point</option><option value="reference">Hold focus point · selected frame</option></select></label><label class="cw-preset-field cw-follow-strength"><span>Camera follow strength</span><input aria-label="Camera follow strength" type="range" min="0" max="1" step=".01"><small><span>Steady · smooth action</span><span>Tight · follow every move</span></small><output></output></label>';
    this.element.prepend(this.liveControls);
    this.framingTransition=this.element.querySelector('.cw-framing-transition');
    this.coverageNote=document.createElement('p');this.coverageNote.className='cw-action-warning';this.coverageNote.setAttribute('role','status');this.coverageNote.hidden=true;this.element.querySelector('.cw-tracking-explanation').after(this.coverageNote);
    this.aimSource=this.liveControls.querySelector('select');this.followStrength=this.liveControls.querySelector('input');
    this.aimSource.onchange=()=>this.edit(p=>{p.aim_source=this.aimSource.value;if(p.aim_source==='reference'){p.reference_time=editor.currentFrameTime();}else{p.tracking_mode='auto';p.follow_strength??=.25;}});
    this.followStrength.oninput=()=>this.edit(p=>{p.aim_source='live';p.follow_strength=Number(this.followStrength.value);});
    this.mode=this.element.querySelector('[aria-label="Tracking mode"]');
    this.mode.onchange=()=>this.edit(p=>p.tracking_mode=this.mode.value);
    this.vertical=this.element.querySelector('[aria-label="Vertical tracking"]');this.vertical.onchange=()=>this.edit(p=>p.vertical_tracking=this.vertical.value);
    for(const input of this.element.querySelectorAll('input[data-track],input[data-frame]')){
      input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();e.stopPropagation();input.blur();}};
      input.onchange=()=>this.edit(p=>{if(!input.checkValidity()||input.value==='')throw new Error('Enter a valid tracking value.');const key=input.dataset.track??input.dataset.frame;const percent=key.startsWith('room_')||input.dataset.frame;p[key]=Number(input.value)/(percent?100:1);});
    }
    this.transitionControls=new CameraTransitionControls(editor,this.framingTransition);
    const label=document.createElement('label');label.innerHTML='<input type="checkbox" class="cw-tracking-guide"> Tracking window';editor.element.querySelector('.cw-footer').insertBefore(label,editor.status);
    this.guide=label.querySelector('input');this.guide.checked=Boolean(editor.node.properties.cartwheel_tracking_window);
    this.guide.onchange=()=>{editor.node.properties.cartwheel_tracking_window=this.guide.checked;editor.node.graph?.afterChange?.(editor.node);editor.render();};
  }
  edit(change){this.editor.edit(()=>{this.editor.activateAim?.();const p=this.editor.settings.preset;change(p);});}
  sync(){
    const e=this.editor,p=e.settings.preset;
    const manual=p&&(shotFraming(e.settings)||(e.settings.mode==='preset'&&p.horizontal==='custom'));
    const active=p&&(manual||shotFraming(e.settings)||(e.settings.mode==='preset'&&p.behavior!=='static'&&p.composition!=='pov'&&!['pan','tilt'].includes(p.movement)&&(p.aim_behavior==='track'||p.framing_motion)));
    this.guide.disabled=!active||!['auto','custom'].includes(p.tracking_mode);
    this.guide.closest('label').title=shotFraming(e.settings)?'Allowed tracking area in the camera preview only; Auto tracking.':'Allowed tracking area in the camera preview only; Auto or Custom tracking.';
    this.guide.closest('label').title=manual?'Preferred focus drift area. Close views reserve extra room for the focus region.':this.guide.closest('label').title;
    this.transitionControls.sync();this.element.hidden=!active;this.framingTransition.hidden=!active;if(!active)return;
    this.liveControls.hidden=!manual;this.mode.closest('label').hidden=manual;
    this.aimSource.replaceChildren(...Object.entries({live:'Follow focus point',reference:'Hold focus point · selected frame',...(!p.aim_source||p.aim_source==='legacy'?{legacy:'Saved aiming behavior'}:{})}).map(([value,text])=>{const option=document.createElement('option');option.value=value;option.textContent=text;return option;}));
    this.aimSource.value=p.aim_source??'legacy';this.followStrength.value=String(p.follow_strength??.25);
    this.followStrength.closest('label').hidden=p.aim_source!=='live';
    if(this.liveControls.querySelector('output'))this.liveControls.querySelector('output').textContent=Number(this.followStrength.value)>=.999?'Exact follow':`${Math.round(Number(this.followStrength.value)*100)}%`;
    this.guide.disabled=!active||(manual?p.aim_source!=='live':!['auto','custom'].includes(p.tracking_mode));
    const allowed=shotFraming(e.settings)?{auto:'Auto · natural',exact:'Exact · locked on',off:'Off · reference target'}:{auto:'Auto · natural',exact:'Exact · locked on',custom:'Custom',off:'Off · reference target',...(p.tracking_mode==='legacy'?{legacy:'Saved tracking'}:{})};
    this.mode.replaceChildren(...Object.entries(allowed).filter(([key])=>key!=='off'||p.movement!=='track_subjects').map(([value,text])=>{const option=document.createElement('option');option.value=value;option.textContent=text;return option;}));
    this.mode.value=p.tracking_mode??'auto';this.vertical.value=p.vertical_tracking;
    this.element.querySelector('.cw-tracking-details').hidden=manual||p.tracking_mode!=='custom';
    for(const input of this.element.querySelectorAll('[data-track]')){const key=input.dataset.track;input.value=String(Number((p[key]*(key.startsWith('room_')?100:1)).toFixed(3)));}
    this.transitionControls.sync();
    this.element.querySelector('.cw-tracking-explanation').hidden=true;
  }
}
export function renderTrackingGuide(preview){
  let box=preview.cameraFrame.querySelector('.cw-tracking-window');
  if(!box){box=document.createElement('div');box.className='cw-tracking-window';preview.cameraFrame.append(box);}
  const feedback=preview.capture?.camera.userData.cartwheelActionFollow;
  const note=preview.element.querySelector('.cw-action-warning');
  if(note){note.hidden=!feedback?.limited;note.textContent=feedback?.limited?'Some selected focus parts are outside this view. Adjust the path or widen the lens.':'';}
  const p=preview.settings?.preset,manual=p&&(shotFraming(preview.settings)||(preview.settings?.mode==='preset'&&p.horizontal==='custom')),tracks=p&&(manual||shotFraming(preview.settings)||(preview.settings?.mode==='preset'&&p.behavior!=='static'&&p.composition!=='pov'&&!['pan','tilt'].includes(p.movement)&&(p.aim_behavior==='track'||p.framing_motion)));
  const active=p?.target_mode!=='marker'&&tracks&&(manual?p.aim_source==='live':['auto','custom'].includes(p.tracking_mode))&&preview.node.properties.cartwheel_tracking_window;
  box.hidden=!active;if(!active)return;
  const option=trackingOptions(p),center=trackingPlacement(p,preview.time,preview.capture?.duration??0,screenPlacement(p))??[.5,.5];
  const bounds=feedback?.screenWindow??trackingWindow(option,center);
  Object.assign(box.style,{left:`${bounds.left*100}%`,top:`${bounds.top*100}%`,width:`${(bounds.right-bounds.left)*100}%`,height:`${(bounds.bottom-bounds.top)*100}%`});
}
