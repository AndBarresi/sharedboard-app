// SharedBoard.app — Andrew Barresi (https://github.com/AndBarresi). MIT.
// Only routing/subscription metadata is durable. Message bodies stay in the browser.
import * as z from 'zod/v4';
const SUBSCRIPTIONS='events.subscriptions.v1',DELIVERIES='events.deliveries.v1',GENERATION='events.generation.v1';
const DEFAULT_TTL=60*60*1000,MAX_TTL=24*60*60*1000,MIN_TTL=60*1000,VERIFY_CACHE=5*60*1000;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const encoder=new TextEncoder();
const activationReasons=new Set(['subscription_received','callback_verified','callback_not_approved','invalid_callback','challenge_failed','timeout','callback_unavailable','redirect_blocked','conversation_already_connected','scope_mismatch','invalid_parameters','connection_changed','callback_failed','internal_error']);
const activationKey=options=>`events.activation.v1:${options.principal}:${options.boardId}`;
function activationOrigin(params,options){
  if(!params||typeof params!=='object'||Array.isArray(params)||!params.arguments||typeof params.arguments!=='object'||Array.isArray(params.arguments)||Object.keys(params.arguments).length!==1||params.arguments.boardId!==options.boardId)return undefined;
  try{const value=params.delivery?.url;if(typeof value!=='string'||value.length>2048)return undefined;const url=new URL(value);if(url.protocol==='https:'&&!url.username&&!url.password&&!url.port)return url.origin;}catch{}
}
async function saveActivation(options,value,expectedId){
  // Diagnostics must never prevent or replace the original protocol result.
  try{const write=async storage=>{if(expectedId&&(await storage.get(activationKey(options)))?.id!==expectedId)return;await storage.put(activationKey(options),value);};if(typeof options.storage.transaction==='function')await options.storage.transaction(write);else await write(options.storage);}catch{}
}
async function activationStatus(options){
  const value=await options.storage.get(activationKey(options));
  if(!value||!['pending','rejected','verified'].includes(value.outcome)||!activationReasons.has(value.reason)||typeof value.attemptedAt!=='string'||!Number.isFinite(Date.parse(value.attemptedAt)))return null;
  let origin;try{const parsed=new URL(value.callbackOrigin);if(parsed.protocol==='https:'&&parsed.origin===value.callbackOrigin&&!parsed.username&&!parsed.password&&!parsed.port)origin=parsed.origin;}catch{}
  return {attemptedAt:new Date(value.attemptedAt).toISOString(),outcome:value.outcome,reason:value.reason,...(origin?{callbackOrigin:origin}:{})};
}
function activationReason(error){
  if(activationReasons.has(error?.data?.reason))return error.data.reason;
  return error?.code===-32001?'scope_mismatch':error?.code===-32602?'invalid_parameters':error?.code===-32000?'connection_changed':error?.code===-32015?'callback_failed':'internal_error';
}
const failure=(message,code=-32602,data)=>Object.assign(new Error(message),{code,...(data?{data}:{})});
const inputSchema={type:'object',properties:{boardId:{type:'string',format:'uuid'}},required:['boardId'],additionalProperties:false};
const payloadSchema={type:'object',properties:{boardId:{type:'string',format:'uuid'},id:{type:'string',format:'uuid'},kind:{enum:['chat','review']},intent:{enum:['discuss','work']}},required:['boardId','id','kind','intent'],additionalProperties:false};
export const eventCatalog=Object.freeze([
  {name:'sharedboard.message.created',description:'A user sent a mini-chat message on this board. Read the captured message with read_chat_message and honor its Discuss or Request work intent. Return the actual answer through reply_to_chat_message.',delivery:['webhook'],inputSchema,payloadSchema},
  {name:'sharedboard.review.requested',description:'A user requested inspection of a captured drawing. Read the captured review and explain it; a review does not authorize drawing changes. Acknowledge with complete_review_request.',delivery:['webhook'],inputSchema,payloadSchema},
]);

