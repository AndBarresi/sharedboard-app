import {fail,json,body,failureResponse,uuid,secret,hash,tokenSession,object,stable,MAX_RESULT,errorData,manualPrompt,permissionFor} from './protocol.mjs';
import {dispatchEvent,eventStatus,clearEventSubscriptions,handleEventRpc} from './events.mjs';
import {clientProfile,isClientProvider} from '../shared/client-profiles.mjs';
import {panelStatus,panelOperation,clearPanel} from './panel-state.mjs';
import {LiveSession} from './live-session.mjs';
import {pairingInstructions,claudeChannelSetup,codexChannelSetup} from '../shared/connection-instructions.mjs';
import {ChannelState,CHANNEL_PRESENCE_TTL,channelProvider} from './channel-state.mjs';

const supported=new Set(['connection','pair','confirm','read','read_full','visual','reviews','review','complete_review','add','chats','chat','reply','edit']);
const writes=new Set(['add','edit']);
const aliases={read_board:'read',view_board:'visual',add_elements:'add',edit_elements:'edit',confirm_connection:'confirm',list_chat_messages:'chats',read_chat_message:'chat',reply_to_chat_message:'reply',list_review_requests:'reviews',read_review_request:'review',complete_review_request:'complete_review'};
const defaultOrigin='https://connect.sharedboard.app';
const panelDeliveryReason='This AI app may accept a panel message as a composer draft without sending it or starting a model turn. Automatic panel delivery has not been verified and is unavailable.';
export class BoardRelay{
 constructor(ctx,env){this.ctx=ctx;this.env=env;this.pending=new Map();this.liveSessions=new Map();this.channel=new ChannelState(ctx.storage);this.ready=ctx.blockConcurrencyWhile(async()=>{this.meta=await ctx.storage.get('session')??null;});if(typeof WebSocketRequestResponsePair==='function')ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping','pong'));}
 eventContext(){return {principal:this.meta.id,boardId:this.meta.boardId,storage:this.ctx.storage,callbackFetch:fetch,allowedCallbackOrigins:this.env.EVENT_CALLBACK_ORIGINS??''};}
 panelContext(){return {storage:this.ctx.storage,boardId:this.meta.boardId,connectionId:this.meta.id,familyId:this.meta.authorizedFamily,label:this.meta.label,permission:permissionFor(this.meta.authorizedScope)};}
 liveSession(){const key=this.meta.authorizedFamily;if(!this.liveSessions.has(key))this.liveSessions.set(key,new LiveSession({storage:this.ctx.storage,boardId:this.meta.boardId,connectionId:this.meta.id,familyId:key,onChange:()=>this.publish()}));return this.liveSessions.get(key);}
 async connection(){
  const events=this.meta?await eventStatus(this.eventContext()):{},hasGrant=this.meta?.activatedAt&&this.meta.authorizedFamily&&!this.meta.revoked,panel=hasGrant?await panelStatus(this.panelContext()):{linked:false},live=hasGrant?await this.liveSession().status():null,waiting=live?.status==='waiting';
  // Legacy deliveryCheckedAt also recorded panel/event acknowledgements. Only
  // a captured-request read (or an actual saved reply) proves model receipt.
  if(channelProvider(this.meta?.mode)){
   const channel=await this.channelStatus(),automatic=Boolean(channel.channelConnected&&channel.channelVerified&&this.owner()&&!this.meta.revoked);
   return {connected:Boolean(this.meta.activatedAt&&!this.meta.revoked),id:this.meta.id,boardId:this.meta.boardId,provider:this.meta.provider,mode:this.meta.mode,label:this.meta.label??'My local AI session',permission:this.meta.permission,authorized:Boolean(this.meta.authorizedFamily),browserOnline:Boolean(this.owner()),automaticMessages:automatic,automaticReviews:automatic,deliveryMode:this.meta.mode,...channel,messageExpiresAt:automatic?channel.channelExpiresAt:null,reviewExpiresAt:automatic?channel.channelExpiresAt:null,boardCheckedAt:this.meta.boardCheckedAt??null,deliveryCheckedAt:this.meta.modelRequestReadAt??this.meta.replyCheckedAt??null,replyCheckedAt:this.meta.replyCheckedAt??null,connectedAt:this.meta.activatedAt??null,chatIdentityVerified:false,...(this.meta.revoked?{revoked:true}:{})};
  }
  return {connected:Boolean(this.meta?.activatedAt&&!this.meta.revoked),id:this.meta?.id??null,boardId:this.meta?.boardId??null,provider:this.meta?.provider??null,label:this.meta?.label??'Connect an AI',permission:this.meta?.authorizedScope?permissionFor(this.meta.authorizedScope):this.meta?.permission??null,automaticMessages:Boolean(waiting||events.automaticMessages),automaticReviews:Boolean(waiting||events.automaticReviews),liveSession:live,panelConnected:Boolean(panel.linked),panelAutomaticDelivery:false,panelDeliveryReason,panelExpiresAt:panel.expiresAt??null,eventActivation:events.eventActivation??null,eventExpiresAt:events.eventExpiresAt??null,messageExpiresAt:waiting?live.waitExpiresAt:events.messageExpiresAt??null,reviewExpiresAt:waiting?live.waitExpiresAt:events.reviewExpiresAt??null,browserOnline:Boolean(this.owner()),boardCheckedAt:this.meta?.boardCheckedAt??null,deliveryCheckedAt:this.meta?.modelRequestReadAt??this.meta?.replyCheckedAt??null,replyCheckedAt:this.meta?.replyCheckedAt??null,connectedAt:this.meta?.activatedAt??null,authorized:Boolean(this.meta?.authorizedClient),chatIdentityVerified:false,deliveryMode:waiting?'live-session':events.automaticMessages||events.automaticReviews?'events':live?.status==='processing'?'live-session':'manual',...(this.meta?.revoked?{revoked:true}:{})};
 }
 sockets(){return this.ctx.getWebSockets().filter(ws=>{try{const saved=ws.deserializeAttachment();return ws.readyState===1&&saved?.authenticated===true&&saved.role!=='channel';}catch{return false;}});}
 owner(){return this.sockets().find(ws=>ws.deserializeAttachment().owner===true);}
 channelSockets(){return this.ctx.getWebSockets().filter(ws=>{try{return ws.readyState===1&&ws.deserializeAttachment()?.role==='channel';}catch{return false;}});}
 activeChannel(state){return state&&this.channelSockets().find(ws=>{const saved=ws.deserializeAttachment();return saved.authenticated&&saved.instanceId===state.instanceId&&saved.generation===state.generation&&saved.presenceExpiresAt>Date.now();});}
 async channelStatus(){const state=await this.channel.state(this.meta),socket=this.activeChannel(state);return {channelConnected:Boolean(socket),channelVerified:Boolean(socket&&state?.verifiedAt),channelSessionId:state?.instanceId??null,channelExpiresAt:socket?new Date(socket.deserializeAttachment().presenceExpiresAt).toISOString():null};}
 async save(){await this.ctx.storage.put('session',this.meta);}
 async revoke(){this.meta.revoked=true;delete this.meta.codeHash;await this.save();await this.channel.revoke();await clearEventSubscriptions(this.eventContext());if(this.meta.authorizedFamily){await clearPanel(this.panelContext());await this.liveSession().clear();}for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(fail('This board connection ended.',403,'RELAY_DISCONNECTED'));}this.pending.clear();for(const ws of this.ctx.getWebSockets())try{ws.close(ws.deserializeAttachment()?.role==='channel'?4003:1000,'Disconnected from the board');}catch{}return {ok:true};}
 async publish(){const message=JSON.stringify({type:'connection',connection:await this.connection()});for(const ws of this.sockets())try{ws.send(message);}catch{}}
 alive(){if(!this.meta||this.meta.revoked||this.meta.expiresAt<=Date.now())throw fail('This board connection ended. Connect it again from SharedBoard.app.',401,'RELAY_DISCONNECTED');}
 async browser(token){this.alive();if(tokenSession(token)!==this.meta.id||await hash(token)!==this.meta.browserHash)throw fail('Reconnect this browser board from SharedBoard.app.',401,'BROWSER_NOT_PAIRED');return this.meta;}
 checkAuthorized(grant,{connected=true}={}){this.alive();if(channelProvider(this.meta.mode)||!grant||grant.sessionId!==this.meta.id||grant.boardId!==this.meta.boardId||grant.clientId!==this.meta.authorizedClient||grant.scope!==this.meta.authorizedScope||grant.familyId!==this.meta.authorizedFamily)throw fail('This AI authorization no longer belongs to this board.',403,'CONNECTION_REPLACED');if(connected&&!this.meta.activatedAt)throw fail('Paste the board connection instructions into this conversation and call connect_board first.',409,'PAIRING_REQUIRED');}
 async authorized(grant,options){this.checkAuthorized(grant,options);}
 async disconnectAuthorized(grant,input){
  this.checkAuthorized(grant,{connected:false});uuid(input?.expectedBoardId,'expected board ID');uuid(input?.expectedConnectionId,'expected connection ID');
  if(input.expectedBoardId!==this.meta.boardId||input.expectedConnectionId!==this.meta.id)throw fail('This board connection changed. Read connection_status again; no connection was released.',409,'CONNECTION_CHANGED');
  // No browser RPC is needed: the board owns its drawing and history independently.
  const released={boardId:this.meta.boardId,connectionId:this.meta.id};await this.revoke();
  return {disconnected:true,released,requiresReauthorization:true,instructions:'The old board link was released and its drawing and history were preserved. Let your AI app authorize SharedBoard again, approve the intended board on the website, then use its fresh pairing code. Do not retry the old authorization or move it to another board.'};
 }
 async create(input){
  if(this.meta)throw fail('This board session already exists.',409);uuid(input.id,'session ID');uuid(input.boardId,'board ID');if(!['read','edit'].includes(input.permission)||!isClientProvider(input.provider))throw fail('Choose a supported AI client and board permission.');if(typeof input.title!=='string'||!input.title.trim()||input.title.length>100)throw fail('Use a board title from 1 to 100 characters.');
  const mode=input.mode??(input.provider==='claude-code'?'claude-channel':undefined);
  if(mode!==undefined&&mode!=='remote-mcp'&&(!channelProvider(mode)||channelProvider(mode)!==input.provider))throw fail('Choose a supported connection mode.');
  const browserToken=`${input.id}.${secret()}`,code=secret(),pairingExpiresAt=Date.now()+10*60_000;
  this.meta={id:input.id,boardId:input.boardId,provider:input.provider,permission:input.permission,...(mode?{mode}:{}),browserHash:await hash(browserToken),codeHash:await hash(code),pairingExpiresAt,createdAt:new Date().toISOString(),expiresAt:pairingExpiresAt};await this.save();await this.ctx.storage.setAlarm(this.meta.expiresAt);
  const origin=this.env.RELAY_ORIGIN??defaultOrigin,mcpURL=`${origin}/mcp`;
  if(channelProvider(mode)){const connectionCode=`${input.id}.${code}`;return {browserToken,sessionId:input.id,pairing:{code:connectionCode,expiresAt:new Date(pairingExpiresAt).toISOString()},expiresAt:new Date(pairingExpiresAt).toISOString(),connection:await this.connection(),socketURL:`${origin.replace(/^http/,'ws')}/browser/socket?session=${input.id}`,setup:mode==='claude-channel'?claudeChannelSetup({connectionCode}):codexChannelSetup({connectionCode})};}
  const prompt=pairingInstructions({provider:input.provider,boardId:input.boardId,code,mcpURL});
  return {browserToken,sessionId:input.id,pairing:{code,expiresAt:new Date(pairingExpiresAt).toISOString()},expiresAt:new Date(pairingExpiresAt).toISOString(),connection:await this.connection(),socketURL:`${origin.replace(/^http/,'ws')}/browser/socket?session=${input.id}`,setup:{url:mcpURL,mcpURL,prompt}};
 }
 async activate(input,grant){await this.authorized(grant,{connected:false});if(this.meta.activatedAt){if(this.meta.activationHash&&await hash(input.code??'')===this.meta.activationHash)return this.connection();throw fail('This board is already connected. Continue using its tools or reconnect from the board.',409,'ALREADY_CONNECTED');}if(!this.meta.codeHash||this.meta.pairingExpiresAt<=Date.now()||await hash(input.code??'')!==this.meta.codeHash)throw fail('The pairing code is invalid or expired. Prepare a new connection on the board.',403,'PAIRING_EXPIRED');this.meta.activationHash=this.meta.codeHash;delete this.meta.codeHash;this.meta.activatedAt=new Date().toISOString();this.meta.expiresAt=Date.now()+90*24*60*60_000;this.meta.label=typeof input.label==='string'&&input.label.trim()?input.label.trim().slice(0,80):`My ${clientProfile(this.meta.provider)?.label??'AI'} connection`;await this.save();await this.ctx.storage.setAlarm(this.meta.expiresAt);await this.publish();return this.connection();}
 async pairChannel(input){this.alive();const paired=await this.channel.pair(input);this.meta=await this.ctx.storage.get('session');this.alive();await this.ctx.storage.setAlarm(this.meta.expiresAt);await this.publish();const origin=this.env.RELAY_ORIGIN??defaultOrigin;return {channelToken:paired.channelToken,sessionId:this.meta.id,boardId:this.meta.boardId,permission:this.meta.permission,expiresAt:new Date(this.meta.expiresAt).toISOString(),connection:await this.connection(),socketURL:`${origin.replace(/^http/,'ws')}/channel/socket?session=${this.meta.id}`};}
 async authorizeChannel(token,instanceId,{presence=false}={}){this.alive();const state=await this.channel.authorize(token,instanceId,this.meta);if(presence&&!this.activeChannel(state))throw fail('Keep the paired local AI conversation open and connected.',503,'CHANNEL_OFFLINE');return state;}
 async callChannel(input){
  const state=await this.authorizeChannel(input.channelToken,input.instanceId),operation=aliases[input.operation]??input.operation;
  if(operation==='connection')return this.connection();if(operation==='disconnect')return this.revoke();
  await this.authorizeChannel(input.channelToken,input.instanceId,{presence:true});
  if(!supported.has(operation)||['pair','connection'].includes(operation))throw fail('This channel operation is unavailable.',400,'UNSUPPORTED_OPERATION');
  const args=input.input??{};if(!object(args))throw fail('Tool arguments must be a JSON object.');
  if(writes.has(operation)&&!state.verifiedAt)throw fail('Complete the inspection-only connection test before changing the drawing.',403,'CHANNEL_TEST_READ_ONLY');
  let requestId=args.requestId;const clean={...args};delete clean.requestId;
  if(requestId)uuid(requestId,'request ID');else if(writes.has(operation))requestId=(await hash(`${this.meta.id}:${JSON.stringify(stable({operation,input:clean}))}`)).slice(0,32);
  const result=await this.rpc(operation,clean,requestId);await this.authorizeChannel(input.channelToken,input.instanceId,{presence:true});
  const kind=['chat','reply'].includes(operation)?'chat':['review','complete_review'].includes(operation)?'review':null,record=operation==='chat'?result.message:operation==='review'?result.request:result;
  if(kind&&record?.id===clean.id){if(operation==='chat'||operation==='review')await this.channel.mark(kind,clean.id,'read',this.meta,{instanceId:state.instanceId});else if((operation==='reply'&&typeof record.reply==='string'&&record.reply.trim())||(operation==='complete_review'&&record.status==='reviewed'))await this.channel.mark(kind,clean.id,'completed',this.meta,{instanceId:state.instanceId});}
  const checkedField={confirm:'boardCheckedAt',chat:'modelRequestReadAt',review:'modelRequestReadAt',reply:'replyCheckedAt'}[operation];if(checkedField){this.meta[checkedField]=new Date().toISOString();await this.save();await this.publish();}return result;
 }
 async rpc(operation,input={},requestId){
  operation=aliases[operation]??operation;if(!supported.has(operation))throw fail('This board operation is not supported by the relay.',400,'UNSUPPORTED_OPERATION');
  if(!object(input))throw fail('Tool arguments must be a JSON object.');
  if(writes.has(operation)&&permissionFor(this.meta.authorizedScope)!=='edit')throw fail('This AI connection has read-only drawing access. Reconnect with edit access from the board.',403,'READ_ONLY');
  const owner=this.owner();if(!owner)throw fail('Open this board in SharedBoard.app and keep its tab active. The relay has no saved copy of the drawing.',503,'BROWSER_OFFLINE');
  if(this.pending.size>=20)throw fail('Several board operations are waiting. Let them finish before retrying.',429,'RELAY_BUSY');
  const id=requestId??crypto.randomUUID(),key=await hash(JSON.stringify(stable({operation,input}))),existing=this.pending.get(id);if(existing){if(existing.key!==key)throw fail('This request ID belongs to another operation.',409,'REQUEST_CONFLICT');return existing.promise;}
  let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;}),expiresAt=Date.now()+25_000,pending={id,key,operation,input,owner,promise,resolve,reject,expiresAt};pending.timer=setTimeout(()=>{this.pending.delete(id);reject(fail('The browser did not respond in time. Keep its tab active, read the board again, and retry with the original request ID.',504,'BROWSER_TIMEOUT'));},25_000);this.pending.set(id,pending);
  try{owner.send(JSON.stringify({type:'command',command:{id,connectionId:this.meta.id,operation,input,expiresAt}}));}catch{clearTimeout(pending.timer);this.pending.delete(id);reject(fail('The browser disconnected before this operation could be sent. Keep its board tab open and try again.',503,'BROWSER_OFFLINE'));}return promise;
 }
 async handoff(input,{notify=false}={}){
  if(!this.meta.activatedAt)throw fail('Connect this board to your AI before sending a request.',409,'PAIRING_REQUIRED');if(!['chat','review'].includes(input.kind))throw fail('Choose a chat message or board review.');uuid(input.id,'request ID');if(input.connectionId&&input.connectionId!==this.meta.id)throw fail('This request belongs to another board connection.',403);
  const list=await this.rpc(input.kind==='chat'?'chats':'reviews'),item=(list[input.kind==='chat'?'messages':'requests']??[]).find(item=>item.id===input.id);if(!item||item.connectionId!==this.meta.id)throw fail('That saved request does not belong to this board connection.',404);
  if(notify){
   if(channelProvider(this.meta.mode)){
    const state=await this.channel.state(this.meta),socket=this.activeChannel(state);if(!socket)throw fail('Keep the paired local AI conversation open and connected.',503,'CHANNEL_OFFLINE');
    if(item.channelSessionId!==state.instanceId)throw fail('This capture belongs to another AI conversation. Keep its history intact and send a new request.',409,'CHANNEL_SESSION_MISMATCH');
    if(input.test===true&&(input.kind!=='chat'||item.intent!=='discuss'||item.channelTest!==true))throw fail('Choose the explicit Discuss connection test.',403,'CHANNEL_TEST_INVALID');
    const {claim,created}=await this.channel.claim({id:input.id,kind:input.kind,intent:item.intent??'discuss',instanceId:state.instanceId,test:input.test===true},this.meta);
    if(!created)return {delivery:claim.writtenAt||claim.readAt||claim.completedAt?'queued':'uncertain',receipt:claim.receipt,connection:await this.connection()};
    // Persist the claim before any possible transport write. Reconnects must not replay it.
    const current=await this.channel.state(this.meta);if(this.meta.revoked||!current||current.generation!==state.generation||this.activeChannel(current)!==socket)return {delivery:'uncertain',receipt:claim.receipt,connection:await this.connection()};
    try{socket.send(JSON.stringify({type:'channel_request',id:claim.id,kind:claim.kind,intent:claim.intent,boardId:this.meta.boardId,connectionId:this.meta.id,instanceId:state.instanceId,receipt:claim.receipt}));}
    catch{return {delivery:'uncertain',receipt:claim.receipt,connection:await this.connection()};}
    return {delivery:'queued',receipt:claim.receipt,connection:await this.connection()};
   }
   if(item.liveSessionId){const queued=await this.liveSession().queue({id:input.id,kind:input.kind,intent:item.intent??'discuss',liveSessionId:item.liveSessionId});return {delivery:'queued',automaticMessages:true,receipt:queued.receipt,connection:await this.connection()};}
   const delivered=await dispatchEvent({id:input.id,kind:input.kind,intent:item.intent},this.eventContext());if(delivered.delivery!=='manual'){if(delivered.delivery==='queued')await this.publish();return {...delivered,connection:await this.connection()};}
   throw fail('Direct mini-chat delivery is not available for this connection. A panel acknowledgement may only create a draft in the AI app. Your captured request remains saved in this browser.',409,'DIRECT_DELIVERY_UNAVAILABLE');}
  return {delivery:'manual',handoffPrompt:manualPrompt(input.kind,input.id,this.meta.boardId),connection:await this.connection()};
 }
 async fetch(request){
  await this.ready;try{const url=new URL(request.url),input=await body(request);
   if(url.pathname==='/create')return json(await this.create(input));
   if(url.pathname==='/socket'||url.pathname==='/channel/socket'){
    this.alive();if(request.headers.get('upgrade')?.toLowerCase()!=='websocket')throw fail('Use a WebSocket connection.',426);for(const ws of this.ctx.getWebSockets()){const saved=ws.deserializeAttachment();if(!saved?.authenticated&&Date.now()-saved.createdAt>10_000)try{ws.close(4001,'Authentication expired');}catch{}}if(this.ctx.getWebSockets().filter(ws=>ws.readyState===1).length>=6)throw fail('This board has too many open connection attempts.',429);
    const role=url.pathname==='/channel/socket'?'channel':'browser';if(role==='channel'&&!channelProvider(this.meta.mode))throw fail('This board uses another connection type.',403,'CHANNEL_UNAUTHORIZED');
    const pair=new WebSocketPair(),client=pair[0],server=pair[1];this.ctx.acceptWebSocket(server);server.serializeAttachment({role,authenticated:false,createdAt:Date.now()});await this.ctx.storage.setAlarm(Math.min(await this.ctx.storage.getAlarm()??Infinity,Date.now()+11_000));return new Response(null,{status:101,webSocket:client});
   }
   if(url.pathname==='/channel/pair')return json(await this.pairChannel(input));
   if(url.pathname==='/channel/call')return json(await this.callChannel(input));
   if(url.pathname.startsWith('/browser/')){
    await this.browser(request.headers.get('x-sharedboard-browser'));
    if(url.pathname==='/browser/status')return json({connection:await this.connection()});
    if(url.pathname==='/browser/owner')return json({id:this.meta.id,boardId:this.meta.boardId,permission:this.meta.permission,authorizedClient:this.meta.authorizedClient??null,activated:Boolean(this.meta.activatedAt)});
    if(url.pathname==='/browser/authorize'){
     if(channelProvider(this.meta.mode))throw fail('Pair this board through its local AI plugin.',403,'CHANNEL_ONLY');
     if(this.meta.activatedAt&&this.meta.authorizedFamily!==input.familyId)throw fail('This board is already connected. Use its existing connector or disconnect it before authorizing again.',409,'CONNECTION_REPLACED');if(this.meta.authorizedClient&&this.meta.authorizedClient!==input.clientId)throw fail('This board already authorizes another AI client. Disconnect it before connecting a different client.',409,'CONNECTION_REPLACED');
     if(this.meta.authorizedFamily&&this.meta.authorizedFamily!==input.familyId){await clearEventSubscriptions(this.eventContext());await clearPanel(this.panelContext());await this.liveSession().clear();}this.meta.authorizedClient=input.clientId;this.meta.authorizedScope=input.scope;this.meta.authorizedFamily=input.familyId;await this.save();await this.publish();return json({ok:true});
    }
    if(url.pathname==='/browser/handoff'||url.pathname==='/browser/notify')return json(await this.handoff(input,{notify:url.pathname.endsWith('/notify')}));
    if(url.pathname==='/browser/live/stop'){await this.liveSession().stop(input);return json({connection:await this.connection()});}
    if(url.pathname==='/browser/disconnect'){
     return json(await this.revoke());
    }
   }
   if(url.pathname==='/agent/check'){await this.authorized(input.grant,{connected:input.connected!==false});return json({connection:await this.connection()});}
   if(url.pathname==='/agent/disconnect')return json(await this.disconnectAuthorized(input.grant,input.input));
   if(url.pathname==='/agent/live'){
    await this.authorized(input.grant);if(input.operation!=='wait')throw fail('Choose the live-session wait operation.',400,'LIVE_OPERATION_INVALID');let result;
    try{result=await this.liveSession().wait(input.input??{},{signal:request.signal});}catch(error){if(typeof error?.code==='string'&&error.code.startsWith('LIVE_'))throw error;const code=error?.name==='AbortError'?'LIVE_WAIT_CANCELLED':error?.name==='TypeError'?'LIVE_WAIT_TYPE_ERROR':'LIVE_WAIT_RUNTIME_ERROR';throw fail('Live collaboration could not prepare or continue its bounded wait.',500,code);}
    await this.authorized(input.grant);return json(result);
   }
   if(url.pathname==='/agent/revoke'){if(!this.meta||this.meta.authorizedFamily!==input.grant?.familyId)return json({ok:true});return json(await this.revoke());}
   if(url.pathname==='/agent/call'){
    await this.authorized(input.grant,{connected:input.operation!=='pair'&&input.operation!=='connection'});if(input.operation==='pair')return json(await this.activate(input.input??{},input.grant));if(input.operation==='connection')return json(await this.connection());
    const args=input.input??{},operation=aliases[input.operation]??input.operation;let requestId=args.requestId;const clean={...args};delete clean.requestId;
    if(requestId)uuid(requestId,'request ID');else if(writes.has(operation))requestId=(await hash(`${this.meta.id}:${JSON.stringify(stable({operation,input:clean}))}`)).slice(0,32); // Stable retries; new copies must use new element IDs or requestId.
    const result=await this.rpc(operation,clean,requestId);await this.authorized(input.grant);const checkedField={confirm:'boardCheckedAt',chat:'modelRequestReadAt',review:'modelRequestReadAt',reply:'replyCheckedAt'}[operation];if(checkedField){this.meta[checkedField]=new Date().toISOString();await this.save();await this.publish();}return json(result);
   }
   if(url.pathname==='/agent/panel'){
    await this.authorized(input.grant);
    // Text-message capability and a successful ui/message acknowledgement do
    // not prove that a host submits the message or starts a model turn. Keep
    // existing receipts intact, and stop cached panels before they can replay.
    if(['attach','claim','confirm'].includes(input.operation))throw fail(panelDeliveryReason,409,'PANEL_DIRECT_DELIVERY_UNAVAILABLE');
    // Older cached views ignore the policy fields and heartbeat while linked.
    // Expire only this validated view's lease so they pause instead of keeping
    // an unusable route alive. Detach preserves views and request receipts.
    const result=await panelOperation(input.operation==='state'?'detach':input.operation,input.input??{},this.panelContext());
    await this.authorized(input.grant);
    if(input.operation!=='open')await this.publish();return json({...result,directDeliveryAvailable:false,directDeliveryReason:panelDeliveryReason});
   }
   if(url.pathname==='/agent/events'){await this.authorized(input.grant,{connected:input.method!=='events/list'});const result=await handleEventRpc(input.method,input.params??{},this.eventContext());await this.publish();return json(result);}
   throw fail('Unknown connector operation.',404);
  }catch(error){return failureResponse(error);}
 }
 async webSocketMessage(ws,message){
  await this.ready;try{this.alive();const attachment=ws.deserializeAttachment();if(typeof message!=='string'||message.length>(attachment?.role==='channel'?8192:MAX_RESULT))throw fail('This connector response is too large.',413);const data=JSON.parse(message);if(!object(data))throw fail('Invalid connector response.');
   if(attachment?.role==='channel'){await this.channelSocketMessage(ws,data,attachment);return;}
   if(!attachment?.authenticated){if(data.type!=='authenticate'||Date.now()-attachment.createdAt>10_000)throw fail('Authenticate the browser connection first.',401);await this.browser(data.browserToken);if(typeof data.clientId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(data.clientId))throw fail('A valid browser client ID is required.');const previous=this.owner();if(previous&&previous!==ws){if(previous.deserializeAttachment().clientId!==data.clientId)throw fail('Another open tab owns this board connection. Keep that tab open or close it first.',409,'BROWSER_OWNED');previous.close(1000,'Browser reconnected');}ws.serializeAttachment({role:'browser',authenticated:true,owner:true,clientId:data.clientId,createdAt:Date.now()});ws.send(JSON.stringify({type:'connection',connection:await this.connection()}));return;}
   if(data.type==='ping'){ws.send(JSON.stringify({type:'pong'}));return;}
   if(data.type==='result'){
    const pending=this.pending.get(data.id);if(!pending||pending.owner!==ws||data.connectionId&&data.connectionId!==this.meta.id)return;
    this.pending.delete(data.id);clearTimeout(pending.timer);if(Date.now()>=pending.expiresAt){pending.reject(fail('This browser operation expired. Read the latest board and retry.',409,'STALE_RELAY_COMMAND'));return;}
    if(data.error){const value=data.error;pending.reject(Object.assign(fail(String(value.message??'The browser could not finish this operation.').slice(0,500),Number.isInteger(value.status)&&value.status>=400&&value.status<=599?value.status:400,String(value.code??'BROWSER_OPERATION_FAILED').slice(0,80)),{conflicts:value.conflicts}));}else if(Object.hasOwn(data,'result'))pending.resolve(data.result);else pending.reject(fail('The browser returned no result.',502));return;
   }
   if(data.type==='release'){ws.close(1000,'Board tab released');return;}throw fail('Unsupported browser connection message.');
  }catch(error){try{ws.send(JSON.stringify({type:'error',error:errorData(error)}));const channel=ws.deserializeAttachment()?.role==='channel';ws.close(channel?(error.status===401||error.status===403?4001:4003):error.status===409?4009:4001,error.message.slice(0,120));}catch{}}
 }
 async channelSocketMessage(ws,data,attachment){
  if(!attachment.authenticated){
   if(data.type!=='authenticate'||Date.now()-attachment.createdAt>10_000)throw fail('Authenticate this channel first.',401,'CHANNEL_UNAUTHORIZED');
   const state=await this.authorizeChannel(data.channelToken,data.instanceId);for(const previous of this.channelSockets())if(previous!==ws&&previous.deserializeAttachment().authenticated)previous.close(4003,'Local AI transport replaced');
   ws.serializeAttachment({role:'channel',authenticated:true,instanceId:state.instanceId,generation:state.generation,presenceExpiresAt:Date.now()+CHANNEL_PRESENCE_TTL,createdAt:Date.now()});await this.ctx.storage.setAlarm(Math.min(await this.ctx.storage.getAlarm()??Infinity,Date.now()+CHANNEL_PRESENCE_TTL));ws.send(JSON.stringify({type:'connection',connection:await this.connection()}));await this.publish();return;
  }
  const state=await this.channel.state(this.meta);if(!state||state.instanceId!==attachment.instanceId||state.generation!==attachment.generation||attachment.presenceExpiresAt<=Date.now())throw fail('This channel session is no longer available.',403,'CHANNEL_UNAUTHORIZED');
  if(data.type==='ping'){attachment.presenceExpiresAt=Date.now()+CHANNEL_PRESENCE_TTL;ws.serializeAttachment(attachment);ws.send(JSON.stringify({type:'pong'}));await this.publish();return;}
  if(data.type==='channel_written'){if(typeof data.receipt!=='string'||!await this.channel.mark(data.kind,data.id,'written',this.meta,{instanceId:state.instanceId,receipt:data.receipt}))throw fail('This transport receipt does not identify a claimed request.',409,'CHANNEL_RECEIPT_INVALID');ws.send(JSON.stringify({type:'written',id:data.id,kind:data.kind}));return;}
  if(data.type==='release'){attachment.presenceExpiresAt=0;ws.serializeAttachment(attachment);ws.close(1000,'Local AI channel released');await this.publish();return;}
  throw fail('This channel cannot send browser results or change its role.',403,'CHANNEL_FRAME_INVALID');
 }
 async webSocketClose(ws){if(ws.deserializeAttachment()?.role==='channel'){const saved=ws.deserializeAttachment();saved.presenceExpiresAt=0;ws.serializeAttachment(saved);await this.publish();}for(const [id,pending] of this.pending)if(pending.owner===ws){clearTimeout(pending.timer);this.pending.delete(id);pending.reject(fail('The browser disconnected before confirming this operation. Read the current board before retrying.',503,'BROWSER_OFFLINE'));}}
 async webSocketError(ws){await this.webSocketClose(ws);try{ws.close(1011,'Browser connection interrupted');}catch{}}
 async alarm(){await this.ready;if(!this.meta||this.meta.expiresAt<=Date.now()){for(const ws of this.ctx.getWebSockets())try{ws.close(1000,'Board connection expired');}catch{}await this.ctx.storage.deleteAll();this.meta=null;return;}let next=this.meta.expiresAt;for(const ws of this.ctx.getWebSockets()){const saved=ws.deserializeAttachment();if(ws.readyState!==1)continue;if(saved?.role==='channel'&&saved.authenticated){if(saved.presenceExpiresAt<=Date.now())try{ws.close(1000,'Local AI presence expired');}catch{}else next=Math.min(next,saved.presenceExpiresAt);continue;}if(saved?.authenticated)continue;if(Date.now()-saved.createdAt>10_000)try{ws.close(4001,'Authentication expired');}catch{}else next=Math.min(next,saved.createdAt+11_000);}await this.ctx.storage.setAlarm(next);if(channelProvider(this.meta.mode))await this.publish();}
}
