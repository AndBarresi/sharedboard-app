import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserBridge} from '../src/browser-relay.mjs';

const settle=async()=>{for(let index=0;index<12;index++)await Promise.resolve();};
class Clock{
 now=0;next=1;tasks=new Map();
 setTimeout(callback,delay){const id=this.next++;this.tasks.set(id,{callback,at:this.now+delay});return id;}
 clearTimeout(id){this.tasks.delete(id);}
 async advance(duration){const until=this.now+duration;for(;;){const next=[...this.tasks].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>until)break;this.now=next[1].at;this.tasks.delete(next[0]);next[1].callback();await settle();}this.now=until;await settle();}
}
class Surface extends EventTarget{
 listeners=new Set();
 addEventListener(name,callback){this.listeners.add(name);super.addEventListener(name,callback);}
 removeEventListener(name,callback){this.listeners.delete(name);super.removeEventListener(name,callback);}
}
function fixture(){
 const boardId=crypto.randomUUID(),sessionId=crypto.randomUUID(),token=`${sessionId}.private-test-token`,clock=new Clock(),environment=new Surface();environment.document=new Surface();environment.document.visibilityState='visible';
 const original={id:sessionId,boardId,connected:true,provider:'chatgpt',permission:'read',deliveryMode:'events',automaticMessages:true,automaticReviews:true,messageExpiresAt:'2026-10-28T12:00:00.000Z',reviewExpiresAt:'2026-10-28T12:10:00.000Z'};
 let state={browserToken:token,sessionId,connection:structuredClone(original)},remote=structuredClone(original),offline=false,autoOpen=true,nextLoad,notifyGate;
 const sockets=[],requests=[],errors=[],executions=[],saves=[];
 const load=async()=>{if(nextLoad){const pending=nextLoad;nextLoad=null;return pending;}return structuredClone(state);};
 const save=async(value,{expectedToken}={})=>{if(expectedToken!==undefined&&state?.browserToken!==expectedToken)return false;state=structuredClone(value);saves.push(structuredClone(value));return true;};
 class Socket{
  constructor(url){if(offline)throw new Error('Network unavailable');this.url=url;this.readyState=0;this.sent=[];this.silent=false;sockets.push(this);if(autoOpen)queueMicrotask(()=>{if(this.readyState!==0)return;this.readyState=1;this.onopen?.();});}
  send(raw){this.sent.push(raw);if(raw==='ping'){if(!this.silent)this.emit('pong');return;}const message=JSON.parse(raw);if(message.type==='authenticate'){assert.equal(message.browserToken,token);assert.equal(message.clientId,'isolated-tab');this.emit({type:'connection',connection:structuredClone(remote)});}}
  emit(message){queueMicrotask(()=>{if(this.readyState===1)this.onmessage?.({data:typeof message==='string'?message:JSON.stringify(message)});});}
  close(){this.readyState=3;this.onclose?.({code:1000});}
 }
 const bridge=createBrowserBridge({boardId,clientId:'isolated-tab',load,save,WebSocket:Socket,timers:clock,environment,pollDelay:20,execute:async command=>{executions.push(command);return {ok:true};},onError:async error=>{errors.push(error);if(error.status===409)return;const current=await load();if(current?.browserToken)await save({...current,connection:{...current.connection,connected:false,browserOnline:false,relayAvailable:false}},{expectedToken:current.browserToken});},fetch:async(url,options)=>{
  requests.push({url,options});if(offline)throw new Error('Network unavailable');const path=new URL(url).pathname;
  if(path==='/browser/status')return Response.json({connection:remote});
  if(path==='/browser/disconnect')return Response.json({connection:{...remote,connected:false}});
  if(path==='/browser/notify'){if(notifyGate)await notifyGate;const body=JSON.parse(options.body);return Response.json({delivery:'queued',receipt:`evt_${body.kind}_${body.id}`,connection:remote});}
  throw new Error('Recovery must not call '+path);
 }});
 return {bridge,clock,environment,sockets,requests,errors,executions,saves,boardId,sessionId,token,get state(){return state;},get remote(){return remote;},set remote(value){remote=value;},set offline(value){offline=value;},set autoOpen(value){autoOpen=value;},set nextLoad(value){nextLoad=value;},set notifyGate(value){notifyGate=value;}};
}

