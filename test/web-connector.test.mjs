import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {Client} from '@modelcontextprotocol/client';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {startServer} from '../server/index.mjs';
import {WebAuthorization} from '../server/web-auth.mjs';
import {ensureTunnelHelper} from '../server/tunnel.mjs';
import {WebConnector} from '../server/web-connector.mjs';
import {pairAgent} from './fixtures.mjs';

const verifier=()=>randomBytes(40).toString('base64url');
const challenge=value=>createHash('sha256').update(value).digest('base64url');
async function fixture(permission='edit',withExisting=false){
  const directory=mkdtempSync(path.join(os.tmpdir(),'sharedboard-web-'));
  let stopped=false;
  const app=await startServer({port:0,dataDir:directory,enableWebConnectors:true,startTunnel:async({url})=>({url,stop(){stopped=true;}})});
  const previous=withExisting?await pairAgent(app):null;
  const local=async(route,input)=>{const response=await fetch(`${app.url}/api/${route}`,{method:input===undefined?'GET':'POST',headers:{'content-type':'application/json','x-board-token':app.token},...(input===undefined?{}:{body:JSON.stringify(input)})});const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error),{status:response.status});return data;};
  await local('connection/web/start',{provider:'chatgpt-web',permission});await app.webConnector.ready;
  const origin=app.webConnector.publicOrigin;
  const remote=async(route,input,form=false)=>{const response=await fetch(`${origin}${route}`,{method:input===undefined?'GET':'POST',headers:{'content-type':form?'application/x-www-form-urlencoded':'application/json'},...(input===undefined?{}:{body:form?new URLSearchParams(input).toString():JSON.stringify(input)})});return response;};
  const authorize=async()=>{
    const client=await (await remote('/register',{client_name:'Test AI app',redirect_uris:['https://client.example/callback'],token_endpoint_auth_method:'none'})).json();
    const secret=verifier();const params={client_id:client.client_id,redirect_uri:client.redirect_uris[0],response_type:'code',code_challenge:challenge(secret),code_challenge_method:'S256',resource:`${origin}/mcp`,state:'keep-me'};
    const response=await remote(`/authorize?${new URLSearchParams(params)}`);assert.equal(response.status,200);
    const pending=(await local('connection')).web.pending.at(-1);assert.ok(pending.verification);
    await local('connection/web/approve',{id:pending.id,allow:true});
    const finished=await (await remote(`/oauth-status?id=${pending.id}`)).json(),redirect=new URL(finished.redirect);assert.equal(redirect.searchParams.get('state'),'keep-me');
    const exchange={grant_type:'authorization_code',client_id:client.client_id,redirect_uri:client.redirect_uris[0],code_verifier:secret,code:redirect.searchParams.get('code'),resource:`${origin}/mcp`};
    const tokens=await (await remote('/token',exchange,true)).json();assert.ok(tokens.access_token);return {tokens,exchange,client};
  };
  return {app,local,remote,origin,authorize,previous,get stopped(){return stopped;},async close(){await app.close();rmSync(directory,{recursive:true,force:true});}};
}

test('web connector requires explicit local approval, PKCE and exact callbacks; tokens revoke on stop without exposing the local API',async()=>{
  const f=await fixture('edit',true);
  try{
    const old=f.previous;const before=f.app.store.board.revision;
    assert.equal((await f.local('connection')).id,old.connection.id,'starting web setup preserves the existing AI');
    assert.equal((await f.remote('/api/session')).status,404);
    assert.equal((await f.remote('/mcp',{})).status,401);
    const protectedResource=await (await f.remote('/.well-known/oauth-protected-resource/mcp')).json();assert.equal(protectedResource.resource,`${f.origin}/mcp`);
    const {tokens,exchange}=await f.authorize();
    assert.equal((await f.remote('/token',exchange,true)).status,400,'a code is single use');
    const connection=await f.local('connection');assert.equal(connection.provider,'chatgpt-web');assert.equal(connection.boardCheckedAt,null);assert.equal(connection.web.chatOpen,false);
    const oldRead=await fetch(`${f.app.url}/api/agent/read`,{headers:{'x-board-token':f.app.token,'x-agent-key':old.agentKey}});assert.equal(oldRead.status,403);
    const unauthApprove=await fetch(`${f.origin}/api/connection/web/approve`,{method:'POST',body:'{}'});assert.equal(unauthApprove.status,404);
    await f.local('connection/web/stop',{});assert.ok(f.stopped);assert.equal((await f.local('connection')).connected,false);assert.equal(f.app.store.board.revision,before);
    assert.equal(f.app.webConnector.auth,null);
  }finally{await f.close();}
});

