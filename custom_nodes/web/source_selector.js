import { app } from "../../scripts/app.js";
import { syncMotionSources, normalizeMotionSource, cleanMotionSourceInputs } from "./source_selector_state.js";

const isSelector = node => (node.comfyClass ?? node.type) === "CartwheelMotionSource";
let configuring = false, syncing = false;
function sync() {
  if (configuring || syncing) return;
  syncing = true;
  try {
    const selectors = (app.graph?._nodes ?? []).filter(isSelector);
    for (const selector of selectors) {
      const source = selector.widgets?.find(w => w.name === "source");
      if (source) source.value = normalizeMotionSource(source.value);
    }
    // Mute retired output roots before disconnecting their old sockets.
    let changed = syncMotionSources(selectors);
    for (const selector of selectors) changed = cleanMotionSourceInputs(selector) || changed;
    if (changed) {
      app.graph?.incrementVersion?.();
      app.graph?.setDirtyCanvas?.(true, true);
    }
    for (const node of selectors) node.cartwheelSourceStatus?.();
  } finally { syncing = false; }
}

app.registerExtension({
  name: "Cartwheel.MotionSource",
  beforeConfigureGraph() { configuring = true; },
  afterConfigureGraph() { configuring = false; sync(); },
  nodeCreated(node) {
    if (!isSelector(node)) return;
    const source = node.widgets.find(widget => widget.name === "source");
    const status = document.createElement("div");
    Object.assign(status.style, { padding: "8px 12px", font: "12px/1.4 system-ui", color: "#d7e5ee", boxSizing: "border-box" });
    node.cartwheelSourceStatus = () => {
      status.textContent = `${source.value} selected. Other connected source nodes are muted automatically.`;
    };
    node.addDOMWidget("source_status", "cartwheel_source_status", status, { serialize: false, getMinHeight: () => 64, getHeight: () => 64 });
    const callback = source.callback;
    source.callback = function () { callback?.apply(this, arguments); sync(); };
    const queued = source.beforeQueued;
    source.beforeQueued = function () { queued?.apply(this, arguments); sync(); };
    const connected = node.onConnectionsChange;
    node.onConnectionsChange = function () { connected?.apply(this, arguments); sync(); };
    node.cartwheelSourceStatus();
    node.setSize([440, 240]);
  },
});
