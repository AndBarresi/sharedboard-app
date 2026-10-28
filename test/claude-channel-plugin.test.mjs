import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk-v1/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk-v1/client/stdio.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk-v1/inMemory.js';
import {SUPPORTED_PROTOCOL_VERSIONS} from '@modelcontextprotocol/sdk-v1/types.js';
import {createChannelClient,RELAY_ORIGIN} from '../plugins/claude-code/src/channel-client.mjs';
import {createClaimStore} from '../plugins/claude-code/src/state.mjs';
import {createPluginServer,CHANNEL_INSTRUCTIONS} from '../plugins/claude-code/src/tools.mjs';
import {discoverBoardTools} from '../plugins/claude-code/scripts/generate-tools.mjs';
import {buildPlugin} from '../plugins/claude-code/scripts/build.mjs';
import definitions from '../plugins/claude-code/src/board-tools.json' with {type:'json'};

const boardId='11111111-1111-4111-8111-111111111111',sessionId='22222222-2222-4222-8222-222222222222',instanceId='33333333-3333-4333-8333-333333333333',id='44444444-4444-4444-8444-444444444444',nextId='55555555-5555-4555-8555-555555555555';
const connectionCode=`${sessionId}.${'a'.repeat(64)}`,channelToken=`${sessionId}.${'b'.repeat(64)}`;
const waitFor=async predicate=>{const deadline=Date.now()+3000;while(!await predicate()){if(Date.now()>deadline)assert.fail('Expected asynchronous fixture state was not reached.');await new Promise(resolve=>setTimeout(resolve,5));}};
const settle=async()=>{for(let n=0;n<5;n++)await new Promise(resolve=>setImmediate(resolve));};
class Clock{
  now=0;serial=0;pending=new Map();
  setTimeout(fn,delay){const id=++this.serial;this.pending.set(id,{fn,at:this.now+delay});return id;}
  clearTimeout(id){this.pending.delete(id);}
  async advance(duration){const end=this.now+duration;while(true){const next=[...this.pending].sort((a,b)=>a[1].at-b[1].at).find(([,item])=>item.at<=end);if(!next)break;this.now=next[1].at;this.pending.delete(next[0]);next[1].fn();await settle();}this.now=end;await settle();}
}
async function fixture(t,overrides={}){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),"SharedBoard channel ' spaces-"));
  const sockets=[],http=[],notifications=[],diagnostics=[],clock=new Clock();
  class Socket extends EventTarget{
    readyState=0;sent=[];
    constructor(url){super();this.url=url;sockets.push(this);}
    send(text){if(this.readyState!==1)throw new Error('closed');this.sent.push(JSON.parse(text));}
    open(){this.readyState=1;this.dispatchEvent(new Event('open'));}
    message(data){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(data)}));}
    close(code=1000){if(this.readyState===3)return;this.readyState=3;const event=new Event('close');Object.assign(event,{code});this.dispatchEvent(event);}
  }
  const expectedDeliveryMode=overrides.expectedDeliveryMode??'claude-channel',connection={connected:true,id:sessionId,boardId,provider:expectedDeliveryMode==='codex-channel'?'codex':'claude-code',permission:'read',channelConnected:false,channelVerified:false,browserOnline:true,deliveryMode:expectedDeliveryMode};
  const fetcher=async(url,init)=>{
    const input=JSON.parse(init.body);http.push({url,init,input});
    if(url.endsWith('/channel/pair'))return Response.json({channelToken,sessionId,boardId,permission:'read',expiresAt:new Date(Date.now()+3600000).toISOString(),connection:overrides.pairConnection??connection,socketURL:`wss://connect.sharedboard.app/channel/socket?session=${sessionId}`});
    if(input.operation==='connection')return Response.json({...connection,channelToken});
    if(input.operation==='disconnect')return Response.json({ok:true});
    if(input.operation==='read'||input.operation==='read_full')return Response.json({board:{revision:3,elements:[]}});
    return Response.json({ok:true});
  };
  const claims=createClaimStore(directory),client=createChannelClient({store:overrides.store?overrides.store(claims):claims,notify:async notification=>{notifications.push(notification);if(overrides.notify)await overrides.notify(notification);},fetch:overrides.fetch??fetcher,WebSocket:Socket,timers:clock,instanceId,expectedDeliveryMode,onDiagnostic:code=>diagnostics.push(code)});
  t.after(async()=>{await client.close();await fs.rm(directory,{recursive:true,force:true});});
  const request=(change={})=>({type:'channel_request',id,kind:'chat',intent:'discuss',boardId,connectionId:sessionId,instanceId,receipt:`ch_chat_${id}`,...change});
  const pair=async()=>{const result=await client.connect({connectionCode});sockets.at(-1).open();sockets.at(-1).message({type:'connection',connection});await settle();return result;};
  return {client,claims,clock,directory,http,sockets,notifications,diagnostics,connection,pair,request};
}

