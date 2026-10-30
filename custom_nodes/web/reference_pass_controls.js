export const CAMERA_VIDEO_TOGGLES = [
  ['use_camera_video', 'Edited camera video', true, 'Color'],
  ['use_depth', 'Depth pass', false, 'Depth'],
  ['use_normal', 'Normal pass', false, 'Normal'],
  ['use_pose', 'Pose pass', false, 'Pose'],
];
const value = (node,name) => node?.widgets?.find(widget => widget.name === name);
const enabled = v => v === true || v === 1 || v === 'true';

export function cameraVideoReferences(node) {
  if (!node) return [];
  const legacy=value(node,'camera_reference')?.value ?? 'Color';
  return CAMERA_VIDEO_TOGGLES.filter(([name,,,old]) => {
    const widget=value(node,name);
    return widget ? enabled(widget.value) : legacy===old;
  }).map(([,label]) => label);
}

export function installCameraPassToggles(node) {
  const legacy=value(node,'camera_reference');
  if (legacy) { legacy.type='converted-widget'; legacy.computeSize=()=>[0,-4]; }
  for (const [name,,initial] of CAMERA_VIDEO_TOGGLES) {
    if (!value(node,name)) node.addWidget('toggle',name,initial,()=>{},{});
  }
}

export function restoreCameraPassToggles(node,data) {
  installCameraPassToggles(node);
  // Old saves used a single selector and may have DOM placeholders after it.
  // Read that saved selector, rather than treating placeholders as new booleans.
  if (!data?.properties?.cartwheel_camera_video_toggles) {
    const legacy=data?.widgets_values?.[13] ?? value(node,'camera_reference')?.value ?? 'Color';
    for (const [name,,,old] of CAMERA_VIDEO_TOGGLES) value(node,name).value=legacy===old;
  }
  node.properties ??= {};
  node.properties.cartwheel_camera_video_toggles=1;
}

export function connectCameraPasses(node) {
  const control = node.inputs?.findIndex(input => input.name === 'control_video') ?? -1;
  if (control < 0) return;
  const camera = node.getInputNode?.(control);
  if ((camera?.comfyClass ?? camera?.type) !== 'CartwheelCameraPreview') return;
  for (const kind of ['depth', 'normal', 'pose']) {
    const input = node.inputs.findIndex(input => input.name === kind + '_video');
    const output = camera.outputs?.findIndex(socket => socket.name === kind) ?? -1;
    if (input >= 0 && output >= 0 && node.inputs[input].link == null) camera.connect(output, node, input);
  }
}

