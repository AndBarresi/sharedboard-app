import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory,IDBObjectStore} from 'fake-indexeddb';
import {createBrowserTransport} from '../src/browser-store.mjs';

const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6Z5kAAAAASUVORK5CYII=';
const box=(id='box',x=10)=>({id,type:'rectangle',x,y:20,width:200,height:100,version:1,versionNonce:42,updated:1,isDeleted:false});
const call=(transport,route,input,method=input===undefined?'GET':'POST')=>transport.request(route,{method,...(input===undefined?{}:{body:JSON.stringify(input)})});
const patch=(transport,changes,extra={})=>call(transport,'/api/board',{changes,...extra},'PATCH');
function options(){return {indexedDB:new IDBFactory(),dbName:crypto.randomUUID(),BroadcastChannel:null,origin:'https://sharedboard.test'};}
function listen(events,type){return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error(`No ${type} event`)),2000);events.addEventListener(type,event=>{clearTimeout(timeout);resolve(JSON.parse(event.data));},{once:true});});}
function openDb(indexedDB,name,version){return new Promise((resolve,reject)=>{const request=indexedDB.open(name,version);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
function putRaw(db,store,value){return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(value);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});}
function records(db,store){return new Promise((resolve,reject)=>{const tx=db.transaction(store),request=tx.objectStore(store).getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
class TestBroadcastChannel{
 static channels=new Map();
 constructor(name){this.name=name;this.closed=false;if(!TestBroadcastChannel.channels.has(name))TestBroadcastChannel.channels.set(name,new Set());TestBroadcastChannel.channels.get(name).add(this);}
 postMessage(data){for(const channel of TestBroadcastChannel.channels.get(this.name))if(channel!==this)queueMicrotask(()=>{if(!channel.closed)channel.onmessage?.({data:structuredClone(data)});});}
 close(){this.closed=true;TestBroadcastChannel.channels.get(this.name).delete(this);}
}

test('concurrent browser first opens create one catalog and preserve drawings and images across reopening',async()=>{
 const config=options(),transports=await Promise.all(Array.from({length:4},()=>createBrowserTransport(config)));
 try{
  assert.equal(new Set(transports.map(t=>t.boardId)).size,1);const workspace=await call(transports[0],'/api/workspaces');assert.equal(workspace.projects.length,1);assert.equal(workspace.boards.length,1);
  const image={...box('reference'),type:'image',fileId:'reference_file'};await patch(transports[0],[{id:image.id,expectedVersion:0,element:image}],{files:{reference_file:{id:'reference_file',mimeType:'image/png',dataURL:png,created:1}}});
  transports.forEach(t=>t.close());const reopened=await createBrowserTransport(config);transports.push(reopened);const board=await call(reopened,'/api/board');assert.equal(board.revision,1);assert.equal(board.elements[0].fileId,'reference_file');assert.equal(board.files.reference_file.dataURL,png);
 }finally{transports.forEach(t=>t.close());}
});

test('concurrent tabs merge disjoint objects and reject overlapping stale writes atomically',async()=>{
 const config=options(),[a,b]=await Promise.all([createBrowserTransport(config),createBrowserTransport(config)]);
 try{
  await Promise.all([patch(a,[{id:'a',expectedVersion:0,element:box('a')}]),patch(b,[{id:'b',expectedVersion:0,element:box('b',500)}])]);const initial=await call(a,'/api/board');assert.equal(initial.revision,2);assert.equal(initial.elements.length,2);
  const results=await Promise.allSettled([patch(a,[{id:'a',expectedVersion:1,element:box('a',100)}]),patch(b,[{id:'a',expectedVersion:1,element:box('a',200)},{id:'b',expectedVersion:1,element:box('b',900)}])]);assert.equal(results.filter(result=>result.status==='fulfilled').length,1);const rejected=results.find(result=>result.status==='rejected').reason;assert.equal(rejected.status,409);assert.ok(rejected.conflicts.includes('a'));assert.equal(rejected.board.revision,3);
  const current=await call(a,'/api/board');assert.equal(current.revision,3);if(current.elements.find(e=>e.id==='a').x===100)assert.equal(current.elements.find(e=>e.id==='b').x,500,'the losing batch must not partially move its other object');
 }finally{a.close();b.close();}
});

test('planning requirements, areas and reusable blocks persist and stale planning writes preserve the newer project',async()=>{
 const config=options(),a=await createBrowserTransport(config),b=await createBrowserTransport(config);
 try{
  const plan=await call(a,'/api/planning'),project={...plan.project,title:'Travel app',areas:[{id:crypto.randomUUID(),name:'Navigation',elementIds:['box'],bounds:{x:0,y:0,width:300,height:200}}],notes:[{id:crypto.randomUUID(),title:'Keep dates visible',text:'Show departure and arrival dates.',kind:'requirement',status:'open',elementIds:['box'],createdAt:new Date().toISOString(),result:''}],library:[{id:crypto.randomUUID(),name:'Reference card',elements:[box()],files:{}}]};
  const saved=await call(a,'/api/planning',{expectedVersion:plan.version,project},'PUT');assert.equal(saved.version,1);await assert.rejects(call(b,'/api/planning',{expectedVersion:plan.version,project:{...project,title:'Stale title'}},'PUT'),error=>error.status===409);const latest=await call(b,'/api/planning');assert.deepEqual(latest.project,project);assert.equal((await call(b,'/api/workspaces')).boards[0].title,'Travel app');
  a.close();const reopened=await createBrowserTransport(config);try{assert.deepEqual((await call(reopened,'/api/planning')).project,project);}finally{reopened.close();}
 }finally{a.close();b.close();}
});

test('projects and boards have isolated data, stable URLs and durable cold-board renames',async()=>{
 const config=options(),root=await createBrowserTransport(config);let child;
 try{
  const catalog=await call(root,'/api/workspaces'),projectId=catalog.projects[0].id,created=await call(root,'/api/workspaces',{action:'create-board',projectId,title:'Scheduling'}),id=created.boards.find(board=>board.id!==root.boardId).id;
  const opened=await call(root,'/api/workspaces/open',{id});assert.equal(opened.url,`https://sharedboard.test/boards/${id}/`);await call(root,'/api/workspaces',{action:'rename-board',id,title:'Available departures'});child=await createBrowserTransport({...config,basePath:`/boards/${id}`});assert.equal((await call(child,'/api/planning')).project.title,'Available departures');await patch(child,[{id:'private_child',expectedVersion:0,element:box('private_child')}]);assert.equal((await call(root,'/api/board')).elements.length,0);
  await assert.rejects(createBrowserTransport({...config,basePath:`/boards/${crypto.randomUUID()}`}),error=>error.status===404);assert.equal((await call(root,'/api/workspaces')).boards.length,2);
 }finally{root.close();child?.close();}
});

test('cross-tab commits broadcast saved drawing, planning and renamed board state',async()=>{
 const config={...options(),BroadcastChannel:TestBroadcastChannel},a=await createBrowserTransport(config),b=await createBrowserTransport(config);let child;
 try{
  const boardEvent=listen(b.events,'board');await patch(a,[{id:'from_other_tab',expectedVersion:0,element:box('from_other_tab')}],{clientId:'tab_a'});assert.equal((await boardEvent).board.elements[0].id,'from_other_tab');assert.equal((await call(b,'/api/board')).revision,1);
  const workspace=await call(a,'/api/workspaces'),created=await call(a,'/api/workspaces',{action:'create-board',projectId:workspace.currentProjectId,title:'Other board'}),id=created.boards.find(board=>board.id!==a.boardId).id;child=await createBrowserTransport({...config,basePath:`/boards/${id}`});const planEvent=listen(child.events,'planning');await call(a,'/api/workspaces',{action:'rename-board',id,title:'Renamed in another tab'});assert.equal((await planEvent).project.title,'Renamed in another tab');
 }finally{a.close();b.close();child?.close();}
});

test('ready catches drawing, planning and catalog writes between initial reads and event subscription',async()=>{
 const config={...options(),BroadcastChannel:TestBroadcastChannel},first=await createBrowserTransport(config),second=await createBrowserTransport(config);
 try{
  const initialBoard=await call(first,'/api/board'),initialPlan=await call(first,'/api/planning'),initialWorkspace=await call(first,'/api/workspaces');
  assert.equal(initialBoard.revision,0);assert.equal(initialPlan.version,0);assert.equal(initialWorkspace.projects.length,1);
  await patch(second,[{id:'before_listeners',expectedVersion:0,element:box('before_listeners')}],{clientId:'before_ready'});
  const project={...initialPlan.project,title:'Updated before subscription',notes:[{id:crypto.randomUUID(),title:'Subscription race',text:'Keep the most recent drawing and requirements.',kind:'requirement',status:'open',elementIds:['before_listeners'],createdAt:new Date().toISOString(),result:''}]};
  const latestPlan=await call(second,'/api/planning',{expectedVersion:initialPlan.version,project},'PUT');
  const latestWorkspace=await call(second,'/api/workspaces',{action:'create-project',name:'Created before subscription'});
  const connectedEvent=listen(first.events,'connected');await first.ready();const connected=await connectedEvent;
  assert.equal(connected.board.revision,1);assert.equal(connected.board.elements[0].id,'before_listeners');
  assert.deepEqual(connected.planning,latestPlan);assert.deepEqual(connected.workspace,latestWorkspace);
  assert.equal(connected.connection.connected,false);assert.deepEqual(connected.chat.messages,[]);assert.deepEqual(connected.reviews.requests,[]);
  const afterReady=new Promise((resolve,reject)=>{
   const timeout=setTimeout(()=>{first.events.removeEventListener('board',receive);reject(new Error('No post-ready drawing broadcast'));},2000);
   const receive=event=>{const value=JSON.parse(event.data);if(value.clientId!=='after_ready')return;clearTimeout(timeout);first.events.removeEventListener('board',receive);resolve(value);};
   first.events.addEventListener('board',receive);
  });
  await patch(second,[{id:'before_listeners',expectedVersion:1,element:box('before_listeners',900)}],{clientId:'after_ready'});
  const updated=await afterReady;assert.equal(updated.board.revision,2);assert.equal(updated.board.elements[0].x,900);assert.equal((await call(first,'/api/board')).revision,2);
 }finally{first.close();second.close();}
});

test('checkpoint restore preserves image bytes and notes, rejects stale previews and does not roll versions backward',async()=>{
 const transport=await createBrowserTransport(options());try{
  const element={...box('image'),type:'image',fileId:'img'};await patch(transport,[{id:'image',expectedVersion:0,element}],{files:{img:{id:'img',dataURL:png,mimeType:'image/png',created:1}}});let plan=await call(transport,'/api/planning');const originalProject={...plan.project,notes:[{id:crypto.randomUUID(),title:'Original requirement',text:'Preserve this',kind:'requirement',status:'open',elementIds:['image'],createdAt:new Date().toISOString(),result:''}]};plan=await call(transport,'/api/planning',{expectedVersion:plan.version,project:originalProject},'PUT');const checkpoint=await call(transport,'/api/checkpoints',{name:'Approved design',expectedRevision:1});
  await patch(transport,[{id:'image',expectedVersion:1,element:{...element,x:900}}]);plan=await call(transport,'/api/planning');await call(transport,'/api/planning',{expectedVersion:plan.version,project:{...plan.project,notes:[]}},'PUT');plan=await call(transport,'/api/planning');const current=await call(transport,'/api/board');await assert.rejects(call(transport,'/api/checkpoint',{id:checkpoint.id,action:'restore',expectedRevision:1,expectedVersion:plan.version}),error=>error.status===409);
  await call(transport,'/api/checkpoint',{id:checkpoint.id,action:'restore',expectedRevision:current.revision,expectedVersion:plan.version});const restored=await call(transport,'/api/board');assert.equal(restored.elements[0].x,10);assert.equal(restored.files.img.dataURL,png);assert.ok(restored.elementVersions.image>2);const after=await call(transport,'/api/planning');assert.deepEqual(after.project,originalProject);assert.equal(after.checkpoints.length,1);assert.ok(after.recoveries.some(entry=>entry.revision===current.revision));
 }finally{transport.close();}
});

test('automatic recoveries remain separate from forty named checkpoints and restore with optimistic planning checks',async()=>{
 let time=1000;const config={...options(),now:()=>time},transport=await createBrowserTransport(config);
 try{
  for(let i=0;i<40;i++)await call(transport,'/api/checkpoints',{name:`Checkpoint ${i}`,expectedRevision:0});await assert.rejects(call(transport,'/api/checkpoints',{name:'Over limit',expectedRevision:0}),error=>error.status===429);
  let version=0;for(let i=0;i<14;i++){time+=300001;await patch(transport,[{id:'box',expectedVersion:version,element:box('box',i)}]);version++;}
  const plan=await call(transport,'/api/planning');assert.equal(plan.checkpoints.length,40);assert.equal(plan.recoveries.length,12);const recovery=plan.recoveries[0],snapshot=await call(transport,'/api/recovery',{id:recovery.id,action:'read'});assert.equal(snapshot.board.id,transport.boardId);
  const board=await call(transport,'/api/board');await assert.rejects(call(transport,'/api/recovery',{id:recovery.id,action:'restore',expectedRevision:board.revision,expectedVersion:plan.version-1}),error=>error.status===409);await call(transport,'/api/recovery',{id:recovery.id,action:'restore',expectedRevision:board.revision,expectedVersion:plan.version});assert.equal((await call(transport,'/api/planning')).checkpoints.length,40);assert.equal((await call(transport,'/api/board')).elements.find(e=>e.id==='box').x,snapshot.board.elements.find(e=>e.id==='box').x);
 }finally{transport.close();}
});

test('local-format board backups import safely into a separate browser without connection state',async()=>{
 const source=await createBrowserTransport(options()),destination=await createBrowserTransport(options());
 try{
  const element={...box('image'),type:'image',fileId:'img'};await patch(source,[{id:'image',expectedVersion:0,element}],{files:{img:{id:'img',dataURL:png,mimeType:'image/png',created:1},unused:{id:'unused',dataURL:png,mimeType:'image/png',created:1}}});const backup=await call(source,'/api/project/export');assert.equal(backup.type,'sharedboard-project');assert.equal(backup.board.files.unused,undefined);assert.equal(backup.token,undefined);assert.equal(backup.connection,undefined);const plan=await call(destination,'/api/planning');await call(destination,'/api/project/import',{backup:{...backup,connection:{key:'must not persist'}},expectedRevision:0,expectedVersion:plan.version});const board=await call(destination,'/api/board');assert.notEqual(board.id,(await call(source,'/api/board')).id);assert.equal(board.files.img.dataURL,png);assert.equal((await call(destination,'/api/connection')).connected,false);
  const exported=await call(destination,'/api/project/export');assert.equal(JSON.stringify(exported).includes('must not persist'),false);const duplicate={...backup,board:{...backup.board,elements:[...backup.board.elements,...backup.board.elements]}};await assert.rejects(call(destination,'/api/project/import',{backup:duplicate,expectedRevision:board.revision,expectedVersion:(await call(destination,'/api/planning')).version}),error=>error.status===400);assert.equal((await call(destination,'/api/board')).revision,board.revision);
 }finally{source.close();destination.close();}
});

test('invalid image backup references preserve the current drawing, planning and checkpoint snapshots',async()=>{
 const transport=await createBrowserTransport(options());
 try{
  const image={...box('image'),type:'image',fileId:'img'};await patch(transport,[{id:'image',expectedVersion:0,element:image}],{files:{img:{id:'img',dataURL:png,mimeType:'image/png',created:1}}});
  await patch(transport,[{id:'image',expectedVersion:1,element:{...image,x:600}}]);
  assert.equal((await call(transport,'/api/board')).files.img.dataURL,png,'an ordinary image edit may reuse an already saved asset');
  await call(transport,'/api/checkpoints',{name:'Keep this checkpoint',expectedRevision:2});
  const board=await call(transport,'/api/board'),planning=await call(transport,'/api/planning'),backup=await call(transport,'/api/project/export');
  const block={id:crypto.randomUUID(),name:'Imported reference',elements:[image],files:backup.board.files};
  const invalidBackups=[
   {...backup,board:{...backup.board,files:{img:{...backup.board.files.img,id:'other'}}}},
   {...backup,board:{...backup.board,files:{}}},
   {...backup,board:{...backup.board,elements:[{...image,fileId:null}]}},
   {...backup,board:{...backup.board,elements:[{...image,fileId:undefined}]}},
   {...backup,project:{...backup.project,library:[{...block,files:{}}]}},
   {...backup,project:{...backup.project,library:[{...block,files:{img:{...backup.board.files.img,id:'other'}}}]}}
  ];
  for(const invalid of invalidBackups){
   await assert.rejects(call(transport,'/api/project/import',{backup:invalid,expectedRevision:board.revision,expectedVersion:planning.version}),error=>error.status===400);
   assert.deepEqual(await call(transport,'/api/board'),board);assert.deepEqual(await call(transport,'/api/planning'),planning);
   const checkpoint=await call(transport,'/api/checkpoint',{id:planning.checkpoints[0].id,action:'read'});assert.deepEqual(checkpoint.board,board);assert.deepEqual(checkpoint.project,planning.project);
  }
 }finally{transport.close();}
});

test('native backups larger than the single-update limit round trip after incremental image saves',async()=>{
 const source=await createBrowserTransport(options()),destination=await createBrowserTransport(options());
 try{
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><!--'+'a'.repeat(9_825_000)+'--><rect width="1" height="1"/></svg>';
  const dataURL='data:image/svg+xml;base64,'+Buffer.from(svg).toString('base64');assert.ok(dataURL.length>13_000_000&&dataURL.length<20_000_000);
  for(const id of ['large_a','large_b'])await patch(source,[{id,expectedVersion:0,element:{...box(id),type:'image',fileId:id}}],{files:{[id]:{id,dataURL,mimeType:'image/svg+xml',created:1}}});
  const backup=await call(source,'/api/project/export');assert.ok(Buffer.byteLength(JSON.stringify(backup))>26_000_000);
  await call(destination,'/api/project/import',{backup,expectedRevision:0,expectedVersion:0});
  const restored=await call(destination,'/api/project/export'),content=elements=>elements.map(({version,versionNonce,updated,...element})=>element);
  assert.deepEqual(content(restored.board.elements),content(backup.board.elements));assert.deepEqual(restored.board.files,backup.board.files);assert.deepEqual(restored.project,backup.project);
 }finally{source.close();destination.close();}
});

test('quota failure rolls back drawings and safety snapshots and leaves previous data readable',async()=>{
 const config=options(),transport=await createBrowserTransport(config),put=IDBObjectStore.prototype.put;
 try{
  IDBObjectStore.prototype.put=function(...args){if(this.name==='boards')throw new DOMException('Simulated storage full','QuotaExceededError');return put.apply(this,args);};await assert.rejects(patch(transport,[{id:'box',expectedVersion:0,element:box()}]),error=>error.status===507&&error.code==='BROWSER_STORAGE_FULL');IDBObjectStore.prototype.put=put;
  assert.equal((await call(transport,'/api/board')).revision,0);assert.equal((await call(transport,'/api/planning')).recoveries.length,0);const db=await openDb(config.indexedDB,config.dbName);try{assert.equal((await records(db,'snapshots')).length,0);}finally{db.close();}await patch(transport,[{id:'box',expectedVersion:0,element:box()}]);assert.equal((await call(transport,'/api/board')).revision,1);
 }finally{IDBObjectStore.prototype.put=put;transport.close();}
});

test('unsupported AI actions and unpaired captures cannot create messages or reviews',async()=>{
 const config=options(),transport=await createBrowserTransport(config);try{
  await assert.rejects(call(transport,'/api/connection/pairing',{text:'Please connect'}),error=>error.status===400);
  for(const route of ['/api/connection/web/start','/api/agent/add','/api/proposal'])await assert.rejects(call(transport,route,{text:'Please connect'}),error=>error.status===501&&error.code==='HOSTED_CONNECTOR_WIP');
  for(const route of ['/api/chat','/api/chat/retry','/api/reviews','/api/reviews/retry'])await assert.rejects(call(transport,route,{text:'Please connect'}),error=>error.status===400);
  assert.deepEqual((await call(transport,'/api/chat')).messages,[]);assert.deepEqual((await call(transport,'/api/reviews')).requests,[]);const connection=await call(transport,'/api/connection');assert.equal(connection.connected,false);assert.equal(connection.features.storage,'browser');assert.equal(connection.features.localConnectors,false);assert.equal(connection.features.webConnectors,true);const db=await openDb(config.indexedDB,config.dbName);try{assert.equal(db.objectStoreNames.length,3);const values=await records(db,'boards');assert.equal(JSON.stringify(values).includes('Please connect'),false);}finally{db.close();}
 }finally{transport.close();}
});

test('visual previews reject stale revisions and invalid payloads without affecting the drawing',async()=>{
 const transport=await createBrowserTransport(options());try{
  assert.equal((await call(transport,'/api/visual',{expectedRevision:9,visual:png})).saved,false);await assert.rejects(call(transport,'/api/visual',{expectedRevision:0,visual:'data:image/svg+xml,<svg/>'}),error=>error.status===400);assert.equal((await call(transport,'/api/visual',{expectedRevision:0,visual:png})).saved,true);assert.equal((await call(transport,'/api/board')).revision,0);
 }finally{transport.close();}
});

test('a corrupt catalog is preserved and version changes close old clients with a clear reopen error',async()=>{
 const config=options(),transport=await createBrowserTransport(config);let event;
 try{
  transport.events.onerror=e=>{event=e.error;};const upgraded=await openDb(config.indexedDB,config.dbName,2);upgraded.close();assert.equal(event.code,'BROWSER_STORAGE_REOPEN');await assert.rejects(call(transport,'/api/board'),error=>error.code==='BROWSER_STORAGE_CLOSED');
 }finally{transport.close();}
 const corruptConfig=options(),created=await createBrowserTransport(corruptConfig);created.close();const raw=await openDb(corruptConfig.indexedDB,corruptConfig.dbName);await putRaw(raw,'meta',{key:'catalog',value:{schemaVersion:99,marker:'preserve me'}});raw.close();await assert.rejects(createBrowserTransport(corruptConfig),error=>error.status===500&&error.code==='BROWSER_STORAGE_CORRUPT');const reopened=await openDb(corruptConfig.indexedDB,corruptConfig.dbName);try{assert.equal((await records(reopened,'meta'))[0].value.marker,'preserve me');}finally{reopened.close();}
});
