// SharedBoard.app — Copyright (c) 2026 Andrew Barresi. MIT licensed.
// Routing metadata only. Drawing captures, message text and replies remain in the browser.
import {fail,hash,secret,uuid,manualPrompt,object} from './protocol.mjs';

const VIEW_TTL=60*60*1000,LEASE_TTL=30*1000,MAX_VIEWS=4,MAX_RECEIPTS=100;
const HEX=/^[a-f0-9]{64}$/i;
const invalidView=()=>fail('This conversation panel is invalid or expired. Open it again from the SharedBoard tool.',403,'PANEL_VIEW_INVALID');
const notLinked=()=>fail('Link this conversation panel again before forwarding board requests.',409,'PANEL_NOT_LINKED');
const sameHash=(left,right)=>{
 if(typeof left!=='string'||typeof right!=='string'||left.length!==right.length)return false;
 let difference=0;for(let index=0;index<left.length;index++)difference|=left.charCodeAt(index)^right.charCodeAt(index);return difference===0;
};
function context(options){
 if(!options?.storage?.get||!options.storage.put||!options.storage.delete||typeof options.storage.transaction!=='function')throw fail('The conversation panel storage is unavailable.',503,'PANEL_STORAGE_UNAVAILABLE');
 const boardId=uuid(options.boardId,'board ID'),connectionId=uuid(options.connectionId,'connection ID'),familyId=uuid(options.familyId,'authorization family ID');
 const clock=options.now??Date.now;if(typeof clock!=='function')throw fail('The conversation panel clock is invalid.',500,'PANEL_STATE_INVALID');
 const result={...options,boardId,connectionId,familyId,hash:options.hash??hash,randomSecret:options.randomSecret??secret,key:`panel:v1:${boardId}:${connectionId}:${familyId}`};
 Object.defineProperty(result,'now',{get(){const value=clock();if(!Number.isSafeInteger(value)||value<0)throw fail('The conversation panel clock is invalid.',500,'PANEL_STATE_INVALID');return value;}});return result;
}
function fresh(options){return {boardId:options.boardId,connectionId:options.connectionId,familyId:options.familyId,views:[],lease:null,generation:0,requests:[]};}
async function load(transaction,options){
 const state=await transaction.get(options.key);if(!state)return fresh(options);
 if(state.boardId!==options.boardId||state.connectionId!==options.connectionId||state.familyId!==options.familyId||!Array.isArray(state.views)||!Array.isArray(state.requests)||!Number.isSafeInteger(state.generation)||state.generation<0)throw fail('The conversation panel state does not match this authorization.',403,'PANEL_SCOPE_MISMATCH');
 return state;
}
const active=(state,options)=>Boolean(state.lease&&state.lease.expiresAt>options.now&&state.views.some(view=>view.expiresAt>options.now&&sameHash(view.viewHash,state.lease.viewHash)));
const owns=(state,viewHash,options)=>active(state,options)&&sameHash(state.lease.viewHash,viewHash);
function publicState(state,options,viewHash){
 const linked=Boolean(viewHash&&owns(state,viewHash,options));
 return {linked,boardId:options.boardId,connectionId:options.connectionId,...(typeof options.label==='string'?{label:options.label.slice(0,80)}:{}),...(['read','edit'].includes(options.permission)?{permission:options.permission}:{}),pending:linked?state.requests.filter(item=>item.generation===state.lease.generation&&item.status==='pending').map(({id,kind,intent})=>({id,kind,intent,status:'pending',delivery:'panel'})):[],expiresAt:linked?new Date(state.lease.expiresAt).toISOString():null};
}
async function checkedHash(value,options){
 const digest=await options.hash(value);if(typeof digest!=='string'||!HEX.test(digest))throw fail('The conversation panel key could not be secured.',500,'PANEL_STATE_INVALID');return digest.toLowerCase();
}
async function viewHash(input,options){if(!object(input)||typeof input.viewKey!=='string'||!HEX.test(input.viewKey))throw invalidView();return checkedHash(input.viewKey.toLowerCase(),options);}
function checkedView(state,digest,options){const view=state.views.find(view=>sameHash(view.viewHash,digest));if(!view||view.expiresAt<=options.now)throw invalidView();return view;}
function requestInput(input){
 if(!object(input)||!['chat','review'].includes(input.kind)||!['discuss','work'].includes(input.intent??'discuss'))throw fail('Choose a saved board message or review.',400,'PANEL_REQUEST_INVALID');
 const id=uuid(input.id,'request ID'),intent=input.intent??'discuss';if(input.kind==='review'&&intent!=='discuss')throw fail('A board review permits inspection only.',400,'PANEL_REQUEST_INVALID');return {id,kind:input.kind,intent};
}

export async function panelStatus(configuration){
 const options=context(configuration);return options.storage.transaction(async transaction=>{const state=await load(transaction,options),linked=active(state,options);return {linked,expiresAt:linked?new Date(state.lease.expiresAt).toISOString():null};});
}

