import {isClientProvider} from '../shared/client-profiles.mjs';
// Copyright (c) 2026 Andrew Barresi. SPDX-License-Identifier: MIT
// The open browser owns the board; the hosted relay forwards authorized requests.
export const RELAY_URL='https://connect.sharedboard.app';
const failure=(message,status=503,code='RELAY_UNAVAILABLE')=>Object.assign(new Error(message),{status,code});
export function validateBridgeDeadline(command,now=Date.now()){
 if(command.expiresAt===undefined)return;
 if(typeof command.expiresAt!=='number'||!Number.isFinite(command.expiresAt)||command.expiresAt<=0)throw failure('The AI operation has an invalid deadline.',400,'INVALID_BRIDGE_DEADLINE');
 if(now>=command.expiresAt)throw failure('This AI operation expired. Read the current board and try again.',409,'STALE_BRIDGE_COMMAND');
}
export function checkedRelayURL(value=RELAY_URL){
 const url=new URL(value);
 // Loopback is accepted only through an explicit development dependency injection.
 if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||!(url.origin===RELAY_URL||url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw failure('The relay address is not an approved SharedBoard endpoint.',400,'INVALID_RELAY_URL');
 return url.origin;
}
export function createBrowserBridge({boardId,clientId,load,save,execute,fetch:fetcher=globalThis.fetch,WebSocket:Socket=globalThis.WebSocket,baseURL=RELAY_URL,onError=()=>{},pollDelay=1000}={}){
 const base=checkedRelayURL(baseURL);
 let closed=false,opening=false,socket,reconnectTimer,heartbeatTimer,attempt=0,messageChain=Promise.resolve();
 const report=async error=>{if(!closed)try{await onError(error);}catch{ /* Storage may close while an in-flight network operation finishes. */ }};
 async function http(path,{token,body,signal}={}){
  const controller=new AbortController(),abort=()=>controller.abort(),timeout=setTimeout(abort,path==='/health'?5000:30000);signal?.addEventListener('abort',abort,{once:true});
  let response;try{response=await fetcher(`${base}${path}`,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(token?{'x-sharedboard-browser':token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),credentials:'omit',cache:'no-store',signal:controller.signal});}
  catch(cause){throw Object.assign(failure('The SharedBoard connection service could not be reached. Your board is still saved in this browser.'),{cause,deliveryUnknown:body!==undefined});}finally{clearTimeout(timeout);signal?.removeEventListener('abort',abort);}
  let data;try{data=await response.json();}catch{throw Object.assign(failure('The connection service returned an unreadable response.'),{deliveryUnknown:body!==undefined});}
  if(!response.ok)throw Object.assign(failure(data.error??'The connection request could not be completed.',response.status,data.code??'RELAY_ERROR'),{deliveryUnknown:Boolean(data.deliveryUnknown||data.code==='DELIVERY_UNCERTAIN')});return data;
 }
 async function updateConnection(state,connection){
  if(closed)return false;
  if(!connection||connection.boardId&&connection.boardId!==boardId||state.connection?.id&&connection.id&&connection.id!==state.connection.id)throw failure('The relay returned a connection for another board.',409,'RELAY_WRONG_BOARD');
  return save({...state,connection},{expectedToken:state.browserToken});
 }
 function disconnectSocket(){
  clearTimeout(reconnectTimer);reconnectTimer=null;clearInterval(heartbeatTimer);
  const old=socket;socket=null;if(old){old.onclose=null;old.onerror=null;old.onmessage=null;old.close();}
 }
 async function handleMessage(data,state,owner){
  if(closed||socket!==owner||(await load())?.browserToken!==state.browserToken)return;
  if(data==='pong')return;
  const message=typeof data==='string'?JSON.parse(data):data;
  if(message.type==='pong')return;
  if(message.type==='connection'){await updateConnection(state,message.connection);return;}
  if(message.type==='error'){const detail=message.error;throw failure(detail?.message??(typeof detail==='string'?detail:'The board connection needs attention.'),detail?.status??message.status??503,detail?.code??message.code);}
  if(message.type!=='command')return;
  const command=message.command;let result,error;
  try{validateBridgeDeadline(command);const current=await load();if(current?.browserToken!==state.browserToken)throw failure('This connection has been replaced.',403,'RELAY_REVOKED');result=await execute(command,{browserToken:state.browserToken,connection:current.connection});}
  catch(cause){error={message:cause.message,status:cause.status??400,code:cause.code,...(Array.isArray(cause.conflicts)?{conflicts:cause.conflicts}:{})};}
  if(!closed&&socket===owner&&owner.readyState===1)owner.send(JSON.stringify({type:'result',id:command.id,connectionId:command.connectionId,...(error?{error}:{result})}));
 }
 function scheduleReconnect(){if(closed||reconnectTimer)return;const delay=Math.min(15000,Math.max(20,pollDelay)*2**Math.min(attempt++,4));reconnectTimer=setTimeout(()=>{reconnectTimer=null;void start();},delay);}
 async function start(){
  if(closed||opening||socket&&socket.readyState<2)return;opening=true;
  try{const state=await load();if(!state?.browserToken||closed)return;if(!Socket)throw failure('This browser does not support live board connections.');
   const url=new URL('/browser/socket',base);url.protocol=url.protocol==='https:'?'wss:':'ws:';if(state.sessionId)url.searchParams.set('session',state.sessionId);
   const owner=new Socket(url.href);socket=owner;
   owner.onopen=()=>{attempt=0;owner.send(JSON.stringify({type:'authenticate',browserToken:state.browserToken,clientId}));clearInterval(heartbeatTimer);heartbeatTimer=setInterval(()=>{if(owner.readyState===1)owner.send('ping');},25000);};
   owner.onmessage=event=>{messageChain=messageChain.then(()=>handleMessage(event.data,state,owner)).catch(async error=>{if(closed)return;if(error.status===401||error.status===403){await save(null,{expectedToken:state.browserToken});disconnectSocket();}await report(error);});};
   owner.onerror=()=>{};
   owner.onclose=event=>{if(socket!==owner||closed)return;socket=null;clearInterval(heartbeatTimer);if(event.code===4001||event.code===4003){void save(null,{expectedToken:state.browserToken}).catch(()=>{});return;}if(event.code!==4009)void report(failure('The AI connection is reconnecting. Your drawing stays available in this browser.'));scheduleReconnect();};
  }catch(error){if(!closed){await report(error);scheduleReconnect();}}finally{opening=false;}
 }
 return {
  async detect(){try{const data=await http('/health');if(data.product!=='SharedBoard Relay'||!data.ok)throw failure('The hosted connection service is not ready.');return {available:true,version:data.version};}catch(error){return {available:false,detail:error.message,code:error.code};}},
  async pair(input,title){
   if(!isClientProvider(input?.provider)||!['read','edit'].includes(input?.permission))throw failure('Choose an AI client and read or edit access.',400);
   const previous=await load();if(previous?.browserToken){
    try{await http('/browser/disconnect',{token:previous.browserToken,body:{clientId}});}
    catch(error){if(![401,403].includes(error.status)||error.deliveryUnknown)throw error; /* An expired or revoked grant is already disconnected. */}
    await save(null,{expectedToken:previous.browserToken});
   }disconnectSocket();const paired=await http('/browser/pair',{body:{boardId,title,provider:input.provider,permission:input.permission,clientId}});
   if(typeof paired.browserToken!=='string'||!paired.sessionId||paired.connection?.boardId!==boardId)throw failure('The relay did not return a board-scoped connection.');
   await save({browserToken:paired.browserToken,sessionId:paired.sessionId,connection:paired.connection});void start();return {pairing:paired.pairing,setup:paired.setup};
  },
  async status(){if(closed)return null;let state;try{state=await load();if(!state?.browserToken||closed)return null;const data=await http('/browser/status',{token:state.browserToken});if(closed)return null;await updateConnection(state,data.connection);void start();return data.connection;}catch(error){if(closed)return null;if(error.status===401||error.status===403){await save(null,{expectedToken:state?.browserToken});disconnectSocket();return null;}await report(error);if(closed)return null;return (await load().catch(()=>null))?.connection??null;}},
  async stopLive(sessionId){const state=await load();if(!state?.browserToken||!state.connection?.connected)throw failure('Connect your AI before managing its live session.',409,'RELAY_NOT_CONNECTED');const data=await http('/browser/live/stop',{token:state.browserToken,body:{sessionId}});if(data.connection)await updateConnection(state,data.connection);return data.connection;},
  async notify(kind,id,{retry=false}={}){const state=await load();if(!state?.browserToken||!state.connection?.connected)throw failure('Connect an AI before sending.',409,'RELAY_NOT_CONNECTED');const data=await http('/browser/notify',{token:state.browserToken,body:{kind,id,...(retry?{retry:true}:{})}});if(data.delivery!=='queued'||!data.receipt)throw Object.assign(failure('Automatic delivery was not confirmed. Check your AI conversation before retrying.'),{deliveryUnknown:true});if(data.connection)await updateConnection(state,data.connection);return data.receipt;},
  async handoff(kind,id){const state=await load();if(!state?.browserToken||!state.connection?.connected)throw failure('Connect your AI before preparing this request.',409,'RELAY_NOT_CONNECTED');const data=await http('/browser/handoff',{token:state.browserToken,body:{kind,id,boardId,connectionId:state.connection.id}});if(data.delivery!=='manual'||typeof data.handoffPrompt!=='string'||!data.handoffPrompt.trim())throw failure('The request could not be prepared for your existing AI conversation.');if((await load())?.browserToken!==state.browserToken)throw failure('The board connection changed.',409);if(data.connection)await updateConnection(state,data.connection);return data.handoffPrompt;},
  oauthRequest(id){return http(`/oauth/request?id=${encodeURIComponent(id)}`);},
  async approve(input){if(input?.allow===false)return http('/oauth/deny',{body:{requestId:input.requestId}});const state=await load();if(!state?.browserToken)throw failure('Prepare this board’s connection before approving access.',409);return http('/browser/approve',{token:state.browserToken,body:input});},
  async disconnect(){const state=await load();if(state?.browserToken)await http('/browser/disconnect',{token:state.browserToken,body:{clientId}});await save(null,{expectedToken:state?.browserToken});disconnectSocket();},
  start(){void start();},close(){closed=true;disconnectSocket();},
 };
}
