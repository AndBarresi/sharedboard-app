import test from 'node:test';
import assert from 'node:assert/strict';
import {ConnectorReadinessError,waitForConnectorReadiness} from '../server/connector-readiness.mjs';

const origin='https://connector.example';
const ready=()=>new Response(JSON.stringify({resource:`${origin}/mcp`}),{headers:{'content-type':'application/json'}});
const dnsFailure=()=>Object.assign(new TypeError('private URL and token must not leak'),{cause:Object.assign(new Error('sensitive resolver details'),{code:'ENOTFOUND'})});
function clock(){let time=0;const waits=[];return {now:()=>time,advance:ms=>{time+=ms;},sleep:async(ms,signal)=>{assert.equal(signal.aborted,false);waits.push(ms);time+=ms;},waits};}
const options=extra=>({origin,timeoutMs:20,dnsTimeoutMs:20,requestTimeoutMs:5,retryDelayMs:7,...extra});

test('readiness retries transient failures and requires exact OAuth resource metadata',async()=>{
  const time=clock(),progress=[];let calls=0;
  const result=await waitForConnectorReadiness(options({...time,onProgress:value=>progress.push(value),fetcher:async(url,init)=>{
    assert.equal(url,`${origin}/.well-known/oauth-protected-resource/mcp`);assert.equal(init.redirect,'error');assert.ok(init.signal);
    calls++;return calls===1?new Response('temporary gateway failure',{status:502}):ready();
  }}));
  assert.deepEqual(result,{attempts:2,elapsedMs:7});assert.equal(calls,2);assert.deepEqual(time.waits,[7]);assert.ok(progress.some(p=>p.lastFailure.reason==='http'&&p.lastFailure.status===502));
});

test('DNS failures use bounded adaptive grace and can recover after the ordinary deadline',async()=>{
  const time=clock(),progress=[];let calls=0;
  const result=await waitForConnectorReadiness(options({...time,timeoutMs:10,dnsTimeoutMs:30,retryDelayMs:6,onProgress:value=>progress.push(value),fetcher:async()=>{calls++;if(calls<4)throw dnsFailure();return ready();}}));
  assert.deepEqual(result,{attempts:4,elapsedMs:18});assert.ok(progress.some(p=>p.remainingMs===30&&p.lastFailure.reason==='dns'));assert.ok(progress.some(p=>p.detail.includes('resolve')&&p.detail.includes('up to 1 sec remaining')));
});

test('persistent DNS failures end at the adaptive deadline without leaking exceptions or addresses',async()=>{
  const time=clock();let calls=0;
  await assert.rejects(waitForConnectorReadiness(options({...time,timeoutMs:10,dnsTimeoutMs:25,retryDelayMs:8,fetcher:async()=>{calls++;throw dnsFailure();}})),error=>{
    assert.ok(error instanceof ConnectorReadinessError);assert.equal(error.reason,'dns');assert.equal(error.code,'ENOTFOUND');assert.equal(error.elapsedMs,25);assert.equal(error.attempts,4);assert.match(error.message,/DNS may still be updating/);assert.match(error.message,/temporary connection was closed/);assert.match(error.message,/4 times/);assert.doesNotMatch(JSON.stringify(error)+error.message,/connector\.example|private|sensitive|token/);return true;
  });
  assert.equal(calls,4);assert.deepEqual(time.waits,[8,8,8,1]);
});

test('persistent HTTP failures remain bounded by the ordinary deadline and do not read response bodies',async()=>{
  const time=clock();let calls=0,reads=0;
  await assert.rejects(waitForConnectorReadiness(options({...time,fetcher:async()=>{calls++;return {ok:false,status:503,json(){reads++;throw new Error('secret body');}};}})),error=>{
    assert.equal(error.reason,'http');assert.equal(error.status,503);assert.equal(error.elapsedMs,20);assert.match(error.message,/HTTP 503/);assert.doesNotMatch(error.message,/secret|connector\.example/);return true;
  });assert.equal(calls,3);assert.equal(reads,0);assert.deepEqual(time.waits,[7,7,6]);
});

