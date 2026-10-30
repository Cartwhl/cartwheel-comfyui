import * as THREE from './vendor/build/three.module.js';
import {FRAME_REFERENCES,FOCUS_POINTS,screenPlacement} from './camera_composition.js';
import {TRANSITION_FIELDS} from './camera_transition.js';
const common=['auto','chest','hands','left_hand','right_hand','shoulders','hips','feet','left_foot','right_foot'];
const labels={target:'Target',focus_point:'Aim',frame_reference:'Composition',follow_strength:'Camera follow strength · %',focal_length:'Lens · mm',roll:'Horizon tilt · degrees',fisheye_fov:'Fisheye field of view · degrees'};
const options=(select,choices)=>{select.replaceChildren(...Object.entries(choices).map(([value,text])=>{const o=document.createElement('option');o.value=value;o.textContent=text;return o;}));};
export class CameraTransitionControls{
 constructor(editor,details){
  this.editor=editor;this.rows=new Map();this.root=document.createElement('div');this.root.className='cw-camera-transition';details.append(this.root);
  const enableLabel=document.createElement('label');enableLabel.className='cw-transition-enable';this.enabled=document.createElement('input');this.enabled.type='checkbox';enableLabel.append(this.enabled,' Animate camera settings');this.root.append(enableLabel);
  this.table=document.createElement('div');this.table.className='cw-transition-table';this.root.append(this.table);
  for(const text of ['Change','Start','End']){const h=document.createElement('strong');h.textContent=text;this.table.append(h);}
  for(const key of TRANSITION_FIELDS){
   const row={key,inputs:[]},label=document.createElement('label');row.label=label;row.toggle=document.createElement('input');row.toggle.type='checkbox';row.toggle.setAttribute('aria-label',`Animate ${labels[key]}`);label.append(row.toggle,labels[key]);this.table.append(label);
   row.toggle.onchange=()=>this.edit(t=>{t.fields=t.fields.filter(f=>f!==key);if(row.toggle.checked)t.fields.push(key);});
   for(const side of ['start','end']){
    const cell=document.createElement('div');cell.className='cw-transition-value';row[side]=cell;this.table.append(cell);
    const input=document.createElement(['target','focus_point','frame_reference'].includes(key)?'select':'input');
    input.setAttribute('aria-label',`${side} ${labels[key]}`);cell.append(input);row.inputs.push(input);
    if(input.tagName==='INPUT'){
     input.type='number';const [min,max,step]=key==='follow_strength'?[0,100,1]:key==='focal_length'?[10,200,.01]:key==='roll'?[-90,90,1]:[120,180,1];Object.assign(input,{min,max,step});
    }
    if(key==='focus_point')options(input,Object.fromEntries(common.map(k=>[k,FOCUS_POINTS[k]])));
    if(key==='frame_reference')options(input,FRAME_REFERENCES);
    input.onchange=()=>{if(input.tagName==='INPUT'&&(!input.checkValidity()||input.value===''))return;this.edit(t=>{
     if(key==='target')this.setTarget(t[side],input.value);else t[side][key]=input.tagName==='INPUT'?Number(input.value)/(key==='follow_strength'?100:1):input.value;
    });};
    if(input.tagName==='INPUT')input.oninput=input.onchange;
    input.onkeydown=e=>{e.stopPropagation();if(e.key==='Enter'){e.preventDefault();input.onchange();input.blur();}};
    if(key==='target'){
     const actors=document.createElement('div');actors.className='cw-transition-actors';cell.append(actors);row[side+'Actors']=actors;
     const marker=document.createElement('div');marker.className='cw-transition-marker';row[side+'Marker']=marker;cell.append(marker);
     for(const [axis,k] of ['X','Y','Z'].map((a,i)=>[a,i])){const label=document.createElement('label'),coordinate=document.createElement('input');label.textContent=axis;Object.assign(coordinate,{type:'number',min:-100000,max:100000,step:'any'});coordinate.setAttribute('aria-label',`${side} aim marker ${axis}`);label.append(coordinate);marker.append(label);coordinate.onchange=()=>{if(coordinate.value===''||!coordinate.checkValidity())return;this.edit(t=>{t[side].custom_target[k]=Number(coordinate.value);});};}

    }
   }
   this.rows.set(key,row);
  }
  this.enabled.onchange=()=>this.edit(t=>{t.enabled=this.enabled.checked;});
 }
 snapshot(){const p=this.editor.settings.preset;return Object.fromEntries(['target_mode','custom_target','actors','selection','composition','reference_actor','focus_point','frame_reference','follow_strength','focal_length','roll','fisheye_fov'].map(k=>[k,k==='fisheye_fov'?Math.max(120,p[k]??160):structuredClone(p[k])]));}
 definition(){
  const p=this.editor.settings.preset;if(p.camera_transition)return p.camera_transition;
  const t={enabled:!!p.framing_motion,fields:p.framing_motion?['frame_reference']:[],start:this.snapshot(),end:this.snapshot()};
  if(p.framing_motion)for(const side of ['start','end']){
   const x=p[`framing_${side}_x`],y=p[`framing_${side}_y`];let best='center',distance=Infinity;
   for(const key of Object.keys(FRAME_REFERENCES).filter(k=>k!=='auto')){const point=screenPlacement({...p,frame_reference:key}),d=(point[0]-x)**2+(point[1]-y)**2;if(d<distance){best=key;distance=d;}}
   t[side].frame_reference=best;
  }
  return t;
 }
 edit(change){this.editor.edit(()=>{const p=this.editor.settings.preset;p.camera_transition??=this.definition();change(p.camera_transition);p.framing_motion=false;});}
 setTarget(endpoint,value){
  const ids=this.editor.capture.actors.map(a=>a.number);endpoint.target_mode=value==='marker'?'marker':'actors';
  if(value==='marker'){endpoint.custom_target??=this.editor.settings.preset.custom_target??this.editor.capture.actors[0].root.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0,1,0)).toArray();return;}
  endpoint.selection=value==='all'?'all':value==='selected'?'selected':'single';
  endpoint.actors=value==='all'?ids:value==='selected'?(endpoint.actors?.length?endpoint.actors:[ids[0]]):[Number(value)];
  endpoint.reference_actor=endpoint.actors[0];endpoint.composition=endpoint.actors.length>1?'group':'single';
 }
 sync(){
  const p=this.editor.settings.preset;if(!p||!this.editor.capture)return;
  const t=this.definition();
  this.enabled.checked=Boolean(t.enabled);this.table.hidden=!t.enabled;
  const ids=this.editor.capture.actors.map(a=>a.number),choices={...Object.fromEntries(ids.map(id=>[String(id),`Actor ${id}`])),...(ids.length>1?{all:ids.length===2?'Both actors':'Full group'}:{}),...(ids.length>2?{selected:'Select actors'}:{}),marker:'Custom marker'};
  for(const [key,row] of this.rows){
   const hidden=key==='focal_length'?p.lens==='fisheye':key==='fisheye_fov'?p.lens!=='fisheye':false;
   row.label.hidden=hidden;row.toggle.checked=t.fields.includes(key);
   for(const [i,side] of ['start','end'].entries()){
    const endpoint=t[side],cell=row[side],input=row.inputs[i];cell.hidden=hidden;input.disabled=!row.toggle.checked;
    if(key==='target'){
     options(input,choices);input.value=endpoint.target_mode==='marker'?'marker':endpoint.selection==='selected'?'selected':endpoint.actors.length>1?'all':String(endpoint.actors[0]);
     const actors=row[side+'Actors'];actors.replaceChildren();actors.hidden=input.value!=='selected';
     const marker=row[side+'Marker'];marker.hidden=input.value!=='marker';for(const [k,coordinate] of [...marker.querySelectorAll('input')].entries()){coordinate.disabled=input.disabled;if(document.activeElement!==coordinate)coordinate.value=String(Math.round((endpoint.custom_target?.[k]??0)*100)/100);}

     if(!actors.hidden)for(const id of ids){const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.checked=endpoint.actors.includes(id);check.disabled=input.disabled;label.append(check,`Actor ${id}`);actors.append(label);check.onchange=()=>this.edit(value=>{const e=value[side],selected=ids.filter(actor=>actor===id?check.checked:e.actors.includes(actor));if(!selected.length)return;e.actors=selected;e.reference_actor=selected[0];e.composition=selected.length>1?'group':'single';});}
    }else if(input.tagName==='INPUT'&&document.activeElement!==input)input.value=String(Math.round((endpoint[key]??p[key])*(key==='follow_strength'?100:1)*100)/100);
    if(input.tagName==='SELECT'&&key!=='target')input.value=endpoint[key]??p[key];
   }
  }
 }
}
