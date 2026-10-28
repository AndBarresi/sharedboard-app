import test from 'node:test';
import assert from 'node:assert/strict';
import {selectElements} from '../shared/scene.mjs';
import {createCaptured} from '../src/browser-ai.mjs';

const shape=(id,extra={})=>({id,type:'rectangle',x:0,y:0,width:100,height:80,isDeleted:false,...extra});
const ids=elements=>elements.map(element=>element.id);

test('a selected frame captures nested contents and bound labels in scene order without unrelated objects',()=>{
  const elements=[
    shape('label',{type:'text',containerId:'button',text:'Continue'}),
    shape('button',{frameId:'nested',boundElements:[{id:'label',type:'text'}]}),
    shape('nested',{type:'frame',frameId:'page'}),
    shape('image',{type:'image',frameId:'page',fileId:'image_file'}),
    shape('page',{type:'frame'}),
    shape('other_page',{type:'frame'}),shape('unrelated',{frameId:'other_page'}),
    shape('removed',{frameId:'page',isDeleted:true}),
  ];
  const before=structuredClone(elements),selected=selectElements(elements,['page']);
  assert.deepEqual(ids(selected),['label','button','nested','image','page']);
  assert.equal(selected[0],elements[0],'selection keeps the original scene elements');
  assert.deepEqual(elements,before,'capturing a frame never edits the live drawing');
});

test('selecting a frame child includes its label without expanding to its parent or siblings',()=>{
  const elements=[shape('label',{type:'text',containerId:'button'}),shape('button',{frameId:'page',boundElements:[{id:'label',type:'text'}]}),shape('sibling',{frameId:'page'}),shape('page',{type:'frame'})];
  assert.deepEqual(ids(selectElements(elements,['button'])),['label','button']);
  assert.deepEqual(ids(selectElements(elements,['label'])),['label'],'selecting a label alone retains its existing scope');
});

test('bound arrows retain their labels while their other endpoint and unrelated frames stay outside the capture',()=>{
  const elements=[
    shape('arrow_label',{type:'text',containerId:'arrow'}),
    shape('arrow',{type:'arrow',boundElements:[{id:'arrow_label',type:'text'}],startBinding:{elementId:'source'},endBinding:{elementId:'destination'}}),
    shape('source',{frameId:'page',boundElements:[{id:'arrow',type:'arrow'}]}),
    shape('destination',{frameId:'other_page'}),shape('page',{type:'frame'}),shape('other_page',{type:'frame'}),
  ];
  assert.deepEqual(ids(selectElements(elements,['source'])),['arrow_label','arrow','source']);
  assert.deepEqual(ids(selectElements(elements,['page'])),['arrow_label','arrow','source','page']);
});

test('deleted and missing IDs cannot expand a capture, and malformed cycles terminate without duplicates',()=>{
  const elements=[shape('deleted',{type:'frame',isDeleted:true,boundElements:[{id:'orphan',type:'text'}]}),shape('orphan',{containerId:'deleted'}),shape('a',{type:'frame',frameId:'b'}),shape('b',{type:'frame',frameId:'a'}),shape('deleted_child',{frameId:'a',isDeleted:true})];
  assert.deepEqual(selectElements(elements,['deleted','missing']),[]);
  assert.deepEqual(ids(selectElements(elements,['a','a'])),['a','b']);
  assert.deepEqual(ids(selectElements(elements)),['orphan','a','b'],'an empty selection still captures the active whole board');
});

test('browser chat and review snapshots preserve selected-frame images, child notes, versions and immutable content',()=>{
  for(const kind of ['chat','review']){
    const boardId=crypto.randomUUID(),elements=[shape('page',{type:'frame'}),shape('screenshot',{type:'image',frameId:'page',fileId:'reference'}),shape('title',{type:'text',frameId:'page',text:'Original heading'}),shape('outside')];
    const record={id:boardId,board:{revision:7,elements,files:{reference:{id:'reference',mimeType:'image/png',dataURL:'data:image/png;base64,fixture'},unused:{id:'unused',mimeType:'image/png',dataURL:'data:image/png;base64,unused'}},elementVersions:{page:2,screenshot:3,title:4,outside:1}},planning:{version:5,project:{title:'Frame capture fixture',areas:[],notes:[{title:'Keep this heading',elementIds:['title']},{title:'Outside note',elementIds:['outside']},{title:'Global constraint',elementIds:[]}]}}};
    const input={id:crypto.randomUUID(),boardId,expectedRevision:7,expectedPlanningVersion:5,selectedIds:['page'],scope:'selection',...(kind==='chat'?{intent:'discuss',text:'Explain this page'}:{})};
    const connection={id:crypto.randomUUID(),connected:true,permission:'read'};
    const {item}=createCaptured(record,input,kind,connection,'2026-10-28T18:00:00.000Z');
    assert.deepEqual(item.selectedIds,['page']);
    assert.deepEqual(ids(item.snapshot.elements),['page','screenshot','title']);
    assert.equal(item.objectCount,3);
    assert.deepEqual(Object.keys(item.snapshot.files),['reference']);
    assert.deepEqual(item.snapshot.elementVersions,{page:2,screenshot:3,title:4});
    assert.deepEqual(item.snapshot.planning.notes.map(note=>note.title),['Keep this heading','Global constraint']);
    record.board.elements[2].text='Human edit after capture';record.board.revision=8;
    assert.equal(item.snapshot.elements[2].text,'Original heading');
    assert.equal(item.snapshot.revision,7);
  }
});
