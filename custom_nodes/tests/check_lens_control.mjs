import assert from 'node:assert/strict';
import {PresetControls} from '../web/preset_controls.js';
import {presetDefaults} from '../web/camera_presets.js';
import {manualReferenceLens} from '../web/manual_framing.js';
import {perspectiveVerticalFOV} from '../web/lens_projection.js';
for(const original of ['natural','portrait','telephoto','custom']){
 const controls=Object.create(PresetControls.prototype);
 const settings={mode:'bookends',camera_index:0,preset:{...presetDefaults([1]),lens:original},manual_path:{kind:'line',aim:'shot'},start:{position:[0,1.3,3]},end:{position:[0,1.3,3]}};
 const capture={actors:[{number:1}],duration:2,camera:{aspect:16/9}};
 controls.editor={settings,capture,editingCaptured:false};
 for(const mm of [80,20,35,100,10,65,36]){
  controls.change('focal_length',mm);
  assert.equal(settings.preset.lens,'custom','A named lens preset must not override an explicit slider change.');
  assert.equal(settings.preset.focal_length,mm);
  const lens=manualReferenceLens(capture,settings,2,0);
  assert.equal(lens.focal_length,mm);
  assert.ok(Math.abs(lens.fov-perspectiveVerticalFOV(mm,16/9,settings.preset))<1e-10);
 }
}
console.log('PASS: repeated lens changes in both directions from named/custom presets update the physical FOV and never snap back to a named lens.');