export function attachEventHandlers(mcp,call){
  const server=mcp.server??mcp;
  server.registerCapabilities({events:{}});
  const name=z.enum(eventCatalog.map(event=>event.name)),argumentsSchema=z.object({boardId:z.string().uuid()}).strict();
  const delivery=z.object({mode:z.literal('webhook'),url:z.string().min(1).max(2048),secret:z.string().min(1).optional()}).passthrough();
  const shapes={
    'events/list':z.object({cursor:z.null().optional()}).passthrough(),
    'events/subscribe':z.object({name,arguments:argumentsSchema,delivery,cursor:z.null().optional(),ttlMs:z.number().int().positive().nullable().optional()}).passthrough(),
    'events/unsubscribe':z.object({name,arguments:argumentsSchema,delivery}).passthrough(),
  };
  for(const [method,params] of Object.entries(shapes))server.setRequestHandler(method,{params,result:z.unknown()},input=>call(method,input));
  return mcp;
}

function context(options){
  if(!options||typeof options.principal!=='string'||!options.principal||options.principal.length>256||!UUID.test(options.boardId)||!options.storage?.get||!options.storage?.put)throw failure('An authenticated board connection is required.',-32001);
  return {...options,now:options.now??Date.now,callbackFetch:options.callbackFetch??globalThis.fetch,allowedCallbackOrigins:options.allowedCallbackOrigins??[]};
}
const equal=(left,right)=>{
  const a=encoder.encode(String(left)),b=encoder.encode(String(right));
  if(a.length!==b.length)return false;
  let difference=0;for(let i=0;i<a.length;i++)difference|=a[i]^b[i];return difference===0;
};
const base64=bytes=>btoa(String.fromCharCode(...bytes));
function secretBytes(secret){
  if(typeof secret!=='string'||!/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(secret))throw failure('The callback signing secret must be a valid whsec_ key.');
  let bytes;try{bytes=Uint8Array.from(atob(secret.slice(6)),character=>character.charCodeAt(0));}catch{throw failure('The callback signing secret must be a valid whsec_ key.');}
  if(bytes.length<24||bytes.length>64||base64(bytes).replace(/=+$/,'')!==secret.slice(6).replace(/=+$/,''))throw failure('The callback signing key must contain 24 to 64 random bytes.');
  return bytes;
}
async function digest(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');}
function allowedOrigins(value){
  const entries=typeof value==='string'?value.split(',').map(item=>item.trim()).filter(Boolean):value;
  if(!Array.isArray(entries)||entries.length>8)throw failure('Automatic delivery is unavailable until the operator approves the provider callback origin.',-32015,{reason:'callback_not_approved'});
  const output=new Set();
  for(const entry of entries){
    let url;try{url=new URL(entry);}catch{continue;}
    if(url.protocol==='https:'&&url.origin===entry&&url.pathname==='/'&&!url.username&&!url.password&&!url.search&&!url.hash&&!url.port&&url.hostname.includes('.')&&!/^[\d.]+$/.test(url.hostname)&&!url.hostname.includes(':')&&!/(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(url.hostname))output.add(url.origin);
  }
  return output;
}
function callbackUrl(value,options,{requireApproval=true}={}){
  let url;try{if(typeof value!=='string'||value.length>2048)throw new Error();url=new URL(value);}catch{throw failure('Use a valid HTTPS provider callback.',-32015,{reason:'invalid_callback'});}
  if(url.protocol!=='https:'||url.username||url.password||url.hash||url.port)throw failure('Use a valid HTTPS provider callback.',-32015,{reason:'invalid_callback'});
  if(requireApproval&&!allowedOrigins(options.allowedCallbackOrigins).has(url.origin))throw failure('Automatic delivery is unavailable until the operator approves this provider callback origin.',-32015,{reason:'callback_not_approved',callbackOrigin:url.origin});
  return url.href;
}
async function subscriptions(options){
  const stored=await options.storage.get(SUBSCRIPTIONS),entries=Array.isArray(stored)?stored:[];
  const active=entries.filter(entry=>Number.isSafeInteger(entry.expiresAt)&&entry.expiresAt>options.now());
  if(active.length!==entries.length)await options.storage.put(SUBSCRIPTIONS,active);
  return active;
}
function matches(entry,options){return entry.principal===options.principal&&entry.boardId===options.boardId;}
function eventInput(params,options,{unsubscribe=false}={}){
  if(!params||typeof params!=='object'||Array.isArray(params)||!eventCatalog.some(event=>event.name===params.name))throw failure('Choose a supported SharedBoard event.');
  const args=params.arguments;
  if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).length!==1||args.boardId!==options.boardId)throw failure('This event subscription must target the authenticated board.',-32001);
  if(params.delivery?.mode!=='webhook')throw failure('SharedBoard events require webhook delivery.');
  const url=callbackUrl(params.delivery.url,options,{requireApproval:!unsubscribe});
  if(!unsubscribe)secretBytes(params.delivery.secret);
  if(params.cursor!==undefined&&params.cursor!==null)throw failure('These browser-owned events do not support replay cursors.');
  return {name:params.name,url,secret:params.delivery.secret};
}
async function signature(secret,id,timestamp,body){
  const key=await crypto.subtle.importKey('raw',secretBytes(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return `v1,${base64(new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(`${id}.${timestamp}.${body}`))))}`;
}
async function signedRequest(subscription,body,id,options){
  const destination=callbackUrl(subscription.url,options),timestamp=String(Math.floor(options.now()/1000));
  const secrets=[subscription.secret,...(subscription.previousSecret&&subscription.previousSecretUntil>options.now()?[subscription.previousSecret]:[])];
  const signatures=await Promise.all(secrets.map(secret=>signature(secret,id,timestamp,body)));
  // Workers' native fetch rejects an unrelated method receiver. Invoke the
  // injected fetch function detached, preserving its ordinary fetch interface.
  const send=options.callbackFetch;
  return send(destination,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json','Accept':'application/json','Cache-Control':'no-store','webhook-id':id,'webhook-timestamp':timestamp,'webhook-signature':signatures.join(' '),'X-MCP-Subscription-Id':subscription.id},body});
}
async function smallJson(response){
  if(!response.body)throw failure('The provider callback did not return a verification challenge.',-32015,{reason:'challenge_failed'});
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>8192)throw new Error('limit');chunks.push(value);}}catch{await reader.cancel().catch(()=>{});throw failure('The provider callback verification response was invalid.',-32015,{reason:'challenge_failed'});}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw failure('The provider callback verification response was invalid.',-32015,{reason:'challenge_failed'});}
}
async function verify(subscription,options){
  const challenge=crypto.randomUUID(),body=JSON.stringify({type:'verification',challenge});let response;
  try{response=await signedRequest(subscription,body,`verify_${crypto.randomUUID()}`,options);}catch(error){if(error.code)throw error;throw failure('The provider callback could not be verified.',-32015,{reason:error?.name==='TimeoutError'?'timeout':'callback_unavailable'});}
  if(!response.ok){await response.body?.cancel().catch(()=>{});throw failure('The provider callback could not be verified.',-32015,{reason:response.status>=300&&response.status<400?'redirect_blocked':'challenge_failed'});}
  const result=await smallJson(response);if(!equal(result?.challenge,challenge))throw failure('The provider callback challenge did not match.',-32015,{reason:'challenge_failed'});
}

