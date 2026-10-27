import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveSession} from '../cloudflare/live-session.mjs';
import {MemoryStorage} from './relay-fixtures.mjs';

const id=()=>crypto.randomUUID(),tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(changes={}){
 let now=Date.parse('2026-10-27T12:00:00Z'),serial=0;const timers=new Map(),storage=new MemoryStorage(),options={storage,boardId:id(),connectionId:id(),familyId:id(),now:()=>now,setTimer(callback,delay){const key=++serial;timers.set(key,{callback,at:now+delay});return key;},clearTimer:key=>timers.delete(key),...changes},live=new LiveSession(options);
 return {storage,options,live,timers,async advance(delta){now+=delta;for(const [key,timer] of [...timers])if(timer.at<=now){timers.delete(key);await timer.callback();}await tick();}};
}
async function waiting(live,input={},options){const pending=live.wait(input,options);for(let attempt=0;attempt<20;attempt++){const state=await live.status();if(state?.status==='waiting')return {pending,state};await tick();}throw new Error('Synthetic live wait did not start.');}
const request=(sessionId,changes={})=>({id:id(),kind:'chat',intent:'discuss',liveSessionId:sessionId,...changes});

test('a live session exists only during an actual bounded wait and claims one metadata-only request before returning it',async()=>{
 const f=fixture();assert.equal(await f.live.status(),null);const {pending,state}=await waiting(f.live);assert.equal(state.status,'waiting');assert.equal(Date.parse(state.expiresAt)-Date.parse(state.waitExpiresAt),20*60_000-40_000);
 const input=request(state.id,{text:'DO NOT STORE MESSAGE',drawing:'DO NOT STORE DRAWING',reply:'DO NOT STORE ANSWER'}),queued=await f.live.queue(input);assert.match(queued.receipt,/^live_[a-f0-9]{64}$/);
 const result=await pending;assert.equal(result.status,'request');assert.equal(result.sessionId,state.id);assert.deepEqual(result.requests,[{id:input.id,kind:'chat',intent:'discuss'}]);assert.equal((await f.live.status()).status,'processing');assert.equal((await f.live.status()).waitExpiresAt,null);assert.equal(f.timers.size,0);
 const stored=JSON.stringify([...f.storage.map]);assert.equal(stored.includes('DO NOT STORE'),false);assert.equal(stored.includes(queued.receipt),true);assert.equal((await f.storage.get(f.live.key)).requests[0].status,'claimed');
 await assert.rejects(f.live.queue(request(state.id)),error=>error.code==='LIVE_SESSION_NOT_WAITING');
});

test('only one simultaneous wait is allowed and active sessions require their exact consumer ID',async()=>{
 const f=fixture(),first=await waiting(f.live);await assert.rejects(f.live.wait({sessionId:first.state.id}),error=>error.code==='LIVE_WAIT_IN_PROGRESS');await assert.rejects(f.live.wait({}),error=>error.code==='LIVE_WAIT_IN_PROGRESS');
 await f.advance(40_000);assert.equal((await first.pending).status,'timeout');assert.equal((await f.live.status()).status,'processing');
 await assert.rejects(f.live.wait({}),error=>error.code==='LIVE_SESSION_REQUIRED');await assert.rejects(f.live.wait({sessionId:id()}),error=>error.code==='LIVE_SESSION_REPLACED');
 const resumed=await waiting(f.live,{sessionId:first.state.id,waitMs:45_000});assert.equal(resumed.state.id,first.state.id);assert.equal(resumed.state.expiresAt,first.state.expiresAt);await f.advance(45_000);assert.equal((await resumed.pending).status,'timeout');assert.equal(f.timers.size,0);
});

