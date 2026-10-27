// Created by Andrew Barresi: https://github.com/AndBarresi
// Copyright (c) 2026 Andrew Barresi
// Licensed under the MIT License. See LICENSE.
import * as z from 'zod/v4';
import {same,isRenderNormalization} from '../shared/scene.mjs';
import {APP_VERSION} from '../shared/version.mjs';
import {browserIdSchema,browserPatchSchema,browserFailure,validateBrowserProject,validateBrowserBackup,parseBrowserBody,normalizeBrowserError,validateBrowserVisual} from './browser-validation.mjs';
import {createBrowserBridge,validateBridgeDeadline} from './browser-relay.mjs';
import {createCaptured,metadata,chatView,reviewView,prepareAgentOperation,automaticDeliveryFor} from './browser-ai.mjs';

const DATABASE_VERSION=1,STORES=['meta','boards','snapshots'];
const connectorWip='This operation is not supported by the hosted board connection.';
const disconnected=()=>({connected:false,id:null,provider:null,label:'Connect an AI',permission:null,deliveryMode:null,automaticMessages:false,boardCheckedAt:null,deliveryCheckedAt:null,replyCheckedAt:null,connectedAt:null,pairingExpiresAt:null,features:{webConnectors:true,localConnectors:false,storage:'browser'}});
const reviews=()=>({requests:[],connected:false,automaticMessages:false});
const chat=()=>({messages:[],connected:false,connectionLabel:'Connect an AI',automaticMessages:false});
const clone=value=>structuredClone(value);
const requestResult=request=>new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
const nowIso=now=>new Date(now()).toISOString();
const safeUuid=value=>z.string().uuid().parse(value);
const metadataRecovery=entry=>{const {hash,...metadata}=entry;return clone(metadata);};
const deletionInput=z.object({id:z.string().uuid(),expectedVersion:z.number().int().min(0),boards:z.array(z.object({id:z.string().uuid(),revision:z.number().int().min(0),planningVersion:z.number().int().min(0)}).strict()).max(150)});
const deletionConflict=()=>browserFailure('The project or drawing changed after this confirmation. Nothing was deleted. Reopen the delete dialog to review the current contents.',409,'DELETE_PREVIEW_STALE');
const deletedBoardError=(catalog,origin)=>Object.assign(browserFailure('This board was deleted in this browser. Open another saved board to continue.',410,'BOARD_DELETED'),{fallbackBoardId:catalog.legacyBoardId,url:`${new URL(origin).origin}/`});

function newRecord(id,title,now){return {id,board:{schemaVersion:1,id,title,revision:0,updatedAt:nowIso(now),elements:[],elementVersions:{},files:{},activity:[]},planning:{boardId:id,version:0,project:{title,areas:[],notes:[],library:[]},checkpoints:[],proposals:[],agentActions:[]},recoveries:[],visual:null};}
function planningView(record){return {...clone(record.planning),recoveries:record.recoveries.map(metadataRecovery)};}
function workspaceView(catalog,boardId){const board=catalog.boards.find(board=>board.id===boardId);if(!board)throw browserFailure('That board does not exist in this browser.',404);return {...clone(catalog),currentBoardId:boardId,currentProjectId:board.projectId};}
function checkRecord(record,id){
 if(!record||record.id!==id||record.board?.id!==id||record.board.schemaVersion!==1||!Number.isSafeInteger(record.board.revision)||!Array.isArray(record.board.elements)||!record.board.elementVersions||!record.board.files||record.planning?.boardId!==id||!Number.isSafeInteger(record.planning.version)||!['areas','notes','library'].every(key=>Array.isArray(record.planning.project?.[key]))||!['checkpoints','proposals','agentActions'].every(key=>Array.isArray(record.planning[key]))||!Array.isArray(record.recoveries))throw browserFailure('This saved board is unreadable. Its browser data has been preserved.',500,'BROWSER_STORAGE_CORRUPT');
 return record;
}
function checkCatalog(catalog){
 if(catalog?.schemaVersion!==1||!Array.isArray(catalog.projects)||!Array.isArray(catalog.boards)||!catalog.projects.length||!catalog.boards.some(board=>board.id===catalog.legacyBoardId)||new Set(catalog.projects.map(project=>project.id)).size!==catalog.projects.length||new Set(catalog.boards.map(board=>board.id)).size!==catalog.boards.length||catalog.boards.some(board=>!catalog.projects.some(project=>project.id===board.projectId)))throw browserFailure('The project catalog is unreadable. Its browser data has been preserved.',500,'BROWSER_STORAGE_CORRUPT');
 return catalog;
}

// This fingerprint is only an index for recovery deduplication. A matching
// fingerprint is verified against the complete saved content before deduping.
function semanticContent(board,project){
 const active=board.elements.filter(element=>!element.isDeleted),used=new Set(active.map(element=>element.fileId).filter(Boolean));
 const elements=active.map(({version,versionNonce,updated,index,...element})=>element);
 const files=Object.fromEntries(Object.entries(board.files).filter(([id])=>used.has(id)).sort(([a],[b])=>a.localeCompare(b)).map(([id,{created,lastRetrieved,...file}])=>[id,file]));
 return JSON.stringify({boardId:board.id,elements,files,project});
}
function fingerprint(text){let hash=2166136261;for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),16777619);return `${text.length}:${hash>>>0}`;}

