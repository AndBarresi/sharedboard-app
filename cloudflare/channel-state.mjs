// SharedBoard.app — Andrew Barresi (https://github.com/AndBarresi). MIT.
// Scoped credentials and routing receipts only. Captures and replies stay in the browser.
import {fail,hash,secret,tokenSession,uuid,object} from './protocol.mjs';

const KEY='local-channel.v1',MAX_CLAIMS=1024,GRANT_TTL=90*24*60*60_000;
export const CHANNEL_PRESENCE_TTL=45_000;
export const channelProvider=mode=>mode==='claude-channel'?'claude-code':mode==='codex-channel'?'codex':null;
const receiptFor=(kind,id)=>`ch_${kind}_${id}`;
const transact=(storage,operation)=>typeof storage.transaction==='function'?storage.transaction(operation):operation(storage);
const denied=()=>fail('This local AI channel authorization is unavailable. Reconnect from the board.',403,'CHANNEL_UNAUTHORIZED');
const validState=(state,meta,now)=>state?.actor==='local-channel'&&!state.revoked&&channelProvider(meta?.mode)===meta?.provider&&!meta.revoked&&meta.authorizedClient==='sharedboard-local-channel'&&state.mode===meta.mode&&state.provider===meta.provider&&state.sessionId===meta.id&&state.boardId===meta.boardId&&state.familyId===meta.authorizedFamily&&state.permission===meta.permission&&state.expiresAt>now;

export class ChannelState{
 constructor(storage,{now=Date.now}={}){this.storage=storage;this.now=now;}
 async pair(input){
  if(!object(input))throw fail('Choose this board’s local AI connection code.');
  if(input.expectedDeliveryMode!==undefined&&!channelProvider(input.expectedDeliveryMode))throw fail('Choose the matching local AI plugin.',400,'CHANNEL_PROVIDER_MISMATCH');
  const sessionId=tokenSession(input.connectionCode),instanceId=uuid(input.instanceId,'channel instance ID');
  if(input.providerSessionId!==undefined&&(typeof input.providerSessionId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(input.providerSessionId)))throw fail('Use the actual AI conversation identifier.');
  if(input.label!==undefined&&(typeof input.label!=='string'||!input.label.trim()||input.label.length>80))throw fail('Use a connection label from 1 to 80 characters.');
  const codeHash=await hash(input.connectionCode.slice(37)),channelToken=`${sessionId}.${secret()}`,tokenHash=await hash(channelToken),providerSessionHash=input.providerSessionId?await hash(input.providerSessionId):undefined,now=this.now();
  return transact(this.storage,async storage=>{
   const meta=await storage.get('session');
   if(!meta||meta.id!==sessionId||!channelProvider(meta.mode)||channelProvider(meta.mode)!==meta.provider||meta.revoked)throw denied();
   if(input.expectedDeliveryMode!==undefined&&input.expectedDeliveryMode!==meta.mode)throw fail('This connection code belongs to another AI app. Use the matching plugin or prepare a new connection on the website.',409,'CHANNEL_PROVIDER_MISMATCH');
   if(meta.activatedAt||await storage.get(KEY))throw fail('This board is already paired. Disconnect it on the website before pairing another AI conversation.',409,'CHANNEL_ALREADY_PAIRED');
   if(!meta.codeHash||meta.pairingExpiresAt<=now||meta.expiresAt<=now||meta.codeHash!==codeHash)throw fail('The connection code is invalid or expired. Prepare a new connection on the website.',403,'PAIRING_EXPIRED');
   const familyId=crypto.randomUUID(),generation=crypto.randomUUID(),expiresAt=now+GRANT_TTL;
   const state={actor:'local-channel',mode:meta.mode,provider:meta.provider,sessionId,boardId:meta.boardId,instanceId,familyId,generation,tokenHash,permission:meta.permission,expiresAt,createdAt:now,claims:[],...(providerSessionHash?{providerSessionHash}:{})};
   const updated={...meta,authorizedClient:'sharedboard-local-channel',authorizedScope:meta.permission==='edit'?'board.read board.write':'board.read',authorizedFamily:familyId,activatedAt:new Date(now).toISOString(),expiresAt,label:input.label?.trim()||(meta.provider==='codex'?'My Codex session':'My Claude Code session')};
   delete updated.codeHash;await storage.put(KEY,state);await storage.put('session',updated);
   return {channelToken,state,meta:updated};
  });
 }
 async authorize(token,instanceId,meta){
  try{if(tokenSession(token)!==meta?.id||uuid(instanceId,'channel instance ID')!==instanceId)throw denied();}catch{throw denied();}
  const tokenHash=await hash(token),state=await this.storage.get(KEY);
  if(!validState(state,meta,this.now())||state.instanceId!==instanceId||state.tokenHash!==tokenHash)throw denied();
  return state;
 }
 async state(meta){const state=await this.storage.get(KEY);return validState(state,meta,this.now())?state:null;}
 async claim(input,meta){
  const id=uuid(input.id,'request ID');if(!['chat','review'].includes(input.kind)||!['discuss','work'].includes(input.intent??'discuss'))throw fail('Choose a captured board request.',400,'CHANNEL_REQUEST_INVALID');
  return transact(this.storage,async storage=>{
   const state=await storage.get(KEY);if(!validState(state,meta,this.now())||state.instanceId!==input.instanceId)throw denied();
   const previous=state.claims.find(item=>item.id===id&&item.kind===input.kind);
   if(previous)return {claim:previous,created:false};
   if(state.claims.length>=MAX_CLAIMS)throw fail('This channel has reached its request limit. Reconnect it before sending more.',429,'CHANNEL_REQUEST_LIMIT');
   if(input.kind==='chat'&&state.claims.some(item=>item.kind==='chat'&&!item.completedAt))throw fail('Wait for the previous mini-chat reply before sending another message.',409,'CHAT_REPLY_PENDING');
   if(!state.verifiedAt&&!input.test)throw fail('Run the website’s automatic-reply test first.',409,'CHANNEL_NOT_VERIFIED');
   const claim={id,kind:input.kind,intent:input.kind==='review'?'discuss':input.intent??'discuss',instanceId:state.instanceId,receipt:receiptFor(input.kind,id),claimedAt:this.now(),...(input.test?{test:true}:{})};
   state.claims.push(claim);await storage.put(KEY,state);return {claim,created:true};
  });
 }
 async mark(kind,id,stage,meta,{instanceId,receipt}={}){
  uuid(id,'request ID');if(!['chat','review'].includes(kind)||!['written','read','completed'].includes(stage))throw fail('Choose a valid channel receipt.',400,'CHANNEL_RECEIPT_INVALID');
  return transact(this.storage,async storage=>{
   const state=await storage.get(KEY);if(!validState(state,meta,this.now())||state.instanceId!==instanceId)throw denied();
   const claim=state.claims.find(item=>item.id===id&&item.kind===kind&&item.instanceId===instanceId);if(!claim)return false;
   if(receipt!==undefined&&receipt!==claim.receipt)throw fail('This transport receipt belongs to another request.',409,'CHANNEL_RECEIPT_INVALID');
   if(stage==='completed'&&!claim.readAt)throw fail('Read this captured request before completing it.',409,'CHANNEL_REQUEST_UNREAD');
   claim[stage+'At']??=this.now();if(stage==='completed'&&kind==='chat')state.verifiedAt??=this.now();await storage.put(KEY,state);return true;
  });
 }
 async revoke(){await transact(this.storage,async storage=>{const state=await storage.get(KEY);if(state){state.revoked=true;await storage.put(KEY,state);}});}
}
