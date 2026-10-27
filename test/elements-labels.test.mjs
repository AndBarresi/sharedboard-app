import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createElements,editElements} from '../server/elements.mjs';
import {BoardStore} from '../server/store.mjs';
import {PlanningStore} from '../server/planning.mjs';
import {isRenderNormalization} from '../shared/scene.mjs';

function fixture(){
 const directory=mkdtempSync(path.join(os.tmpdir(),'sharedboard-label-edit-')),store=new BoardStore(directory),planning=new PlanningStore(directory,store.board.id);
 const elements=createElements([{id:'box',type:'rectangle',x:170,y:130,width:460,height:150,text:'Original label'}]);
 store.apply({changes:elements.map(element=>({id:element.id,expectedVersion:0,element}))});
 return {store,planning,close(){rmSync(directory,{recursive:true,force:true});}};
}
const find=(board,id)=>board.elements.find(element=>element.id===id);
const humanLabel=(board,text)=>{const label=find(board,'box_label');return {id:label.id,expectedVersion:board.elementVersions[label.id],element:{...label,text,originalText:text,version:label.version+1,versionNonce:1234,updated:Date.now()+1}};};

test('editing a shape label updates its bound text while preserving container geometry',()=>{
 const f=fixture();try{
  const before=f.store.board,shape=find(before,'box'),text='Live agent update reached the packaged board';
  const changes=editElements(before,[{id:'box',expectedVersion:1,changes:{text}}]);
  assert.deepEqual(changes.map(change=>change.id),['box','box_label']);assert.deepEqual(changes.map(change=>change.expectedVersion),[1,1]);
  f.store.apply({changes,actor:'agent'});const board=f.store.board,next=find(board,'box'),label=find(board,'box_label');
  for(const property of ['x','y','width','height'])assert.equal(next[property],shape[property]);
  assert.equal(next.text,undefined);assert.equal(next.originalText,undefined);assert.equal(next.fontSize,undefined);assert.equal(label.text,text);assert.equal(label.originalText,text);assert.equal(label.containerId,'box');
  assert.equal(label.x,next.x+(next.width-label.width)/2);assert.equal(label.y,next.y+(next.height-label.height)/2);assert.equal(board.elementVersions.box,2);assert.equal(board.elementVersions.box_label,2);
 }finally{f.close();}
});

test('explicit container resizing and font changes update the bound label without replacing requested dimensions',()=>{
 const f=fixture();try{
  f.store.apply({changes:editElements(f.store.board,[{id:'box',expectedVersion:1,changes:{x:300,width:600,height:200,fontSize:32,text:'New label'}}])});
  const shape=find(f.store.board,'box'),label=find(f.store.board,'box_label');assert.equal(shape.x,300);assert.equal(shape.width,600);assert.equal(shape.height,200);assert.equal(shape.fontSize,undefined);assert.equal(label.fontSize,32);assert.equal(label.height,40);assert.equal(label.x,shape.x+(shape.width-label.width)/2);
 }finally{f.close();}
});

test('standalone text still resizes, and font edits preserve the authored text rather than display wrapping',()=>{
 const elements=createElements([{id:'heading',type:'text',text:'Before',fontSize:20}]),board={elements,elementVersions:{heading:1}};
 const changed=editElements(board,[{id:'heading',expectedVersion:1,changes:{text:'A longer heading',fontSize:40}}])[0].element;assert.equal(changed.originalText,'A longer heading');assert.equal(changed.width,'A longer heading'.length*40*.62);assert.equal(changed.height,50);
 const f=fixture();try{const label=find(f.store.board,'box_label');f.store.apply({changes:[{id:label.id,expectedVersion:1,element:{...label,text:'Original\nlabel'}}]});
  const changes=editElements(f.store.board,[{id:'box',expectedVersion:f.store.board.elementVersions.box,changes:{fontSize:30}}]);const next=changes.find(c=>c.id==='box_label').element;assert.equal(next.originalText,'Original label');assert.equal(next.text,'Original label');
 }finally{f.close();}
});

test('compound container moves preserve explicit bound-label edits in either batch order',()=>{
 for(const reverse of [false,true]){const f=fixture();try{
  const edits=[{id:'box',expectedVersion:1,changes:{x:500,width:550}},{id:'box_label',expectedVersion:1,changes:{text:'An explicit label edit',fontSize:24}}];
  f.store.apply({changes:editElements(f.store.board,reverse?edits.toReversed():edits)});const shape=find(f.store.board,'box'),label=find(f.store.board,'box_label');assert.equal(label.text,'An explicit label edit');assert.equal(label.fontSize,24);assert.equal(shape.width,550);assert.equal(shape.height,150);assert.equal(label.x,shape.x+(shape.width-label.width)/2);assert.equal(label.y,shape.y+(shape.height-label.height)/2);
 }finally{f.close();}}
});

