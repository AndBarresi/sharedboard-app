import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {createBrowserTransport} from '../src/browser-store.mjs';
import {createBrowserBridge,validateBridgeDeadline} from '../src/browser-relay.mjs';
import {codexChannelSetup,claudeChannelSetup} from '../shared/connection-instructions.mjs';
import {createElements} from '../server/elements.mjs';
import {toolResult} from '../plugins/claude-code/src/tools.mjs';
import {Client as StdioClient} from '@modelcontextprotocol/sdk-v1/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk-v1/client/stdio.js';
import {Client as HostedClient,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {createMcpHandler} from '@modelcontextprotocol/server';
import {createBoardMcp} from '../server/tools.mjs';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';

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
 token='private-browser-token'; connection=null; commands=[]; receipts=new Map(); results=new Map(); notifyCount=0; owner=null; onNotify=null; notifyFailure=null; loseReceipt=false; failHandoff=false; offline=false; requests=[]; sockets=[];
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
  if(path==='/browser/notify'){this.notifyCount++;if(this.notifyFailure)return this.response(this.notifyFailure,409);await this.onNotify?.(body);const key=`${this.connection.id}:${body.kind}:${body.id}`;if(!this.receipts.has(key))this.receipts.set(key,{delivery:'queued',receipt:`${['claude-channel','codex-channel'].includes(this.connection.deliveryMode)?'ch':'evt'}_${body.kind}_${body.id}`});if(this.loseReceipt){this.loseReceipt=false;throw new Error('Receipt response lost');}return this.response(this.receipts.get(key));}
  if(path==='/browser/handoff')return this.failHandoff?this.response({error:'Fixture handoff unavailable'},503):this.response({delivery:'manual',handoffPrompt:`Read captured ${body.kind} ${body.id} using the connected SharedBoard tools.`,connection:this.connection});
  if(path==='/browser/live/stop'){if(body.sessionId!==this.connection.liveSession?.id)return this.response({error:'The live session changed.',code:'LIVE_SESSION_CHANGED'},409);this.connection={...this.connection,automaticMessages:false,automaticReviews:false,messageExpiresAt:null,reviewExpiresAt:null,liveSession:{...this.connection.liveSession,status:'stopped',waitExpiresAt:null}};return this.response({connection:this.connection});}
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

async function imagineFixture(permission='edit'){
 const f=await fixture(permission),items=createElements([
  {id:'finished_index',type:'rectangle',x:0,y:0,width:960,height:720,backgroundColor:'#fcfcfa',strokeColor:'#718b64'},
  {id:'finished_nav',type:'rectangle',x:24,y:24,width:912,height:64,text:'STUDIO      Work      About      Contact',fontSize:18,backgroundColor:'#e5eadc',strokeColor:'#275c46'},
  {id:'finished_heading',type:'text',x:64,y:160,text:'Thoughtful design for everyday life',fontSize:40,strokeColor:'#275c46'},
  {id:'contact_sketch',type:'rectangle',x:1200,y:0,width:960,height:720},
  {id:'contact_form',type:'rectangle',x:1264,y:200,width:600,height:380,text:'Contact me\nName\nEmail\nMessage\nSend'},
  {id:'unrelated_drawing',type:'rectangle',x:2600,y:100,width:200,height:100},
 ]),image={...items[0],id:'imported_index_reference',type:'image',x:0,y:800,fileId:'design_screenshot'};
 await call(f.t,'/api/board',{changes:[...items,image].map(element=>({id:element.id,expectedVersion:0,element})),files:{design_screenshot:{id:'design_screenshot',mimeType:'image/png',dataURL:png,created:1}}},'PATCH');
 const plan=await call(f.t,'/api/planning');await call(f.t,'/api/planning',{expectedVersion:plan.version,project:{...plan.project,notes:[{id:crypto.randomUUID(),title:'Index page styling',text:'Sage navigation and cream surfaces; retain the 40px dark green heading and 24px rhythm.',kind:'requirement',status:'open',elementIds:['finished_index'],createdAt:new Date().toISOString(),result:''}]}},'PUT');
 const input=await capture(f.t,{selectedIds:['contact_sketch','contact_form'],scope:'selection',text:'Imagine my contact wireframe using the finished index page and screenshot as its visual system.',intent:'work',automaticRequired:true,imagine:{instructions:'Polished contact form, consistent navigation.',designDirection:'Keep the existing index-page palette and hierarchy.'},imagineReferences:{elementIds:[...items.filter(e=>e.id.startsWith('finished_')).map(e=>e.id),image.id],visual:png}});
 const output={messageId:input.id,elements:[{id:'polished_contact',type:'rectangle',x:1200,y:0,width:960,height:720,backgroundColor:'#fcfcfa',strokeColor:'#718b64',corners:'sharp'},{id:'polished_nav',type:'rectangle',x:1224,y:24,width:912,height:64,text:'STUDIO      Work      About      Contact',fontSize:18,backgroundColor:'#e5eadc',strokeColor:'#275c46'},{id:'polished_title',type:'text',x:1264,y:160,text:'Let’s work together',fontSize:40,strokeColor:'#275c46'},{id:'polished_email',type:'rectangle',x:1264,y:270,width:600,height:56,text:'Your email address',fontSize:18,backgroundColor:'#ffffff',strokeColor:'#718b64'},{id:'polished_send',type:'rectangle',x:1264,y:580,width:180,height:48,text:'Send message',fontSize:18,backgroundColor:'#275c46',strokeColor:'#275c46',textColor:'#ffffff'}],designSummary:'Cream #fcfcfa surface; sage #e5eadc navigation; green #275c46 text and CTA; 40px heading, 18px controls, 24px spacing.'};
 return {...f,input,output};
}

test('Imagine captures a handmade index design and imported reference, replaces only the rough contact page, persists its real result, and can undo after reopening',async()=>{
 const f=await imagineFixture();let reopened;try{
  const before=await call(f.t,'/api/board');
  await call(f.t,'/api/chat',f.input);
  assert.equal((await f.bridge.command('replace_selection',f.output)).error.code,'IMAGINE_CAPTURE_UNREAD');
  const read=(await f.bridge.command('read_chat_message',{id:f.input.id})).result;
  assert.ok(read.board.elements.every(e=>e.id.startsWith('contact_')));
  assert.ok(read.board.imagineReferences.elements.some(e=>e.id==='imported_index_reference'));
  assert.match(read.board.planning.notes[0].text,/40px/);
  assert.equal(read.board.imagineReferences.files.design_screenshot.dataURL,undefined);
  const attached=toolResult(read);assert.equal(attached.content.filter(part=>part.type==='image').length,2);assert.equal(attached.structuredContent.board.imagineReferences.visual.attachedAsImage,true);
  assert.equal((await f.bridge.command('read_board')).result.revision,before.revision);
  const unrelated=before.elements.find(e=>e.id==='unrelated_drawing');
  await call(f.t,'/api/board',{changes:[{id:unrelated.id,expectedVersion:before.elementVersions[unrelated.id],element:{...unrelated,x:3000,version:unrelated.version+1}}]},'PATCH');
  const applied=(await f.bridge.command('replace_selection',f.output)).result;
  assert.ok(applied.createdIds.includes('polished_contact'));assert.deepEqual([...applied.removedIds].sort(),['contact_form','contact_form_label','contact_sketch']);
  const board=await call(f.t,'/api/board');
  for(const element of before.elements.filter(e=>e.id.startsWith('finished_')||e.type==='image'))assert.deepEqual(board.elements.find(e=>e.id===element.id),element);
  assert.equal(board.elements.find(e=>e.id==='unrelated_drawing').x,3000);
  assert.ok(board.elements.filter(e=>applied.createdIds.includes(e.id)).every(e=>e.roughness===0));
  assert.equal(board.elements.find(e=>e.id==='polished_send_label').strokeColor,'#ffffff');assert.equal(board.files.design_screenshot.dataURL,png);
  assert.deepEqual((await f.bridge.command('replace_selection',f.output)).result,applied);assert.equal((await call(f.t,'/api/board')).revision,board.revision);
  const reply='I matched the index page’s sage navigation, cream surface, typography and spacing, and replaced only the contact wireframe.';
  assert.equal((await f.bridge.command('reply_to_chat_message',{id:f.input.id,text:reply})).result.status,'answered');
  const messages=await call(f.t,'/api/chat');assert.equal(messages.messages[0].imagine.fingerprint,undefined);assert.equal(messages.messages[0].reply,reply);assert.ok(messages.messages[0].imagine.result.createdIds.length>0);
  const plan=await call(f.t,'/api/planning');assert.ok(plan.recoveries.length>0);assert.ok(plan.project.notes.some(n=>n.title==='Imagine design memory'));
  const backup=await call(f.t,'/api/project/export');assert.equal(JSON.stringify(backup).includes(f.input.id),false,'backups retain design memory but omit the private chat request routing ID');
  assert.equal(backup.board.elements.find(e=>e.id==='polished_nav').customData.sharedboardImagine.designSummary,f.output.designSummary);
  f.t.close();await wait(()=>f.bridge.owner===null);reopened=await createBrowserTransport(f.config);await reopened.ready();await wait(()=>f.bridge.owner?.readyState===1);
  assert.equal((await call(reopened,'/api/chat')).messages[0].imagine.result.revision,applied.revision);assert.equal((await call(reopened,'/api/board')).elements.find(e=>e.id==='polished_email').backgroundColor,'#ffffff');
  await call(reopened,'/api/undo-agent',{id:plan.agentActions[0].id});
  const restored=await call(reopened,'/api/board');assert.equal(restored.elements.find(e=>e.id==='contact_sketch').isDeleted,false);assert.equal(restored.elements.find(e=>e.id==='polished_contact').isDeleted,true);assert.equal(restored.elements.find(e=>e.id==='unrelated_drawing').x,3000);
  assert.equal((await call(reopened,'/api/planning')).project.notes.some(n=>n.title==='Imagine design memory'),false);
  const reverted=(await call(reopened,'/api/chat')).messages[0].imagine.result;assert.ok(reverted.undoneAt);assert.deepEqual((await f.bridge.command('replace_selection',f.output)).result,reverted);assert.equal((await call(reopened,'/api/board')).revision,restored.revision,'the same captured request cannot reapply an undone pass');
 }finally{f.t.close();reopened?.close();}
});

test('Imagine rejects changed selected objects, changed references, newer design requirements and read-only grants without partial writes or recovery side effects',async()=>{
 for(const target of ['contact_form','finished_nav','design_screenshot','requirements']){
  const f=await imagineFixture();try{
   await call(f.t,'/api/chat',f.input);await f.bridge.command('read_chat_message',{id:f.input.id});
   if(target==='requirements'){const plan=await call(f.t,'/api/planning');await call(f.t,'/api/planning',{expectedVersion:plan.version,project:{...plan.project,notes:plan.project.notes.map(n=>({...n,text:'Human updated the index style while the AI was working.'}))}},'PUT');}
   else if(target==='design_screenshot'){const board=await call(f.t,'/api/board');await call(f.t,'/api/board',{changes:[],files:{design_screenshot:{...board.files.design_screenshot,dataURL:png.replace('AAAAASUVORK5CYII=','AAAAASUVORK5CYIE=')}}},'PATCH');}
   else{const board=await call(f.t,'/api/board'),element=board.elements.find(e=>e.id===target);await call(f.t,'/api/board',{changes:[{id:target,expectedVersion:board.elementVersions[target],element:{...element,x:element.x+20,version:element.version+1}}]},'PATCH');}
   const before=await call(f.t,'/api/board'),planBefore=await call(f.t,'/api/planning'),response=await f.bridge.command('replace_selection',f.output);
   assert.equal(response.error.status,409);assert.equal(response.error.code,target==='contact_form'?'IMAGINE_SELECTION_CHANGED':target==='requirements'?'IMAGINE_REQUIREMENTS_CHANGED':'IMAGINE_REFERENCE_CHANGED');
   assert.deepEqual(await call(f.t,'/api/board'),before);assert.deepEqual(await call(f.t,'/api/planning'),planBefore);
  }finally{f.t.close();}
 }
 const readonly=await imagineFixture('read');try{await assert.rejects(call(readonly.t,'/api/chat',readonly.input),error=>error.status===403&&error.code==='IMAGINE_ACCESS_REQUIRED');assert.equal((await readonly.bridge.command('replace_selection',readonly.output)).error.status,403);}finally{readonly.t.close();}
});

test('Imagine detects new human frame children atomically and rejects wrong request identities and changed duplicate references',async()=>{
 const f=await imagineFixture();try{
  const board=await call(f.t,'/api/board'),frame={id:'contact_frame',type:'frame',x:1200,y:0,width:960,height:720,version:1,isDeleted:false};
  await call(f.t,'/api/board',{changes:[{id:frame.id,expectedVersion:0,element:frame},...board.elements.filter(e=>e.id.startsWith('contact_')).map(element=>({id:element.id,expectedVersion:board.elementVersions[element.id],element:{...element,frameId:frame.id,version:element.version+1}}))]},'PATCH');
  const input=await capture(f.t,{...f.input,expectedRevision:(await call(f.t,'/api/board')).revision,selectedIds:[frame.id]});await call(f.t,'/api/chat',input);await f.bridge.command('read_chat_message',{id:input.id});
  await assert.rejects(call(f.t,'/api/chat',{...input,imagineReferences:{elementIds:['finished_index'],visual:png}}),error=>error.status===409);
  assert.equal((await f.bridge.command('replace_selection',{...f.output,messageId:crypto.randomUUID()})).error.code,'IMAGINE_REQUEST_SCOPE');
  const child={id:'human_added_field',type:'rectangle',x:1300,y:300,width:500,height:50,frameId:frame.id,version:1,isDeleted:false};await call(f.t,'/api/board',{changes:[{id:child.id,expectedVersion:0,element:child}]},'PATCH');
  const before=await call(f.t,'/api/board'),response=await f.bridge.command('replace_selection',f.output);assert.equal(response.error.code,'IMAGINE_SELECTION_CHANGED');assert.ok(response.error.conflicts.includes(child.id));assert.deepEqual(await call(f.t,'/api/board'),before);
 }finally{f.t.close();}
});

test('hosted MCP discovery and execution attach both immutable images and apply the Imagine tool through the actual browser transport',async()=>{
 const f=await imagineFixture(),handler=createMcpHandler(()=>createBoardMcp(async(operation,input)=>{const response=await f.bridge.command(operation,input);if(response.error)throw Object.assign(new Error(response.error.message),response.error);return response.result;},{remote:true,remotePair:true,proposals:false})),client=new HostedClient({name:'Imagine hosted tool acceptance',version:'1'});
 try{
  await call(f.t,'/api/chat',f.input);
  await client.connect(new StreamableHTTPClientTransport(new URL('https://imagine.test/mcp'),{fetch:(input,init)=>handler.fetch(new Request(input,init))}));
  const definitions=(await client.listTools()).tools,replace=definitions.find(tool=>tool.name==='replace_selection');assert.ok(replace);assert.equal(replace.annotations.destructiveHint,true);assert.ok(replace.inputSchema.required.includes('messageId'));assert.ok(replace.inputSchema.properties.elements.items.properties.corners);
  const read=await client.callTool({name:'read_chat_message',arguments:{id:f.input.id}});assert.equal(read.isError,undefined);assert.equal(read.content.filter(item=>item.type==='image').length,2);assert.equal(read.structuredContent.board.imagineReferences.visual.attachedAsImage,true);assert.equal(read.structuredContent.board.imagineReferences.visual.dataURL,undefined);
  assert.equal((await client.callTool({name:'read_board',arguments:{full:true}})).structuredContent.revision,1);
  const applied=await client.callTool({name:'replace_selection',arguments:f.output});assert.equal(applied.isError,undefined,JSON.stringify(applied));assert.ok(applied.structuredContent.createdIds.includes('polished_nav'));assert.equal((await call(f.t,'/api/board')).elements.find(e=>e.id==='finished_nav').backgroundColor,'#e5eadc');
  const reply=await client.callTool({name:'reply_to_chat_message',arguments:{id:f.input.id,text:'Applied the contact design using the index page reference.'}});assert.equal(reply.structuredContent.status,'answered');
 }finally{await client.close();await handler.close();f.t.close();}
});

for(const provider of ['codex','claude'])test(`updated ${provider} plugin stdio advertises and executes Imagine with both reference images against isolated browser storage`,{timeout:10000},async()=>{
 const f=await imagineFixture(),requests=[];
 const server=createServer(async(request,response)=>{
  try{let raw='';for await(const part of request)raw+=part;const {operation,input}=JSON.parse(raw);requests.push({operation,input});const value=await f.bridge.command(operation,input);response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify(value));}
  catch(error){response.writeHead(500,{'content-type':'application/json'});response.end(JSON.stringify({error:{message:error.message}}));}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`,threadId=crypto.randomUUID();
 const moduleURL=new URL(provider==='codex'?'../plugins/codex/src/server.mjs':'../plugins/claude-code/src/tools.mjs',import.meta.url).href;
 const source=`import {StdioServerTransport} from '@modelcontextprotocol/sdk-v1/server/stdio.js';
import {${provider==='codex'?'createCodexPlugin':'createPluginServer'} as create} from ${JSON.stringify(moduleURL)};
const client={async connect(){return {connected:true};},async disconnect(){return {disconnected:true};},async status(){return {connection:{connected:true}};},async close(){},async call(operation,input){const value=await fetch(${JSON.stringify(origin)},{method:'POST',body:JSON.stringify({operation,input})}).then(response=>response.json());if(value.error)throw Object.assign(new Error(value.error.message),value.error);return value.result;}};
const plugin=create({client,nativeThreadId:${JSON.stringify(threadId)}});await plugin.server.connect(new StdioServerTransport());`;
 const transport=new StdioClientTransport({command:process.execPath,args:['--input-type=module','--eval',source],cwd:fileURLToPath(new URL('../',import.meta.url)),stderr:'pipe'}),client=new StdioClient({name:`Imagine ${provider} stdio acceptance`,version:'1'});let stderr='';transport.stderr?.on('data',chunk=>{stderr+=chunk;});
 try{
  await call(f.t,'/api/chat',f.input);await client.connect(transport);
  const definitions=(await client.listTools()).tools,replace=definitions.find(tool=>tool.name==='replace_selection');assert.ok(replace);assert.ok(replace.inputSchema.properties.elements.items.properties.corners);
  assert.equal((await client.callTool({name:'connect_board',arguments:{connectionCode:'isolated-test-only',...(provider==='codex'?{providerSessionId:threadId}:{})}})).isError,undefined);
  const read=await client.callTool({name:'read_chat_message',arguments:{id:f.input.id}});assert.equal(read.isError,undefined,JSON.stringify(read));assert.equal(read.content.filter(item=>item.type==='image').length,2);assert.equal(read.structuredContent.board.imagineReferences.visual.dataURL,undefined);assert.equal(read.structuredContent.board.imagineReferences.files.design_screenshot.dataURL,undefined);
  await client.callTool({name:'read_board',arguments:{full:true}});
  const result=await client.callTool({name:'replace_selection',arguments:f.output});assert.equal(result.isError,undefined,JSON.stringify(result));assert.ok(result.structuredContent.createdIds.includes('polished_send'));
  const reply=await client.callTool({name:'reply_to_chat_message',arguments:{id:f.input.id,text:'The matching contact layout is on the board.'}});assert.equal(reply.structuredContent.status,'answered');assert.ok(requests.some(item=>item.operation==='replace_selection'));assert.equal((await call(f.t,'/api/board')).elements.find(e=>e.id==='polished_nav').roughness,0);assert.equal(stderr,'');
 }finally{await client.close();await new Promise(resolve=>server.close(resolve));f.t.close();}
});

test('direct-only browser messages and reviews never fall back to manual delivery after a link expires',async()=>{
 const {t,bridge}=await fixture();try{
  Object.assign(bridge.connection,{automaticMessages:false,automaticReviews:false});await t.bridgeStatus();
  const blocked=await capture(t,{text:'Keep this direct',intent:'discuss',automaticRequired:true});
  await assert.rejects(call(t,'/api/chat',blocked),error=>error.code==='DIRECT_CHAT_NOT_LINKED');
  await assert.rejects(call(t,'/api/reviews',await capture(t,{automaticRequired:true})),error=>error.code==='DIRECT_CHAT_NOT_LINKED');
  Object.assign(bridge.connection,{automaticMessages:true,automaticReviews:true,deliveryMode:'panel',panelConnected:true,messageExpiresAt:new Date(Date.now()+60000).toISOString()});await t.bridgeStatus();
  await assert.rejects(call(t,'/api/chat',blocked),error=>error.code==='DIRECT_CHAT_NOT_LINKED');
  await assert.rejects(call(t,'/api/reviews',await capture(t,{automaticRequired:true})),error=>error.code==='DIRECT_CHAT_NOT_LINKED');
  assert.equal((await call(t,'/api/chat')).messages.length,0);
  assert.equal(bridge.requests.some(request=>new URL(request.url).pathname==='/browser/handoff'),false);
  Object.assign(bridge.connection,{automaticMessages:true,deliveryMode:'events',messageExpiresAt:new Date(Date.now()+60000).toISOString()});await t.bridgeStatus();
  bridge.onNotify=async()=>{throw new Error('Temporary direct delivery failure');};
  const saved=await call(t,'/api/chat',blocked);assert.equal(saved.messages[0].delivery,'uncertain');
  Object.assign(bridge.connection,{automaticMessages:false});await t.bridgeStatus();
  await assert.rejects(call(t,'/api/chat/retry',{id:blocked.id}),error=>error.code==='DIRECT_CHAT_NOT_LINKED');
  assert.equal((await call(t,'/api/chat')).messages[0].id,blocked.id);
  assert.equal(bridge.requests.some(request=>new URL(request.url).pathname==='/browser/handoff'),false);
  bridge.onNotify=null;Object.assign(bridge.connection,{automaticMessages:true,messageExpiresAt:new Date(Date.now()+60000).toISOString()});await t.bridgeStatus();
  const retried=await call(t,'/api/chat/retry',{id:blocked.id});assert.equal(retried.messages.length,1);assert.equal(retried.messages[0].id,blocked.id);assert.equal(retried.messages[0].delivery,'queued');
 }finally{t.close();}
});

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

test('live captures pin the listening session and pause preserves board, requests and connection',async()=>{
 const {t,bridge}=await fixture();try{
  const sessionId=crypto.randomUUID(),expiresAt=new Date(Date.now()+120000).toISOString(),waitExpiresAt=new Date(Date.now()+40000).toISOString();
  Object.assign(bridge.connection,{deliveryMode:'live-session',automaticMessages:true,automaticReviews:true,messageExpiresAt:waitExpiresAt,reviewExpiresAt:waitExpiresAt,liveSession:{id:sessionId,status:'waiting',expiresAt,waitExpiresAt}});await t.bridgeStatus();
  const input=await capture(t,{automaticRequired:true,text:'Read the test board only',intent:'discuss',liveSessionId:crypto.randomUUID()}),sent=await call(t,'/api/chat',input);
  assert.equal(sent.messages[0].liveSessionId,sessionId,'session is derived from the connection, never caller-supplied');
  const before=await call(t,'/api/board');
  await assert.rejects(call(t,'/api/connection/live/stop',{sessionId:crypto.randomUUID()}),error=>error.code==='LIVE_SESSION_CHANGED');
  assert.equal((await call(t,'/api/connection')).automaticMessages,true);
  Object.assign(bridge.connection,{liveSession:{...bridge.connection.liveSession,status:'processing'}});await t.bridgeStatus();
  await assert.rejects(call(t,'/api/reviews',await capture(t,{automaticRequired:true})),error=>error.code==='DIRECT_CHAT_NOT_LINKED');
  const paused=await call(t,'/api/connection/live/stop',{sessionId});assert.equal(paused.connected,true);assert.equal(paused.automaticMessages,false);assert.equal(paused.liveSession.status,'stopped');
  assert.deepEqual(await call(t,'/api/board'),before);assert.equal((await call(t,'/api/chat')).messages[0].id,input.id);
 }finally{t.close();}
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

test('native chat reserves one outstanding reply atomically across tabs before delivery accepts a receipt',async()=>{
 const {t,bridge,config}=await fixture('read',{BroadcastChannel:TestChannel});let second,reopened,release;
 try{
  Object.assign(bridge.connection,{deliveryMode:'events',messageExpiresAt:new Date(Date.now()+60000).toISOString()});await t.bridgeStatus();
  second=await createBrowserTransport(config);await second.ready();
  const firstInput=await capture(t,{text:'First native question',intent:'discuss',automaticRequired:true}),nextInput=await capture(second,{text:'Keep the next draft',intent:'discuss',automaticRequired:true});
  let entered;const notifying=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
  bridge.onNotify=async body=>{if(body.kind==='chat'&&body.id===firstInput.id){entered();await gate;}};
  const sending=call(t,'/api/chat',firstInput);await notifying;
  const staged=(await call(second,'/api/chat')).messages;assert.equal(staged.length,1);assert.equal(staged[0].delivery,'pending');assert.equal(staged[0].deliveryMode,'events');assert.equal(staged[0].receipt,undefined);
  await assert.rejects(call(second,'/api/chat',nextInput),error=>error.status===409&&error.code==='CHAT_REPLY_PENDING');
  assert.deepEqual((await call(t,'/api/chat')).messages,staged,'a rejected new send creates no capture or altered original record');assert.equal(bridge.notifyCount,1);
  const review=await call(second,'/api/reviews',await capture(second,{automaticRequired:true}));assert.equal(review.request.delivery,'queued','the chat guard does not change board reviews');
  release();const accepted=await sending;assert.equal(accepted.messages[0].receipt,`evt_chat_${firstInput.id}`);
  for(const [path,input] of [['/api/chat',firstInput],['/api/chat/retry',{id:firstInput.id}]]){const status=await call(second,path,input);assert.equal(status.messages.length,1);assert.equal(status.messages[0].id,firstInput.id);assert.equal(status.messages[0].delivery,'queued');}
  assert.equal(bridge.notifyCount,2,'same-ID status retries never replay accepted native work');
  await bridge.command('read_chat_message',{id:firstInput.id});await assert.rejects(call(second,'/api/chat',nextInput),error=>error.code==='CHAT_REPLY_PENDING');
  await bridge.command('reply_to_chat_message',{id:firstInput.id,text:'The actual first answer returns to the board.'});
  const next=await call(second,'/api/chat',nextInput);assert.equal(next.messages.length,2);assert.equal(next.messages[1].id,nextInput.id);assert.equal(next.messages[1].text,nextInput.text);assert.equal(next.messages[0].reply,'The actual first answer returns to the board.');assert.equal(bridge.notifyCount,3);
  second.close();second=null;t.close();await wait(()=>bridge.owner===null);reopened=await createBrowserTransport(config);await reopened.ready();
  const before=(await call(reopened,'/api/chat')).messages;await assert.rejects(call(reopened,'/api/chat',await capture(reopened,{text:'Third draft after reopening',intent:'discuss',automaticRequired:true})),error=>error.code==='CHAT_REPLY_PENDING');assert.deepEqual((await call(reopened,'/api/chat')).messages,before);assert.equal(bridge.notifyCount,3);
 }finally{release?.();t.close();second?.close();reopened?.close();}
});

test('local channels bootstrap only an explicit Discuss probe and require real proof plus exact process for later work',async()=>{
 for(const [provider,deliveryMode] of [['claude-code','claude-channel'],['codex','codex-channel']]){
 const {t,bridge}=await fixture('read');try{
  const processId=crypto.randomUUID();Object.assign(bridge.connection,{provider,deliveryMode,channelConnected:true,channelVerified:false,channelSessionId:processId,channelExpiresAt:new Date(Date.now()+60000).toISOString(),automaticMessages:false,automaticReviews:false});await t.bridgeStatus();
  const original=await call(t,'/api/board'),normal=await capture(t,{text:'Normal discussion is still locked',intent:'discuss'});
  await assert.rejects(call(t,'/api/chat',normal),error=>error.code==='DIRECT_CHAT_NOT_LINKED');await assert.rejects(call(t,'/api/reviews',await capture(t)),error=>error.code==='DIRECT_CHAT_NOT_LINKED');
  await assert.rejects(call(t,'/api/chat',await capture(t,{text:'Do not bootstrap work',intent:'work',channelTest:true})),error=>error.code==='CHANNEL_TEST_UNAVAILABLE');assert.equal((await call(t,'/api/chat')).messages.length,0);assert.equal(bridge.notifyCount,0);
  const probe=await capture(t,{text:'Connection check only: read and reply without drawing changes.',intent:'discuss',automaticRequired:true,channelTest:true});
  const sent=(await call(t,'/api/chat',probe)).messages[0];assert.equal(sent.receipt,`ch_chat_${probe.id}`);assert.equal(sent.deliveryMode,deliveryMode);assert.equal(sent.channelSessionId,processId);assert.equal(sent.channelTest,true);
  const notification=bridge.requests.filter(request=>new URL(request.url).pathname==='/browser/notify').at(-1);assert.deepEqual(JSON.parse(notification.body),{kind:'chat',id:probe.id,test:true});assert.equal(bridge.notifyCount,1);
  await assert.rejects(call(t,'/api/chat',await capture(t,{text:'A second test must wait for the actual reply',intent:'discuss',channelTest:true})),error=>error.code==='CHAT_REPLY_PENDING');
  await bridge.command('read_chat_message',{id:probe.id});assert.equal((await call(t,'/api/connection')).automaticMessages,false,'reading a probe is not delivery proof');
  await bridge.command('reply_to_chat_message',{id:probe.id,text:'The isolated SDK read and returned this actual captured reply.'});assert.equal((await call(t,'/api/chat')).messages[0].status,'answered');assert.equal((await call(t,'/api/connection')).automaticMessages,false,'the browser must wait for backend proof rather than infer it from unrelated local metadata');
  Object.assign(bridge.connection,{channelVerified:true,automaticMessages:true,automaticReviews:true});await t.bridgeStatus();
  const next=await capture(t,{text:'The next normal question',intent:'discuss',automaticRequired:true}),nextSent=(await call(t,'/api/chat',next)).messages.at(-1);assert.equal(nextSent.receipt,`ch_chat_${next.id}`);assert.equal(nextSent.channelTest,undefined);assert.equal(JSON.parse(bridge.requests.filter(request=>new URL(request.url).pathname==='/browser/notify').at(-1).body).test,undefined,'normal sends never acquire bootstrap authorization');
  await call(t,'/api/reviews',await capture(t,{automaticRequired:true}));assert.deepEqual(await call(t,'/api/board'),original,'tests and Discuss never edit the board');
  const notifyCount=bridge.notifyCount;bridge.connection.channelConnected=false;await t.bridgeStatus();await assert.rejects(call(t,'/api/reviews',await capture(t,{automaticRequired:true})),error=>error.code==='DIRECT_CHAT_NOT_LINKED');assert.equal(bridge.notifyCount,notifyCount);
  bridge.connection.channelConnected=true;await t.bridgeStatus();await call(t,'/api/chat/retry',{id:next.id});assert.equal(bridge.notifyCount,notifyCount,'a current-process reconnect preserves the queued receipt without replay');
  bridge.connection.channelSessionId=crypto.randomUUID();bridge.connection.channelVerified=false;bridge.connection.automaticMessages=false;bridge.connection.automaticReviews=false;await t.bridgeStatus();
  await assert.rejects(call(t,'/api/chat/retry',{id:next.id}),error=>error.code==='CHANNEL_REQUEST_SESSION_CHANGED');assert.equal((await call(t,'/api/chat')).messages.at(-1).id,next.id);assert.equal((await call(t,'/api/chat')).messages.at(-1).channelSessionId,processId);
 }finally{t.close();}
 }
});

test('bootstrap tests reserve one original capture across initial notify races, tabs and reopening',async()=>{
 for(const [provider,deliveryMode] of [['codex','codex-channel'],['claude-code','claude-channel']]){
  const {t,bridge,config}=await fixture('read',{BroadcastChannel:TestChannel});let second,reopened,release;
  try{
   const processId=crypto.randomUUID();Object.assign(bridge.connection,{provider,deliveryMode,channelConnected:true,channelVerified:false,channelSessionId:processId,channelExpiresAt:new Date(Date.now()+60000).toISOString(),automaticMessages:false,automaticReviews:false});await t.bridgeStatus();
   second=await createBrowserTransport(config);await second.ready();
   const original=await capture(t,{text:'Original bootstrap test',intent:'discuss',automaticRequired:true,channelTest:true}),extra=await capture(second,{text:'Second click must not create another test',intent:'discuss',automaticRequired:true,channelTest:true});
   let entered;const notifying=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});bridge.onNotify=async body=>{if(body.id===original.id){entered();await gate;}};
   const sending=call(t,'/api/chat',original);await notifying;
   const staged=(await call(second,'/api/chat')).messages;assert.equal(staged.length,1);assert.equal(staged[0].delivery,'pending');assert.equal(staged[0].channelTest,true);assert.equal(staged[0].channelSessionId,processId);
   const attempts=await Promise.allSettled([call(t,'/api/chat',extra),call(second,'/api/chat',{...extra,id:crypto.randomUUID()})]);for(const attempt of attempts){assert.equal(attempt.status,'rejected');assert.equal(attempt.reason.code,'CHAT_REPLY_PENDING');}
   assert.deepEqual((await call(t,'/api/chat')).messages,staged);assert.equal(bridge.notifyCount,1);
   release();await sending;await bridge.command('read_chat_message',{id:original.id});await assert.rejects(call(second,'/api/chat',extra),error=>error.code==='CHAT_REPLY_PENDING');
   second.close();second=null;t.close();await wait(()=>bridge.owner===null);reopened=await createBrowserTransport(config);await reopened.ready();await wait(()=>bridge.owner?.readyState===1);
   const saved=(await call(reopened,'/api/chat')).messages;assert.equal(saved[0].id,original.id);assert.equal(saved[0].status,'reading');assert.equal(saved[0].receipt,`ch_chat_${original.id}`);
   await assert.rejects(call(reopened,'/api/chat',extra),error=>error.code==='CHAT_REPLY_PENDING');assert.equal(bridge.notifyCount,1,'reopening and another click do not create or notify a second test');
   const read=await bridge.command('read_chat_message',{id:original.id});assert.equal(read.result.board.visual.dataURL,png);assert.equal(read.result.message.id,original.id);
   const nextProcess=crypto.randomUUID();bridge.connection.channelSessionId=nextProcess;await reopened.bridgeStatus();
   const fresh=await call(reopened,'/api/chat',await capture(reopened,{text:'Fresh process gets its own explicit test',intent:'discuss',automaticRequired:true,channelTest:true}));assert.equal(fresh.messages.length,2);assert.equal(fresh.messages[0].channelSessionId,processId);assert.equal(fresh.messages[1].channelSessionId,nextProcess);assert.equal(bridge.notifyCount,2);
   await assert.rejects(call(reopened,'/api/chat/retry',{id:original.id}),error=>error.code==='CHANNEL_REQUEST_SESSION_CHANGED');
  }finally{release?.();t.close();second?.close();reopened?.close();}
 }
});

test('failed and uncertain bootstrap tests require an explicit retry of their original saved ID',async()=>{
 for(const failure of ['failed','uncertain']){
  const {t,bridge}=await fixture('read');try{
   Object.assign(bridge.connection,{provider:'codex',deliveryMode:'codex-channel',channelConnected:true,channelVerified:false,channelSessionId:crypto.randomUUID(),channelExpiresAt:new Date(Date.now()+60000).toISOString(),automaticMessages:false,automaticReviews:false});await t.bridgeStatus();
   if(failure==='failed')bridge.notifyFailure={error:'The channel could not accept this test.',code:'CHANNEL_UNAVAILABLE'};else bridge.loseReceipt=true;
   const original=await capture(t,{text:'Keep this original test and capture',intent:'discuss',automaticRequired:true,channelTest:true});
   const saved=(await call(t,'/api/chat',original)).messages;assert.equal(saved.length,1);assert.equal(saved[0].delivery,failure);assert.equal(bridge.notifyCount,1);
   await assert.rejects(call(t,'/api/chat',await capture(t,{text:'Do not create another bootstrap ID',intent:'discuss',channelTest:true})),error=>error.code==='CHAT_REPLY_PENDING');assert.deepEqual((await call(t,'/api/chat')).messages,saved);assert.equal(bridge.notifyCount,1);
   bridge.notifyFailure=null;const retried=(await call(t,'/api/chat/retry',{id:original.id})).messages;assert.equal(retried.length,1);assert.equal(retried[0].id,original.id);assert.equal(retried[0].delivery,'queued');assert.equal(retried[0].receipt,`ch_chat_${original.id}`);assert.equal(bridge.receipts.size,1);assert.equal(bridge.notifyCount,2);
   await call(t,'/api/chat/retry',{id:original.id});assert.equal(bridge.notifyCount,2,'accepted original-ID retries are status checks without replay');
   const read=await bridge.command('read_chat_message',{id:original.id});assert.equal(read.result.board.visual.dataURL,png);assert.equal(read.result.message.text,original.text);assert.equal((await call(t,'/api/connection')).automaticMessages,false,'test status is never fake proof');
  }finally{t.close();}
 }
});

test('verified plugin migration preserves failed bootstrap history without blocking or replaying it',async()=>{
 for(const [provider,deliveryMode] of [['codex','codex-channel'],['claude-code','claude-channel']]){
  const {t,bridge,config}=await fixture('read');let db;
  try{
   Object.assign(bridge.connection,{provider,deliveryMode,channelConnected:true,channelVerified:false,channelSessionId:crypto.randomUUID(),channelExpiresAt:new Date(Date.now()+60000).toISOString(),automaticMessages:false,automaticReviews:false});await t.bridgeStatus();
   const newer=await capture(t,{text:'Newer test completed before this upgrade',intent:'discuss',automaticRequired:true,channelTest:true});await call(t,'/api/chat',newer);await bridge.command('read_chat_message',{id:newer.id});await bridge.command('reply_to_chat_message',{id:newer.id,text:'The newer test returned its actual saved answer.'});
   Object.assign(bridge.connection,{channelVerified:true,automaticMessages:true,automaticReviews:true});await t.bridgeStatus();
   db=await new Promise((resolve,reject)=>{const opening=config.indexedDB.open(config.dbName);opening.onsuccess=()=>resolve(opening.result);opening.onerror=()=>reject(opening.error);});
   const oldId=crypto.randomUUID(),oldText='Historical failed bootstrap from before the guard was added';
   const setHistorical=changes=>new Promise((resolve,reject)=>{const tx=db.transaction('boards','readwrite'),store=tx.objectStore('boards'),reading=store.get(t.boardId);reading.onsuccess=()=>{const record=reading.result,answered=record.messages.find(item=>item.id===newer.id),old={...structuredClone(answered),id:oldId,text:oldText,status:'waiting',delivery:'failed',...changes};delete old.reply;delete old.repliedAt;if(!Object.hasOwn(changes,'receipt'))delete old.receipt;record.messages=[old,...record.messages.filter(item=>item.id!==oldId)];store.put(record);};tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
   const next=await capture(t,{text:'The normal next message after migration',intent:'discuss',automaticRequired:true});
   for(const changes of [{delivery:'pending'},{delivery:'uncertain'},{delivery:'queued'},{delivery:'queued',receipt:`ch_chat_${oldId}`},{delivery:'failed',receipt:`ch_chat_${oldId}`}]){
    await setHistorical(changes);await assert.rejects(call(t,'/api/chat',{...next,id:crypto.randomUUID()}),error=>error.code==='CHAT_REPLY_PENDING');assert.equal((await call(t,'/api/chat')).messages.length,2);assert.equal(bridge.notifyCount,1,'an outstanding historical obligation never creates another send');
   }
   await setHistorical({delivery:'failed'});const saved=await call(t,'/api/chat'),before=saved.messages.find(item=>item.id===oldId);assert.equal(before.reply,undefined);assert.equal(before.receipt,undefined);assert.equal((await call(t,'/api/connection')).channelVerified,true);
   const sent=(await call(t,'/api/chat',next)).messages;assert.equal(sent.length,3);assert.deepEqual(sent.find(item=>item.id===oldId),before);assert.equal(sent.find(item=>item.id===newer.id).reply,'The newer test returned its actual saved answer.');assert.equal(sent.at(-1).id,next.id);assert.equal(sent.at(-1).channelTest,undefined);assert.equal(bridge.notifyCount,2);
   const notified=bridge.requests.filter(request=>new URL(request.url).pathname==='/browser/notify').map(request=>JSON.parse(request.body).id);assert.deepEqual(notified,[newer.id,next.id],'migration never replays the historical failed test');assert.equal(bridge.receipts.size,2);
  }finally{db?.close();t.close();}
 }
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

test('cached capability flags route new requests by their own deadlines instead of an earlier sibling expiry',async()=>{
 const {t,bridge}=await fixture();try{
  const future=new Date(Date.now()+60000).toISOString(),past=new Date(Date.now()-1000).toISOString();
  Object.assign(bridge.connection,{automaticMessages:true,automaticReviews:true,messageExpiresAt:future,reviewExpiresAt:past,eventExpiresAt:past});await t.bridgeStatus();
  const chat=await call(t,'/api/chat',await capture(t,{text:'An active chat survives an expired review subscription.',intent:'discuss'})),review=await call(t,'/api/reviews',await capture(t));
  assert.equal(chat.messages[0].delivery,'queued');assert.equal(chat.automaticMessages,true);assert.equal(review.request.delivery,'manual');assert.equal(review.automaticMessages,false);
  await bridge.command('read_chat_message',{id:chat.messages[0].id});await bridge.command('reply_to_chat_message',{id:chat.messages[0].id,text:'The original chat request is complete before testing the next subscription deadline.'});
  const notifications=bridge.requests.filter(request=>new URL(request.url).pathname==='/browser/notify').map(request=>JSON.parse(request.body).kind);assert.deepEqual(notifications,['chat']);
  Object.assign(bridge.connection,{messageExpiresAt:past,reviewExpiresAt:future});await t.bridgeStatus();
  const newChat=await call(t,'/api/chat',await capture(t,{text:'This new request needs a manual handoff after chat expiry.',intent:'discuss'})),newReview=await call(t,'/api/reviews',await capture(t));
  assert.equal(newChat.messages.at(-1).delivery,'manual');assert.equal(newChat.automaticMessages,false);assert.equal(newReview.request.delivery,'queued');assert.equal(newReview.automaticMessages,true);assert.equal(bridge.connection.automaticMessages,true,'the cached flag stays true, so deadline checks are required');
  assert.deepEqual(bridge.requests.filter(request=>new URL(request.url).pathname==='/browser/notify').map(request=>JSON.parse(request.body).kind),['chat','review']);
 }finally{t.close();}
});

test('a cached expired subscription cannot convert an uncertain automatic request into a manual resend',async()=>{
 const {t,bridge}=await fixture();try{
  Object.assign(bridge.connection,{messageExpiresAt:new Date(Date.now()+60000).toISOString(),reviewExpiresAt:new Date(Date.now()+120000).toISOString()});await t.bridgeStatus();
  const input=await capture(t,{text:'Preserve the original uncertain request and attachment.',intent:'discuss'});bridge.loseReceipt=true;
  const sent=await call(t,'/api/chat',input);assert.equal(sent.messages[0].delivery,'uncertain');assert.equal(bridge.notifyCount,1);
  bridge.connection.messageExpiresAt=new Date(Date.now()-1000).toISOString();await t.bridgeStatus();
  await assert.rejects(call(t,'/api/chat/retry',{id:input.id}),error=>error.status===409&&error.code==='DELIVERY_UNCERTAIN'&&error.deliveryUnknown);
  const saved=(await call(t,'/api/chat')).messages[0];assert.equal(saved.id,input.id);assert.equal(saved.delivery,'uncertain');assert.equal(saved.boardRevision,input.expectedRevision);assert.equal(saved.planningVersion,input.expectedPlanningVersion);assert.equal(saved.handoffPrompt,undefined);assert.equal(bridge.notifyCount,1);
  assert.equal(bridge.requests.filter(request=>new URL(request.url).pathname==='/browser/handoff').length,0);
 }finally{t.close();}
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

test('temporary network loss preserves native captured IDs, offline browser edits and leases without replay after reopening',async()=>{
 const bridge=new FakeBridge(),BaseSocket=bridge.WebSocket,Socket=class extends BaseSocket{constructor(url){if(bridge.offline)throw new Error('Fixture socket network unavailable');super(url);}};
 const config={indexedDB:new IDBFactory(),dbName:crypto.randomUUID(),origin:'https://sharedboard.app',BroadcastChannel:null,bridgeFetch:bridge.fetch.bind(bridge),bridgeWebSocket:Socket,bridgePollDelay:10};
 let t=await createBrowserTransport(config);try{
  await t.ready();await call(t,'/api/connection/pairing',{provider:'chatgpt',permission:'edit'});bridge.activate();
  Object.assign(bridge.connection,{deliveryMode:'events',messageExpiresAt:new Date(Date.now()+60000).toISOString(),reviewExpiresAt:new Date(Date.now()+120000).toISOString()});await t.bridgeStatus();await wait(()=>bridge.owner?.readyState===1);
  const identity=structuredClone(bridge.connection),token=bridge.token;
  await bridge.command('add_elements',{elements:[{id:'before-loss',text:'Keep the captured original'}]});
  const input=await capture(t,{text:'Keep this exact uncertain native request',intent:'discuss',automaticRequired:true});bridge.loseReceipt=true;
  const uncertain=(await call(t,'/api/chat',input)).messages[0];assert.equal(uncertain.delivery,'uncertain');assert.equal(bridge.receipts.size,1);assert.equal(bridge.notifyCount,1);
  bridge.offline=true;bridge.owner.close(1006);await wait(async()=>(await call(t,'/api/connection')).connected===false);
  const offlineElement={id:'saved-offline',type:'rectangle',x:10,y:20,width:40,height:40};await call(t,'/api/board',{changes:[{id:offlineElement.id,expectedVersion:0,element:offlineElement}]},'PATCH');const offlineBoard=await call(t,'/api/board');
  t.close();t=await createBrowserTransport(config);await t.ready();await t.bridgeStatus();
  assert.deepEqual(await call(t,'/api/board'),offlineBoard);assert.deepEqual((await call(t,'/api/chat')).messages,[uncertain]);assert.equal(bridge.notifyCount,1);assert.equal(bridge.token,token);
  bridge.offline=false;await wait(()=>bridge.owner?.readyState===1);await wait(async()=>(await call(t,'/api/connection')).connected===true);
  const recovered=await call(t,'/api/connection');for(const key of ['id','boardId','deliveryMode','messageExpiresAt','reviewExpiresAt'])assert.equal(recovered[key],identity[key]);
  assert.deepEqual(await call(t,'/api/board'),offlineBoard);assert.deepEqual((await call(t,'/api/chat')).messages,[uncertain]);assert.equal(bridge.notifyCount,1,'returning online does not notify or replay the uncertain effect');
  assert.equal(bridge.requests.filter(request=>new URL(request.url).pathname==='/browser/pair').length,1,'recovery reuses the original board grant');
  const retry=(await call(t,'/api/chat/retry',{id:input.id})).messages[0];assert.equal(retry.id,input.id);assert.equal(retry.receipt,`evt_chat_${input.id}`);assert.equal(bridge.receipts.size,1,'an explicit original-ID retry resolves the already accepted receipt');
  const read=await bridge.command('read_chat_message',{id:input.id});assert.equal(read.result.board.revision,input.expectedRevision);assert.equal(read.result.board.elements.some(element=>element.id==='saved-offline'),false);assert.equal(read.result.board.visual.dataURL,png);
  await bridge.command('reply_to_chat_message',{id:input.id,text:'The actual saved capture survived the outage.'});assert.equal((await call(t,'/api/chat')).messages[0].reply,'The actual saved capture survived the outage.');assert.deepEqual(await call(t,'/api/board'),offlineBoard);
 }finally{t.close();}
});

test('website pairing preserves the selected plugin mode through browser storage to the relay',async()=>{
 for(const input of [
  {provider:'codex',permission:'edit',mode:'codex-channel'},
  {provider:'claude-code',permission:'read',mode:'claude-channel'},
  {provider:'codex',permission:'read',mode:'remote-mcp'},
  {provider:'chatgpt',permission:'edit'},
 ]){
  const requests=[],sessionId=crypto.randomUUID(),connectionCode=`${sessionId}.${'a'.repeat(64)}`;
  const transport=await createBrowserTransport({indexedDB:new IDBFactory(),dbName:crypto.randomUUID(),origin:'https://sharedboard.app',BroadcastChannel:null,bridgeWebSocket:null,bridgeFetch:async(url,options)=>{
   const path=new URL(url).pathname,body=JSON.parse(options.body??'{}');requests.push({path,body});assert.equal(path,'/browser/pair');
   const setup=body.mode==='codex-channel'?codexChannelSetup({connectionCode}):body.mode==='claude-channel'?claudeChannelSetup({connectionCode}):{kind:'remote-mcp',url:'https://connect.sharedboard.app/mcp',prompt:'Remote connector instructions'};
   return Response.json({browserToken:'isolated-browser-grant',sessionId,connection:{id:sessionId,boardId:body.boardId,provider:body.provider,permission:body.permission,deliveryMode:body.mode??'remote-mcp',connected:false,automaticMessages:false,channelVerified:false},pairing:{code:connectionCode,expiresAt:new Date(Date.now()+60000).toISOString()},setup});
  }});
  try{
   const board=await call(transport,'/api/board'),planning=await call(transport,'/api/planning');
   const prepared=await call(transport,'/api/connection/pairing',input);
   assert.equal(requests.length,1);assert.deepEqual(requests[0].body,{boardId:board.id,title:planning.project.title,provider:input.provider,permission:input.permission,...(input.mode===undefined?{}:{mode:input.mode}),clientId:requests[0].body.clientId});
   assert.ok(requests[0].body.clientId);assert.equal(prepared.setup.kind,input.mode??'remote-mcp');
   if(input.mode==='codex-channel'){assert.equal(prepared.setup.installCommand,'codex plugin add sharedboard@sharedboard');assert.match(prepared.setup.connectPrompt,/actual CODEX_THREAD_ID/);assert.equal(prepared.setup.url,undefined);}
   if(input.mode==='claude-channel'){assert.match(prepared.setup.connectCommand,/^\/sharedboard:connect /);assert.match(prepared.setup.startCommand,/--dangerously-load-development-channels/);}
   const connection=await call(transport,'/api/connection');assert.equal(connection.deliveryMode,input.mode??'remote-mcp');assert.equal(connection.automaticMessages,false,'preparing plugin instructions must not enable unverified delivery');assert.equal(connection.channelVerified,false);
  }finally{transport.close();}
 }
});

test('Claude Code pairing uses the shared provider registry and invalid choices cannot replace a grant',async()=>{
 const boardId=crypto.randomUUID(),sessionId=crypto.randomUUID(),requests=[],saves=[];let state=null,loads=0;
 const bridge=createBrowserBridge({boardId,clientId:'browser-tab',WebSocket:null,load:async()=>{loads++;return state;},save:async value=>{saves.push(value);state=value;return true;},fetch:async(url,options)=>{
  requests.push(new URL(url).pathname);assert.equal(requests.at(-1),'/browser/pair');
  assert.deepEqual(JSON.parse(options.body),{boardId,title:'Code planning board',provider:'claude-code',permission:'read',clientId:'browser-tab'});
  return Response.json({browserToken:'claude-code-browser-grant',sessionId,connection:{id:sessionId,boardId,provider:'claude-code',connected:false,permission:'read'},pairing:{code:'test-pairing-code'},setup:{prompt:'Pair the Claude Code session'}});
 }});
 try{
  const paired=await bridge.pair({provider:'claude-code',permission:'read'},'Code planning board');assert.equal(paired.setup.prompt,'Pair the Claude Code session');
  const saved=state,loaded=loads;
  for(const provider of ['unknown','__proto__',null,{},['codex']])await assert.rejects(bridge.pair({provider,permission:'edit'},'Code planning board'),/Choose an AI client/);
  await assert.rejects(bridge.pair({provider:'claude-code',permission:'owner'},'Code planning board'),/Choose an AI client/);
  for(const [provider,mode] of [['codex','claude-channel'],['claude-code','codex-channel'],['chatgpt','codex-channel'],['codex','unknown']])await assert.rejects(bridge.pair({provider,permission:'read',mode},'Code planning board'),error=>error.code==='INVALID_CONNECTION_MODE');
  assert.deepEqual(requests,['/browser/pair']);assert.equal(saves.length,1);assert.equal(state,saved);assert.equal(loads,loaded,'invalid choices must not even load or disconnect the existing grant');
 }finally{bridge.close();}
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