test('the Claude plugin uses compatible MCP v1 and generated board schemas without a wait or diagnostic panel',async()=>{
  assert.equal(SUPPORTED_PROTOCOL_VERSIONS.includes('2026-07-28'),false);
  assert.deepEqual(definitions,await discoverBoardTools());
  const calls=[],fake={async connect(args){calls.push(['connect',args]);return {connection:{connected:true,boardId}};},async status(){return {connection:{connected:false}};},async call(operation,args){calls.push([operation,args]);return operation==='visual'?{visual:{revision:3,dataURL:'data:image/png;base64,AA=='}}:{board:{revision:3,elements:[]}};},async disconnect(){calls.push(['disconnect']);return {disconnected:true};},close(){}};
  const plugin=createPluginServer({client:fake}),client=new Client({name:'claude-plugin-test',version:'1'}),[left,right]=InMemoryTransport.createLinkedPair();
  try{
    await plugin.server.connect(right);await client.connect(left);
    assert.deepEqual(client.getServerCapabilities().experimental,{'claude/channel':{}});
    const tools=(await client.listTools()).tools,names=tools.map(tool=>tool.name);
    assert.ok(names.includes('connect_board')&&names.includes('reply_to_chat_message')&&names.includes('disconnect_board'));
    assert.equal(names.filter(name=>name==='disconnect_board').length,1);assert.equal(definitions.some(tool=>tool.name==='connect_board'||tool.name==='disconnect_board'),false);assert.deepEqual(tools.find(tool=>tool.name==='disconnect_board').inputSchema,{type:'object',properties:{},additionalProperties:false});
    assert.ok(!names.includes('wait_for_board_request')&&!names.includes('open_sharedboard_chat')&&!names.includes('propose_changes'));
    assert.match(tools.find(tool=>tool.name==='connect_board').inputSchema.properties.connectionCode.pattern,/36/);
    await client.callTool({name:'connect_board',arguments:{connectionCode}});await client.callTool({name:'read_board',arguments:{full:true}});await client.callTool({name:'add_elements',arguments:{elements:[]}});
    const image=await client.callTool({name:'view_board',arguments:{}});assert.equal(image.content[1].type,'image');assert.equal(image.structuredContent.visual.attachedAsImage,true);assert.equal(image.structuredContent.visual.dataURL,undefined);
    assert.deepEqual(calls.slice(0,3),[['connect',{connectionCode}],['read_full',{}],['add',{elements:[],summary:'Agent added objects'}]]);
    assert.equal((await client.callTool({name:'read_board',arguments:{full:'yes'}})).isError,true);
    assert.match(CHANNEL_INSTRUCTIONS,/EACH delivered mini-chat ID/);assert.match(CHANNEL_INSTRUCTIONS,/does not relay or bypass permission prompts/);
  }finally{await client.close();await plugin.close();}
});

