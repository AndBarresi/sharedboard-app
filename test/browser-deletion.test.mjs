import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory,IDBObjectStore} from 'fake-indexeddb';
import {createBrowserTransport} from '../src/browser-store.mjs';

const call=(transport,route,input,method=input===undefined?'GET':'POST')=>transport.request(route,{method,...(input===undefined?{}:{body:JSON.stringify(input)})});
const box=id=>({id,type:'rectangle',x:10,y:20,width:100,height:50,version:1,versionNonce:42,updated:1,isDeleted:false});
const patch=(transport,id)=>call(transport,'/api/board',{changes:[{id,expectedVersion:0,element:box(id)}]},'PATCH');
const options=extra=>({indexedDB:new IDBFactory(),dbName:crypto.randomUUID(),BroadcastChannel:null,origin:'https://sharedboard.test',bridgeWebSocket:null,...extra});
const response=(value,status=200)=>Response.json(value,{status});
const openDb=config=>new Promise((resolve,reject)=>{const request=config.indexedDB.open(config.dbName);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
const raw=async(config,store,operation)=>{const db=await openDb(config);try{return await new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite'),result=operation(tx.objectStore(store));let value;result.onsuccess=()=>{value=result.result;};result.onerror=()=>reject(result.error);tx.oncomplete=()=>resolve(value);tx.onabort=()=>reject(tx.error);});}finally{db.close();}};
const savedGrant=(boardId,token)=>({browserToken:token,sessionId:crypto.randomUUID(),connection:{id:crypto.randomUUID(),boardId,connected:true,permission:'edit',provider:'codex'}});
const addBoard=async(transport,title,projectId)=>{const before=await call(transport,'/api/workspaces'),catalog=await call(transport,'/api/workspaces',{action:'create-board',projectId:projectId??before.currentProjectId,title});return catalog.boards.find(board=>!before.boards.some(old=>old.id===board.id));};
const preview=(transport,kind,id)=>call(transport,'/api/workspaces/delete-preview',{kind,id});
const remove=(transport,review)=>call(transport,'/api/workspaces',{action:`delete-${review.kind}`,id:review.id,expectedVersion:review.expectedVersion,boards:review.boards});
class TestChannel{
 static channels=new Map();
 constructor(name){this.name=name;this.closed=false;if(!TestChannel.channels.has(name))TestChannel.channels.set(name,new Set());TestChannel.channels.get(name).add(this);}
 postMessage(data){for(const channel of TestChannel.channels.get(this.name))if(channel!==this)queueMicrotask(()=>{if(!channel.closed)channel.onmessage?.({data:structuredClone(data)});});}
 close(){this.closed=true;TestChannel.channels.get(this.name).delete(this);}
}
const listen=(events,type)=>new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error(`No ${type} event`)),2000);events.addEventListener(type,event=>{clearTimeout(timeout);resolve(JSON.parse(event.data));},{once:true});});

