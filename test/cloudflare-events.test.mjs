import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {McpServer,createMcpHandler,PROTOCOL_VERSION_META_KEY,CLIENT_INFO_META_KEY,CLIENT_CAPABILITIES_META_KEY} from '@modelcontextprotocol/server';
import {eventCatalog,handleEventRpc,eventStatus,dispatchEvent,clearEventSubscriptions,attachEventHandlers} from '../cloudflare/events.mjs';

const boardId='00000000-0000-4000-8000-000000000001',messageId='00000000-0000-4000-8000-000000000002';
const secret=`whsec_${Buffer.alloc(32,12).toString('base64')}`,otherSecret=`whsec_${Buffer.alloc(32,13).toString('base64')}`;
function fixture(){
  const values=new Map(),requests=[];let now=Date.parse('2026-10-27T12:00:00Z');
  const storage={async get(key){return structuredClone(values.get(key));},async put(key,value){values.set(key,structuredClone(value));}};
  const options={principal:'test-grant',boardId,storage,allowedCallbackOrigins:['https://chatgpt.com'],now:()=>now,async callbackFetch(url,init){requests.push({url,...init});const data=JSON.parse(init.body);return Response.json(data.type==='verification'?{challenge:data.challenge}:{accepted:true});}};
  return {options,values,requests,advance(milliseconds){now+=milliseconds;}};
}
const subscribe=(changes={})=>({name:eventCatalog[0].name,arguments:{boardId},delivery:{mode:'webhook',url:'https://chatgpt.com/mcp-events/private-callback',secret},...changes});
const send=(f,input={id:messageId,kind:'chat',intent:'discuss'})=>dispatchEvent(input,f.options);
function verifySignature(request,key=secret){
  const id=request.headers['webhook-id'],timestamp=request.headers['webhook-timestamp'];
  const expected=`v1,${createHmac('sha256',Buffer.from(key.slice(6),'base64')).update(`${id}.${timestamp}.${request.body}`).digest('base64')}`;
  assert.ok(request.headers['webhook-signature'].split(' ').includes(expected));
}

test('event discovery is board-authenticated and automatic delivery waits for a verified provider subscription',async()=>{
  const f=fixture();assert.deepEqual(await handleEventRpc('events/list',{},f.options),{events:eventCatalog});
  assert.equal((await eventStatus(f.options)).automaticMessages,false);
  assert.equal((await send(f)).delivery,'manual');assert.equal(f.requests.length,0);
  await assert.rejects(handleEventRpc('events/list',{}, {...f.options,principal:''}),error=>error.code===-32001);
  const result=await handleEventRpc('events/subscribe',subscribe(),f.options);
  assert.match(result.id,/^sub_[a-f0-9]{40}$/);assert.equal(result.cursor,null);assert.equal(result.truncated,false);
  assert.equal(f.requests.length,1);const request=f.requests[0],body=JSON.parse(request.body);
  assert.equal(request.redirect,'manual');assert.equal(body.type,'verification');assert.ok(body.challenge);verifySignature(request);
  assert.equal(request.headers['X-MCP-Subscription-Id'],result.id);
  const status=await eventStatus(f.options);assert.equal(status.automaticMessages,true);assert.equal(status.automaticReviews,false);
  assert.equal(JSON.stringify(status).includes('private-callback'),false);assert.equal(JSON.stringify(status).includes(secret),false);
  const refreshed=await handleEventRpc('events/subscribe',subscribe(),f.options);assert.equal(refreshed.id,result.id);assert.equal(f.requests.length,1,'brief verified-callback cache avoids repeat challenges');
});

test('chat and review expiry remain independent when one verified subscription ends earlier',async()=>{
 const f=fixture();
 const chat=await handleEventRpc('events/subscribe',subscribe({ttlMs:3600000}),f.options),review=await handleEventRpc('events/subscribe',subscribe({name:eventCatalog[1].name,ttlMs:60000}),f.options);
 const both=await eventStatus(f.options);assert.equal(both.automaticMessages,true);assert.equal(both.automaticReviews,true);assert.equal(both.messageExpiresAt,chat.refreshBefore);assert.equal(both.reviewExpiresAt,review.refreshBefore);assert.equal(both.eventExpiresAt,review.refreshBefore);
 f.advance(60001);const remaining=await eventStatus(f.options);assert.equal(remaining.automaticMessages,true);assert.equal(remaining.automaticReviews,false);assert.equal(remaining.messageExpiresAt,chat.refreshBefore);assert.equal(remaining.reviewExpiresAt,null);assert.equal(remaining.eventExpiresAt,chat.refreshBefore);
});

