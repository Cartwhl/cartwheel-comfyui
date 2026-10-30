import assert from 'node:assert/strict';
import {frameGrid,frameAtTime,timeAtFrame,frameReadout} from '../web/frame_timeline.js';
const clip=frameGrid(19.7,24);
assert.equal(clip.count,473);
assert.equal(frameReadout(1.23,clip),'30 / 473 frames · 19.7s');
assert.equal(frameReadout(8.5,clip),'205 / 473 frames · 19.7s');
assert.equal(frameReadout(19.7,clip),'473 / 473 frames · 19.7s');
for(const fps of [24,30,60,120]) {
 const grid=frameGrid(19.7,fps);
 for(let frame=1;frame<=grid.count;frame++) {
  const time=timeAtFrame(frame,grid);
  assert.equal(frameAtTime(time,grid),frame,`${fps} FPS lost exact frame ${frame}`);
  assert.equal(frameAtTime(time,grid,true),frame);
  assert.ok(time<grid.duration);
 }
 assert.equal(timeAtFrame(1,grid),0);
 assert.equal(frameAtTime(-1,grid),1);
 assert.equal(frameAtTime(999,grid),grid.count);
 assert.equal(timeAtFrame(grid.count+10,grid),timeAtFrame(grid.count,grid));
}
const g=frameGrid(20,30);
assert.equal(g.count,600);
assert.equal(timeAtFrame(54,g),53/30);
assert.equal(frameReadout(53/30,g),'54 / 600 frames · 20s');
assert.equal(frameAtTime(53.9/30,g),54,'Playback jumped to a future frame');
assert.equal(frameAtTime(53.9/30,g,true),55,'FPS migration did not choose nearest frame');
assert.equal(frameAtTime(timeAtFrame(54,g)+.00001,g),54);
assert.equal(frameGrid(.001,120).count,1);
assert.equal(frameReadout(0,frameGrid(0,24)),'0 / 0 frames · 0s');
assert.throws(()=>frameGrid(20,0),/positive/);
console.log('One-based frame counts/readouts, exact frame round trips at all render rates, final partial frame, whole-frame seeking and nearest-frame FPS migration passed.');
