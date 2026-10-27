import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {startServer} from '../server/index.mjs';
import {pairAgent} from './fixtures.mjs';

const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6Z5kAAAAASUVORK5CYII=';
async function fixture(){
  const directory=mkdtempSync(path.join(os.tmpdir(),'sharedboard-context-'));
  const deliveries={chat:[],review:[]};
  const app=await startServer({port:0,dataDir:directory,notifyChat:async message=>{deliveries.chat.push(message.id);return {queueMessageId:randomUUID()};},notifyReview:async request=>{deliveries.review.push(request.id);return {queueMessageId:randomUUID()};}});
  const grant=await pairAgent(app);
  const call=async(route,input,method=input===undefined?'GET':'POST')=>{
    const response=await fetch(`${app.url}/api/${route}`,{method,headers:{'content-type':'application/json','x-board-token':app.token,'x-agent-key':grant.agentKey},...(input===undefined?{}:{body:JSON.stringify(input)})});
    return {status:response.status,data:await response.json()};
  };
  const updateProject=async update=>{const current=(await call('planning')).data;const result=await call('planning',{expectedVersion:current.version,project:update(structuredClone(current.project))},'PUT');assert.equal(result.status,200,result.data.error);return result.data;};
  const capture=async({scope='selection',selectedIds=['primary'],areaId}={})=>{
    const board=(await call('board')).data,planning=(await call('planning')).data;
    return {id:randomUUID(),boardId:board.id,expectedRevision:board.revision,expectedPlanningVersion:planning.version,scope,selectedIds,...(areaId?{areaId}:{})};
  };
  const note=(title,elementIds)=>({id:randomUUID(),kind:'requirement',status:'open',title,text:`${title} details`,elementIds,createdAt:new Date().toISOString(),result:''});
  const emptyArea=randomUUID(),secondEmptyArea=randomUUID(),selectedArea=randomUUID();
  await call('agent/add',{elements:[{id:'primary',text:'Original title'},{id:'other',x:600,text:'Outside the selected context'}]});
  await updateProject(project=>({...project,areas:[
    {id:emptyArea,name:'Empty saved view',elementIds:[],bounds:{x:5000,y:5000,width:300,height:300}},
    {id:secondEmptyArea,name:'Another empty view',elementIds:[],bounds:{x:8000,y:8000,width:300,height:300}},
    {id:selectedArea,name:'Primary screen',elementIds:['primary','primary_label'],bounds:{x:0,y:0,width:250,height:150}},
  ],notes:[note('Global constraint',[]),note('Primary requirement',['primary']),note('Other requirement',['other'])]}));
  return {app,call,capture,updateProject,deliveries,emptyArea,secondEmptyArea,selectedArea,async close(){await app.close();const target=path.resolve(directory),prefix=path.resolve(os.tmpdir())+path.sep+'sharedboard-context-';assert.ok(target.startsWith(prefix),'Only the explicitly created fixture directory may be removed');rmSync(target,{recursive:true,force:true});}};
}

test('previewed chat captures an immutable image, selected drawing and notes; retry keeps the original snapshot after drawing and planning changes',async()=>{
  const f=await fixture();try{
    const input={...await f.capture(),text:'Explain this screen',intent:'discuss',visual:png};
    assert.equal((await f.call('chat',input)).status,200);
    await f.updateProject(project=>({...project,notes:project.notes.map(note=>({...note,text:'Changed after preview'}))}));
    const board=f.app.store.board;
    await f.call('agent/edit',{edits:[{id:'primary_label',expectedVersion:board.elementVersions.primary_label,changes:{text:'A later title'}}]});
    assert.equal((await f.call('chat',input)).status,200,'an identical retry must skip live revision checks');
    assert.deepEqual(f.deliveries.chat,[input.id],'an accepted message is queued only once');
    const read=(await f.call('agent/chat',{id:input.id})).data;
    assert.equal(read.boardChangedSinceRequest,true);assert.equal(read.board.visual.dataURL,png);assert.equal(read.board.visual.revision,input.expectedRevision);
    assert.deepEqual(read.board.elements.map(element=>element.id).sort(),['primary','primary_label']);
    assert.equal(read.board.elements.find(element=>element.id==='primary_label').text,'Original title');
    assert.deepEqual(read.board.planning.notes.map(note=>note.title),['Global constraint','Primary requirement']);
    assert.equal(read.board.planning.notes[1].text,'Primary requirement details');
    assert.equal(read.message.intent,'discuss');assert.equal(read.message.noteCount,2);
  }finally{await f.close();}
});

test('new chat and review previews reject stale planning, wrong board IDs and scope/selection mismatches without delivery',async()=>{
  const f=await fixture();try{
    const input=await f.capture();
    await f.updateProject(project=>({...project,notes:project.notes.map(note=>({...note,text:'A new requirement'}))}));
    assert.equal((await f.call('chat',{...input,text:'Stale chat',intent:'discuss'})).status,409);
    assert.equal((await f.call('reviews',input)).status,409);
    const fresh=await f.capture();
    for(const route of ['chat','reviews']){
      const extra=route==='chat'?{text:'Wrong context',intent:'discuss'}:{};
      assert.equal((await f.call(route,{...fresh,...extra,id:randomUUID(),boardId:randomUUID()})).status,409);
      assert.equal((await f.call(route,{...fresh,...extra,id:randomUUID(),scope:'board'})).status,400);
      assert.equal((await f.call(route,{...fresh,...extra,id:randomUUID(),scope:'selection',selectedIds:[]})).status,400);
    }
    assert.deepEqual(f.deliveries,{chat:[],review:[]});
  }finally{await f.close();}
});

