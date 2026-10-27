import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {McpServer,createMcpHandler,PROTOCOL_VERSION_META_KEY,CLIENT_INFO_META_KEY,CLIENT_CAPABILITIES_META_KEY} from '@modelcontextprotocol/server';
import {eventCatalog,handleEventRpc,eventStatus,dispatchEvent,clearEventSubscriptions,attachEventHandlers} from '../cloudflare/events.mjs';
import {BoardRelay} from '../cloudflare/relay.mjs';
import {handleRequest} from '../cloudflare/worker.mjs';
import {createRequire} from 'node:module';
import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const boardId='00000000-0000-4000-8000-000000000001',messageId='00000000-0000-4000-8000-000000000002';
const secret=`whsec_${Buffer.alloc(32,12).toString('base64')}`,otherSecret=`whsec_${Buffer.alloc(32,13).toString('base64')}`;
function fixture(){
  const values=new Map(),requests=[];let now=Date.parse('2026-10-27T12:00:00Z');
  const storage={async get(key){return structuredClone(values.get(key));},async put(key,value){values.set(key,structuredClone(value));},async delete(key){values.delete(key);},async transaction(operation){return operation(storage);}};
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
    const blocked=await request('events/subscribe',subscribe({delivery:{mode:'webhook',url:'https://unapproved-provider.example/private-callback?private=test-secret',secret}}));
    assert.equal(blocked.result.error?.code,-32015,JSON.stringify(blocked.result));assert.deepEqual(blocked.result.error.data,{reason:'callback_not_approved',callbackOrigin:'https://unapproved-provider.example'});
    assert.equal(JSON.stringify(blocked.result).includes('private-callback'),false);assert.equal(JSON.stringify(blocked.result).includes('test-secret'),false);assert.equal(JSON.stringify(blocked.result).includes(secret),false);
    const invalid=await handler.fetch(new Request('https://connect.sharedboard.app/mcp',{method:'POST',headers:{'content-type':'application/json','mcp-protocol-version':'2026-07-28','mcp-method':'events/list'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'events/list',params:{}})}));assert.equal(invalid.status,400,'custom events must not bypass protocol envelope validation');
  }finally{await handler.close();}
});

test('event activation records only fixed scoped metadata for rejected, pending, and verified subscriptions',async()=>{
  const f=fixture(),privateUrl='https://new-provider.example/private-route?token=activation-private-token';
  assert.equal((await eventStatus(f.options)).eventActivation,null);
  await assert.rejects(handleEventRpc('events/subscribe',subscribe({delivery:{mode:'webhook',url:privateUrl,secret}}),f.options),error=>error.code===-32015);
  assert.deepEqual((await eventStatus(f.options)).eventActivation,{attemptedAt:'2026-10-27T12:00:00.000Z',outcome:'rejected',reason:'callback_not_approved',callbackOrigin:'https://new-provider.example'});
  for(const value of [JSON.stringify((await eventStatus(f.options)).eventActivation),JSON.stringify([...f.values])])for(const privateValue of [secret,'private-route','activation-private-token'])assert.equal(value.includes(privateValue),false);
  const stranger={...f.options,principal:'another-principal'};assert.equal((await eventStatus(stranger)).eventActivation,null);await clearEventSubscriptions(stranger);assert.equal((await eventStatus(f.options)).eventActivation.reason,'callback_not_approved');
  f.advance(1000);const otherBoard='00000000-0000-4000-8000-000000000003';
  await assert.rejects(handleEventRpc('events/subscribe',subscribe({arguments:{boardId:otherBoard},delivery:{mode:'webhook',url:privateUrl,secret}}),f.options),error=>error.code===-32001);
  assert.deepEqual((await eventStatus(f.options)).eventActivation,{attemptedAt:'2026-10-27T12:00:01.000Z',outcome:'rejected',reason:'scope_mismatch'});assert.equal((await eventStatus({...f.options,boardId:otherBoard})).eventActivation,null);
  await assert.rejects(handleEventRpc('events/subscribe',null,f.options));assert.equal((await eventStatus(f.options)).eventActivation.reason,'invalid_parameters');
  await handleEventRpc('events/subscribe',subscribe(),f.options);assert.equal((await eventStatus(f.options)).eventActivation.outcome,'verified');assert.equal((await eventStatus(f.options)).eventActivation.reason,'callback_verified');
  await clearEventSubscriptions(f.options);assert.equal((await eventStatus(f.options)).eventActivation,null);
});

test('a late verification cannot overwrite a newer activation diagnostic or restore one after revocation',async()=>{
  const f=fixture();let received,release;const entered=new Promise(resolve=>{received=resolve;}),gate=new Promise(resolve=>{release=resolve;});
  f.options.callbackFetch=async(url,init)=>{received();await gate;return Response.json({challenge:JSON.parse(init.body).challenge});};
  const first=handleEventRpc('events/subscribe',subscribe(),f.options);await entered;assert.equal((await eventStatus(f.options)).eventActivation.outcome,'pending');
  f.advance(1000);await assert.rejects(handleEventRpc('events/subscribe',subscribe({delivery:{...subscribe().delivery,secret:'invalid-private-secret'}}),f.options));
  release();await first;assert.equal((await eventStatus(f.options)).eventActivation.reason,'invalid_parameters');assert.equal((await eventStatus(f.options)).eventActivation.attemptedAt,'2026-10-27T12:00:01.000Z');
  await clearEventSubscriptions(f.options);
  let enterAgain,releaseAgain;const enteredAgain=new Promise(resolve=>{enterAgain=resolve;}),gateAgain=new Promise(resolve=>{releaseAgain=resolve;});
  f.options.callbackFetch=async(url,init)=>{enterAgain();await gateAgain;return Response.json({challenge:JSON.parse(init.body).challenge});};
  const pending=handleEventRpc('events/subscribe',subscribe(),f.options);await enteredAgain;await clearEventSubscriptions(f.options);releaseAgain();await assert.rejects(pending,/connection changed/);assert.equal((await eventStatus(f.options)).eventActivation,null);
});

