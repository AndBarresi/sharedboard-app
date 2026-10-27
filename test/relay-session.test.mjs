import test from 'node:test';
import assert from 'node:assert/strict';
import {BoardRelay} from '../cloudflare/relay.mjs';
import {MemoryStorage} from './relay-fixtures.mjs';
import {hash,manualPrompt} from '../cloudflare/protocol.mjs';

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
