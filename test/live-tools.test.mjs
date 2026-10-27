import test from 'node:test';
import assert from 'node:assert/strict';
import {McpServer,createMcpHandler,PROTOCOL_VERSION_META_KEY,CLIENT_INFO_META_KEY,CLIENT_CAPABILITIES_META_KEY} from '@modelcontextprotocol/server';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {attachLiveTools} from '../cloudflare/live-tools.mjs';
import {handleRequest} from '../cloudflare/worker.mjs';

const origin='https://connect.sharedboard.app/mcp';
const sessionId='11111111-1111-4111-8111-111111111111',boardId='22222222-2222-4222-8222-222222222222',connectionId='33333333-3333-4333-8333-333333333333',requestId='44444444-4444-4444-8444-444444444444';
const request={id:requestId,kind:'chat',intent:'discuss'};
const value=changes=>({sessionId,boardId,connectionId,status:'timeout',requests:[],expiresAt:'2026-10-27T12:20:00.000Z',...changes});
const fixture=callback=>{
 const registered=new Map(),calls=[];
 const mcp={registerTool:(name,config,handler)=>registered.set(name,{config,handler}),registerResource:()=>assert.fail('The synchronous wait tool must not register a UI resource')};
 attachLiveTools(mcp,async(operation,input)=>{calls.push({operation,input});return callback?callback(operation,input):value();});
 const tool=registered.get('wait_for_board_request');
 return {registered,calls,...tool,call:input=>tool.handler(tool.config.inputSchema.parse(input))};
};

test('the plain wait tool requires explicit finite live collaboration and never advertises an idle wake or iframe',()=>{
 const f=fixture();assert.equal(f.registered.size,1);
 assert.equal(f.config._meta,undefined);assert.deepEqual(f.config.annotations,{readOnlyHint:false,destructiveHint:false,openWorldHint:false});
 assert.match(f.config.description,/only when the user explicitly asks/);
 assert.match(f.config.description,/cannot wake an idle conversation/);assert.match(f.config.description,/hard 20-minute limit/);
 assert.match(f.config.description,/On stopped, expired, or an error, end the live loop; never restart automatically/);
 assert.match(f.config.description,/Discuss and every review allow inspection only/);
 assert.match(f.config.description,/read_chat_message or read_review_request/);assert.match(f.config.description,/reply_to_chat_message/);assert.match(f.config.description,/complete_review_request/);
 assert.match(f.config.description,/Do not create another conversation/);
});

test('wait input is bounded, defaults to forty seconds, and preserves the exact resumed session ID',async()=>{
 const f=fixture();await f.call({});assert.deepEqual(f.calls[0],{operation:'wait',input:{waitMs:40_000}});
 for(const waitMs of [1,45_000])await f.call({sessionId,waitMs});
 assert.deepEqual(f.calls.at(-1),{operation:'wait',input:{sessionId,waitMs:45_000}});
 for(const input of [{waitMs:0},{waitMs:45_001},{waitMs:1.2},{waitMs:'40000'},{sessionId:'guess'},{sessionId:null},{extra:true}])assert.equal(f.config.inputSchema.safeParse(input).success,false);
});

test('only request routing metadata is returned, without private captures, message text, receipts or success claims',async()=>{
 const secret='private-browser-owner-key',f=fixture(()=>value({status:'request',requests:[{...request,text:secret,visual:secret}],browserToken:secret,capturedBoard:{text:secret},received:true,reply:secret}));
 const result=await f.call({sessionId});
 assert.deepEqual(result.structuredContent,value({status:'request',requests:[request]}));
 assert.equal(result.content.length,1);assert.equal(result.content[0].type,'text');
 assert.equal(JSON.stringify(result).includes(secret),false);
 for(const field of ['automaticMessages','delivered','received','reply','visual','browserToken'])assert.equal(Object.hasOwn(result.structuredContent,field),false);
 assert.equal(result._meta,undefined,'there are no app capabilities, tokens or UI resources');
});

test('normal empty, stopped and expired results remain distinct and cannot start another session',async()=>{
 for(const status of ['timeout','stopped','expired']){
  const f=fixture(()=>value({status})),result=await f.call({sessionId});
  assert.equal(result.isError,undefined);assert.equal(result.structuredContent.status,status);assert.deepEqual(result.structuredContent.requests,[]);
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].input.sessionId,sessionId);
 }
});

test('invalid, cross-session, and failed backend results fail closed without exposing error details',async()=>{
 const secret='secret-test-token-never-return';
 for(const callback of [
  ()=>{throw Object.assign(new Error(secret),{status:403,code:secret});},
  ()=>value({sessionId:'55555555-5555-4555-8555-555555555555'}),
  ()=>value({status:'request',requests:[]}),
  ()=>value({status:'timeout',requests:[request]}),
  ()=>value({status:'request',requests:[request,request]}),
  ()=>value({status:'request',requests:[{...request,kind:'review',intent:'work'}]}),
  ()=>value({expiresAt:secret}),
 ]){
  const f=fixture(callback),result=await f.call({sessionId});
  assert.equal(result.isError,true);assert.equal(result.structuredContent,undefined);assert.equal(JSON.stringify(result).includes(secret),false);
  assert.match(result.content[0].text,/Do not restart the session or replay requests automatically/);assert.equal(f.calls.length,1);
 }
});