test('timeouts, explicit stop, abort and hard expiry remove active presence without extending the twenty-minute session',async()=>{
 const f=fixture(),initial=await waiting(f.live,{waitMs:10});await f.advance(10);assert.equal((await initial.pending).status,'timeout');
 await assert.rejects(f.live.stop({sessionId:id()}),error=>error.code==='LIVE_SESSION_REPLACED');const stoppedWait=await waiting(f.live,{sessionId:initial.state.id});const stopped=await f.live.stop({sessionId:initial.state.id});assert.equal(stopped.status,'stopped');assert.equal((await stoppedWait.pending).status,'stopped');assert.equal(f.timers.size,0);assert.equal((await f.live.wait({sessionId:initial.state.id})).status,'stopped');
 const aborter=new AbortController(),aborting=await waiting(f.live,{}, {signal:aborter.signal});aborter.abort();assert.equal((await aborting.pending).status,'stopped');assert.equal((await f.live.status()).status,'stopped');assert.equal(f.timers.size,0);
 await assert.rejects(f.live.wait({}, {signal:aborter.signal}),error=>error.name==='AbortError');
 const final=await waiting(f.live);await f.advance(20*60_000);const expired=await final.pending;assert.equal(expired.status,'expired');assert.equal(expired.expiresAt,final.state.expiresAt);assert.deepEqual(expired.requests,[]);assert.equal((await f.live.status()).status,'expired');await assert.rejects(f.live.queue(request(final.state.id)),error=>error.code==='LIVE_SESSION_NOT_WAITING');
});

test('parallel notifications and idempotent retries cannot forward a captured ID twice, including after a lost tool result',async()=>{
 const f=fixture(),first=await waiting(f.live),input=request(first.state.id),[a,b]=await Promise.all([f.live.queue(input),f.live.queue(input)]);assert.deepEqual(a,b);assert.equal((await first.pending).requests[0].id,input.id);assert.equal((await f.storage.get(f.live.key)).requests.length,1);
 await assert.rejects(f.live.queue({...input,intent:'work'}),error=>error.code==='LIVE_REQUEST_CONFLICT');
 // Simulate losing the tool result and reconstructing the Durable Object.
 const restarted=new LiveSession(f.options);assert.equal((await restarted.status()).status,'processing');const resumed=await waiting(restarted,{sessionId:first.state.id}),receiptRetry=await restarted.queue(input);assert.deepEqual(receiptRetry,a);assert.equal((await restarted.status()).status,'waiting','a receipt retry must not settle a later wait or replay old work');
 const fresh=request(first.state.id),freshReceipt=await restarted.queue(fresh);assert.notEqual(freshReceipt.receipt,a.receipt);assert.deepEqual((await resumed.pending).requests,[{id:fresh.id,kind:fresh.kind,intent:fresh.intent}]);assert.equal((await f.storage.get(f.live.key)).requests.length,2);
});

test('a recovered durable waiting flag is never advertised as actual presence and a new session inherits no old requests',async()=>{
 const f=fixture(),first=await waiting(f.live),recovered=new LiveSession(f.options);assert.equal((await recovered.status()).status,'processing');await assert.rejects(recovered.queue(request(first.state.id)),error=>error.code==='LIVE_SESSION_NOT_WAITING');
 await f.live.stop({sessionId:first.state.id});assert.equal((await first.pending).status,'stopped');const next=await waiting(f.live);assert.notEqual(next.state.id,first.state.id);await assert.rejects(f.live.queue(request(first.state.id)),error=>error.code==='LIVE_SESSION_REPLACED');
 const previous=request(next.state.id);await f.live.queue(previous);await next.pending;await f.live.stop({sessionId:next.state.id});const replacement=await waiting(f.live);const before=(await f.storage.get(f.live.key)).requests;
 await assert.rejects(f.live.queue({...previous,liveSessionId:replacement.state.id}),error=>error.code==='LIVE_REQUEST_CONFLICT');assert.deepEqual((await f.storage.get(f.live.key)).requests,before);await f.live.stop({sessionId:replacement.state.id});await replacement.pending;
});

test('board, connection and authorization family pinning isolate waits and receipts; clearing a grant resolves only its waiter',async()=>{
 const f=fixture(),first=await waiting(f.live),input=request(first.state.id);for(const override of [{boardId:id()},{connectionId:id()},{familyId:id()}]){const other=new LiveSession({...f.options,...override});assert.equal(await other.status(),null);await assert.rejects(other.wait({sessionId:first.state.id}),error=>error.code==='LIVE_SESSION_REPLACED');await assert.rejects(other.queue(input),error=>error.code==='LIVE_SESSION_REPLACED');await other.clear();assert.equal((await f.live.status()).status,'waiting');}
 await f.live.queue(input);await first.pending;const resumed=await waiting(f.live,{sessionId:first.state.id});await f.live.clear();assert.equal((await resumed.pending).status,'stopped');assert.equal(await f.live.status(),null);assert.equal(await f.storage.get(f.live.key),undefined);assert.equal(f.timers.size,0);
});