test('callbacks are fail closed to exact operator-approved HTTPS origins, with no arbitrary fetch or secret-bearing errors',async()=>{
  const f=fixture();
  for(const url of ['http://chatgpt.com/callback','https://user@chatgpt.com/callback','https://chatgpt.com:444/callback','https://chatgpt.com/callback#fragment','https://chatgpt.com.evil.example/callback','https://127.0.0.1/callback','https://[::1]/callback','https://metadata.google.internal/callback'])await assert.rejects(handleEventRpc('events/subscribe',subscribe({delivery:{mode:'webhook',url,secret}}),f.options),error=>error.code===-32015);
  await assert.rejects(handleEventRpc('events/subscribe',subscribe(),{...f.options,allowedCallbackOrigins:[]}),error=>error.data.callbackOrigin==='https://chatgpt.com'&&!JSON.stringify(error).includes('private-callback')&&!JSON.stringify(error).includes(secret));
  assert.equal(f.requests.length,0);
  for(const key of ['wrong',`whsec_${Buffer.alloc(23).toString('base64')}`,`whsec_${Buffer.alloc(65).toString('base64')}`])await assert.rejects(handleEventRpc('events/subscribe',subscribe({delivery:{...subscribe().delivery,secret:key}}),f.options));
  await assert.rejects(handleEventRpc('events/subscribe',subscribe({arguments:{boardId:'00000000-0000-4000-8000-000000000003'}}),f.options),error=>error.code===-32001);
  await assert.rejects(handleEventRpc('events/subscribe',subscribe({arguments:{boardId,extra:'unapproved'}}),f.options));
  assert.equal(f.requests.length,0);
});

test('verification rejects wrong echoes and redirects without making the connection automatic',async()=>{
  for(const mode of ['wrong','redirect','oversized']){
    const f=fixture();f.options.callbackFetch=async(url,init)=>{f.requests.push({url,...init});return mode==='wrong'?Response.json({challenge:'wrong'}):mode==='redirect'?new Response(null,{status:302,headers:{location:'https://evil.example'}}):Response.json({challenge:'x'.repeat(9000)});};
    await assert.rejects(handleEventRpc('events/subscribe',subscribe(),f.options),error=>error.code===-32015);
    assert.equal(f.requests.length,1);assert.equal((await eventStatus(f.options)).automaticMessages,false);
  }
});

test('events carry routing identifiers only, are signed, and duplicate notification retries do not duplicate accepted delivery',async()=>{
  const f=fixture();await handleEventRpc('events/subscribe',subscribe(),f.options);
  const result=await send(f);assert.equal(result.delivery,'queued');assert.equal(f.requests.length,2);
  const request=f.requests[1],body=JSON.parse(request.body);verifySignature(request);
  assert.deepEqual(body.data,{boardId,id:messageId,kind:'chat',intent:'discuss'});assert.equal(body.name,'sharedboard.message.created');assert.equal(body.eventId,request.headers['webhook-id']);assert.equal(body.cursor,null);
  assert.equal(JSON.stringify(body).includes('text'),false);assert.equal(JSON.stringify(body).includes('visual'),false);
  const duplicate=await send(f);assert.equal(duplicate.receipt,result.receipt);assert.equal(f.requests.length,2);
  assert.deepEqual(await send(f,{id:messageId,kind:'review',intent:'work'}),{delivery:'manual',automaticMessages:false},'a chat subscription must not receive review events');
});

test('transient failures retry bounded attempts with the same event identity and never claim a reply was completed',async()=>{
  const f=fixture();await handleEventRpc('events/subscribe',subscribe(),f.options);let attempts=0;
  f.options.callbackFetch=async(url,init)=>{f.requests.push({url,...init});attempts++;return new Response(null,{status:attempts<3?503:202});};
  const result=await send(f);assert.equal(result.delivery,'queued');assert.equal(attempts,3);
  const sent=f.requests.slice(1);assert.equal(new Set(sent.map(request=>request.headers['webhook-id'])).size,1);assert.equal(new Set(sent.map(request=>request.body)).size,1);assert.equal(result.reply,undefined);
  for(const request of sent)verifySignature(request);
  const g=fixture();await handleEventRpc('events/subscribe',subscribe(),g.options);let failures=0;g.options.callbackFetch=async()=>{failures++;throw new Error('network reset');};
  assert.equal((await send(g)).delivery,'uncertain');assert.equal(failures,3);
});

test('expiry, unsubscribe, disconnected access, and removed callback approval stop future automatic delivery',async()=>{
  const f=fixture();const result=await handleEventRpc('events/subscribe',subscribe({ttlMs:60000}),f.options);
  f.advance(60001);assert.equal((await eventStatus(f.options)).automaticMessages,false);assert.equal((await send(f)).delivery,'manual');assert.equal(f.requests.length,1);
  await handleEventRpc('events/subscribe',subscribe(),f.options);
  const revoked={...f.options,allowedCallbackOrigins:[]};assert.equal((await eventStatus(revoked)).automaticMessages,false);
  assert.equal((await dispatchEvent({id:messageId,kind:'chat',intent:'discuss'},revoked)).delivery,'manual');
  await handleEventRpc('events/unsubscribe',subscribe(),revoked);assert.equal((await eventStatus(f.options)).automaticMessages,false);
  await handleEventRpc('events/unsubscribe',subscribe(),revoked);
  await handleEventRpc('events/subscribe',subscribe(),f.options);await clearEventSubscriptions(f.options);assert.equal((await eventStatus(f.options)).automaticMessages,false);
  assert.equal((await send(f)).delivery,'manual');assert.ok(result.id);
});

