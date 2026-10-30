import {clone,recipe,createTimeline,selectedSegment} from './camera_timeline.js?v=20261029-usability-r2';
// The editor freezes existing offsets first, so disconnecting a reset shot does
// not reposition any surviving neighboring camera.
export function resetCameraSettings(settings,starting,duration,fps,wholeScene=false){
 if(wholeScene||!settings.camera_timeline){const next=recipe(starting),timeline=createTimeline(next,duration,fps);timeline.world_frame_id=next.world_frame_id;return {...next,camera_timeline:timeline};}
 const timeline=clone(settings.camera_timeline),segment=selectedSegment(timeline);
 segment.settings=recipe(starting);segment.source_start=0;segment.source_end=duration;segment.offset_start=[0,0,0];segment.offset_end=[0,0,0];delete segment.animation_range;
 for(const join of timeline.joins)if(join.left===segment.id||join.right===segment.id)Object.assign(join,{connected:false,smooth:false,preserve:false,point:null});
 return {...recipe(starting),camera_timeline:timeline};
}
