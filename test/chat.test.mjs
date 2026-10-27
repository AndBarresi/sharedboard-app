import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {startServer} from '../server/index.mjs';
import {ChatStore} from '../server/chat.mjs';
import {notifyCodex} from '../server/notify-codex.mjs';
import {createElements,editElements} from '../server/elements.mjs';
import {pairAgent} from './fixtures.mjs';
const temp=()=>mkdtempSync(path.join(os.tmpdir(),'sharedboard-chat-'));
function client(app,key){return async(route,body,method=body===undefined?'GET':'POST')=>{const r=await fetch(app.url+route,{method,headers:{'x-board-token':app.token,'content-type':'application/json',...(key?{'x-agent-key':key}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json()};};}

test('mini chat captures context, queues once, requires reading, replies live and persists without editing the board',async()=>{
 const directory=temp(),deliveries=[];
 const app=await startServer({port:0,dataDir:directory,notifyChat:async m=>{deliveries.push(m.id);return {queueMessageId:randomUUID()};}});const grant=await pairAgent(app);const send=client(app,grant.agentKey);
 try{
  await send('/api/agent/add',{elements:[{id:'selected',text:'Inspect this'},{id:'other',x:500}]});
  const input={id:randomUUID(),text:'Please explain this box.',intent:'discuss',expectedRevision:1,selectedIds:['selected']};
  const result=await send('/api/chat',input);assert.equal(result.status,200);assert.equal(result.data.messages[0].delivery,'queued');assert.equal(result.data.messages[0].snapshot,undefined);assert.equal(result.data.messages[0].targetThreadId,undefined);
  await send('/api/chat',input);assert.equal(deliveries.length,1);
  assert.equal((await send('/api/chat',{...input,text:'different'})).status,409);
  assert.equal((await send('/api/agent/reply',{id:input.id,text:'Premature'})).status,409);
  await send('/api/agent/edit',{edits:[{id:'selected_label',expectedVersion:1,changes:{text:'Edited later'}}]});
  const read=await send('/api/agent/chat',{id:input.id});assert.equal(read.data.boardChangedSinceRequest,true);assert.equal(read.data.message.intent,'discuss');assert.equal(read.data.board.elements.length,2);assert.deepEqual(Object.keys(read.data.board.elementVersions).sort(),['selected','selected_label']);assert.equal(read.data.board.elements.find(e=>e.id==='selected_label').text,'Inspect this');
  const abort=new AbortController();const stream=await fetch(`${app.url}/api/events?token=${app.token}`,{signal:abort.signal});const reader=stream.body.getReader();await reader.read();
  const reply={id:input.id,text:'I inspected the selected box. No edits were made.'};assert.equal((await send('/api/agent/reply',reply)).status,200);
  const chunk=await reader.read();assert.match(new TextDecoder().decode(chunk.value),/event: chat/);abort.abort();
  assert.equal((await send('/api/agent/reply',reply)).status,200);assert.equal((await send('/api/agent/reply',{...reply,text:'overwrite'})).status,409);
  assert.equal(new ChatStore(directory).find(input.id).reply,reply.text);assert.equal(app.store.board.revision,2);
 }finally{await app.close();rmSync(directory,{recursive:true,force:true});}
});

test('chat failure retry, reconnect recovery, stale board and disconnected sends remain explicit',async()=>{
 const directory=temp();let tries=0;const app=await startServer({port:0,dataDir:directory,notifyChat:async()=>{if(++tries===1)throw new Error('Unavailable');return {queueMessageId:randomUUID()};}});const grant=await pairAgent(app);const send=client(app,grant.agentKey);
 try{
  const input={id:randomUUID(),text:'Make the selected box green.',intent:'work',expectedRevision:0,selectedIds:[]};
  const first=await send('/api/chat',input);assert.equal(first.data.messages[0].intent,'work');assert.equal(first.data.messages[0].delivery,'failed');
  await send('/api/chat/retry',{id:input.id});await send('/api/chat/retry',{id:input.id});assert.equal(tries,2);
  assert.equal((await send('/api/chat',{...input,id:randomUUID(),expectedRevision:99})).status,409);
  assert.equal((await send('/api/chat',{...input,id:randomUUID(),selectedIds:['missing']})).status,409);
  assert.equal((await send('/api/chat',{...input,id:randomUUID(),text:'x'.repeat(8001)})).status,400);
  const saved=new ChatStore(directory);saved.messages[0].delivery='pending';saved.save();assert.equal(new ChatStore(directory).messages[0].delivery,'uncertain');
 }finally{await app.close();rmSync(directory,{recursive:true,force:true});}
 const offlineDir=temp();const offline=await startServer({port:0,dataDir:offlineDir});try{assert.equal((await client(offline)('/api/chat',{id:randomUUID(),text:'hello',intent:'discuss',expectedRevision:0,selectedIds:[]})).status,503);assert.equal((await fetch(`${offline.url}/api/chat`)).status,401);assert.equal((await fetch(`${offline.url}/api/chat`,{headers:{origin:'https://example.com','x-board-token':offline.token}})).status,403);}finally{await offline.close();rmSync(offlineDir,{recursive:true,force:true});}
});

test('chat dispatcher keeps text out of process args and cannot retry into a different chat',async()=>{
 const directory=temp(),threadId=randomUUID(),executable=path.join(directory,'codex.exe');writeFileSync(executable,'test placeholder');writeFileSync(path.join(directory,'agent-target.json'),JSON.stringify({threadId,codexPath:executable}));
 const message={id:randomUUID(),targetThreadId:threadId,intent:'work',boardRevision:4,text:'PRIVATE_MESSAGE'};
 try{
  await notifyCodex(message,{dataDir:directory,projectRoot:directory,kind:'chat',run:async(_,args)=>{assert.equal(args[2],threadId);assert.equal(args[4].includes(message.text),false);assert.ok(args[4].includes('Request work'));assert.ok(args[4].includes(' reply '));return `Queued message ${randomUUID()} for thread ${threadId}.`;}});
  await assert.rejects(()=>notifyCodex({...message,targetThreadId:randomUUID()},{dataDir:directory,projectRoot:directory,kind:'chat'}),/previously connected chat/);
 }finally{rmSync(directory,{recursive:true,force:true});}
});

test('agent-created filled buttons retain readable labels and text resize recalculates dimensions',()=>{
 const e=createElements([{id:'dark',type:'ellipse',backgroundColor:'#275c46',strokeColor:'#275c46',text:'+'},{id:'light',type:'ellipse',backgroundColor:'#e5eadc',strokeColor:'#e5eadc',text:'JD'}]);
 assert.equal(e.find(x=>x.id==='dark_label').strokeColor,'#ffffff');assert.equal(e.find(x=>x.id==='light_label').strokeColor,'#26352e');
 const board={elements:e,elementVersions:Object.fromEntries(e.map(x=>[x.id,1]))};const next=editElements(board,[{id:'dark_label',expectedVersion:1,changes:{fontSize:40}}]);assert.ok(next[0].element.height>e[1].height);
});
