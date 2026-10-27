import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {startServer,projectRoot} from '../server/index.mjs';
import {PlanningStore} from '../server/planning.mjs';
import {pairAgent,beginPairing} from './fixtures.mjs';
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6Z5kAAAAASUVORK5CYII=';
async function fixture(permission='edit'){
  const directory=mkdtempSync(path.join(os.tmpdir(),'sharedboard-planning-test-'));
  const app=await startServer({port:0,dataDir:directory,notifyChat:async()=>({queued:true})});
  const grant=await pairAgent(app,'other',permission);
  const call=async(route,input,method=input===undefined?'GET':'POST')=>{const response=await fetch(`${app.url}/api/${route}`,{method,headers:{'content-type':'application/json','x-board-token':app.token,'x-agent-key':grant.agentKey},...(input===undefined?{}:{body:JSON.stringify(input)})});return {status:response.status,body:await response.json()};};
  return {app,directory,call,close:async()=>{await app.close();rmSync(directory,{recursive:true,force:true});}};
}
test('planning details use conflict checks, persist, and travel with immutable chat context',async()=>{
  const f=await fixture();try{
    await f.call('agent/add',{elements:[{id:'screen',text:'Account balance'}]});
    const plan=(await f.call('planning')).body;
    const note={id:randomUUID(),title:'Preserve balance',text:'Keep the balance visible.',kind:'requirement',status:'open',elementIds:['screen'],createdAt:new Date().toISOString(),result:''};
    const project={...plan.project,title:'Travel project',notes:[note]};
    const saved=await f.call('planning',{expectedVersion:plan.version,project},'PUT');assert.equal(saved.status,200);
    const stale=await f.call('planning',{expectedVersion:plan.version,project:{...project,title:'Stale title'}},'PUT');assert.equal(stale.status,409);
    const read=(await f.call('agent/read')).body;assert.equal(read.title,'Travel project');assert.equal(read.planning.notes[0].title,note.title);
    const id=randomUUID();const sent=await f.call('chat',{id,text:'Review this screen',intent:'discuss',expectedRevision:read.revision,selectedIds:['screen'],visual:png});assert.equal(sent.status,200);
    const current=(await f.call('planning')).body;await f.call('planning',{expectedVersion:current.version,project:{...current.project,notes:[]}},'PUT');
    const captured=(await f.call('agent/chat',{id})).body;assert.equal(captured.board.planning.notes[0].text,note.text);assert.equal(captured.board.visual.dataURL,png);assert.equal(captured.message.hasVisual,true);
    const reopened=new PlanningStore(f.directory,f.app.store.board.id);assert.equal(reopened.state.project.title,'Travel project');assert.equal(reopened.state.project.notes.length,0);
  }finally{await f.close();}
});
test('checkpoint restore previews saved data, rejects stale revisions, and creates an automatic recovery save',async()=>{
  const f=await fixture();try{
    await f.call('agent/add',{elements:[{id:'box',x:10,text:'Before'}]});
    const before=f.app.store.board;
    const checkpoint=(await f.call('checkpoints',{name:'Approved design',expectedRevision:before.revision})).body;
    await f.call('agent/edit',{edits:[{id:'box',expectedVersion:1,changes:{x:200}}]});
    const preview=await f.call('checkpoint',{id:checkpoint.id,action:'read'});assert.equal(preview.body.board.elements[0].x,10);
    assert.equal((await f.call('checkpoint',{id:checkpoint.id,action:'restore',expectedRevision:before.revision})).status,409);
    const restored=await f.call('checkpoint',{id:checkpoint.id,action:'restore',expectedRevision:f.app.store.board.revision});assert.equal(restored.status,200);
    assert.equal(f.app.store.board.elements.find(e=>e.id==='box').x,10);
    const plan=(await f.call('planning')).body;assert.equal(plan.checkpoints.length,1);assert.equal(plan.checkpoints[0].name,'Approved design');assert.ok(plan.recoveries.length);
    const recovery=(await f.call('recovery',{id:plan.recoveries[0].id,action:'read'})).body;assert.equal(recovery.board.elements.find(e=>e.id==='box').x,200);
    assert.ok(f.app.store.board.elementVersions.box>2,'restoring never rolls back edit versions');
  }finally{await f.close();}
});
test('AI proposals leave the live drawing untouched, accept atomically, and undo without overwriting later human edits',async()=>{
  const f=await fixture();try{
    await f.call('agent/add',{elements:[{id:'box',x:10,text:'Keep my data'}]});
    const revision=f.app.store.board.revision;
    const proposal=(await f.call('agent/propose',{title:'Move navigation',summary:'Move the existing navigation',edits:[{id:'box',expectedVersion:1,changes:{x:200}}],elements:[{id:'new',x:400,text:'New card'}]})).body;
    assert.equal(f.app.store.board.revision,revision);assert.equal(f.app.store.board.elements.find(e=>e.id==='box').x,10);
    assert.equal((await f.call('proposal',{id:proposal.id,action:'accept'})).status,200);
    assert.equal(f.app.store.board.elements.find(e=>e.id==='box').x,200);assert.ok(f.app.store.board.elements.some(e=>e.id==='new'));
    const plan=(await f.call('planning')).body,action=plan.agentActions[0];
    const live=f.app.store.board,object=live.elements.find(e=>e.id==='box');
    await f.call('board',{changes:[{id:'box',expectedVersion:live.elementVersions.box,element:{...object,y:500}}]},'PATCH');
    assert.equal((await f.call('undo-agent',{id:action.id})).status,409);assert.equal(f.app.store.board.elements.find(e=>e.id==='box').y,500);
    const add=(await f.call('agent/propose',{title:'A separate idea',summary:'Add an independent card',elements:[{id:'independent',text:'Try this'}]})).body;
    await f.call('proposal',{id:add.id,action:'accept'});const last=(await f.call('planning')).body.agentActions[0];
    assert.equal((await f.call('undo-agent',{id:last.id})).status,200);assert.equal(f.app.store.board.elements.find(e=>e.id==='independent').isDeleted,true);
    assert.equal(f.app.store.board.elements.find(e=>e.id==='box').y,500);
  }finally{await f.close();}
});
test('a conflicting proposal rejects the whole batch and a dismissed proposal changes no drawing objects',async()=>{
  const f=await fixture();try{
    await f.call('agent/add',{elements:[{id:'a'},{id:'b'}]});
    const p=(await f.call('agent/propose',{title:'Two moves',summary:'Move both',edits:[{id:'a',expectedVersion:1,changes:{x:30}},{id:'b',expectedVersion:1,changes:{x:60}}]})).body;
    await f.call('agent/edit',{edits:[{id:'b',expectedVersion:1,changes:{y:100}}]});const revision=f.app.store.board.revision;
    assert.equal((await f.call('proposal',{id:p.id,action:'accept'})).status,409);assert.equal(f.app.store.board.elements.find(e=>e.id==='a').x,0);assert.equal(f.app.store.board.revision,revision);
    assert.equal((await f.call('proposal',{id:p.id,action:'reject'})).status,200);assert.equal(f.app.store.board.revision,revision);
  }finally{await f.close();}
});
test('read-only agents cannot propose edits and previews are versioned rather than silently current',async()=>{
  const f=await fixture('read');try{
    assert.equal((await f.call('agent/propose',{title:'Blocked',summary:'Must be blocked',elements:[{id:'new'}]})).status,403);
    const live=f.app.store.board;
    assert.equal((await f.call('visual',{expectedRevision:0,visual:'data:image/png;base64,AAAA'})).status,400);
    assert.equal((await f.call('visual',{expectedRevision:0,visual:png})).body.saved,true);
    const image=(await f.call('agent/visual')).body;assert.equal(image.available,true);assert.equal(image.stale,false);
    await f.call('board',{changes:[{id:'human',expectedVersion:0,element:{id:'human',type:'rectangle',x:0,y:0,width:100,height:100}}]},'PATCH');
    assert.equal((await f.call('visual',{expectedRevision:0,visual:png})).body.saved,false);
    assert.equal((await f.call('agent/visual')).body.stale,true);
  }finally{await f.close();}
});
test('real MCP image results attach PNG content without putting base64 in structured text',async()=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'sharedboard-vision-mcp-'));
  const app=await startServer({port:0,dataDir:directory}),client=new Client({name:'image-verification',version:'1'});
  try{
    await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(projectRoot,'server/mcp.mjs')],cwd:projectRoot,env:{...process.env,WHITEBOARD_DATA_DIR:directory}}));
    const {pairing}=await beginPairing(app);await client.callTool({name:'connect_board',arguments:{code:pairing.code}});
    await fetch(`${app.url}/api/visual`,{method:'POST',headers:{'content-type':'application/json','x-board-token':app.token},body:JSON.stringify({expectedRevision:0,visual:png})});
    const response=await client.callTool({name:'view_board',arguments:{}});assert.equal(response.isError,undefined);assert.equal(response.content[1].type,'image');assert.equal(response.content[1].mimeType,'image/png');assert.equal(response.structuredContent.visual.dataURL,undefined);assert.equal(response.structuredContent.visual.attachedAsImage,true);
  }finally{await client.close();await app.close();rmSync(directory,{recursive:true,force:true});}
});
test('editor text measurements keep AI undo available, while a real later edit still blocks it',async()=>{
  const f=await fixture();try{
    await f.call('agent/add',{elements:[{id:'heading',type:'text',text:'Before'}]});
    await f.call('agent/edit',{edits:[{id:'heading',expectedVersion:1,changes:{text:'An updated heading'}}]});
    let board=f.app.store.board,element=board.elements[0];
    await f.call('board',{changes:[{id:element.id,expectedVersion:board.elementVersions[element.id],element:{...element,width:150,height:23}}]},'PATCH');
    const action=(await f.call('planning')).body.agentActions[0];assert.equal(action.revision,2);
    assert.equal((await f.call('undo-agent',{id:action.id})).status,200);assert.equal(f.app.store.board.elements[0].text,'Before');
    await f.call('agent/edit',{edits:[{id:'heading',expectedVersion:f.app.store.board.elementVersions.heading,changes:{text:'Another idea'}}]});
    const second=(await f.call('planning')).body.agentActions[0];board=f.app.store.board;element=board.elements[0];
    await f.call('board',{changes:[{id:element.id,expectedVersion:board.elementVersions[element.id],element:{...element,x:500,version:element.version+1,versionNonce:12345}}]},'PATCH');
    assert.equal((await f.call('undo-agent',{id:second.id})).status,409);assert.equal(f.app.store.board.elements[0].x,500);
  }finally{await f.close();}
});
test('project backups include planning and references, exclude connection secrets, and restore with recovery and conflict checks',async()=>{
  const f=await fixture();try{
    await f.call('agent/add',{elements:[{id:'saved',text:'A useful layout'}]});
    const exported=(await f.call('project/export')).body;
    assert.equal(exported.type,'sharedboard-project');assert.equal(exported.board.elements.length,2);assert.equal(exported.project.title,'Our shared project');
    assert.equal(exported.token,undefined);assert.equal(exported.connection,undefined);assert.equal(exported.chat,undefined);assert.equal(exported.agentActions,undefined);
    await f.call('agent/edit',{edits:[{id:'saved_label',expectedVersion:1,changes:{text:'An experiment'}}]});
    const plan=(await f.call('planning')).body;
    assert.equal((await f.call('project/import',{backup:exported,expectedRevision:0,expectedVersion:plan.version})).status,409);
    const result=await f.call('project/import',{backup:exported,expectedRevision:f.app.store.board.revision,expectedVersion:plan.version});assert.equal(result.status,200);
    assert.equal(f.app.store.board.elements.find(e=>e.id==='saved_label').text,'A useful layout');assert.equal((await f.call('planning')).body.checkpoints.length,0);assert.ok((await f.call('planning')).body.recoveries.length);
  }finally{await f.close();}
});
test('restoring a named checkpoint still works with all forty named slots occupied',async()=>{
  const f=await fixture();try{
    await f.call('agent/add',{elements:[{id:'full-shelf',text:'Approved'}]});
    let first;
    for(let i=0;i<40;i++){const created=await f.call('checkpoints',{name:`Named design ${i+1}`,expectedRevision:f.app.store.board.revision});assert.equal(created.status,200);first??=created.body;}
    await f.call('agent/edit',{edits:[{id:'full-shelf_label',expectedVersion:1,changes:{text:'Experiment'}}]});
    const plan=(await f.call('planning')).body;
    const restored=await f.call('checkpoint',{id:first.id,action:'restore',expectedRevision:f.app.store.board.revision,expectedVersion:plan.version});
    assert.equal(restored.status,200);assert.equal(f.app.store.board.elements.find(e=>e.id==='full-shelf_label').text,'Approved');
    const after=(await f.call('planning')).body;assert.equal(after.checkpoints.length,40);assert.ok(after.recoveries.length);
  }finally{await f.close();}
});
