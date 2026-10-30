import assert from "node:assert/strict";
import { defaultEditorSettings, settingsForMotion } from "../web/editor_settings.js";

const motion = { world_frame: { id: "new" } };
const output_frame = { orientation: "portrait", ratio: "4:3" };
for (const mode of ["preset", "bookends"]) {
  const old = { ...defaultEditorSettings(), mode, world_frame_id: "old", camera_index: 5,
    target_actor: 4, preset: { actors: [3, 4], reference_time: 90 },
    start: { position: [100, 2, 3] }, end: {}, output_frame };
  const before = structuredClone(old);
  const result = settingsForMotion(JSON.stringify(old), motion);
  assert.equal(result.changed, true);
  assert.match(result.notice, /Previous camera edits were reset/);
  assert.deepEqual(result.settings, { ...defaultEditorSettings(), output_frame });
  assert.deepEqual(old, before);
  const same = settingsForMotion(old, { world_frame: { id: "old" } });
  assert.equal(same.changed, false);
  assert.deepEqual(same.settings, old);
  same.settings.preset.actors.push(9);
  assert.deepEqual(old, before);
}
const captured = { ...defaultEditorSettings(), output_frame };
assert.deepEqual(settingsForMotion(captured, motion).settings, captured);
assert.equal(settingsForMotion(captured, motion).notice, null);
// A missing identity is not evidence of a different capture; the backend
// must still reject malformed edits instead of treating them as a switch.
assert.equal(settingsForMotion({ ...captured, mode: "preset" }, motion).changed, false);
assert.equal(settingsForMotion({ ...captured, schema_version: 2, mode: "preset", world_frame_id: "old" }, motion).changed, false);
console.log("Foreign edits reset; same-motion edits and output format survive; source settings are not mutated.");

const {nearestFramingReference}=await import('../web/shot_controls.js');
for(const [x,y,key] of [[.1,.1,'upper_left'],[.8,.7,'lower_right'],[.5,.5,'center'],[.49,.3,'upper_third']]) {const p={frame_reference:'custom',frame_x:x,frame_y:y};nearestFramingReference(p);assert.equal(p.frame_reference,key);}
console.log('Retired custom framing positions open at the nearest named preset.');