test('secret rotation verifies the replacement, briefly signs with both keys, and ignores other principals',async()=>{
  const f=fixture();const original=await handleEventRpc('events/subscribe',subscribe(),f.options);
  const renewed=await handleEventRpc('events/subscribe',subscribe({delivery:{...subscribe().delivery,secret:otherSecret}}),f.options);assert.equal(renewed.id,original.id);assert.equal(f.requests.length,2);verifySignature(f.requests[1],otherSecret);
  await send(f);verifySignature(f.requests[2],secret);verifySignature(f.requests[2],otherSecret);
  const stranger={...f.options,principal:'another-grant'};assert.equal((await eventStatus(stranger)).automaticMessages,false);assert.equal((await dispatchEvent({id:messageId,kind:'chat'},stranger)).delivery,'manual');
  await clearEventSubscriptions(stranger);assert.equal((await eventStatus(f.options)).automaticMessages,true);
});

test('an unsubscribe during callback verification cancels the pending subscription',async()=>{
  const f=fixture();let received,release;
  const pending=new Promise(resolve=>{received=resolve;}),pause=new Promise(resolve=>{release=resolve;});
  f.options.callbackFetch=async(url,init)=>{const body=JSON.parse(init.body);received();await pause;return Response.json({challenge:body.challenge});};
  const subscription=handleEventRpc('events/subscribe',subscribe(),f.options);
  await pending;await handleEventRpc('events/unsubscribe',subscribe(),f.options);release();
  await assert.rejects(subscription,/connection changed/);assert.equal((await eventStatus(f.options)).automaticMessages,false);
});

test('one board event cannot silently wake multiple conversations, but an expired subscription does not block a fresh connection',async()=>{
  const f=fixture(),first=subscribe({ttlMs:60000}),second=subscribe({delivery:{...subscribe().delivery,url:'https://chatgpt.com/mcp-events/a-different-conversation'}});
  await handleEventRpc('events/subscribe',first,f.options);
  await assert.rejects(handleEventRpc('events/subscribe',second,f.options),error=>error.data.reason==='conversation_already_connected');assert.equal(f.requests.length,1);
  await handleEventRpc('events/subscribe',first,f.options);assert.equal(f.requests.length,1,'the same conversation can refresh idempotently');
  f.advance(60001);const next=await handleEventRpc('events/subscribe',second,f.options);assert.match(next.id,/^sub_/);assert.equal(f.requests.length,2);
  await handleEventRpc('events/unsubscribe',second,f.options);await handleEventRpc('events/subscribe',first,f.options);assert.equal((await eventStatus(f.options)).eventSubscriptions,1);
});

test('the SDK discovers event capabilities and serves custom event methods with the required MCP 2.0 envelope',async()=>{
  const f=fixture(),handler=createMcpHandler(()=>attachEventHandlers(new McpServer({name:'sharedboard-events-test',version:'test'}),(method,params)=>handleEventRpc(method,params,f.options)),{legacy:'reject'});
  const request=async(method,params={},extraHeaders={})=>{
    const response=await handler.fetch(new Request('https://connect.sharedboard.app/mcp',{method:'POST',headers:{'content-type':'application/json','accept':'application/json, text/event-stream','mcp-protocol-version':'2026-07-28','mcp-method':method,...extraHeaders},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params:{...params,_meta:{[PROTOCOL_VERSION_META_KEY]:'2026-07-28',[CLIENT_INFO_META_KEY]:{name:'sharedboard-event-tests',version:'1'},[CLIENT_CAPABILITIES_META_KEY]:{}}}})}));
    const text=await response.text();let result;try{result=JSON.parse(text);}catch{const line=text.split('\n').find(line=>line.startsWith('data: '));assert.ok(line,text);result=JSON.parse(line.slice(6));}
    return {response,result};
  };
  try{
    const discovered=await request('server/discover');assert.equal(discovered.response.status,200,JSON.stringify(discovered.result));assert.deepEqual(discovered.result.result.capabilities.events,{});assert.ok(discovered.result.result.supportedVersions.includes('2026-07-28'));
    const listed=await request('events/list');assert.equal(listed.response.status,200,JSON.stringify(listed.result));assert.deepEqual(listed.result.result.events,eventCatalog);
    const approved=await request('events/subscribe',subscribe());assert.match(approved.result.result.id,/^sub_/);assert.equal((await eventStatus(f.options)).automaticMessages,true);
    const removed=await request('events/unsubscribe',subscribe());assert.equal(removed.result.error,undefined);assert.equal((await eventStatus(f.options)).automaticMessages,false);
    const invalid=await handler.fetch(new Request('https://connect.sharedboard.app/mcp',{method:'POST',headers:{'content-type':'application/json','mcp-protocol-version':'2026-07-28','mcp-method':'events/list'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'events/list',params:{}})}));assert.equal(invalid.status,400,'custom events must not bypass protocol envelope validation');
  }finally{await handler.close();}
});
