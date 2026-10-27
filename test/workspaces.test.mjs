import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {startServer,projectRoot} from '../server/index.mjs';

const execute=promisify(execFile);
const trim=url=>url.replace(/\/$/,'');
async function api(base,token,route,input,{method=input===undefined?'GET':'POST',key,headers={}}={}){
  const response=await fetch(`${trim(base)}/api/${route}`,{method,headers:{'content-type':'application/json',connection:'close',...(token?{'x-board-token':token}:{}),...(key?{'x-agent-key':key}:{}),...headers},...(input===undefined?{}:{body:JSON.stringify(input)})});
  return {status:response.status,body:await response.json()};
}
async function ok(...args){const response=await api(...args);assert.equal(response.status,200,JSON.stringify(response.body));return response.body;}
async function pair(base,token,permission='edit'){
  const {pairing}=await ok(base,token,'connection/pairing',{provider:'other',permission});
  return ok(base,token,'agent/pair',{code:pairing.code});
}
async function session(url){const response=await fetch(`${trim(url)}/api/session`,{headers:{connection:'close'}});assert.equal(response.status,200);return response.json();}
async function createBoard(app,title='Second board',projectId){
  const before=await ok(app.url,app.token,'workspaces');
  const catalog=await ok(app.url,app.token,'workspaces',{action:'create-board',projectId:projectId??before.currentProjectId,title});
  return catalog.boards.find(board=>!before.boards.some(previous=>previous.id===board.id));
}
async function openBoard(app,id){const opened=await ok(app.url,app.token,'workspaces/open',{id});return {url:opened.url,...await session(opened.url)};}
function directory(){return mkdtempSync(path.join(os.tmpdir(),'sharedboard-workspaces-'));}

test('workspace catalog creates and renames projects and boards without replacing the original canvas',async()=>{
  const dataDir=directory(),app=await startServer({port:0,dataDir});
  try{
    const initial=await ok(app.url,app.token,'workspaces'),rootBoardId=app.store.board.id;
    assert.equal(initial.legacyBoardId,rootBoardId);assert.equal(initial.currentBoardId,rootBoardId);assert.equal(initial.projects.length,1);assert.equal(initial.boards.length,1);
    const created=await ok(app.url,app.token,'workspaces',{action:'create-project',name:'Travel site'});
    const project=created.projects.find(project=>project.id!==initial.currentProjectId);assert.ok(project);
    const renamed=await ok(app.url,app.token,'workspaces',{action:'rename-project',id:project.id,name:'Travel planner'});assert.equal(renamed.projects.find(p=>p.id===project.id).name,'Travel planner');
    const board=await createBoard(app,'Mobile layouts',project.id),opened=await openBoard(app,board.id);
    assert.equal(opened.url,`${app.url}/boards/${board.id}/`);assert.equal(opened.boardId,board.id);
    assert.equal((await ok(opened.url,opened.token,'workspaces')).currentProjectId,project.id);
    assert.equal((await ok(opened.url,opened.token,'connection')).connected,false,'a new board must not inherit the root AI');
    assert.equal((await ok(opened.url,opened.token,'planning')).project.title,'Mobile layouts');
    const next=await ok(app.url,app.token,'workspaces',{action:'rename-board',id:board.id,title:'Mobile scheduling'});
    assert.equal(next.boards.find(b=>b.id===board.id).title,'Mobile scheduling');assert.equal((await ok(opened.url,opened.token,'planning')).project.title,'Mobile scheduling');
    const repeated=await Promise.all([ok(app.url,app.token,'workspaces/open',{id:board.id}),ok(app.url,app.token,'workspaces/open',{id:board.id})]);
    assert.ok(repeated.every(result=>result.url===opened.url));assert.equal(app.catalog.services.size,2,'concurrent opens reuse one child service');
    assert.equal(app.store.board.id,rootBoardId);assert.equal(app.store.board.revision,0);assert.equal(app.store.board.elements.length,0);
  }finally{await app.close();rmSync(dataDir,{recursive:true,force:true});}
});

