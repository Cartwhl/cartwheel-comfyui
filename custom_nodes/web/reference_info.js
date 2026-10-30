import { app } from "../../scripts/app.js";
import { referenceEnabled } from "./reference_toggle_state.js";
import { REFERENCE_LIMITS_NOTICE } from "./reference_limits_notice.js";
import { connectFrameImageControl } from "./frame_image_control.js";
import { connectCameraPasses, installCameraPassToggles, restoreCameraPassToggles, cameraVideoReferences, CAMERA_VIDEO_TOGGLES } from "./reference_pass_controls.js";

const limits = { "Seedance 2.5": 30, "MiniMax H3": 15 };
const addedOutputs = [["secondary_video", "VIDEO"], ["use_h3", "BOOLEAN"]];
const addedInputs = [["secondary_video", "VIDEO"], ["reference_audio", "AUDIO"], ["depth_video", "VIDEO"], ["normal_video", "VIDEO"], ["pose_video", "VIDEO"]];
const kind = node => node.comfyClass ?? node.type;
function ensureReferenceInputs(node) {
  for (const [name, type] of addedInputs) {
    if (!node.inputs?.some(input => input.name === name)) node.addInput(name, type);
  }
}
function removeOriginalInput(node) {
  const index = node.inputs?.findIndex(input => input.name === "source_video") ?? -1;
  if (index >= 0) node.removeInput(index);
  const labels = {control_video:"control_video",reference_image:"Reference image",secondary_video:"secondary_video",reference_audio:"Reference audio",source_audio:"Reference audio"};
  for (const socket of [...(node.inputs ?? []), ...(node.outputs ?? [])]) {
    if (labels[socket.name]) socket.label = labels[socket.name];
  }
}

