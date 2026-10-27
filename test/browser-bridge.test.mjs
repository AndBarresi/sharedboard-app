import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {createBrowserTransport} from '../src/browser-store.mjs';
import {createBrowserBridge,validateBridgeDeadline} from '../src/browser-bridge.mjs';
import {startBridge} from '../bridge/server.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6Z5kAAAAASUVORK5CYII=';
const call=(t,path,input,method=input===undefined?'GET':'POST')=>t.request(path,{method,...(input===undefined?{}:{body:JSON.stringify(input)})});
const wait=async(predicate)=>{for(let i=0;i<200;i++){if(await predicate())return;await new Promise(r=>setTimeout(r,5));}throw new Error('Bridge fixture timed out');};
class TestChannel{
 static channels=new Map();
 constructor(name){this.name=name;this.closed=false;if(!TestChannel.channels.has(name))TestChannel.channels.set(name,new Set());TestChannel.channels.get(name).add(this);}
 postMessage(data){for(const peer of TestChannel.channels.get(this.name))if(peer!==this)queueMicrotask(()=>{if(!peer.closed)peer.onmessage?.({data:structuredClone(data)});});}
 close(){this.closed=true;TestChannel.channels.get(this.name).delete(this);}
}
class FakeBridge{
 token='private-browser-token'; connection=null; waiters=[]; commands=[]; receipts=new Map(); results=new Map(); notifyCount=0; owner=null; onNotify=null; loseReceipt=false; offline=false;
 response(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});}
 flush(){const waiter=this.waiters.shift();if(waiter){waiter.cleanup();waiter.resolve(this.response({connection:structuredClone(this.connection),commands:this.commands.splice(0)}));}}
 activate(){Object.assign(this.connection,{connected:true,id:crypto.randomUUID(),label:'Existing Codex conversation',automaticMessages:true,connectedAt:new Date().toISOString(),browserOnline:true});this.flush();}
 async fetch(url,options={}){
  if(this.offline)throw new Error('Fixture bridge offline');
  const path=new URL(url).pathname.replace('/bridge',''),body=options.body?JSON.parse(options.body):{};
  if(path==='/health')return this.response({ok:true,product:'SharedBoard Bridge',version:'fixture'});
  if(path==='/browser/pair'){this.connection={connected:false,boardId:body.boardId,provider:'codex',permission:body.permission};return this.response({browserToken:this.token,code:'fixture-code',expiresAt:new Date(Date.now()+60000).toISOString(),setup:{prompt:'Fixture pairing prompt'}});}
  assert.equal(options.headers['x-sharedboard-browser'],this.token);
  if(path==='/browser/status')return this.response({connection:this.connection});
  if(path==='/browser/events'){
   if(this.owner&&this.owner!==body.clientId)return this.response({error:'Another tab owns the browser lease'},409);this.owner=body.clientId;
   if(this.commands.length)return this.response({connection:this.connection,commands:this.commands.splice(0)});
   return new Promise((resolve,reject)=>{const entry={resolve,cleanup:()=>options.signal?.removeEventListener('abort',abort)},abort=()=>{this.waiters=this.waiters.filter(w=>w!==entry);reject(new DOMException('Aborted','AbortError'));};this.waiters.push(entry);options.signal?.addEventListener('abort',abort,{once:true});});
  }
  if(path==='/browser/result'){assert.equal(body.clientId,this.owner);const target=this.results.get(body.id);if(target){this.results.delete(body.id);target(body);}return this.response({ok:true});}
  if(path==='/browser/notify'){this.notifyCount++;await this.onNotify?.(body);const key=`${body.kind}:${body.id}`;if(!this.receipts.has(key))this.receipts.set(key,{delivery:'queued',receipt:{provider:'codex-cli',queueMessageId:crypto.randomUUID()}});if(this.loseReceipt){this.loseReceipt=false;throw new Error('Receipt response lost');}return this.response(this.receipts.get(key));}
  if(path==='/browser/disconnect'){this.connection={...this.connection,connected:false};return this.response({connection:this.connection});}
  if(path==='/browser/release'){if(this.owner===body.clientId)this.owner=null;return this.response({ok:true});}
  throw new Error(`Unexpected bridge URL ${path}`);
 }
 command(operation,input={},extra={}){const id=extra.id??crypto.randomUUID();return new Promise(resolve=>{this.results.set(id,resolve);this.commands.push({id,connectionId:this.connection.id,operation,input,...extra});this.flush();});}
}
async function fixture(permission='edit',overrides={}){
 const bridge=new FakeBridge(),config={indexedDB:new IDBFactory(),dbName:crypto.randomUUID(),origin:'https://sharedboard.app',BroadcastChannel:null,bridgeFetch:bridge.fetch.bind(bridge),bridgePollDelay:10,...overrides},t=await createBrowserTransport(config);
 await t.ready();const pair=await call(t,'/api/connection/pairing',{provider:'codex',permission});assert.equal(pair.setup.prompt,'Fixture pairing prompt');bridge.activate();await t.bridgeStatus();await wait(async()=>(await call(t,'/api/connection')).connected);return {t,bridge,config};
}
const capture=async(t,extra={})=>{const board=await call(t,'/api/board'),plan=await call(t,'/api/planning');return {id:crypto.randomUUID(),boardId:board.id,expectedRevision:board.revision,expectedPlanningVersion:plan.version,selectedIds:[],scope:'board',visual:png,...extra};};

