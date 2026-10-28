import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk-v1/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk-v1/client/stdio.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk-v1/inMemory.js';
import {createCodexQueue,queuedRequestText} from '../plugins/codex/src/queue.mjs';
import {createCodexPlugin} from '../plugins/codex/src/server.mjs';
import {buildPlugin} from '../plugins/codex/scripts/build.mjs';
import metadata from '../plugins/codex/package.json' with {type:'json'};

const boardId='11111111-1111-4111-8111-111111111111',sessionId='22222222-2222-4222-8222-222222222222',threadId='33333333-3333-4333-8333-333333333333',requestId='44444444-4444-4444-8444-444444444444',receiptId='55555555-5555-4555-8555-555555555555';
const connectionCode=`${sessionId}.${'a'.repeat(64)}`,channelToken=`${sessionId}.${'b'.repeat(64)}`,privateText='PRIVATE drawing text and message body $(do-not-run)';
const notification=(meta={})=>({method:'notifications/claude/channel',params:{content:privateText,meta:{board_id:boardId,request_id:requestId,kind:'chat',intent:'discuss',...meta},privateCredential:channelToken}});
const settle=async()=>{for(let n=0;n<5;n++)await new Promise(resolve=>setImmediate(resolve));};
const waitFor=async predicate=>{const deadline=Date.now()+3000;while(!await predicate()){if(Date.now()>deadline)assert.fail('Expected isolated channel state was not reached.');await new Promise(resolve=>setTimeout(resolve,5));}};
const queueReceipt=(thread=threadId,id=receiptId)=>`Queued message ${id} for thread ${thread}.\n`;

test('Codex queue uses an exact existing UUID, routing-only text, literal argv, and unchanged model/permission settings',async()=>{
  const calls=[],executable="C:\\Program Files\\Codex ' test\\codex.exe",queue=createCodexQueue({executable,execute:async(...args)=>{calls.push(args);return {stdout:queueReceipt(),stderr:'ignored diagnostics'};}});
  assert.deepEqual(await queue(threadId,notification()),{queueMessageId:receiptId});assert.equal(calls.length,1);
  const [binary,args,options]=calls[0];assert.equal(binary,executable);assert.deepEqual(args.slice(0,4),['queue','--thread',threadId,'--message']);assert.equal(args.length,5);assert.match(args[4],new RegExp(boardId));assert.match(args[4],new RegExp(requestId));assert.match(args[4],/read_chat_message/);assert.match(args[4],/reply_to_chat_message/);assert.match(args[4],/finish it before handling/);
  assert.equal(args[4].includes(privateText),false);assert.equal(args[4].includes(channelToken),false);assert.equal(args[4].includes(connectionCode),false);
  assert.deepEqual(options,{shell:false,windowsHide:true,timeout:30000,maxBuffer:65536,encoding:'utf8'});assert.ok(!args.some(arg=>/^--(model|profile|config|cd|full-auto|dangerously|yolo)/.test(arg)));
});

test('routing validation rejects invalid IDs or review work before invoking the native command',async()=>{
  let attempts=0;const queue=createCodexQueue({execute:async()=>{attempts++;return {stdout:queueReceipt()};}});
  await assert.rejects(queue('not-a-thread',notification()),error=>error.code==='CODEX_THREAD_REQUIRED');
  for(const meta of [{board_id:'bad'},{request_id:'bad'},{kind:'other'},{intent:'other'},{kind:'review',intent:'work'}])await assert.rejects(queue(threadId,notification(meta)),error=>error.code==='CHANNEL_SCOPE_MISMATCH');
  assert.equal(attempts,0);const review=queuedRequestText(notification({kind:'review'}));assert.match(review,/read_review_request/);assert.match(review,/complete_review_request/);assert.doesNotMatch(review,/reply_to_chat_message/);
});

test('queue failures and mismatched receipts are uncertain, sanitized, and never retried',async()=>{
  for(const output of ['',queueReceipt(boardId),queueReceipt(threadId,'invalid'),`unexpected prefix ${queueReceipt()}`,`${queueReceipt()}unexpected suffix`,channelToken]){
    let attempts=0;const queue=createCodexQueue({execute:async()=>{attempts++;return {stdout:output};}});await assert.rejects(queue(threadId,notification()),error=>error.code==='CODEX_QUEUE_UNCONFIRMED'&&!error.message.includes(channelToken));assert.equal(attempts,1);
  }
  let attempts=0;const queue=createCodexQueue({execute:async()=>{attempts++;throw new Error(`${privateText} ${channelToken}`);}});await assert.rejects(queue(threadId,notification()),error=>error.code==='CODEX_QUEUE_UNCONFIRMED'&&!error.message.includes(privateText)&&!error.message.includes(channelToken));assert.equal(attempts,1);
});

