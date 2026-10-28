import test from 'node:test';
import assert from 'node:assert/strict';
import {BoardRelay} from '../cloudflare/relay.mjs';
import {ChannelState,CHANNEL_PRESENCE_TTL} from '../cloudflare/channel-state.mjs';
import {handleRequest} from '../cloudflare/worker.mjs';
import {MemoryStorage} from './relay-fixtures.mjs';
import {createRequire} from 'node:module';
import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

class Socket{
 constructor(ctx,{role='browser',handler}={}){this.ctx=ctx;this.handler=handler;this.readyState=1;this.messages=[];this.attachment={role,authenticated:false,createdAt:Date.now()};ctx.sockets.push(this);}
 serializeAttachment(value){this.attachment=structuredClone(value);}
 deserializeAttachment(){return structuredClone(this.attachment);}
 send(text){const frame=JSON.parse(text);this.messages.push(frame);if(this.handler)queueMicrotask(()=>this.handler(frame));}
 close(code,reason){this.readyState=3;this.closed={code,reason};this.ctx.sockets=this.ctx.sockets.filter(ws=>ws!==this);}
}
async function fixture({permission='edit',pair=true,provider='claude-code',mode}={}){
 const storage=new MemoryStorage(),ctx={storage,sockets:[],blockConcurrencyWhile:fn=>fn(),getWebSockets(){return this.sockets;},setWebSocketAutoResponse(){}},relay=new BoardRelay(ctx,{});await relay.ready;
 const created=await relay.create({id:crypto.randomUUID(),boardId:crypto.randomUUID(),provider,...(mode?{mode}:{}),permission,title:'Isolated channel board'}),instanceId=crypto.randomUUID(),records=new Map();
 const f={storage,ctx,relay,created,instanceId,records};
 f.request=async(path,input={},token=created.browserToken)=>{const response=await f.relay.fetch(new Request('https://internal'+path,{method:'POST',headers:{'content-type':'application/json',...(path.startsWith('/browser/')?{'x-sharedboard-browser':token}:{})},body:JSON.stringify(input)}));return {status:response.status,data:await response.json()};};
 f.call=(operation,input={},changes={})=>f.request('/channel/call',{channelToken:f.paired?.channelToken,instanceId,operation,input,...changes});
 f.capture=(changes={})=>{const record={id:crypto.randomUUID(),connectionId:created.sessionId,channelSessionId:instanceId,kind:'chat',intent:'discuss',channelTest:false,status:'waiting',...changes};records.set(record.id,record);return record;};
 f.notify=(record,{test=false}={})=>f.request('/browser/notify',{kind:record.kind,id:record.id,...(test?{test:true}:{})});
 f.openChannel=async({token=f.paired?.channelToken,instance=instanceId}={})=>{const ws=new Socket(ctx,{role:'channel'});await f.relay.webSocketMessage(ws,JSON.stringify({type:'authenticate',channelToken:token,instanceId:instance}));return ws;};
 const browser=new Socket(ctx,{handler:async frame=>{
  if(frame.type!=='command')return;const {id,operation,input}=frame.command;let result;
  if(operation==='chats'||operation==='reviews')result={[operation==='chats'?'messages':'requests']:[...records.values()].filter(item=>item.kind===(operation==='chats'?'chat':'review'))};
  else if(operation==='chat'||operation==='review'){const record=records.get(input.id);if(record)record.status=operation==='chat'?'reading':'reviewing';result={[operation==='chat'?'message':'request']:record,board:{revision:1},boardChangedSinceRequest:false};}
  else if(operation==='reply'){const record=records.get(input.id);Object.assign(record,{status:'answered',reply:input.text});result={...record};}
  else if(operation==='complete_review'){const record=records.get(input.id);Object.assign(record,{status:'reviewed',summary:input.summary});result={...record};}
  else result={revision:1,boardId:created.connection.boardId,ok:true};
  await f.relay.webSocketMessage(browser,JSON.stringify({type:'result',id,connectionId:created.sessionId,result}));
 }});await relay.webSocketMessage(browser,JSON.stringify({type:'authenticate',browserToken:created.browserToken,clientId:'isolated-browser'}));f.browser=browser;
 if(pair){const response=await f.request('/channel/pair',{connectionCode:created.pairing.code,instanceId});assert.equal(response.status,200,JSON.stringify(response.data));f.paired=response.data;f.channel=await f.openChannel();}
 f.verify=async()=>{const record=f.capture({channelTest:true});assert.equal((await f.notify(record,{test:true})).status,200);assert.equal((await f.call('chat',{id:record.id})).status,200);assert.equal((await f.call('reply',{id:record.id,text:'The isolated channel client read this test capture and returns its actual test answer.'})).status,200);return record;};
 return f;
}

