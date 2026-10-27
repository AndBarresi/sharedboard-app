import test from 'node:test';
import assert from 'node:assert/strict';
import {createBackupPreviewReader} from '../src/backup-preview.mjs';

const backup=title=>({type:'sharedboard-project',formatVersion:1,board:{elements:[],files:{}},project:{title,areas:[],notes:[],library:[]}});
const file=value=>({size:100,text:async()=>JSON.stringify(value)});
function fixture(){
  const states=[];let waits=0;
  const reader=createBackupPreviewReader({browserOnly:true,waitUntilSaved:async()=>{waits++;return {expectedRevision:7};},getPlanningVersion:()=>3,onChange:state=>states.push(state)});
  return {reader,states,get waits(){return waits;}};
}
test('backup preview validates all content before rendering a title or object count',async()=>{
  const f=fixture();
  for(const invalid of [{...backup('Bad'),board:{elements:[null],files:{}}},{...backup('Bad'),project:{...backup('Bad').project,title:{}}}]){
    await f.reader.read(file(invalid));assert.equal(f.states.at(-1).preview,null);assert.match(f.states.at(-1).error,/valid .sharedboard/);
  }
  assert.equal(f.waits,0,'malformed content must not reach the save/restore preview');
  await f.reader.read(file(backup('Valid')));
  assert.equal(f.states.at(-1).preview.backup.project.title,'Valid');assert.equal(f.states.at(-1).preview.expectedRevision,7);assert.equal(f.states.at(-1).preview.expectedVersion,3);
});
test('a slower previous file cannot replace the newest backup preview or its error',async()=>{
  const f=fixture();let finish;
  const pending=f.reader.read({size:100,text:()=>new Promise(resolve=>{finish=resolve;})});
  await f.reader.read(file(backup('Most recent')));const count=f.states.length;
  finish('malformed old file');await pending;
  assert.equal(f.states.length,count);assert.equal(f.states.at(-1).preview.backup.project.title,'Most recent');assert.equal(f.waits,1);
});
test('closing the import preview cancels an in-progress read without applying its result',async()=>{
  const f=fixture();let finish;
  const pending=f.reader.read({size:100,text:()=>new Promise(resolve=>{finish=resolve;})});
  f.reader.cancel();finish(JSON.stringify(backup('Closed preview')));await pending;
  assert.equal(f.states.length,1);assert.equal(f.states[0].preview,null);assert.equal(f.waits,0);
});