test('real HTTP MCP client opens an app, routes a captured mini chat once, edits with conflicts, and returns a real reply',async()=>{
  const f=await fixture(),client=new Client({name:'MCP Apps verification',version:'1.0.0'});
  try{
    const {tokens}=await f.authorize();
    await client.connect(new StreamableHTTPClientTransport(new URL(`${f.origin}/mcp`),{requestInit:{headers:{Authorization:`Bearer ${tokens.access_token}`}}}));
    const call=async(name,args={})=>client.callTool({name,arguments:args});
    const tools=await client.listTools();assert.ok(tools.tools.some(t=>t.name==='open_sharedboard'&&t._meta.ui.resourceUri));assert.ok(!tools.tools.some(t=>t.name==='connect_board'));
    const opened=await call('open_sharedboard');const viewKey=opened._meta.sharedboardView;assert.ok(viewKey);assert.ok(!JSON.stringify(opened.structuredContent).includes(viewKey));
    const app=await client.readResource({uri:'ui://sharedboard/chat-v1.html'});assert.match(app.contents[0].text,/ui\/message/);assert.equal(app.contents[0].mimeType,'text/html;profile=mcp-app');
    assert.equal((await call('app_state',{viewKey})).structuredContent.linked,false);
    await call('attach_chat',{viewKey});assert.equal((await f.local('connection')).web.chatOpen,true);
    const id=randomUUID();await f.local('chat',{id,text:'Inspect the empty board, then reply. Discuss only.',intent:'discuss',expectedRevision:0,selectedIds:[]});
    const pending=await call('app_state',{viewKey});assert.equal(pending.structuredContent.messages[0].delivery,'app');
    const claim=await call('claim_app_message',{viewKey,id,kind:'chat'});assert.match(claim.structuredContent.prompt,/Discuss/);
    assert.equal((await call('claim_app_message',{viewKey,id,kind:'chat'})).isError,true,'claiming twice cannot send a second model message');
    await call('confirm_app_delivery',{viewKey,receipt:claim.structuredContent.receipt});assert.ok((await f.local('connection')).deliveryCheckedAt);
    assert.equal((await call('reply_to_chat_message',{id,text:'I have not read it.'})).isError,true);
    const captured=await call('read_chat_message',{id});assert.equal(captured.structuredContent.message.text,'Inspect the empty board, then reply. Discuss only.');assert.equal(captured.structuredContent.boardChangedSinceRequest,false);
    const board=await call('read_board',{});await call('confirm_connection',{revision:board.structuredContent.revision});
    await call('reply_to_chat_message',{id,text:'The captured board is empty at revision 0. No changes made.'});assert.equal((await f.local('chat')).messages[0].status,'answered');assert.ok((await f.local('connection')).replyCheckedAt);
    const otherCard=await call('open_sharedboard');await call('attach_chat',{viewKey:otherCard._meta.sharedboardView});assert.equal((await call('app_state',{viewKey})).structuredContent.linked,false,'only an explicitly chosen card can relay');
    assert.equal((await call('send_board_message',{viewKey,id:randomUUID(),text:'wrong card',intent:'discuss'})).isError,true);
    const composerInput={viewKey:otherCard._meta.sharedboardView,id:randomUUID(),text:'Composer idempotency check.',intent:'discuss'};await call('send_board_message',composerInput);
    const add=await call('add_elements',{elements:[{id:'remote_box',type:'rectangle',x:12,y:20,text:'Remote editable object'}]});assert.equal(add.isError,undefined);
    const repeated=await call('send_board_message',composerInput);assert.equal(repeated.structuredContent.messages.filter(m=>m.id===composerInput.id).length,1);assert.equal(repeated.structuredContent.messages.find(m=>m.id===composerInput.id).boardRevision,0,'a retry keeps its original snapshot even when the board changes');
    const uncertain=await call('claim_app_message',{viewKey:composerInput.viewKey,id:composerInput.id,kind:'chat'});await call('detach_chat',{viewKey:composerInput.viewKey});assert.equal((await call('confirm_app_delivery',{viewKey:composerInput.viewKey,receipt:uncertain.structuredContent.receipt})).isError,true);assert.match((await f.local('chat')).messages.find(m=>m.id===composerInput.id).deliveryError,/did not confirm/);
    assert.equal((await call('edit_elements',{edits:[{id:'remote_box',expectedVersion:0,changes:{x:200}}]})).isError,true);
    const changed=await call('read_chat_message',{id});assert.equal(changed.structuredContent.boardChangedSinceRequest,true);
    const legacy=await fetch(`${f.origin}/mcp`,{method:'POST',headers:{'content-type':'application/json','accept':'application/json, text/event-stream','mcp-protocol-version':'2025-06-18',authorization:`Bearer ${tokens.access_token}`},body:JSON.stringify({jsonrpc:'2.0',id:88,method:'tools/list',params:{}})});assert.equal(legacy.headers.get('content-type').includes('application/json'),true);assert.ok((await legacy.json()).result.tools.length);
    await f.local('connection/disconnect',{});await assert.rejects(call('read_board'));
  }finally{await client.close().catch(()=>{});await f.close();}
});

