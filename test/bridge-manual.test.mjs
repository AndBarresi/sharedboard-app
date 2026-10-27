// Copyright (c) 2026 Andrew Barresi. SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {IDBFactory} from 'fake-indexeddb';
import {startBridge} from '../bridge/server.mjs';
import {pairBridge,callBridge} from '../bridge/client.mjs';
import {createBrowserTransport} from '../src/browser-store.mjs';

const origin='https://sharedboard.app',png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6Z5kAAAAASUVORK5CYII=';
const call=(t,route,input,method=input===undefined?'GET':'POST')=>t.request(route,{method,...(input===undefined?{}:{body:JSON.stringify(input)})});
async function waitFor(predicate){for(let i=0;i<300;i++){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('Manual bridge fixture timed out');}
async function fixture({automatic=false}={}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'sharedboard-bridge-manual-'));let service,t,queues=0,handoffs=0,rejectHandoff=false;
 const close=async()=>{t?.close();await service?.close();const target=path.resolve(directory);assert.ok(target.startsWith(path.join(os.tmpdir(),'sharedboard-bridge-manual-')));await rm(target,{recursive:true,force:true});};
 try{
  service=await startBridge({port:0,dataDir:directory,findCodex:()=>automatic?'/fixture/codex.exe':null,runQueue:()=>{queues++;throw new Error('Fixture ambiguous queue outcome');},pollTimeoutMs:100,leaseMs:2000,commandTimeoutMs:3000});
  const config={indexedDB:new IDBFactory(),dbName:crypto.randomUUID(),BroadcastChannel:null,origin,bridgeBaseURL:`${service.url}/bridge`,bridgePollDelay:10,bridgeFetch:async(url,input={})=>{
   if(new URL(url).pathname==='/bridge/browser/handoff'){handoffs++;if(rejectHandoff)throw new Error('Fixture handoff response interrupted');}
   return fetch(url,{...input,headers:{...input.headers,Origin:origin}});
  }};
  t=await createBrowserTransport(config);await t.ready();
  const pair=await call(t,'/api/connection/pairing',{provider:'codex',permission:'read'}),options={boardId:t.boardId,dataDir:directory,bridgeUrl:service.url,threadId:crypto.randomUUID()};
  await pairBridge(pair.pairing.code,options);await waitFor(async()=>{const status=await t.bridgeStatus();return status?.connected&&status.browserOnline;});
  return {get t(){return t;},options,directory,get queues(){return queues;},get handoffs(){return handoffs;},set rejectHandoff(value){rejectHandoff=value;},
   capture:async(extra={})=>({id:crypto.randomUUID(),boardId:t.boardId,expectedRevision:(await call(t,'/api/board')).revision,expectedPlanningVersion:(await call(t,'/api/planning')).version,selectedIds:[],scope:'board',visual:png,...extra}),
   async reopen(){t.close();t=await createBrowserTransport(config);await t.ready();await waitFor(async()=>{const status=await t.bridgeStatus();return status?.connected&&status.browserOnline;});},close};
 }catch(error){await close();throw error;}
}

test('a queue-unavailable Codex connection prepares manual chat/review prompts and accepts actual read-only helper replies',async()=>{
 const f=await fixture();try{
  const plan=await call(f.t,'/api/planning'),note={id:crypto.randomUUID(),title:'Keep this context',text:'The original requirement',kind:'requirement',status:'open',elementIds:[],createdAt:new Date().toISOString(),result:''};
  await call(f.t,'/api/planning',{expectedVersion:plan.version,project:{...plan.project,notes:[note]}},'PUT');
  const input=await f.capture({text:'Explain this board',intent:'discuss'}),sent=await call(f.t,'/api/chat',input),message=sent.messages[0];
  assert.equal(sent.automaticMessages,false);assert.equal(message.delivery,'manual');assert.equal(message.status,'waiting');assert.equal(message.reply,undefined);assert.equal(message.receipt,undefined);assert.equal(message.deliveredAt,undefined);
  for(const value of [input.id,input.boardId,f.directory,'--board-id','--data-dir',`chat ${input.id}`])assert.ok(message.handoffPrompt.includes(value));
  const grant=JSON.parse(await readFile(path.join(f.directory,`agent-${input.boardId}.json`),'utf8'));assert.equal(message.handoffPrompt.includes(grant.agentKey),false);
  assert.equal((await call(f.t,'/api/chat',input)).messages.length,1);await call(f.t,'/api/chat/retry',{id:input.id});assert.equal(f.handoffs,1,'a ready manual prompt is reused, never resent');
  await f.reopen();assert.equal((await call(f.t,'/api/chat')).messages[0].handoffPrompt,message.handoffPrompt);
  const latest=await call(f.t,'/api/planning');await call(f.t,'/api/planning',{expectedVersion:latest.version,project:{...latest.project,notes:[]}},'PUT');
  await assert.rejects(callBridge('add_elements',{elements:[{text:'Not authorized'}]},f.options),error=>error.status===403);
  assert.equal((await f.t.bridgeStatus()).deliveryCheckedAt,null,'preparing and reusing a prompt does not verify delivery');
  const captured=await callBridge('read_chat_message',{id:input.id},f.options);assert.equal(captured.message.intent,'discuss');assert.equal(captured.board.visual.dataURL,png);assert.equal(captured.board.planning.notes[0].text,note.text);
  const received=await f.t.bridgeStatus();assert.ok(received.deliveryCheckedAt,'an authenticated read confirms manual receipt');assert.equal(received.replyCheckedAt,null,'a read is not a returned reply');
  await callBridge('reply_to_chat_message',{id:input.id,text:'An actual helper reply'},f.options);assert.equal((await call(f.t,'/api/chat')).messages[0].reply,'An actual helper reply');
  const reviewInput=await f.capture(),review=(await call(f.t,'/api/reviews',reviewInput)).request;assert.equal(review.delivery,'manual');assert.equal(review.status,'requested');assert.ok(review.handoffPrompt.includes(`review ${reviewInput.id}`));
  await callBridge('read_review_request',{id:review.id},f.options);await callBridge('complete_review',{id:review.id,summary:'Actually inspected the captured board'},f.options);
  assert.equal((await call(f.t,'/api/reviews')).requests[0].status,'reviewed');assert.equal(f.queues,0);assert.equal(f.handoffs,2);
  const saved=JSON.parse(await readFile(path.join(f.directory,'bridge-state.json'),'utf8'));assert.deepEqual(saved.deliveries,[]);assert.ok(saved.grants[0].deliveryCheckedAt);assert.ok(saved.grants[0].replyCheckedAt);
  const exported=JSON.stringify(await call(f.t,'/api/project/export'));assert.equal(exported.includes(message.handoffPrompt),false);assert.equal(exported.includes(grant.agentKey),false);assert.equal(exported.includes(input.text),false);
 }finally{await f.close();}
});

