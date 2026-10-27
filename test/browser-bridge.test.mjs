import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {createBrowserTransport} from '../src/browser-store.mjs';
import {createBrowserBridge,validateBridgeDeadline} from '../src/browser-relay.mjs';

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
 token='private-browser-token'; connection=null; commands=[]; receipts=new Map(); results=new Map(); notifyCount=0; owner=null; onNotify=null; loseReceipt=false; failHandoff=false; offline=false; requests=[]; sockets=[];
 constructor(){const relay=this;this.WebSocket=class{
  constructor(url){this.url=url;this.readyState=0;relay.sockets.push(this);assert.equal(new URL(url).origin,'wss://connect.sharedboard.app');assert.equal(new URL(url).searchParams.has('token'),false);queueMicrotask(()=>{if(this.readyState!==0)return;this.readyState=1;this.onopen?.();});}
  send(raw){const data=JSON.parse(raw);if(data.type==='authenticate'){assert.equal(data.browserToken,relay.token);this.clientId=data.clientId;if(relay.owner&&relay.owner!==this&&relay.owner.clientId!==this.clientId){this.close(4009);return;}relay.owner=this;this.emit({type:'connection',connection:structuredClone(relay.connection)});relay.flush();return;}if(data.type==='ping'){this.emit({type:'pong'});return;}if(data.type==='result'){const target=relay.results.get(data.id);if(target){relay.results.delete(data.id);target(data);}return;}throw new Error(`Unexpected socket message ${data.type}`);}
  emit(data){queueMicrotask(()=>{if(this.readyState===1)this.onmessage?.({data:JSON.stringify(data)});});}
  close(code=1000){if(this.readyState===3)return;this.readyState=3;if(relay.owner===this)relay.owner=null;queueMicrotask(()=>this.onclose?.({code}));}
 };}
 response(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});}
 flush(){if(this.owner?.readyState===1)for(const command of this.commands.splice(0))this.owner.emit({type:'command',command});}
 activate(){Object.assign(this.connection,{connected:true,label:'Existing Codex conversation',automaticMessages:true,automaticReviews:true,connectedAt:new Date().toISOString(),browserOnline:true});this.owner?.emit({type:'connection',connection:structuredClone(this.connection)});this.flush();}
 async fetch(url,options={}){
  this.requests.push({url,...options});assert.equal(new URL(url).origin,'https://connect.sharedboard.app');
  if(this.offline)throw new Error('Fixture bridge offline');
  const path=new URL(url).pathname,body=options.body?JSON.parse(options.body):{};
  if(path==='/health')return this.response({ok:true,product:'SharedBoard Relay',version:'fixture'});
  if(path==='/browser/pair'){const sessionId=crypto.randomUUID();this.token=`${sessionId}.private-browser-token`;this.connection={connected:false,id:sessionId,boardId:body.boardId,provider:body.provider,permission:body.permission};return this.response({browserToken:this.token,sessionId,connection:this.connection,pairing:{code:'fixture-code',expiresAt:new Date(Date.now()+60000).toISOString()},setup:{prompt:'Fixture pairing prompt'}});}
  assert.equal(options.headers['x-sharedboard-browser'],this.token);
  if(path==='/browser/status')return this.response({connection:this.connection});
  if(path==='/browser/notify'){this.notifyCount++;await this.onNotify?.(body);const key=`${this.connection.id}:${body.kind}:${body.id}`;if(!this.receipts.has(key))this.receipts.set(key,{delivery:'queued',receipt:`evt_${body.kind}_${body.id}`});if(this.loseReceipt){this.loseReceipt=false;throw new Error('Receipt response lost');}return this.response(this.receipts.get(key));}
  if(path==='/browser/handoff')return this.failHandoff?this.response({error:'Fixture handoff unavailable'},503):this.response({delivery:'manual',handoffPrompt:`Read captured ${body.kind} ${body.id} using the connected SharedBoard tools.`,connection:this.connection});
  if(path==='/browser/disconnect'){this.connection={...this.connection,connected:false};return this.response({connection:this.connection});}
  throw new Error(`Unexpected bridge URL ${path}`);
 }
 command(operation,input={},extra={}){const id=extra.id??crypto.randomUUID();return new Promise(resolve=>{this.results.set(id,resolve);this.commands.push({id,connectionId:this.connection.id,operation,input,...extra});this.flush();});}
}
async function fixture(permission='edit',overrides={}){
 const bridge=new FakeBridge(),config={indexedDB:new IDBFactory(),dbName:crypto.randomUUID(),origin:'https://sharedboard.app',BroadcastChannel:null,bridgeFetch:bridge.fetch.bind(bridge),bridgeWebSocket:bridge.WebSocket,bridgePollDelay:10,...overrides},t=await createBrowserTransport(config);
 await t.ready();const pair=await call(t,'/api/connection/pairing',{provider:'codex',permission});assert.equal(pair.setup.prompt,'Fixture pairing prompt');bridge.activate();await t.bridgeStatus();await wait(async()=>(await call(t,'/api/connection')).connected&&bridge.owner?.readyState===1);return {t,bridge,config};
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

test('chat and review subscriptions choose their own delivery paths and expose matching browser and agent status',async()=>{
 for(const capabilities of [
  {name:'chat only',automaticMessages:true,automaticReviews:false,chatDelivery:'queued',reviewDelivery:'manual'},
  {name:'reviews only',automaticMessages:false,automaticReviews:true,chatDelivery:'manual',reviewDelivery:'queued'},
  {name:'older aggregate capability',automaticMessages:true,automaticReviews:undefined,chatDelivery:'queued',reviewDelivery:'queued'},
  {name:'missing capabilities fail closed',automaticMessages:undefined,automaticReviews:undefined,chatDelivery:'manual',reviewDelivery:'manual'},
 ]){
  const {t,bridge}=await fixture();try{
   for(const key of ['automaticMessages','automaticReviews'])if(capabilities[key]===undefined)delete bridge.connection[key];else bridge.connection[key]=capabilities[key];
   await t.bridgeStatus();
   const chat=await call(t,'/api/chat',await capture(t,{text:`Check ${capabilities.name}`,intent:'discuss'})),review=await call(t,'/api/reviews',await capture(t));
   assert.equal(chat.messages[0].delivery,capabilities.chatDelivery,capabilities.name);assert.equal(review.request.delivery,capabilities.reviewDelivery,capabilities.name);
   assert.equal(chat.automaticMessages,capabilities.chatDelivery==='queued');assert.equal(review.automaticMessages,capabilities.reviewDelivery==='queued');
   assert.equal((await call(t,'/api/reviews')).automaticMessages,capabilities.reviewDelivery==='queued');assert.equal((await bridge.command('list_review_requests')).result.automaticMessages,capabilities.reviewDelivery==='queued');
   assert.equal((await bridge.command('list_chat_messages')).result.automaticMessages,capabilities.chatDelivery==='queued');
   const notified=bridge.requests.filter(request=>new URL(request.url).pathname==='/browser/notify').map(request=>JSON.parse(request.body).kind).sort();
   assert.deepEqual(notified,[...(capabilities.chatDelivery==='queued'?['chat']:[]),...(capabilities.reviewDelivery==='queued'?['review']:[])].sort());
  }finally{t.close();}
 }
});

test('a chat-only connection can retry manual review preparation without creating a second captured request',async()=>{
 const {t,bridge}=await fixture();try{
  bridge.connection.automaticReviews=false;await t.bridgeStatus();const input=await capture(t);bridge.failHandoff=true;
  await assert.rejects(call(t,'/api/reviews',input),/Fixture handoff unavailable/);
  const saved=await call(t,'/api/reviews');assert.equal(saved.requests[0].id,input.id);assert.equal(saved.requests[0].delivery,'failed');assert.equal(saved.requests[0].boardRevision,input.expectedRevision);
  bridge.failHandoff=false;const retry=await call(t,'/api/reviews',input);assert.equal(retry.request.id,input.id);assert.equal(retry.request.delivery,'manual');assert.match(retry.request.handoffPrompt,new RegExp(input.id));assert.equal((await call(t,'/api/reviews')).requests.length,1);assert.equal(bridge.notifyCount,0);
 }finally{t.close();}
});

test('an uncertain automatic review never becomes a manual resend when its review subscription expires but chat remains subscribed',async()=>{
 const {t,bridge}=await fixture();try{
  const input=await capture(t);bridge.loseReceipt=true;const sent=await call(t,'/api/reviews',input);assert.equal(sent.request.delivery,'uncertain');assert.equal(bridge.notifyCount,1);assert.equal(bridge.receipts.size,1);
  bridge.connection.automaticReviews=false;await t.bridgeStatus();assert.equal((await call(t,'/api/connection')).automaticMessages,true);
  await assert.rejects(call(t,'/api/reviews/retry',{id:input.id}),error=>error.status===409&&error.code==='DELIVERY_UNCERTAIN'&&error.deliveryUnknown);
  const current=await call(t,'/api/reviews');assert.equal(current.automaticMessages,false);assert.equal(current.requests[0].id,input.id);assert.equal(current.requests[0].delivery,'uncertain');assert.equal(current.requests[0].boardRevision,input.expectedRevision);assert.equal(current.requests[0].planningVersion,input.expectedPlanningVersion);assert.equal(current.requests[0].handoffPrompt,undefined);assert.equal(bridge.notifyCount,1);
  assert.equal(bridge.requests.filter(request=>new URL(request.url).pathname==='/browser/handoff').length,0);
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

test('detection verifies the hosted relay product and failed live status does not disable browser drawing storage',async()=>{
 const wrong=createBrowserBridge({load:async()=>null,fetch:async()=>new Response(JSON.stringify({ok:true,product:'Unrelated service'}))});assert.deepEqual((await wrong.detect()).available,false);wrong.close();
 const {t,bridge}=await fixture();try{
  bridge.offline=true;const status=await t.bridgeStatus();assert.equal(status.connected,false);assert.equal(status.browserOnline,false);assert.equal((await call(t,'/api/chat')).connected,false);
  const element={id:'offline-drawing',type:'rectangle',x:0,y:0,width:40,height:40};await call(t,'/api/board',{changes:[{id:element.id,expectedVersion:0,element}]},'PATCH');assert.equal((await call(t,'/api/board')).elements[0].id,element.id);
 }finally{t.close();}
});

test('preparing a new connection replaces an explicitly expired or revoked browser grant',async()=>{
 for(const status of [401,403]){
  const boardId=crypto.randomUUID(),sessionId=crypto.randomUUID(),oldToken='expired-browser-grant',newToken='fresh-browser-grant',requests=[],saves=[];
  let state={browserToken:oldToken,sessionId:crypto.randomUUID(),connection:{boardId,connected:false}};
  const bridge=createBrowserBridge({boardId,clientId:'browser-tab',WebSocket:null,load:async()=>state,save:async(value,options)=>{saves.push({value,options});state=value;return true;},fetch:async(url,options)=>{
   const path=new URL(url).pathname;requests.push({path,...options});
   if(path==='/browser/disconnect')return Response.json({error:'This board connection ended. Connect it again from SharedBoard.app.',code:'RELAY_DISCONNECTED'},{status});
   assert.equal(path,'/browser/pair');assert.equal(options.headers['x-sharedboard-browser'],undefined);assert.deepEqual(JSON.parse(options.body),{boardId,title:'Retained browser board',provider:'chatgpt',permission:'read',clientId:'browser-tab'});
   return Response.json({browserToken:newToken,sessionId,connection:{id:sessionId,boardId,connected:false},pairing:{code:'new-pairing-code'},setup:{prompt:'Fresh instructions'}});
  }});
  try{
   assert.deepEqual(await bridge.pair({provider:'chatgpt',permission:'read'},'Retained browser board'),{pairing:{code:'new-pairing-code'},setup:{prompt:'Fresh instructions'}});
   assert.deepEqual(requests.map(request=>request.path),['/browser/disconnect','/browser/pair']);assert.equal(requests[0].headers['x-sharedboard-browser'],oldToken);
   assert.deepEqual(saves[0],{value:null,options:{expectedToken:oldToken}});assert.equal(state.browserToken,newToken);assert.equal(state.connection.boardId,boardId);assert.equal(saves.length,2);
  }finally{bridge.close();}
 }
});

test('an uncertain or unsuccessful old-grant disconnect preserves it and never prepares a replacement',async()=>{
 for(const outcome of ['network',503,409,'unreadable','uncertain-401','uncertain-403']){
  const boardId=crypto.randomUUID(),initial={browserToken:'existing-browser-grant',connection:{boardId,connected:true}},requests=[],saves=[];
  let state=initial;
  const bridge=createBrowserBridge({boardId,clientId:'browser-tab',WebSocket:null,load:async()=>state,save:async(value)=>{saves.push(value);state=value;},fetch:async(url)=>{
   const path=new URL(url).pathname;requests.push(path);assert.equal(path,'/browser/disconnect');
   if(outcome==='network')throw new Error('Response lost');
   if(outcome==='unreadable')return new Response('Not JSON',{status:401});
   const uncertain=typeof outcome==='string',status=uncertain?Number(outcome.slice(-3)):outcome;
   return Response.json({error:'Disconnect could not be confirmed',...(uncertain?{deliveryUnknown:true}:{})},{status});
  }});
  try{
   await assert.rejects(bridge.pair({provider:'chatgpt',permission:'read'},'Browser board'));
   assert.deepEqual(requests,['/browser/disconnect'],String(outcome));assert.deepEqual(saves,[],String(outcome));assert.equal(state,initial);
  }finally{bridge.close();}
 }
});

test('hosted WebSocket operations synchronize browser tabs and mini-chat replies without a local process',async()=>{
 const {t,bridge,config}=await fixture('edit',{BroadcastChannel:TestChannel});let second;
 try{
  second=await createBrowserTransport(config);await second.ready();let observedRevision=0;second.events.addEventListener('board',event=>{observedRevision=JSON.parse(event.data).board.revision;});
  const added=await bridge.command('add_elements',{elements:[{id:'roundtrip',text:'A shared design',x:20,y:20}]});assert.equal(added.result.revision,1);await wait(()=>observedRevision===1);assert.equal((await call(second,'/api/board')).revision,1);const read=await bridge.command('read_board');assert.equal(read.result.elements[0].editVersion,1);await bridge.command('confirm_connection',{revision:read.result.revision});
  const message=await capture(t,{text:'Describe the design',intent:'discuss'});await Promise.all([call(t,'/api/chat',message),call(second,'/api/chat',message)]);assert.equal(bridge.notifyCount,1);assert.equal((await call(t,'/api/chat')).messages.length,1);const captured=await bridge.command('read_chat_message',{id:message.id});assert.equal(captured.result.board.visual.dataURL,png);await bridge.command('reply_to_chat_message',{id:message.id,text:'The design is a labeled card.'});assert.equal((await call(second,'/api/chat')).messages[0].reply,'The design is a labeled card.');
  assert.ok(bridge.requests.every(request=>new URL(request.url).origin==='https://connect.sharedboard.app'));
 }finally{t.close();second?.close();}
});

test('an old local bridge grant is never forwarded to the hosted service while existing drawings, captures and recovery remain saved',async()=>{
 const {t,bridge,config}=await fixture();let reopened;
 try{
  await bridge.command('add_elements',{elements:[{id:'saved-before-migration',text:'Keep this existing board'}]});
  const message=await capture(t,{text:'Keep this captured request',intent:'discuss'});await call(t,'/api/chat',message);
  const before=await call(t,'/api/board'),planningBefore=await call(t,'/api/planning'),boardId=t.boardId;
  t.close();await wait(()=>bridge.owner===null);
  const db=await new Promise((resolve,reject)=>{const request=config.indexedDB.open(config.dbName);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  const legacyToken='private-legacy-local-bridge-token';
  await new Promise((resolve,reject)=>{const transaction=db.transaction('meta','readwrite'),meta=transaction.objectStore('meta');meta.delete(`relay:v1:${boardId}`);meta.put({key:`bridge:${boardId}`,value:{browserToken:legacyToken,connection:{connected:true,id:crypto.randomUUID(),boardId,provider:'codex'}}});meta.put({key:`bridge:v1:${boardId}`,value:{browserToken:legacyToken}});transaction.oncomplete=resolve;transaction.onabort=()=>reject(transaction.error);});db.close();
  const requestCount=bridge.requests.length,socketCount=bridge.sockets.length;
  reopened=await createBrowserTransport(config);await reopened.ready();await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal((await call(reopened,'/api/connection')).connected,false);assert.equal(bridge.requests.length,requestCount);assert.equal(bridge.sockets.length,socketCount);
  assert.deepEqual(await call(reopened,'/api/board'),before);assert.deepEqual(await call(reopened,'/api/planning'),planningBefore);assert.equal((await call(reopened,'/api/chat')).messages[0].id,message.id);
  await call(reopened,'/api/connection/pairing',{provider:'codex',permission:'edit'});bridge.activate();await reopened.bridgeStatus();await wait(()=>bridge.owner?.readyState===1);
  assert.equal(JSON.stringify(bridge.requests).includes(legacyToken),false);assert.deepEqual(await call(reopened,'/api/board'),before);
  const exported=JSON.stringify(await call(reopened,'/api/project/export'));assert.equal(exported.includes(legacyToken),false);assert.equal(exported.includes(bridge.token),false);
 }finally{t.close();reopened?.close();}
});
