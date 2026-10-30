export function movementProgress(time,p,duration,pacing=p.pacing) {
 const end=p.end_time||duration,start=p.start_time||0;
 const t=Math.max(0,Math.min(1,(time-start)/Math.max(1e-8,end-start)));
 if(pacing==='ease_in')return t*t;
 if(pacing==='ease_out')return 1-(1-t)**2;
 return ['ease_in_out','smooth'].includes(pacing)?t*t*(3-2*t):t;
}