test('the SDK1 Codex server requires the actual bound thread and advertises no Claude channel capability',async()=>{
  const calls=[],fake={async connect(input){calls.push(['connect',input]);return {connection:{connected:true,boardId}};},async disconnect(){calls.push(['disconnect']);return {disconnected:true};},async status(){return {connection:{connected:false}};},async call(operation,input){calls.push([operation,input]);return {board:{revision:4,elements:[]}};},close(){}};
  const plugin=createCodexPlugin({nativeThreadId:threadId,client:fake,queue:async()=>{throw new Error('No queue request was authorized in discovery.');}}),client=new Client({name:'codex-plugin-test',version:'1'}),[left,right]=InMemoryTransport.createLinkedPair();
  try{
    await plugin.server.connect(right);await client.connect(left);assert.deepEqual(client.getServerVersion(),{name:'sharedboard-codex',version:metadata.version});assert.equal(client.getServerCapabilities().experimental,undefined);assert.match(client.getInstructions(),/actual CODEX_THREAD_ID/);assert.doesNotMatch(client.getInstructions(),/Claude/);
    const tools=(await client.listTools()).tools,connect=tools.find(tool=>tool.name==='connect_board');assert.deepEqual(connect.inputSchema.required,['connectionCode','providerSessionId']);assert.equal(tools.filter(tool=>tool.name==='disconnect_board').length,1);assert.ok(!tools.some(tool=>['wait_for_board_request','open_sharedboard_chat'].includes(tool.name)));
    for(const providerSessionId of [undefined,'guessed',boardId]){const result=await client.callTool({name:'connect_board',arguments:{connectionCode,...(providerSessionId?{providerSessionId}:{})}});assert.equal(result.isError,true);assert.match(result.content[0].text,/CODEX_THREAD_REQUIRED/);}
    assert.equal(calls.length,0);await client.callTool({name:'connect_board',arguments:{connectionCode,providerSessionId:threadId}});await client.callTool({name:'read_board',arguments:{full:true}});assert.deepEqual(calls,[['connect',{connectionCode,providerSessionId:threadId}],['read_full',{}]]);
    assert.equal((await client.callTool({name:'connect_board',arguments:{connectionCode,providerSessionId:threadId}})).isError,true);await client.callTool({name:'disconnect_board',arguments:{}});await client.callTool({name:'connect_board',arguments:{connectionCode,providerSessionId:threadId}});assert.equal(calls.filter(call=>call[0]==='connect').length,2);
  }finally{await client.close();await plugin.close();}
});

test('a failed pair does not retain a thread binding or invoke the queue',async()=>{
  let calls=0,queues=0;const fake={async connect(){calls++;throw Object.assign(new Error('private error'),{code:'PAIRING_INVALID'});},async disconnect(){return {};},close(){}};
  const plugin=createCodexPlugin({nativeThreadId:threadId,client:fake,queue:async()=>{queues++;}});
  try{await assert.rejects(plugin.client.connect({connectionCode,providerSessionId:threadId}));await assert.rejects(plugin.client.connect({connectionCode,providerSessionId:threadId}));assert.equal(calls,2);assert.equal(queues,0);}
  finally{await plugin.close();}
});

async function channelFixture(t,{failQueue=false}={}){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),"sharedboard-codex ' spaces-"));const sockets=[],executions=[],calls=[],diagnostics=[];
  class Socket extends EventTarget{readyState=0;sent=[];constructor(url){super();this.url=url;sockets.push(this);}send(value){if(this.readyState!==1)throw new Error('closed');this.sent.push(JSON.parse(value));}open(){this.readyState=1;this.dispatchEvent(new Event('open'));}message(value){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(value)}));}close(){if(this.readyState===3)return;this.readyState=3;const event=new Event('close');Object.assign(event,{code:1000});this.dispatchEvent(event);}}
  const connection={connected:true,id:sessionId,boardId,provider:'codex',deliveryMode:'codex-channel',permission:'read',channelConnected:true,channelVerified:false,browserOnline:true};
  const fetch=async(url,init)=>{const input=JSON.parse(init.body);calls.push({url,input,init});if(url.endsWith('/channel/pair'))return Response.json({sessionId,boardId,channelToken,permission:'read',expiresAt:new Date(Date.now()+3600000).toISOString(),connection,socketURL:`wss://connect.sharedboard.app/channel/socket?session=${sessionId}`});return Response.json(input.operation==='connection'?connection:{ok:true});};
  const plugin=createCodexPlugin({dataDirectory:directory,nativeThreadId:threadId,onDiagnostic:code=>diagnostics.push(code),queue:createCodexQueue({execute:async(...args)=>{executions.push(args);if(failQueue)throw new Error(`uncertain ${channelToken}`);return {stdout:queueReceipt()};}}),clientOptions:{fetch,WebSocket:Socket}});t.after(async()=>{await plugin.close();await fs.rm(directory,{recursive:true,force:true});});
  await plugin.client.connect({connectionCode,providerSessionId:threadId});sockets[0].open();sockets[0].message({type:'connection',connection});await settle();
  const request={type:'channel_request',id:requestId,kind:'chat',intent:'discuss',boardId,connectionId:sessionId,instanceId:plugin.client.instanceId,receipt:`ch_chat_${requestId}`};
  return {plugin,directory,sockets,executions,calls,diagnostics,connection,request};
}

