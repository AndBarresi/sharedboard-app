import test from 'node:test';
import assert from 'node:assert/strict';
import {BoardRelay} from '../cloudflare/relay.mjs';
import {MemoryStorage} from './relay-fixtures.mjs';
import {hash,manualPrompt} from '../cloudflare/protocol.mjs';
import {panelOperation,queuePanelRequest} from '../cloudflare/panel-state.mjs';

class Socket{
 constructor(ctx,handler){this.ctx=ctx;this.handler=handler;this.messages=[];this.readyState=1;this.attachment={authenticated:false,createdAt:Date.now()};ctx.sockets.push(this);}
 serializeAttachment(value){this.attachment=structuredClone(value);}
 deserializeAttachment(){return structuredClone(this.attachment);}
 send(text){const value=JSON.parse(text);this.messages.push(value);if(this.handler)queueMicrotask(()=>this.handler(value));}
 close(code,reason){this.readyState=3;this.closed={code,reason};this.ctx.sockets=this.ctx.sockets.filter(ws=>ws!==this);}
}
async function fixture(permission='edit'){
 const storage=new MemoryStorage(),ctx={storage,sockets:[],blockConcurrencyWhile:fn=>fn(),getWebSockets(){return this.sockets;},setWebSocketAutoResponse(){}},relay=new BoardRelay(ctx,{EVENT_CALLBACK_ORIGINS:''});await relay.ready;
 const created=await relay.create({id:crypto.randomUUID(),boardId:crypto.randomUUID(),title:'Test browser board',provider:'codex',permission}),grant={id:created.sessionId,familyId:crypto.randomUUID(),sessionId:created.sessionId,boardId:created.connection.boardId,clientId:crypto.randomUUID(),scope:permission==='edit'?'board.read board.write':'board.read'};
 relay.meta.authorizedClient=grant.clientId;relay.meta.authorizedScope=grant.scope;relay.meta.authorizedFamily=grant.familyId;await relay.save();
 const call=async(operation,input={})=>{const result=await relay.fetch(new Request('https://internal/agent/call',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({grant,operation,input})}));return {status:result.status,data:await result.json()};};
 const pair=await call('pair',{code:created.pairing.code});assert.equal(pair.status,200);
 return {relay,storage,ctx,created,grant,call,async socket(handler){const ws=new Socket(ctx,handler);await relay.webSocketMessage(ws,JSON.stringify({type:'authenticate',browserToken:created.browserToken,clientId:crypto.randomUUID()}));return ws;}};
}
test('relay refuses board access until explicit pairing and validates browser ownership credentials',async()=>{
 const f=await fixture();assert.equal((await f.relay.connection()).connected,true);await assert.rejects(f.relay.browser(`${crypto.randomUUID()}.${'a'.repeat(64)}`),/Reconnect/);const serialized=JSON.stringify([...f.storage.map]);assert.ok(!serialized.includes(f.created.browserToken));assert.ok(!serialized.includes(f.created.pairing.code));
 await assert.rejects(f.relay.authorized({...f.grant,boardId:crypto.randomUUID()}),/no longer belongs/);await assert.rejects(f.relay.authorized({...f.grant,familyId:crypto.randomUUID()}),/no longer belongs/);
});
test('offline relay has no drawing fallback and read-only permission blocks writes before delivery',async()=>{
 const f=await fixture('read');assert.equal((await f.call('read')).status,503);assert.equal((await f.call('add',{elements:[{text:'Private drawing text'}]})).status,403);assert.ok(!JSON.stringify([...f.storage.map]).includes('Private drawing text'));
});
test('browser RPC preserves command IDs, returns actual results and only accepts the owning authenticated socket',async()=>{
 const f=await fixture();let owner;owner=await f.socket(async frame=>{if(frame.type==='command')await f.relay.webSocketMessage(owner,JSON.stringify({type:'result',id:frame.command.id,connectionId:f.created.sessionId,result:{revision:7,elements:[]}}));});
 const read=await f.call('read');assert.equal(read.status,200);assert.equal(read.data.revision,7);const confirm=await f.call('confirm',{revision:7});assert.equal(confirm.status,200);assert.ok((await f.relay.connection()).boardCheckedAt);
 const command=owner.messages.find(frame=>frame.type==='command').command;assert.equal(command.connectionId,f.created.sessionId);assert.ok(command.expiresAt>Date.now());assert.ok(!JSON.stringify([...f.storage.map]).includes('"elements"'));
});
test('relay forwards optimistic-version conflict details without turning them into a success',async()=>{
 const f=await fixture();let ws;ws=await f.socket(async frame=>{if(frame.type==='command')await f.relay.webSocketMessage(ws,JSON.stringify({type:'result',id:frame.command.id,error:{message:'This object changed.',status:409,code:'VERSION_CONFLICT',conflicts:['shape-a']}}));});
 const response=await f.call('edit',{edits:[{id:'shape-a',expectedVersion:1,changes:{x:10}}]});assert.equal(response.status,409);assert.equal(response.data.code,'VERSION_CONFLICT');
});
test('a failed captured-message read does not verify receipt; a successful review read verifies receipt without claiming a reply or chat identity',async()=>{
 const f=await fixture();let ws;ws=await f.socket(async frame=>{if(frame.type!=='command')return;const command=frame.command;await f.relay.webSocketMessage(ws,JSON.stringify({type:'result',id:command.id,...(command.operation==='chat'?{error:{message:'That captured message does not exist.',status:404,code:'NOT_FOUND'}}:{result:{request:{id:command.input.id,status:'reviewing'},board:{revision:1}}})}));});
 const failed=await f.call('read_chat_message',{id:crypto.randomUUID()});assert.equal(failed.status,404);assert.equal((await f.relay.connection()).deliveryCheckedAt,null);
 const reviewed=await f.call('read_review_request',{id:crypto.randomUUID()});assert.equal(reviewed.status,200);const connection=await f.relay.connection();assert.ok(connection.deliveryCheckedAt);assert.equal(connection.replyCheckedAt,null);assert.equal(connection.chatIdentityVerified,false);
});