test('confirmed board deletion revokes only its grant and removes its saved contents, snapshots and metadata',async()=>{
 const requests=[],config=options({bridgeFetch:async(url,init)=>{requests.push({url,token:init.headers['x-sharedboard-browser']});return response({ok:true});}}),root=await createBrowserTransport(config);let child;
 try{
  await patch(root,'keep-root');const target=await addBoard(root,'Disposable test board');child=await createBrowserTransport({...config,basePath:`/boards/${target.id}`});await patch(child,'delete-child');await call(child,'/api/checkpoints',{name:'Disposable checkpoint',expectedRevision:1});
  const rootBefore=await call(root,'/api/board'),targetRecord=await raw(config,'boards',store=>store.get(target.id));targetRecord.messages=[{id:crypto.randomUUID(),text:'Synthetic private capture',snapshot:{board:targetRecord.board},reply:'Synthetic stored answer'}];targetRecord.reviews=[{id:crypto.randomUUID(),snapshot:{board:targetRecord.board}}];await raw(config,'boards',store=>store.put(targetRecord));
  await raw(config,'meta',store=>store.put({key:`relay:v1:${root.boardId}`,value:savedGrant(root.boardId,'keep-root-token')}));await raw(config,'meta',store=>store.put({key:`relay:v1:${target.id}`,value:savedGrant(target.id,'delete-child-token')}));
  const review=await preview(root,'board',target.id);assert.equal(review.title,'Disposable test board');assert.equal(review.boardCount,1);assert.deepEqual(review.boards,[{id:target.id,revision:1,planningVersion:1}]);
  const result=await remove(root,review);assert.equal(result.currentBoardDeleted,false);assert.equal(result.currentBoardId,root.boardId);assert.deepEqual(result.deletedBoardIds,[target.id]);assert.equal(result.boards.some(board=>board.id===target.id),false);assert.equal(requests.length,1);assert.equal(requests[0].url,'https://connect.sharedboard.app/browser/disconnect');assert.equal(requests[0].token,'delete-child-token');
  assert.deepEqual(await call(root,'/api/board'),rootBefore);assert.equal((await raw(config,'meta',store=>store.get(`relay:v1:${root.boardId}`))).value.browserToken,'keep-root-token');assert.equal(await raw(config,'boards',store=>store.get(target.id)),undefined);assert.equal(await raw(config,'meta',store=>store.get(`relay:v1:${target.id}`)),undefined);assert.equal((await raw(config,'snapshots',store=>store.getAll())).some(snapshot=>snapshot.boardId===target.id),false);assert.equal((await raw(config,'meta',store=>store.get(`deleted-board:v1:${target.id}`))).value.boardId,target.id);
  await assert.rejects(patch(child,'must-not-return'),error=>error.status===410&&error.code==='BOARD_DELETED');await assert.rejects(createBrowserTransport({...config,basePath:`/boards/${target.id}`}),error=>error.status===404);
 }finally{child?.close();root.close();}
});

test('deletion confirmation rejects renamed catalogs, newer drawings and newer planning without revoking or deleting',async()=>{
 let requests=0;const config=options({bridgeFetch:async()=>{requests++;return response({ok:true});}}),root=await createBrowserTransport(config);let child;
 try{
  const target=await addBoard(root,'Review me');child=await createBrowserTransport({...config,basePath:`/boards/${target.id}`});await raw(config,'meta',store=>store.put({key:`relay:v1:${target.id}`,value:savedGrant(target.id,'review-token')}));
  let review=await preview(root,'board',target.id);await call(root,'/api/workspaces',{action:'rename-board',id:target.id,title:'Changed title'});await assert.rejects(remove(root,review),error=>error.code==='DELETE_PREVIEW_STALE');
  review=await preview(root,'board',target.id);await patch(child,'new-human-work');await assert.rejects(remove(root,review),error=>error.code==='DELETE_PREVIEW_STALE');
  review=await preview(root,'board',target.id);const planning=await call(child,'/api/planning');await call(child,'/api/planning',{expectedVersion:planning.version,project:{...planning.project,title:'New planning title'}},'PUT');await assert.rejects(remove(root,review),error=>error.code==='DELETE_PREVIEW_STALE');assert.equal(requests,0);assert.equal((await call(child,'/api/board')).elements[0].id,'new-human-work');
  await assert.rejects(remove(root,{...await preview(root,'board',target.id),boards:[]}),error=>error.code==='DELETE_PREVIEW_STALE');await assert.rejects(call(root,'/api/workspaces',{action:'delete-board',id:target.id}),error=>error.status===400);
 }finally{child?.close();root.close();}
});