function applyDrawing(board,input,now,actor='user'){
 const conflicts=input.changes.filter(change=>(board.elementVersions[change.id]??0)!==change.expectedVersion).map(change=>change.id);
 if(conflicts.length)throw Object.assign(browserFailure('These objects changed in another tab. Your local drawing is still available.',409),{conflicts,board:clone(board)});
 const previous=new Map(board.elements.map(element=>[element.id,element])),map=new Map(previous),versions={...board.elementVersions},changedIds=new Set();let dirty=false;
 for(const change of input.changes){if(same(map.get(change.id),change.element))continue;map.set(change.id,clone(change.element));versions[change.id]=(versions[change.id]??0)+1;changedIds.add(change.id);dirty=true;}
 const labelContent=element=>element?.type==='text'?{text:element.originalText??element.text,fontSize:element.fontSize,fontFamily:element.fontFamily,lineHeight:element.lineHeight,textAlign:element.textAlign,verticalAlign:element.verticalAlign,isDeleted:Boolean(element.isDeleted),containerId:element.containerId}:null;
 for(const change of input.changes){if(!changedIds.has(change.id))continue;const before=previous.get(change.id),after=map.get(change.id);if(same(labelContent(before),labelContent(after)))continue;for(const owner of new Set([before?.containerId,after?.containerId])){if(!owner||changedIds.has(owner)||!['rectangle','ellipse','diamond','arrow','line'].includes(map.get(owner)?.type))continue;versions[owner]=(versions[owner]??0)+1;changedIds.add(owner);}}
 const files={...board.files};for(const [id,file] of Object.entries(input.files??{}))if(!same(files[id],file)){files[id]=clone(file);dirty=true;}
 if(!dirty)return {board,changed:false};
 const elements=[...map.values()];if(elements.every(element=>typeof element.index==='string'))elements.sort((a,b)=>a.index<b.index?-1:a.index>b.index?1:0);
 const at=nowIso(now),revision=board.revision+1;
 return {changed:true,board:{...board,revision,updatedAt:at,elements,elementVersions:versions,files,activity:[{actor,summary:input.summary??'You updated the drawing',revision,at,ids:[...changedIds]},...board.activity].slice(0,40)}};
}
function restoreChanges(board,snapshot,now){
 const wanted=new Map(snapshot.board.elements.map(element=>[element.id,element])),changes=[];
 const stamp=(element,version)=>({...clone(element),version,versionNonce:Math.floor(Math.random()*2**30),updated:now()});
 for(const element of board.elements){const saved=wanted.get(element.id);if(saved){wanted.delete(element.id);if(!same(element,saved))changes.push({id:element.id,expectedVersion:board.elementVersions[element.id],element:stamp(saved,Math.max(element.version??1,saved.version??1)+1)});}else if(!element.isDeleted)changes.push({id:element.id,expectedVersion:board.elementVersions[element.id],element:stamp({...element,isDeleted:true},(element.version??1)+1)});}
 for(const element of wanted.values())changes.push({id:element.id,expectedVersion:board.elementVersions[element.id]??0,element:stamp(element,(element.version??1)+1)});
 return {changes,files:snapshot.board.files};
}
function recordNormalization(record,before,after,changes){
 let dirty=false;
 for(const change of changes){const previous=before.elements.find(element=>element.id===change.id);if(!isRenderNormalization(previous,change.element))continue;
  for(const action of record.planning.agentActions){if(action.undone)continue;const reference=action.after?.find(element=>element.id===change.id);if(reference&&reference.expectedVersion===before.elementVersions[change.id]){reference.expectedVersion=after.elementVersions[change.id];dirty=true;}}
 }
 if(dirty)record.planning.version++;
 return dirty;
}

class BrowserEvents extends EventTarget{
 onerror=null;
 close(){}
 emit(type,value){this.dispatchEvent(new MessageEvent(type,{data:JSON.stringify(value)}));}
 fail(error){const event=new Event('error');Object.defineProperty(event,'error',{value:error});this.dispatchEvent(event);this.onerror?.(event);}
}

async function openDatabase(indexedDB,name,timeoutMs=10000){
 if(!indexedDB)throw browserFailure('This browser does not provide IndexedDB storage. Use a supported browser with site storage enabled.',503,'BROWSER_STORAGE_UNAVAILABLE');
 return new Promise((resolve,reject)=>{
  const request=indexedDB.open(name,DATABASE_VERSION);let finished=false;
  const timer=setTimeout(()=>{finished=true;reject(browserFailure('Another tab is blocking the browser storage update. Close older SharedBoard.app tabs and reopen this page.',503,'BROWSER_STORAGE_BLOCKED'));},timeoutMs);
  request.onupgradeneeded=()=>{const db=request.result;for(const store of STORES)if(!db.objectStoreNames.contains(store))db.createObjectStore(store,{keyPath:store==='meta'?'key':'id'});};
  request.onerror=()=>{clearTimeout(timer);if(!finished){finished=true;reject(request.error);}};
  request.onsuccess=()=>{clearTimeout(timer);if(finished){request.result.close();return;}finished=true;resolve(request.result);};
 });
}