test('a native wrapper can replace server metadata and connect requirements without claiming Claude channel support',async()=>{
  const fake={async connect(args){return {sessionId:args.providerSessionId};},close(){}},definition={name:'connect_board',description:'Connect this actual Codex thread.',inputSchema:{type:'object',properties:{connectionCode:{type:'string'},providerSessionId:{type:'string',format:'uuid'}},required:['connectionCode','providerSessionId'],additionalProperties:false}};
  const plugin=createPluginServer({client:fake,serverName:'sharedboard-codex',version:'4.5.6',instructions:'Use this actual native thread only.',capabilities:{tools:{}},connectDefinition:definition}),client=new Client({name:'native-wrapper-test',version:'1'}),[left,right]=InMemoryTransport.createLinkedPair();
  try{await plugin.server.connect(right);await client.connect(left);assert.deepEqual(client.getServerVersion(),{name:'sharedboard-codex',version:'4.5.6'});assert.equal(client.getInstructions(),'Use this actual native thread only.');assert.equal(client.getServerCapabilities().experimental,undefined);assert.deepEqual((await client.listTools()).tools.find(tool=>tool.name==='connect_board'),definition);assert.equal((await client.callTool({name:'connect_board',arguments:{connectionCode,providerSessionId:sessionId}})).structuredContent.sessionId,sessionId);}
  finally{await client.close();await plugin.close();}
});

test('pairing is scoped and private; transport writes never establish model receipt or persist credentials',async t=>{
  const f=await fixture(t),result=await f.pair();assert.equal(result.restartRequiresPairing,true);assert.equal(JSON.stringify(result).includes(channelToken),false);
  assert.equal(f.http[0].url,`${RELAY_ORIGIN}/channel/pair`);assert.equal(f.http[0].input.instanceId,instanceId);assert.equal(f.http[0].input.expectedDeliveryMode,'claude-channel');assert.equal(f.http[0].init.redirect,'error');
  assert.deepEqual(f.sockets[0].sent[0],{type:'authenticate',channelToken,instanceId});
  f.sockets[0].message(f.request());await waitFor(()=>f.notifications.length===1);await settle();
  assert.equal(f.notifications[0].method,'notifications/claude/channel');assert.deepEqual(f.notifications[0].params.meta,{board_id:boardId,request_id:id,kind:'chat',intent:'discuss'});
  assert.match(f.notifications[0].params.content,/read_chat_message/);assert.equal(JSON.stringify(f.notifications[0]).includes(channelToken),false);
  assert.deepEqual(f.sockets[0].sent.at(-1),{type:'channel_written',id,kind:'chat',receipt:`ch_chat_${id}`});
  const saved=await fs.readFile(path.join(f.directory,`claims-${sessionId}.json`),'utf8');assert.equal(saved.includes(channelToken),false);assert.equal(saved.includes(connectionCode),false);assert.equal(saved.includes('drawing'),false);
  const status=await f.client.status();assert.equal(status.connection.channelVerified,false);assert.equal(JSON.stringify(status).includes(channelToken),false);
  assert.equal(f.http.at(-1).init.headers.Authorization,`Bearer ${channelToken}`);assert.equal(f.http.at(-1).input.instanceId,instanceId);
});

test('an immediate first board call waits for authenticated socket readiness without retrying its operation',async t=>{
  const f=await fixture(t),paired=await f.client.connect({connectionCode});assert.equal(paired.channelReady,false);assert.equal(paired.connectionPending,true);
  const read=f.client.call('read');await settle();assert.equal(f.http.length,1);
  f.sockets[0].open();f.sockets[0].message({type:'connection',connection:f.connection});assert.deepEqual(await read,{board:{revision:3,elements:[]}});assert.equal(f.http.filter(item=>item.input.operation==='read').length,1);assert.equal((await f.client.status()).channelReady,true);
});