test('hosted bridge edits real browser objects and enforces optimistic versions, permissions and command authority',async()=>{
 const {t,bridge}=await fixture();try{
  assert.equal((await t.detectBridge()).available,true);
  const add=await bridge.command('add_elements',{elements:[{id:'card',x:20,y:30,width:200,height:100,text:'Budget'}]});assert.equal(add.result.revision,1);assert.deepEqual(add.result.createdIds,['card','card_label']);
  let board=await call(t,'/api/board');assert.equal(board.activity[0].actor,'agent');assert.equal((await call(t,'/api/planning')).recoveries.length,1);
  const read=await bridge.command('read_board',{});assert.equal(read.result.boardId,t.boardId);assert.equal(read.result.elements.find(e=>e.id==='card').editVersion,1);
  const edit=await bridge.command('edit_elements',{edits:[{id:'card',expectedVersion:1,changes:{x:100,text:'Trip budget'}}]});assert.equal(edit.result.revision,2);board=await call(t,'/api/board');assert.equal(board.elements.find(e=>e.id==='card_label').text,'Trip budget');
  const conflict=await bridge.command('edit_elements',{edits:[{id:'card',expectedVersion:1,changes:{x:999}}]});assert.equal(conflict.error.status,409);assert.equal((await call(t,'/api/board')).revision,2);
  const wrong=await bridge.command('add_elements',{elements:[{id:'wrong'}]},{connectionId:crypto.randomUUID()});assert.equal(wrong.error.status,403);assert.equal((await call(t,'/api/board')).elements.some(e=>e.id==='wrong'),false);
  const confirm=await bridge.command('confirm_connection',{revision:1});assert.equal(confirm.error.status,409);assert.equal((await bridge.command('confirm_connection',{revision:2})).result.confirmed,true);
  const plan=await call(t,'/api/planning');assert.equal(plan.agentActions[0].count,2);assert.equal(plan.agentActions[0].after.length,2);
 }finally{t.close();}
 const readonly=await fixture('read');try{assert.equal((await readonly.bridge.command('read_board')).result.access.permission,'read');assert.equal((await readonly.bridge.command('add_elements',{elements:[{id:'denied'}]})).error.status,403);}finally{readonly.t.close();}
});

test('expired or malformed bridge command deadlines reject late writes without changing the scene or recovery history',async()=>{
 const {t,bridge}=await fixture();try{
  const expired=await bridge.command('add_elements',{elements:[{id:'expired-box'}]},{expiresAt:Date.now()-1});assert.equal(expired.error.code,'STALE_BRIDGE_COMMAND');
  const malformed=await bridge.command('add_elements',{elements:[{id:'invalid-deadline-box'}]},{expiresAt:'tomorrow'});assert.equal(malformed.error.code,'INVALID_BRIDGE_DEADLINE');
  assert.equal((await call(t,'/api/board')).revision,0);assert.equal((await call(t,'/api/board')).elements.length,0);assert.equal((await call(t,'/api/planning')).recoveries.length,0);
  // A fresh read cannot refresh the deadline of a distinct already-expired job.
  await bridge.command('read_board');const afterRead=await bridge.command('add_elements',{elements:[{id:'still-expired'}]},{expiresAt:Date.now()-1});assert.equal(afterRead.error.code,'STALE_BRIDGE_COMMAND');assert.equal((await call(t,'/api/board')).revision,0);
  assert.doesNotThrow(()=>validateBridgeDeadline({}));for(const expiresAt of [null,0,-1,NaN,Infinity,'123'])assert.throws(()=>validateBridgeDeadline({expiresAt}),error=>error.code==='INVALID_BRIDGE_DEADLINE');
 }finally{t.close();}
});

