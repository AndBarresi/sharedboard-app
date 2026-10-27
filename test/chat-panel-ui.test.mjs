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

// This is a protocol-only host double. It does not operate a browser, contact a
// provider, or prove that an actual AI app starts a model turn after ui/message.
async function host(options={}){
 const elements=new Map(),listeners=new Map(),timers=new Map(),intervals=new Map();
 const sent=[],toolCalls=[],timeline=[];let serial=0,linked=Boolean(options.priorLease),pendingMessage=null;
 const current={...state(),pending:[entry()],...options.state};
 const element=id=>{if(!elements.has(id))elements.set(id,{textContent:'',hidden:false,disabled:false,onclick:null});return elements.get(id);};
 const flush=()=>new Promise(resolve=>setImmediate(resolve));
 const reply=(id,result,error)=>queueMicrotask(()=>listeners.get('message')?.({source:parent,data:{jsonrpc:'2.0',id,...(error?{error}:{result})}}));
 const parent={postMessage:message=>{
  sent.push(message);timeline.push(message.method??'response');
  if(message.id===undefined)return;
  if(message.method==='ui/initialize'){reply(message.id,{hostCapabilities:options.capabilities??{message:{text:{}}}});return;}
  if(message.method==='ui/message'){
   pendingMessage=message;
   if(options.ack==='defer')return;
   if(options.ack==='error'){reply(message.id,undefined,{code:-32603,message:'Host refused this message'});return;}
   reply(message.id,options.ack==='decline'?{isError:true}:options.ack==='missing'?undefined:{});return;
  }
  if(message.method!=='tools/call')return;
  const {name,arguments:input}=message.params;toolCalls.push({name,input});
  assert.equal(input.viewKey,viewKey);
  if(name==='panel_attach')linked=true;
  if(name==='panel_detach')linked=false;
  const result=name==='panel_claim'?{receipt:'receipt-'+input.id,prompt:'Read the saved Discuss request with read_chat_message; do not change the drawing.'}:{...current,linked};
  reply(message.id,{structuredContent:result});
 }};
 const window={parent,addEventListener:(name,callback)=>listeners.set(name,callback)};
 const context={window,document:{getElementById:element},setTimeout:(callback,delay)=>{const id=++serial;timers.set(id,{callback,delay});return id;},clearTimeout:id=>timers.delete(id),setInterval:(callback,delay)=>{const id=++serial;intervals.set(id,{callback,delay});return id;},clearInterval:id=>intervals.delete(id)};
 await vm.runInNewContext('(async()=>{'+script+'})()',context);
 const notify=(params,source=parent)=>listeners.get('message')({source,data:{jsonrpc:'2.0',method:'ui/notifications/tool-result',params}});
 notify({_meta:metadata});await flush();
 return {
  sent,toolCalls,timeline,current,element,flush,
  count:name=>toolCalls.filter(call=>call.name===name).length,
  messages:()=>sent.filter(message=>message.method==='ui/message'),
  async link(){await element('link').onclick();await flush();},
  async poll(){for(const {callback} of intervals.values())callback();await flush();},
  async acknowledge(result={}){assert.ok(pendingMessage);reply(pendingMessage.id,result);await flush();},
  async hostMessage(message){listeners.get('message')({source:parent,data:{jsonrpc:'2.0',...message}});await flush();},
  async expireRequest(){for(const [id,{callback,delay}] of [...timers])if(delay===20_000){timers.delete(id);callback();}await flush();},
  async notify(params){notify(params);await flush();},
  async foreignNotify(params){notify(params,{});await flush();},
  async close(id='teardown-request'){listeners.get('message')({source:parent,data:{jsonrpc:'2.0',id,method:'ui/resource-teardown',params:{}}});await flush();},
  intervalCount:()=>intervals.size,
 };
}

test('forwarding requires an explicit link, makes one claim, and waits for host acknowledgement before confirmation',async()=>{
 const h=await host({ack:'defer'});
 assert.equal(h.count('panel_attach'),0);assert.equal(h.count('panel_claim'),0);assert.equal(h.messages().length,0);
 await h.link();
 assert.equal(h.count('panel_attach'),1);assert.equal(h.count('panel_claim'),1);assert.equal(h.messages().length,1);assert.equal(h.count('panel_confirm'),0);
 assert.equal(h.messages()[0].params.role,'user');
 assert.match(h.messages()[0].params.content[0].text,/Discuss/);
 const heartbeats=h.count('panel_state');await h.poll();
 assert.ok(h.count('panel_state')>heartbeats,'lease heartbeats continue while the host message awaits acknowledgement');
 assert.equal(h.count('panel_claim'),1);
 await h.acknowledge({});
 assert.equal(h.count('panel_confirm'),1,'the documented empty success object is a valid acknowledgement');
 assert.deepEqual(structuredClone(h.toolCalls.find(call=>call.name==='panel_confirm').input),{viewKey,receipt:'receipt-'+messageId});
 await h.poll();await h.poll();
 assert.equal(h.messages().length,1,'even a stale repeated queue entry must not be forwarded twice');
 assert.equal(h.count('panel_claim'),1);assert.equal(h.count('panel_confirm'),1);
 await h.close();assert.equal(h.count('panel_detach'),1);assert.equal(h.intervalCount(),0);
 assert.ok(h.sent.some(message=>message.id==='teardown-request'&&message.result));
});