test('project deletion reviews all its boards and preserves unrelated projects and their grants',async()=>{
 const tokens=[],config=options({bridgeFetch:async(url,init)=>{tokens.push(init.headers['x-sharedboard-browser']);return response({ok:true});}}),root=await createBrowserTransport(config);const children=[];
 try{
  const before=await call(root,'/api/workspaces'),catalog=await call(root,'/api/workspaces',{action:'create-project',name:'Disposable project'}),projectId=catalog.projects.find(project=>!before.projects.some(old=>old.id===project.id)).id;
  for(const title of ['One','Two']){const board=await addBoard(root,title,projectId),child=await createBrowserTransport({...config,basePath:`/boards/${board.id}`});children.push(child);await patch(child,`delete-${title}`);await call(child,'/api/checkpoints',{name:'Disposable checkpoint',expectedRevision:1});await raw(config,'meta',store=>store.put({key:`relay:v1:${board.id}`,value:savedGrant(board.id,`delete-${title}-token`)}));}
  await raw(config,'meta',store=>store.put({key:`relay:v1:${root.boardId}`,value:savedGrant(root.boardId,'keep-token')}));
  const review=await preview(root,'project',projectId);assert.equal(review.boardCount,2);const result=await remove(root,review);assert.deepEqual(result.deletedProjectIds,[projectId]);assert.equal(result.currentBoardDeleted,false);assert.deepEqual(new Set(result.deletedBoardIds),new Set(children.map(child=>child.boardId)));assert.equal(result.projects.length,1);assert.equal(result.boards.length,1);assert.deepEqual(tokens.sort(),['delete-One-token','delete-Two-token']);assert.equal((await raw(config,'meta',store=>store.get(`relay:v1:${root.boardId}`))).value.browserToken,'keep-token');assert.equal((await raw(config,'snapshots',store=>store.getAll())).length,0);
 }finally{children.forEach(child=>child.close());root.close();}
});

test('deleting the last project creates a fresh fallback and stale root tabs cannot resurrect the deleted board',async()=>{
 const config=options({BroadcastChannel:TestChannel}),a=await createBrowserTransport(config),b=await createBrowserTransport(config);let fresh;
 try{
  await patch(a,'discarded');const catalog=await call(a,'/api/workspaces'),deleted=listen(b.events,'board-deleted'),review=await preview(a,'project',catalog.currentProjectId),result=await remove(a,review),notice=await deleted;
  assert.equal(result.currentBoardDeleted,true);assert.equal(result.url,'https://sharedboard.test/');assert.equal(result.projects.length,1);assert.equal(result.boards.length,1);assert.notEqual(result.currentBoardId,a.boardId);assert.equal(result.legacyBoardId,result.currentBoardId);assert.equal(notice.boardId,a.boardId);assert.equal(notice.fallbackBoardId,result.currentBoardId);assert.equal(b.boardId,a.boardId,'an existing tab stays pinned until its user explicitly opens another board');
  for(const stale of [a,b]){await assert.rejects(patch(stale,'resurrect'),error=>error.code==='BOARD_DELETED');await assert.rejects(call(stale,'/api/connection/pairing',{provider:'codex',permission:'edit'}),error=>error.code==='BOARD_DELETED');}
  fresh=await createBrowserTransport(config);assert.equal(fresh.boardId,result.currentBoardId);assert.equal((await call(fresh,'/api/board')).elements.length,0);assert.equal((await call(fresh,'/api/board')).revision,0);assert.equal(await raw(config,'boards',store=>store.get(a.boardId)),undefined);assert.equal((await raw(config,'meta',store=>store.get(`deleted-board:v1:${a.boardId}`))).value.fallbackBoardId,fresh.boardId);
 }finally{fresh?.close();a.close();b.close();}
});

test('uncertain or unsuccessful grant revocation preserves board data; only exact already-disconnected responses permit deletion',async()=>{
 for(const mode of ['network','unreadable','denied','unpaired','expired']){
  const config=options({bridgeFetch:async()=>{if(mode==='network')throw new Error('Connection lost');if(mode==='unreadable')return new Response('Not JSON');if(mode==='denied')return response({error:'Denied',code:'OTHER_DENIED'},403);if(mode==='unpaired')return response({error:'Wrong token',code:'BROWSER_NOT_PAIRED'},401);return response({error:'Expired session',code:'RELAY_DISCONNECTED'},401);}}),root=await createBrowserTransport(config);
  try{const target=await addBoard(root,'Keep on failure');await raw(config,'meta',store=>store.put({key:`relay:v1:${target.id}`,value:savedGrant(target.id,'target-token')}));const review=await preview(root,'board',target.id);if(mode==='expired'){assert.equal((await remove(root,review)).deletedBoardIds[0],target.id);}else{await assert.rejects(remove(root,review));assert.ok(await raw(config,'boards',store=>store.get(target.id)));assert.ok(await raw(config,'meta',store=>store.get(`relay:v1:${target.id}`)));assert.equal(await raw(config,'meta',store=>store.get(`deleted-board:v1:${target.id}`)),undefined);}}finally{root.close();}
 }
});