test('a command expiring during its IndexedDB transaction rolls back both drawing and staged recovery',async()=>{
 let armed=false,calls=0;const baseline=Date.now(),f=await fixture('edit',{now:()=>armed&&++calls>=5?baseline+60000:baseline});
 try{armed=true;const rejected=await f.bridge.command('add_elements',{elements:[{id:'expires-during-save'}]},{expiresAt:baseline+30000});assert.equal(rejected.error.code,'STALE_BRIDGE_COMMAND');assert.ok(calls>=5);assert.equal((await call(f.t,'/api/board')).revision,0);assert.equal((await call(f.t,'/api/board')).elements.length,0);assert.equal((await call(f.t,'/api/planning')).recoveries.length,0);}finally{f.t.close();}
});

test('human undo of an AI card survives editor label normalization and stays available after disconnect',async()=>{
 const {t,bridge}=await fixture();try{
  await bridge.command('add_elements',{elements:[{id:'undo-card',x:10,y:20,text:'A long editable card label'}]});let board=await call(t,'/api/board');const action=(await call(t,'/api/planning')).agentActions[0];
  const normalized=board.elements.map((element,index)=>({...element,index:index?'a1':'a0',...(element.type==='text'?{x:30,y:40,width:180,height:50,text:'A long editable\ncard label'}:{})}));
  await call(t,'/api/board',{changes:normalized.map(element=>({id:element.id,expectedVersion:board.elementVersions[element.id],element}))},'PATCH');
  board=await call(t,'/api/board');const updatedAction=(await call(t,'/api/planning')).agentActions[0];for(const reference of updatedAction.after)assert.equal(reference.expectedVersion,board.elementVersions[reference.id]);
  await call(t,'/api/connection/disconnect',{});assert.equal((await call(t,'/api/connection')).connected,false);assert.deepEqual(await call(t,'/api/undo-agent',{id:action.id}),{ok:true});
  board=await call(t,'/api/board');assert.equal(board.elements.filter(element=>!element.isDeleted).length,0);assert.equal(board.activity[0].actor,'user');const plan=await call(t,'/api/planning');assert.equal(plan.agentActions[0].undone,true);assert.ok(plan.recoveries.some(entry=>entry.name==='Before undoing an AI drawing change'));await assert.rejects(call(t,'/api/undo-agent',{id:action.id}),error=>error.status===409);
 }finally{t.close();}
});

test('human edits after an AI action block its whole undo and preserve all newer work',async()=>{
 const {t,bridge}=await fixture();try{
  await bridge.command('add_elements',{elements:[{id:'keep-card',x:10,y:20,text:'Keep my edit'}]});let board=await call(t,'/api/board');const action=(await call(t,'/api/planning')).agentActions[0],card=board.elements.find(e=>e.id==='keep-card'),edited={...card,x:800,version:card.version+1,versionNonce:card.versionNonce+1,updated:Date.now()};
  await call(t,'/api/board',{changes:[{id:card.id,expectedVersion:board.elementVersions[card.id],element:edited}]},'PATCH');const before=await call(t,'/api/board'),planBefore=await call(t,'/api/planning');
  await assert.rejects(call(t,'/api/undo-agent',{id:action.id}),error=>error.status===409&&error.message.includes('edited afterward'));assert.deepEqual(await call(t,'/api/board'),before);assert.deepEqual(await call(t,'/api/planning'),planBefore);assert.equal(before.elements.find(e=>e.id===card.id).x,800);assert.equal(before.elements.filter(e=>!e.isDeleted).length,2);
 }finally{t.close();}
});

