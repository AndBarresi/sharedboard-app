import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {McpServer,createMcpHandler,PROTOCOL_VERSION_META_KEY,CLIENT_INFO_META_KEY,CLIENT_CAPABILITIES_META_KEY} from '@modelcontextprotocol/server';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {attachChatPanel,CHAT_PANEL_URI,CHAT_PANEL_HTML} from '../cloudflare/chat-panel.mjs';

const boardId='22222222-2222-4222-8222-222222222222';
const connectionId='33333333-3333-4333-8333-333333333333';
const messageId='44444444-4444-4444-8444-444444444444';
const viewKey='a'.repeat(64),serverURL='https://connect.sharedboard.app/mcp';
const opened={viewKey,boardId,connectionId,label:'Isolated test board',permission:'read'};
const metadata={sharedboardPanel:{viewKey,boardId,connectionId}};
const state=changes=>({linked:false,boardId,connectionId,label:opened.label,permission:'read',pending:[],expiresAt:Date.now()+30_000,...changes});
const entry=changes=>({id:messageId,kind:'chat',intent:'discuss',status:'pending',delivery:'panel',...changes});
const appTools=['panel_state','panel_attach','panel_detach','panel_claim','panel_confirm'];
const script=CHAT_PANEL_HTML.match(/<script type="module">([\s\S]*)<\/script>/)?.[1];

function registered(options={}){
 const tools=new Map(),resources=new Map(),calls=[];
 const mcp={registerResource:(name,uri,config,callback)=>resources.set(uri,{name,config,callback}),registerTool:(name,config,callback)=>tools.set(name,{config,callback})};
 attachChatPanel(mcp,async(operation,input)=>{calls.push({operation,input});return operation==='open'?opened:state();},{serverURL,...options});
 return {tools,resources,calls};
}

test('only the host metadata receives the opaque panel capability, and app tools require it',async()=>{
 const f=registered(),result=await f.tools.get('open_sharedboard_chat').callback({});
 assert.equal(f.tools.size,6);
 assert.deepEqual(result._meta.sharedboardPanel,metadata.sharedboardPanel);
 assert.equal(result.structuredContent.automaticMessages,false);assert.equal(result.structuredContent.diagnosticOnly,true);
 assert.match(result.content[0].text,/unavailable/);assert.match(result.content[0].text,/fill a draft without submitting/);assert.doesNotMatch(result.content[0].text,/Click Link/);
 assert.equal(JSON.stringify({content:result.content,structuredContent:result.structuredContent}).includes(viewKey),false);
 assert.deepEqual(f.tools.get('open_sharedboard_chat').config._meta.ui,{resourceUri:CHAT_PANEL_URI});
 for(const name of appTools){
  const {config}=f.tools.get(name);
  assert.deepEqual(config._meta.ui.visibility,['app']);
  assert.equal(config.inputSchema.safeParse({}).success,false);
  assert.equal(config.inputSchema.safeParse({viewKey:'too-short'}).success,false);
 }
 const claim=f.tools.get('panel_claim');
 assert.equal(claim.config.inputSchema.safeParse({viewKey,id:messageId,kind:'chat'}).success,true);
 assert.equal(claim.config.inputSchema.safeParse({viewKey,id:'invented',kind:'chat'}).success,false);
 assert.equal(claim.config.inputSchema.safeParse({viewKey,id:messageId,kind:'other'}).success,false);
 await claim.callback({viewKey,id:messageId,kind:'chat'});
 assert.deepEqual(f.calls.at(-1),{operation:'claim',input:{viewKey,id:messageId,kind:'chat'}});
});

