import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {ConnectionStore} from '../server/connections.mjs';
import {startServer} from '../server/index.mjs';
import {beginPairing,pairAgent} from './fixtures.mjs';
const directory=()=>mkdtempSync(path.join(os.tmpdir(),'sharedboard-connect-'));

test('pairing codes expire, are single use, persist across restart, and do not leak into saved hashes or status',()=>{
 const dir=directory();let now=1000;const options={boardId:randomUUID(),projectRoot:dir,now:()=>now,findExecutable:()=>null};
 try{
  let store=new ConnectionStore(dir,options);const old=store.begin({provider:'other',permission:'read'});const fresh=store.begin({provider:'other',permission:'read'});
  assert.throws(()=>store.pair({code:old.code}),/invalid or expired/);assert.equal(readFileSync(store.pairFile,'utf8').includes(fresh.code),false);
  store=new ConnectionStore(dir,options);const paired=store.pair({code:fresh.code});assert.equal(paired.connection.permission,'read');assert.equal(paired.connection.automaticMessages,false);assert.equal(JSON.stringify(store.status()).includes(paired.agentKey),false);
  assert.throws(()=>store.pair({code:fresh.code}),/invalid or expired/);assert.throws(()=>store.authorize({key:paired.agentKey},true),/read-only/);
  const expiry=store.begin({provider:'other',permission:'edit'});now+=600001;assert.throws(()=>store.pair({code:expiry.code}),/invalid or expired/);
  assert.equal(store.status().connected,true,'an expired replacement challenge must not disconnect the working AI');
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('read-only grants are enforced, replacement and disconnect revoke old agents, and board content survives',async()=>{
 const dir=directory(),app=await startServer({port:0,dataDir:dir});
 const send=async(route,body,key)=>{const r=await fetch(app.url+route,{method:body===undefined?'GET':'POST',headers:{'x-board-token':app.token,'content-type':'application/json',...(key?{'x-agent-key':key}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
 try{
  assert.equal((await send('/api/agent/read')).status,403);
  const first=await pairAgent(app,'other','read');
  assert.equal((await send('/api/agent/add',{elements:[{id:'blocked'}]},first.agentKey)).status,403);
  assert.equal((await send('/api/agent/confirm',{revision:0},first.agentKey)).status,409);
  assert.equal((await send('/api/agent/read',undefined,first.agentKey)).status,200);
  assert.ok((await send('/api/agent/confirm',{revision:0},first.agentKey)).data.boardCheckedAt);
  const next=await pairAgent(app,'other','edit');
  assert.equal((await send('/api/agent/read',undefined,first.agentKey)).status,403);
  await send('/api/agent/add',{elements:[{id:'preserved',text:'Keep me'}]},next.agentKey);
  await send('/api/connection/disconnect',{});
  assert.equal((await send('/api/agent/read',undefined,next.agentKey)).status,403);assert.equal((await send('/api/agent/add',{elements:[{}]},next.agentKey)).status,403);
  assert.equal(app.store.board.elements.filter(e=>!e.isDeleted).length,2);assert.equal(app.store.board.revision,1);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('non-Codex setup has an explicit manual handoff with real MCP replies; no chat wake is fabricated',async()=>{
 const dir=directory(),app=await startServer({port:0,dataDir:dir});const grant=await pairAgent(app,'cursor');
 const send=async(route,body)=>{const r=await fetch(app.url+route,{method:body===undefined?'GET':'POST',headers:{'x-board-token':app.token,'x-agent-key':grant.agentKey,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});assert.ok(r.ok,await r.clone().text());return r.json();};
 try{
  const input={id:randomUUID(),text:'What is on the board?',intent:'discuss',expectedRevision:0,selectedIds:[]};const created=await send('/api/chat',input);
  assert.equal(created.connected,true);assert.equal(created.automaticMessages,false);assert.equal(created.messages[0].delivery,'manual');assert.match(created.messages[0].handoffPrompt,/read_chat_message/);assert.equal(created.messages[0].receipt,undefined);
  await send('/api/agent/chat',{id:input.id});await send('/api/agent/reply',{id:input.id,text:'The board is empty.'});
  assert.equal((await send('/api/chat')).messages[0].reply,'The board is empty.');assert.ok((await send('/api/connection')).replyCheckedAt);
  const review=await send('/api/reviews',{id:randomUUID(),expectedRevision:0,selectedIds:[]});assert.equal(review.request.delivery,'manual');assert.match(review.request.handoffPrompt,/read_review_request/);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('setup paths come from the running installation and Codex pairing never invents a conversation ID',()=>{
 const dir=directory();try{
  const exe=path.join(dir,'codex.exe');writeFileSync(exe,'fixture; never executed');const store=new ConnectionStore(dir,{boardId:randomUUID(),projectRoot:dir,findExecutable:()=>exe});
  const pairing=store.begin({provider:'codex',permission:'edit'});assert.throws(()=>store.pair({code:pairing.code}),/real ID/);
  const setup=store.setup('codex',pairing.code);assert.ok(setup.prompt.includes(path.join(dir,'server','agent-cli.mjs')));assert.equal(setup.prompt.includes('01a179b8'),false);
  const config=JSON.parse(setup.config),entry=Object.values(config.mcpServers)[0];assert.equal(entry.command,process.execPath);assert.deepEqual(entry.args,[path.join(dir,'server','mcp.mjs')]);assert.equal(entry.env.WHITEBOARD_DATA_DIR,dir);assert.equal(JSON.stringify(config).includes(pairing.code),false);
  const threadId=randomUUID();store.pair({code:pairing.code,threadId});assert.equal(store.status().automaticMessages,true);assert.equal(JSON.parse(readFileSync(path.join(dir,'agent-target.json'),'utf8')).threadId,threadId);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