test('a socket stuck connecting has a bounded deadline and retries the same grant without replay',async()=>{
 const f=fixture();try{
  f.autoOpen=false;f.bridge.start();await settle();const first=f.sockets[0],lateOpen=first.onopen;assert.equal(first.readyState,0);
  f.environment.dispatchEvent(new Event('online'));await f.clock.advance(9999);assert.equal(f.sockets.length,1);assert.equal(first.readyState,0);
  await f.clock.advance(1);assert.equal(first.readyState,3);assert.equal(f.state.browserToken,f.token);
  f.autoOpen=true;await f.clock.advance(20);assert.equal(f.sockets.length,2);assert.deepEqual(f.state.connection,f.remote);assert.equal(f.state.sessionId,f.sessionId);
  lateOpen();assert.equal(first.sent.length,0);assert.equal(f.requests.length,0);assert.equal(f.executions.length,0);
 }finally{f.bridge.close();assert.equal(f.clock.tasks.size,0);}
});

test('missing pong reconnects the same scoped grant and rehydrates native leases without replaying requests',async()=>{
 const f=fixture();try{
  f.bridge.start();await settle();const first=f.sockets[0];assert.equal(f.state.connection.connected,true);
  first.silent=true;await f.clock.advance(25000);assert.equal(first.sent.at(-1),'ping');await f.clock.advance(9999);assert.equal(f.sockets.length,1);assert.equal(first.readyState,1);
  f.remote={...f.remote,messageExpiresAt:'2026-10-29T12:00:00.000Z',reviewExpiresAt:'2026-10-29T12:10:00.000Z'};
  await f.clock.advance(1);assert.equal(first.readyState,3);assert.equal(f.state.connection.connected,false);assert.equal(f.state.browserToken,f.token);
  await f.clock.advance(20);assert.equal(f.sockets.length,2);assert.equal(f.state.connection.connected,true);assert.deepEqual(f.state.connection,f.remote);assert.equal(f.state.browserToken,f.token);assert.equal(f.state.sessionId,f.sessionId);
  for(const socket of f.sockets){assert.equal(new URL(socket.url).searchParams.get('session'),f.sessionId);assert.equal(new URL(socket.url).searchParams.has('token'),false);assert.deepEqual(JSON.parse(socket.sent[0]),{type:'authenticate',browserToken:f.token,clientId:'isolated-tab'});}
  assert.deepEqual(f.requests,[],'socket recovery performs no pair, subscribe, notify, or request replay');assert.deepEqual(f.executions,[]);
 }finally{f.bridge.close();assert.equal(f.clock.tasks.size,0);assert.equal(f.environment.listeners.size,0);assert.equal(f.environment.document.listeners.size,0);}
});

test('online and visible foreground checks detect a silent socket promptly without extending its missing-pong deadline',async()=>{
 const f=fixture();try{
  f.bridge.start();await settle();const first=f.sockets[0];first.silent=true;
  f.environment.document.visibilityState='hidden';f.environment.document.dispatchEvent(new Event('visibilitychange'));await settle();assert.equal(first.sent.length,1);
  f.environment.document.visibilityState='visible';f.environment.document.dispatchEvent(new Event('visibilitychange'));await settle();assert.equal(first.sent.at(-1),'ping');
  await f.clock.advance(9000);f.environment.dispatchEvent(new Event('online'));f.environment.dispatchEvent(new Event('focus'));f.environment.dispatchEvent(new Event('pageshow'));await settle();assert.equal(first.sent.filter(item=>item==='ping').length,1);
  await f.clock.advance(1000);assert.equal(first.readyState,3);await f.clock.advance(20);assert.equal(f.sockets.length,2);assert.deepEqual(f.state.connection,f.remote);assert.equal(f.requests.length,0);
  await f.clock.advance(25000);assert.equal(f.sockets.length,2,'a healthy pong cancels the loss deadline');await f.clock.advance(10000);assert.equal(f.sockets.length,2);
 }finally{f.bridge.close();}
});

test('a storage failure during socket-loss reporting is contained and cannot strand recovery',async()=>{
 const f=fixture();try{
  f.bridge.start();await settle();f.sockets[0].silent=true;await f.clock.advance(25000);
  let reject;f.nextLoad=new Promise((resolve,fail)=>{reject=fail;});await f.clock.advance(10000);
  reject(new Error('Transient storage read failure'));await settle();assert.ok(f.errors.some(error=>error.message==='Transient storage read failure'));
  await f.clock.advance(20);assert.equal(f.sockets.length,2);assert.equal(f.state.browserToken,f.token);assert.deepEqual(f.state.connection,f.remote);assert.equal(f.requests.length,0);
 }finally{f.bridge.close();}
});

test('closing during an asynchronous loss check cannot report stale offline state or reconnect afterward',async()=>{
 const f=fixture();try{
  f.bridge.start();await settle();f.sockets[0].silent=true;await f.clock.advance(25000);
  const saved=structuredClone(f.state);let release;f.nextLoad=new Promise(resolve=>{release=resolve;});await f.clock.advance(10000);
  f.bridge.close();release(saved);await settle();await f.clock.advance(60000);
  assert.deepEqual(f.state,saved);assert.equal(f.errors.length,0);assert.equal(f.sockets.length,1);assert.equal(f.clock.tasks.size,0);assert.equal(f.requests.length,0);
 }finally{f.bridge.close();}
});

