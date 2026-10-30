import assert from 'node:assert/strict';
import {bindSliderDrag,sliderIsDragging,syncSliderValue,bindScrubber,bindRangePointer,bindPointerDrag} from '../web/slider_interaction.js';
class Input extends EventTarget {
 constructor(){super();Object.assign(this,{value:'1',min:'1',max:'241',step:'1',disabled:false});this.captures=new Set();this.style={touchAction:''};this.ownerDocument={defaultView:new EventTarget()};}
 setPointerCapture(id){this.captures.add(id);}hasPointerCapture(id){return this.captures.has(id);}releasePointerCapture(id){this.captures.delete(id);}focus(){}getBoundingClientRect(){return {left:100,width:1000,height:20};}
 fire(type,props={}){const e=new Event(type,{cancelable:true});Object.assign(e,{button:0,pointerId:1,clientX:100,...props});this.dispatchEvent(e);return e;}
}
for(const end of ['pointerup','pointercancel','lostpointercapture','blur']){
 const i=new Input(),dispose=bindSliderDrag(i);i.fire('pointerdown');assert.ok(sliderIsDragging(i));i.value='4';syncSliderValue(i,3.999);assert.equal(i.value,'4','Live feedback must not fight native dragging');i.fire(end);assert.ok(!sliderIsDragging(i));syncSliderValue(i,3.999);assert.equal(i.value,'3.999');dispose();i.fire('pointerdown');assert.ok(!sliderIsDragging(i));
}
const input=new Input(),frames=[],dispose=bindScrubber(input,x=>frames.push(x));
for(let repetition=0;repetition<20;repetition++){
 input.fire('pointerdown',{clientX:100,pointerId:repetition+1});input.fire('pointermove',{clientX:600,pointerId:repetition+1});assert.equal(frames.at(-1),121);input.fire('pointermove',{clientX:1100,pointerId:repetition+1});assert.equal(frames.at(-1),241);input.fire(repetition%2?'lostpointercapture':'pointerup',{pointerId:repetition+1});assert.equal(input.captures.size,0);
 const count=frames.length;input.fire('pointermove',{clientX:500,pointerId:repetition+1});assert.equal(frames.length,count);
}
input.disabled=true;const count=frames.length;input.fire('pointerdown');assert.equal(frames.length,count);dispose();
console.log('PASS: sliders resist feedback snapping, release on up/cancel/lost capture/blur; 20 repeated scrubs map exact ruler coordinates to frames and release capture, including interruption and disabled controls.');

// Camera position drags remain active through live value sync, release outside
// the control, cancellation and a subsequent fresh gesture. Track bounds are
// fixed for the gesture even if camera feedback changes surrounding layout.
for(const exit of ['pointerup','pointercancel','lostpointercapture','blur','window-pointerup','window-blur','buttons-up']){
 const input=new Input();Object.assign(input,{min:'-5',max:'15',step:'.01'});
 let bounds={left:100,width:1000,height:20},values=[];input.getBoundingClientRect=()=>bounds;
 const dispose=bindRangePointer(input,value=>{values.push(value);syncSliderValue(input,999);});
 input.fire('pointerdown',{clientX:110,pointerId:7});assert.equal(values.at(-1),-5);assert.equal(input.value,'-5');assert.ok(sliderIsDragging(input));
 bounds={left:800,width:200,height:20};
 input.fire('pointermove',{clientX:600,pointerId:7,buttons:1});assert.equal(values.at(-1),5,'A layout update must not move the active track');
 const childBlur=new Event('blur');Object.defineProperty(childBlur,'target',{value:input});input.ownerDocument.defaultView.dispatchEvent(childBlur);assert.ok(input.hasPointerCapture(7),'Changing focus elsewhere must not masquerade as window blur');
 input.fire('pointermove',{clientX:1090,pointerId:8,buttons:1});assert.equal(values.at(-1),5,'Ignore unrelated pointers');
 input.fire('pointermove',{clientX:1090,pointerId:7,buttons:1});assert.equal(values.at(-1),15);
 if(exit.startsWith('window-')){const event=new Event(exit.slice(7));if(exit!=='window-blur')event.pointerId=7;input.ownerDocument.defaultView.dispatchEvent(event);}
 else if(exit==='buttons-up')input.fire('pointermove',{pointerId:7,buttons:0});
 else input.fire(exit,{pointerId:7});
 assert.equal(input.captures.size,0);assert.ok(!sliderIsDragging(input));
 const count=values.length;input.fire('pointermove',{pointerId:7,buttons:1,clientX:400});assert.equal(values.length,count);
 input.fire('pointerdown',{pointerId:9,clientX:900});assert.equal(values.at(-1),5,'A new gesture uses fresh bounds');input.fire('pointerup',{pointerId:9});
 // Keyboard/native input stays available; the binder handles pointers only.
 input.value='5.01';input.fire('input');assert.equal(input.value,'5.01');
 dispose();assert.equal(input.style.touchAction,'');const n=values.length;input.fire('pointerdown');assert.equal(values.length,n);
}
const dial=new Input(),angles=[];const stop=bindPointerDrag(dial,event=>angles.push(event.clientX));
for(let n=1;n<=30;n++){
 dial.fire('pointerdown',{pointerId:n,clientX:10});
 for(let i=1;i<=12;i++){dial.fire('pointermove',{pointerId:n,buttons:1,clientX:i*20});assert.equal(angles.at(-1),i*20);assert.ok(dial.hasPointerCapture(n));}
 dial.fire(n%2?'pointerup':'pointercancel',{pointerId:n});assert.equal(dial.captures.size,0);
}
stop();assert.ok(!sliderIsDragging(dial));
console.log('PASS: explicit Height/Distance/Orbit pointer capture, stable scaled track coordinates, seven release/interruption paths, fresh re-entry, numeric/keyboard coexistence and 30 repeated orbit gestures.');