for(const [name,fetcher] of [
  ['wrong resource',async()=>new Response(JSON.stringify({resource:'https://wrong.example/mcp',secret:'never report this'}))],
  ['invalid JSON',async()=>new Response('private invalid JSON')],
  ['null metadata',async()=>new Response('null')],
])test(`readiness rejects ${name}`,async()=>{
  const time=clock();await assert.rejects(waitForConnectorReadiness(options({...time,fetcher})),error=>{assert.equal(error.reason,'invalid-metadata');assert.equal(error.elapsedMs,20);assert.doesNotMatch(error.message,/private|wrong\.example|secret/);return true;});
});

test('TLS and connection failures expose only allowlisted categories and codes',async()=>{
  for(const [code,reason] of [['ERR_TLS_CERT_ALTNAME_INVALID','tls'],['ECONNREFUSED','connection'],['UND_ERR_CONNECT_TIMEOUT','timeout'],['SECRET_CUSTOM_ERROR','unreachable']]){
    const time=clock();await assert.rejects(waitForConnectorReadiness(options({...time,fetcher:async()=>{throw Object.assign(new Error('https://sensitive.example/?token=private'),{cause:{code}});}})),error=>{assert.equal(error.reason,reason);assert.doesNotMatch(error.message+JSON.stringify(error),/sensitive|private|SECRET_CUSTOM_ERROR/);return true;});
  }
});

test('cancellation before checking starts prevents all fetches and progress',async()=>{
  const controller=new AbortController();controller.abort(new Error('private cancellation reason'));let calls=0;
  await assert.rejects(waitForConnectorReadiness(options({signal:controller.signal,fetcher:async()=>{calls++;return ready();},onProgress:()=>{calls++;}})),error=>error.name==='AbortError'&&!error.message.includes('private'));assert.equal(calls,0);
});

test('cancellation interrupts an in-flight non-cooperative fetch without another attempt',async()=>{
  const controller=new AbortController();let calls=0;
  const pending=waitForConnectorReadiness(options({timeoutMs:100,dnsTimeoutMs:100,requestTimeoutMs:80,signal:controller.signal,fetcher:async(_url,{signal})=>{calls++;queueMicrotask(()=>controller.abort());assert.equal(signal.aborted,false);return new Promise(()=>{});}}));
  await assert.rejects(pending,error=>error.name==='AbortError');assert.equal(calls,1);
});

test('cancellation during retry sleep prevents subsequent fetches',async()=>{
  const controller=new AbortController(),time=clock();let calls=0;
  await assert.rejects(waitForConnectorReadiness(options({...time,signal:controller.signal,fetcher:async()=>{calls++;throw dnsFailure();},sleep:async()=>{controller.abort();}})),error=>error.name==='AbortError');assert.equal(calls,1);
});

test('request timeouts and an uncooperative JSON body remain bounded by the overall deadline',async()=>{
  for(const fetcher of [async()=>new Promise(()=>{}),async()=>({ok:true,json:()=>new Promise(()=>{})})]){
    const started=performance.now();await assert.rejects(waitForConnectorReadiness({origin,timeoutMs:35,dnsTimeoutMs:35,requestTimeoutMs:10,retryDelayMs:3,fetcher}),error=>{assert.equal(error.reason,'timeout');assert.ok(error.attempts>=1);return true;});assert.ok(performance.now()-started<500,'the watchdog must bound fetch and response parsing');
  }
});

test('retry sleeps and an expensive attempt never run beyond the active deadline',async()=>{
  const time=clock();let calls=0;
  await assert.rejects(waitForConnectorReadiness(options({...time,fetcher:async()=>{calls++;time.advance(13);return new Response('failure',{status:502});}})),error=>{assert.equal(error.elapsedMs,20);assert.equal(error.attempts,1);return true;});assert.equal(calls,1);assert.deepEqual(time.waits,[7]);
});