test('separate boards keep drawings, planning, chat and AI grants isolated and reject cross-board tokens',async()=>{
  const dataDir=directory(),app=await startServer({port:0,dataDir});
  try{
    const rootGrant=await pair(app.url,app.token),rootConnection=(await ok(app.url,app.token,'connection')).id;
    await ok(app.url,app.token,'agent/add',{elements:[{id:'root-only',text:'Original root drawing'}]},{key:rootGrant.agentKey});
    const rootRevision=app.store.board.revision;
    const aBoard=await createBoard(app,'Board A'),bBoard=await createBoard(app,'Board B');
    const [a,b]=await Promise.all([openBoard(app,aBoard.id),openBoard(app,bBoard.id)]);
    assert.notEqual(a.token,b.token);assert.notEqual(a.token,app.token);
    assert.equal((await api(a.url,app.token,'board')).status,401);assert.equal((await api(a.url,b.token,'board')).status,401);assert.equal((await api(app.url,a.token,'board')).status,401);
    assert.equal((await api(a.url,a.token,'agent/read',undefined,{key:rootGrant.agentKey})).status,403);
    const aGrant=await pair(a.url,a.token),bGrant=await pair(b.url,b.token,'read');
    assert.equal((await api(b.url,b.token,'agent/read',undefined,{key:aGrant.agentKey})).status,403);
    await ok(a.url,a.token,'agent/add',{elements:[{id:'same-local-id',text:'Board A screen'}]},{key:aGrant.agentKey});
    const aScene=await ok(a.url,a.token,'board'),aPlanning=await ok(a.url,a.token,'planning');
    const note={id:randomUUID(),title:'A requirement',text:'Only Board A should see this note.',kind:'requirement',status:'open',elementIds:['same-local-id'],createdAt:new Date().toISOString(),result:''};
    await ok(a.url,a.token,'planning',{expectedVersion:aPlanning.version,project:{...aPlanning.project,notes:[note]}},{method:'PUT'});
    const messageId=randomUUID();await ok(a.url,a.token,'chat',{id:messageId,text:'Discuss Board A only',intent:'discuss',expectedRevision:aScene.revision,selectedIds:[]});
    const captured=await ok(a.url,a.token,'agent/chat',{id:messageId},{key:aGrant.agentKey});assert.equal(captured.board.id,aBoard.id);assert.equal(captured.board.planning.notes[0].title,note.title);
    assert.equal((await ok(b.url,b.token,'board')).elements.length,0);assert.equal((await ok(b.url,b.token,'planning')).project.notes.length,0);assert.equal((await ok(b.url,b.token,'chat')).messages.length,0);
    assert.equal((await api(b.url,b.token,'agent/chat',{id:messageId},{key:bGrant.agentKey})).status,404);
    await ok(b.url,b.token,'board',{changes:[{id:'same-local-id',expectedVersion:0,element:{id:'same-local-id',type:'rectangle',x:700,y:400,width:150,height:80}}]},{method:'PATCH'});
    const bScene=await ok(b.url,b.token,'board'),bPlanning=await ok(b.url,b.token,'planning'),bNote={...note,id:randomUUID(),title:'B requirement',text:'Only Board B should see this note.'};
    await ok(b.url,b.token,'planning',{expectedVersion:bPlanning.version,project:{...bPlanning.project,notes:[bNote]}},{method:'PUT'});
    const bMessageId=randomUUID();await ok(b.url,b.token,'chat',{id:bMessageId,text:'Discuss Board B only',intent:'discuss',expectedRevision:bScene.revision,selectedIds:[]});
    const bCaptured=await ok(b.url,b.token,'agent/chat',{id:bMessageId},{key:bGrant.agentKey});assert.equal(bCaptured.board.id,bBoard.id);assert.equal(bCaptured.board.planning.notes[0].title,'B requirement');
    assert.equal((await ok(a.url,a.token,'board')).elements.find(e=>e.id==='same-local-id').x,0);assert.equal((await ok(b.url,b.token,'board')).elements.find(e=>e.id==='same-local-id').x,700,'identical object IDs on different boards remain independent');
    assert.equal((await ok(a.url,a.token,'planning')).project.notes[0].title,'A requirement');assert.equal((await ok(a.url,a.token,'chat')).messages.length,1);assert.equal((await ok(b.url,b.token,'chat')).messages.length,1);
    assert.equal((await ok(a.url,a.token,'connection')).permission,'edit');assert.equal((await ok(b.url,b.token,'connection')).permission,'read');
    assert.equal((await ok(app.url,app.token,'connection')).id,rootConnection);assert.equal(app.store.board.revision,rootRevision);assert.equal(app.store.board.elements.find(e=>e.id==='root-only_label').text,'Original root drawing');
    assert.deepEqual((await ok(app.url,app.token,'chat')).messages,[]);
  }finally{await app.close();rmSync(dataDir,{recursive:true,force:true});}
});

