import test from 'node:test';
import assert from 'node:assert/strict';
import {isRenderNormalization} from '../shared/scene.mjs';

const text={id:'label',type:'text',x:10,y:20,width:120,height:25,index:null,version:1,versionNonce:100,updated:1000,text:'A label',originalText:'A label',fontFamily:2,fontSize:20,boundElements:null};
const measured={...text,width:85,index:'a0',boundElements:[],version:2,versionNonce:200,updated:1001};

test('first renderer ordering-key assignment may bump edit metadata once while measuring unchanged text',()=>{
 assert.equal(isRenderNormalization(text,measured),true);
 for(const change of [{text:'Changed content',originalText:'Changed content'},{fontFamily:3},{fontSize:30},{strokeColor:'#ff0000'},{frameId:'another-frame'},{groupIds:['new-group']},{isDeleted:true},{version:3},{updated:999}])assert.equal(isRenderNormalization(text,{...measured,...change}),false,JSON.stringify(change));
 assert.equal(isRenderNormalization(measured,{...measured,x:100,version:3,versionNonce:300,updated:1002}),false,'a later human move has a valid existing ordering key and cannot be mistaken for initialization');
});

test('binding normalization permits empty equivalence and removes only references to actually deleted elements',()=>{
 const container={id:'box',type:'rectangle',x:0,y:0,width:200,height:100,index:'a0',version:3,versionNonce:123,updated:1000,boundElements:[{id:'label',type:'text'}]};
 assert.equal(isRenderNormalization(container,{...container,boundElements:[]},[{id:'label',isDeleted:true}]),true);
 assert.equal(isRenderNormalization(container,{...container,boundElements:[]},[{id:'label',isDeleted:false}]),false);
 assert.equal(isRenderNormalization(container,{...container,boundElements:[]}),false,'an unknown relationship is not assumed to be safe repair');
 assert.equal(isRenderNormalization(container,{...container,boundElements:[{id:'other',type:'text'}]},[{id:'label',isDeleted:true}]),false);
 assert.equal(isRenderNormalization({...container,boundElements:null},{...container,boundElements:[]}),true);
 assert.equal(isRenderNormalization(container,{...container,boundElements:[],x:100},[{id:'label',isDeleted:true}]),false,'binding repair must not conceal a real shape move');
});