test('legacy panel acknowledgements never prove model receipt, while an actual captured-request read persists new proof',async()=>{
 const f=await fixture(),legacyAck='2026-01-01T00:00:00.000Z';f.relay.meta.deliveryCheckedAt=legacyAck;await f.relay.save();
 const restored=new BoardRelay(f.ctx,{EVENT_CALLBACK_ORIGINS:''});await restored.ready;assert.equal(restored.meta.deliveryCheckedAt,legacyAck);assert.equal((await restored.connection()).deliveryCheckedAt,null,'a persisted old host ACK is not a model read');
 let allowRead=false,ws;ws=await f.socket(async frame=>{if(frame.type!=='command')return;const command=frame.command;await f.relay.webSocketMessage(ws,JSON.stringify({type:'result',id:command.id,...(command.operation==='chat'&&!allowRead?{error:{message:'Captured request is unavailable.',status:404,code:'NOT_FOUND'}}:{result:command.operation==='chat'?{message:{id:command.input.id,text:'Synthetic captured message'},board:{revision:1}}:{ok:true}})}));});
 assert.equal((await f.call('read_chat_message',{id:crypto.randomUUID()})).status,404);assert.equal((await f.relay.connection()).deliveryCheckedAt,null);assert.equal(f.relay.meta.modelRequestReadAt,undefined);
 allowRead=true;assert.equal((await f.call('read_chat_message',{id:crypto.randomUUID()})).status,200);const readProof=f.relay.meta.modelRequestReadAt;assert.ok(readProof);assert.notEqual(readProof,legacyAck);assert.equal((await f.relay.connection()).deliveryCheckedAt,readProof);assert.equal(f.relay.meta.deliveryCheckedAt,legacyAck,'legacy metadata need not be erased or trusted');
 const afterRead=new BoardRelay(f.ctx,{EVENT_CALLBACK_ORIGINS:''});await afterRead.ready;assert.equal((await afterRead.connection()).deliveryCheckedAt,readProof);assert.equal((await afterRead.connection()).automaticMessages,false);
 assert.equal((await f.call('reply_to_chat_message',{id:crypto.randomUUID(),text:'Actual synthetic fixture reply.'})).status,200);assert.ok((await f.relay.connection()).replyCheckedAt);assert.equal((await f.relay.connection()).automaticMessages,false,'an explicit read and reply cannot establish future automatic submission');
 delete f.relay.meta.modelRequestReadAt;assert.equal((await f.relay.connection()).deliveryCheckedAt,f.relay.meta.replyCheckedAt,'a previously saved actual reply remains valid receipt evidence');
});
test('multiple browser tabs cannot execute the same board commands concurrently',async()=>{
 const f=await fixture(),owner=await f.socket(),other=await f.socket();assert.equal(other.closed.code,4009);assert.equal(f.relay.owner(),owner);await f.relay.webSocketMessage(owner,JSON.stringify({type:'ping'}));assert.equal(owner.messages.at(-1).type,'pong');
});
test('stable write retries use the same command ID and secrets/drawing bodies are not durable',async()=>{
 const f=await fixture();let ws;ws=await f.socket(async frame=>{if(frame.type==='command')await f.relay.webSocketMessage(ws,JSON.stringify({type:'result',id:frame.command.id,result:{revision:1,createdIds:['a']}}));});
 const input={elements:[{id:'a',text:'Private drawing data',x:1,y:2}]};await f.call('add',input);await f.call('add',input);const commands=ws.messages.filter(frame=>frame.type==='command');assert.equal(commands[0].command.id,commands[1].command.id);assert.ok(!JSON.stringify([...f.storage.map]).includes('Private drawing data'));
});
test('manual board handoff pins the captured request and uses MCP tools without a local helper command',()=>{
 const id=crypto.randomUUID(),boardId=crypto.randomUUID(),chat=manualPrompt('chat',id,boardId),review=manualPrompt('review',id,boardId);assert.match(chat,/read_chat_message/);assert.match(chat,/reply_to_chat_message/);assert.match(review,/read_review_request/);assert.ok(chat.includes(id)&&chat.includes(boardId));assert.ok(!chat.includes('node.exe'));assert.ok(!chat.includes('agent-cli'));
});