test('a new grant or newer drawing during revocation aborts deletion without touching the replacement grant',async()=>{
 for(const mode of ['grant','drawing']){
  let during;const revoked=[],config=options({bridgeFetch:async(url,init)=>{revoked.push(init.headers['x-sharedboard-browser']);await during();return response({ok:true});}}),root=await createBrowserTransport(config);let child;
  try{const target=await addBoard(root,'Race test');child=await createBrowserTransport({...config,basePath:`/boards/${target.id}`});await raw(config,'meta',store=>store.put({key:`relay:v1:${target.id}`,value:savedGrant(target.id,'original-token')}));during=async()=>{if(mode==='grant')await raw(config,'meta',store=>store.put({key:`relay:v1:${target.id}`,value:savedGrant(target.id,'replacement-token')}));else await patch(child,'newer-work');};const review=await preview(root,'board',target.id);await assert.rejects(remove(root,review),error=>error.code==='DELETE_PREVIEW_STALE');assert.deepEqual(revoked,['original-token']);assert.ok(await raw(config,'boards',store=>store.get(target.id)));if(mode==='grant')assert.equal((await raw(config,'meta',store=>store.get(`relay:v1:${target.id}`))).value.browserToken,'replacement-token');else assert.equal((await call(child,'/api/board')).elements[0].id,'newer-work');}finally{child?.close();root.close();}
 }
});

test('deletion transaction rollback preserves catalog, board and checkpoints on storage failure',async()=>{
 const config=options(),root=await createBrowserTransport(config),removeRecord=IDBObjectStore.prototype.delete;
 try{const target=await addBoard(root,'Rollback test'),before=await call(root,'/api/workspaces'),review=await preview(root,'board',target.id);IDBObjectStore.prototype.delete=function(...args){if(this.name==='boards')throw new DOMException('Simulated storage failure','QuotaExceededError');return removeRecord.apply(this,args);};await assert.rejects(remove(root,review),error=>error.code==='BROWSER_STORAGE_FULL');IDBObjectStore.prototype.delete=removeRecord;assert.deepEqual(await call(root,'/api/workspaces'),before);assert.ok(await raw(config,'boards',store=>store.get(target.id)));assert.equal(await raw(config,'meta',store=>store.get(`deleted-board:v1:${target.id}`)),undefined);}finally{IDBObjectStore.prototype.delete=removeRecord;root.close();}
});

test('a delayed relay response cannot restore deleted credentials even without cross-tab broadcasting',async()=>{
 let release,requested;const observed=new Promise(resolve=>{requested=resolve;}),paused=new Promise(resolve=>{release=resolve;});let grant;
 const config=options({bridgeFetch:async url=>{if(new URL(url).pathname==='/browser/status'){requested();await paused;return response({connection:grant.connection});}return response({ok:true});}}),root=await createBrowserTransport(config);let child;
 try{const target=await addBoard(root,'Late response test');child=await createBrowserTransport({...config,basePath:`/boards/${target.id}`});grant=savedGrant(target.id,'stale-token');await raw(config,'meta',store=>store.put({key:`relay:v1:${target.id}`,value:grant}));const pending=child.bridgeStatus();await observed;const deleted=listen(child.events,'board-deleted');await remove(root,await preview(root,'board',target.id));release();await pending;assert.equal((await deleted).boardId,target.id);assert.equal(await raw(config,'meta',store=>store.get(`relay:v1:${target.id}`)),undefined);assert.equal(await raw(config,'boards',store=>store.get(target.id)),undefined);await assert.rejects(patch(child,'stale-response-write'),error=>error.code==='BOARD_DELETED');}finally{release?.();child?.close();root.close();}
});
