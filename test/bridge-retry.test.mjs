// Copyright (c) 2026 Andrew Barresi. SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {IDBFactory} from 'fake-indexeddb';
import {startBridge} from '../bridge/server.mjs';
import {pairBridge,callBridge} from '../bridge/client.mjs';
import {createBrowserTransport} from '../src/browser-store.mjs';

const nativeFetch=globalThis.fetch,run=promisify(execFile);
const cli=fileURLToPath(new URL('../bridge/agent-cli.mjs',import.meta.url));
const origin='https://sharedboard.app';
const addition={elements:[{type:'rectangle',x:20,y:30,width:160,height:100}],summary:'One intended card'};
const reorderedAddition={summary:'One intended card',elements:[{height:100,width:160,y:30,x:20,type:'rectangle'}]};
async function waitFor(predicate){
 for(let attempt=0;attempt<300;attempt++){
  if(await predicate())return;
  await new Promise(resolve=>setTimeout(resolve,10));
 }
 throw new Error('The isolated retry bridge did not become ready.');
}

async function fixture(){
 const directory=await mkdtemp(path.join(os.tmpdir(),'sharedboard-bridge-retry-')),commands=[];
 const settings={dataDir:directory,findCodex:()=>null,runQueue:()=>{throw new Error('Retry fixtures must not queue a real conversation.');},pollTimeoutMs:100,leaseMs:2000,commandTimeoutMs:3000};
 let service,transport,config,options;
 const openBrowser=async()=>{
  transport=await createBrowserTransport(config);await transport.ready();
 };
 const close=async()=>{
  globalThis.fetch=nativeFetch;
  transport?.close();await service?.close();
  const target=path.resolve(directory);
  assert.ok(target.startsWith(path.join(os.tmpdir(),'sharedboard-bridge-retry-')),'cleanup stays inside this disposable fixture');
  await rm(target,{recursive:true,force:true});
 };
 try{
  service=await startBridge({...settings,port:0});
  config={indexedDB:new IDBFactory(),dbName:crypto.randomUUID(),BroadcastChannel:null,origin,bridgeBaseURL:`${service.url}/bridge`,bridgePollDelay:10,bridgeFetch:async(url,input={})=>{
   const response=await nativeFetch(url,{...input,headers:{...input.headers,Origin:origin}});
   if(new URL(url).pathname==='/bridge/browser/events'&&response.ok){
    const data=await response.clone().json();commands.push(...(data.commands??[]));
   }
   return response;
  }};
  await openBrowser();
  const pair=await transport.request('/api/connection/pairing',{method:'POST',body:JSON.stringify({provider:'codex',permission:'edit'})});
  options={boardId:transport.boardId,dataDir:directory,bridgeUrl:service.url,threadId:crypto.randomUUID()};
  await pairBridge(pair.pairing.code,options);
  await waitFor(async()=>{const state=await transport.bridgeStatus();return state?.connected&&state.browserOnline;});
  return {
   commands,options,
   board:()=>transport.request('/api/board'),
   async loseCommittedAddResponse(){
    let lost=false,requestId;
    globalThis.fetch=async(url,input={})=>{
     const response=await nativeFetch(url,input);
     if(!lost&&new URL(url).pathname==='/bridge/agent/command'){
      requestId=JSON.parse(input.body).requestId;
      assert.equal(response.status,200,'the write commits before its response is lost');
      await response.text();lost=true;
      throw new Error('Fixture lost the committed agent response');
     }
     return response;
    };
    try{await assert.rejects(callBridge('add_elements',addition,options),/Fixture lost the committed agent response/);}
    finally{globalThis.fetch=nativeFetch;}
    assert.equal(lost,true);assert.match(requestId,/^[a-f0-9-]{36}$/i);
    return requestId;
   },
   async retryInNewProcess(input=reorderedAddition){
    const file=path.join(directory,`${crypto.randomUUID()}.json`);await writeFile(file,JSON.stringify(input));
    const output=await run(process.execPath,[cli,'--data-dir',directory,'--bridge-url',options.bridgeUrl,'--board-id',options.boardId,'add',file],{env:{...process.env,CODEX_THREAD_ID:options.threadId},windowsHide:true,timeout:10000});
    return JSON.parse(output.stdout);
   },
   async restart(){
    const port=service.port;transport.close();await service.close();
    service=await startBridge({...settings,port});await openBrowser();
    await waitFor(async()=>{const state=await transport.bridgeStatus();return state?.connected&&state.browserOnline;});
   },
   close,
  };
 }catch(error){await close();throw error;}
}

test('a committed add with a lost HTTP response retries once across CLI processes and JSON key order',async()=>{
 const f=await fixture();try{
  const requestId=await f.loseCommittedAddResponse(),before=await f.board();
  assert.equal(before.revision,1);assert.equal(before.elements.length,1);
  const first=f.commands.find(command=>command.operation==='add_elements');
  assert.equal(first.id,requestId);assert.equal(first.input.elements[0].id,before.elements[0].id);
  assert.equal(first.input.requestId,undefined,'routing IDs do not become drawing input');

  const retry=await f.retryInNewProcess(),after=await f.board();
  assert.equal(retry.revision,1);assert.deepEqual(retry.createdIds,[before.elements[0].id]);
  assert.deepEqual(after,before,'a retried add preserves the original revision and drawing');
  const additions=f.commands.filter(command=>command.operation==='add_elements');
  assert.equal(additions.length,2);assert.ok(additions.every(command=>command.id===requestId));
  assert.ok(additions.every(command=>command.input.elements[0].id===before.elements[0].id));

  const freshRequestId=crypto.randomUUID();
  const next=await f.retryInNewProcess({...reorderedAddition,requestId:freshRequestId}),twice=await f.board();
  assert.equal(next.revision,2);assert.equal(twice.elements.length,2);
  assert.equal(new Set(twice.elements.map(element=>element.id)).size,2);
  assert.equal(f.commands.at(-1).id,freshRequestId);
  assert.equal(f.commands.at(-1).input.requestId,undefined);
 }finally{await f.close();}
});

test('lost-response add retries preserve the browser result after bridge restart and browser reopen',async()=>{
 const f=await fixture();try{
  const requestId=await f.loseCommittedAddResponse(),before=await f.board();
  await f.restart();
  const retry=await f.retryInNewProcess(),after=await f.board();
  assert.equal(retry.revision,1);assert.deepEqual(after,before);
  const additions=f.commands.filter(command=>command.operation==='add_elements');
  assert.equal(additions.length,2);assert.ok(additions.every(command=>command.id===requestId));
  assert.deepEqual(additions[1].input,additions[0].input,'durable retry metadata preserves canonical input and generated IDs');
 }finally{await f.close();}
});
