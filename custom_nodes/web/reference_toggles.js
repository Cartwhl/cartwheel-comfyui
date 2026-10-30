import { app } from "../../scripts/app.js";
import { REFERENCES, syncReferenceToggles } from "./reference_toggle_state.js";

const isPreparation = n => (n.comfyClass ?? n.type) === "CartwheelPrepareVideoReferences";
let configuring = false, syncing = false;
function sync() {
  if (configuring || syncing) return;
  syncing = true;
  try {
    const nodes = app.graph?._nodes ?? [];
    if (syncReferenceToggles(nodes.filter(isPreparation), nodes)) {
      app.graph?.incrementVersion?.(); app.graph?.setDirtyCanvas?.(true, true);
    }
  } finally { syncing = false; }
}
app.registerExtension({
  name: "Cartwheel.ReferenceToggles",
  beforeConfigureGraph() { configuring = true; },
  afterConfigureGraph() { configuring = false; sync(); },
  nodeCreated(node) {
    if (!isPreparation(node)) return;
    for (const ref of REFERENCES) {
      const widget = node.widgets.find(w => w.name === ref.toggle);
      if (!widget) continue;
      const callback = widget.callback, queued = widget.beforeQueued;
      widget.callback = function () { callback?.apply(this, arguments); sync(); };
      widget.beforeQueued = function () { queued?.apply(this, arguments); sync(); };
    }
    const connected = node.onConnectionsChange;
    node.onConnectionsChange = function () { connected?.apply(this, arguments); sync(); };
  },
});