test('readiness timeout retains the consumed pairing and permits one later call after recovery',async t=>{
  const f=await fixture(t);await f.client.connect({connectionCode});const failed=assert.rejects(f.client.call('read'),error=>error.code==='CHANNEL_CONNECTING'&&error.message.includes('pairing is retained'));await f.clock.advance(10000);await failed;
  assert.equal(f.http.length,1);assert.equal((await f.client.status()).connectionPending,true);await assert.rejects(f.client.connect({connectionCode}),error=>error.code==='CHANNEL_ALREADY_CONNECTED');
  await f.clock.advance(1000);const socket=f.sockets.at(-1);socket.open();socket.message({type:'connection',connection:f.connection});await settle();assert.deepEqual(await f.client.call('read'),{board:{revision:3,elements:[]}});assert.equal(f.http.filter(item=>item.url.endsWith('/channel/pair')).length,1);assert.equal(f.http.filter(item=>item.input.operation==='read').length,1);
});

test('disconnect rejects a pending readiness call without forwarding its board operation',async t=>{
  const f=await fixture(t);await f.client.connect({connectionCode});const pending=assert.rejects(f.client.call('read'),error=>error.code==='CHANNEL_NOT_CONNECTED');await settle();await f.client.disconnect();await pending;assert.equal(f.http.some(item=>item.input.operation==='read'),false);
});

test('each native package requests its exact mode and rejects a cross-provider pair response',async t=>{
  const codex=await fixture(t,{expectedDeliveryMode:'codex-channel'});await codex.pair();assert.equal(codex.http[0].input.expectedDeliveryMode,'codex-channel');
  const wrong=await fixture(t,{pairConnection:{id:sessionId,boardId,deliveryMode:'codex-channel',provider:'codex'}});await assert.rejects(wrong.client.connect({connectionCode}),error=>error.code==='CHANNEL_PROVIDER_MISMATCH');assert.equal(wrong.sockets.length,0);
});

test('atomic local claims deduplicate concurrent notices and survive a recreated receipt store',async t=>{
  const f=await fixture(t),store=createClaimStore(f.directory),scoped={sessionId,boardId},request=f.request();
  assert.deepEqual(await Promise.all([store.claim(scoped,request),store.claim(scoped,request)]),[true,false]);
  assert.equal(await createClaimStore(f.directory).claim(scoped,request),false);
  await f.pair();f.sockets[0].message(request);f.sockets[0].message(request);await settle();assert.equal(f.notifications.length,0);
});

test('close drains a delayed duplicate claim before storage removal and suppresses queued frames after credential release',async t=>{
  let release,started=false,attempts=0;const blocked=new Promise(resolve=>{release=resolve;}),f=await fixture(t,{store:claims=>({...claims,async claim(...args){attempts++;started=true;await blocked;return claims.claim(...args);}})});
  await f.pair();await f.claims.claim({sessionId,boardId},f.request());f.sockets[0].message(f.request());f.sockets[0].message(f.request());await waitFor(()=>started);
  const closing=f.client.close();assert.equal(f.client.close(),closing);let removed=false;const removing=closing.then(()=>fs.rm(f.directory,{recursive:true,force:true})).then(()=>{removed=true;});
  try{await settle();assert.equal(removed,false);assert.equal(f.sockets[0].readyState,3);assert.equal((await f.client.status()).connection.connected,false);}
  finally{release();await removing;}
  assert.equal(attempts,1);assert.equal(f.notifications.length,0);assert.equal(f.sockets[0].sent.some(frame=>frame.type==='channel_written'),false);f.sockets[0].message(f.request());await settle();assert.equal(attempts,1);await assert.rejects(fs.stat(f.directory),error=>error.code==='ENOENT');
});