test('an empty named area captures zero objects and only global notes for both chat and review',async()=>{
  const f=await fixture();try{
    const capture=await f.capture({scope:'area',selectedIds:[],areaId:f.emptyArea});
    const chat={...capture,text:'Look at this empty saved view',intent:'discuss'};
    assert.equal((await f.call('chat',chat)).status,200);
    const message=(await f.call('agent/chat',{id:chat.id})).data;
    assert.equal(message.message.scope,'area');assert.equal(message.message.areaId,f.emptyArea);assert.equal(message.message.objectCount,0);assert.deepEqual(message.board.elements,[]);assert.deepEqual(message.board.files,{});
    assert.deepEqual(message.board.planning.notes.map(note=>note.title),['Global constraint']);
    const review={...capture,id:randomUUID()};assert.equal((await f.call('reviews',review)).status,200);
    const read=(await f.call('agent/review',{id:review.id})).data;
    assert.equal(read.request.scope,'area');assert.equal(read.request.areaId,f.emptyArea);assert.equal(read.request.objectCount,0);assert.deepEqual(read.board.elements,[]);assert.deepEqual(read.board.planning.notes.map(note=>note.title),['Global constraint']);
    const whole={...await f.capture({scope:'board',selectedIds:[]}),id:randomUUID()};
    const full=await f.call('reviews',whole);assert.equal(full.data.request.id,whole.id,'empty area must not deduplicate with the whole board');
    assert.equal((await f.call('agent/review',{id:whole.id})).data.board.elements.length,4);
  }finally{await f.close();}
});

test('previewed review context stays immutable and same-ID retries remain idempotent after live changes',async()=>{
  const f=await fixture();try{
    const input={...await f.capture({scope:'area',selectedIds:['primary'],areaId:f.selectedArea}),visual:png};
    assert.equal((await f.call('reviews',input)).status,200);
    await f.updateProject(project=>({...project,notes:project.notes.map(note=>({...note,title:`Updated ${note.title}`}))}));
    const board=f.app.store.board;
    await f.call('agent/edit',{edits:[{id:'primary',expectedVersion:board.elementVersions.primary,changes:{x:120}}]});
    const repeated=await f.call('reviews',input);assert.equal(repeated.status,200);assert.equal(repeated.data.request.id,input.id);assert.deepEqual(f.deliveries.review,[input.id]);
    const snapshot=(await f.call('agent/review',{id:input.id})).data;
    assert.equal(snapshot.boardChangedSinceRequest,true);assert.equal(snapshot.board.visual.dataURL,png);assert.equal(snapshot.board.elements.find(element=>element.id==='primary').x,0);
    assert.deepEqual(snapshot.board.planning.notes.map(note=>note.title),['Global constraint','Primary requirement']);
  }finally{await f.close();}
});

test('a fresh review after planning-only changes must use the new notes instead of an equivalent older pending snapshot',async()=>{
  const f=await fixture();try{
    const before=await f.capture();assert.equal((await f.call('reviews',before)).status,200);
    await f.updateProject(project=>({...project,notes:project.notes.map(note=>({...note,text:'A newly approved requirement'}))}));
    const after=await f.capture();assert.equal(before.expectedRevision,after.expectedRevision);assert.notEqual(before.expectedPlanningVersion,after.expectedPlanningVersion);
    const fresh=await f.call('reviews',after);assert.equal(fresh.status,200);assert.equal(fresh.data.request.id,after.id,'new planning context must not return the prior pending review');
    const snapshot=(await f.call('agent/review',{id:after.id})).data;assert.equal(snapshot.board.planning.notes[0].text,'A newly approved requirement');
    assert.equal(f.deliveries.review.length,2);
  }finally{await f.close();}
});

test('a review ID cannot be reused for a different scope or named area even when the selected ID list is empty',async()=>{
  const f=await fixture();try{
    const input=await f.capture({scope:'area',selectedIds:[],areaId:f.emptyArea});assert.equal((await f.call('reviews',input)).status,200);
    assert.equal((await f.call('reviews',{...input,scope:'board',areaId:undefined})).status,409);
    assert.equal((await f.call('reviews',{...input,areaId:f.secondEmptyArea})).status,409);
    assert.equal(f.deliveries.review.length,1);
  }finally{await f.close();}
});

test('removed named areas reject new chat and review captures while prior captured requests remain readable',async()=>{
  const f=await fixture();try{
    const input=await f.capture({scope:'area',selectedIds:[],areaId:f.emptyArea});
    const sent={...input,text:'Before the area was removed',intent:'discuss'};assert.equal((await f.call('chat',sent)).status,200);
    await f.updateProject(project=>({...project,areas:project.areas.filter(area=>area.id!==f.emptyArea)}));
    const fresh={...await f.capture({scope:'area',selectedIds:[],areaId:f.emptyArea})};
    assert.equal((await f.call('chat',{...fresh,text:'Missing area',intent:'discuss'})).status,409);
    assert.equal((await f.call('reviews',fresh)).status,409);
    assert.equal((await f.call('chat',sent)).status,200);
    assert.equal((await f.call('agent/chat',{id:sent.id})).data.message.areaId,f.emptyArea);
  }finally{await f.close();}
});
