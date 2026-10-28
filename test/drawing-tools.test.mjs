import test from 'node:test';
import assert from 'node:assert/strict';
import {bucketElements,containsFillPoint,frameForShape,gridUpdate,lassoIds,recognizeStroke,scenePoint,shortcutAction} from '../src/drawing-tools.mjs';

const key=(value,extra={})=>({key:value,code:`Key${value.toUpperCase()}`,target:{},...extra});
test('style and help shortcuts intercept native popups without swallowing typing, composition or browser combinations',()=>{
  assert.equal(shortcutAction(key('s')),'style');assert.equal(shortcutAction(key('g')),'style');
  assert.equal(shortcutAction(key('?')),'help');assert.equal(shortcutAction(key('F1')),'help');
  assert.equal(shortcutAction(key('s'),{editingTextElement:{id:'text'}}),null);
  assert.equal(shortcutAction(key('s',{target:{isContentEditable:true}})),null);
  assert.equal(shortcutAction(key('s',{target:{closest:()=>({tagName:'TEXTAREA'})}})),null);
  assert.equal(shortcutAction(key('s',{isComposing:true})),null);
  assert.equal(shortcutAction(key('s',{ctrlKey:true})),'export');
  assert.equal(shortcutAction(key('s',{metaKey:true,shiftKey:true})),'backup');
  assert.equal(shortcutAction(key('s',{altKey:true})),null,'native object snapping stays available');
  assert.equal(shortcutAction(key('S',{shiftKey:true})),null,'native stroke eyedropper stays available');
  assert.equal(shortcutAction(key('q')),null,'native tool lock stays available');
  assert.equal(shortcutAction(key('x',{shiftKey:true})),'recognize');
  assert.equal(shortcutAction(key('j')),'lasso');assert.equal(shortcutAction(key('w')),'embeddable');
  assert.equal(shortcutAction(key('/',{ctrlKey:true})),'help');assert.equal(shortcutAction(key('P',{metaKey:true,shiftKey:true})),'help');assert.equal(shortcutAction(key('/',{altKey:true})),'objects');
});
test('grid toggles actual snapping mode, retains preferred size, and disables conflicting object snapping',()=>{
  const enabled=gridUpdate({gridModeEnabled:false,gridSize:null,objectsSnapModeEnabled:true});
  assert.deepEqual(enabled,{gridModeEnabled:true,gridSize:20,objectsSnapModeEnabled:false});
  assert.deepEqual(gridUpdate({...enabled,gridSize:40}),{gridModeEnabled:false,gridSize:40,objectsSnapModeEnabled:false});
  assert.deepEqual(scenePoint({clientX:330,clientY:150},{zoom:{value:2},scrollX:-10,scrollY:25},{left:130,top:50}),{x:110,y:25});
});
test('bucket fill targets the topmost unlocked closed shape and preserves unrelated elements and bound text',()=>{
  const back={id:'back',type:'rectangle',x:0,y:0,width:300,height:300,version:3},front={id:'front',type:'ellipse',x:20,y:20,width:100,height:100,version:7,boundElements:[{id:'label',type:'text'}]},label={id:'label',type:'text',containerId:'front',x:25,y:25,width:70,height:30,version:2};
  const before=[back,front,label],result=bucketElements(before,{x:60,y:60},'#275c46');
  assert.equal(result[0],back);assert.equal(result[2],label);assert.equal(result[1].backgroundColor,'#275c46');assert.equal(result[1].fillStyle,'solid');assert.equal(result[1].version,8);assert.deepEqual(result[1].boundElements,front.boundElements);assert.equal(front.backgroundColor,undefined);
  assert.equal(bucketElements([{...back,locked:true}],{x:20,y:20},'#000000'),null);
  assert.equal(containsFillPoint({...front,type:'diamond'},{x:21,y:21}),false);
  assert.equal(containsFillPoint({...back,type:'line',points:[[0,0],[300,0],[300,300]]},{x:50,y:50}),false,'an open path is never silently treated as a closed region');
  assert.equal(containsFillPoint({...back,type:'freedraw',points:[[0,0],[300,0],[300,300],[0,300],[0,0]]},{x:100,y:100}),true);
  assert.equal(bucketElements([{id:'frame',type:'frame',x:0,y:0,width:500,height:500,locked:true},{...front,frameId:'frame'}],{x:60,y:60},'#275c46'),null,'locked frame contents remain protected');
  assert.equal(containsFillPoint({id:'rotated',type:'line',x:100,y:100,width:80,height:80,angle:Math.PI/2,points:[[0,0],[-80,0],[-80,-80],[0,-80],[0,0]]},{x:30,y:30}),true,'negative-point closed paths rotate around their actual center');
});
test('lasso selects intersected objects and their groups and labels, while ignoring deleted and locked objects',()=>{
  const items=[{id:'a',type:'rectangle',x:10,y:10,width:40,height:40,groupIds:['g'],boundElements:[{id:'label',type:'text'}]},{id:'label',type:'text',x:20,y:20,width:10,height:10,containerId:'a'},{id:'b',type:'ellipse',x:300,y:300,width:40,height:40,groupIds:['g']},{id:'locked',type:'rectangle',x:10,y:10,width:40,height:40,locked:true},{id:'removed',isDeleted:true,type:'rectangle',x:10,y:10,width:40,height:40}];
  const polygon=[{x:0,y:0},{x:80,y:0},{x:80,y:80},{x:0,y:80}];
  assert.deepEqual(lassoIds(items,polygon).sort(),['a','b','label']);
  assert.deepEqual(lassoIds(items,[]),[]);
  const crossing=[{x:20,y:-20},{x:30,y:-20},{x:30,y:100},{x:20,y:100}];
  assert.ok(lassoIds(items,crossing).includes('a'),'edge crossings are included even when no object corner is inside the lasso');
  const framed=[{id:'frame',type:'frame',x:0,y:0,width:500,height:500},{...items[0],groupIds:[],frameId:'frame'},items[1],{...items[2],groupIds:[],frameId:'frame'}];
  assert.deepEqual(lassoIds(framed,[{x:5,y:5},{x:80,y:5},{x:80,y:80},{x:5,y:80}]).sort(),['a','label'],'drawing inside a frame never selects unrelated frame contents');
  assert.deepEqual(lassoIds(framed,[{x:-5,y:-5},{x:505,y:-5},{x:505,y:505},{x:-5,y:505}]).sort(),['a','b','frame','label']);
  const locked=[{...framed[1],locked:true},framed[2]];
  assert.deepEqual(lassoIds(locked,polygon),[],'bound text never bypasses its locked container');
  const hidden=[{...framed[1],opacity:0},framed[2]];
  assert.deepEqual(lassoIds(hidden,polygon),[],'bound text never bypasses its hidden container');
  assert.equal(frameForShape(framed,{x:100,y:100,width:80,height:60}),'frame');
  assert.equal(frameForShape(framed,{x:480,y:100,width:80,height:60}),null,'partial overlap does not assign frame membership');
  assert.deepEqual(lassoIds([{id:'line',type:'line',x:100,y:100,width:80,height:80,points:[[0,0],[-80,-80]]}],[{x:15,y:15},{x:35,y:15},{x:35,y:35},{x:15,y:35}]),['line'],'negative native line points use their actual visible bounds');
});
test('draw to shape recognizes clean geometry and preserves unrecognized strokes as editable freehand',()=>{
  const rect=[{x:10,y:20},{x:110,y:20},{x:110,y:100},{x:10,y:100},{x:10,y:20}];
  assert.deepEqual(recognizeStroke(rect),{type:'rectangle',x:10,y:20,width:100,height:80});
  const ellipse=Array.from({length:49},(_,i)=>({x:100+80*Math.cos(i*Math.PI/24),y:80+50*Math.sin(i*Math.PI/24)}));
  assert.equal(recognizeStroke(ellipse).type,'ellipse');
  assert.equal(recognizeStroke([{x:50,y:0},{x:100,y:50},{x:50,y:100},{x:0,y:50},{x:50,y:0}]).type,'diamond');
  const line=recognizeStroke([{x:100,y:100},{x:70,y:70},{x:20,y:20}]);
  assert.equal(line.type,'line');assert.deepEqual(line.points,[[0,0],[-80,-80]]);assert.equal(line.x,100);
  assert.equal(recognizeStroke([{x:0,y:0},{x:100,y:0},{x:20,y:60},{x:90,y:90}]).type,'freedraw');
  assert.equal(recognizeStroke([{x:1,y:1},{x:2,y:2}]),null);
});
