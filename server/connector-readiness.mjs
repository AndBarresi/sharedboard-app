const DNS_CODES=new Set(['ENOTFOUND','EAI_AGAIN','EAI_FAIL','EAI_NODATA','ENODATA','ESERVFAIL']);
const TLS_CODES=new Set(['CERT_HAS_EXPIRED','CERT_NOT_YET_VALID','DEPTH_ZERO_SELF_SIGNED_CERT','SELF_SIGNED_CERT_IN_CHAIN','UNABLE_TO_VERIFY_LEAF_SIGNATURE','UNABLE_TO_GET_ISSUER_CERT_LOCALLY','ERR_TLS_CERT_ALTNAME_INVALID']);
const TIMEOUT_CODES=new Set(['ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT']);
const CONNECTION_CODES=new Set(['ECONNREFUSED','ECONNRESET','EHOSTUNREACH','ENETUNREACH','EPIPE']);

const cancelled=()=>new DOMException('The connection check was cancelled.','AbortError');
const timeout=()=>new DOMException('The connection check timed out.','TimeoutError');
function positive(value,name){if(!Number.isFinite(value)||value<=0)throw new TypeError(`${name} must be a positive number.`);return value;}

// Never copy arbitrary exception messages, response bodies or addresses into diagnostics.
function classify(error){
  const visited=new Set(),pending=[error];
  while(pending.length&&visited.size<12){
    const item=pending.shift();if(!item||typeof item!=='object'||visited.has(item))continue;visited.add(item);
    const code=typeof item.code==='string'?item.code:null;
    if(DNS_CODES.has(code))return {reason:'dns',code};
    if(TLS_CODES.has(code))return {reason:'tls',code};
    if(TIMEOUT_CODES.has(code))return {reason:'timeout',code};
    if(CONNECTION_CODES.has(code))return {reason:'connection',code};
    if(item.name==='TimeoutError')return {reason:'timeout'};
    if(item.cause)pending.push(item.cause);
    if(Array.isArray(item.errors))pending.push(...item.errors.slice(0,12));
  }
  return {reason:'unreachable'};
}

function explanation(failure){
  switch(failure.reason){
    case 'dns':return 'The new connector address did not resolve before the connection check ended. The temporary connection was closed. DNS may still be updating; start a new connection and try again.';
    case 'tls':return 'The connector could not establish a verified secure connection. The temporary connection was closed.';
    case 'http':return `The connector address returned HTTP ${failure.status}. The temporary connection was closed.`;
    case 'invalid-metadata':return 'The connector address did not return the expected OAuth metadata. The temporary connection was closed.';
    case 'timeout':return 'The connector did not respond before the connection check ended. The temporary connection was closed.';
    case 'connection':return 'The connector address could not accept the connection before the check ended. The temporary connection was closed.';
    default:return 'The connector address could not be verified before the connection check ended. The temporary connection was closed.';
  }
}

export class ConnectorReadinessError extends Error{
  constructor(failure,attempts,elapsedMs){
    super(`${explanation(failure)} Checked ${attempts} ${attempts===1?'time':'times'}.`);
    this.name='ConnectorReadinessError';this.reason=failure.reason;this.attempts=attempts;this.elapsedMs=elapsedMs;
    if(failure.code)this.code=failure.code;if(failure.status!==undefined)this.status=failure.status;
  }
}

function abortableSleep(milliseconds,signal){
  return new Promise((resolve,reject)=>{
    if(signal.aborted)return reject(cancelled());
    const finish=()=>{signal.removeEventListener('abort',abort);resolve();};
    const timer=setTimeout(finish,milliseconds);
    const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(cancelled());};
    signal.addEventListener('abort',abort,{once:true});
  });
}

// The race also bounds injected/non-cooperative fetchers and response JSON readers.
async function withAbort(operation,signal){
  if(signal.aborted)throw signal.reason;
  let abort;
  const interrupted=new Promise((_,reject)=>{abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});});
  try{return await Promise.race([operation(),interrupted]);}
  finally{signal.removeEventListener('abort',abort);}
}