test('foreign boards, processes, receipts, review intent, and malformed frames never notify the model',async t=>{
  const f=await fixture(t);await f.pair();
  for(const change of [{boardId:nextId},{connectionId:nextId},{instanceId:nextId},{receipt:'another-receipt'},{kind:'review',intent:'work',receipt:`ch_review_${id}`},{id:'not-an-id'}])f.sockets[0].message(f.request(change));
  f.sockets[0].message({type:'request',request:f.request()});await settle();assert.equal(f.notifications.length,0);assert.equal((await fs.readdir(f.directory)).length,0);
});

test('same-process network recovery keeps its nonce and never replays an old claimed notification',async t=>{
  const f=await fixture(t);await f.pair();const old=f.sockets[0];old.message(f.request());await waitFor(()=>f.notifications.length===1);old.close();await f.clock.advance(1000);
  assert.equal(f.sockets.length,2);const current=f.sockets[1];current.open();current.message({type:'connection',connection:f.connection});await settle();assert.deepEqual(current.sent[0],{type:'authenticate',channelToken,instanceId});
  old.message(f.request({id:nextId,receipt:`ch_chat_${nextId}`}));current.message(f.request());await settle();assert.equal(f.notifications.length,1);
  current.message(f.request({id:nextId,receipt:`ch_chat_${nextId}`}));await waitFor(()=>f.notifications.length===2);
});

test('opening and missing-pong deadlines recover, but replaced credentials stop reconnecting',async t=>{
  const f=await fixture(t);await f.client.connect({connectionCode});await f.clock.advance(10000);assert.equal(f.sockets[0].readyState,3);await f.clock.advance(1000);assert.equal(f.sockets.length,2);
  const socket=f.sockets[1];socket.open();socket.message({type:'connection',connection:f.connection});await settle();await f.clock.advance(15000);assert.deepEqual(socket.sent.at(-1),{type:'ping'});await f.clock.advance(10000);assert.equal(socket.readyState,3);await f.clock.advance(1000);assert.equal(f.sockets.length,3);
  const current=f.sockets[2];current.open();current.message({type:'connection',connection:f.connection});await settle();await f.clock.advance(15000);current.message({type:'pong'});await f.clock.advance(10000);assert.equal(current.readyState,1);
  current.close(4003);await f.clock.advance(60000);assert.equal(f.sockets.length,3);assert.equal((await f.client.status()).connection.connected,false);
});

test('an uncertain stdio write stops delivery and board tools without replay, while status and revocation remain available',async t=>{
  const f=await fixture(t,{notify:async()=>{throw new Error(`unsafe ${channelToken}`);}});await f.pair();f.sockets[0].message(f.request());await waitFor(()=>f.diagnostics.includes('CHANNEL_NOTIFICATION_UNCONFIRMED'));
  assert.equal(f.sockets[0].readyState,3);assert.ok(!f.sockets[0].sent.some(frame=>frame.type==='channel_written'));await f.clock.advance(60000);assert.equal(f.sockets.length,1);
  assert.equal(f.notifications.length,1);assert.equal((await f.client.status()).deliverySuspended,true);const calls=f.http.length;await assert.rejects(f.client.call('reply',{id,text:'The actual answer.'}),error=>error.code==='CHANNEL_NOTIFICATION_UNCONFIRMED');assert.equal(f.http.length,calls);
  assert.ok(f.diagnostics.every(code=>/^[A-Z_]+$/.test(code)));assert.equal(JSON.stringify(f.diagnostics).includes(channelToken),false);
  assert.deepEqual(await f.client.disconnect(),{disconnected:true});assert.equal(f.http.at(-1).input.operation,'disconnect');
});

test('close drains an in-flight notification up to its bounded deadline, and late completion never acknowledges after shutdown',async t=>{
  let release;const blocked=new Promise(resolve=>{release=resolve;}),f=await fixture(t,{notify:()=>blocked});await f.pair();f.sockets[0].message(f.request());await waitFor(()=>f.notifications.length===1);
  let drained=false;const closing=f.client.close().then(()=>{drained=true;});await f.clock.advance(9999);assert.equal(drained,false);await f.clock.advance(1);await closing;
  assert.ok(f.diagnostics.includes('CHANNEL_NOTIFICATION_UNCONFIRMED'));assert.equal(f.sockets[0].readyState,3);release();await settle();assert.ok(!f.sockets[0].sent.some(frame=>frame.type==='channel_written'));assert.equal(f.notifications.length,1);
});