test('web OAuth constrains scopes, rejects expired approvals and wrong PKCE, and refresh preserves the same grant',()=>{
  let now=1000,grant;
  const auth=new WebAuthorization({origin:'https://board.example',permission:'read',now:()=>now,valid:value=>value===grant,approve:({scope,clientId})=>grant={id:'binding',scope,clientId}});
  const client=auth.register({redirect_uris:['https://client.example/callback']});const secret=verifier();const params={client_id:client.client_id,redirect_uri:client.redirect_uris[0],response_type:'code',code_challenge:challenge(secret),code_challenge_method:'S256',resource:'https://board.example/mcp'};
  assert.throws(()=>auth.request({...params,redirect_uri:'https://attacker.example/callback'}));assert.throws(()=>auth.request({...params,scope:'board.write'}));assert.throws(()=>auth.request({...params,resource:'https://other.example/mcp'}));
  const waiting=auth.request(params);auth.decide(waiting.id,true);const code=new URL(auth.poll(waiting.id).redirect).searchParams.get('code');const exchange={grant_type:'authorization_code',client_id:client.client_id,redirect_uri:params.redirect_uri,code,code_verifier:secret};
  assert.throws(()=>auth.issue({...exchange,code_verifier:verifier()},now+3600000));
  const tokens=auth.issue(exchange,now+3600000);assert.equal(auth.verify(tokens.access_token).scope,'board.read');
  const renewed=auth.issue({grant_type:'refresh_token',client_id:client.client_id,refresh_token:tokens.refresh_token},now+3600000);assert.equal(auth.verify(renewed.access_token),grant);assert.throws(()=>auth.issue({grant_type:'refresh_token',client_id:client.client_id,refresh_token:tokens.refresh_token},now+3600000));
  const expired=auth.request(params);now+=300001;assert.throws(()=>auth.decide(expired.id,true));
  now+=2_000_000;assert.throws(()=>auth.verify(renewed.access_token),'expired access tokens cannot read the board');
});

test('web read-only connector denies drawing edits through the real HTTP tools',async()=>{
  const f=await fixture('read'),client=new Client({name:'read-only web client',version:'1'});
  try{const {tokens}=await f.authorize();await client.connect(new StreamableHTTPClientTransport(new URL(`${f.origin}/mcp`),{requestInit:{headers:{Authorization:`Bearer ${tokens.access_token}`}}}));const response=await client.callTool({name:'add_elements',arguments:{elements:[{type:'rectangle',x:0,y:0}]}});assert.equal(response.isError,true);assert.equal(f.app.store.board.revision,0);}finally{await client.close().catch(()=>{});await f.close();}
});

test('helper installation verifies official release bytes and reuses the checked download',async()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'sharedboard-helper-')),bytes=Buffer.from('a fake signed-release fixture'),checksum=createHash('sha256').update(bytes).digest('hex');let calls=0;
  const fetcher=async url=>{calls++;return url.includes('api.github.com')?new Response(JSON.stringify({tag_name:'fixture',assets:[{name:'cloudflared-windows-amd64.exe',digest:`sha256:${checksum}`,browser_download_url:'https://github.com/cloudflare/cloudflared/releases/download/fixture/cloudflared-windows-amd64.exe'}]})):new Response(bytes);};
  try{const binary=await ensureTunnelHelper(dir,{fetcher,platform:'win32',arch:'x64'});assert.equal(readFileSync(binary).toString(),bytes.toString());await ensureTunnelHelper(dir,{fetcher,platform:'win32',arch:'x64'});assert.equal(calls,2);}finally{rmSync(dir,{recursive:true,force:true});}
});

test('cancelling connector verification aborts the probe and closes the isolated gateway',async()=>{
  let stopCount=0,started;
  const checking=new Promise(resolve=>{started=resolve;});
  const connector=new WebConnector({directory:os.tmpdir(),connections:{},store:{},chats:{},reviews:{},callLocal:()=>{},publishChat:()=>{},publishReviews:()=>{},
    startTunnel:async({url})=>({url,stop(){stopCount++;}}),
    checkReadiness:async({signal,onProgress})=>{onProgress({detail:'Waiting for the new address to resolve…'});started();await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError')),{once:true}));}
  });
  try{
    await connector.begin({provider:'chatgpt-web',permission:'read'});await checking;
    const server=connector.server,pending=connector.ready;
    assert.equal(connector.status().phase,'checking');assert.match(connector.status().detail,/resolve/);
    await connector.stop();await pending;
    assert.equal(server.listening,false);assert.equal(stopCount,1);assert.equal(connector.status().phase,'off');assert.equal(connector.status().url,null);assert.equal(connector.status().error,null);
  }finally{await connector.stop();}
});

test('failed connector verification retains its safe diagnostic and closes the public route',async()=>{
  let stopped=false;
  const message='The temporary address could not be resolved by DNS. The temporary connection was closed.';
  const connector=new WebConnector({directory:os.tmpdir(),connections:{},store:{},chats:{},reviews:{},callLocal:()=>{},publishChat:()=>{},publishReviews:()=>{},
    startTunnel:async({url})=>({url,stop(){stopped=true;}}),
    checkReadiness:async()=>{throw new Error(message);}
  });
  try{
    await connector.begin({provider:'chatgpt-web',permission:'read'});await connector.ready;
    assert.equal(stopped,true);assert.equal(connector.status().phase,'error');assert.equal(connector.status().error,message);assert.equal(connector.status().url,null);assert.equal(connector.server,null);assert.equal(connector.auth,null);
  }finally{await connector.stop();}
});