test('a queued request remains pinned to its original board while another board opens',async()=>{
  const dataDir=directory();let releaseDelivery,markStarted;
  const started=new Promise(resolve=>{markStarted=resolve;});
  const app=await startServer({port:0,dataDir,notifyChat:()=>new Promise(resolve=>{releaseDelivery=()=>resolve({queued:true});markStarted();})});
  let pending;
  try{
    const grant=await pair(app.url,app.token);const childBoard=await createBoard(app,'Next board'),messageId=randomUUID();
    pending=api(app.url,app.token,'chat',{id:messageId,text:'Inspect the original board',intent:'discuss',expectedRevision:0,selectedIds:[]});
    await started;
    const child=await openBoard(app,childBoard.id);assert.equal((await ok(child.url,child.token,'chat')).messages.length,0);
    releaseDelivery();assert.equal((await pending).status,200);
    const captured=await ok(app.url,app.token,'agent/chat',{id:messageId},{key:grant.agentKey});assert.equal(captured.board.id,app.store.board.id);
    await ok(app.url,app.token,'agent/reply',{id:messageId,text:'Read the original board, not the newly opened board.'},{key:grant.agentKey});
    assert.equal((await ok(app.url,app.token,'chat')).messages[0].status,'answered');assert.equal((await ok(child.url,child.token,'chat')).messages.length,0);
  }finally{releaseDelivery?.();await pending?.catch(()=>{});await app.close();rmSync(dataDir,{recursive:true,force:true});}
});

test('child helper URLs and --data-dir CLI calls stay on the selected board across root restart',async()=>{
  const dataDir=directory();let app=await startServer({port:0,dataDir});
  const identity=`workspace-test-${randomUUID()}`,env={...process.env,WHITEBOARD_CLIENT_ID:identity};delete env.CODEX_THREAD_ID;delete env.WHITEBOARD_DATA_DIR;
  const cli=async(dir,...args)=>{const result=await execute(process.execPath,[path.join(projectRoot,'server/agent-cli.mjs'),'--data-dir',dir,...args],{cwd:projectRoot,env,maxBuffer:2_000_000});return JSON.parse(result.stdout);};
  try{
    const originalBoardId=app.store.board.id,board=await createBoard(app,'CLI board'),opened=await openBoard(app,board.id),childDir=app.catalog.directoryFor(board.id);
    const savedConnection=JSON.parse(readFileSync(path.join(childDir,'.connection.json'),'utf8'));
    assert.equal(savedConnection.url,opened.url.replace(/\/$/,''));assert.equal(savedConnection.boardId,board.id);
    const {pairing}=await ok(opened.url,opened.token,'connection/pairing',{provider:'other',permission:'edit'});
    const paired=await cli(childDir,'pair',pairing.code);assert.equal(paired.agentKey,undefined);
    assert.equal((await cli(childDir,'read')).boardId,board.id);
    const payload=path.join(childDir,'test-addition.json');writeFileSync(payload,JSON.stringify({elements:[{id:'cli-object',text:'Persist this child drawing'}]}));await cli(childDir,'add',payload);
    const capturedBefore=await cli(childDir,'read');assert.equal(capturedBefore.elements.find(e=>e.id==='cli-object_label').text,'Persist this child drawing');
    assert.equal(app.store.board.elements.length,0);assert.equal(app.store.board.id,originalBoardId);
    const stableUrl=opened.url,port=Number(new URL(app.url).port),child=app.catalog.services.get(board.id),oldInternal=child.internalUrl;
    await app.close();assert.equal(child.server.listening,false,'closing the root stops child listeners');assert.equal(app.server.listening,false);
    app=await startServer({port,dataDir});
    const listed=await ok(app.url,app.token,'workspaces');assert.equal(listed.boards.find(b=>b.id===board.id).title,'CLI board');
    const reopened=await openBoard(app,board.id);assert.equal(reopened.url,stableUrl);assert.equal(reopened.token,opened.token);
    const persisted=await cli(childDir,'read');assert.equal(persisted.boardId,board.id);assert.equal(persisted.elements.find(e=>e.id==='cli-object_label').text,'Persist this child drawing');
    assert.equal((await ok(reopened.url,reopened.token,'connection')).permission,'edit');assert.equal(app.store.board.id,originalBoardId);
    assert.equal(JSON.parse(readFileSync(path.join(childDir,'.connection.json'),'utf8')).url,stableUrl.replace(/\/$/,''));
  }finally{await app.close();rmSync(dataDir,{recursive:true,force:true});}
});