export async function handleEventRpc(method,params,configuration){
  const options=context(configuration);
  if(method!=='events/subscribe')return eventRpc(method,params,options);
  const origin=activationOrigin(params,options),attempt={id:crypto.randomUUID(),attemptedAt:new Date(options.now()).toISOString(),outcome:'pending',reason:'subscription_received',...(origin?{callbackOrigin:origin}:{})};
  await saveActivation(options,attempt);
  try{const result=await eventRpc(method,params,options);await saveActivation(options,{...attempt,outcome:'verified',reason:'callback_verified'},attempt.id);return result;}
  catch(error){await saveActivation(options,{...attempt,outcome:'rejected',reason:activationReason(error)},attempt.id);throw error;}
}
async function eventRpc(method,params,options){
  if(method==='events/list')return {events:eventCatalog};
  if(!['events/subscribe','events/unsubscribe'].includes(method))throw failure('Unknown event method.',-32601);
  const input=eventInput(params,options,{unsubscribe:method==='events/unsubscribe'}),entries=await subscriptions(options);
  const id=`sub_${(await digest(JSON.stringify([options.principal,options.boardId,input.name,input.url]))).slice(0,40)}`;
  if(method==='events/unsubscribe'){await options.storage.put(GENERATION,(await options.storage.get(GENERATION)??0)+1);await options.storage.put(SUBSCRIPTIONS,entries.filter(entry=>entry.id!==id||!matches(entry,options)));return {};}
  if(params.ttlMs!==undefined&&params.ttlMs!==null&&(!Number.isSafeInteger(params.ttlMs)||params.ttlMs<1))throw failure('The subscription lifetime must be a positive number of milliseconds.');
  const lifetime=Math.max(MIN_TTL,Math.min(params.ttlMs??DEFAULT_TTL,MAX_TTL)),existing=entries.find(entry=>entry.id===id&&matches(entry,options));
  if(entries.some(entry=>matches(entry,options)&&entry.name===input.name&&entry.id!==id))throw failure('This board already sends this event to another conversation. Stop that subscription or disconnect the board before choosing another conversation.',-32000,{reason:'conversation_already_connected'});
  if(!existing&&entries.filter(entry=>matches(entry,options)).length>=4)throw failure('This connection already has four subscriptions. Stop an existing subscription first.',-32000);
  const now=options.now(),entry={id,principal:options.principal,boardId:options.boardId,name:input.name,url:input.url,secret:input.secret,expiresAt:now+lifetime,verifiedAt:now};
  const generation=(await options.storage.get(GENERATION)??0)+1;await options.storage.put(GENERATION,generation);
  if(existing&&existing.secret!==entry.secret){entry.previousSecret=existing.secret;entry.previousSecretUntil=now+VERIFY_CACHE;}
  else if(existing?.previousSecretUntil>now){entry.previousSecret=existing.previousSecret;entry.previousSecretUntil=existing.previousSecretUntil;}
  if(!existing||existing.secret!==entry.secret||existing.verifiedAt+VERIFY_CACHE<=now)await verify(entry,options);
  else entry.verifiedAt=existing.verifiedAt;
  // Reload after the external challenge so a concurrent unsubscribe is not overwritten.
  if(await options.storage.get(GENERATION)!==generation)throw failure('The event connection changed while its callback was being verified. Retry only if you still want this subscription.',-32000);
  const latest=await subscriptions(options);
  if(latest.some(item=>matches(item,options)&&item.name===input.name&&item.id!==id))throw failure('This board event was connected to another conversation during verification. Stop that subscription before trying again.',-32000,{reason:'conversation_already_connected'});
  await options.storage.put(SUBSCRIPTIONS,[...latest.filter(item=>item.id!==id),entry]);
  return {id,refreshBefore:new Date(entry.expiresAt).toISOString(),cursor:null,truncated:false};
}

