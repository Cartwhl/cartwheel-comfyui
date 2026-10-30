import {api} from '../../scripts/api.js';
import {app} from '../../scripts/app.js';
import {queueCameraJob} from './instruction_queue.js?v=20261028-instruction-ux-auth';
import {clone,renumberCameras} from './camera_timeline.js?v=20261029-usability-r2';
import {motionDocument,currentCameraFrames,instructionRanges} from './instruction_motion.js?v=20261029-usability-r2';
import {compileInstructions,boundaryLocks} from './instruction_animation.js?v=20261029-usability-r2';
import {compactContext} from './instruction_compact.js?v=20261029-usability-r2';

export function queuedInstruction(graph,requestId,signal,onQueued=()=>{}){
 return new Promise((resolve,reject)=>{
  let promptId=null,ended=false;
  const cleanup=()=>{clearTimeout(timer);for(const [name,fn] of listeners)api.removeEventListener(name,fn);signal?.removeEventListener('abort',abort);};
  const finish=(error,value)=>{if(ended)return;ended=true;cleanup();error?reject(error):resolve(value);};
  const executed=event=>{const item=event.detail?.output?.cartwheel_camera_instruction?.find(v=>v.request_id===requestId);if(item)finish(null,item.result);};
  const failure=event=>{const data=event.detail;if(data?.prompt_id===promptId||String(data?.node_id??'').startsWith('cw_llm_'+requestId))finish(new Error(data.exception_message??'The Comfy model request failed.'));};
  const done=event=>{if(event.detail?.prompt_id===promptId&&!ended)finish(new Error('The model request finished without camera data.'));};
  const abort=()=>finish(new Error('Stopped. An already submitted model request may still finish; no camera changes were applied.'));
  const listeners=[['executed',executed],['execution_error',failure],['execution_interrupted',failure],['execution_success',done]];
  const timer=setTimeout(()=>finish(new Error('The model request timed out locally. Check Comfy’s queue before submitting again.')),20*60*1000);
  for(const [name,fn] of listeners)api.addEventListener(name,fn);signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted){abort();return;}
  // Resolve Comfy's current account/workspace at submission, not a stale token.
  queueCameraJob(api,app,graph,requestId,signal)
   .then(value=>{promptId=value.prompt_id;onQueued(promptId);}).catch(error=>finish(error));
 });
}
export class CameraInstructions{
 constructor(editor){
  this.submissionsEnabled=false;this.pauseReason='Restart ComfyUI to load the single-request camera adapter.';this.editor=editor;this.panel=document.createElement('details');this.panel.className='cw-camera-instructions';this.panel.innerHTML=`<summary>Camera instructions · AI</summary><div class="cw-instruction-body"><div class="cw-instruction-options"><label>Model<select aria-label="Camera instruction model"></select></label><label class="cw-instruction-scope">Apply to<select aria-label="Camera instruction scope"><option value="all">Entire sequence</option><option value="selected">Selected cameras</option></select></label><label class="cw-instruction-keep"><input type="checkbox" aria-label="Keep existing camera blocks"> Keep existing camera blocks</label></div><div class="cw-instruction-cameras" aria-label="Cameras to change"></div><details class="cw-instruction-system" hidden><summary>System prompt</summary><textarea aria-label="Camera system prompt" maxlength="32000" rows="7"></textarea></details><label>Your instructions<textarea aria-label="Camera user prompt" maxlength="16000" rows="4" placeholder="Describe the camera animation you want…"></textarea></label><div class="cw-instruction-actions"><button class="cw-instruction-generate">Submit camera job</button><button class="cw-instruction-stop" hidden>Stop</button><span class="cw-instruction-complete" role="status" hidden>✓ Completed</span></div><div class="cw-instruction-status" role="status">Load a scene and describe your camera move.</div><details class="cw-instruction-data"><summary>Request data</summary><select aria-label="Inspect camera instruction request"></select><textarea aria-label="Camera request data" readonly rows="6"></textarea></details></div>`;
  editor.editor.before(this.panel);const find=selector=>this.panel.querySelector(selector);
  this.model=find('[aria-label="Camera instruction model"]');this.scope=find('[aria-label="Camera instruction scope"]');this.keep=find('[aria-label="Keep existing camera blocks"]');this.system=find('[aria-label="Camera system prompt"]');this.user=find('[aria-label="Camera user prompt"]');this.cameras=find('.cw-instruction-cameras');this.status=find('.cw-instruction-status');this.generate=find('.cw-instruction-generate');this.stop=find('.cw-instruction-stop');this.complete=find('.cw-instruction-complete');this.dataSelect=find('[aria-label="Inspect camera instruction request"]');this.data=find('[aria-label="Camera request data"]');
  const saved=editor.node.properties.cartwheel_camera_instructions??{};this.user.value=saved.user_prompt??'';this.system.value=saved.system_prompt??'';this.keep.checked=saved.keep_blocks??true;this.scope.value=saved.scope??'all';this.savedModel=saved.model;
  this.persist=()=>{editor.node.properties.cartwheel_camera_instructions={system_prompt:this.system.value,user_prompt:this.user.value,model:this.model.value,keep_blocks:this.keep.checked,scope:this.scope.value};editor.node.graph?.afterChange?.(editor.node);};
  const changed=()=>{this.persist();this.prepared=null;this.failedFingerprint=null;this.notice=null;this.completionKey=null;this.sync();this.schedulePrepare();};
  for(const field of [this.system,this.user])field.oninput=changed;
  for(const field of [this.model,this.scope,this.keep])field.onchange=changed;
  this.panel.addEventListener('toggle',()=>{if(this.panel.open){this.loadModels();this.schedulePrepare();}});
  this.generate.onclick=()=>this.run();this.stop.onclick=()=>this.abort?.abort();this.dataSelect.onchange=()=>this.showData();this.generate.disabled=true;
 }
 async loadModels(){
  if(this.catalog||this.loadingModels)return;this.loadingModels=true;
  try{const response=await api.fetchApi('/cartwheel/camera-instructions/models');if(!response.ok)throw new Error('Restart ComfyUI to load Camera instructions.');const body=await response.json();this.catalog=body.models;this.maxContext=body.max_context_chars;this.submissionsEnabled=body.protocol_version===2&&body.submissions_enabled===true;this.pauseReason=body.pause_reason??this.pauseReason;
   this.model.replaceChildren();for(const model of this.catalog){const option=document.createElement('option');option.value=model.id;option.textContent=model.label;this.model.append(option);}
   this.model.value=this.catalog.some(m=>m.id===this.savedModel)?this.savedModel:(this.catalog.find(m=>m.provider==='openai'&&m.model==='gpt-6-sol')?.id??this.catalog[0]?.id??'');
   if(!this.system.value||(body.legacy_system_prompts??[body.legacy_system_prompt]).includes(this.system.value))this.system.value=body.system_prompt;this.persist();if(!this.catalog.length)throw new Error('No supported Comfy text integrations are installed. Update ComfyUI to enable GPT, Claude or Gemini.');this.status.textContent=this.submissionsEnabled?'':this.pauseReason;this.schedulePrepare();
  }catch(error){this.status.textContent=error.message;}finally{this.loadingModels=false;this.sync();}
 }
 fingerprint(){return JSON.stringify([this.editor.motion?.world_frame.id,this.editor.timelineFPS,this.editor.settings]);}
 requestKey(){return JSON.stringify([this.fingerprint(),this.selectedIds(),this.keep.checked,this.model.value,this.system.value,this.user.value]);}
 selectedIds(){const t=this.editor.sequence.timeline;if(!t)return [];return t.segments.length===1||this.scope.value==='all'?t.segments.map(s=>s.id):[...this.cameras.querySelectorAll('input:checked')].map(input=>input.value);}
 sync(){
  const e=this.editor,t=e.sequence?.timeline,world=e.motion?.world_frame.id;
  if(world!==this.world){this.world=world;this.abort?.abort();this.completionKey=null;this.prepared=null;this.sceneData=null;this.cameraKey=null;this.notice=null;this.failedFingerprint=null;if(t?.segments.length===1)this.keep.checked=false;}
  if(!t){this.generate.disabled=true;this.complete.hidden=true;return;}renumberCameras(t);const multiple=t.segments.length>1;
  this.panel.querySelector('.cw-instruction-scope').hidden=!multiple;this.panel.querySelector('.cw-instruction-keep').hidden=!multiple;this.cameras.hidden=!multiple||this.scope.value!=='selected';
  const key=JSON.stringify(t.segments.map(s=>[s.id,s.name]));if(key!==this.cameraKey){const checked=new Set([...this.cameras.querySelectorAll('input:checked')].map(i=>i.value));const retain=t.segments.some(s=>checked.has(s.id));this.cameras.replaceChildren();for(const s of t.segments){const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.value=s.id;input.checked=retain?checked.has(s.id):s.id===t.selected_id;input.setAttribute('aria-label',`Edit ${s.name}`);input.onchange=()=>{this.prepared=null;this.failedFingerprint=null;this.completionKey=null;this.sync();this.schedulePrepare();};label.append(input,document.createTextNode(s.name));this.cameras.append(label);}this.cameraKey=key;}
  if(this.completionKey&&this.completionKey!==this.requestKey())this.completionKey=null;
  this.complete.hidden=!this.completionKey||!!this.running;this.stop.hidden=!this.running;
  for(const field of [this.model,this.scope,this.keep,this.system,this.user,...this.cameras.querySelectorAll('input')])field.disabled=this.running||!!e.renderController;
  const noSelection=!this.selectedIds().length;this.generate.disabled=!this.submissionsEnabled||this.running||this.starting||this.preparing||noSelection||!this.catalog?.length||!e.capture||!!e.renderController||!this.user.value.trim()||!this.system.value.trim();if(noSelection&&!this.running)this.status.textContent='Select at least one camera.';
  if(e.saveButton)e.saveButton.disabled=this.running||!!e.renderController||e.savingCamera;
  if(!this.submissionsEnabled&&!this.running)this.status.textContent=this.pauseReason;
  if(this.submissionsEnabled&&this.panel.open&&!this.running&&!this.starting&&!this.preparing&&!e.renderController&&!this.completionKey&&this.prepared?.key!==this.requestKey()&&this.failedFingerprint!==this.requestKey())this.schedulePrepare();
 }
 // Building whole-clip joint/camera references is expensive: only Submit calls prepare.
 schedulePrepare(){clearTimeout(this.prepareTimer);}
 async prepare(force=false){
  const e=this.editor;if(!this.submissionsEnabled||this.preparing||!e.capture||!this.catalog||!this.selectedIds().length||e.renderController)return;
  if(!this.user.value.trim()||!this.system.value.trim()){this.status.textContent='Describe the camera animation you want.';return;}
  const fingerprint=this.fingerprint(),key=this.requestKey(),ids=this.selectedIds();if(!force&&this.prepared?.key===key&&this.prepared.expires>Date.now()+5000)return this.prepared;
  this.preparing=true;this.generate.disabled=true;e.setPlaying(false);const capture=e.capture,restore=e.time;
  try{
   let scene=this.sceneData;
   if(scene?.fingerprint!==fingerprint){
    const motion=await motionDocument(capture,e.timelineFPS,(i,n)=>{this.status.textContent=`Preparing motion reference · ${i} / ${n} frames`;});
    const camera=await currentCameraFrames(e,(i,n)=>{this.status.textContent=`Reading current camera · ${i} / ${n} frames`;});
    scene={fingerprint,motion,camera};this.sceneData=scene;
   }
   if(capture!==e.capture||key!==this.requestKey())throw new Error('Camera inputs changed. Reviewing the updated request…');
   const t=clone(e.sequence.timeline),keep=t.segments.length>1&&this.keep.checked,ranges=instructionRanges(t,ids,keep),locks=boundaryLocks(e,ids);
   const context=compactContext(scene.motion,t,scene.camera,ranges,keep,locks,e.capture.camera.aspect);
   const requestId=crypto.randomUUID(),payload={protocol_version:2,request_id:requestId,model:this.model.value,system_prompt:this.system.value,user_prompt:this.user.value,context};
   this.status.textContent='Preparing camera request…';
   const response=await api.fetchApi('/cartwheel/camera-instructions/review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}),body=await response.json();
   if(!response.ok)throw new Error(body.error||'Camera cost review failed. No model request was sent.');
   if(key!==this.requestKey())throw new Error('Camera inputs changed. Reviewing the updated request…');
   if(!body.review_id||body.review?.model_calls!==1)throw new Error('Camera request failed the single-request check. No model request was sent.');
   const prepared={fingerprint,key,ids,keep,context,locks,requestId,reviewId:body.review_id,review:body.review,expires:Date.now()+body.expires_in*1000,original:clone(e.settings),world:this.world};
   this.prepared=prepared;this.failedFingerprint=null;this.generate.textContent='Submit camera job';
   this.status.textContent=this.notice??'';
   const option=document.createElement('option');option.value='0';option.textContent=`Whole clip · ${context.duration.toFixed(2)}s · 1 cm motion reference`;this.dataSelect.replaceChildren(option);this.showData();return prepared;
  }catch(error){this.prepared=null;this.failedFingerprint=key;this.status.textContent=error.message;}
  finally{if(capture===e.capture)e.setTime(restore);this.preparing=false;this.sync();}
 }
 showData(){this.data.value=this.prepared?JSON.stringify(this.prepared.context,null,2):'';}
 async run(){
  if(!this.submissionsEnabled){this.status.textContent=this.pauseReason;return;}
  if(this.running||this.starting||!this.user.value.trim()||!this.system.value.trim()){if(!this.user.value.trim())this.status.textContent='Describe the camera animation you want.';return;}
  if(this.preparing){this.status.textContent='Preparing camera request…';return;}
  clearTimeout(this.prepareTimer);this.notice=null;this.completionKey=null;this.starting=true;this.sync();let prepared;try{prepared=await this.prepare(true);}finally{this.starting=false;this.sync();}if(!prepared)return;
  if(prepared.key!==this.requestKey()||prepared.review?.model_calls!==1){this.status.textContent='Camera inputs changed or failed the single-request check. No model request was sent.';return;}
  this.persist();this.running=true;this.abort=new AbortController();this.sync();
  try{
   if(this.abort.signal.aborted)throw new Error('Stopped. No camera changes were applied.');
   const response=await api.fetchApi('/cartwheel/camera-instructions/prepare',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({protocol_version:2,request_id:prepared.requestId,review_id:prepared.reviewId})}),body=await response.json();
   if(!response.ok)throw new Error(body.error||'Camera request could not be prepared.');
   if(prepared.key!==this.requestKey())throw new Error('Camera inputs changed before submission. No model request was sent.');
   this.status.textContent='Creating camera animation…';
   const result=await queuedInstruction(body.graph,prepared.requestId,this.abort.signal);
   if(prepared.fingerprint!==this.fingerprint())throw new Error('The scene changed while the model was working. No camera settings were overwritten.');
   if(result?.schema_version!==2||!Array.isArray(result.groups)||result.groups.length!==prepared.context.allowed_ranges.length)throw new Error('The model returned invalid camera scope. Your scene has not changed.');
   const candidate=compileInstructions(prepared.original,result.groups,prepared.locks,this.editor.capture.actors.map(a=>a.number));
   this.commitChanges(candidate,prepared);this.completionKey=this.requestKey();
   this.status.textContent='';
  }catch(error){this.notice=error.message;this.status.textContent=error.message;}
  finally{this.prepared=this.completionKey?null:prepared;this.failedFingerprint=null;this.running=false;this.sync();}
 }
 commitChanges(candidate,prepared){
  const e=this.editor,before=JSON.stringify(prepared.original);
  if(e.renderController)throw new Error('A camera render is running. No camera changes were applied.');
  // Build and persist the complete candidate before recording one Undo step.
  // Roll back if local rendering/persistence fails; failed jobs never replace a shot.
  try{e.settings=candidate;e.sequence.refresh();}
  catch(error){e.settings=clone(prepared.original);try{e.sequence.refresh();}catch{}throw error;}
  e.sequence.record(before);e.sequence.sync();
  if(prepared.original.camera_timeline?.segments.length===1&&candidate.camera_timeline?.segments.length>1){this.keep.checked=true;this.persist();}
  this.prepared=null;this.sceneData=null;this.failedFingerprint=null;
 }
 dispose(){clearTimeout(this.prepareTimer);this.abort?.abort();this.panel.remove();}
}