export async function panelOperation(operation,input={},configuration){
 const options=context(configuration);
 if(!['open','attach','state','detach','claim','confirm'].includes(operation))throw fail('This conversation panel operation is not supported.',400,'PANEL_OPERATION_INVALID');
 let key,digest;if(operation==='open'){key=await options.randomSecret();if(typeof key!=='string'||!HEX.test(key))throw fail('The conversation panel key could not be created.',500,'PANEL_STATE_INVALID');key=key.toLowerCase();digest=await checkedHash(key,options);}else digest=await viewHash(input,options);
 return options.storage.transaction(async transaction=>{
  const state=await load(transaction,options);
  if(operation==='open'){
   state.views=state.views.filter(view=>view.expiresAt>options.now);if(state.views.length>=MAX_VIEWS)throw fail('This board already has four conversation panels. Reuse one or wait for an older panel to expire.',429,'PANEL_VIEW_LIMIT');
   if(state.views.some(view=>sameHash(view.viewHash,digest)))throw fail('A unique conversation panel key could not be created.',500,'PANEL_STATE_INVALID');
   state.views.push({viewHash:digest,expiresAt:options.now+VIEW_TTL});await transaction.put(options.key,state);return {...publicState(state,options,digest),viewKey:key};
  }
  const view=checkedView(state,digest,options);
  if(operation==='attach'){
   if(!state.lease||!sameHash(state.lease.viewHash,digest)){state.generation++;if(!Number.isSafeInteger(state.generation))throw fail('The conversation panel must be reopened.',409,'PANEL_STATE_INVALID');state.lease={viewHash:digest,generation:state.generation,expiresAt:0};}
   state.lease.expiresAt=Math.min(options.now+LEASE_TTL,view.expiresAt);await transaction.put(options.key,state);return publicState(state,options,digest);
  }
  if(operation==='state'){
   // Polling renews only a still-active lease owned by this exact view. It must
   // never revive an expired or replaced link without an explicit attach.
   if(owns(state,digest,options)){state.lease.expiresAt=Math.min(options.now+LEASE_TTL,view.expiresAt);await transaction.put(options.key,state);}return publicState(state,options,digest);
  }
  if(operation==='detach'){
   if(state.lease&&sameHash(state.lease.viewHash,digest)){state.lease.expiresAt=0;await transaction.put(options.key,state);}return publicState(state,options,digest);
  }
  if(!owns(state,digest,options))throw notLinked();
  if(operation==='claim'){
   const id=uuid(input.id,'request ID');if(!['chat','review'].includes(input.kind))throw fail('Choose a saved message or review.',400,'PANEL_REQUEST_INVALID');
   const item=state.requests.find(item=>item.id===id&&item.kind===input.kind);
   if(!item||item.generation!==state.lease.generation)throw fail('That saved request belongs to another conversation panel.',409,'PANEL_REQUEST_REPLACED');
   if(item.status!=='pending')throw fail('This request was already claimed. Check the conversation before sending anything again.',409,'PANEL_REQUEST_CLAIMED');
   item.status='claimed';item.claimedAt=options.now;await transaction.put(options.key,state);
   return {...publicState(state,options,digest),receipt:item.receipt,prompt:manualPrompt(item.kind,item.id,options.boardId)};
  }
  if(typeof input.receipt!=='string'||input.receipt.length>128)throw fail('Choose the claimed request receipt.',400,'PANEL_RECEIPT_INVALID');
  const item=state.requests.find(item=>item.receipt===input.receipt&&item.generation===state.lease.generation);
  if(!item||!['claimed','delivered'].includes(item.status))throw fail('This receipt does not belong to a claimed request in this conversation panel.',409,'PANEL_RECEIPT_INVALID');
  if(item.status==='claimed'){item.status='delivered';item.deliveredAt=options.now;await transaction.put(options.key,state);}return publicState(state,options,digest);
 });
}

export async function queuePanelRequest(input,configuration){
 const options=context(configuration),request=requestInput(input);
 return options.storage.transaction(async transaction=>{
  const state=await load(transaction,options);if(!active(state,options))throw notLinked();
  const existing=state.requests.find(item=>item.id===request.id);
  if(existing){if(existing.generation!==state.lease.generation)throw fail('This request belongs to an earlier conversation panel. It will not be forwarded again.',409,'PANEL_REQUEST_REPLACED');if(existing.kind!==request.kind||existing.intent!==request.intent)throw fail('This request ID already belongs to different saved content.',409,'PANEL_REQUEST_CONFLICT');return {receipt:existing.receipt};}
  if(state.requests.length>=MAX_RECEIPTS)throw fail('This connection has reached its saved forwarding limit. Reconnect the board before sending more requests.',429,'PANEL_REQUEST_LIMIT');
  const receipt=`panel_${await checkedHash(JSON.stringify([options.boardId,options.connectionId,options.familyId,state.lease.generation,request.kind,request.id]),options)}`;
  if(!active(state,options))throw notLinked();
  state.requests.push({...request,generation:state.lease.generation,status:'pending',receipt,queuedAt:options.now});await transaction.put(options.key,state);return {receipt};
 });
}

export async function clearPanel(configuration){const options=context(configuration);return options.storage.transaction(async transaction=>{await transaction.delete(options.key);return {linked:false,expiresAt:null};});}
