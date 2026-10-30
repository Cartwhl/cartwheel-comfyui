// Source nodes are also output roots. Lazy input selection alone cannot stop
// unused captures, so keep those roots muted before a graph is submitted.
export const SOURCE_INPUTS = {
  "Performance Capture": "fresh_motion",
  "Swing Choreo": "swing_motion",
  "Load motion": "uploaded_motion",
};
export const normalizeMotionSource = value => ({
  "Fresh Comic video": "Performance Capture",
  "Swing Choreo (coming soon)": "Swing Choreo",
  "Uploaded GLB motion": "Load motion", "Cartwheel history":"Load motion",
}[value] ?? value);
const SOURCE_TYPES = new Set([
  "CartwheelPerformanceCapture", "CartwheelSwingChoreo", "CartwheelLoadHistory",
  "CartwheelLoadCapture", "CartwheelLoadMotionAndCamera",
]);
const kind = node => node.comfyClass ?? node.type;

function ancestors(selector, inputName) {
  const result = new Set(), seen = new Set([selector]);
  const visit = node => {
    if (!node || seen.has(node)) return;
    seen.add(node); result.add(node);
    for (let i = 0; i < (node.inputs?.length ?? 0); i++) visit(node.getInputNode(i));
  };
  const index = selector.inputs?.findIndex(input => input.name === inputName) ?? -1;
  if (index >= 0) visit(selector.getInputNode(index));
  return result;
}

export function syncMotionSources(selectors) {
  // Aggregate before mutating: shared sources stay enabled if any active
  // selector requests them. The rest of the workflow is left alone.
  const managed = new Set(), selected = new Set(), selectedAncestors = new Set();
  for (const selector of selectors) {
    const value = selector.widgets?.find(w => w.name === "source")?.value;
    const inputName = SOURCE_INPUTS[normalizeMotionSource(value)];
    for (const branch of [...Object.values(SOURCE_INPUTS),"history_motion"]) {
      const nodes = ancestors(selector, branch);
      for (const node of nodes) if (SOURCE_TYPES.has(kind(node))) managed.add(node);
      if (selector.mode === 0 && branch === inputName) {
        for (const node of nodes) selectedAncestors.add(node);
        for (const node of nodes) if (SOURCE_TYPES.has(kind(node))) selected.add(node);
      }
    }
  }
  let changed = false;
  for (const node of managed) {
    const mode = selected.has(node) ? 0 : 2;
    if (node.mode !== mode) { node.mode = mode; changed = true; }
  }
  // Also activate the chosen source's file loader/trim chain, including
  // branches that were muted in an older saved workflow.
  for (const node of selectedAncestors) {
    if (!managed.has(node) && (node.mode === 2 || node.mode === 4)) {
      node.mode = 0; changed = true;
    }
  }
  return changed;
}

// Old workflows retain removed sockets. removeInput also updates link slots.
export function cleanMotionSourceInputs(selector) {
  let changed = false;
  for (let i = (selector.inputs?.length ?? 0) - 1; i >= 0; i--) {
    if (selector.inputs[i].name === "history_motion") {
      selector.removeInput(i);
      changed = true;
    }
  }
  const labels = {fresh_motion:"Performance Capture", swing_motion:"Swing Choreo", uploaded_motion:"Load motion · Upload / Saved jobs"};
  for (const input of selector.inputs ?? []) {
    if (labels[input.name] && input.label !== labels[input.name]) {
      input.label = labels[input.name]; changed = true;
    }
  }
  const source = selector.widgets?.find(w => w.name === "source");
  if (source?.options) source.options.values = Object.keys(SOURCE_INPUTS);
  return changed;
}
