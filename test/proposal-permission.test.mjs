import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {ConnectionStore} from '../server/connections.mjs';
import {WebAuthorization,permissionFromScopes} from '../server/web-auth.mjs';
import {startServer} from '../server/index.mjs';
import {pairAgent} from './fixtures.mjs';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';

function localFixture(){
  const directory=mkdtempSync(path.join(os.tmpdir(),'sharedboard-proposal-access-'));
  const options={boardId:randomUUID(),projectRoot:path.resolve('.')};
  return {directory,options,store:new ConnectionStore(directory,options),close:()=>rmSync(directory,{recursive:true,force:true})};
}
function pair(store,permission){const challenge=store.begin({provider:'other',permission});return store.pair({code:challenge.code});}
function webFixture(permission){
  let grant;
  const auth=new WebAuthorization({origin:'https://board.example',permission,now:()=>1000,valid:value=>value===grant,approve:({scope,clientId})=>grant={scope,clientId,permission:permissionFromScopes(scope)}});
  const client=auth.register({redirect_uris:['https://assistant.example/callback']});
  const verifier=randomBytes(40).toString('base64url');
  const params={client_id:client.client_id,redirect_uri:client.redirect_uris[0],response_type:'code',code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')};
  const issue=(scope)=>{const waiting=auth.request({...params,...(scope===undefined?{}:{scope})});auth.decide(waiting.id,true);const code=new URL(auth.poll(waiting.id).redirect).searchParams.get('code');return auth.issue({grant_type:'authorization_code',client_id:client.client_id,redirect_uri:client.redirect_uris[0],code,code_verifier:verifier},3_600_000);};
  return {auth,client,params,issue,get grant(){return grant;}};
}

test('local read, propose and edit grants enforce their distinct drawing capabilities',()=>{
  const f=localFixture();try{
    for(const permission of ['read','propose','edit']){
      const {agentKey,connection}=pair(f.store,permission),auth={key:agentKey};
      assert.equal(connection.permission,permission);
      assert.equal(f.store.authorize(auth).permission,permission);
      assert.equal(f.store.authorize(auth,'read').permission,permission);
      if(permission==='read')assert.throws(()=>f.store.authorize(auth,'propose'),/read-only/);
      else assert.equal(f.store.authorize(auth,'propose').permission,permission);
      for(const operation of [true,'edit'])if(permission==='edit')assert.equal(f.store.authorize(auth,operation).permission,'edit');else assert.throws(()=>f.store.authorize(auth,operation),permission==='propose'?/propose drawing changes only/:/read-only/);
      assert.throws(()=>f.store.authorize(auth,'unknown-operation'),{status:400});
    }
  }finally{f.close();}
});

test('proposal access survives reopening and replacing an edit grant revokes its old key',()=>{
  const f=localFixture();try{
    const previous=pair(f.store,'edit'),proposal=pair(f.store,'propose');
    assert.throws(()=>f.store.authorize({key:previous.agentKey},true),/replaced or disconnected/);
    const reopened=new ConnectionStore(f.directory,f.options);
    assert.equal(reopened.authorize({key:proposal.agentKey},'propose').permission,'propose');
    assert.throws(()=>reopened.authorize({key:proposal.agentKey},true),/propose drawing changes only/);
    assert.equal(JSON.stringify(reopened.status()).includes(proposal.agentKey),false);
    assert.equal(readFileSync(reopened.filename,'utf8').includes(proposal.agentKey),false);
    assert.throws(()=>reopened.begin({provider:'other',permission:'unrestricted'}),{status:400});
    assert.equal(reopened.status().permission,'propose');
    reopened.disconnect();assert.throws(()=>reopened.authorize({key:proposal.agentKey},'propose'),/Connect this AI/);
  }finally{f.close();}
});

test('temporary web proposal grants authorize proposals without direct drawing writes',()=>{
  const f=localFixture();try{
    const paired=f.store.connectWeb({provider:'chatgpt-web',permission:'propose'});
    assert.equal(f.store.status().deliveryMode,'app');
    assert.equal(f.store.authorize({key:paired.key},'propose').permission,'propose');
    assert.throws(()=>f.store.authorize({key:paired.key},true),/propose drawing changes only/);
    assert.throws(()=>f.store.connectWeb({provider:'chatgpt-web',permission:'board.write'}),{status:400});
    assert.equal(f.store.status().permission,'propose');
  }finally{f.close();}
});

test('Codex setup pins pairing and later helper operations to this board data directory',()=>{
  const f=localFixture();try{
    const setup=f.store.setup('codex','fixture-code');
    assert.match(setup.prompt,/--data-dir/);
    assert.ok(setup.prompt.includes(f.directory));
    assert.match(setup.prompt,/--data-dir[^\n]+ pair fixture-code/);
    assert.match(setup.prompt,/--data-dir[^\n]+ read/);
    assert.match(setup.prompt,/--data-dir[^\n]+ confirm <revision>/);
    assert.match(setup.prompt,/same --data-dir option for later read, review, chat, reply, and drawing operations/);
    const config=JSON.parse(setup.config),entry=Object.values(config.mcpServers)[0];
    assert.equal(entry.env.WHITEBOARD_DATA_DIR,f.directory);
  }finally{f.close();}
});

test('proposal OAuth scopes cannot request board.write and retain their restriction on refresh',()=>{
  const f=webFixture('propose');
  assert.deepEqual(f.auth.metadata().scopes_supported,['board.read','board.propose']);
  assert.throws(()=>f.auth.request({...f.params,scope:'board.read board.write'}),/exceeds the permission/);
  assert.throws(()=>f.auth.request({...f.params,scope:'board.write-extra'}),/exceeds the permission/);
  const tokens=f.issue();assert.equal(tokens.scope,'board.read board.propose');
  assert.equal(f.auth.verify(tokens.access_token).permission,'propose');
  const renewed=f.auth.issue({grant_type:'refresh_token',client_id:f.client.client_id,refresh_token:tokens.refresh_token},3_600_000);
  assert.equal(renewed.scope,'board.read board.propose');
  assert.equal(f.auth.verify(renewed.access_token).permission,'propose');
});

test('OAuth read and edit defaults remain unchanged and explicitly narrower proposal scope stays narrow',()=>{
  const read=webFixture('read');assert.throws(()=>read.auth.request({...read.params,scope:'board.propose'}),/exceeds the permission/);assert.equal(read.issue().scope,'board.read');
  const edit=webFixture('edit');assert.equal(edit.issue().scope,'board.read board.write');assert.equal(edit.grant.permission,'edit');
  const narrower=webFixture('edit');assert.equal(narrower.issue('board.read board.propose').scope,'board.read board.propose');assert.equal(narrower.grant.permission,'propose');
  assert.equal(permissionFromScopes('board.read board.write-extra'),'read');
  assert.equal(permissionFromScopes('board.read board.propose-extra'),'read');
});

test('local HTTP proposal permission stages changes but denies direct writes until the owner accepts',async()=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'sharedboard-proposal-http-'));
  const app=await startServer({port:0,dataDir:directory});
  try{
    const grant=await pairAgent(app,'other','propose');
    const call=async(route,input,user=false)=>{
      const response=await fetch(`${app.url}/api/${route}`,{method:input===undefined?'GET':'POST',headers:{'content-type':'application/json','x-board-token':app.token,...(!user?{'x-agent-key':grant.agentKey}:{})},...(input===undefined?{}:{body:JSON.stringify(input)})});
      return {status:response.status,body:await response.json()};
    };
    assert.equal((await call('agent/read')).status,200);
    assert.equal((await call('agent/add',{elements:[{id:'blocked',text:'Not a proposal'}]})).status,403);
    const proposed=await call('agent/propose',{title:'A proposed screen',summary:'Add a screen after review',elements:[{id:'proposed',text:'Screen'}]});
    assert.equal(proposed.status,200);assert.equal(app.store.board.revision,0);assert.equal(app.store.board.elements.length,0);
    const accepted=await call('proposal',{id:proposed.body.id,action:'accept'},true);assert.equal(accepted.status,200);
    const current=app.store.board.elements.find(element=>element.id==='proposed');assert.ok(current);
    assert.equal((await call('agent/edit',{edits:[{id:current.id,expectedVersion:app.store.board.elementVersions[current.id],changes:{x:300}}]})).status,403);
    assert.equal(app.store.board.elements.find(element=>element.id==='proposed').x,0);
  }finally{await app.close();rmSync(directory,{recursive:true,force:true});}
});