test('real channel handling queues only to the bound Codex thread and a receipt does not establish model proof',async t=>{
  const f=await channelFixture(t);assert.equal(f.calls[0].input.expectedDeliveryMode,'codex-channel');assert.equal(f.calls[0].input.providerSessionId,threadId);
  f.sockets[0].message(f.request);await waitFor(()=>f.executions.length===1);await settle();assert.equal(f.executions[0][1][2],threadId);assert.equal(f.sockets[0].sent.at(-1).type,'channel_written');assert.equal((await f.plugin.client.status()).connection.channelVerified,false);
  f.sockets[0].message(f.request);await settle();assert.equal(f.executions.length,1);const saved=await fs.readFile(path.join(f.directory,`claims-${sessionId}.json`),'utf8');assert.equal(saved.includes(channelToken),false);assert.equal(saved.includes(connectionCode),false);assert.equal(saved.includes(privateText),false);
});

test('an uncertain native queue outcome suspends delivery without replay or a false transport acknowledgement',async t=>{
  const f=await channelFixture(t,{failQueue:true});f.sockets[0].message(f.request);await waitFor(()=>f.diagnostics.includes('CHANNEL_NOTIFICATION_UNCONFIRMED'));assert.equal(f.executions.length,1);assert.equal(f.sockets[0].readyState,3);assert.equal(f.sockets[0].sent.some(frame=>frame.type==='channel_written'),false);
  f.sockets[0].message(f.request);await settle();assert.equal(f.executions.length,1);assert.equal((await f.plugin.client.status()).deliverySuspended,true);await assert.rejects(f.plugin.client.call('reply',{id:requestId,text:'Actual answer'}),error=>error.code==='CHANNEL_NOTIFICATION_UNCONFIRMED');assert.equal(f.calls.some(call=>call.input.operation==='reply'),false);assert.equal(JSON.stringify(f.diagnostics).includes(channelToken),false);
});

async function stdioSmoke(t,entry,directory){
  const transport=new StdioClientTransport({command:process.execPath,args:[entry],env:{CODEX_HOME:directory,CODEX_THREAD_ID:threadId},stderr:'pipe'}),client=new Client({name:'codex-real-stdio-test',version:'1'});let errors='';transport.stderr?.on('data',value=>{errors+=value;});
  try{await client.connect(transport);assert.deepEqual(client.getServerVersion(),{name:'sharedboard-codex',version:metadata.version});assert.equal(client.getServerCapabilities().experimental,undefined);assert.ok((await client.listTools()).tools.find(tool=>tool.name==='reply_to_chat_message'));const status=await client.callTool({name:'connection_status',arguments:{}});assert.equal(status.structuredContent.connection.connected,false);assert.equal(status.structuredContent.restartRequiresPairing,true);assert.equal(errors,'');}
  finally{await client.close();}
}

test('the actual Codex stdio entry starts without invoking a native queue or network request',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'sharedboard-codex-stdio-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));await stdioSmoke(t,fileURLToPath(new URL('../plugins/codex/src/main.mjs',import.meta.url)),directory);
});

test('the portable Codex build bundles common tools and SDK into ESM with no runtime node_modules',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),"sharedboard-codex-bundle ' spaces-"));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const target=path.join(directory,'plugin');await buildPlugin(target);
  const manifest=JSON.parse(await fs.readFile(path.join(target,'plugin.json'),'utf8')),mcp=JSON.parse(await fs.readFile(path.join(target,'mcp.json'),'utf8'));assert.equal(manifest.name,'sharedboard');assert.equal(manifest.extensions['com.openai'].requires_local_executor,true);assert.deepEqual(Object.keys(mcp.mcpServers),['sharedboard_local']);assert.equal(mcp.mcpServers.sharedboard_local.command,'node');assert.equal(mcp.mcpServers.sharedboard_local.args[0],'${PLUGIN_ROOT}/src/main.mjs');assert.equal(mcp.mcpServers.sharedboard_local.cwd,'${PLUGIN_ROOT}');
  assert.equal(JSON.parse(await fs.readFile(path.join(target,'package.json'),'utf8')).dependencies,undefined);assert.match(await fs.readFile(path.join(target,'skills','connect','SKILL.md'),'utf8'),/name: sharedboard-connect/);assert.match(await fs.readFile(path.join(target,'LICENSE'),'utf8'),/MIT/);
  const source=await fs.readFile(path.join(target,'src','main.mjs'),'utf8');assert.equal(source.includes("from '@modelcontextprotocol/sdk-v1"),false);assert.equal(source.includes("from '../../claude-code"),false);assert.match(source,/CODEX_QUEUE_UNCONFIRMED/);await assert.rejects(fs.stat(path.join(target,'node_modules')),error=>error.code==='ENOENT');await stdioSmoke(t,path.join(target,'src','main.mjs'),path.join(directory,'private-home'));
});
