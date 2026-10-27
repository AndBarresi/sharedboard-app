// SharedBoard.app — Copyright (c) 2026 Andrew Barresi. MIT licensed.
// Finite active tool calls, not a route for waking an idle conversation.
// Durable state contains routing IDs and claim receipts only, never captures.
import {fail,hash,uuid,object} from './protocol.mjs';

const SESSION_TTL=20*60_000,DEFAULT_WAIT=40_000,MAX_WAIT=45_000,MAX_RECEIPTS=512;
const stopped=()=>fail('This live session is no longer waiting. Start a new live session explicitly in the intended conversation.',409,'LIVE_SESSION_NOT_WAITING');
export class LiveSession{
 constructor(options){
  if(!options?.storage?.get||!options.storage.put||!options.storage.delete||!options.storage.transaction)throw fail('Live-session storage is unavailable.',503,'LIVE_STORAGE_UNAVAILABLE');
  this.options=options;this.storage=options.storage;this.boardId=uuid(options.boardId,'board ID');this.connectionId=uuid(options.connectionId,'connection ID');this.familyId=uuid(options.familyId,'authorization family ID');this.key=`live:v1:${this.boardId}:${this.connectionId}:${this.familyId}`;this.waiter=null;this.closed=false;
 }
 now(){const value=(this.options.now??Date.now)();if(!Number.isSafeInteger(value)||value<0)throw fail('The live-session clock is invalid.',500,'LIVE_STATE_INVALID');return value;}
 fresh(){return {boardId:this.boardId,connectionId:this.connectionId,familyId:this.familyId,session:null,requests:[]};}
 async load(storage=this.storage){const state=await storage.get(this.key);if(!state)return this.fresh();if(state.boardId!==this.boardId||state.connectionId!==this.connectionId||state.familyId!==this.familyId||!Array.isArray(state.requests))throw fail('This live-session state belongs to another authorization.',403,'LIVE_SCOPE_MISMATCH');return state;}
 response(session,status,requests=[]){return {sessionId:session.id,boardId:this.boardId,connectionId:this.connectionId,status,requests:requests.map(({id,kind,intent})=>({id,kind,intent})),expiresAt:new Date(session.expiresAt).toISOString()};}
 actualWait(session){const waiter=this.waiter;return Boolean(!this.closed&&session&&waiter?.ready&&!waiter.cancelled&&!waiter.signal?.aborted&&waiter.sessionId===session.id&&waiter.id===session.waitId&&session.status==='waiting'&&session.expiresAt>this.now()&&session.waitExpiresAt>this.now());}
 async changed(){try{await this.options.onChange?.();}catch{/* Status publishing cannot reset a durable claim. */}}
 settle(waiter,result){if(this.waiter!==waiter)return;this.waiter=null;(this.options.clearTimer??clearTimeout)(waiter.timer);if(waiter.abort)waiter.signal?.removeEventListener('abort',waiter.abort);waiter.resolve(result);}
 async status(){if(this.closed)return null;const {session}=await this.load();if(!session)return null;const status=session.expiresAt<=this.now()?'expired':session.status==='stopped'?'stopped':this.actualWait(session)?'waiting':'processing';return {id:session.id,status,expiresAt:new Date(session.expiresAt).toISOString(),waitExpiresAt:status==='waiting'?new Date(session.waitExpiresAt).toISOString():null};}
 async finish(waiter,requestedStatus){
  if(this.waiter!==waiter)return;
  let result;try{result=await this.storage.transaction(async transaction=>{
   const state=await this.load(transaction),session=state.session;if(!session||session.id!==waiter.sessionId)return {sessionId:waiter.sessionId,boardId:this.boardId,connectionId:this.connectionId,status:'stopped',requests:[],expiresAt:new Date(waiter.expiresAt??this.now()).toISOString()};
   const status=session.expiresAt<=this.now()?'expired':requestedStatus;
   if(session.waitId!==waiter.id&&requestedStatus==='timeout'&&status!=='expired')return null; // A committed claim wins over its old timeout.
   if(session.waitId===waiter.id||['stopped','expired'].includes(status)&&this.waiter===waiter){session.status=status==='timeout'?'processing':status;session.waitId=null;session.waitExpiresAt=null;await transaction.put(this.key,state);}
   return this.response(session,status);
  });}catch{
   // A failed cleanup must not leave a live in-memory consumer advertised or
   // an unhandled timer rejection. Durable receipts remain unchanged.
   waiter.cancelled=true;result={sessionId:waiter.sessionId,boardId:this.boardId,connectionId:this.connectionId,status:'stopped',requests:[],expiresAt:new Date(waiter.expiresAt??this.now()).toISOString()};
  }
  if(result)this.settle(waiter,result);await this.changed();
 }
 async wait(input={}, {signal}={}){
  if(this.closed)throw stopped();
  if(!object(input))throw fail('Use live-session wait options.');
  const waitMs=input.waitMs??DEFAULT_WAIT;if(!Number.isSafeInteger(waitMs)||waitMs<1||waitMs>MAX_WAIT)throw fail('Wait for 1 to 45000 milliseconds.',400,'LIVE_WAIT_INVALID');
  const sessionId=input.sessionId===undefined?undefined:uuid(input.sessionId,'live session ID');
  if(signal?.aborted)throw new DOMException('The live-session wait was cancelled.','AbortError');
  if(this.waiter)throw fail('This conversation already has a live wait in progress.',409,'LIVE_WAIT_IN_PROGRESS');
  let resolve;const promise=new Promise(yes=>{resolve=yes;}),waiter={id:crypto.randomUUID(),sessionId:sessionId??null,ready:false,cancelled:false,signal,resolve,promise};this.waiter=waiter;
  try{
   const prepared=await this.storage.transaction(async transaction=>{
    const state=await this.load(transaction);let session=state.session;
    if(sessionId&&(!session||sessionId!==session.id))throw fail('That live session belongs to a different connection or was replaced.',409,'LIVE_SESSION_REPLACED');
    if(sessionId&&(['stopped','expired'].includes(session?.status)||session?.expiresAt<=this.now()))return {terminal:this.response(session,session.expiresAt<=this.now()?'expired':'stopped')};
    if(!sessionId){
     if(session&&session.expiresAt>this.now()&&!['stopped','expired'].includes(session.status))throw fail('An active live session already belongs to this conversation. Resume it using its exact session ID.',409,'LIVE_SESSION_REQUIRED');
     session={id:crypto.randomUUID(),startedAt:this.now(),expiresAt:this.now()+SESSION_TTL,status:'processing',waitId:null,waitExpiresAt:null};state.session=session;
    }
    session.status='waiting';session.waitId=waiter.id;session.waitExpiresAt=Math.min(this.now()+waitMs,session.expiresAt);await transaction.put(this.key,state);return {session};
   });
   if(prepared.terminal){this.settle(waiter,prepared.terminal);return prepared.terminal;}
   waiter.sessionId=prepared.session.id;waiter.expiresAt=prepared.session.expiresAt;waiter.ready=true;
   if(this.waiter!==waiter)return promise;
   if(this.closed||waiter.cancelled){await this.finish(waiter,'stopped');return promise;}
   waiter.abort=()=>{waiter.cancelled=true;void this.finish(waiter,'stopped');};signal?.addEventListener('abort',waiter.abort,{once:true});
   waiter.timer=(this.options.setTimer??setTimeout)(()=>this.finish(waiter,'timeout'),Math.max(0,prepared.session.waitExpiresAt-this.now()));
   if(signal?.aborted)waiter.abort();await this.changed();return promise;
  }catch(error){if(this.waiter===waiter){this.waiter=null;(this.options.clearTimer??clearTimeout)(waiter.timer);if(waiter.abort)signal?.removeEventListener('abort',waiter.abort);}throw error;}
 }
 async queue(input){
  if(this.closed)throw stopped();
  if(!object(input)||!['chat','review'].includes(input.kind)||!['discuss','work'].includes(input.intent??'discuss'))throw fail('Choose a captured live-session request.',400,'LIVE_REQUEST_INVALID');
  const request={id:uuid(input.id,'request ID'),kind:input.kind,intent:input.intent??'discuss'},sessionId=uuid(input.liveSessionId,'captured live session ID');if(request.kind==='review'&&request.intent!=='discuss')throw fail('A review permits inspection only.',400,'LIVE_REQUEST_INVALID');
  const outcome=await this.storage.transaction(async transaction=>{
   const state=await this.load(transaction),session=state.session;if(!session||session.id!==sessionId)throw fail('This captured request belongs to its original live session.',409,'LIVE_SESSION_REPLACED');
   const existing=state.requests.find(item=>item.id===request.id);
   if(existing){if(existing.sessionId!==sessionId||existing.kind!==request.kind||existing.intent!==request.intent)throw fail('This request ID belongs to another saved live-session request.',409,'LIVE_REQUEST_CONFLICT');return {receipt:existing.receipt};}
   if(!this.actualWait(session))throw stopped();if(state.requests.length>=MAX_RECEIPTS)throw fail('This connection reached its live-session forwarding limit. Reconnect before sending more.',429,'LIVE_REQUEST_LIMIT');
   const waiter=this.waiter,receipt=`live_${await hash(JSON.stringify([this.boardId,this.connectionId,this.familyId,sessionId,request.kind,request.id]))}`;
   if(this.waiter!==waiter||!this.actualWait(session))throw stopped();
   // Commit the claim before the tool result can leave this process. A lost
   // result remains uncertain and must never be automatically replayed.
   state.requests.push({...request,sessionId,receipt,status:'claimed',claimedAt:this.now()});session.status='processing';session.waitId=null;session.waitExpiresAt=null;await transaction.put(this.key,state);return {receipt,waiter,result:this.response(session,'request',[request])};
  });
  if(outcome.waiter){if(outcome.waiter.cancelled||outcome.waiter.signal?.aborted)await this.finish(outcome.waiter,'stopped');else if(outcome.waiter.expiresAt<=this.now())await this.finish(outcome.waiter,'expired');else this.settle(outcome.waiter,outcome.result);}await this.changed();return {receipt:outcome.receipt};
 }
 async stop(input={}){
  const sessionId=uuid(input.sessionId,'live session ID');
  const result=await this.storage.transaction(async transaction=>{const state=await this.load(transaction),session=state.session;if(!session||session.id!==sessionId)throw fail('That live session was replaced. Refresh the board connection.',409,'LIVE_SESSION_REPLACED');session.status=session.expiresAt<=this.now()?'expired':'stopped';session.waitId=null;session.waitExpiresAt=null;await transaction.put(this.key,state);return this.response(session,session.status);});
  if(this.waiter?.sessionId===sessionId)this.settle(this.waiter,result);await this.changed();return result;
 }
 async clear(){this.closed=true;const waiter=this.waiter;if(waiter)waiter.cancelled=true;await this.storage.transaction(async transaction=>{await transaction.delete(this.key);});if(waiter?.sessionId)this.settle(waiter,{sessionId:waiter.sessionId,boardId:this.boardId,connectionId:this.connectionId,status:'stopped',requests:[],expiresAt:new Date(waiter.expiresAt??this.now()).toISOString()});await this.changed();}
}
