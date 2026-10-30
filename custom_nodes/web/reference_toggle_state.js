export const REFERENCES = [
  { input: "reference_image", toggle: "use_reference_image", output: 1 },
  { input: "secondary_video", toggle: "use_secondary_video", output: 7 },
  { input: "reference_audio", toggle: "use_reference_audio", output: 2 },
];
const kind = node => node.comfyClass ?? node.type;
const LOADERS = new Set(["LoadImage", "LoadVideo", "LoadAudio"]);

export function referenceEnabled(node, name) {
  const widget = node.widgets?.find(w => w.name === name);
  // Older saves contain an empty DOM-widget placeholder in this slot. The
  // Boolean serializer sends that value as false; delivery must agree with it.
  // A missing widget preserves the behavior of pre-toggle workflows.
  if (!widget) return true;
  const enabled = widget.value === true || widget.value === 1 || widget.value === "true";
  if (widget.value !== enabled) widget.value = enabled;
  return enabled;
}

export function syncReferenceToggles(preparations, nodes) {
  const desiredLoaders = new Map(), optionalEdges = new Set();
  let changed = false;
  for (const node of preparations) for (const ref of REFERENCES) {
    const index = node.inputs?.findIndex(i => i.name === ref.input) ?? -1;
    if (index < 0) continue;
    optionalEdges.add(`${node.id}:${index}`);
    const loader = node.getInputNode(index);
    const enabled = referenceEnabled(node, ref.toggle);
    if (loader && LOADERS.has(kind(loader)))
      desiredLoaders.set(loader, (desiredLoaders.get(loader) ?? false) || enabled);
    // Only tagged delivery gates belong to this automatic setup. Preserve
    // existing hand-wired switches and previously saved workflows.
    for (const gate of nodes) {
      const owner = gate.properties?.cartwheel_reference_gate;
      if (String(owner?.prepare) !== String(node.id) || owner?.input !== ref.input) continue;
      const mode = enabled && Boolean(loader) ? 0 : 2;
      if (gate.mode !== mode) { gate.mode = mode; changed = true; }
    }
  }
  for (const [loader, enabled] of desiredLoaders) {
    // If this loader is shared with the primary video or another workflow
    // output, leave its mode alone. Lazy selection still skips this reference.
    const graph = loader.graph;
    const otherUse = (loader.outputs ?? []).some(output => (output.links ?? []).some(id => {
      const link = graph?.links?.get?.(id) ?? graph?.links?.[id];
      return link && !optionalEdges.has(`${link.target_id}:${link.target_slot}`);
    }));
    if (otherUse) continue;
    const mode = enabled ? 0 : 2;
    if (loader.mode !== mode) { loader.mode = mode; changed = true; }
  }
  return changed;
}
