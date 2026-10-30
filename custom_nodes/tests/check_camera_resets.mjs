import assert from 'node:assert/strict';
import {resetCameraSettings} from '../web/camera_reset.js';
import {createTimeline,splitSegment,changeTiming,fillGap,holdTransition} from '../web/camera_timeline.js';
import {CameraTimelineEditor} from '../web/camera_timeline_editor.js';
const base={mode:'bookends',world_frame_id:'w',start:{position:[0,2,5],target:[0,1,0],fov:45},end:{position:[3,2,5],target:[0,1,0],fov:45},manual_path:{kind:'line'}};
const starting={...structuredClone(base),end:structuredClone(base.start),manual_path:{kind:'line',source_static:true}};
for(const fps of [24,30,60,120]){
 const t=createTimeline(base,10,fps);t.world_frame_id='w';splitSegment(t,'camera-1',3);splitSegment(t,'camera-2',7);t.selected_id='camera-2';t.segments[1].animation_range=[1,9];t.segments[1].offset_end=[2,0,1];const settings={...base,camera_timeline:t},saved=JSON.stringify(settings);
 const reset=resetCameraSettings(settings,starting,10,fps),[a,b,c]=reset.camera_timeline.segments;
 assert.equal(JSON.stringify(settings),saved,'Pure reset must not mutate its input');assert.deepEqual(a,t.segments[0]);assert.deepEqual(c,t.segments[2]);assert.deepEqual([b.start,b.end],[3,7]);assert.deepEqual(b.settings,starting);assert.deepEqual(b.offset_end,[0,0,0]);assert.equal(b.animation_range,undefined);assert.ok(reset.camera_timeline.joins.every(j=>!j.connected&&!j.smooth));
 const whole=resetCameraSettings(settings,starting,10,fps,true);assert.equal(whole.camera_timeline.segments.length,1);assert.deepEqual([whole.camera_timeline.segments[0].start,whole.camera_timeline.segments[0].end],[0,10]);assert.deepEqual(whole.start,whole.end);
 // Both reset operations occupy one recoverable history step.
 for(const next of [reset,whole]){const controller=Object.create(CameraTimelineEditor.prototype);controller.editor={settings:structuredClone(settings)};controller.undoStack=[];controller.redoStack=[];controller.refresh=()=>{};controller.editor.settings=next;controller.record(saved);assert.equal(controller.undoStack.length,1);controller.restoreHistory(false);assert.equal(JSON.stringify(controller.editor.settings),saved);controller.restoreHistory(true);assert.deepEqual(controller.editor.settings,next);}
 // New holds ease even when adjacent paths are disconnected.
 reset.camera_timeline.segments[1].ease_start=undefined;assert.equal(holdTransition(reset.camera_timeline,reset.camera_timeline.segments[1],'start').smooth,true);
 // Deleting/gapping and fresh hold insertion use 30-frame smoothing defaults.
 const gap=createTimeline(base,10,fps);changeTiming(gap,'camera-1','start',2);assert.deepEqual(holdTransition(gap,gap.segments[0],'start'),{smooth:true,frames:30});fillGap(gap,1,starting);assert.ok(gap.joins.every(j=>j.connected&&j.smooth&&j.frames===30));
}
console.log('PASS: selected reset restores static starting settings and keeps neighbors/timing unchanged; scene reset creates one full-clip camera; both Undo/Redo in one step; new hold/camera smoothing defaults checked at all frame rates.');