const relayRequest=async(f,path,input)=>{const response=await f.relay.fetch(new Request(`https://internal${path}`,{method:'POST',headers:{'content-type':'application/json',...(path.startsWith('/browser/')?{'x-sharedboard-browser':f.created.browserToken}:{})},body:JSON.stringify(input)}));return {status:response.status,data:await response.json()};};
async function cachedPanel(f){
 // Seed routing metadata created by the previous panel implementation. The
 // production API must not reactivate, claim or confirm these old requests.
 const options=f.relay.panelContext(),opened=await panelOperation('open',{},options);await panelOperation('attach',{viewKey:opened.viewKey},options);
 const pendingId=crypto.randomUUID(),claimedId=crypto.randomUUID();await queuePanelRequest({id:pendingId,kind:'chat',intent:'discuss'},options);await queuePanelRequest({id:claimedId,kind:'chat',intent:'discuss'},options);
 const claimed=await panelOperation('claim',{viewKey:opened.viewKey,id:claimedId,kind:'chat'},options);
 return {viewKey:opened.viewKey,pendingId,claimedId,receipt:claimed.receipt,key:`panel:v1:${options.boardId}:${options.connectionId}:${options.familyId}`};
}

test('cached panel presence never advertises automatic submission and blocked operations preserve original receipts',async()=>{
 const f=await fixture('read'),panel=await cachedPanel(f),before=await f.storage.get(panel.key),status=await f.relay.connection();
 assert.equal(status.panelConnected,true);assert.ok(status.panelExpiresAt);assert.equal(status.panelAutomaticDelivery,false);assert.match(status.panelDeliveryReason,/draft/i);assert.equal(status.automaticMessages,false);assert.equal(status.automaticReviews,false);assert.equal(status.messageExpiresAt,null);assert.equal(status.reviewExpiresAt,null);assert.equal(status.deliveryMode,'manual');assert.equal(status.deliveryCheckedAt,null);
 for(const [operation,input] of [['attach',{}],['claim',{id:panel.pendingId,kind:'chat'}],['confirm',{receipt:panel.receipt}]]){
  const result=await relayRequest(f,'/agent/panel',{grant:f.grant,operation,input:{viewKey:panel.viewKey,...input}});assert.equal(result.status,409);assert.equal(result.data.code,'PANEL_DIRECT_DELIVERY_UNAVAILABLE');assert.match(result.data.error,/draft/i);
  assert.deepEqual(await f.storage.get(panel.key),before,'blocked cached-panel operations must not consume or reset receipts');
 }
 const wrongBoard=await relayRequest(f,'/agent/panel',{grant:{...f.grant,boardId:crypto.randomUUID()},operation:'claim',input:{viewKey:panel.viewKey,id:panel.pendingId,kind:'chat'}});assert.equal(wrongBoard.status,403);assert.equal(wrongBoard.data.code,'CONNECTION_REPLACED');assert.deepEqual(await f.storage.get(panel.key),before);
 const state=await relayRequest(f,'/agent/panel',{grant:f.grant,operation:'state',input:{viewKey:panel.viewKey}});assert.equal(state.status,200);assert.equal(state.data.directDeliveryAvailable,false);assert.match(state.data.directDeliveryReason,/draft/i);assert.equal(state.data.linked,false,'an old cached iframe must see an expired route and pause');assert.deepEqual(state.data.pending,[]);assert.equal(state.data.expiresAt,null);assert.equal((await f.relay.connection()).deliveryCheckedAt,null);
 const expired=await f.storage.get(panel.key);assert.equal(expired.lease.expiresAt,0);assert.deepEqual(expired.requests,before.requests);assert.deepEqual(expired.views,before.views);assert.equal((await f.relay.connection()).panelConnected,false);await relayRequest(f,'/agent/panel',{grant:f.grant,operation:'state',input:{viewKey:panel.viewKey}});assert.deepEqual(await f.storage.get(panel.key),expired,'repeated polling cannot renew the disabled lease');
 const detached=await relayRequest(f,'/agent/panel',{grant:f.grant,operation:'detach',input:{viewKey:panel.viewKey}});assert.equal(detached.status,200);assert.equal(detached.data.linked,false);assert.deepEqual((await f.storage.get(panel.key)).requests,before.requests,'diagnostic detach retains pending and claimed request identities');
});