test('new Claude Code setup is channel-only and one-use pairing is atomic, scoped, and secret-free in durable metadata',async()=>{
 const f=await fixture({pair:false});assert.equal(f.created.setup.kind,'claude-channel');assert.match(f.created.pairing.code,new RegExp('^'+f.created.sessionId+'\\.[a-f0-9]{64}$'));assert.equal(f.created.connection.channelConnected,false);
 const results=await Promise.all([f.request('/channel/pair',{connectionCode:f.created.pairing.code,instanceId:f.instanceId,providerSessionId:'actual-native-session'}),f.request('/channel/pair',{connectionCode:f.created.pairing.code,instanceId:crypto.randomUUID()})]);
 assert.deepEqual(results.map(item=>item.status).sort(),[200,409]);const paired=results.find(item=>item.status===200).data;
 assert.equal(paired.browserToken,undefined);assert.equal(paired.permission,'edit');assert.match(paired.socketURL,/\/channel\/socket\?session=/);assert.equal(paired.connection.deliveryMode,'claude-channel');assert.equal(paired.connection.automaticMessages,false);
 const serialized=JSON.stringify([...f.storage.map]);for(const value of [paired.channelToken,f.created.browserToken,f.created.pairing.code,'actual-native-session'])assert.equal(serialized.includes(value),false);
 assert.equal((await f.request('/channel/pair',{connectionCode:f.created.pairing.code,instanceId:f.instanceId})).status,409);
 assert.equal((await f.request('/browser/authorize',{familyId:crypto.randomUUID(),scope:'board.read',clientId:'foreign-oauth'})).data.code,'CHANNEL_ONLY');
 await assert.rejects(f.relay.authorized({sessionId:f.created.sessionId,boardId:f.created.connection.boardId,familyId:f.relay.meta.authorizedFamily,clientId:f.relay.meta.authorizedClient,scope:f.relay.meta.authorizedScope}),error=>error.code==='CONNECTION_REPLACED');
});

test('invalid and expired codes cannot consume a channel or convert a legacy remote connection',async()=>{
 const f=await fixture({pair:false}),wrong=f.created.sessionId+'.'+'0'.repeat(64);
 assert.equal((await f.request('/channel/pair',{connectionCode:wrong,instanceId:f.instanceId})).data.code,'PAIRING_EXPIRED');assert.equal(f.relay.meta.activatedAt,undefined);
 f.relay.meta.pairingExpiresAt=Date.now()-1;await f.relay.save();assert.equal((await f.request('/channel/pair',{connectionCode:f.created.pairing.code,instanceId:f.instanceId})).data.code,'PAIRING_EXPIRED');
 const storage=new MemoryStorage(),ctx={storage,blockConcurrencyWhile:fn=>fn(),getWebSockets:()=>[]},relay=new BoardRelay(ctx,{});await relay.ready;
 const legacy=await relay.create({id:crypto.randomUUID(),boardId:crypto.randomUUID(),provider:'claude-code',mode:'remote-mcp',permission:'read',title:'Legacy remote board'});
 await assert.rejects(relay.pairChannel({connectionCode:legacy.sessionId+'.'+legacy.pairing.code,instanceId:crypto.randomUUID()}),error=>error.code==='CHANNEL_UNAUTHORIZED');assert.equal(relay.meta.mode,'remote-mcp');assert.equal(relay.meta.activatedAt,undefined);
});