test('invalid waits and review intent are rejected, and a failed durable claim leaves the original wait available',async()=>{
 const f=fixture();for(const waitMs of [0,-1,45001,1.5,'40000'])await assert.rejects(f.live.wait({waitMs}),error=>error.code==='LIVE_WAIT_INVALID');const active=await waiting(f.live);await assert.rejects(f.live.queue(request(active.state.id,{kind:'review',intent:'work'})),error=>error.code==='LIVE_REQUEST_INVALID');
 const original=f.storage.transaction.bind(f.storage);let failPut=true;f.storage.transaction=operation=>original(transaction=>operation({...transaction,put:async(...args)=>{if(failPut){failPut=false;throw new Error('Synthetic durable write failure');}return transaction.put(...args);}}));
 const input=request(active.state.id,{kind:'review',intent:'discuss'});await assert.rejects(f.live.queue(input),/Synthetic durable/);assert.equal((await f.live.status()).status,'waiting');assert.deepEqual((await f.storage.get(f.live.key)).requests,[]);await f.live.queue(input);assert.equal((await active.pending).requests[0].kind,'review');
});

test('revocation during wait setup cannot leave a timer or consumer active after durable clearing',async()=>{
 const f=fixture(),original=f.storage.transaction.bind(f.storage);let entered,release;const entering=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});let hold=true;
 f.storage.transaction=operation=>original(transaction=>operation({...transaction,put:async(...args)=>{if(hold){hold=false;entered();await gate;}return transaction.put(...args);}}));
 const pending=f.live.wait();await entering;const clearing=f.live.clear();release();await clearing;assert.equal((await pending).status,'stopped');assert.equal(await f.live.status(),null);assert.equal(f.timers.size,0);assert.equal(await f.storage.get(f.live.key),undefined);await assert.rejects(f.live.wait(),error=>error.code==='LIVE_SESSION_NOT_WAITING');
});

test('cancellation during a durable claim never returns executable work and retains its claimed ID without replay',async()=>{
 const f=fixture(),aborter=new AbortController(),active=await waiting(f.live,{}, {signal:aborter.signal}),original=f.storage.transaction.bind(f.storage);let entered,release;const entering=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});let hold=true;
 f.storage.transaction=operation=>original(transaction=>operation({...transaction,put:async(...args)=>{if(hold){hold=false;entered();await gate;}return transaction.put(...args);}}));
 const input=request(active.state.id),queueing=f.live.queue(input);await entering;aborter.abort();release();const receipt=await queueing,result=await active.pending;assert.equal(result.status,'stopped');assert.deepEqual(result.requests,[]);assert.equal((await f.live.status()).status,'stopped');const state=await f.storage.get(f.live.key);assert.equal(state.requests[0].id,input.id);assert.equal(state.requests[0].status,'claimed');assert.equal(state.requests[0].receipt,receipt.receipt);assert.equal(f.timers.size,0);
});

test('a timer cleanup write failure still drops actual presence and resolves the bounded wait safely',async()=>{
 const f=fixture(),active=await waiting(f.live,{waitMs:1}),original=f.storage.transaction.bind(f.storage);f.storage.transaction=operation=>original(transaction=>operation({...transaction,put:async()=>{throw new Error('Synthetic timeout write failure');}}));
 await f.advance(1);assert.equal((await active.pending).status,'stopped');assert.equal((await f.live.status()).status,'processing');assert.equal((await f.live.status()).waitExpiresAt,null);assert.equal(f.timers.size,0);
});

test('a committed request wins over its former wait timeout without forwarding the captured ID twice',async()=>{
 const f=fixture(),active=await waiting(f.live),original=f.storage.transaction.bind(f.storage);let entered,release;const entering=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 f.storage.transaction=async operation=>{const result=await original(operation);if(result?.waiter&&result?.receipt){entered();await gate;}return result;};
 const input=request(active.state.id),queued=f.live.queue(input);await entering;await f.advance(40_000);release();await queued;const result=await active.pending;assert.equal(result.status,'request');assert.equal(result.requests[0].id,input.id);assert.equal((await f.storage.get(f.live.key)).requests.length,1);assert.equal((await f.live.status()).status,'processing');assert.equal(f.timers.size,0);
});
