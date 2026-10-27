import test from 'node:test';
import assert from 'node:assert/strict';
import {associatedIds,editOutlineElements,elementLabel,navigatorBounds,outlineEntries,renameOutlineEntry,reorderOutlineElements,rotatedBounds} from '../src/object-navigator.mjs';

function scene(){return [
  {id:'background',type:'rectangle',x:0,y:0,width:1000,height:800,groupIds:[],version:1,index:'a1',opacity:100,customData:{preserve:'yes'}},
  {id:'a',type:'rectangle',x:20,y:20,width:200,height:100,groupIds:['inner','group'],version:1,index:'a2',opacity:35,boundElements:[{id:'a_label',type:'text'},{id:'connector',type:'arrow'}]},
  {id:'a_label',type:'text',text:'Account balance',x:40,y:40,width:100,height:30,containerId:'a',groupIds:['inner','group'],version:1,index:'a3',opacity:100},
  {id:'b',type:'ellipse',x:300,y:20,width:200,height:100,groupIds:['group'],version:1,index:'a4',opacity:100,boundElements:[{id:'b_label',type:'text'}]},
  {id:'b_label',type:'text',text:'Transactions',x:320,y:40,width:100,height:30,containerId:'b',groupIds:['group'],version:1,index:'a5',opacity:100},
  {id:'connector',type:'arrow',x:220,y:70,width:80,height:0,groupIds:[],version:1,index:'a6',opacity:100,startBinding:{elementId:'a'},endBinding:{elementId:'b'}},
  {id:'removed',type:'text',text:'No longer here',isDeleted:true,groupIds:[],version:1,index:'a7'},
];}
test('outline lists native root objects and groups once, uses bound text labels and omits deleted objects',()=>{
  const items=scene(),entries=outlineEntries(items),group=entries.find(entry=>entry.kind==='group');
  assert.equal(group.children.length,2);assert.deepEqual(group.elementIds,['a','b']);
  assert.equal(group.children[0].name,'Account balance');assert.equal(group.children[1].name,'Transactions');
  assert.equal(entries.some(entry=>entry.id==='a_label'||entry.id==='removed'),false);
  assert.equal(elementLabel({...items[1],customData:{sharedboardName:'Balance summary'}},items),'Balance summary');
  const renamed=renameOutlineEntry(items,group,'Main navigation');assert.equal(outlineEntries(renamed).find(entry=>entry.kind==='group').name,'Main navigation');
  assert.equal(renamed.find(element=>element.id==='a_label').text,'Account balance','outline names do not rewrite the drawing');
  assert.equal(renamed.find(element=>element.id==='background').customData.preserve,'yes');
});
test('visibility and locking carry bound labels but do not alter connected arrows or native group membership',()=>{
  const before=scene(),original=structuredClone(before);
  const hidden=editOutlineElements(before,['a'],'visibility');
  assert.equal(hidden.find(element=>element.id==='a').opacity,0);assert.equal(hidden.find(element=>element.id==='a_label').opacity,0);
  assert.equal(hidden.find(element=>element.id==='connector').opacity,100,'a connected arrow is not a bound label');
  const shown=editOutlineElements(hidden,['a'],'visibility');
  assert.equal(shown.find(element=>element.id==='a').opacity,35);assert.equal(shown.find(element=>element.id==='a_label').opacity,100);
  assert.equal(shown.find(element=>element.id==='a').customData.sharedboardHidden,undefined);
  const locked=editOutlineElements(shown,['a'],'lock');assert.equal(locked.find(element=>element.id==='a').locked,true);assert.equal(locked.find(element=>element.id==='a_label').locked,true);
  assert.equal(locked.find(element=>element.id==='b').locked,undefined);
  assert.deepEqual(locked.find(element=>element.id==='a').groupIds,['inner','group']);assert.deepEqual(locked.find(element=>element.id==='connector').startBinding,{elementId:'a'});
  assert.deepEqual(before,original,'actions do not mutate the source scene');
});
test('moving a grouped object between layers keeps its entire group and labels together',()=>{
  const before=scene(),front=reorderOutlineElements(before,['a'],'front'),moved=front.filter(element=>!element.isDeleted).slice(-4);
  assert.deepEqual(moved.map(element=>element.id),['a','a_label','b','b_label']);
  const back=reorderOutlineElements(before,['b'],'back');assert.deepEqual(back.slice(0,4).map(element=>element.id),['a','a_label','b','b_label']);
  for(const element of front)assert.equal(element.index,null,'the public editor API will regenerate ordering keys for the new array order');
  assert.deepEqual(front.find(element=>element.id==='a').boundElements,before.find(element=>element.id==='a').boundElements);
  assert.equal(front.find(element=>element.id==='connector').version,1,'unrelated objects only receive derived ordering keys');
  assert.equal(front.find(element=>element.id==='a').version,2,'explicit layer edits are actual user edits for conflict and undo checks');
});
test('frame actions include contents and labels, and minimap bounds include rotated objects and the viewport',()=>{
  const elements=[{id:'frame',type:'frame',x:0,y:0,width:100,height:200,version:1},{id:'inside',type:'rectangle',frameId:'frame',x:10,y:10,width:30,height:40,version:1,boundElements:[{id:'label',type:'text'}]},{id:'label',type:'text',containerId:'inside',text:'Inside',x:20,y:20,width:10,height:10,version:1}];
  const ids=associatedIds(elements,['frame']);assert.deepEqual([...ids].sort(),['frame','inside','label']);
  const hidden=editOutlineElements(elements,['frame'],'visibility');assert.ok(hidden.every(element=>element.opacity===0));
  const rotated=rotatedBounds({x:0,y:0,width:100,height:20,angle:Math.PI/2});
  assert.ok(Math.abs(rotated.width-20)<.001);assert.ok(Math.abs(rotated.height-100)<.001);
  const bounds=navigatorBounds(elements,{x:-100,y:-200,width:1000,height:700});assert.ok(bounds.x<-100);assert.ok(bounds.y<-200);assert.ok(bounds.x+bounds.width>900);assert.ok(bounds.y+bounds.height>500);
});