test('channel tokens cannot become browser owners, impersonate OAuth grants, or move into another process',async()=>{
 const f=await fixture();assert.equal(f.relay.owner(),f.browser);assert.equal(f.relay.sockets().includes(f.channel),false);
 const tokenAsBrowser=new Socket(f.ctx);await f.relay.webSocketMessage(tokenAsBrowser,JSON.stringify({type:'authenticate',browserToken:f.paired.channelToken,clientId:'attacker'}));assert.equal(tokenAsBrowser.closed.code,4001);assert.equal(f.relay.owner(),f.browser);
 const wrongInstance=await f.openChannel({instance:crypto.randomUUID()});assert.equal(wrongInstance.closed.code,4001);const ownerAsChannel=await f.openChannel({token:f.created.browserToken});assert.equal(ownerAsChannel.closed.code,4001);
 assert.equal((await f.call('read',{}, {instanceId:crypto.randomUUID()})).data.code,'CHANNEL_UNAUTHORIZED');assert.equal((await f.call('read',{}, {channelToken:f.created.browserToken})).data.code,'CHANNEL_UNAUTHORIZED');
 await f.relay.webSocketMessage(f.channel,JSON.stringify({type:'result',id:crypto.randomUUID(),result:{ok:true}}));assert.equal(f.channel.closed.code,4001);assert.equal(f.relay.owner(),f.browser);assert.equal((await f.relay.connection()).channelConnected,false);
});

test('presence and stdio acknowledgements never verify delivery; only a routed capture read plus actual reply enables sends',async()=>{
 const f=await fixture();let status=await f.relay.connection();assert.equal(status.channelConnected,true);assert.equal(status.channelVerified,false);assert.equal(status.automaticMessages,false);assert.equal(status.channelSessionId,f.instanceId);
 const ordinary=f.capture();assert.equal((await f.notify(ordinary)).data.code,'CHANNEL_NOT_VERIFIED');assert.equal((await f.notify(ordinary,{test:true})).data.code,'CHANNEL_TEST_INVALID');assert.equal((await f.call('add',{elements:[{text:'Must not reach browser'}]})).data.code,'CHANNEL_TEST_READ_ONLY');
 const record=f.capture({channelTest:true});f.channel.handler=frame=>{if(frame.type==='channel_request')assert.ok(f.storage.map.get('local-channel.v1').claims.some(item=>item.id===frame.id),'claim must already be durable when the first socket write occurs');};
 const sent=await f.notify(record,{test:true});assert.equal(sent.status,200);assert.equal(sent.data.receipt,'ch_chat_'+record.id);
 const frame=f.channel.messages.find(item=>item.type==='channel_request');assert.deepEqual(frame,{type:'channel_request',id:record.id,kind:'chat',intent:'discuss',boardId:f.created.connection.boardId,connectionId:f.created.sessionId,instanceId:f.instanceId,receipt:sent.data.receipt});
 assert.ok((await f.storage.get('local-channel.v1')).claims.find(item=>item.id===record.id));
 await f.relay.webSocketMessage(f.channel,JSON.stringify({type:'channel_written',id:record.id,kind:'chat',receipt:sent.data.receipt}));assert.equal((await f.relay.connection()).channelVerified,false);
 assert.equal((await f.call('chat',{id:record.id})).status,200);assert.equal((await f.relay.connection()).channelVerified,false);
 assert.equal((await f.call('reply',{id:record.id,text:'Actual isolated protocol-client response.'})).status,200);status=await f.relay.connection();assert.equal(status.channelVerified,true);assert.equal(status.automaticMessages,true);assert.equal(status.automaticReviews,true);
 const later=f.capture(),next=await f.notify(later);assert.equal(next.status,200);assert.equal((await f.call('add',{elements:[{text:'Separately authorized native-chat work'}]})).status,200,'a pending Discuss capture does not sandbox independent native-chat authorization after bootstrap');
 const another=f.capture();assert.equal((await f.notify(another)).data.code,'CHAT_REPLY_PENDING');
 const review=f.capture({kind:'review'});assert.equal((await f.notify(review)).status,200);assert.equal((await f.call('review',{id:review.id})).status,200);assert.equal((await f.call('complete_review',{id:review.id,summary:'Inspected the captured synthetic board.'})).status,200);
});

test('claimed notifications are never replayed on duplicate notify or relay restart, and wrong-instance captures remain pinned',async()=>{
 const f=await fixture(),record=f.capture({channelTest:true});const sent=await f.notify(record,{test:true});assert.equal(sent.status,200);
 const restored=new BoardRelay(f.ctx,{});await restored.ready;f.relay=restored;
 const before=f.channel.messages.filter(item=>item.type==='channel_request').length,duplicate=await f.notify(record,{test:true});assert.equal(duplicate.status,200);assert.equal(duplicate.data.delivery,'uncertain');assert.equal(f.channel.messages.filter(item=>item.type==='channel_request').length,before);
 await restored.webSocketMessage(f.channel,JSON.stringify({type:'channel_written',id:record.id,kind:'chat',receipt:sent.data.receipt}));assert.equal((await f.notify(record,{test:true})).data.delivery,'queued');assert.equal(f.channel.messages.filter(item=>item.type==='channel_request').length,before);
 const wrong=f.capture({channelTest:true,channelSessionId:crypto.randomUUID()});assert.equal((await f.notify(wrong,{test:true})).data.code,'CHANNEL_SESSION_MISMATCH');
});

