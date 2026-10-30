import assert from 'node:assert/strict';
import fs from 'node:fs';
import {migrateSourceNames} from '../web/source_naming.js';
const graph={nodes:[{id:1,type:'CartwheelPerformanceCapture',widgets_values:['Artist name',4,false,true,'Detailed (slower)','120','Rebuild curves',2]},{id:2,type:'CartwheelSwingChoreo',widgets_values:['Dancers','Two performers dance',15,true,'30','None']}]};
assert.equal(migrateSourceNames(graph),2);
assert.deepEqual(graph.nodes[0].widgets_values,[4,false,true,'Detailed (slower)','120','Rebuild curves',2]);
assert.deepEqual(graph.nodes[1].widgets_values,['Two performers dance',15,true,'30','None']);
assert.equal(migrateSourceNames(graph),0);
for(const structured of [false,true]){
 const graph={nodes:[{id:1,type:'String',outputs:[{links:[7,8]}]},{id:2,type:'CartwheelPerformanceCapture',inputs:[{name:'batchName',link:7},{name:'video',link:8}],widgets_values:{batchName:'Old',numPeople:3}}],links:structured?[{id:7,origin_id:1,origin_slot:0,target_id:2,target_slot:0},{id:8,origin_id:1,origin_slot:0,target_id:2,target_slot:1}]:[[7,1,0,2,0,'STRING'],[8,1,0,2,1,'VIDEO']]};
 assert.equal(migrateSourceNames(graph),2);assert.deepEqual(graph.nodes[0].outputs[0].links,[8]);assert.equal(graph.nodes[1].inputs[0].name,'video');assert.equal(graph.links.length,1);assert.equal(structured?graph.links[0].target_slot:graph.links[0][4],0);assert.deepEqual(graph.nodes[1].widgets_values,{numPeople:3});assert.equal(migrateSourceNames(graph),0);
}
for(const name of fs.readdirSync(new URL('../examples/',import.meta.url)).filter(n=>n.endsWith('.json'))){
 const graph=JSON.parse(fs.readFileSync(new URL('../examples/'+name,import.meta.url),'utf8'));assert.equal(migrateSourceNames(graph),0,name+' should already be migrated');
}
const current=JSON.parse(fs.readFileSync(new URL('../../Cartwheel-Motion-to-Video.json',import.meta.url),'utf8'));
assert.equal(migrateSourceNames(current),0,'Current Motion to Video workflow should already be migrated');
console.log('PASS: old source names removed without shifting actor settings/prompt; linked-input slots/wires retained; new workflows and repeated migration unchanged.');