test('damaged local receipts fail closed without overwriting them or forwarding a notification',async t=>{
  const f=await fixture(t);await f.pair();const file=path.join(f.directory,`claims-${sessionId}.json`);await fs.writeFile(file,'not valid JSON');f.sockets[0].message(f.request());await waitFor(()=>f.diagnostics.includes('CHANNEL_NOTIFICATION_UNCONFIRMED'));
  assert.equal(await fs.readFile(file,'utf8'),'not valid JSON');assert.equal(f.notifications.length,0);assert.equal(f.sockets[0].readyState,3);
});

test('new plugin processes do not load credentials or reuse an earlier process nonce',async t=>{
  const f=await fixture(t);await f.pair();f.sockets[0].message(f.request());await waitFor(()=>f.notifications.length===1);f.client.close();
  let calls=0;const next=createChannelClient({store:createClaimStore(f.directory),notify:()=>{},fetch:async()=>{calls++;throw new Error('No credential fallback');},WebSocket:class{},timers:f.clock});t.after(()=>next.close());
  assert.notEqual(next.instanceId,instanceId);assert.equal((await next.status()).connection.connected,false);await assert.rejects(next.call('read'),error=>error.code==='CHANNEL_NOT_CONNECTED');assert.equal(calls,0);
});

test('disconnect clears this process before its remote result and never sends a persistent token to tool output',async t=>{
  const f=await fixture(t);await f.pair();assert.deepEqual(await f.client.disconnect(),{disconnected:true});assert.equal(f.sockets[0].readyState,3);assert.equal((await f.client.status()).connection.connected,false);
  await f.clock.advance(60000);assert.equal(f.sockets.length,1);assert.equal(f.http.at(-1).input.operation,'disconnect');assert.equal(f.http.at(-1).input.instanceId,instanceId);
});

test('malformed pairing, alternate origins and raw upstream errors cannot leak credentials or create sockets',async t=>{
  const f=await fixture(t);for(const connectionCode of ['invalid',`${sessionId}.bad`,`${sessionId}.${'c'.repeat(64)}\n`])await assert.rejects(f.client.connect({connectionCode}),error=>error.code==='PAIRING_INVALID');
  assert.equal(f.http.length,0);assert.equal(f.sockets.length,0);assert.throws(()=>createChannelClient({origin:'http://127.0.0.1:9999'}),error=>error.code==='CHANNEL_ORIGIN_INVALID');
  const bad=await fixture(t,{fetch:async()=>Response.json({error:`unsafe ${channelToken} https://private.example/callback`,code:'READ_ONLY'},{status:403})});
  await assert.rejects(bad.client.connect({connectionCode}),error=>error.code==='READ_ONLY'&&!error.message.includes(channelToken)&&!error.message.includes('private.example'));
});