test('a manual review verifies receipt only after the helper reads that captured request',async()=>{
 const f=await fixture();try{
  const input=await f.capture(),prepared=(await call(f.t,'/api/reviews',input)).request;assert.equal(prepared.delivery,'manual');
  assert.equal((await f.t.bridgeStatus()).deliveryCheckedAt,null);assert.equal((await f.t.bridgeStatus()).replyCheckedAt,null);
  await assert.rejects(callBridge('read_review_request',{id:crypto.randomUUID()},f.options),error=>error.status===404);
  assert.equal((await f.t.bridgeStatus()).deliveryCheckedAt,null,'a failed read does not verify delivery');
  const read=await callBridge('read_review_request',{id:input.id},f.options);assert.equal(read.request.id,input.id);assert.equal(read.request.status,'reviewing');
  const received=await f.t.bridgeStatus();assert.ok(received.deliveryCheckedAt);assert.equal(received.replyCheckedAt,null);assert.equal(f.queues,0);
 }finally{await f.close();}
});

test('failed manual preparation keeps the immutable request and retries its original ID without claiming delivery',async()=>{
 const f=await fixture();try{
  const input=await f.capture({text:'Keep my message',intent:'discuss'});f.rejectHandoff=true;
  await assert.rejects(call(f.t,'/api/chat',input),error=>error.code==='BRIDGE_UNAVAILABLE');
  const failed=(await call(f.t,'/api/chat')).messages[0];assert.equal(failed.id,input.id);assert.equal(failed.delivery,'failed');assert.equal(failed.handoffPrompt,undefined);assert.equal(failed.receipt,undefined);assert.equal(failed.reply,undefined);
  f.rejectHandoff=false;const retried=await call(f.t,'/api/chat',input);assert.equal(retried.messages.length,1);assert.equal(retried.messages[0].id,input.id);assert.equal(retried.messages[0].delivery,'manual');assert.ok(retried.messages[0].handoffPrompt);assert.equal(f.queues,0);
  await call(f.t,'/api/connection/disconnect',{});await call(f.t,'/api/connection/pairing',{provider:'codex',permission:'read'});
  await assert.rejects(call(f.t,'/api/chat/retry',{id:input.id}),error=>error.status===409);assert.equal((await call(f.t,'/api/chat')).messages[0].handoffPrompt,retried.messages[0].handoffPrompt);
 }finally{await f.close();}
});

test('an ambiguous automatic send never falls back to a manual prompt',async()=>{
 const f=await fixture({automatic:true});try{
  const input=await f.capture({text:'One automatic request',intent:'discuss'}),sent=await call(f.t,'/api/chat',input);assert.equal(sent.messages[0].delivery,'uncertain');assert.equal(sent.messages[0].handoffPrompt,undefined);
  const retry=await call(f.t,'/api/chat/retry',{id:input.id});assert.equal(retry.messages[0].delivery,'uncertain');assert.equal(retry.messages[0].handoffPrompt,undefined);assert.equal(f.queues,1);assert.equal(f.handoffs,0);
 }finally{await f.close();}
});
