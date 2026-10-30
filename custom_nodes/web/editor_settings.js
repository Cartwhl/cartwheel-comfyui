import { DEFAULT_OUTPUT_FRAME } from "./camera_format.js";

export const defaultEditorSettings = () => ({ schema_version: 1, mode: "captured", camera_index: 0, target_actor: null, start: null, end: null, manual_path: null, world_frame_id: null, preset: null, history_camera: null, output_frame: { ...DEFAULT_OUTPUT_FRAME } });
export const CAPTURE_CHANGED_NOTICE = "New motion loaded. Previous camera edits were reset to this motion’s starting camera. Click Edit camera to create a shot for this motion.";

// Used before loading saved scenes and render requests, so the live camera and
// hidden serialized settings agree with the backend's editor-only reset.
export function settingsForMotion(value, motion) {
  const previous = typeof value === "string" ? JSON.parse(value) : structuredClone(value);
  const frame=previous.camera_timeline?.world_frame_id??previous.world_frame_id;
  const changed = previous.schema_version === 1 && (["bookends", "preset"].includes(previous.mode)||previous.camera_timeline)
    && typeof frame === "string" && frame.length > 0
    && frame !== motion.world_frame.id;
  return { settings: changed ? { ...defaultEditorSettings(), output_frame: previous.output_frame ?? { ...DEFAULT_OUTPUT_FRAME } } : previous,
    changed, notice: changed ? CAPTURE_CHANGED_NOTICE : null };
}