test('the resource is self-contained, with the exact documented Claude origin and no remote SDK',async()=>{
 for(const provider of ['claude','claude-code',async()=>'claude']){
  const f=registered({provider}),resource=await f.resources.get(CHAT_PANEL_URI).callback(new URL(CHAT_PANEL_URI));
  const content=resource.contents[0];
  assert.equal(content.uri,CHAT_PANEL_URI);
  assert.equal(content.mimeType,'text/html;profile=mcp-app');
  assert.equal(content._meta.ui.domain,createHash('sha256').update(serverURL).digest('hex').slice(0,32)+'.claudemcpcontent.com');
  assert.deepEqual(content._meta.ui.csp,{connectDomains:[],resourceDomains:[]});
  assert.equal(content.text,CHAT_PANEL_HTML);
 }
 const f=registered({provider:'codex'}),resource=await f.resources.get(CHAT_PANEL_URI).callback(new URL(CHAT_PANEL_URI));
 assert.equal(Object.hasOwn(resource.contents[0]._meta.ui,'domain'),false,'Claude-specific domain metadata must not be sent for other hosts');
 assert.doesNotMatch(CHAT_PANEL_HTML,/<script[^>]+src=|\bfetch\s*\(|new\s+WebSocket\s*\(/i);
 assert.ok(script);
 assert.doesNotThrow(()=>new Function('return (async()=>{'+script+'})()'));
});

test('the MCP 2.4 SDK preserves app visibility and hidden result metadata through its actual transport',async()=>{
 const operations=[];
 const handler=createMcpHandler(()=>attachChatPanel(new McpServer({name:'sharedboard-panel-sdk-test',version:'test'}),async(operation,input)=>{operations.push({operation,input});return operation==='open'?opened:state();}));
 const client=new Client({name:'isolated-panel-sdk-test',version:'1'});
 try{
  await client.connect(new StreamableHTTPClientTransport(new URL(serverURL),{fetch:(input,init)=>handler.fetch(new Request(input,init))}));
  const {tools}=await client.listTools();
  for(const name of appTools)assert.deepEqual(tools.find(tool=>tool.name===name)?._meta.ui.visibility,['app']);
  const result=await client.callTool({name:'open_sharedboard_chat',arguments:{}});
  assert.deepEqual(result._meta.sharedboardPanel,metadata.sharedboardPanel);
  assert.equal(JSON.stringify({content:result.content,structuredContent:result.structuredContent}).includes(viewKey),false);
  const before=operations.length,rejected=await client.callTool({name:'panel_attach',arguments:{}});
  assert.equal(rejected.isError,true);
  assert.equal(operations.length,before,'schema rejection must happen before the backend callback');
  // The SDK client initially negotiates the legacy protocol. Also exercise the
  // current MCP 2.0 per-request envelope so metadata cannot silently disappear.
  const request=async(method,params={})=>{
   const response=await handler.fetch(new Request(serverURL,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2026-07-28','mcp-method':method,...(params.name?{'mcp-name':params.name}:{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params:{...params,_meta:{[PROTOCOL_VERSION_META_KEY]:'2026-07-28',[CLIENT_INFO_META_KEY]:{name:'panel-mcp2-tests',version:'1'},[CLIENT_CAPABILITIES_META_KEY]:{}}}})}));
   const text=await response.text(),result=text.trim().startsWith('{')?JSON.parse(text):JSON.parse(text.split('\n').find(line=>line.startsWith('data: '))?.slice(6)??'null');
   assert.equal(response.status,200,JSON.stringify(result));assert.equal(result.error,undefined,JSON.stringify(result));return result.result;
  };
  const listed=await request('tools/list');
  for(const name of appTools)assert.deepEqual(listed.tools.find(tool=>tool.name===name)?._meta.ui.visibility,['app']);
  const modern=await request('tools/call',{name:'open_sharedboard_chat',arguments:{}});
  assert.deepEqual(modern._meta.sharedboardPanel,metadata.sharedboardPanel);
  assert.equal(JSON.stringify({content:modern.content,structuredContent:modern.structuredContent}).includes(viewKey),false);
 }finally{await client.close();await handler.close();}
});

// This is a protocol-only host double. It does not operate a browser or contact
// an AI provider. Text support never establishes automatic turn submission.
async function host(options={}){
 const elements=new Map(),listeners=new Map(),timers=new Map(),sent=[];let serial=0,intervals=0;
 const element=id=>{if(!elements.has(id))elements.set(id,{textContent:'',hidden:false,disabled:false,onclick:null});return elements.get(id);};
 const flush=()=>new Promise(resolve=>setImmediate(resolve));
 const emit=message=>listeners.get('message')?.({source:parent,data:{jsonrpc:'2.0',...message}});
 const reply=(id,result,error)=>queueMicrotask(()=>emit({id,...(error?{error}:{result})}));
 const parent={postMessage:message=>{sent.push(message);if(message.method==='ui/initialize'&&!options.deferInitialize)reply(message.id,{hostCapabilities:options.capabilities??{message:{text:{}}}});}};
 const window={parent,addEventListener:(name,callback)=>listeners.set(name,callback)};
 const context={window,document:{getElementById:element},setTimeout:(callback,delay)=>{const id=++serial;timers.set(id,{callback,delay});return id;},clearTimeout:id=>timers.delete(id),setInterval:()=>{intervals++;return intervals;},clearInterval:()=>{}};
 const running=vm.runInNewContext('(async()=>{'+script+'})()',context);
 if(!options.deferInitialize)await running;
 emit({method:'ui/notifications/tool-result',params:{_meta:metadata,structuredContent:opened}});await flush();
 return {sent,element,flush,running,emit,
  count:method=>sent.filter(message=>message.method===method).length,
  toolCalls:()=>sent.filter(message=>message.method==='tools/call'),
  intervalCount:()=>intervals,
  async link(){await element('link').onclick?.();await flush();},
  async close(id='teardown-request'){emit({id,method:'ui/resource-teardown',params:{}});await flush();await running;},
  async foreign(message){listeners.get('message')({source:{},data:{jsonrpc:'2.0',...message}});await flush();},
  async initialize(){const request=sent.find(message=>message.method==='ui/initialize');reply(request.id,{hostCapabilities:{message:{text:{}}}});await running;await flush();},
 };
}

test('advertised text messaging leaves the panel diagnostic only, without attach, polling, claim, send or replay',async()=>{
 const h=await host();
 assert.equal(h.element('link').disabled,true);
 assert.match(h.element('status').textContent,/Text messaging advertised.*automatic sending unavailable/);
 assert.match(h.element('detail').textContent,/draft instead of a model turn/);
 await h.link();
 h.emit({method:'ui/notifications/tool-result',params:{_meta:metadata,structuredContent:{...opened,linked:true,pending:[entry()]}}});await h.flush();
 assert.equal(h.toolCalls().length,0,'no state heartbeat may renew an old panel lease');
 assert.equal(h.intervalCount(),0);
 assert.equal(h.count('ui/message'),0);
 assert.equal(h.count('ui/notifications/initialized'),1);
 await h.close();assert.ok(h.sent.some(message=>message.id==='teardown-request'&&message.result));
});

test('missing text capabilities cannot enable automatic mini chat or forwarding',async()=>{
 for(const capabilities of [{},{message:{}},{message:{text:true}},{message:{text:null}}]){
  const h=await host({capabilities});await h.link();
  assert.equal(h.element('link').disabled,true);assert.match(h.element('status').textContent,/text support not advertised/);
  assert.equal(h.toolCalls().length,0);assert.equal(h.count('ui/message'),0);
 }
});

test('a host teardown ID colliding with initialization is handled as a host request, never an RPC response',async()=>{
 const h=await host({deferInitialize:true}),initial=h.sent.find(message=>message.method==='ui/initialize');
 assert.ok(initial);await h.close(initial.id);
 assert.equal(h.count('ui/notifications/initialized'),0);
 assert.equal(h.toolCalls().length,0);assert.equal(h.count('ui/message'),0);
 assert.equal(h.sent.filter(message=>message.id===initial.id&&message.method===undefined&&Object.hasOwn(message,'result')).length,1);
 await h.initialize();assert.equal(h.count('ui/notifications/initialized'),0,'a late response cannot revive disposed diagnostics');
});

test('bare IDs, method-bearing envelopes, mixed responses and foreign windows cannot settle initialization',async()=>{
 const h=await host({deferInitialize:true}),{id}=h.sent.find(message=>message.method==='ui/initialize');
 h.emit({id});h.emit({id,method:'host/request',result:{hostCapabilities:{message:{text:{}}}}});
 h.emit({id,result:{},error:{message:'Invalid mixed response'}});
 await h.foreign({id,result:{hostCapabilities:{message:{text:{}}}}});
 assert.equal(h.count('ui/notifications/initialized'),0);
 await h.initialize();assert.equal(h.count('ui/notifications/initialized'),1);
 assert.equal(h.element('link').disabled,true);assert.equal(h.toolCalls().length,0);assert.equal(h.count('ui/message'),0);
});
