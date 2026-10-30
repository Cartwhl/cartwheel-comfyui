import { app } from "../../scripts/app.js";

// Append new sockets when reopening a workflow saved with an older loader.
const offsets = { CartwheelPerformanceCapture: 4, CartwheelLoadHistory: 1, CartwheelLoadCapture: 1 };
const sockets = [["source_video", "VIDEO"], ["source_info", "STRING"], ["source_fps", "FLOAT"], ["source_frames", "INT"], ["source_duration", "FLOAT"]];
app.registerExtension({
  name: "Cartwheel.SourceOutputs",
  loadedGraphNode(node) {
    const offset = offsets[node.comfyClass ?? node.type];
    if (offset === undefined) return;
    for (const [i, [name, type]] of sockets.entries()) {
      if (node.outputs?.[offset + i]?.name === name) continue;
      if ((node.outputs?.length ?? 0) !== offset + i) break;
      node.addOutput(name, type);
    }
  },
});
