import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readdirSync,readFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {BoardStore} from '../server/store.mjs';
import {PlanningStore} from '../server/planning.mjs';
import {createElements} from '../server/elements.mjs';

const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6Z5kAAAAASUVORK5CYII=';
function fixture(){
  const directory=mkdtempSync(path.join(os.tmpdir(),'sharedboard-recovery-test-'));
  const store=new BoardStore(directory),planning=new PlanningStore(directory,store.board.id);
  return {directory,store,planning,close:()=>rmSync(directory,{recursive:true,force:true})};
}
function addBox(store){const [element]=createElements([{id:'screen',x:10,y:20}]);store.apply({changes:[{id:element.id,expectedVersion:0,element}]});return element;}
function moveBox(store,x){const element=store.board.elements.find(element=>element.id==='screen');store.apply({changes:[{id:element.id,expectedVersion:store.board.elementVersions[element.id],element:{...element,x,version:element.version+1,updated:Date.now()}}]});}

test('ordinary recovery is throttled, forced safety saves bypass time limits, and identical content is deduplicated',()=>{
  const f=fixture();try{
    addBox(f.store);const version=f.planning.state.version;
    const first=f.planning.automaticRecovery(f.store.board,'Automatic save',{now:1_000_000});assert.ok(first);
    assert.equal(f.planning.state.version,version,'background saves must not invalidate an in-progress note editor');
    assert.equal(f.planning.automaticRecovery(f.store.board,'Same state before AI work',{force:true,now:1_001_000}),null);
    moveBox(f.store,150);
    assert.equal(f.planning.automaticRecovery(f.store.board,'Automatic save',{now:1_050_000}),null);
    const forced=f.planning.automaticRecovery(f.store.board,'Before AI changes',{force:true,now:1_050_000});assert.ok(forced);
    const element=f.store.board.elements[0];
    f.store.apply({changes:[{id:element.id,expectedVersion:f.store.board.elementVersions[element.id],element:{...element,version:element.version+1,versionNonce:101,updated:Date.now(),index:'a1'}}]});
    assert.equal(f.planning.automaticRecovery(f.store.board,'Only save metadata changed',{force:true,now:1_060_000}),null);
    moveBox(f.store,280);
    assert.equal(f.planning.automaticRecovery(f.store.board,'Automatic save',{now:1_349_999}),null);
    assert.ok(f.planning.automaticRecovery(f.store.board,'Automatic save',{now:1_350_000}));
    assert.equal(f.planning.view().recoveries.length,3);assert.equal(f.planning.view().checkpoints.length,0);
    assert.equal(f.planning.view().recoveries[0].hash,undefined,'internal content fingerprints are not UI metadata');
  }finally{f.close();}
});

test('rolling history survives reopening, keeps twelve entries, and removes expired snapshot files',()=>{
  const f=fixture();try{
    addBox(f.store);const saved=[];
    for(let i=0;i<15;i++){moveBox(f.store,i*30);saved.push(f.planning.automaticRecovery(f.store.board,`Before change ${i}`,{force:true,now:1_000_000+i*1000}));}
    const reopened=new PlanningStore(f.directory,f.store.board.id);
    assert.equal(reopened.view().recoveries.length,12);assert.equal(reopened.view().recoveries[0].id,saved.at(-1).id);
    assert.equal(readdirSync(path.join(f.directory,'recoveries')).filter(name=>name.endsWith('.json')).length,12);
    assert.throws(()=>reopened.readRecovery(saved[0].id),{status:404});
    assert.throws(()=>reopened.readRecovery('../../board'),{status:404});
    assert.equal(reopened.readRecovery(saved[3].id).board.elements[0].x,90);
    assert.equal(reopened.automaticRecovery(f.store.board,'Duplicate after reopening',{force:true,now:1_050_000}),null);
  }finally{f.close();}
});