export async function createBrowserTransport({basePath='',indexedDB=globalThis.indexedDB,dbName='sharedboard-browser-v1',BroadcastChannel=globalThis.BroadcastChannel,origin=globalThis.location?.origin??'http://localhost',now=()=>Date.now(),randomUUID=()=>globalThis.crypto.randomUUID(),openTimeoutMs=10000,bridgeFetch=globalThis.fetch,bridgeWebSocket=globalThis.WebSocket,bridgeBaseURL,bridgePollDelay=1000}={}){
 let db;try{db=await openDatabase(indexedDB,dbName,openTimeoutMs);}catch(error){throw normalizeBrowserError(error);}
 const events=new BrowserEvents(),source=randomUUID();let boardId,closed=false,channel,bridge,deletedNotified=false;
 const requested=basePath?(/^\/boards\/([0-9a-f-]{36})\/?$/i.exec(basePath)?.[1]??null):null;
 if(basePath&&!requested){db.close();throw browserFailure('This board address is invalid.',404);}
 const emitChanges=async({types,board:changedBoard,clientId}={})=>{
  if(closed)return;
  try{const data=await atomic('readonly',async stores=>{const catalog=checkCatalog((await requestResult(stores.meta.get('catalog')))?.value);return {catalog,record:catalog.boards.some(board=>board.id===boardId)?checkRecord(await requestResult(stores.boards.get(boardId)),boardId):null,connection:(await requestResult(stores.meta.get(`relay:v1:${boardId}`)))?.value?.connection??disconnected()};});if(closed)return;
   if(!data.record){bridge?.close();if(!deletedNotified){deletedNotified=true;events.emit('board-deleted',{boardId,fallbackBoardId:data.catalog.legacyBoardId,url:`${new URL(origin).origin}/`,workspace:workspaceView(data.catalog,data.catalog.legacyBoardId)});}return;}
   if(types.includes('board')&&changedBoard===boardId)events.emit('board',{board:data.record.board,clientId:clientId??null});
   if(types.includes('planning')&&changedBoard===boardId)events.emit('planning',planningView(data.record));
   if(types.includes('workspace'))events.emit('workspace',workspaceView(data.catalog,boardId));
   if(types.includes('connection'))events.emit('connection',data.connection);
   if(types.includes('chat'))events.emit('chat',chatView(data.record,data.connection));
   if(types.includes('reviews'))events.emit('reviews',reviewView(data.record,data.connection));
   if(types.includes('agent'))events.emit('agent',{lastAgentAt:data.record.lastAgentAt??null});
  }catch(error){if(!closed)events.fail(normalizeBrowserError(error));}
 };
 async function atomic(mode,operation){
  if(closed)throw browserFailure('This browser storage connection is closed. Reopen the page.',503,'BROWSER_STORAGE_CLOSED');
  const transaction=db.transaction(STORES,mode),stores=Object.fromEntries(STORES.map(name=>[name,transaction.objectStore(name)]));
  const complete=new Promise((resolve,reject)=>{transaction.oncomplete=()=>resolve();transaction.onabort=()=>reject(transaction.error??new DOMException('Storage transaction aborted.','AbortError'));transaction.onerror=()=>{};});
  try{const result=await operation(stores);await complete;return result;}
  catch(error){try{transaction.abort();}catch{}await complete.catch(()=>{});throw error;}
 }
 const close=()=>{if(closed)return;bridge?.close();closed=true;channel?.close();db.close();};events.close=close;
 db.onversionchange=()=>{close();events.fail(browserFailure('Browser storage was updated in another tab. Reopen this page to continue.',503,'BROWSER_STORAGE_REOPEN'));};
 db.onclose=()=>{if(!closed){close();events.fail(browserFailure('The browser closed its storage connection. Reopen the page to continue.',503,'BROWSER_STORAGE_CLOSED'));}};
 try{
  await atomic('readwrite',async stores=>{
   let catalog=(await requestResult(stores.meta.get('catalog')))?.value;
   if(!catalog){const id=randomUUID(),projectId=randomUUID();catalog={schemaVersion:1,version:0,legacyBoardId:id,projects:[{id:projectId,name:'My first project'}],boards:[{id,projectId,title:'Our shared project'}]};stores.meta.put({key:'catalog',value:catalog});stores.boards.put(newRecord(id,'Our shared project',now));}
   checkCatalog(catalog);boardId=requested??catalog.legacyBoardId;workspaceView(catalog,boardId);checkRecord(await requestResult(stores.boards.get(boardId)),boardId);
  });
 }catch(error){close();throw normalizeBrowserError(error);}
 if(BroadcastChannel){channel=new BroadcastChannel(`${dbName}:changes`);channel.onmessage=event=>{const data=event.data;if(data?.source===source||!Array.isArray(data?.types))return;void emitChanges({...data,types:['board','planning','workspace','connection','chat','reviews','agent'],board:boardId});if(data.types.includes('connection'))bridge?.start();};}

 async function captureRecovery(stores,record,name,{force=false}={}){
  const latest=record.recoveries[0];if(!force&&latest&&now()-Date.parse(latest.at)<300000)return false;
  const text=semanticContent(record.board,record.planning.project),hash=fingerprint(text);
  for(const existing of record.recoveries.filter(entry=>entry.hash===hash)){const snapshot=await requestResult(stores.snapshots.get(existing.id));if(snapshot&&semanticContent(snapshot.board,snapshot.project)===text)return false;}
  const id=randomUUID(),entry={id,name:String(name).slice(0,100),revision:record.board.revision,at:nowIso(now),objectCount:record.board.elements.filter(element=>!element.isDeleted).length,automatic:true,hash};
  stores.snapshots.put({id,boardId:record.id,kind:'recovery',board:clone(record.board),project:clone(record.planning.project)});
  const expired=record.recoveries.slice(11);record.recoveries=[entry,...record.recoveries].slice(0,12);for(const old of expired)stores.snapshots.delete(old.id);return true;
 }
 const renameCatalog=(catalog,id,title)=>{const board=catalog.boards.find(board=>board.id===id);if(board.title===title)return false;board.title=title;catalog.version++;return true;};
 const notify=notice=>{if(!notice.types.length||closed)return;void emitChanges(notice);channel?.postMessage({...notice,source});};
 const loadBridge=()=>atomic('readonly',async stores=>(await requestResult(stores.meta.get(`relay:v1:${boardId}`)))?.value??null);
 const saveBridge=async(value,{expectedToken}={})=>{const saved=await atomic('readwrite',async stores=>{const catalog=checkCatalog((await requestResult(stores.meta.get('catalog')))?.value);if(!catalog.boards.some(board=>board.id===boardId))return false;const key=`relay:v1:${boardId}`,current=(await requestResult(stores.meta.get(key)))?.value;if(expectedToken!==undefined&&current?.browserToken!==expectedToken)return false;if(value)stores.meta.put({key,value:clone(value)});else stores.meta.delete(key);return true;});if(saved)notify({types:['connection','chat','reviews'],board:boardId});else void emitChanges({types:['workspace'],board:boardId});return saved;};
 const execute=async(command,authority)=>{
  const outcome=await atomic('readwrite',async stores=>{
   validateBridgeDeadline(command,now());
   const privateState=(await requestResult(stores.meta.get(`relay:v1:${boardId}`)))?.value,connection=privateState?.connection;
   if(privateState?.browserToken!==authority.browserToken||!connection?.connected||connection.id!==authority.connection?.id||command.connectionId&&command.connectionId!==connection.id)throw browserFailure('This board connection changed. Pair the intended board again.',403);
   const record=checkRecord(await requestResult(stores.boards.get(boardId)),boardId),input=command.input??{},cacheKey=JSON.stringify({operation:command.operation,input});
   validateBridgeDeadline(command,now());
   if(typeof command.id!=='string'||!command.id.length||command.id.length>128)throw browserFailure('Invalid bridge command ID.',400);
   const prior=(record.bridgeResults??[]).find(item=>item.id===command.id&&item.connectionId===connection.id);if(prior){if(prior.key!==cacheKey)throw browserFailure('That bridge command ID belongs to another operation.');return {result:prior.result,types:[]};}
   const prepared=prepareAgentOperation(record,command.operation,input,connection,nowIso(now)),types=new Set(prepared.changed?[prepared.changed]:[]);let result=prepared.result;
   if(prepared.changes){await captureRecovery(stores,record,'Before AI drawing changes',{force:true});validateBridgeDeadline(command,now());const before=clone(record.board),next=applyDrawing(record.board,{changes:prepared.changes,summary:prepared.summary},now,'agent');record.board=next.board;if(next.changed){types.add('board');types.add('planning');record.planning.version++;const ids=prepared.changes.map(change=>change.id),previous=new Map(before.elements.map(e=>[e.id,e]));record.planning.agentActions.unshift({id:randomUUID(),at:nowIso(now),summary:prepared.summary,revision:record.board.revision,count:ids.length,before:ids.map(id=>previous.get(id)??null),after:ids.map(id=>({id,expectedVersion:record.board.elementVersions[id]}))});record.planning.agentActions=record.planning.agentActions.slice(0,20);result={revision:record.board.revision,[prepared.operation==='add'?'createdIds':'editedIds']:ids,elementVersions:clone(record.board.elementVersions)};}}
   validateBridgeDeadline(command,now());
   record.lastAgentAt=nowIso(now);types.add('agent');if(prepared.changes||['reply','reply_to_chat_message','complete_review','complete_review_request'].includes(command.operation))record.bridgeResults=[...(record.bridgeResults??[]),{id:command.id,connectionId:connection.id,key:cacheKey,result:clone(result)}].slice(-100);stores.boards.put(record);return {result,types:[...types]};
  });notify({types:outcome.types,board:boardId});return outcome.result;
 };
 bridge=createBrowserBridge({boardId,clientId:source,load:loadBridge,save:saveBridge,execute,fetch:bridgeFetch,WebSocket:bridgeWebSocket,baseURL:bridgeBaseURL,pollDelay:bridgePollDelay,onError:async error=>{if(closed||error.status===409)return;const saved=await loadBridge();if(!closed&&saved?.browserToken)await saveBridge({...saved,connection:{...saved.connection,connected:false,browserOnline:false,relayAvailable:false,relayError:error.message}},{expectedToken:saved.browserToken});}});
 const connectionView=async()=>((await loadBridge())?.connection??disconnected());
 const deletionPreview=async(stores,kind,id)=>{
  const catalog=checkCatalog((await requestResult(stores.meta.get('catalog')))?.value);
  if(!catalog.boards.some(board=>board.id===boardId))throw deletedBoardError(catalog,origin);
  const target=kind==='board'?catalog.boards.find(board=>board.id===id):catalog.projects.find(project=>project.id===id);
  if(!target)throw browserFailure(`That ${kind} no longer exists.`,404);
  const targets=kind==='board'?[target]:catalog.boards.filter(board=>board.projectId===id),boards=[];
  for(const target of targets){const record=checkRecord(await requestResult(stores.boards.get(target.id)),target.id);boards.push({id:target.id,revision:record.board.revision,planningVersion:record.planning.version});}
  return {catalog,preview:{kind,id,title:target.title??target.name,expectedVersion:catalog.version,boards,boardCount:boards.length}};
 };
 const checkDeletion=async(stores,kind,input)=>{
  const data=await deletionPreview(stores,kind,input.id);
  if(data.preview.expectedVersion!==input.expectedVersion||input.boards.length!==data.preview.boards.length||new Set(input.boards.map(board=>board.id)).size!==input.boards.length||data.preview.boards.some(board=>!input.boards.some(wanted=>wanted.id===board.id&&wanted.revision===board.revision&&wanted.planningVersion===board.planningVersion)))throw deletionConflict();
  return data;
 };
 const deleteWorkspace=async(kind,raw)=>{
  const input=deletionInput.parse(raw),prepared=await atomic('readonly',async stores=>{const data=await checkDeletion(stores,kind,input),grants=[];for(const board of data.preview.boards){const state=(await requestResult(stores.meta.get(`relay:v1:${board.id}`)))?.value??null;if(state?.browserToken&&state.connection?.boardId!==board.id)throw browserFailure('This board’s saved connection cannot be verified. Nothing was deleted.',500,'BROWSER_STORAGE_CORRUPT');grants.push({id:board.id,state});}return {...data,grants};});
  // Revoke only the reviewed target grants. Never fetch or revoke a replacement
  // grant that another tab created while this deletion was in progress.
  for(const {id,state} of prepared.grants){if(!state?.browserToken)continue;const targetBridge=createBrowserBridge({boardId:id,clientId:source,load:async()=>clone(state),save:async()=>true,fetch:bridgeFetch,WebSocket:bridgeWebSocket,baseURL:bridgeBaseURL});try{await targetBridge.disconnect();}catch(error){if(error.status!==401||error.code!=='RELAY_DISCONNECTED'||error.deliveryUnknown)throw error;}finally{targetBridge.close();}}
  const outcome=await atomic('readwrite',async stores=>{
   const {catalog,preview}=await checkDeletion(stores,kind,input),deletedBoardIds=preview.boards.map(board=>board.id),removed=new Set(deletedBoardIds);
   for(const {id,state} of prepared.grants){const latest=(await requestResult(stores.meta.get(`relay:v1:${id}`)))?.value;if(latest?.browserToken&&latest.browserToken!==state?.browserToken)throw deletionConflict();}
   catalog.boards=catalog.boards.filter(board=>!removed.has(board.id));const deletedProjectIds=kind==='project'?[input.id]:[];if(kind==='project')catalog.projects=catalog.projects.filter(project=>project.id!==input.id);
   const freshId=async()=>{for(let attempt=0;attempt<20;attempt++){const id=safeUuid(randomUUID());if(!removed.has(id)&&!catalog.boards.some(board=>board.id===id)&&!catalog.projects.some(project=>project.id===id)&&!(await requestResult(stores.meta.get(`deleted-board:v1:${id}`))))return id;}throw browserFailure('A new board ID could not be created. Nothing was deleted.',503);};
   if(!catalog.projects.length)catalog.projects.push({id:await freshId(),name:'My first project'});
   if(!catalog.boards.length){const id=await freshId(),projectId=catalog.projects[0].id,title='Untitled board';catalog.boards.push({id,projectId,title});stores.boards.put(newRecord(id,title,now));}
   if(removed.has(catalog.legacyBoardId))catalog.legacyBoardId=catalog.boards[0].id;
   const currentBoardDeleted=removed.has(boardId),selectedId=currentBoardDeleted?catalog.legacyBoardId:boardId,url=`${new URL(origin).origin}${selectedId===catalog.legacyBoardId?'/':`/boards/${selectedId}/`}`;
   for(const id of deletedBoardIds){stores.boards.delete(id);stores.meta.delete(`relay:v1:${id}`);stores.meta.put({key:`deleted-board:v1:${id}`,value:{boardId:id,deletedAt:nowIso(now),fallbackBoardId:catalog.legacyBoardId}});}
   await new Promise((resolve,reject)=>{const request=stores.snapshots.openCursor();request.onerror=()=>reject(request.error);request.onsuccess=()=>{const cursor=request.result;if(!cursor){resolve();return;}if(removed.has(cursor.value.boardId))cursor.delete();cursor.continue();};});
   catalog.version++;stores.meta.put({key:'catalog',value:catalog});return {result:{...workspaceView(catalog,selectedId),deletedBoardIds,deletedProjectIds,currentBoardDeleted,url},notice:{types:['workspace','board-deleted'],board:boardId}};
  });notify(outcome.notice);return outcome.result;
 };
 const deliver=async(kind,id,{retry=false}={})=>{
   const pinned=await atomic('readwrite',async stores=>{const record=checkRecord(await requestResult(stores.boards.get(boardId)),boardId),connection=(await requestResult(stores.meta.get(`relay:v1:${boardId}`)))?.value?.connection,list=kind==='chat'?record.messages:record.reviews,item=list?.find(m=>m.id===id);if(!item)throw browserFailure('That request does not exist.',404);if(!connection?.connected||connection.id!==item.connectionId)throw browserFailure('This request belongs to its original AI connection. Reconnect that conversation before retrying.');if(item.delivery==='queued'||item.delivery==='manual'&&item.handoffPrompt||['answered','reviewed'].includes(item.status))return false;const manual=!automaticDeliveryFor(connection,kind,now());if(item.automaticRequired&&manual)throw browserFailure('Automatic delivery is unavailable for this connection. Keep this saved request and check its original AI conversation before retrying; it has not been resent.',409,'DIRECT_CHAT_NOT_LINKED');if(item.delivery==='uncertain'&&manual)throw Object.assign(browserFailure('This request has an uncertain automatic delivery. Check its original AI conversation before sending anything again.',409,'DELIVERY_UNCERTAIN'),{deliveryUnknown:true});item.delivery='pending';delete item.deliveryError;stores.boards.put(record);return {manual,connectionId:connection.id};});
   if(!pinned)return;notify({types:[kind==='chat'?'chat':'reviews'],board:boardId});let receipt,handoffPrompt,error;try{if(pinned.manual)handoffPrompt=await bridge.handoff(kind,id);else receipt=await bridge.notify(kind,id,{retry});}catch(cause){error=cause;}
   await atomic('readwrite',async stores=>{const record=checkRecord(await requestResult(stores.boards.get(boardId)),boardId),connection=(await requestResult(stores.meta.get(`relay:v1:${boardId}`)))?.value?.connection,item=(kind==='chat'?record.messages:record.reviews).find(m=>m.id===id);if(!item||item.connectionId!==pinned.connectionId||connection?.id!==pinned.connectionId)throw browserFailure('This request belongs to its original AI connection. Reconnect that conversation before retrying.');if(error){item.delivery=error.deliveryUnknown?'uncertain':'failed';item.deliveryError=error.message;}else if(pinned.manual){item.delivery='manual';item.handoffPrompt=handoffPrompt;delete item.receipt;delete item.deliveredAt;delete item.deliveryError;}else{item.delivery='queued';item.deliveredAt=nowIso(now);item.receipt=receipt;delete item.deliveryError;}stores.boards.put(record);});notify({types:[kind==='chat'?'chat':'reviews'],board:boardId});if(pinned.manual&&error)throw error;
 };
 const request=async(route,options={})=>{
  try{
   if(closed)throw browserFailure('This browser storage connection is closed. Reopen the page.',503,'BROWSER_STORAGE_CLOSED');
   const url=new URL(route,origin),method=(options.method??'GET').toUpperCase(),pathname=url.pathname,input=parseBrowserBody(options.body,{backup:pathname==='/api/project/import'&&method==='POST'});
   if(url.origin!==new URL(origin).origin)throw browserFailure('Only this browser workspace can be accessed.',403);
   await atomic('readonly',async stores=>{const catalog=checkCatalog((await requestResult(stores.meta.get('catalog')))?.value);if(!catalog.boards.some(board=>board.id===boardId))throw deletedBoardError(catalog,origin);});
   if(pathname==='/api/workspaces/delete-preview'&&method==='POST'){const {kind,id}=z.object({kind:z.enum(['board','project']),id:z.string().uuid()}).parse(input);return (await atomic('readonly',stores=>deletionPreview(stores,kind,id))).preview;}
   if(pathname==='/api/workspaces'&&method==='POST'&&['delete-board','delete-project'].includes(input.action))return await deleteWorkspace(input.action==='delete-board'?'board':'project',input);
   if(pathname==='/api/connection'&&method==='GET')return connectionView();
   if(pathname==='/api/connection/detect'&&method==='GET')return bridge.detect();
   if(pathname==='/api/connection/oauth-request'&&method==='GET')return bridge.oauthRequest(url.searchParams.get('id'));
   if(pathname==='/api/connection/approve'&&method==='POST')return bridge.approve(input);
   if(pathname==='/api/connection/pairing'&&method==='POST'){const title=await atomic('readonly',async stores=>checkRecord(await requestResult(stores.boards.get(boardId)),boardId).planning.project.title);return bridge.pair(input,title);}
   if(pathname==='/api/connection/live/stop'&&method==='POST')return bridge.stopLive(safeUuid(input.sessionId));
   if(['/api/connection/disconnect','/api/connection/cancel'].includes(pathname)&&method==='POST'){await bridge.disconnect();return disconnected();}
   if(pathname==='/api/connection/web/stop'&&method==='POST')return disconnected();
   if(['/api/chat','/api/reviews'].includes(pathname)&&method==='GET')return atomic('readonly',async stores=>{const record=checkRecord(await requestResult(stores.boards.get(boardId)),boardId),connection=(await requestResult(stores.meta.get(`relay:v1:${boardId}`)))?.value?.connection;return pathname==='/api/chat'?chatView(record,connection):reviewView(record,connection);});
   if(['/api/chat','/api/reviews'].includes(pathname)&&method==='POST'){
     const kind=pathname==='/api/chat'?'chat':'review',created=await atomic('readwrite',async stores=>{const record=checkRecord(await requestResult(stores.boards.get(boardId)),boardId),connection=(await requestResult(stores.meta.get(`relay:v1:${boardId}`)))?.value?.connection,out=createCaptured(record,input,kind,connection,nowIso(now));if(out.created)stores.boards.put(record);return {id:out.item.id,created:out.created,needsHandoff:!automaticDeliveryFor(connection,kind,now())&&!out.item.handoffPrompt&&!['answered','reviewed'].includes(out.item.status)};});
     if(created.created||created.needsHandoff){notify({types:[kind==='chat'?'chat':'reviews'],board:boardId});await deliver(kind,created.id);}
    return atomic('readonly',async stores=>{const record=checkRecord(await requestResult(stores.boards.get(boardId)),boardId),connection=(await requestResult(stores.meta.get(`relay:v1:${boardId}`)))?.value?.connection;return kind==='chat'?chatView(record,connection):{request:metadata(record.reviews.find(r=>r.id===created.id)),connected:Boolean(connection?.connected),automaticMessages:automaticDeliveryFor(connection,kind)};});
   }
   if(['/api/chat/retry','/api/reviews/retry'].includes(pathname)&&method==='POST'){const id=safeUuid(input.id),kind=pathname==='/api/chat/retry'?'chat':'review';await deliver(kind,id,{retry:true});return atomic('readonly',async stores=>{const record=checkRecord(await requestResult(stores.boards.get(boardId)),boardId),connection=(await requestResult(stores.meta.get(`relay:v1:${boardId}`)))?.value?.connection;return kind==='chat'?chatView(record,connection):reviewView(record,connection);});}
   if(pathname.startsWith('/api/connection/')||pathname.startsWith('/api/agent/')||pathname.startsWith('/api/chat')||pathname.startsWith('/api/reviews')||pathname==='/api/proposal')throw browserFailure(connectorWip,501,'HOSTED_CONNECTOR_WIP');
   const readOnly=method==='GET'||['/api/presence'].includes(pathname)||['/api/checkpoint','/api/recovery'].includes(pathname)&&input.action==='read';
   const outcome=await atomic(readOnly?'readonly':'readwrite',async stores=>{
    const catalog=checkCatalog((await requestResult(stores.meta.get('catalog')))?.value);if(!catalog.boards.some(board=>board.id===boardId))throw deletedBoardError(catalog,origin);const record=checkRecord(await requestResult(stores.boards.get(boardId)),boardId),types=new Set();let catalogChanged=false,recordChanged=false,result;
    const writePlanning=()=>{recordChanged=true;types.add('planning');};
    const recovery=async(name,force=false)=>{if(await captureRecovery(stores,record,name,{force})){writePlanning();return true;}return false;};
    const drawing=input=>{const next=applyDrawing(record.board,input,now);record.board=next.board;if(next.changed){recordChanged=true;types.add('board');}return next.board;};
    const rename=title=>{if(renameCatalog(catalog,boardId,title)){catalogChanged=true;types.add('workspace');}};
    const restore=async(snapshot,expectedRevision,expectedVersion,summary)=>{
     if(record.board.revision!==expectedRevision)throw browserFailure('The board changed. Reopen the saved preview before restoring.');
     if(expectedVersion!==undefined&&record.planning.version!==expectedVersion)throw browserFailure('Project details changed. Reopen the saved preview before restoring.');
     await recovery('Before restoring the board',true);const project=validateBrowserProject(snapshot.project),patch=restoreChanges(record.board,snapshot,now);drawing({...patch,summary});record.planning.project=project;record.planning.version++;writePlanning();rename(project.title);return {revision:record.board.revision};
    };
    if(pathname==='/api/session'&&method==='GET')result={boardId};
    else if(pathname==='/api/health'&&method==='GET')result={ok:true,name:'shared-board',product:'SharedBoard.app',version:APP_VERSION,revision:record.board.revision,features:{storage:'browser',webConnectors:true,localConnectors:false}};
    else if(pathname==='/api/board'&&method==='GET')result=record.board;
    else if(pathname==='/api/planning'&&method==='GET')result=planningView(record);
    else if(pathname==='/api/workspaces'&&method==='GET')result=workspaceView(catalog,boardId);
    else if(pathname==='/api/board'&&method==='PATCH'){
     const patch=browserPatchSchema.parse(input);const next=applyDrawing(record.board,patch,now);
     if(next.changed){await recovery('Automatic drawing recovery');if(recordNormalization(record,record.board,next.board,patch.changes))writePlanning();record.board=next.board;recordChanged=true;types.add('board');}result=record.board;
    }
    else if(pathname==='/api/undo-agent'&&method==='POST'){
     const id=safeUuid(input.id),action=record.planning.agentActions.find(entry=>entry.id===id);
     if(!action||action.undone||!Array.isArray(action.after)||!Array.isArray(action.before))throw browserFailure('That AI change has already been undone or is no longer available.');
     if(action.after.some(element=>record.board.elementVersions[element.id]!==element.expectedVersion))throw browserFailure('Some of these objects were edited afterward. Their newer changes have been preserved. Use a checkpoint or ask for a new drawing change.');
     const map=new Map(record.board.elements.map(element=>[element.id,element]));
     if(action.after.some(element=>!map.has(element.id)))throw browserFailure('Some of these objects are no longer available. Their current drawing has been preserved.');
     const changes=action.after.map((reference,index)=>{const current=map.get(reference.id);return {id:reference.id,expectedVersion:reference.expectedVersion,element:{...clone(action.before[index]??{...current,isDeleted:true}),version:(current.version??1)+1,versionNonce:Math.floor(Math.random()*2**30),updated:now()}};});
     await recovery('Before undoing an AI drawing change',true);drawing({changes,summary:'You undid an AI drawing change'});action.undone=true;record.planning.version++;writePlanning();result={ok:true};
    }
    else if(pathname==='/api/planning'&&method==='PUT'){
     const {expectedVersion}=z.object({expectedVersion:z.number().int().min(0)}).parse(input);if(expectedVersion!==record.planning.version)throw browserFailure('Project details changed in another tab. Your draft is preserved; reopen the panel to use the latest details.');
     const project=validateBrowserProject(input.project);await recovery('Before updating planning notes');record.planning.project=project;record.planning.version++;writePlanning();rename(project.title);result=planningView(record);
    }
    else if(pathname==='/api/workspaces'&&method==='POST'){
     const action=z.enum(['create-project','rename-project','create-board','rename-board']).parse(input.action);
     if(action==='create-project'){if(catalog.projects.length>=50)throw browserFailure('This workspace supports up to 50 projects.',429);const name=z.string().trim().min(1).max(100).parse(input.name);catalog.projects.push({id:randomUUID(),name});}
     if(action==='rename-project'){const id=safeUuid(input.id),project=catalog.projects.find(project=>project.id===id);if(!project)throw browserFailure('That project does not exist.',404);project.name=z.string().trim().min(1).max(100).parse(input.name);}
     if(action==='create-board'){if(catalog.boards.length>=150)throw browserFailure('This workspace supports up to 150 boards.',429);const projectId=safeUuid(input.projectId),title=z.string().trim().min(1).max(100).parse(input.title);if(!catalog.projects.some(project=>project.id===projectId))throw browserFailure('Choose an existing project.',404);const id=randomUUID();catalog.boards.push({id,projectId,title});stores.boards.put(newRecord(id,title,now));}
     if(action==='rename-board'){const id=safeUuid(input.id),board=catalog.boards.find(board=>board.id===id);if(!board)throw browserFailure('That board does not exist.',404);const title=z.string().trim().min(1).max(100).parse(input.title),target=checkRecord(await requestResult(stores.boards.get(id)),id);await captureRecovery(stores,target,'Before renaming this board');target.planning.project.title=title;target.planning.version++;stores.boards.put(target);board.title=title;if(id===boardId){Object.assign(record,target);writePlanning();}}
     catalog.version++;catalogChanged=true;types.add('workspace');result=workspaceView(catalog,boardId);
    }
    else if(pathname==='/api/workspaces/open'&&method==='POST'){const id=safeUuid(input.id);workspaceView(catalog,id);checkRecord(await requestResult(stores.boards.get(id)),id);result={url:`${new URL(origin).origin}${id===catalog.legacyBoardId?'/':`/boards/${id}/`}`};}
    else if(pathname==='/api/presence'&&method==='POST'){record.selectedIds=z.object({selectedIds:z.array(browserIdSchema).max(10000)}).parse(input).selectedIds;recordChanged=true;result={ok:true};}
    else if(pathname==='/api/visual'&&method==='POST'){const {expectedRevision}=z.object({expectedRevision:z.number().int().min(0)}).parse(input),dataURL=validateBrowserVisual(input.visual);if(expectedRevision!==record.board.revision)result={saved:false,reason:'The board changed during rendering.'};else{record.visual={boardId,revision:record.board.revision,at:nowIso(now),dataURL};recordChanged=true;result={saved:true,revision:record.board.revision};}}
    else if(pathname==='/api/project/export'&&method==='GET'){const elements=record.board.elements.filter(element=>!element.isDeleted),used=new Set(elements.map(element=>element.fileId).filter(Boolean));result={type:'sharedboard-project',formatVersion:1,appVersion:APP_VERSION,exportedAt:nowIso(now),board:{elements,files:Object.fromEntries(Object.entries(record.board.files).filter(([id])=>used.has(id)))},project:record.planning.project};}
    else if(pathname==='/api/project/import'&&method==='POST'){const {expectedRevision,expectedVersion}=z.object({expectedRevision:z.number().int().min(0),expectedVersion:z.number().int().min(0)}).parse(input),backup=validateBrowserBackup(input.backup);result=await restore(backup,expectedRevision,expectedVersion,'You restored a board backup');}
    else if(pathname==='/api/checkpoints'&&method==='POST'){
     const {name,expectedRevision}=z.object({name:z.string().trim().min(1).max(100),expectedRevision:z.number().int().min(0)}).parse(input);if(expectedRevision!==record.board.revision)throw browserFailure('The board changed. Save your checkpoint again.');if(record.planning.checkpoints.length>=40)throw browserFailure('You have 40 checkpoints. Remove an old checkpoint before saving another.',429);
     const id=randomUUID(),entry={id,name,revision:record.board.revision,at:nowIso(now),objectCount:record.board.elements.filter(element=>!element.isDeleted).length};stores.snapshots.put({id,boardId,kind:'checkpoint',board:clone(record.board),project:clone(record.planning.project)});record.planning.checkpoints.unshift(entry);record.planning.version++;writePlanning();result=entry;
    }
    else if(['/api/checkpoint','/api/recovery'].includes(pathname)&&method==='POST'){
     const isRecovery=pathname==='/api/recovery',id=safeUuid(input.id),action=z.enum(isRecovery?['read','restore']:['read','restore','delete']).parse(input.action),list=isRecovery?record.recoveries:record.planning.checkpoints;
     if(!list.some(entry=>entry.id===id))throw browserFailure('That saved snapshot no longer exists.',404);const snapshot=await requestResult(stores.snapshots.get(id));if(!snapshot||snapshot.boardId!==boardId||snapshot.kind!==(isRecovery?'recovery':'checkpoint'))throw browserFailure('That saved snapshot is unreadable. Its browser data has been preserved.',500,'BROWSER_STORAGE_CORRUPT');
     if(action==='read')result={board:snapshot.board,project:snapshot.project};
     else if(action==='delete'){stores.snapshots.delete(id);record.planning.checkpoints=list.filter(entry=>entry.id!==id);record.planning.version++;writePlanning();result={ok:true};}
     else{const {expectedRevision,expectedVersion}=z.object({expectedRevision:z.number().int().min(0),expectedVersion:z.number().int().min(0).optional()}).parse(input);if(isRecovery&&expectedVersion===undefined)throw browserFailure('Reopen the recovery preview before restoring.');result=await restore(snapshot,expectedRevision,expectedVersion,isRecovery?'You restored an automatic recovery save':'You restored a saved checkpoint');}
    }
    else throw browserFailure('Unknown browser board operation.',404);
    if(recordChanged)stores.boards.put(record);if(catalogChanged)stores.meta.put({key:'catalog',value:catalog});
    return {result:clone(result),notice:{types:[...types],board:boardId,clientId:input.clientId??null}};
   });notify(outcome.notice);return outcome.result;
  }catch(error){throw normalizeBrowserError(error);}
 };
 // Attach listeners before taking this snapshot, so a tab cannot miss a write
 // committed between its initial reads and subscription to browser events.
 const ready=async()=>{
  // Network checks run after the drawing opens. Never invalidate another live
  // tab's shared grant merely because this tab is opening the same board.
  const snapshot=await atomic('readonly',async stores=>{const catalog=checkCatalog((await requestResult(stores.meta.get('catalog')))?.value);if(!catalog.boards.some(board=>board.id===boardId))throw deletedBoardError(catalog,origin);return {catalog,record:checkRecord(await requestResult(stores.boards.get(boardId)),boardId),connection:(await requestResult(stores.meta.get(`relay:v1:${boardId}`)))?.value?.connection??disconnected()};});
  if(!closed){events.emit('connected',{board:snapshot.record.board,planning:planningView(snapshot.record),workspace:workspaceView(snapshot.catalog,boardId),connection:snapshot.connection,reviews:reviewView(snapshot.record,snapshot.connection),chat:chatView(snapshot.record,snapshot.connection),lastAgentAt:snapshot.record.lastAgentAt??null});bridge.start();void bridge.status();}
 };
 return {request,events,close,boardId,ready,detectBridge:()=>bridge.detect(),bridgeStatus:()=>bridge.status()};
}