export async function waitForConnectorReadiness({origin,signal,fetcher=fetch,now=()=>performance.now(),sleep=abortableSleep,timeoutMs=90_000,dnsTimeoutMs=300_000,requestTimeoutMs=5_000,retryDelayMs=2_500,onProgress=()=>{}}){
  positive(timeoutMs,'timeoutMs');positive(dnsTimeoutMs,'dnsTimeoutMs');positive(requestTimeoutMs,'requestTimeoutMs');positive(retryDelayMs,'retryDelayMs');
  let parsed;
  try{parsed=new URL(origin);}catch{throw new TypeError('A valid connector origin is required.');}
  if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password||parsed.search||parsed.hash||parsed.pathname!=='/')throw new TypeError('A valid connector origin is required.');
  const resource=`${parsed.origin}/mcp`,endpoint=`${parsed.origin}/.well-known/oauth-protected-resource/mcp`,started=now();
  let deadline=started+timeoutMs,attempts=0,lastFailure={reason:'timeout'},deadlineTimer;
  const deadlineController=new AbortController(),overallSignal=signal?AbortSignal.any([signal,deadlineController.signal]):deadlineController.signal;
  const armDeadline=()=>{clearTimeout(deadlineTimer);deadlineTimer=setTimeout(()=>deadlineController.abort(timeout()),Math.max(0,deadline-now()));};
  const elapsed=()=>Math.max(0,now()-started);
  const checkCancellation=()=>{if(signal?.aborted)throw cancelled();};
  const report=()=>{
    const remainingMs=Math.max(0,deadline-now()),remaining=remainingMs>60_000?`${Math.ceil(remainingMs/60_000)} min`:`${Math.ceil(remainingMs/1000)} sec`;
    onProgress({attempts,elapsedMs:elapsed(),remainingMs,lastFailure:{...lastFailure},detail:lastFailure.reason==='dns'?`Waiting for the new address to resolve. Attempt ${attempts}; up to ${remaining} remaining…`:`Checking the new web address. Attempt ${attempts}…`});
  };
  checkCancellation();armDeadline();
  try{
    while(now()<deadline&&!deadlineController.signal.aborted){
      checkCancellation();attempts++;report();
      const requestController=new AbortController(),requestSignal=AbortSignal.any([overallSignal,requestController.signal]);
      const requestTimer=setTimeout(()=>requestController.abort(timeout()),Math.max(0,Math.min(requestTimeoutMs,deadline-now())));
      try{
        const result=await withAbort(async()=>{
          const response=await fetcher(endpoint,{headers:{accept:'application/json'},redirect:'error',signal:requestSignal});
          if(!response.ok){if(response.body?.cancel)await response.body.cancel().catch(()=>{});return Number.isInteger(response.status)&&response.status>=100&&response.status<=599?{reason:'http',status:response.status}:{reason:'unreachable'};}
          let metadata;try{metadata=await response.json();}catch(error){if(requestSignal.aborted)throw error;return {reason:'invalid-metadata'};}
          return metadata&&typeof metadata==='object'&&metadata.resource===resource?null:{reason:'invalid-metadata'};
        },requestSignal);
        checkCancellation();
        if(!result&&now()<=deadline&&!deadlineController.signal.aborted)return {attempts,elapsedMs:elapsed()};
        if(result)lastFailure=result;
      }catch(error){
        checkCancellation();
        if(!deadlineController.signal.aborted)lastFailure=classify(requestController.signal.aborted?requestController.signal.reason:error);
      }finally{clearTimeout(requestTimer);}
      if(lastFailure.reason==='dns'&&deadline<started+dnsTimeoutMs&&!deadlineController.signal.aborted){deadline=started+dnsTimeoutMs;armDeadline();}
      if(now()>=deadline||deadlineController.signal.aborted)break;
      report();
      try{await withAbort(()=>sleep(Math.min(retryDelayMs,Math.max(0,deadline-now())),overallSignal),overallSignal);}
      catch{checkCancellation();if(deadlineController.signal.aborted)break;throw cancelled();}
    }
    checkCancellation();throw new ConnectorReadinessError(lastFailure,attempts,elapsed());
  }finally{clearTimeout(deadlineTimer);}
}