test('read-only grants, presence expiry, and revocation remain authoritative after native proof',async()=>{
 const f=await fixture({permission:'read'});await f.verify();assert.equal((await f.call('edit',{edits:[]})).data.code,'READ_ONLY');
 const saved=f.channel.deserializeAttachment();saved.presenceExpiresAt=Date.now()-1;f.channel.serializeAttachment(saved);assert.equal((await f.relay.connection()).automaticMessages,false);assert.equal((await f.call('read')).data.code,'CHANNEL_OFFLINE');
 await f.relay.alarm();assert.equal(f.channel.closed.code,1000);const reconnected=await f.openChannel();assert.equal((await f.relay.connection()).channelVerified,true,'same-process network reconnect retains proof without replay');
 const old=f.channel;f.channel=reconnected;await f.relay.webSocketClose(old);assert.equal((await f.relay.connection()).channelConnected,true,'late close cannot remove replacement transport');
 assert.equal((await f.call('disconnect')).status,200);assert.equal(reconnected.closed.code,4003);assert.equal((await f.call('read')).data.code,'RELAY_DISCONNECTED');assert.equal((await f.relay.connection()).channelConnected,false);
});

test('an unclaimed or malformed written receipt cannot create proof and expired channel grants stop authenticating',async()=>{
 const f=await fixture();await f.relay.webSocketMessage(f.channel,JSON.stringify({type:'channel_written',id:crypto.randomUUID(),kind:'chat',receipt:'ch_chat_unknown'}));assert.equal(f.channel.closed.code,4003);assert.equal((await f.storage.get('local-channel.v1')).claims.length,0);assert.equal((await f.relay.connection()).channelVerified,false);
 const state=await f.storage.get('local-channel.v1'),expired=new ChannelState(f.storage,{now:()=>state.expiresAt});await assert.rejects(expired.authorize(f.paired.channelToken,f.instanceId,f.relay.meta),error=>error.code==='CHANNEL_UNAUTHORIZED');
});

test('channel durable metadata retains no message, reply, drawing, raw credential, or provider-session contents',async()=>{
 const f=await fixture();await f.verify();const serialized=JSON.stringify([...f.storage.map]);
 for(const value of [f.paired.channelToken,f.created.browserToken,'actual test answer','Actual isolated','elements','snapshot'])assert.equal(serialized.includes(value),false);
 const state=await f.storage.get('local-channel.v1');assert.equal(state.claims.length,1);assert.ok(state.claims[0].readAt&&state.claims[0].completedAt);assert.equal(state.claims[0].receipt.startsWith('ch_chat_'),true);
});

test('explicit Codex channels share scoped proof gating without converting ordinary Codex or mixing provider modes',async()=>{
 const normal=await fixture({provider:'codex',pair:false});assert.equal(normal.created.setup.kind,undefined);assert.equal(normal.created.connection.deliveryMode,'manual');
 await assert.rejects(normal.relay.pairChannel({connectionCode:normal.created.sessionId+'.'+normal.created.pairing.code,instanceId:normal.instanceId}),error=>error.code==='CHANNEL_UNAUTHORIZED');
 for(const [provider,mode] of [['codex','claude-channel'],['claude-code','codex-channel'],['chatgpt','codex-channel'],['other','claude-channel']])await assert.rejects(fixture({provider,mode,pair:false}),/supported connection mode/);
 const unconsumed=await fixture({provider:'codex',mode:'codex-channel',pair:false});
 const mismatch=await unconsumed.request('/channel/pair',{connectionCode:unconsumed.created.pairing.code,instanceId:unconsumed.instanceId,expectedDeliveryMode:'claude-channel'});assert.equal(mismatch.status,409);assert.equal(mismatch.data.code,'CHANNEL_PROVIDER_MISMATCH');assert.equal((await unconsumed.storage.get('session')).activatedAt,undefined);assert.equal(await unconsumed.storage.get('local-channel.v1'),undefined);
 const matching=await unconsumed.request('/channel/pair',{connectionCode:unconsumed.created.pairing.code,instanceId:unconsumed.instanceId,expectedDeliveryMode:'codex-channel'});assert.equal(matching.status,200);assert.equal(matching.data.connection.deliveryMode,'codex-channel');
 const codex=await fixture({provider:'codex',mode:'codex-channel'});assert.equal(codex.created.setup.kind,'codex-channel');assert.equal(codex.paired.connection.provider,'codex');assert.equal(codex.paired.connection.deliveryMode,'codex-channel');assert.equal(codex.paired.connection.automaticMessages,false);assert.equal((await codex.storage.get('local-channel.v1')).actor,'local-channel');
 await codex.verify();assert.equal((await codex.relay.connection()).channelVerified,true);assert.equal((await codex.relay.connection()).automaticMessages,true);assert.equal((await codex.relay.connection()).deliveryMode,'codex-channel');
});