test('restoring a recovery saves current work, restores notes and image data, and never rolls back edit versions',()=>{
  const f=fixture();try{
    const [base]=createElements([{id:'reference',x:10,y:20,width:360,height:700}]);
    const image={...base,type:'image',fileId:'screenshot',status:'saved',scale:[1,1],crop:null};
    f.store.apply({changes:[{id:image.id,expectedVersion:0,element:image}],files:{screenshot:{id:'screenshot',dataURL:png,mimeType:'image/png',created:100}}});
    const requirement={id:randomUUID(),title:'Keep the booking data',text:'Dates, price and availability must remain visible.',kind:'requirement',status:'open',elementIds:[image.id],createdAt:new Date().toISOString(),result:''};
    f.planning.update(f.planning.state.version,{...f.planning.state.project,notes:[requirement]});
    const saved=f.planning.automaticRecovery(f.store.board,'Before layout experiment',{force:true,now:1_000_000});
    const originalVersion=f.store.board.elementVersions[image.id];
    f.store.apply({changes:[{id:image.id,expectedVersion:originalVersion,element:{...image,x:400,version:image.version+1}}]});
    f.planning.update(f.planning.state.version,{...f.planning.state.project,title:'An experiment',notes:[]});
    const restore=f.planning.restoreRecovery(f.store.board,saved.id,f.store.board.revision);
    const recoveryOfCurrent=f.planning.view().recoveries.find(entry=>entry.id!==saved.id);
    assert.ok(recoveryOfCurrent);assert.equal(f.planning.readRecovery(recoveryOfCurrent.id).board.elements[0].x,400);
    assert.equal(f.planning.readRecovery(recoveryOfCurrent.id).project.title,'An experiment');
    f.store.apply({...restore,actor:'user'});f.planning.update(f.planning.state.version,restore.project);
    assert.equal(f.store.board.elements[0].x,10);assert.equal(f.store.board.files.screenshot.dataURL,png);
    assert.equal(f.planning.state.project.notes[0].text,requirement.text);assert.equal(f.planning.state.project.title,'Our shared project');
    assert.ok(f.store.board.elementVersions[image.id]>originalVersion);
    assert.equal(f.planning.view().checkpoints.length,0,'automatic restoration does not consume a named checkpoint');
    const snapshot=f.planning.readRecovery(saved.id);snapshot.project.notes[0].text='Changed by a caller';
    assert.equal(f.planning.readRecovery(saved.id).project.notes[0].text,requirement.text,'saved recovery context is immutable');
  }finally{f.close();}
});

test('stale recovery restores preserve live drawing and do not create an unrelated safety save',()=>{
  const f=fixture();try{
    addBox(f.store);const saved=f.planning.automaticRecovery(f.store.board,'Before change',{force:true});const revision=f.store.board.revision;
    moveBox(f.store,600);const historyCount=f.planning.view().recoveries.length;
    assert.throws(()=>f.planning.restoreRecovery(f.store.board,saved.id,revision),{status:409});
    assert.equal(f.store.board.elements[0].x,600);assert.equal(f.planning.view().recoveries.length,historyCount);
  }finally{f.close();}
});

test('automatic recoveries work when the named checkpoint shelf is full and remain bound to their board',()=>{
  const f=fixture();try{
    addBox(f.store);const saved=f.planning.automaticRecovery(f.store.board,'Original layout',{force:true});
    for(let i=0;i<40;i++)f.planning.checkpoint(f.store.board,`Named ${i}`);
    moveBox(f.store,700);const restored=f.planning.restoreRecovery(f.store.board,saved.id,f.store.board.revision);
    assert.ok(restored.changes.length);assert.equal(f.planning.view().checkpoints.length,40);
    assert.equal(f.planning.view().recoveries.length,2);
    const original=readFileSync(path.join(f.directory,'recovery-history.json'),'utf8');
    assert.throws(()=>new PlanningStore(f.directory,randomUUID()),/belongs to another board/);
    assert.equal(readFileSync(path.join(f.directory,'recovery-history.json'),'utf8'),original);
    assert.throws(()=>f.planning.automaticRecovery({...f.store.board,id:randomUUID()},'Wrong board',{force:true}),{status:409});
  }finally{f.close();}
});
