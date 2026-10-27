import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {startBridge} from '../bridge/server.mjs';
import {checkedBridgeUrl} from '../bridge/client.mjs';

const run=promisify(execFile),root=fileURLToPath(new URL('../',import.meta.url));
test('bridge CLI uses the real chat environment, keeps keys out of output, and pins reads to an explicit board',async()=>{
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'sharedboard-bridge-cli-')),bridge=await startBridge({port:0,dataDir,findCodex:()=>null,pollTimeoutMs:3000,commandTimeoutMs:4000}),boardId=randomUUID(),threadId=randomUUID(),origin='https://sharedboard.app';
  const browser=async(route,body,token)=>{const response=await fetch(bridge.url+'/bridge/browser/'+route,{method:body===undefined?'GET':'POST',headers:{origin,...(body?{'content-type':'application/json'}:{}),...(token?{'x-sharedboard-browser':token}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};};
  const cli=(args,thread=threadId)=>run(process.execPath,[path.join(root,'bridge/agent-cli.mjs'),'--data-dir',dataDir,'--bridge-url',bridge.url,...args],{env:{...process.env,CODEX_THREAD_ID:thread},windowsHide:true,timeout:10000});
  try{
    const pairing=await browser('pair',{boardId,title:'CLI fixture',permission:'read',clientId:'cli_fixture'});assert.equal(pairing.status,200);
    await assert.rejects(cli(['--board-id',boardId,'pair',pairing.body.code],''),error=>/actual CODEX_THREAD_ID|real CODEX_THREAD_ID/.test(error.stderr));
    const paired=await cli(['--board-id',boardId,'pair',pairing.body.code]);assert.equal(JSON.parse(paired.stdout).boardId,boardId);
    const privateGrant=JSON.parse(await readFile(path.join(dataDir,`agent-${boardId}.json`),'utf8'));assert.equal(privateGrant.threadId,threadId);assert.equal(paired.stdout.includes(privateGrant.agentKey),false);assert.equal(paired.stdout.includes(pairing.body.browserToken),false);
    await assert.rejects(cli(['read']),error=>/board-id/.test(error.stderr));
    await assert.rejects(cli(['--board-id',boardId,'read'],randomUUID()),error=>/not paired/.test(error.stderr));
    const polling=browser('events',{clientId:'cli_fixture'},pairing.body.browserToken);
    for(let i=0;i<100;i++){if((await browser('status',undefined,pairing.body.browserToken)).body.connection.browserOnline)break;await new Promise(resolve=>setImmediate(resolve));}
    const reading=cli(['--board-id',boardId,'read']);const delivered=await polling,command=delivered.body.commands[0];assert.equal(command.operation,'read_board');
    assert.equal((await browser('result',{id:command.id,clientId:'cli_fixture',result:{boardId,revision:12,elements:[{id:'browser-owned',text:'From the open board'}]}},pairing.body.browserToken)).status,200);
    const shown=JSON.parse((await reading).stdout);assert.equal(shown.revision,12);assert.equal(shown.elements[0].text,'From the open board');
  }finally{await bridge.close();await rm(dataDir,{recursive:true,force:true});}
});

test('bridge client credentials cannot be redirected to a remote or different local service',()=>{
  for(const address of ['https://evil.example','http://127.0.0.1:4319/other','http://user@127.0.0.1:4319','http://127.0.0.1:4319/?token=secret'])assert.throws(()=>checkedBridgeUrl(address),/loopback/);
  assert.equal(checkedBridgeUrl('http://127.0.0.1:4319'),'http://127.0.0.1:4319');
});