test('conflicting compound label requests and stale explicit label versions reject before any mutation',()=>{
 const f=fixture();try{const before=f.store.board;
  assert.throws(()=>editElements(before,[{id:'box',expectedVersion:1,changes:{text:'Container wording'}},{id:'box_label',expectedVersion:1,changes:{text:'Different explicit wording'}}]),error=>error.status===400);
  assert.throws(()=>editElements(before,[{id:'box',expectedVersion:1,changes:{x:900}},{id:'box_label',expectedVersion:2,changes:{text:'Stale'}}]),error=>error.status===409);
  assert.equal(f.store.board,before);
 }finally{f.close();}
});

test('a human label-only content change invalidates stale shape edits without changing its native record',()=>{
 const f=fixture();try{
  const before=f.store.board,shape=find(before,'box');f.store.apply({changes:[humanLabel(before,'Human wording')],actor:'user'});
  assert.deepEqual(find(f.store.board,'box'),shape);assert.equal(f.store.board.elementVersions.box,2);assert.equal(f.store.board.elementVersions.box_label,2);
  assert.throws(()=>editElements(f.store.board,[{id:'box',expectedVersion:1,changes:{text:'Stale AI wording'}}]),error=>error.status===409);
  const changes=editElements(f.store.board,[{id:'box',expectedVersion:2,changes:{text:'Freshly requested wording'}}]);f.store.apply({changes});assert.equal(f.store.board.elementVersions.box,3);assert.equal(f.store.board.elementVersions.box_label,3);
 }finally{f.close();}
});

test('a label change between preparing and applying a batch rejects both the label and container writes atomically',()=>{
 const f=fixture();try{
  const changes=editElements(f.store.board,[{id:'box',expectedVersion:1,changes:{text:'Prepared wording',x:800}}]);f.store.apply({changes:[humanLabel(f.store.board,'New human wording')],actor:'user'});const humanBoard=f.store.board;
  assert.throws(()=>f.store.apply({changes}),error=>error.status===409&&error.conflicts.includes('box')&&error.conflicts.includes('box_label'));assert.equal(f.store.board,humanBoard);assert.equal(find(f.store.board,'box').x,170);assert.equal(find(f.store.board,'box_label').text,'New human wording');
 }finally{f.close();}
});

test('bound-label measurement and display wrapping preserve logical shape version and AI undo',()=>{
 const f=fixture();try{
  const before=f.store.board;f.store.apply({changes:editElements(before,[{id:'box',expectedVersion:1,changes:{text:'A proposed layout label'}}]),actor:'agent'});f.planning.recordAgent(before,f.store.board,'Rename the layout');
  const measuredBefore=f.store.board,label=find(measuredBefore,'box_label'),normalized={...label,text:'A proposed\nlayout label',x:200,y:150,width:400,height:70};assert.equal(isRenderNormalization(label,normalized),true);
  const changes=[{id:label.id,expectedVersion:measuredBefore.elementVersions[label.id],element:normalized}];f.store.apply({changes,actor:'user'});assert.equal(f.store.board.elementVersions.box,2);assert.equal(f.store.board.elementVersions.box_label,3);f.planning.recordNormalization(measuredBefore,f.store.board,changes);
  const action=f.planning.state.agentActions[0];f.store.apply({changes:f.planning.undo(f.store.board,action.id),actor:'user'});assert.equal(find(f.store.board,'box_label').text,'Original label');assert.equal(find(f.store.board,'box').width,460);assert.equal(find(f.store.board,'box').height,150);
  const next=f.store.board;f.store.apply({changes:editElements(next,[{id:'box',expectedVersion:next.elementVersions.box,changes:{text:'A second idea'}}]),actor:'agent'});f.planning.recordAgent(next,f.store.board,'Another rename');const second=f.planning.state.agentActions[0];f.store.apply({changes:[humanLabel(f.store.board,'Human keeps this')],actor:'user'});assert.throws(()=>f.planning.undo(f.store.board,second.id),error=>error.status===409);assert.equal(find(f.store.board,'box_label').text,'Human keeps this');
 }finally{f.close();}
});