test('revocation between a durable claim and transport send leaves an uncertain record without emitting it',async()=>{
 const f=await fixture(),record=f.capture({channelTest:true}),original=f.relay.channel.state.bind(f.relay.channel);let reads=0;
 f.relay.channel.state=async meta=>{const state=await original(meta);if(++reads===2){await f.relay.revoke();return null;}return state;};
 const response=await f.notify(record,{test:true});assert.equal(response.status,200);assert.equal(response.data.delivery,'uncertain');assert.equal(f.channel.messages.some(item=>item.type==='channel_request'),false);assert.equal((await f.storage.get('local-channel.v1')).claims[0].id,record.id);
});

test('Worker channel routes require a plugin actor and forward bearer credentials only to the scoped board',async()=>{
 const calls=[],sessionId=crypto.randomUUID(),token=sessionId+'.'+'a'.repeat(64),env={RELAY_AUTH:{idFromName:x=>x,get:()=>({fetch:async request=>{calls.push({path:new URL(request.url).pathname,body:await request.json()});return Response.json({ok:true});}})},BOARD_RELAY:{idFromName:x=>x,get:id=>({fetch:async request=>{calls.push({id,path:new URL(request.url).pathname,body:request.body?await request.json():null});return Response.json({ok:true});}})}};
 const send=(path,body,headers={})=>handleRequest(new Request('https://connect.sharedboard.app'+path,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)}),env);
 assert.equal((await send('/channel/call',{instanceId:crypto.randomUUID(),operation:'connection'})).status,401);
 assert.equal((await send('/channel/call',{}, {origin:'https://sharedboard.app',authorization:'Bearer '+token})).status,403);
 const instanceId=crypto.randomUUID(),response=await send('/channel/call',{instanceId,operation:'read',input:{},channelToken:'body-cannot-replace-bearer'}, {authorization:'Bearer '+token});assert.equal(response.status,200);
 const forwarded=calls.find(item=>item.path==='/channel/call');assert.equal(forwarded.id,sessionId);assert.equal(forwarded.body.channelToken,token);assert.equal(forwarded.body.instanceId,instanceId);
 assert.equal((await handleRequest(new Request('https://connect.sharedboard.app/channel/socket?session='+sessionId+'&token=private'),env)).status,400);
});

