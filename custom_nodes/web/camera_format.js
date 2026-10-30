export const DEFAULT_OUTPUT_FRAME = { orientation: "original", ratio: "16:9" };
export const RATIOS = { "16:9": 16 / 9, "4:3": 4 / 3, "1:1": 1, "21:9": 21 / 9 };
export function outputAspect(settings, nativeAspect) {
  const frame = { ...DEFAULT_OUTPUT_FRAME, ...settings?.output_frame };
  if (frame.orientation === "original") return nativeAspect;
  const aspect = RATIOS[frame.ratio];
  if (!aspect || !["landscape", "portrait"].includes(frame.orientation)) throw new Error("Choose a supported output orientation and aspect ratio.");
  return frame.orientation === "portrait" ? 1 / aspect : aspect;
}
export function cameraAspect(capture, settings) {
  return outputAspect(settings, capture.cameraMetadata?.[capture.cameraIndex ?? 0]?.aspect ?? capture.camera.aspect);
}