test('real HTTP MCP proposal scope permits propose_changes while denying add_elements and edit_elements',async()=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'sharedboard-proposal-mcp-'));
  const app=await startServer({port:0,dataDir:directory,enableWebConnectors:true,startTunnel:async({url})=>({url,stop(){}})});
  const client=new Client({name:'proposal-permission-verification',version:'1'});
  try{
    const local=async(route,input)=>{
      const response=await fetch(`${app.url}/api/${route}`,{method:input===undefined?'GET':'POST',headers:{'content-type':'application/json','x-board-token':app.token},...(input===undefined?{}:{body:JSON.stringify(input)})});
      assert.ok(response.ok,await response.clone().text());return response.json();
    };
    await local('connection/web/start',{provider:'chatgpt-web',permission:'propose'});await app.webConnector.ready;
    const auth=app.webConnector.auth,registered=auth.register({redirect_uris:['https://assistant.example/callback']});
    const secret=randomBytes(40).toString('base64url');
    const approval=auth.request({client_id:registered.client_id,redirect_uri:registered.redirect_uris[0],response_type:'code',code_challenge_method:'S256',code_challenge:createHash('sha256').update(secret).digest('base64url')});
    await local('connection/web/approve',{id:approval.id,allow:true});
    const code=new URL(auth.poll(approval.id).redirect).searchParams.get('code');
    const tokens=auth.issue({grant_type:'authorization_code',client_id:registered.client_id,redirect_uri:registered.redirect_uris[0],code,code_verifier:secret},app.webConnector.expiresAt);
    assert.equal(tokens.scope,'board.read board.propose');assert.equal((await local('connection')).permission,'propose');
    await client.connect(new StreamableHTTPClientTransport(new URL(`${app.webConnector.publicOrigin}/mcp`),{requestInit:{headers:{Authorization:`Bearer ${tokens.access_token}`}}}));
    const call=(name,args={})=>client.callTool({name,arguments:args});
    assert.equal((await call('read_board')).isError,undefined);
    assert.equal((await call('add_elements',{elements:[{id:'blocked',text:'Direct changes are blocked'}]})).isError,true);
    const proposal=await call('propose_changes',{title:'Review this layout',summary:'A layout awaiting approval',elements:[{id:'draft',text:'Draft layout'}]});
    assert.equal(proposal.isError,undefined);assert.equal(app.store.board.revision,0);
    await local('proposal',{id:proposal.structuredContent.id,action:'accept'});
    assert.equal((await call('edit_elements',{edits:[{id:'draft',expectedVersion:app.store.board.elementVersions.draft,changes:{x:500}}]})).isError,true);
    assert.equal(app.store.board.elements.find(element=>element.id==='draft').x,0);
  }finally{await client.close().catch(()=>{});await app.close();rmSync(directory,{recursive:true,force:true});}
});