test('actual workerd channel WebSocket and SQLite claims preserve the browser authority through a complete protocol round trip',{timeout:20000},async()=>{
 const root=fileURLToPath(new URL('../',import.meta.url)),requireWrangler=createRequire(realpathSync(new URL('../node_modules/wrangler/package.json',import.meta.url))),{Miniflare,convertV4MiniflareOptions}=requireWrangler('miniflare'),{build}=requireWrangler('esbuild');
 const bundle=await build({entryPoints:[root+'cloudflare/worker.mjs'],bundle:true,format:'esm',platform:'neutral',target:'es2022',conditions:['workerd','worker','browser'],external:['node:*'],write:false,logLevel:'silent'}),origin='https://connect.sharedboard.app',appOrigin='https://sharedboard.app';
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-27',compatibilityFlags:['nodejs_compat'],bindings:{RELAY_ORIGIN:origin,APP_ORIGIN:appOrigin,EVENT_CALLBACK_ORIGINS:''},durableObjects:{BOARD_RELAY:{className:'BoardRelay',useSQLite:true},RELAY_AUTH:{className:'RelayAuth',useSQLite:true}},durableObjectsPersist:false}));
 const sockets=[],frames=[],records=new Map(),instanceId=crypto.randomUUID();let created,paired;
 const http=async(path,input,{browser=false,token}={})=>{const response=await mf.dispatchFetch(origin+path,{method:'POST',headers:{'content-type':'application/json',...(browser?{origin:appOrigin,'x-sharedboard-browser':created?.browserToken??''}:{}),...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(input)});return {status:response.status,data:await response.json()};};
 const wait=async predicate=>{const deadline=Date.now()+5000;while(!predicate()){if(Date.now()>=deadline)throw new Error('Isolated channel protocol timed out.');await new Promise(resolve=>setTimeout(resolve,10));}};
 try{
  await mf.ready;const prepared=await http('/browser/pair',{provider:'claude-code',boardId:crypto.randomUUID(),permission:'read',title:'Isolated workerd channel'},{browser:true});assert.equal(prepared.status,200,JSON.stringify(prepared.data));created=prepared.data;
  const opened=await mf.dispatchFetch(created.socketURL.replace(/^ws/,'http'),{headers:{origin:appOrigin,upgrade:'websocket'}});assert.equal(opened.status,101);const browser=opened.webSocket;browser.accept();sockets.push(browser);
  browser.addEventListener('message',async event=>{const frame=JSON.parse(event.data);frames.push({actor:'browser',...frame});if(frame.type!=='command')return;const {id,operation,input}=frame.command;let result;
   if(operation==='chats')result={messages:[...records.values()]};else if(operation==='chat'){const record=records.get(input.id);record.status='reading';result={message:{...record},board:{revision:1}};}else if(operation==='reply'){const record=records.get(input.id);Object.assign(record,{status:'answered',reply:input.text});result={...record};}else result={revision:1,ok:true};
   browser.send(JSON.stringify({type:'result',id,connectionId:created.sessionId,result}));});
  browser.send(JSON.stringify({type:'authenticate',browserToken:created.browserToken,clientId:'workerd-channel-browser'}));await wait(()=>frames.some(frame=>frame.actor==='browser'&&frame.type==='connection'));
  const pairing=await http('/channel/pair',{connectionCode:created.pairing.code,instanceId});assert.equal(pairing.status,200,JSON.stringify(pairing.data));paired=pairing.data;
  const connected=await mf.dispatchFetch(paired.socketURL.replace(/^ws/,'http'),{headers:{upgrade:'websocket'}});assert.equal(connected.status,101);const channel=connected.webSocket;channel.accept();sockets.push(channel);channel.addEventListener('message',event=>frames.push({actor:'channel',...JSON.parse(event.data)}));channel.send(JSON.stringify({type:'authenticate',channelToken:paired.channelToken,instanceId}));await wait(()=>frames.some(frame=>frame.actor==='channel'&&frame.type==='connection'&&frame.connection.channelConnected));
  const id=crypto.randomUUID();records.set(id,{id,connectionId:created.sessionId,channelSessionId:instanceId,channelTest:true,intent:'discuss',status:'waiting'});
  const notify=await http('/browser/notify',{kind:'chat',id,test:true},{browser:true});assert.equal(notify.status,200,JSON.stringify(notify.data));await wait(()=>frames.some(frame=>frame.type==='channel_request'&&frame.id===id));
  const call=(operation,input={})=>http('/channel/call',{instanceId,operation,input},{token:paired.channelToken});
  channel.send(JSON.stringify({type:'channel_written',id,kind:'chat',receipt:notify.data.receipt}));assert.equal((await call('connection')).data.channelVerified,false);
  assert.equal((await call('chat',{id})).status,200);assert.equal((await call('reply',{id,text:'Actual isolated workerd protocol-client response.'})).status,200);
  const status=await call('connection');assert.equal(status.data.channelVerified,true);assert.equal(status.data.automaticMessages,true);assert.equal(status.data.permission,'read');assert.equal((await call('add',{elements:[]})).status,403);
  const duplicate=await http('/browser/notify',{kind:'chat',id,test:true},{browser:true});assert.equal(duplicate.status,200);assert.equal(frames.filter(frame=>frame.type==='channel_request'&&frame.id===id).length,1);
  assert.equal((await call('disconnect')).status,200);assert.equal((await call('read')).status,401);
 }finally{for(const socket of sockets)try{socket.close(1000);}catch{}await mf.dispose();}
});