test('pre-proof drawing rejection explains the real website reply test without exposing the upstream private error',async t=>{
  const calls=[],f=await fixture(t,{fetch:async(url,init)=>{
    const input=JSON.parse(init.body);calls.push(input);
    if(url.endsWith('/channel/pair'))return Response.json({channelToken,sessionId,boardId,permission:'edit',expiresAt:new Date(Date.now()+3600000).toISOString(),connection:{...f.connection,permission:'edit'},socketURL:`wss://connect.sharedboard.app/channel/socket?session=${sessionId}`});
    return Response.json({code:'CHANNEL_TEST_READ_ONLY',error:`private ${channelToken} https://private.example/callback`},{status:403});
  }});f.connection.permission='edit';await f.pair();
  const plugin=createPluginServer({client:f.client}),client=new Client({name:'pre-proof-error-test',version:'1'}),[left,right]=InMemoryTransport.createLinkedPair();
  try{
    await plugin.server.connect(right);await client.connect(left);const result=await client.callTool({name:'add_elements',arguments:{elements:[],summary:'Requested drawing change'}});
    assert.equal(result.isError,true);assert.match(result.content[0].text,/CHANNEL_TEST_READ_ONLY: Complete Test automatic reply on SharedBoard.app first/);assert.match(result.content[0].text,/captured Discuss message and post your actual board reply/);assert.match(result.content[0].text,/Drawing changes stay blocked/);assert.match(result.content[0].text,/Keep the current permission; do not bypass this test/);assert.doesNotMatch(result.content[0].text,/request could not be confirmed|private|https:\/\/private/);assert.equal(JSON.stringify(result).includes(channelToken),false);assert.equal(calls.filter(call=>call.operation==='add').length,1);
  }finally{await client.close();await plugin.close();}
});

test('concurrent pairing and a late response after process close cannot silently connect another session',async t=>{
  let release;const blocked=new Promise(resolve=>{release=resolve;}),f=await fixture(t,{fetch:async()=>{await blocked;return Response.json({});}});
  const pending=f.client.connect({connectionCode});await settle();await assert.rejects(f.client.connect({connectionCode}),error=>error.code==='CHANNEL_ALREADY_CONNECTED');f.client.close();release();await assert.rejects(pending,error=>error.code==='CHANNEL_CLOSED');assert.equal(f.sockets.length,0);
});

test('the actual Node stdio process advertises a channel and tools without making a network connection',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'sharedboard-stdio-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../plugins/claude-code/src/main.mjs',import.meta.url))],env:{CLAUDE_PLUGIN_DATA:directory},stderr:'pipe'}),client=new Client({name:'real-stdio-smoke',version:'1'});let errors='';transport.stderr?.on('data',value=>{errors+=value;});
  try{await client.connect(transport);assert.deepEqual(client.getServerCapabilities().experimental,{'claude/channel':{}});const tools=await client.listTools();assert.ok(tools.tools.find(tool=>tool.name==='read_board'));const status=await client.callTool({name:'connection_status',arguments:{}});assert.equal(status.structuredContent.connection.connected,false);assert.equal(status.structuredContent.restartRequiresPairing,true);assert.equal(errors,'');}
  finally{await client.close();}
});

test('the distributed JavaScript bundles its SDK and starts over actual stdio without node_modules',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'sharedboard-plugin-bundle-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const target=path.join(directory,'plugin');await buildPlugin(target);
  const manifest=JSON.parse(await fs.readFile(path.join(target,'.claude-plugin','plugin.json'),'utf8'));assert.equal(manifest.channels[0].server,'sharedboard');assert.equal(manifest.mcpServers.sharedboard.command,'node');assert.equal(manifest.mcpServers.sharedboard.args[0],'${CLAUDE_PLUGIN_ROOT}/src/main.mjs');
  assert.equal(JSON.parse(await fs.readFile(path.join(target,'package.json'),'utf8')).dependencies,undefined);
  const source=await fs.readFile(path.join(target,'src','main.mjs'),'utf8');assert.equal(source.includes("from '@modelcontextprotocol/sdk-v1"),false);assert.ok(source.includes('notifications/claude/channel'));
  const transport=new StdioClientTransport({command:process.execPath,args:[path.join(target,'src','main.mjs')],env:{CLAUDE_PLUGIN_DATA:path.join(directory,'private-data')},stderr:'pipe'}),client=new Client({name:'bundle-stdio-smoke',version:'1'});let errors='';transport.stderr?.on('data',value=>{errors+=value;});
  try{await client.connect(transport);assert.equal((await client.callTool({name:'connection_status',arguments:{}})).structuredContent.connection.connected,false);assert.equal(errors,'');}finally{await client.close();}
});