export async function eventStatus(configuration){
  const options=context(configuration),entries=(await subscriptions(options)).filter(entry=>matches(entry,options)&&allowedOrigins(options.allowedCallbackOrigins).has(new URL(entry.url).origin));
  const message=entries.find(entry=>entry.name==='sharedboard.message.created'),review=entries.find(entry=>entry.name==='sharedboard.review.requested');
  return {automaticMessages:Boolean(message),automaticReviews:Boolean(review),eventSubscriptions:entries.length,eventActivation:await activationStatus(options),eventExpiresAt:entries.length?new Date(Math.min(...entries.map(entry=>entry.expiresAt))).toISOString():null,messageExpiresAt:message?new Date(message.expiresAt).toISOString():null,reviewExpiresAt:review?new Date(review.expiresAt).toISOString():null};
}

export async function clearEventSubscriptions(configuration){
  const options=context(configuration),entries=await subscriptions(options);
  if(typeof options.storage.delete==='function')await options.storage.delete(activationKey(options));else await options.storage.put(activationKey(options),null);
  await options.storage.put(GENERATION,(await options.storage.get(GENERATION)??0)+1);
  await options.storage.put(SUBSCRIPTIONS,entries.filter(entry=>!matches(entry,options)));
  const receipts=await options.storage.get(DELIVERIES);
  if(Array.isArray(receipts))await options.storage.put(DELIVERIES,receipts.filter(entry=>!entries.some(subscription=>matches(subscription,options)&&subscription.id===entry.subscriptionId)));
}