test('a remounted panel does not renew an earlier lease until this instance is explicitly linked',async()=>{
 const h=await host({priorLease:true});
 await h.poll();await h.poll();await h.poll();
 assert.equal(h.count('panel_state'),0,'even a previously linked view must not heartbeat before a fresh Link click');
 assert.equal(h.count('panel_attach'),0);assert.equal(h.count('panel_claim'),0);assert.equal(h.messages().length,0);
 await h.link();
 assert.equal(h.count('panel_attach'),1);assert.ok(h.count('panel_state')>0);assert.equal(h.messages().length,1);
});

test('only a response envelope with result or error can settle an in-flight app RPC',async()=>{
 const h=await host({ack:'defer'});await h.link();const {id}=h.messages()[0];
 await h.hostMessage({id});
 await h.hostMessage({id,method:'host/request',result:{}});
 await h.hostMessage({id,result:{},error:{message:'Invalid mixed response'}});
 assert.equal(h.count('panel_confirm'),0);assert.equal(h.count('panel_detach'),0);
 await h.acknowledge({});assert.equal(h.count('panel_confirm'),1);
});

test('a host teardown with the same ID as an in-flight app request closes the panel instead of resolving that request',async()=>{
 const h=await host({ack:'defer'});await h.link();
 const message=h.messages()[0];assert.ok(message);assert.equal(h.count('panel_confirm'),0);
 await h.close(message.id);
 assert.equal(h.intervalCount(),0,'the host request must run teardown even when its ID collides with an app request');
 assert.equal(h.count('panel_detach'),1);
 assert.equal(h.count('panel_confirm'),0,'teardown is never a successful ui/message acknowledgement');
 const responses=h.sent.filter(item=>item.id===message.id&&item.method===undefined&&Object.hasOwn(item,'result'));
 assert.equal(responses.length,1,'the independent host teardown request receives its own response');
 await h.acknowledge({});await h.poll();
 assert.equal(h.count('panel_confirm'),0,'a late host acknowledgement cannot reactivate the disposed panel');
 assert.equal(h.messages().length,1);
});

for(const ack of ['decline','error','missing','defer'])test(`a ${ack==='defer'?'timed-out':ack} host acknowledgement pauses, detaches, and never automatically retries`,async()=>{
 const h=await host({ack});await h.link();
 if(ack==='defer')await h.expireRequest();
 assert.equal(h.messages().length,1);assert.equal(h.count('panel_claim'),1);assert.equal(h.count('panel_confirm'),0);
 assert.equal(h.count('panel_detach'),1);assert.equal(h.element('status').textContent,'Forwarding paused');
 assert.match(h.element('error').textContent,/duplicate/);
 await h.poll();await h.poll();assert.equal(h.messages().length,1);assert.equal(h.count('panel_claim'),1);
 if(ack==='defer'){await h.acknowledge({});assert.equal(h.count('panel_confirm'),0,'a late response after timeout must not revive the request');}
});

test('hosts without an explicit text-message capability cannot attach or claim requests',async()=>{
 for(const capabilities of [{},{message:{}},{message:{text:true}},{message:{text:null}}]){
  const h=await host({capabilities});
  assert.equal(h.element('link').disabled,true);assert.match(h.element('status').textContent,/does not expose chat messaging/);
  await h.link();await h.poll();
  assert.equal(h.count('panel_attach'),0);assert.equal(h.count('panel_claim'),0);assert.equal(h.messages().length,0);
 }
});

test('queue entries for other delivery methods or non-pending statuses never trigger a claim',async()=>{
 for(const changes of [{delivery:'manual'},{delivery:'uncertain'},{delivery:'app'},{status:'reading'},{status:'answered'},{status:'reviewed'},{kind:'other'}]){
  const h=await host({state:{pending:[entry(changes)]}});await h.link();await h.poll();
  assert.equal(h.count('panel_claim'),0);assert.equal(h.messages().length,0);
 }
});

test('wrong board IDs, connection IDs, replacement metadata, and foreign windows cannot retarget forwarding',async()=>{
 for(const changes of [{boardId:'other-board'},{connectionId:'other-connection'}]){
  const h=await host({state:changes});await h.link();await h.poll();
  assert.equal(h.count('panel_claim'),0);assert.equal(h.messages().length,0);assert.match(h.element('error').textContent,/original board connection/);
 }
 const h=await host();
 await h.foreignNotify({_meta:{sharedboardPanel:{...metadata.sharedboardPanel,viewKey:'b'.repeat(64)}}});
 assert.doesNotMatch(h.element('status').textContent,/paused/i,'unrelated windows are ignored');
 await h.notify({_meta:{sharedboardPanel:{...metadata.sharedboardPanel,connectionId:'replacement'}}});
 assert.equal(h.element('status').textContent,'Forwarding paused');assert.match(h.element('error').textContent,/replaced this panel/);
 assert.equal(h.messages().length,0);
});