test('a disabled cached view polling state expires only its own lease and preserves another view and all receipts',async()=>{
 const f=await fixture(),first=await cachedPanel(f),options=f.relay.panelContext(),second=await panelOperation('open',{},options);await panelOperation('attach',{viewKey:second.viewKey},options);await queuePanelRequest({id:crypto.randomUUID(),kind:'review',intent:'discuss'},options);const before=await f.storage.get(first.key);
 const stale=await relayRequest(f,'/agent/panel',{grant:f.grant,operation:'state',input:{viewKey:first.viewKey}});assert.equal(stale.status,200);assert.equal(stale.data.linked,false);assert.deepEqual(stale.data.pending,[]);assert.deepEqual(await f.storage.get(first.key),before,'a stale view cannot expire the newer view lease');assert.equal((await f.relay.connection()).panelConnected,true);
 const current=await relayRequest(f,'/agent/panel',{grant:f.grant,operation:'state',input:{viewKey:second.viewKey}});assert.equal(current.status,200);assert.equal(current.data.linked,false);assert.equal(current.data.expiresAt,null);assert.deepEqual(current.data.pending,[]);const after=await f.storage.get(first.key);assert.equal(after.lease.expiresAt,0);assert.deepEqual(after.requests,before.requests);assert.deepEqual(after.views,before.views);assert.equal(after.generation,before.generation);
});

