// One-based UI frames map to the same zero-based samples as VIDEO encoding.
// Keep seconds in the camera contract; FPS belongs to the preview/render grid.
export function frameGrid(duration, fps) {
  const rate = Number(fps);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("A positive timeline frame rate is required.");
  const seconds = Number.isFinite(duration) && duration > 0 ? duration : 0;
  return { fps: rate, duration: seconds, count: Math.ceil(seconds * rate) };
}
export function frameAtTime(seconds, grid, nearest = false) {
  if (!grid.count) return 0;
  // Absorb floating-point roundoff at an exact frame boundary without moving
  // a meaningful fractional frame into the next frame during playback.
  const sample = Math.max(0, Math.min(seconds, grid.duration)) * grid.fps;
  const index = nearest ? Math.round(sample) : Math.floor(sample + 1e-8);
  return Math.max(1, Math.min(grid.count, index + 1));
}
export function timeAtFrame(frame, grid) {
  if (!grid.count) return 0;
  return (Math.max(1, Math.min(grid.count, Math.round(frame))) - 1) / grid.fps;
}
export function frameReadout(seconds, grid) {
  const duration = Number(grid.duration.toFixed(3));
  return `${frameAtTime(seconds, grid)} / ${grid.count} frames · ${duration}s`;
}
