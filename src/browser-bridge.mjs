// SharedBoard.app — local bridge transport. Board data stays in browser storage.
const BASE='http://127.0.0.1:4319/bridge';
const failure=(message,status=503,code='BRIDGE_UNAVAILABLE')=>Object.assign(new Error(message),{status,code});
export function validateBridgeDeadline(command,now=Date.now()){
 if(command.expiresAt===undefined)return;
 if(typeof command.expiresAt!=='number'||!Number.isFinite(command.expiresAt)||command.expiresAt<=0)throw failure('The bridge command has an invalid deadline.',400,'INVALID_BRIDGE_DEADLINE');
 if(now>=command.expiresAt)throw failure('This bridge command expired. Read the current board and try again.',409,'STALE_BRIDGE_COMMAND');
}
export function createBrowserBridge({boardId,clientId,load,save,execute,fetch:fetcher=globalThis.fetch,baseURL=BASE,onError=()=>{},pollDelay=1000}={}){
 let closed=false,running=false,abort,timer;
 const pause=()=>new Promise(resolve=>{timer=setTimeout(resolve,pollDelay);});
 async function http(path,{token,body,signal}={}){
  const controller=new AbortController(),cancel=()=>controller.abort(),timeout=setTimeout(cancel,path==='/browser/events'?25000:path==='/browser/notify'?35000:path==='/health'?4000:10000);signal?.addEventListener('abort',cancel,{once:true});
  let response;try{response=await fetcher(`${baseURL}${path}`,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(token?{'x-sharedboard-browser':token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),credentials:'omit',cache:'no-store',signal:controller.signal});}catch(error){if(signal?.aborted)throw error;throw Object.assign(failure('The local SharedBoard bridge could not be reached. Open the bridge and try again.'),{deliveryUnknown:body!==undefined,cause:error});}finally{clearTimeout(timeout);signal?.removeEventListener('abort',cancel);}
  let data;try{data=await response.json();}catch{throw Object.assign(failure('The local bridge returned an unreadable response.'),{deliveryUnknown:body!==undefined});}
  if(!response.ok)throw Object.assign(failure(data.error??'The local bridge could not finish this request.',response.status,data.code??'BRIDGE_ERROR'),{deliveryUnknown:Boolean(data.deliveryUnknown||data.code==='DELIVERY_UNCERTAIN')});
  return data;
 }
 async function updateConnection(state,connection){if(!connection||connection.boardId&&connection.boardId!==boardId||state.connection?.id&&connection.id!==state.connection.id)throw failure('The local bridge returned a connection for another board.',409,'BRIDGE_WRONG_BOARD');return save({...state,connection},{expectedToken:state.browserToken});}
 async function poll(){
  if(running||closed)return;running=true;
  try{while(!closed){const state=await load();if(!state?.browserToken)break;abort=new AbortController();try{
    const data=await http('/browser/events',{token:state.browserToken,body:{clientId},signal:abort.signal});
    const latest=await load();if(closed||latest?.browserToken!==state.browserToken)break;
    if(data.connection)await updateConnection(state,data.connection);
    for(const command of data.commands??[]){if(closed)break;let result,error;try{validateBridgeDeadline(command);result=await execute(command,{browserToken:state.browserToken,connection:data.connection??state.connection});}catch(cause){error={message:cause.message,status:cause.status??400,code:cause.code,...(Array.isArray(cause.conflicts)?{conflicts:cause.conflicts}:{})};}
     await http('/browser/result',{token:state.browserToken,body:{id:command.id,clientId,...(error?{error}:{result})}});
     if(!error&&['confirm_connection','confirm','reply_to_chat_message','reply'].includes(command.operation)){const fresh=await http('/browser/status',{token:state.browserToken});if(fresh.connection)await updateConnection(state,fresh.connection);}
    }
   }catch(error){if(closed||error.name==='AbortError')break;if(error.status===401||error.status===403){const current=await load();if(current?.browserToken===state.browserToken)await save(null,{expectedToken:state.browserToken});break;}await onError(error);await pause();}}
  }finally{running=false;if(!closed){const current=await load().catch(()=>null);if(current?.browserToken)setTimeout(()=>{void poll();},0);}}
 }
 return {
  async detect(){try{const health=await http('/health');if(health.product!=='SharedBoard Bridge'||health.ok===false)throw failure('A different service is using the local bridge address.',503,'BRIDGE_WRONG_SERVICE');return {available:true,version:health.version};}catch(error){return {available:false,detail:error.message,code:error.code};}},
  async pair(input,title){if(input?.provider!=='codex'||!['read','edit'].includes(input?.permission))throw failure('This connection is work in progress. Choose Codex with read or edit access.',501,'HOSTED_CONNECTOR_WIP');const paired=await http('/browser/pair',{body:{boardId,title,permission:input.permission,clientId}});if(typeof paired.browserToken!=='string'||!paired.browserToken.length)throw failure('The bridge did not return a private browser connection.');await save({browserToken:paired.browserToken,connection:{connected:false,boardId,provider:'codex',permission:input.permission,pairingExpiresAt:paired.expiresAt}});void poll();return {pairing:{code:paired.code,expiresAt:paired.expiresAt},setup:paired.setup};},
  async status(){const state=await load();if(!state?.browserToken)return null;try{const data=await http('/browser/status',{token:state.browserToken});await updateConnection(state,data.connection);return data.connection;}catch(error){await onError(error);return (await load())?.connection??null;}},
  async notify(kind,id,{retry=false}={}){const state=await load();if(!state?.browserToken||!state.connection?.connected)throw failure('Connect this board to an existing Codex chat before sending.',409,'BRIDGE_NOT_CONNECTED');const data=await http('/browser/notify',{token:state.browserToken,body:{kind,id,...(retry?{retry:true}:{})}});if(data.delivery!=='queued'||!data.receipt)throw Object.assign(failure('Codex did not confirm delivery. Check the connected conversation before retrying.'),{deliveryUnknown:true});if(data.connection)await updateConnection(state,data.connection);return data.receipt;},
  async disconnect(){const state=await load();if(state?.browserToken)await http('/browser/disconnect',{token:state.browserToken,body:{clientId}});await save(null,{expectedToken:state?.browserToken});abort?.abort();},
  start(){void poll();},
  close(){closed=true;abort?.abort();clearTimeout(timer);void load().then(state=>{if(state?.browserToken)return http('/browser/release',{token:state.browserToken,body:{clientId}});}).catch(()=>{});},
 };
}
