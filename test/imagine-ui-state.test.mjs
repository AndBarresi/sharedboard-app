import test from 'node:test';
import assert from 'node:assert/strict';
import {imagineAvailability,imagineRoleSelection,savedImagineDirection} from '../src/imagine-state.mjs';

const view=()=>({agentConnected:true,chatConnected:true,online:true,status:'saved',connection:{connected:true,permission:'edit',deliveryMode:'events',automaticMessages:true,messageExpiresAt:Date.now()+60000},messages:[]});
test('Imagine uses the existing verified edit connection and blocks disconnected, read-only, expired and busy routes',()=>{
  const ready=view();assert.equal(imagineAvailability(ready).enabled,true);
  for(const override of [{agentConnected:false},{online:false},{status:'conflict'},{connection:{...ready.connection,permission:'read'}},{connection:{...ready.connection,messageExpiresAt:Date.now()-1000}}])assert.equal(imagineAvailability({...ready,...override}).enabled,false);
  const pending={...ready,messages:[{id:'pending',connectionId:'connection',deliveryMode:'events',status:'reading',delivery:'queued',receipt:'evt_chat_pending'}],connection:{...ready.connection,id:'connection'}};
  assert.equal(imagineAvailability(pending).enabled,false,'a pending native request cannot be bypassed with Imagine');
  pending.messages[0].reply='The previous request is complete';pending.messages[0].status='answered';
  assert.equal(imagineAvailability(pending).enabled,true);
});

test('the two canvas selection steps reuse existing selections, include frame contents and keep the reference separate from the target',()=>{
  const elements=[{id:'index',type:'frame',name:'Finished index',x:0,y:0},{id:'brand',type:'text',text:'My brand',frameId:'index',x:20,y:20},{id:'contact',type:'frame',name:'Contact sketch',x:1000,y:0},{id:'field',type:'rectangle',frameId:'contact',x:1030,y:30},{id:'removed',type:'text',text:'Old design',isDeleted:true}];
  const before=structuredClone(elements),reference=imagineRoleSelection(elements,['index']);
  assert.deepEqual(reference.ids,['index','brand']);
  const target=imagineRoleSelection(elements,['contact'],{role:'target',referenceIds:reference.ids});
  assert.deepEqual(target.ids,['contact','field']);assert.deepEqual(elements,before,'choosing a role never edits drawing objects');
  assert.match(imagineRoleSelection(elements,['brand'],{role:'target',referenceIds:reference.ids}).error,/overlap/);
  assert.match(imagineRoleSelection(elements,[],{role:'target',referenceIds:reference.ids}).error,/select/);
  assert.match(imagineRoleSelection(elements,['removed']).error,/changed/);
  assert.match(imagineRoleSelection(elements,['contact'],{role:'target',referenceIds:['removed']}).error,/reference changed/);
});

test('canvas selection rejects ambiguous multi-page targets and excessive references before sending AI work',()=>{
  const elements=[{id:'ref',type:'rectangle'},{id:'one',type:'frame'},{id:'two',type:'frame'}];
  assert.match(imagineRoleSelection(elements,['one','two'],{role:'target',referenceIds:['ref']}).error,/one page/);
  const many=Array.from({length:501},(_,i)=>({id:`item${i}`,type:'rectangle'}));
  assert.match(imagineRoleSelection(many,many.map(e=>e.id)).error,/500/);
});

test('approved direction survives later requests and reload through board requirements and captured messages',()=>{
  const messages=[{imagine:{designDirection:'Earlier direction',result:{revision:1}}},{imagine:{designDirection:'Latest direction',result:{revision:2}}}];
  assert.equal(savedImagineDirection({messages}),'Latest direction');
  assert.equal(savedImagineDirection({messages,planning:{project:{notes:[{title:'Imagine design direction',status:'open',text:'Approved design system'}]}}}),'Approved design system');
  assert.equal(savedImagineDirection({messages:[]}),'');
  assert.equal(savedImagineDirection({messages:[...messages,{imagine:{designDirection:'Failed direction'}},{imagine:{designDirection:'Undone direction',result:{revision:3,undoneAt:'2026-10-28T12:00:00Z'}}}]}),'Latest direction');
});