test('the actual Worker and BoardRelay preserve MCP callback rejection code and sanitized data across the internal HTTP boundary',async()=>{
  const f=fixture(),sessionId=crypto.randomUUID(),familyId=crypto.randomUUID(),grant={sessionId,boardId,familyId,clientId:'event-activation-test',scope:'board.read'};
  await f.options.storage.put('session',{id:sessionId,boardId,activatedAt:new Date().toISOString(),expiresAt:Date.now()+60_000,authorizedFamily:familyId,authorizedClient:grant.clientId,authorizedScope:grant.scope,provider:'chatgpt'});
  const ctx={storage:f.options.storage,blockConcurrencyWhile:operation=>operation(),getWebSockets:()=>[]},relay=new BoardRelay(ctx,{EVENT_CALLBACK_ORIGINS:''});
  const env={RELAY_AUTH:{idFromName:name=>name,get:()=>({fetch:async()=>Response.json(grant)})},BOARD_RELAY:{idFromName:id=>id,get:id=>{assert.equal(id,sessionId);return {fetch:request=>relay.fetch(request)};}}};
  const method='events/subscribe',params=subscribe({delivery:{mode:'webhook',url:'https://new-provider.example/private-path?secret=must-not-leak',secret}});
  const response=await handleRequest(new Request('https://connect.sharedboard.app/mcp',{method:'POST',headers:{authorization:'Bearer '+'a'.repeat(64),'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2026-07-28','mcp-method':method},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params:{...params,_meta:{[PROTOCOL_VERSION_META_KEY]:'2026-07-28',[CLIENT_INFO_META_KEY]:{name:'event-activation-test',version:'1'},[CLIENT_CAPABILITIES_META_KEY]:{}}}})}),env);
  const text=await response.text(),result=text.trim().startsWith('{')?JSON.parse(text):JSON.parse(text.split('\n').find(line=>line.startsWith('data: ')).slice(6));
  assert.equal(response.status,200);assert.equal(result.error.code,-32015,JSON.stringify(result));assert.deepEqual(result.error.data,{reason:'callback_not_approved',callbackOrigin:'https://new-provider.example'});
  for(const privateValue of ['private-path','must-not-leak',secret])assert.equal(JSON.stringify(result).includes(privateValue),false);
  const diagnostic=(await eventStatus({...f.options,principal:sessionId,allowedCallbackOrigins:[]})).eventActivation;assert.equal(diagnostic.reason,'callback_not_approved');assert.equal(diagnostic.callbackOrigin,'https://new-provider.example');
});

test('real workerd verifies and delivers signed callbacks through native fetch without rebinding its receiver',{timeout:15000},async()=>{
  const root=fileURLToPath(new URL('../',import.meta.url)),requireWrangler=createRequire(realpathSync(new URL('../node_modules/wrangler/package.json',import.meta.url))),{Miniflare,convertV4MiniflareOptions}=requireWrangler('miniflare'),{build}=requireWrangler('esbuild'),requests=[];
  const source=`import {handleEventRpc,eventStatus,dispatchEvent} from './cloudflare/events.mjs';
    export default {async fetch(request){
      const values=new Map(),storage={get:async key=>structuredClone(values.get(key)),put:async(key,value)=>{values.set(key,structuredClone(value));}};
      const options={principal:'isolated-native-fetch',boardId:${JSON.stringify(boardId)},storage,allowedCallbackOrigins:['https://callback.example'],...(new URL(request.url).pathname==='/injected'?{callbackFetch:fetch}:{})};
      try{const subscription=await handleEventRpc('events/subscribe',{name:'sharedboard.message.created',arguments:{boardId:${JSON.stringify(boardId)}},delivery:{mode:'webhook',url:'https://callback.example/private-path?token=fixture-only',secret:${JSON.stringify(secret)}}},options);
        const delivery=await dispatchEvent({id:${JSON.stringify(messageId)},kind:'chat',intent:'discuss'},options);return Response.json({subscription,delivery,status:await eventStatus(options)});
      }catch(error){return Response.json({error:{code:error.code,reason:error.data?.reason}});}
    }};`;
  const bundle=await build({stdin:{contents:source,resolveDir:root,sourcefile:'native-event-fetch-test.mjs'},bundle:true,format:'esm',platform:'neutral',target:'es2022',conditions:['workerd','worker','browser'],external:['node:*'],write:false,logLevel:'silent'});
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-27',compatibilityFlags:['nodejs_compat'],outboundService:async request=>{const body=await request.text();requests.push({url:request.url,body,headers:Object.fromEntries(request.headers)});const data=JSON.parse(body);return Response.json(data.type==='verification'?{challenge:data.challenge}:{accepted:true});}}));
  try{await mf.ready;for(const mode of ['injected','default']){const before=requests.length,result=await (await mf.dispatchFetch('https://worker.example/'+mode)).json();assert.equal(result.error,undefined,JSON.stringify(result));assert.equal(result.status.automaticMessages,true);assert.equal(result.delivery.delivery,'queued');assert.equal(result.status.eventActivation.outcome,'verified');const sent=requests.slice(before);assert.equal(sent.length,2);for(const request of sent)verifySignature(request);assert.equal(JSON.parse(sent[0].body).type,'verification');assert.equal(JSON.parse(sent[1].body).name,'sharedboard.message.created');}}
  finally{await mf.dispose();}
});