test('renaming an unopened persisted board after restart is reflected when that board reopens',async()=>{
  const dataDir=directory();let app=await startServer({port:0,dataDir});
  try{
    const board=await createBoard(app,'Before rename');await openBoard(app,board.id);const port=Number(new URL(app.url).port);
    await app.close();app=await startServer({port,dataDir});assert.equal(app.catalog.services.has(board.id),false);
    await ok(app.url,app.token,'workspaces',{action:'rename-board',id:board.id,title:'After rename'});
    const reopened=await openBoard(app,board.id);
    assert.equal((await ok(reopened.url,reopened.token,'planning')).project.title,'After rename');
  }finally{await app.close();rmSync(dataDir,{recursive:true,force:true});}
});

test('stable child routes enforce same-origin protections before opening a board and retain token authentication',async()=>{
  const dataDir=directory(),app=await startServer({port:0,dataDir});
  try{
    const board=await createBoard(app,'Protected board'),base=`${app.url}/boards/${board.id}/`;
    assert.equal(app.catalog.services.has(board.id),false);
    assert.equal((await fetch(`${base}api/session`,{headers:{origin:'https://outside.example'}})).status,403);
    assert.equal((await fetch(`${base}api/session`,{headers:{'sec-fetch-site':'cross-site'}})).status,403);
    assert.equal(app.catalog.services.has(board.id),false,'blocked cross-site requests must not start the child service');
    const child=await openBoard(app,board.id);
    assert.equal((await api(base,child.token,'board',undefined,{headers:{origin:app.url}})).status,200);
    assert.equal((await api(base,child.token,'board',undefined,{headers:{origin:'https://outside.example'}})).status,403);
    assert.equal((await api(base,undefined,'board')).status,401);
    const noSlash=await fetch(`${app.url}/boards/${board.id}`,{redirect:'manual'});assert.equal(noSlash.status,302);assert.equal(noSlash.headers.get('location'),`/boards/${board.id}/`);
    assert.equal((await fetch(`${app.url}/boards/${randomUUID()}/api/session`)).status,404);
  }finally{await app.close();rmSync(dataDir,{recursive:true,force:true});}
});

test('closing the workspace waits for an opening child, stops it, and rejects new opens',async()=>{
  const dataDir=directory(),app=await startServer({port:0,dataDir});let child,opening,shutdown,releaseFactory;
  try{
    const board=await createBoard(app,'Opening during shutdown'),another=await createBoard(app,'Do not open during shutdown');
    const factory=app.catalog.factory;
    let markStarted;const started=new Promise(resolve=>{markStarted=resolve;}),gate=new Promise(resolve=>{releaseFactory=resolve;});
    app.catalog.factory=async record=>{markStarted();await gate;return factory(record);};
    opening=app.catalog.open(board.id);await started;shutdown=app.close();
    await assert.rejects(app.catalog.open(another.id),{status:503});
    releaseFactory();child=await opening;await shutdown;
    assert.equal(child.server.listening,false,'a child startup that overlaps workspace shutdown must not leave a listener running');
  }finally{releaseFactory?.();await opening?.catch(()=>{});await shutdown?.catch(()=>{});for(const [id,service] of app.catalog.services)if(id!==app.store.board.id&&service.server.listening)await service.close();if(child?.server.listening)await child.close();if(app.server.listening)await app.close();rmSync(dataDir,{recursive:true,force:true});}
});

test('damaged workspace metadata is rejected without rewriting the catalog or original drawing',async()=>{
  const dataDir=directory(),app=await startServer({port:0,dataDir});await app.close();
  try{
    const boardBefore=readFileSync(path.join(dataDir,'board.json'),'utf8');
    const catalog=JSON.parse(readFileSync(path.join(dataDir,'workspaces.json'),'utf8'));
    catalog.boards.push({id:'../../outside',projectId:catalog.projects[0].id,title:'Invalid board'});
    const damaged=JSON.stringify(catalog);writeFileSync(path.join(dataDir,'workspaces.json'),damaged);
    await assert.rejects(startServer({port:0,dataDir}),/catalog is unreadable/);
    assert.equal(readFileSync(path.join(dataDir,'workspaces.json'),'utf8'),damaged);
    assert.equal(readFileSync(path.join(dataDir,'board.json'),'utf8'),boardBefore);
  }finally{rmSync(dataDir,{recursive:true,force:true});}
});