export async function dispatchEvent(input,configuration){
  const options=context(configuration);
  if(!input||!UUID.test(input.id)||!['chat','review'].includes(input.kind)||!['discuss','work'].includes(input.intent??'discuss'))throw failure('Choose a captured chat or review request to deliver.');
  const name=input.kind==='chat'?'sharedboard.message.created':'sharedboard.review.requested',entries=(await subscriptions(options)).filter(entry=>matches(entry,options)&&entry.name===name);
  if(!entries.length)return {delivery:'manual',automaticMessages:false};
  const eventId=`evt_${input.kind}_${input.id}`,body=JSON.stringify({eventId,name,timestamp:new Date(options.now()).toISOString(),data:{boardId:options.boardId,id:input.id,kind:input.kind,intent:input.kind==='review'?'discuss':input.intent??'discuss'},cursor:null});
  let accepted=false,attempted=false;
  for(const entry of entries){
    const receipts=await options.storage.get(DELIVERIES)??[];
    if(receipts.some(receipt=>receipt.subscriptionId===entry.id&&receipt.eventId===eventId)){accepted=true;continue;}
    for(let attempt=0;attempt<3;attempt++){
      // Access, expiry and revocation must be checked again for every retry.
      const current=(await subscriptions(options)).find(item=>item.id===entry.id&&matches(item,options));if(!current)break;
      let response;try{callbackUrl(current.url,options);attempted=true;response=await signedRequest(current,body,eventId,options);}catch(error){if(error.code)break;if(attempt<2){await new Promise(resolve=>setTimeout(resolve,250*2**attempt));continue;}break;}
      await response.body?.cancel().catch(()=>{});
      if(response.ok){accepted=true;const latest=await options.storage.get(DELIVERIES)??[];await options.storage.put(DELIVERIES,[...latest.filter(receipt=>!(receipt.subscriptionId===entry.id&&receipt.eventId===eventId)),{subscriptionId:entry.id,eventId,deliveredAt:options.now()}].slice(-128));break;}
      if(response.status===410){const latest=await subscriptions(options);await options.storage.put(SUBSCRIPTIONS,latest.filter(item=>item.id!==entry.id));break;}
      if(response.status===413||response.status>=300&&response.status<500&&response.status!==429)break;
      if(attempt<2)await new Promise(resolve=>setTimeout(resolve,250*2**attempt));
    }
  }
  return accepted?{delivery:'queued',automaticMessages:true,receipt:eventId}:attempted?{delivery:'uncertain',automaticMessages:false,receipt:eventId}:{delivery:'manual',automaticMessages:false};
}