test('mini chat persists before delivery, pins immutable PNG and notes, and returns only actual agent replies',async()=>{
 const {t,bridge}=await fixture();try{
  let plan=await call(t,'/api/planning');plan=await call(t,'/api/planning',{expectedVersion:plan.version,project:{...plan.project,notes:[{id:crypto.randomUUID(),title:'Budget rule',text:'Show remaining funds',kind:'requirement',status:'open',elementIds:[],createdAt:new Date().toISOString(),result:''}]}},'PUT');
  const input=await capture(t,{text:'Review this design',intent:'discuss'});bridge.onNotify=async body=>{assert.equal(body.id,input.id);const saved=await call(t,'/api/chat');assert.equal(saved.messages[0].delivery,'pending');assert.equal(saved.messages[0].status,'waiting');};
  const sent=await call(t,'/api/chat',input);assert.equal(sent.messages[0].delivery,'queued');assert.equal(sent.messages[0].reply,undefined);assert.equal(bridge.notifyCount,1);
  await call(t,'/api/planning',{expectedVersion:plan.version,project:{...plan.project,notes:[]}},'PUT');
  const retry=await call(t,'/api/chat',input);assert.equal(retry.messages.length,1);assert.equal(bridge.notifyCount,1);
  const premature=await bridge.command('reply_to_chat_message',{id:input.id,text:'Premature'});assert.equal(premature.error.status,409);
  const read=await bridge.command('read_chat_message',{id:input.id});assert.equal(read.result.message.intent,'discuss');assert.equal(read.result.board.visual.dataURL,png);assert.equal(read.result.board.planning.notes[0].text,'Show remaining funds');
  const replied=await bridge.command('reply_to_chat_message',{id:input.id,text:'The remaining balance is visible.'});assert.equal(replied.result.status,'answered');assert.equal((await call(t,'/api/chat')).messages[0].reply,'The remaining balance is visible.');
  assert.equal((await bridge.command('reply_to_chat_message',{id:input.id,text:'Replacement'})).error.status,409);
  const backup=JSON.stringify(await call(t,'/api/project/export'));assert.equal(backup.includes(bridge.token),false);assert.equal(backup.includes(input.text),false);
 }finally{t.close();}
});

test('ambiguous delivery retains request ID, uses idempotent queue receipt and never silently retargets another connection',async()=>{
 const {t,bridge}=await fixture();try{
  const input=await capture(t,{text:'Discuss the board',intent:'discuss'});bridge.loseReceipt=true;let out=await call(t,'/api/chat',input);assert.equal(out.messages[0].delivery,'uncertain');assert.equal(out.messages[0].status,'waiting');assert.equal(bridge.receipts.size,1);
  out=await call(t,'/api/chat/retry',{id:input.id});assert.equal(out.messages[0].id,input.id);assert.equal(out.messages[0].delivery,'queued');assert.equal(bridge.receipts.size,1);
  await call(t,'/api/connection/disconnect',{});await call(t,'/api/connection/pairing',{provider:'codex',permission:'edit'});bridge.activate();await t.bridgeStatus();await wait(async()=>(await call(t,'/api/connection')).connected);
  await assert.rejects(call(t,'/api/chat/retry',{id:input.id}),error=>error.status===409);assert.equal((await bridge.command('read_chat_message',{id:input.id})).error.status,403);
 }finally{t.close();}
});

test('named-area reviews preserve empty selection and only global notes and require read before completion',async()=>{
 const {t,bridge}=await fixture();try{
  await bridge.command('add_elements',{elements:[{id:'outside',text:'Outside area'}]});let plan=await call(t,'/api/planning');const areaId=crypto.randomUUID(),note=(title,elementIds)=>({id:crypto.randomUUID(),title,text:title,kind:'note',status:'open',elementIds,createdAt:new Date().toISOString(),result:''});plan=await call(t,'/api/planning',{expectedVersion:plan.version,project:{...plan.project,areas:[{id:areaId,name:'Empty view',elementIds:[],bounds:{x:9000,y:9000,width:100,height:100}}],notes:[note('Global',[]),note('Outside',['outside'])]}},'PUT');
  const input=await capture(t,{scope:'area',areaId,selectedIds:[]});await call(t,'/api/reviews',input);assert.equal((await bridge.command('complete_review',{id:input.id,summary:'Too early'})).error.status,409);
  const read=await bridge.command('read_review_request',{id:input.id});assert.equal(read.result.board.elements.length,0);assert.deepEqual(read.result.board.planning.notes.map(n=>n.title),['Global']);assert.equal(read.result.board.visual.dataURL,png);
  assert.equal((await bridge.command('complete_review',{id:input.id,summary:'Reviewed the empty named area'})).result.status,'reviewed');
  await assert.rejects(call(t,'/api/reviews',await capture(t,{expectedPlanningVersion:0})),error=>error.status===409);
 }finally{t.close();}
});

test('durable command retries do not duplicate drawing edits and browser reload preserves captures and private connection',async()=>{
 const {t,bridge,config}=await fixture();let reopened;try{
  const id=crypto.randomUUID(),input={elements:[{id:'once',text:'One card'}]},first=await bridge.command('add_elements',input,{id});assert.equal(first.result.revision,1);assert.deepEqual((await bridge.command('add_elements',input,{id})).result,first.result);assert.equal((await call(t,'/api/board')).revision,1);
  const message=await capture(t,{text:'Retain this exact request',intent:'work'});await call(t,'/api/chat',message);t.close();await wait(()=>bridge.owner===null);reopened=await createBrowserTransport(config);await reopened.ready();assert.equal((await call(reopened,'/api/connection')).id,bridge.connection.id);assert.equal((await call(reopened,'/api/chat')).messages[0].id,message.id);
  const read=await bridge.command('read_chat_message',{id:message.id});assert.equal(read.result.board.visual.dataURL,png);
 }finally{t.close();reopened?.close();}
});