test('an asynchronously loaded old grant cannot open a socket after explicit disconnect',async()=>{
 const f=fixture();try{
  const saved=structuredClone(f.state);let release;f.nextLoad=new Promise(resolve=>{release=resolve;});f.bridge.start();await settle();
  await f.bridge.disconnect();assert.equal(f.state,null);release(saved);await settle();await f.clock.advance(60000);
  assert.equal(f.sockets.length,0);assert.equal(f.state,null);assert.equal(f.errors.length,0);assert.deepEqual(f.requests.map(request=>new URL(request.url).pathname),['/browser/disconnect']);
 }finally{f.bridge.close();}
});

test('transport pongs are acknowledged while an authorized operation waits on browser storage',async()=>{
 const f=fixture();try{
  f.bridge.start();await settle();let release;f.nextLoad=new Promise(resolve=>{release=resolve;});
  f.sockets[0].emit({type:'command',command:{id:'slow-storage-read',connectionId:f.sessionId,operation:'read'}});await settle();
  await f.clock.advance(75000);assert.equal(f.sockets.length,1);assert.equal(f.errors.length,0,'a healthy socket is not dropped behind the operation message queue');
  release(structuredClone(f.state));await settle();assert.equal(f.executions.length,1);assert.equal(f.executions[0].id,'slow-storage-read');
 }finally{f.bridge.close();}
});

test('late open and asynchronously loaded frames from an old socket cannot overwrite or execute in its replacement',async()=>{
 const f=fixture();try{
  f.bridge.start();await settle();const first=f.sockets[0],lateOpen=first.onopen,lateMessage=first.onmessage,lateClose=first.onclose;
  let release;f.nextLoad=new Promise(resolve=>{release=resolve;});
  lateMessage({data:JSON.stringify({type:'command',command:{id:'old-command',connectionId:f.sessionId,operation:'read'}})});await settle();
  first.silent=true;await f.clock.advance(35000);await f.clock.advance(20);assert.equal(f.sockets.length,2);const second=f.sockets[1],sent=first.sent.length;
  lateOpen();lateClose({code:4003});assert.equal(first.sent.length,sent,'a late old open cannot authenticate or arm timers');
  release(structuredClone(f.state));await settle();assert.equal(f.executions.length,0,'the old command was awaiting storage when its socket was replaced');assert.equal(f.state.browserToken,f.token);assert.equal(second.readyState,1);
  lateMessage({data:JSON.stringify({type:'connection',connection:{...f.remote,permission:'edit',messageExpiresAt:null}})});await settle();assert.deepEqual(f.state.connection,f.remote);assert.equal(f.requests.length,0);
 }finally{f.bridge.close();}
});

test('reconnection rejects a wrong-board lease update and does not replace the stored board or credentials',async()=>{
 const f=fixture();try{
  f.bridge.start();await settle();const original=structuredClone(f.state);f.sockets[0].silent=true;
  f.remote={...f.remote,boardId:crypto.randomUUID(),id:crypto.randomUUID()};await f.clock.advance(35020);
  assert.ok(f.errors.some(error=>error.code==='RELAY_WRONG_BOARD'));assert.equal(f.state.browserToken,original.browserToken);assert.equal(f.state.sessionId,original.sessionId);assert.equal(f.state.connection.boardId,f.boardId);assert.equal(f.state.connection.id,f.sessionId);assert.equal(f.state.connection.automaticMessages,original.connection.automaticMessages);assert.equal(f.requests.length,0);
 }finally{f.bridge.close();}
});

test('an uncertain in-flight notify is not repeated when foreground recovery restores the same native connection',async()=>{
 const f=fixture();try{
  f.bridge.start();await settle();let reject;f.notifyGate=new Promise((resolve,fail)=>{reject=fail;});
  const id=crypto.randomUUID(),sending=f.bridge.notify('chat',id);await settle();assert.equal(f.requests.length,1);
  reject(new Error('The notification response was lost'));await assert.rejects(sending,error=>error.deliveryUnknown===true);f.notifyGate=null;
  f.sockets[0].silent=true;f.environment.dispatchEvent(new Event('online'));await settle();await f.clock.advance(10020);
  assert.equal(f.sockets.length,2);assert.equal(f.requests.length,1,'recovery must not retry a potentially accepted effect');assert.equal(f.state.browserToken,f.token);assert.deepEqual(f.state.connection,f.remote);
  assert.deepEqual(JSON.parse(f.requests[0].options.body),{kind:'chat',id});
 }finally{f.bridge.close();}
});
