import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {request as httpRequest} from 'node:http';
import {startBridge} from '../bridge/server.mjs';

const origin='https://sharedboard.app',threadId=randomUUID();
async function fixture(overrides={}){
 const dataDir=await mkdtemp(path.join(os.tmpdir(),'sharedboard-bridge-test-'));
 let bridge=await startBridge({port:0,dataDir,findCodex:()=>'/fixture/codex.exe',pollTimeoutMs:200,leaseMs:1000,commandTimeoutMs:400,...overrides});
 const call=async(route,body,{browserToken,agentKey,thread=threadId,browser=true,headers={},method=body===undefined?'GET':'POST'}={})=>{
  const response=await fetch(`${bridge.url}${route}`,{method,headers:{...(browser?{Origin:origin}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...(browserToken?{'x-sharedboard-browser':browserToken}:{}),...(agentKey?{'x-sharedboard-agent':agentKey,'x-sharedboard-thread':thread}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:response.status,headers:response.headers,value:response.status===204?null:await response.json()};
 };
 const pair=async(permission='edit',boardId=randomUUID())=>{
  const browser=await call('/bridge/browser/pair',{boardId,title:'Private fixture board',permission,clientId:'tab_a'});assert.equal(browser.status,200);
  const agent=await call('/bridge/agent/pair',{code:browser.value.code,threadId},{browser:false});assert.equal(agent.status,200);
  return {boardId,browserToken:browser.value.browserToken,agentKey:agent.value.agentKey,connectionId:agent.value.connection.id,pairing:browser.value};
 };
 const browser=(grant,route,body)=>call(`/bridge/browser/${route}`,body,{browserToken:grant.browserToken});
 const command=(grant,operation,input={},requestId)=>call('/bridge/agent/command',{boardId:grant.boardId,operation,input,...(requestId?{requestId}:{})},{browser:false,agentKey:grant.agentKey});
 const activate=async(grant,clientId='tab_a')=>{
  const poll=browser(grant,'events',{clientId});
  let status;for(let attempt=0;attempt<10;attempt++){status=await browser(grant,'status');if(status.value.connection.browserOnline)break;await new Promise(resolve=>setImmediate(resolve));}
  assert.equal(status.value.connection.browserOnline,true);return {poll};
 };
 return {call,pair,browser,command,activate,dataDir,get bridge(){return bridge;},async restart(){await bridge.close();bridge=await startBridge({port:0,dataDir,findCodex:()=>'/fixture/codex.exe',pollTimeoutMs:200,leaseMs:1000,commandTimeoutMs:400,...overrides});},async close(){await bridge.close();await rm(dataDir,{recursive:true,force:true});}};
}

test('bridge limits browser origins and hosts, handles explicit CORS, and separates agent endpoints',async()=>{
 const f=await fixture();try{
  const health=await f.call('/bridge/health',undefined,{browser:false});assert.equal(health.status,200);assert.equal(health.value.product,'SharedBoard Bridge');assert.equal(typeof health.value.bridgeId,'string');assert.equal(health.value.grants,undefined);
  for(const rejected of ['https://evil.example','https://sharedboard.app.evil.example','https://sharedboard.app/'])assert.equal((await f.call('/bridge/health',undefined,{headers:{Origin:rejected}})).status,403);
  const wrongHost=await new Promise((resolve,reject)=>{const request=httpRequest(`${f.bridge.url}/bridge/health`,{headers:{Host:'attacker.example'}},response=>{response.resume();response.once('end',()=>resolve(response.statusCode));});request.once('error',reject);request.end();});assert.equal(wrongHost,403);
  const preflight=await f.call('/bridge/browser/events',undefined,{method:'OPTIONS',headers:{'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,x-sharedboard-browser'}});assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),origin);assert.equal(preflight.headers.get('access-control-allow-private-network'),'true');assert.equal(preflight.headers.get('access-control-allow-credentials'),null);
  assert.equal((await f.call('/bridge/browser/events',undefined,{method:'OPTIONS',headers:{'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'x-sharedboard-agent'}})).status,403);
  assert.equal((await f.call('/bridge/browser/pair',{},{browser:false})).status,403);assert.equal((await f.call('/bridge/agent/pair',{code:'x',threadId})).status,403);
 }finally{await f.close();}
});

test('pairing is expiring and one-use, credentials are private hashes and remain pinned to board/thread',async()=>{
 let time=Date.now();const f=await fixture({now:()=>time});try{
  const boardId=randomUUID(),pair=await f.call('/bridge/browser/pair',{boardId,title:'Secret title',permission:'read',clientId:'tab_a'});assert.equal(pair.status,200);
  assert.ok(pair.value.setup.prompt.includes(boardId));assert.ok(pair.value.setup.prompt.includes(f.dataDir));assert.ok(pair.value.setup.prompt.includes('CODEX_THREAD_ID'));assert.ok(pair.value.setup.prompt.includes(f.bridge.url));
  const simultaneous=await Promise.all([f.call('/bridge/agent/pair',{code:pair.value.code,threadId},{browser:false}),f.call('/bridge/agent/pair',{code:pair.value.code,threadId},{browser:false})]);assert.equal(simultaneous.filter(result=>result.status===200).length,1);assert.equal(simultaneous.filter(result=>result.status===403).length,1);
  const agent=simultaneous.find(result=>result.status===200).value;const raw=await readFile(path.join(f.dataDir,'bridge-state.json'),'utf8');assert.equal(raw.includes(agent.agentKey),false);assert.equal(raw.includes(pair.value.browserToken),false);assert.equal(raw.includes(pair.value.code),false);assert.equal(raw.includes('elements'),false);
  assert.equal((await f.call('/bridge/agent/command',{boardId,operation:'read_board',input:{}},{browser:false,agentKey:agent.agentKey,thread:randomUUID()})).status,401);
  assert.equal((await f.call('/bridge/agent/command',{boardId:randomUUID(),operation:'read_board',input:{}},{browser:false,agentKey:agent.agentKey})).status,401);
  const expired=await f.call('/bridge/browser/pair',{boardId:randomUUID(),title:'Expired',permission:'edit',clientId:'tab_b'});time+=600001;assert.equal((await f.call('/bridge/agent/pair',{code:expired.value.code,threadId},{browser:false})).status,403);
 }finally{await f.close();}
});

test('RPC forwards only to the owning browser and rejects cross-tab/cross-grant results and stale jobs',async()=>{
 const f=await fixture();try{
  const grant=await f.pair(),other=await f.pair(),{poll}=await f.activate(grant),pending=f.command(grant,'read_board',{full:true}),delivered=await poll;assert.equal(delivered.status,200);assert.equal(delivered.value.commands.length,1);
  const job=delivered.value.commands[0];assert.equal(job.operation,'read_board');assert.equal(job.connectionId,grant.connectionId);assert.deepEqual(job.input,{full:true});
  assert.equal((await f.browser(grant,'result',{id:job.id,clientId:'tab_b',result:{revision:99}})).status,409);
  assert.equal((await f.browser(other,'result',{id:job.id,clientId:'tab_a',result:{revision:99}})).status,409);
  assert.equal((await f.browser(grant,'result',{id:job.id,clientId:'tab_a',error:'invalid'})).status,400);
  const board={revision:7,elements:[{id:'user_box',text:'Browser data'}]};assert.equal((await f.browser(grant,'result',{id:job.id,clientId:'tab_a',result:board})).status,200);assert.deepEqual((await pending).value,board);
  assert.equal((await f.browser(grant,'result',{id:job.id,clientId:'tab_a',result:board})).status,409);
  assert.equal((await f.browser(grant,'events',{clientId:'tab_b'})).value.code,'BOARD_IN_ANOTHER_TAB');
  await f.browser(grant,'release',{clientId:'tab_a'});const replacement=await f.activate(grant,'tab_b');assert.equal((await replacement.poll).status,200);
 }finally{await f.close();}
});

test('read-only access is enforced before RPC and browser errors preserve edit conflicts',async()=>{
 const f=await fixture();try{
  const readonly=await f.pair('read');for(const [operation,input] of [['add_elements',{elements:[{type:'rectangle'}]}],['edit_elements',{edits:[{id:'box',expectedVersion:1,changes:{x:10}}]}]])assert.equal((await f.command(readonly,operation,input)).status,403);
  assert.equal((await f.command(readonly,'run_shell',{command:'anything'})).status,400);
  const grant=await f.pair(),{poll}=await f.activate(grant),pending=f.command(grant,'edit_elements',{edits:[{id:'box',expectedVersion:1,changes:{x:10}}]}),job=(await poll).value.commands[0];
  await f.browser(grant,'result',{id:job.id,clientId:'tab_a',error:{message:'The user moved this shape.',status:409,code:'EDIT_CONFLICT',conflicts:['box']}});const rejected=await pending;assert.equal(rejected.status,409);assert.deepEqual(rejected.value.conflicts,['box']);
 }finally{await f.close();}
});

test('closed browser, timed-out calls and bridge restarts never serve a cached board',async()=>{
 const f=await fixture({commandTimeoutMs:80});try{
  const grant=await f.pair();assert.equal((await f.command(grant,'read_board')).value.code,'BROWSER_OFFLINE');
  const {poll}=await f.activate(grant),pending=f.command(grant,'read_board'),job=(await poll).value.commands[0];assert.equal((await pending).value.code,'BROWSER_TIMEOUT');assert.equal((await f.browser(grant,'result',{id:job.id,clientId:'tab_a',result:{revision:10}})).status,409);
  const identity=f.bridge.bridgeId;await f.restart();assert.equal(f.bridge.bridgeId,identity);assert.equal((await f.browser(grant,'status')).value.connection.connected,true);assert.equal((await f.browser(grant,'status')).value.connection.browserOnline,false);assert.equal((await f.command(grant,'read_board')).value.code,'BROWSER_OFFLINE');
 }finally{await f.close();}
});

test('Codex notifications validate the exact receipt, deduplicate requests and retain uncertain delivery',async()=>{
 let calls=0,output;const f=await fixture({runQueue:async(command,args)=>{calls++;assert.equal(command,'/fixture/codex.exe');assert.deepEqual(args.slice(0,3),['queue','--thread',threadId]);assert.ok(args[4].includes('--board-id'));assert.ok(args[4].includes('--data-dir'));return output??`Queued message ${randomUUID()} for thread ${threadId}`;}});try{
  const grant=await f.pair(),{poll}=await f.activate(grant),id=randomUUID();const first=await f.browser(grant,'notify',{kind:'chat',id}),second=await f.browser(grant,'notify',{kind:'chat',id});assert.equal(first.status,200);assert.equal(first.value.delivery,'queued');assert.deepEqual(first.value.receipt,second.value.receipt);assert.equal(calls,1);
  output=`Queued message ${randomUUID()} for thread ${randomUUID()}`;const uncertainId=randomUUID(),uncertain=await f.browser(grant,'notify',{kind:'review',id:uncertainId});assert.equal(uncertain.status,503);assert.equal(uncertain.value.code,'DELIVERY_UNCERTAIN');assert.equal((await f.browser(grant,'notify',{kind:'review',id:uncertainId})).value.code,'DELIVERY_UNCERTAIN');assert.equal(calls,2);
  await poll;
 }finally{await f.close();}
});

test('disconnect revokes both credentials and rejects in-flight RPC rather than applying an old response',async()=>{
 const f=await fixture();try{
  const grant=await f.pair(),{poll}=await f.activate(grant),pending=f.command(grant,'read_board'),job=(await poll).value.commands[0];assert.equal((await f.browser(grant,'disconnect',{})).status,200);assert.equal((await pending).value.code,'BRIDGE_DISCONNECTED');
  assert.equal((await f.browser(grant,'status')).status,401);assert.equal((await f.browser(grant,'result',{id:job.id,clientId:'tab_a',result:{revision:99}})).status,401);assert.equal((await f.command(grant,'read_board')).status,401);
 }finally{await f.close();}
});

test('an expired tab lease cannot answer a command after another tab takes ownership',async()=>{
 let time=Date.now();const f=await fixture({now:()=>time});try{
  const grant=await f.pair(),first=await f.activate(grant),oldRequest=f.command(grant,'read_board'),oldCommand=(await first.poll).value.commands[0];
  time+=1001;const replacement=await f.activate(grant,'tab_b');assert.equal((await oldRequest).value.code,'BROWSER_OFFLINE');
  assert.equal((await f.browser(grant,'result',{id:oldCommand.id,clientId:'tab_a',result:{revision:1}})).status,409);
  const latestRequest=f.command(grant,'read_board'),latestCommand=(await replacement.poll).value.commands[0];
  await f.browser(grant,'result',{id:latestCommand.id,clientId:'tab_b',result:{revision:42}});assert.equal((await latestRequest).value.revision,42);
 }finally{await f.close();}
});

test('delivery receipts survive restart and sending markers recover as uncertain without resending',async()=>{
 let calls=0,f;f=await fixture({runQueue:async()=>{
  calls++;const saved=JSON.parse(await readFile(path.join(f.dataDir,'bridge-state.json'),'utf8'));assert.equal(saved.deliveries.at(-1).status,'sending','the durable marker must precede the Codex invocation');
  return `Queued message ${randomUUID()} for thread ${threadId}`;
 }});try{
  const grant=await f.pair(),{poll}=await f.activate(grant),id=randomUUID(),first=await f.browser(grant,'notify',{kind:'chat',id});assert.equal(first.status,200);await poll;await f.restart();
  const duplicate=await f.browser(grant,'notify',{kind:'chat',id,retry:true});assert.equal(duplicate.status,200);assert.deepEqual(duplicate.value.receipt,first.value.receipt);assert.equal(calls,1,'a saved receipt does not need an open browser or another Codex invocation');
  await f.bridge.close();const filename=path.join(f.dataDir,'bridge-state.json'),state=JSON.parse(await readFile(filename,'utf8')),interrupted=randomUUID();state.deliveries.push({grantId:grant.connectionId,kind:'review',id:interrupted,status:'sending'});await writeFile(filename,JSON.stringify(state));await f.restart();
  for(const retry of [false,true]){const uncertain=await f.browser(grant,'notify',{kind:'review',id:interrupted,retry});assert.equal(uncertain.status,503);assert.equal(uncertain.value.code,'DELIVERY_UNCERTAIN');}
  assert.equal(calls,1);const recovered=JSON.parse(await readFile(filename,'utf8'));assert.equal(recovered.deliveries.find(entry=>entry.id===interrupted).status,'uncertain');assert.equal(JSON.stringify(recovered.deliveries).includes('snapshot'),false);
 }finally{await f.close();}
});

test('only explicit retries of known not-launched failures can invoke Codex again',async()=>{
 let calls=0;const f=await fixture({runQueue:()=>{calls++;if(calls===1)throw Object.assign(new Error('Fixture executable unavailable'),{notLaunched:true});return `Queued message ${randomUUID()} for thread ${threadId}`;}});try{
  const grant=await f.pair(),{poll}=await f.activate(grant),id=randomUUID();
  assert.equal((await f.browser(grant,'notify',{kind:'chat',id})).value.code,'DELIVERY_FAILED');assert.equal(calls,1);
  assert.equal((await f.browser(grant,'notify',{kind:'chat',id})).value.code,'DELIVERY_FAILED');assert.equal(calls,1);
  const retried=await f.browser(grant,'notify',{kind:'chat',id,retry:true});assert.equal(retried.status,200);assert.equal(retried.value.delivery,'queued');assert.equal(calls,2);
  await poll;await f.restart();assert.deepEqual((await f.browser(grant,'notify',{kind:'chat',id,retry:true})).value.receipt,retried.value.receipt);assert.equal(calls,2);
 }finally{await f.close();}
});

test('delivery ledger stays bounded and never evicts uncertain requests to make room',async()=>{
 let calls=0;const f=await fixture({runQueue:async()=>{calls++;return `Queued message ${randomUUID()} for thread ${threadId}`;}});try{
  const grant=await f.pair();await f.bridge.close();const filename=path.join(f.dataDir,'bridge-state.json'),state=JSON.parse(await readFile(filename,'utf8'));
  state.deliveries=Array.from({length:200},()=>({grantId:grant.connectionId,kind:'chat',id:randomUUID(),status:'uncertain'}));await writeFile(filename,JSON.stringify(state));await f.restart();
  const {poll}=await f.activate(grant);assert.equal((await f.browser(grant,'notify',{kind:'chat',id:randomUUID()})).value.code,'DELIVERY_LEDGER_FULL');assert.equal(calls,0);await poll;
  await f.bridge.close();state.deliveries[0]={...state.deliveries[0],status:'queued',receipt:{provider:'codex-cli',queueMessageId:randomUUID()}};await writeFile(filename,JSON.stringify(state));await f.restart();
  const active=await f.activate(grant),id=randomUUID();assert.equal((await f.browser(grant,'notify',{kind:'chat',id})).status,200);assert.equal(calls,1);await active.poll;
  const saved=JSON.parse(await readFile(filename,'utf8'));assert.equal(saved.deliveries.length,200);assert.equal(saved.deliveries.filter(entry=>entry.status==='uncertain').length,199);assert.equal(saved.deliveries.at(-1).id,id);
 }finally{await f.close();}
});

test('commands expose absolute deadlines and results at the deadline are rejected',async()=>{
 let time=Date.now();const f=await fixture({now:()=>time,commandTimeoutMs:100});try{
  const grant=await f.pair(),{poll}=await f.activate(grant),pending=f.command(grant,'read_board'),command=(await poll).value.commands[0];assert.equal(command.expiresAt,time+100);
  time=command.expiresAt;const stale=await f.browser(grant,'result',{id:command.id,clientId:'tab_a',result:{revision:1}});assert.equal(stale.status,409);assert.equal(stale.value.code,'STALE_BRIDGE_COMMAND');assert.equal((await pending).value.code,'BROWSER_TIMEOUT');
 }finally{await f.close();}
});

test('confirmed reads and replies wake one status poll promptly without creating an empty-poll loop',async()=>{
 const f=await fixture({pollTimeoutMs:1500});
 const promptly=promise=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Connection status was not published promptly')),500);promise.then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});});
 try{
  const grant=await f.pair(),first=await f.activate(grant),confirmation=f.command(grant,'confirm_connection',{revision:3}),confirmJob=(await first.poll).value.commands[0];
  const waitingStatus=f.browser(grant,'events',{clientId:'tab_a'});await f.browser(grant,'status');
  await f.browser(grant,'result',{id:confirmJob.id,clientId:'tab_a',result:{ok:true}});assert.equal((await confirmation).status,200);const confirmed=await promptly(waitingStatus);assert.ok(confirmed.value.connection.boardCheckedAt);assert.deepEqual(confirmed.value.commands,[]);
  const second=await f.activate(grant),reply=f.command(grant,'reply_to_chat_message',{id:randomUUID(),text:'A real browser reply'}),replyJob=(await second.poll).value.commands[0];
  await f.browser(grant,'result',{id:replyJob.id,clientId:'tab_a',result:{ok:true}});assert.equal((await reply).status,200);
  const dirty=await promptly(f.browser(grant,'events',{clientId:'tab_a'}));assert.ok(dirty.value.connection.replyCheckedAt);assert.deepEqual(dirty.value.commands,[]);
  const held=f.browser(grant,'events',{clientId:'tab_a'});await f.browser(grant,'status');assert.equal((await f.browser(grant,'events',{clientId:'tab_a'})).value.code,'POLL_IN_PROGRESS');
  await f.browser(grant,'release',{clientId:'tab_a'});assert.equal((await held).status,200);
 }finally{await f.close();}
});

test('stable drawing IDs share in-flight RPC and survive restart without accepting changed input or grants',async()=>{
 const f=await fixture();try{
  const grant=await f.pair(),other=await f.pair(),requestId=randomUUID(),input={elements:[{id:'stable_box',type:'rectangle',x:10,y:20}],summary:'One intentional operation'},first=await f.activate(grant);
  const original=f.command(grant,'add_elements',input,requestId),job=(await first.poll).value.commands[0];assert.equal(job.id,requestId);
  const duplicate=f.command(grant,'add_elements',{summary:input.summary,elements:[{y:20,x:10,type:'rectangle',id:'stable_box'}]},requestId);
  assert.equal((await f.command(grant,'add_elements',{...input,summary:'Different operation'},requestId)).value.code,'BRIDGE_REQUEST_CONFLICT');
  assert.equal((await f.command(other,'add_elements',input,requestId)).value.code,'BRIDGE_REQUEST_CONFLICT');
  const held=f.browser(grant,'events',{clientId:'tab_a'});await f.browser(grant,'status');assert.equal((await f.browser(grant,'events',{clientId:'tab_a'})).value.code,'POLL_IN_PROGRESS','the duplicate does not create another queued browser command');
  const result={added:['stable_box'],revision:1};await f.browser(grant,'result',{id:job.id,clientId:'tab_a',result});assert.deepEqual((await original).value,result);assert.deepEqual((await duplicate).value,result);
  await f.browser(grant,'release',{clientId:'tab_a'});await held;await f.restart();
  assert.equal((await f.command(grant,'add_elements',{...input,summary:'Changed after restart'},requestId)).value.code,'BRIDGE_REQUEST_CONFLICT');
  const reopened=await f.activate(grant),retry=f.command(grant,'add_elements',input,requestId),retriedJob=(await reopened.poll).value.commands[0];assert.equal(retriedJob.id,requestId);assert.ok(retriedJob.expiresAt>=job.expiresAt);
  await f.browser(grant,'result',{id:retriedJob.id,clientId:'tab_a',result});assert.deepEqual((await retry).value,result);
  const state=JSON.parse(await readFile(path.join(f.dataDir,'bridge-state.json'),'utf8'));assert.deepEqual(Object.keys(state.requests[0]).sort(),['fingerprint','grantId','id','operation']);assert.equal(JSON.stringify(state.requests).includes('stable_box'),false);
 }finally{await f.close();}
});

test('pairing without a compatible queue command preserves helper access but never claims automatic delivery',async()=>{
 let calls=0;const f=await fixture({findCodex:()=>null,runQueue:()=>{calls++;}});try{
  const grant=await f.pair(),status=(await f.browser(grant,'status')).value.connection;assert.equal(status.connected,true);assert.equal(status.automaticMessages,false);
  const {poll}=await f.activate(grant);assert.equal((await f.browser(grant,'notify',{kind:'chat',id:randomUUID()})).value.code,'CODEX_UNAVAILABLE');assert.equal(calls,0);
  const reading=f.command(grant,'read_board'),command=(await poll).value.commands[0];await f.browser(grant,'result',{id:command.id,clientId:'tab_a',result:{revision:2}});assert.equal((await reading).value.revision,2);
 }finally{await f.close();}
});

test('manual handoff returns only a scoped helper prompt without queueing or a delivery receipt',async()=>{
 let calls=0;const f=await fixture({findCodex:()=>null,runQueue:()=>{calls++;}});try{
  const grant=await f.pair('read'),id=randomUUID(),input={kind:'chat',id,boardId:grant.boardId,connectionId:grant.connectionId};
  assert.equal((await f.call('/bridge/browser/handoff',input)).status,401);
  assert.equal((await f.browser(grant,'handoff',input)).value.code,'BROWSER_OFFLINE');
  const {poll}=await f.activate(grant);
  for(const change of [{boardId:randomUUID()},{connectionId:randomUUID()}])assert.equal((await f.browser(grant,'handoff',{...input,...change})).value.code,'BRIDGE_WRONG_BOARD');
  assert.equal((await f.browser(grant,'handoff',{...input,kind:'other'})).status,400);
  const prepared=await f.browser(grant,'handoff',input),again=await f.browser(grant,'handoff',input);
  assert.equal(prepared.status,200);assert.equal(prepared.value.delivery,'manual');assert.equal(prepared.value.receipt,undefined);assert.equal(prepared.value.connection.automaticMessages,false);
  assert.equal(prepared.value.connection.deliveryCheckedAt,null);assert.equal(again.value.handoffPrompt,prepared.value.handoffPrompt);
  for(const value of [grant.boardId,id,f.dataDir,f.bridge.url,'--board-id','--data-dir',`chat ${id}`,'Discuss','Request work','reply'])assert.ok(prepared.value.handoffPrompt.includes(value));
  assert.equal(prepared.value.handoffPrompt.includes(grant.agentKey),false);assert.equal(prepared.value.handoffPrompt.includes(grant.browserToken),false);
  const reviewId=randomUUID(),review=await f.browser(grant,'handoff',{...input,kind:'review',id:reviewId});
  assert.ok(review.value.handoffPrompt.includes(`review ${reviewId}`));assert.ok(review.value.handoffPrompt.includes('inspection and explanation only'));assert.ok(review.value.handoffPrompt.includes('complete_review'));
  assert.equal(calls,0);const saved=JSON.parse(await readFile(path.join(f.dataDir,'bridge-state.json'),'utf8'));assert.deepEqual(saved.deliveries,[]);
  await f.browser(grant,'release',{clientId:'tab_a'});await poll;
 }finally{await f.close();}
});

test('automatic and uncertain sends cannot be converted into a manual handoff',async()=>{
 let calls=0;const f=await fixture({runQueue:async()=>{calls++;throw new Error('Ambiguous queue fixture');}});try{
  const grant=await f.pair(),{poll}=await f.activate(grant),id=randomUUID(),input={kind:'chat',id,boardId:grant.boardId,connectionId:grant.connectionId};
  assert.equal((await f.browser(grant,'handoff',input)).value.code,'MANUAL_HANDOFF_UNAVAILABLE');
  assert.equal((await f.browser(grant,'notify',{kind:'chat',id})).value.code,'DELIVERY_UNCERTAIN');
  assert.equal((await f.browser(grant,'handoff',input)).value.code,'DELIVERY_UNCERTAIN');assert.equal(calls,1);
  assert.equal(JSON.parse(await readFile(path.join(f.dataDir,'bridge-state.json'),'utf8')).deliveries[0].status,'uncertain');
  await f.browser(grant,'release',{clientId:'tab_a'});await poll;
 }finally{await f.close();}
});