test('notify rejects a panel-only route without manual fallback or replay while historical handoff remains explicit',async()=>{
 const f=await fixture(),panel=await cachedPanel(f),before=await f.storage.get(panel.key);let ws;
 ws=await f.socket(async frame=>{if(frame.type==='command')await f.relay.webSocketMessage(ws,JSON.stringify({type:'result',id:frame.command.id,result:{messages:[{id:panel.pendingId,connectionId:f.created.sessionId,intent:'discuss'}]}}));});
 const input={kind:'chat',id:panel.pendingId,connectionId:f.created.sessionId};
 for(let attempt=0;attempt<2;attempt++){
  const notify=await relayRequest(f,'/browser/notify',input);assert.equal(notify.status,409);assert.equal(notify.data.code,'DIRECT_DELIVERY_UNAVAILABLE');assert.equal(notify.data.handoffPrompt,undefined);assert.deepEqual(await f.storage.get(panel.key),before);
 }
 const historical=await relayRequest(f,'/browser/handoff',input);assert.equal(historical.status,200);assert.equal(historical.data.delivery,'manual');assert.match(historical.data.handoffPrompt,new RegExp(panel.pendingId));assert.equal(historical.data.connection.automaticMessages,false);assert.equal((await f.relay.connection()).deliveryCheckedAt,null);
});

test('an informational cached panel does not block verified Events or replace their delivery deadlines',async()=>{
 const f=await fixture(),panel=await cachedPanel(f),before=await f.storage.get(panel.key),requests=[],baseContext=f.relay.eventContext.bind(f.relay);
 f.relay.eventContext=()=>({...baseContext(),allowedCallbackOrigins:['https://events.example'],callbackFetch:async(url,init)=>{const body=JSON.parse(init.body);requests.push(body);return Response.json(body.type==='verification'?{challenge:body.challenge}:{accepted:true});}});
 const subscription={name:'sharedboard.message.created',arguments:{boardId:f.grant.boardId},delivery:{mode:'webhook',url:'https://events.example/callback',secret:`whsec_${Buffer.alloc(32,7).toString('base64')}`}};
 const subscribed=await relayRequest(f,'/agent/events',{grant:f.grant,method:'events/subscribe',params:subscription});assert.equal(subscribed.status,200,JSON.stringify(subscribed.data));
 const status=await f.relay.connection();assert.equal(status.panelConnected,true);assert.equal(status.panelAutomaticDelivery,false);assert.equal(status.automaticMessages,true);assert.equal(status.automaticReviews,false);assert.equal(status.deliveryMode,'events');assert.equal(status.messageExpiresAt,subscribed.data.refreshBefore);assert.equal(status.reviewExpiresAt,null);assert.notEqual(status.messageExpiresAt,status.panelExpiresAt);
 let ws;ws=await f.socket(async frame=>{if(frame.type==='command')await f.relay.webSocketMessage(ws,JSON.stringify({type:'result',id:frame.command.id,result:{messages:[{id:panel.pendingId,connectionId:f.created.sessionId,intent:'discuss'}]}}));});
 const notified=await relayRequest(f,'/browser/notify',{kind:'chat',id:panel.pendingId,connectionId:f.created.sessionId});assert.equal(notified.status,200,JSON.stringify(notified.data));assert.equal(notified.data.delivery,'queued');assert.match(notified.data.receipt,/^evt_chat_/);assert.equal(requests.filter(request=>request.type!=='verification').length,1);assert.deepEqual(await f.storage.get(panel.key),before,'Events never claim or replay the legacy panel queue');assert.equal(notified.data.connection.deliveryCheckedAt,null,'a webhook ACK does not prove that a model read the captured request');assert.equal(f.relay.meta.modelRequestReadAt,undefined);
});