app.registerExtension({
  name: "Cartwheel.ReferenceInfo",
  afterConfigureGraph() {
    // Saved slots can be restored after a node's individual onConfigure hook.
    // Clean up once graph configuration has finished, including pasted graphs.
    for (const node of app.graph?._nodes ?? []) {
      if (kind(node) === "CartwheelPrepareVideoReferences") { removeOriginalInput(node); ensureReferenceInputs(node); connectCameraPasses(node); }
    }
    connectFrameImageControl(app.graph?._nodes ?? []);
    app.graph?.setDirtyCanvas?.(true, true);
  },
  loadedGraphNode(node) {
    if (kind(node) !== "CartwheelPrepareVideoReferences") return;
    removeOriginalInput(node);
    for (const [i, [name, type]] of addedOutputs.entries()) {
      if (!node.outputs?.some(output => output.name === name) && node.outputs?.length === 7 + i) node.addOutput(name, type);
    }
    ensureReferenceInputs(node);
  },
  nodeCreated(node) {
    if (kind(node) !== "CartwheelPrepareVideoReferences") return;
    removeOriginalInput(node);
    const status = document.createElement("div");
    Object.assign(status.style, { padding: "10px", whiteSpace: "pre-wrap", color: "#c5d8e9", font: "12px/1.5 system-ui", boxSizing: "border-box" });
    const widget = name => node.widgets?.find(item => item.name === name);
    let lastInfo = null;
    installCameraPassToggles(node);
    function update() {
      window.dispatchEvent(new Event('cartwheel-reference-layout'));
      const model = widget("model")?.value ?? "Seedance 2.5";
      const max = limits[model] ?? 30;
      const cameraVideos=cameraVideoReferences(node);
      const referenceMap=cameraVideos.length ? cameraVideos.map((name,index)=>`Video ${index+1}: ${name}`).join(' · ') : 'No camera videos enabled.';
      const passNote=`${referenceMap}\n${model}: up to ${model==='MiniMax H3'?3:10} videos totaling ${max}s, including creative references. ${REFERENCE_LIMITS_NOTICE}\nCamera cuts and complex transitions may be interpreted differently by the selected video model.`;
      for (const name of ["reference_duration", "secondary_duration", "output_duration"]) {
        const input = widget(name);
        if (input?.options) input.options.max = max;
        if (input && Number(input.value) > max) input.value = max;
      }
      const second = referenceEnabled(node, "use_secondary_video") && node.inputs?.some(input => input.name === "secondary_video" && input.link != null);
      const start = Number(widget("start_seconds")?.value ?? 0);
      const duration = Number(widget("reference_duration")?.value ?? 0);
      const end = Number(widget("end_seconds")?.value ?? 0);
      const selection = end ? `${start}s to ${end}s` : `${start}s + ${duration ? `${duration}s` : "maximum available"}`;
      const hint = `${model} · ${max}s total video allowance${second ? " shared with the secondary video" : ""}.\nSelection: ${selection}. Capped to remaining footage and model allowance.\nuse_h3 → final If/Else Switch: false = Seedance, true = H3. No uploads or generation here.`;
      const values = [model, start, duration, end, Number(widget("secondary_start_seconds")?.value ?? 0), Number(widget("secondary_duration")?.value ?? 0), Number(widget("output_duration")?.value ?? 0), ...["use_reference_image","use_secondary_video","use_reference_audio"].map(name => referenceEnabled(node, name))];
      values.push(...CAMERA_VIDEO_TOGGLES.map(([name])=>widget(name)?.value),widget('use_original_audio')?.value,widget('use_endpoint_images')?.value);
      const currentKey = JSON.stringify(values);
      const executed = lastInfo?.key === currentKey ? lastInfo.info : null;
      const collection=node.inputs?.some(input=>input.name==='reference_library' && input.link!=null);
      const legacyInputs={use_reference_image:'reference_image',use_secondary_video:'secondary_video',use_reference_audio:'reference_audio',secondary_start_seconds:'secondary_video',secondary_duration:'secondary_video',audio_start_seconds:'reference_audio'};
      for(const [name,socket] of Object.entries(legacyInputs)){
        const w=widget(name);if(!w)continue;
        const hidden=collection&&!node.inputs?.some(input=>input.name===socket&&input.link!=null);
        if(hidden){if(!w.cartwheelOriginalWidget)w.cartwheelOriginalWidget={type:w.type,computeSize:w.computeSize};w.type='converted-widget';w.computeSize=()=>[0,-4];}
        else if(w.cartwheelOriginalWidget){w.type=w.cartwheelOriginalWidget.type;w.computeSize=w.cartwheelOriginalWidget.computeSize;delete w.cartwheelOriginalWidget;}
      }
      if(collection){
        status.textContent=`${model} · ${max}s shared video allowance; audio separately shares ${max}s.\nSelection: ${selection}. ${passNote}\nAutomatic windows share the budget.\nAdd files and toggle them individually in Creative References. No uploads to model services or generation occur here.`+(executed?`\nPrepared: ${executed.image_count} images · ${executed.video_count} videos · ${executed.audio_count} audios · ${executed.output_duration}s requested → ${executed.delivery_duration??executed.reference_duration}s delivered · ${executed.camera_reference??'Edited camera video'}${executed.use_original_audio?(executed.original_audio_available?' · original audio restored':' · original audio unavailable'):''}${executed.notices?.length?'\n'+executed.notices.join('\n'):''}`:``);
        return currentKey;
      }
      const automatic = (app.graph?._nodes ?? []).some(gate => String(gate.properties?.cartwheel_reference_gate?.prepare) === String(node.id));
      const referenceHint = automatic ? "Optional references: use the three toggles above. Off retains the file, skips its preparation and omits it from generation automatically." : "Optional references: use the three toggles above. Leave unused optional model reference inputs disconnected in hand-wired workflows.";
      status.textContent = hint + '\n' + passNote + (executed ? `\nLast prepared: ${executed.reference_start.toFixed(2)}–${executed.reference_end.toFixed(2)}s · Output ${executed.output_duration}s${executed.secondary_video ? ` · Secondary video: ${executed.secondary_video.duration.toFixed(2)}s` : ""}\n${executed.has_audio ? "Explicit audio reference ready." : (automatic ? "No audio reference enabled." : "No audio: leave model audio disconnected.")}${executed.notices.length ? `\n${executed.notices.join("\n")}` : ""}` : `\n${referenceHint}`);
      node.setDirtyCanvas?.(true, true);
      return currentKey;
    }
    node.addDOMWidget("reference_status", "cartwheel_reference_status", status, { serialize: false, getMinHeight: () => 185, getHeight: () => 225 });
    for (const name of ["model", "start_seconds", "reference_duration", "end_seconds", "secondary_start_seconds", "secondary_duration", "output_duration","camera_reference","use_original_audio","use_endpoint_images",...CAMERA_VIDEO_TOGGLES.map(([name])=>name)]) {
      const input = widget(name);
      if (!input) continue;
      const callback = input.callback;
      input.callback = function (...args) { const value = callback?.apply(this, args); update(); return value; };
    }
    const connected = node.onConnectionsChange;
    node.onConnectionsChange = function (...args) { connected?.apply(this, args); update(); };
    const configured = node.onConfigure;
    node.onConfigure = function (...args) { configured?.apply(this, args); removeOriginalInput(node); restoreCameraPassToggles(node,args[0]); queueMicrotask(update); };
    const executed = node.onExecuted;
    node.onExecuted = function (message) {
      executed?.apply(this, arguments);
      const info = message.cartwheel_reference_info?.[0];
      if (!info) return;
      lastInfo = { key: update(), info: { reference_end: info.reference_start + info.reference_duration, notices: [], ...info } };
      update();
    };
    const serialized=node.onSerialize;
    node.onSerialize=function(data){serialized?.apply(this,arguments);data.properties??={};data.properties.cartwheel_camera_video_toggles=1;};
    update();
  },
});