test('detection verifies the actual bridge product and failed live status does not disable browser drawing storage',async()=>{
 const wrong=createBrowserBridge({load:async()=>null,fetch:async()=>new Response(JSON.stringify({ok:true,product:'Unrelated service'}))});assert.deepEqual((await wrong.detect()).available,false);wrong.close();
 const {t,bridge}=await fixture();try{
  bridge.offline=true;const status=await t.bridgeStatus();assert.equal(status.connected,false);assert.equal(status.browserOnline,false);assert.equal((await call(t,'/api/chat')).connected,false);
  const element={id:'offline-drawing',type:'rectangle',x:0,y:0,width:40,height:40};await call(t,'/api/board',{changes:[{id:element.id,expectedVersion:0,element}]},'PATCH');assert.equal((await call(t,'/api/board')).elements[0].id,element.id);
 }finally{t.close();}
});

test('browser adapter interoperates with actual Node bridge RPC and isolated fake Codex queue in both directions',async()=>{
 const dataDir=await mkdtemp(path.join(os.tmpdir(),'sharedboard-browser-roundtrip-'));let service,t,second;const queued=[];
 try{
  service=await startBridge({port:0,dataDir,findCodex:()=>'/fixture/codex.exe',runQueue:async(command,args)=>{queued.push(args);return `Queued message ${crypto.randomUUID()} for thread ${args[2]}`;},pollTimeoutMs:200,leaseMs:2000,commandTimeoutMs:3000});
  const origin='https://sharedboard.app',browserFetch=(url,options={})=>fetch(url,{...options,headers:{...options.headers,Origin:origin}});
  const config={indexedDB:new IDBFactory(),dbName:crypto.randomUUID(),BroadcastChannel:TestChannel,origin,bridgeFetch:browserFetch,bridgeBaseURL:`${service.url}/bridge`,bridgePollDelay:20};t=await createBrowserTransport(config);await t.ready();assert.equal((await t.detectBridge()).available,true);
  const pair=await call(t,'/api/connection/pairing',{provider:'codex',permission:'edit'}),threadId=crypto.randomUUID(),pairedResponse=await fetch(`${service.url}/bridge/agent/pair`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:pair.pairing.code,threadId})}),agent=await pairedResponse.json();assert.equal(pairedResponse.status,200);await wait(async()=>(await call(t,'/api/connection')).connected);
  const command=async(operation,input={})=>{const response=await fetch(`${service.url}/bridge/agent/command`,{method:'POST',headers:{'Content-Type':'application/json','x-sharedboard-agent':agent.agentKey,'x-sharedboard-thread':threadId},body:JSON.stringify({boardId:t.boardId,operation,input})});const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result;};
  second=await createBrowserTransport(config);await second.ready();let observedRevision=0;second.events.addEventListener('board',event=>{observedRevision=JSON.parse(event.data).board.revision;});
  const added=await command('add_elements',{elements:[{id:'roundtrip',text:'A shared design',x:20,y:20}]});assert.equal(added.revision,1);await wait(()=>observedRevision===1);assert.equal((await call(second,'/api/board')).revision,1);const read=await command('read_board');assert.equal(read.elements[0].editVersion,1);await command('confirm_connection',{revision:read.revision});
  const message=await capture(t,{text:'Describe the design',intent:'discuss'});await Promise.all([call(t,'/api/chat',message),call(second,'/api/chat',message)]);assert.equal(queued.length,1);assert.equal((await call(t,'/api/chat')).messages.length,1);const captured=await command('read_chat_message',{id:message.id});assert.equal(captured.board.visual.dataURL,png);await command('reply_to_chat_message',{id:message.id,text:'The design is a labeled card.'});assert.equal((await call(second,'/api/chat')).messages[0].reply,'The design is a labeled card.');
  const current=await t.bridgeStatus();assert.ok(current.boardCheckedAt);assert.ok(current.deliveryCheckedAt);assert.ok(current.replyCheckedAt);
 }finally{t?.close();second?.close();await service?.close();const target=path.resolve(dataDir);assert.ok(target.startsWith(path.join(os.tmpdir(),'sharedboard-browser-roundtrip-')));await rm(target,{recursive:true,force:true});}
});
