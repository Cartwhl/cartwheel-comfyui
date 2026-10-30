// Adapter for the pinned Three.js 0.180 TransformControls hierarchy. Remove the
// negative heads AND their pickers so invisible arrows cannot intercept a drag.
export function positiveTranslateAxes(control) {
  let gizmo;
  control.getHelper().traverse(object => { if (object.gizmo?.translate && object.picker?.translate) gizmo = object; });
  if (!gizmo) throw new Error('The translation gizmo layout is unsupported.');
  for (const group of [gizmo.gizmo.translate, gizmo.picker.translate]) {
    for (const handle of [...group.children]) {
      if (!['X','Y','Z'].includes(handle.name)) continue;
      handle.geometry.computeBoundingBox();
      const bounds = handle.geometry.boundingBox, axis = handle.name.toLowerCase();
      if ((bounds.min[axis] + bounds.max[axis]) / 2 < -0.0001) {
        group.remove(handle); handle.geometry.dispose();
      }
    }
  }
}
