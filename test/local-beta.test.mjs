import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {startServer} from '../server/index.mjs';
import {ConnectionStore} from '../server/connections.mjs';
import {pairAgent} from './fixtures.mjs';

const local=async(app,route,input,key)=>{
  const response=await fetch(`${app.url}/api/${route}`,{method:input===undefined?'GET':'POST',headers:{'Content-Type':'application/json','x-board-token':app.token,...(key?{'x-agent-key':key}:{})},...(input===undefined?{}:{body:JSON.stringify(input)})});
  return {status:response.status,data:await response.json()};
};

test('local beta locks web endpoints without starting a tunnel and preserves local MCP access',async()=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'sharedboard-local-beta-'));let starts=0;
  const app=await startServer({port:0,dataDir:directory,startTunnel:async()=>{starts++;throw new Error('must not run');}});
  try{
    const grant=await pairAgent(app,'claude','edit');
    const before=await local(app,'connection');assert.equal(before.data.connected,true);assert.equal(before.data.provider,'claude');assert.equal(before.data.features.webConnectors,false);assert.equal(before.data.web.phase,'locked');assert.equal(before.data.web.wip,true);assert.equal(before.data.web.url,null);
    for(const provider of ['chatgpt-web','claude-web']){
      const result=await local(app,'connection/web/start',{provider,permission:'edit'});
      assert.equal(result.status,501);assert.equal(result.data.code,'WEB_CONNECTOR_WIP');assert.match(result.data.error,/work in progress/);
    }
    const approve=await local(app,'connection/web/approve',{id:'a'.repeat(64),allow:true});assert.equal(approve.status,501);assert.equal(approve.data.code,'WEB_CONNECTOR_WIP');
    assert.equal(starts,0);assert.equal((await local(app,'connection')).data.id,grant.connection.id);
    const added=await local(app,'agent/add',{elements:[{id:'local-beta-shape',type:'rectangle',x:10,y:20}]},grant.agentKey);assert.equal(added.status,200);
    const read=await local(app,'agent/read',undefined,grant.agentKey);assert.equal(read.status,200);assert.equal(read.data.elements.some(element=>element.id==='local-beta-shape'),true);
    const id=randomUUID();assert.equal((await local(app,'chat',{id,text:'Local beta manual chat test.',intent:'discuss',expectedRevision:app.store.board.revision,selectedIds:[]})).status,200);
    assert.equal((await local(app,'agent/chat',{id},grant.agentKey)).status,200);assert.equal((await local(app,'agent/reply',{id,text:'Local MCP reply reached the board.'},grant.agentKey)).status,200);
    assert.equal((await local(app,'chat')).data.messages.at(-1).reply,'Local MCP reply reached the board.');
    const health=await local(app,'health');assert.equal(health.data.name,'shared-board');assert.equal(health.data.product,'SharedBoard.app');
  }finally{await app.close();rmSync(directory,{recursive:true,force:true});}
});

test('additional boards inherit the local beta web connector lock',async()=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'sharedboard-local-beta-child-'));let starts=0;
  const app=await startServer({port:0,dataDir:directory,startTunnel:async()=>{starts++;throw new Error('must not run');}});
  try{
    const workspace=(await local(app,'workspaces')).data;
    const added=await local(app,'workspaces',{action:'create-board',projectId:workspace.projects[0].id,title:'Another local board'});assert.equal(added.status,200);
    const board=added.data.boards.find(board=>board.id!==app.store.board.id);assert.ok(board);
    const child=await app.catalog.open(board.id),childApp={url:`${app.url}/boards/${board.id}`,token:child.token};
    assert.equal((await local(childApp,'connection')).data.features.webConnectors,false);
    assert.equal((await local(childApp,'connection/web/start',{provider:'chatgpt-web',permission:'read'})).status,501);assert.equal(starts,0);
  }finally{await app.close();rmSync(directory,{recursive:true,force:true});}
});

test('saved temporary web grants do not survive reopening the local beta',async()=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'sharedboard-local-beta-grant-'));
  let app=await startServer({port:0,dataDir:directory});
  try{
    const store=new ConnectionStore(directory,{boardId:app.store.board.id,projectRoot:directory});const old=store.connectWeb({provider:'chatgpt-web',permission:'edit'});
    assert.equal(JSON.parse(readFileSync(path.join(directory,'ai-connection.json'),'utf8')).provider,'chatgpt-web');
    await app.close();app=await startServer({port:0,dataDir:directory});
    const state=(await local(app,'connection')).data;assert.equal(state.connected,false);assert.equal(state.web.phase,'locked');
    assert.equal((await local(app,'agent/read',undefined,old.key)).status,403);assert.equal(app.store.board.revision,0);
  }finally{await app.close();rmSync(directory,{recursive:true,force:true});}
});