test('actual MCP SDK legacy and current MCP 2 envelopes discover and call a normal non-UI waiting tool',async()=>{
 const calls=[],handler=createMcpHandler(()=>attachLiveTools(new McpServer({name:'sharedboard-live-tools-test',version:'test'}),async(operation,input)=>{calls.push({operation,input});return value();}));
 const client=new Client({name:'isolated-live-tools-client',version:'1'});
 try{
  await client.connect(new StreamableHTTPClientTransport(new URL(origin),{fetch:(input,init)=>handler.fetch(new Request(input,init))}));
  const listed=await client.listTools(),tool=listed.tools.find(item=>item.name==='wait_for_board_request');
  assert.ok(tool);assert.equal(tool._meta,undefined);assert.equal(tool.annotations.destructiveHint,false);assert.equal(tool.annotations.openWorldHint,false);
  assert.equal(tool.inputSchema.properties.waitMs.maximum,45_000);assert.equal(tool.inputSchema.properties.waitMs.default,40_000);
  const first=await client.callTool({name:'wait_for_board_request',arguments:{}});assert.deepEqual(first.structuredContent,value());assert.deepEqual(calls.at(-1),{operation:'wait',input:{waitMs:40_000}});
  const resumed=await client.callTool({name:'wait_for_board_request',arguments:{sessionId,waitMs:1}});assert.deepEqual(resumed.structuredContent,value());assert.deepEqual(calls.at(-1),{operation:'wait',input:{sessionId,waitMs:1}});
  const before=calls.length;
  for(const input of [{waitMs:45_001},{sessionId:'wrong'},{extra:true}])assert.equal((await client.callTool({name:'wait_for_board_request',arguments:input})).isError,true);
  assert.equal(calls.length,before,'bad tool input must never reach the relay');
  const rpc=async(method,params={})=>{
   const response=await handler.fetch(new Request(origin,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2026-07-28','mcp-method':method,...(params.name?{'mcp-name':params.name}:{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params:{...params,_meta:{[PROTOCOL_VERSION_META_KEY]:'2026-07-28',[CLIENT_INFO_META_KEY]:{name:'live-mcp2-tests',version:'1'},[CLIENT_CAPABILITIES_META_KEY]:{}}}})}));
   const text=await response.text(),data=text.trim().startsWith('{')?JSON.parse(text):JSON.parse(text.split('\n').find(line=>line.startsWith('data: '))?.slice(6)??'null');
   assert.equal(response.status,200,JSON.stringify(data));assert.equal(data.error,undefined,JSON.stringify(data));return data.result;
  };
  const modernListed=await rpc('tools/list');assert.equal(modernListed.tools.length,1);assert.equal(modernListed.tools[0]._meta,undefined);
  const modern=await rpc('tools/call',{name:'wait_for_board_request',arguments:{sessionId,waitMs:2}});assert.deepEqual(modern.structuredContent,value());assert.deepEqual(calls.at(-1),{operation:'wait',input:{sessionId,waitMs:2}});
 }finally{await client.close();await handler.close();}
});

test('the Worker routes a bounded wait with its authorization and abort signal, and protects browser stop',async()=>{
 const grant={sessionId:connectionId,boardId,clientId:'isolated-live-client',familyId:'55555555-5555-4555-8555-555555555555',scope:'board.read'},requests=[];
 let received,waitingRequest;const dispatched=new Promise(resolve=>{received=resolve;});
 const stub={async fetch(request){
  const path=new URL(request.url).pathname,input=await request.json();requests.push({path,input});
  if(path==='/agent/check')return Response.json({connection:{provider:'claude',connected:true}});
  if(path==='/agent/live'){
   waitingRequest=request;received();
   return new Promise(resolve=>{const finish=()=>resolve(Response.json(value({status:'stopped'})));if(request.signal.aborted)finish();else request.signal.addEventListener('abort',finish,{once:true});});
  }
  if(path==='/browser/live/stop'){assert.match(request.headers.get('x-sharedboard-browser'),new RegExp('^'+connectionId+'\\.'));return Response.json({stopped:true});}
  assert.fail('Unexpected relay path: '+path);
 }};
 const env={RELAY_AUTH:{idFromName:name=>name,get:()=>({fetch:async()=>Response.json(grant)})},BOARD_RELAY:{idFromName:id=>id,get:id=>{assert.equal(id,connectionId);return stub;}}};
 const controller=new AbortController(),method='tools/call',params={name:'wait_for_board_request',arguments:{sessionId,waitMs:5},_meta:{[PROTOCOL_VERSION_META_KEY]:'2026-07-28',[CLIENT_INFO_META_KEY]:{name:'worker-live-tests',version:'1'},[CLIENT_CAPABILITIES_META_KEY]:{}}};
 const pending=handleRequest(new Request(origin,{method:'POST',signal:controller.signal,headers:{authorization:'Bearer '+'a'.repeat(64),'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2026-07-28','mcp-method':method,'mcp-name':'wait_for_board_request'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}),env);
 await dispatched;assert.deepEqual(requests.find(item=>item.path==='/agent/live').input,{grant,operation:'wait',input:{sessionId,waitMs:5}});
 assert.equal(waitingRequest.signal.aborted,false);controller.abort();assert.equal(waitingRequest.signal.aborted,true);await pending;
 const browserToken=connectionId+'.'+'b'.repeat(64),stop=(method,site='https://sharedboard.app')=>handleRequest(new Request('https://connect.sharedboard.app/browser/live/stop',{method,headers:{origin:site,'x-sharedboard-browser':browserToken,...(method==='POST'?{'content-type':'application/json'}:{})},...(method==='POST'?{body:JSON.stringify({sessionId})}:{})}),env);
 const stopped=await stop('POST');assert.equal(stopped.status,200);assert.equal((await stopped.json()).stopped,true);
 assert.equal((await stop('GET')).status,405);assert.equal((await stop('POST','https://other.example')).status,403);
});
