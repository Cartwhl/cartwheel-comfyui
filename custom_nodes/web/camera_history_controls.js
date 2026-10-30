import { api } from "../../scripts/api.js";
import { HistoryPicker } from "./history_picker.js";
import { defaultEditorSettings } from "./editor_settings.js";

const style = document.createElement("link");
style.rel = "stylesheet";
style.href = new URL("./history.css", import.meta.url).href;
document.head.append(style);

export class CameraHistoryControls {
  constructor(editor) {
    this.editor = editor;
    this.draft = { motion_id: "", source_actor: 1, reference_actor: 1, timing: "stretch" };
    this.element = document.createElement("div");
    this.element.className = "cw-history-camera";
    const owner = this;
    const widget = { name: "motion_id", get value() { return owner.draft.motion_id; }, set value(value) { owner.draft.motion_id = value; } };
    const proxy = { widgets: [widget], properties: editor.node.properties.cartwheel_camera_history ??= {}, graph: editor.node.graph };
    this.picker = new HistoryPicker(proxy, async (token, signal) => {
      const response = await api.fetchApi(`/cartwheel/history${token ? `?${new URLSearchParams({ next_token: token })}` : ""}`, { signal, cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Camera history could not be loaded.");
      return result;
    }, {
      title: "Choose a captured camera", listLabel: "Camera history captures",
      acceptItem: item => item.has_camera && item.actors > 0,
      selectionText: item => item ? `Selected: ${item.title}. Choose alignment, then Load camera.` : "Choose a completed capture with a camera.",
      onSelect: item => { this.sourceActors = Array.from({ length: Math.min(4, Math.max(1, item.actors)) }, (_, i) => i + 1); this.draft.source_actor = 1; this.sync(); },
    });
    this.fields = document.createElement("div");
    this.fields.className = "cw-preset-grid";
    this.fields.innerHTML = `<label class="cw-preset-field"><span>Camera source actor</span><select aria-label="Camera source actor"></select></label><label class="cw-preset-field"><span>Motion reference actor</span><select aria-label="Motion reference actor"></select></label><label class="cw-preset-field"><span>Camera timing</span><select aria-label="Camera timing"><option value="stretch">Fit motion duration</option><option value="hold">Original speed · hold at end</option></select></label>`;
    this.source = this.fields.querySelector('[aria-label="Camera source actor"]');
    this.reference = this.fields.querySelector('[aria-label="Motion reference actor"]');
    this.timing = this.fields.querySelector('[aria-label="Camera timing"]');
    this.source.onchange = () => { this.draft.source_actor = Number(this.source.value); };
    this.reference.onchange = () => { this.draft.reference_actor = Number(this.reference.value); };
    this.timing.onchange = () => { this.draft.timing = this.timing.value; };
    this.load = document.createElement("button");
    this.load.textContent = "Load camera";
    this.load.onclick = () => this.loadCamera();
    this.status = document.createElement("p");
    this.status.setAttribute("role", "status");
    this.element.append(this.picker.element, this.fields, this.load, this.status);
  }

  open() {
    this.editor.choosingHistory = true;
    this.editor.presets.activateTab("camera");
    this.editor.syncControls();
    if (!this.picker.items.size) this.picker.load(true);
  }

  sync() {
    const e = this.editor;
    this.picker.node.properties = e.node.properties.cartwheel_camera_history ??= {};
    this.element.hidden = !(e.choosingHistory || e.settings.mode === "history");
    if (this.element.hidden) return;
    const selected = e.settings.history_camera;
    if (selected && this.restoredSelection !== JSON.stringify(selected)) {
      this.draft = structuredClone(selected);
      this.restoredSelection = JSON.stringify(selected);
      this.picker.restore();
      this.picker.drawList();
    }
    const actors = e.capture?.actors.map(a => a.number) ?? [];
    if (!actors.includes(this.draft.reference_actor)) this.draft.reference_actor = actors[0] ?? 1;
    const options = (input, ids, value) => {
      input.replaceChildren(...ids.map(id => { const o = document.createElement("option"); o.value = id; o.textContent = `Actor ${id}`; return o; }));
      input.value = String(value);
    };
    options(this.source, this.sourceActors ?? [1, 2, 3, 4], this.draft.source_actor);
    options(this.reference, actors, this.draft.reference_actor);
    this.timing.value = this.draft.timing;
    this.load.disabled = !e.capture || !this.draft.motion_id || this.busy;
    this.picker.refresh.disabled = this.picker.busy;
    this.picker.more.disabled = this.picker.busy || !this.picker.nextToken;
    this.status.textContent = this.busy ? "Loading camera assets…" : e.settings.mode === "history"
      ? "Imported camera active. Alignment uses frame one; distance and lens are preserved. Changes above apply when you click Load camera."
      : "The current camera stays visible until a history camera is loaded. No new capture is submitted.";
  }

  cancel() { this.controller?.abort(); this.busy = false; this.element.inert=false; this.editor.choosingHistory = false; }

  async loadCamera() {
    if (this.busy || !this.draft.motion_id) return;
    const e = this.editor, selected = structuredClone(this.draft);
    this.controller?.abort();
    const controller = this.controller = new AbortController();
    this.busy = true; this.element.inert=true; this.sync();
    let loaded=false;
    try {
      const response = await api.fetchApi("/cartwheel/camera/history", { method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ motion_camera: e.motion.scene.motion_camera ?? e.motion.scene.camera, selection: selected }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The history camera could not be loaded.");
      if (controller.signal.aborted || this.disposed) return;
      const settings = { ...defaultEditorSettings(), mode: "history", history_camera: result.selection, output_frame: structuredClone(e.settings.output_frame) };
      this.sourceActors = result.source_actors;
      await e.loadMotion(result.motion, settings);
      loaded=true;
      e.node.graph?.incrementVersion?.(); e.node.graph?.afterChange?.(e.node);
      e.hint.textContent = `Loaded camera: ${result.title}. Run to update the VIDEO output.`;
    } catch (error) {
      if (!controller.signal.aborted && !this.disposed) this.status.textContent = error.message;
    } finally {
      if (this.controller === controller && !this.disposed) { this.busy = false; this.element.inert=false; this.load.disabled = !this.draft.motion_id; if(loaded)this.sync(); }
    }
  }

  dispose() { this.disposed = true; this.cancel(); this.picker.dispose(); }
}
