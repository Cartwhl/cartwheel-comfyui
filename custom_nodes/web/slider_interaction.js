// Keep native range drags stable while live camera feedback updates nearby fields.
const dragging=new WeakSet(),bound=new WeakMap();
export const sliderIsDragging=input=>dragging.has(input);
export function syncSliderValue(input,value){if(!sliderIsDragging(input)&&input.value!==String(value))input.value=String(value);}
export function bindSliderDrag(input){
 if(bound.has(input))return bound.get(input);
 const start=event=>{if(event.button===0&&!input.disabled)dragging.add(input);};
 const end=()=>dragging.delete(input);
 input.addEventListener('pointerdown',start);
 for(const name of ['pointerup','pointercancel','lostpointercapture','blur'])input.addEventListener(name,end);
 const dispose=()=>{end();input.removeEventListener('pointerdown',start);for(const name of ['pointerup','pointercancel','lostpointercapture','blur'])input.removeEventListener(name,end);bound.delete(input);};
 bound.set(input,dispose);return dispose;
}
// Scrubbing has its own pointer capture and uses the ruler's exact coordinates,
// independent of native range thumb state or a preceding block drag.
export function bindScrubber(input,seek){
 let pointer=null;
 const position=event=>{const rect=input.getBoundingClientRect();if(!rect.width)return;const min=Number(input.min),max=Number(input.max),step=Number(input.step)||1;const fraction=Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width));const value=Math.min(max,Math.max(min,min+Math.round((max-min)*fraction/step)*step));input.value=String(value);seek(value);};
 const down=event=>{if(event.button!==0||input.disabled)return;event.preventDefault();event.stopPropagation();pointer=event.pointerId;input.focus({preventScroll:true});input.setPointerCapture(pointer);position(event);};
 const move=event=>{if(pointer!==event.pointerId)return;event.preventDefault();event.stopPropagation();position(event);};
 const end=event=>{if(pointer===null||event.pointerId!==undefined&&event.pointerId!==pointer)return;const id=pointer;pointer=null;if(input.hasPointerCapture(id))input.releasePointerCapture(id);};
 input.addEventListener('pointerdown',down);input.addEventListener('pointermove',move);
 for(const name of ['pointerup','pointercancel','lostpointercapture','blur'])input.addEventListener(name,end);
 return ()=>{end({});input.removeEventListener('pointerdown',down);input.removeEventListener('pointermove',move);for(const name of ['pointerup','pointercancel','lostpointercapture','blur'])input.removeEventListener(name,end);};
}

// Own position-control drags rather than relying on native range thumb state.
// Live camera edits can update layout and focus while the pointer is still down.
export function bindPointerDrag(element,update){
 let pointer=null;
 const view=element.ownerDocument?.defaultView;
 const end=event=>{
  if(event?.type==='blur'&&event.currentTarget===view&&event.target!==view)return;
  if(pointer===null||event?.pointerId!==undefined&&event.pointerId!==pointer)return;
  const id=pointer;pointer=null;dragging.delete(element);
  if(element.hasPointerCapture(id))element.releasePointerCapture(id);
 };
 const down=event=>{
  if(event.button!==0||element.disabled||pointer!==null)return;
  event.preventDefault();event.stopPropagation();
  element.focus({preventScroll:true});
  pointer=event.pointerId;dragging.add(element);element.setPointerCapture(pointer);
  update(event,true);
 };
 const move=event=>{
  if(pointer!==event.pointerId)return;
  if(event.buttons===0){end(event);return;}
  event.preventDefault();event.stopPropagation();update(event,false);
 };
 const oldTouch=element.style.touchAction;element.style.touchAction='none';
 element.addEventListener('pointerdown',down);element.addEventListener('pointermove',move);
 for(const name of ['pointerup','pointercancel','lostpointercapture','blur'])element.addEventListener(name,end);
 for(const name of ['pointerup','pointercancel','blur'])view?.addEventListener(name,end,name!=='blur');
 return ()=>{
  end();element.style.touchAction=oldTouch;
  element.removeEventListener('pointerdown',down);element.removeEventListener('pointermove',move);
  for(const name of ['pointerup','pointercancel','lostpointercapture','blur'])element.removeEventListener(name,end);
  for(const name of ['pointerup','pointercancel','blur'])view?.removeEventListener(name,end,name!=='blur');
 };
}
export function bindRangePointer(input,change){
 let bounds;
 return bindPointerDrag(input,(event,start)=>{
  // Freeze the track for this gesture, including the scaled native thumb inset.
  if(start)bounds=input.getBoundingClientRect();
  const inset=Math.min(bounds.height/2,bounds.width/2),width=bounds.width-2*inset;
  if(width<=0)return;
  const min=Number(input.min),max=Number(input.max),step=Number(input.step)||1;
  const fraction=Math.max(0,Math.min(1,(event.clientX-bounds.left-inset)/width));
  const value=Math.max(min,Math.min(max,min+Math.round((max-min)*fraction/step)*step));
  input.value=String(Number(value.toFixed(10)));change(Number(input.value));
 });
}