test('a finite live MCP wait routes only its captured session and disables new sends while the model processes it',async t=>{
 const f=await fixture('read');t.after(()=>f.relay.revoke());const pending=relayRequest(f,'/agent/live',{grant:f.grant,operation:'wait',input:{waitMs:45000}});
 for(let attempt=0;attempt<30&&(await f.relay.connection()).liveSession?.status!=='waiting';attempt++)await new Promise(resolve=>setImmediate(resolve));
 const waiting=await f.relay.connection();assert.equal(waiting.liveSession.status,'waiting');assert.equal(waiting.automaticMessages,true);assert.equal(waiting.automaticReviews,true);assert.equal(waiting.deliveryMode,'live-session');assert.equal(waiting.messageExpiresAt,waiting.liveSession.waitExpiresAt);assert.equal(waiting.deliveryCheckedAt,null);
 const messageId=crypto.randomUUID(),staleId=crypto.randomUUID();let ws;ws=await f.socket(async frame=>{if(frame.type!=='command')return;const command=frame.command,result=command.operation==='chats'?{messages:[{id:messageId,connectionId:f.created.sessionId,liveSessionId:waiting.liveSession.id,intent:'discuss'},{id:staleId,connectionId:f.created.sessionId,liveSessionId:crypto.randomUUID(),intent:'discuss'}]}:command.operation==='chat'?{message:{id:command.input.id,text:'Captured synthetic live-session message'},board:{revision:1}}:{ok:true};await f.relay.webSocketMessage(ws,JSON.stringify({type:'result',id:command.id,result}));});
 const stale=await relayRequest(f,'/browser/notify',{kind:'chat',id:staleId,connectionId:f.created.sessionId});assert.equal(stale.status,409);assert.equal(stale.data.code,'LIVE_SESSION_REPLACED');assert.equal((await f.relay.connection()).liveSession.status,'waiting');
 const notified=await relayRequest(f,'/browser/notify',{kind:'chat',id:messageId,connectionId:f.created.sessionId});assert.equal(notified.status,200,JSON.stringify(notified.data));assert.match(notified.data.receipt,/^live_/);const result=await pending;assert.equal(result.status,200);assert.equal(result.data.status,'request');assert.equal(result.data.sessionId,waiting.liveSession.id);assert.deepEqual(result.data.requests,[{id:messageId,kind:'chat',intent:'discuss'}]);
 const processing=await f.relay.connection();assert.equal(processing.liveSession.status,'processing');assert.equal(processing.deliveryMode,'live-session');assert.equal(processing.automaticMessages,false);assert.equal(processing.automaticReviews,false);assert.equal(processing.deliveryCheckedAt,null);assert.equal((await f.call('read_chat_message',{id:messageId})).status,200);assert.equal((await f.call('reply_to_chat_message',{id:messageId,text:'Actual synthetic reply.'})).status,200);assert.equal((await f.relay.connection()).automaticMessages,false,'reading and replying do not reopen a wait');
 const resumed=relayRequest(f,'/agent/live',{grant:f.grant,operation:'wait',input:{sessionId:waiting.liveSession.id,waitMs:45000}});for(let attempt=0;attempt<30&&(await f.relay.connection()).liveSession?.status!=='waiting';attempt++)await new Promise(resolve=>setImmediate(resolve));
 const stopped=await relayRequest(f,'/browser/live/stop',{sessionId:waiting.liveSession.id});assert.equal(stopped.status,200);assert.equal(stopped.data.connection.liveSession.status,'stopped');assert.equal(stopped.data.connection.automaticMessages,false);assert.equal((await resumed).data.status,'stopped');
});

test('live MCP waits reject another grant and caller cancellation removes presence without claiming a request',async()=>{
 const f=await fixture();const denied=await relayRequest(f,'/agent/live',{grant:{...f.grant,familyId:crypto.randomUUID()},operation:'wait',input:{waitMs:1}});assert.equal(denied.status,403);assert.equal((await f.relay.connection()).liveSession,null);
 const aborter=new AbortController(),pending=f.relay.fetch(new Request('https://internal/agent/live',{method:'POST',headers:{'content-type':'application/json'},signal:aborter.signal,body:JSON.stringify({grant:f.grant,operation:'wait',input:{waitMs:45000}})}));for(let attempt=0;attempt<30&&(await f.relay.connection()).liveSession?.status!=='waiting';attempt++)await new Promise(resolve=>setImmediate(resolve));assert.equal((await f.relay.connection()).automaticMessages,true);aborter.abort();const response=await pending,result=await response.json();assert.equal(result.status,'stopped');assert.deepEqual(result.requests,[]);assert.equal((await f.relay.connection()).automaticMessages,false);assert.equal((await f.relay.connection()).liveSession.status,'stopped');await f.relay.revoke();assert.equal(await f.storage.get(f.relay.liveSession().key),undefined);
});
