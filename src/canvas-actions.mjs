import {convertToExcalidrawElements,restoreElements,CaptureUpdateAction,exportToBlob} from '@excalidraw/excalidraw';
import {selectElements} from '../shared/scene.mjs';
export const selected=api=>selectElements(api.getSceneElements(),Object.keys(api.getAppState().selectedElementIds).filter(id=>api.getAppState().selectedElementIds[id]));
export function boundsOf(elements){
  if(!elements.length)return null;
  const minX=Math.min(...elements.map(e=>e.x)),minY=Math.min(...elements.map(e=>e.y));
  return {x:minX,y:minY,width:Math.max(1,Math.max(...elements.map(e=>e.x+e.width))-minX),height:Math.max(1,Math.max(...elements.map(e=>e.y+e.height))-minY)};
}
export function viewport(api){const s=api.getAppState();return {x:-s.scrollX,y:-s.scrollY,width:s.width/s.zoom.value,height:s.height/s.zoom.value};}
export function jumpTo(api,area){
  const elements=api.getSceneElements().filter(e=>area.elementIds.includes(e.id));
  api.scrollToContent(elements.length?elements:[{id:'view',type:'rectangle',angle:0,...area.bounds}],{fitToViewport:true,viewportZoomFactor:.7,minZoom:.05,maxZoom:1});
}
export function applyElements(api,elements,selectIds){api.updateScene({elements:restoreElements(elements,null,{refreshDimensions:true,repairBindings:true,normalizeIndices:true}),...(selectIds?{appState:{selectedElementIds:Object.fromEntries(selectIds.map(id=>[id,true])),selectedGroupIds:{}}}:{}),captureUpdate:CaptureUpdateAction.IMMEDIATELY});}
export function duplicateScene(elements,position){
  const bounds=boundsOf(elements),ids=new Map(elements.map(e=>[e.id,crypto.randomUUID()])),groups=new Map(elements.flatMap(e=>e.groupIds??[]).map(id=>[id,crypto.randomUUID()]));
  return elements.map(e=>({...structuredClone(e),id:ids.get(e.id),x:e.x-bounds.x+position.x,y:e.y-bounds.y+position.y,index:null,version:1,versionNonce:Math.floor(Math.random()*2**30),updated:Date.now(),groupIds:(e.groupIds??[]).map(id=>groups.get(id)),frameId:ids.get(e.frameId)??null,containerId:ids.get(e.containerId)??null,boundElements:e.boundElements?.filter(b=>ids.has(b.id)).map(b=>({...b,id:ids.get(b.id)}))??null,startBinding:e.startBinding&&ids.has(e.startBinding.elementId)?{...e.startBinding,elementId:ids.get(e.startBinding.elementId)}:null,endBinding:e.endBinding&&ids.has(e.endBinding.elementId)?{...e.endBinding,elementId:ids.get(e.endBinding.elementId)}:null}));
}
export function insertScene(api,elements,files={}){
  const v=viewport(api),items=duplicateScene(elements,{x:v.x+v.width*.2,y:v.y+v.height*.2});
  api.addFiles(Object.values(files));applyElements(api,[...api.getSceneElementsIncludingDeleted(),...items],items.filter(e=>!e.containerId).map(e=>e.id));api.scrollToContent(items,{fitToViewport:true,viewportZoomFactor:.7,maxZoom:1});return items;
}
export async function renderScene(elements,files={},appState={}){
  if(!elements.filter(e=>!e.isDeleted).length)return null;
  const blob=await exportToBlob({elements:elements.filter(e=>!e.isDeleted),files,appState:{...appState,exportBackground:true,viewBackgroundColor:'#fcfcfa',exportWithDarkMode:false,exportEmbedScene:false},maxWidthOrHeight:1600,exportPadding:24,mimeType:'image/png'});
  return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});
}
export function selectionAction(api,action){
  const ids=Object.keys(api.getAppState().selectedElementIds).filter(id=>api.getAppState().selectedElementIds[id]);if(!ids.length)return;
  const items=selectElements(api.getSceneElements(),ids),set=new Set(items.map(e=>e.id)),roots=items.filter(e=>!e.containerId),b=boundsOf(roots);
  if(action==='duplicate'){const copies=duplicateScene(items,{x:b.x+40,y:b.y+40});applyElements(api,[...api.getSceneElementsIncludingDeleted(),...copies],copies.filter(e=>!e.containerId).map(e=>e.id));return;}
  const group=crypto.randomUUID(),deltas=new Map();
  if(action.startsWith('align-'))for(const e of roots){let dx=0,dy=0;if(action==='align-left')dx=b.x-e.x;if(action==='align-center')dx=b.x+b.width/2-e.x-e.width/2;if(action==='align-top')dy=b.y-e.y;deltas.set(e.id,{dx,dy});for(const bound of e.boundElements??[])if(bound.type==='text')deltas.set(bound.id,{dx,dy});}
  const allLocked=items.every(e=>e.locked);
  applyElements(api,api.getSceneElementsIncludingDeleted().map(e=>{
    if(!set.has(e.id))return e;
    const delta=deltas.get(e.id);let change={};
    if(delta)change={x:e.x+delta.dx,y:e.y+delta.dy};
    if(action==='group')change={groupIds:[...(e.groupIds??[]),group]};
    if(action==='ungroup')change={groupIds:[]};
    if(action==='lock')change={locked:!allLocked};
    return {...e,...change,version:(e.version??1)+1,versionNonce:Math.floor(Math.random()*2**30),updated:Date.now()};
  }));
}
const text=(x,y,value,size=18)=>({type:'text',x,y,text:value,fontSize:size,fontFamily:2,strokeColor:'#275c46'});
const box=(x,y,width,height,label='',fill='#ffffff')=>({type:'rectangle',x,y,width,height,strokeColor:'#718b64',backgroundColor:fill,fillStyle:'solid',roughness:0,...(label?{label:{text:label,fontFamily:2,fontSize:16,strokeColor:'#26352e'}}:{})});
export const templates=[
  {id:'mobile',name:'Mobile screen',description:'A phone layout with navigation and content.',make:()=>[text(0,-50,'Mobile screen',26),box(0,0,360,700),box(20,25,320,55,'Page title','#e5eadc'),box(20,105,320,130,'Summary card','#dff0e5'),box(20,260,320,320,'Content'),box(20,615,320,60,'Home     Search     Account','#e5eadc')]},
  {id:'desktop',name:'Desktop screen',description:'Sidebar, header and a flexible content area.',make:()=>[text(0,-50,'Desktop screen',26),box(0,0,1000,620),box(20,20,190,580,'Navigation','#e5eadc'),box(235,20,745,65,'Page title','#dff0e5'),box(235,110,355,155,'Summary'),box(615,110,365,155,'Summary'),box(235,290,745,310,'Main content')]},
  {id:'form',name:'Form & dialog',description:'Editable fields, actions and a helpful note.',make:()=>[box(0,0,400,450,'','#f4f3ed'),text(30,30,'Create an account',26),box(30,105,340,55,'Email address'),box(30,185,340,55,'Password'),box(30,280,340,55,'Continue','#e5eadc'),text(30,370,'Add validation requirements as a note.',14)]},
  {id:'flow',name:'User journey',description:'Start with a three-step navigation flow.',make:()=>[text(0,-60,'User journey',26),box(0,0,210,100,'Choose a trip','#dff0e5'),{type:'arrow',x:225,y:50,width:100,height:0,label:{text:'opens',fontFamily:2,fontSize:14}},box(340,0,210,100,'Pick a date','#e5eadc'),{type:'arrow',x:565,y:50,width:100,height:0,label:{text:'continues to',fontFamily:2,fontSize:14}},box(680,0,210,100,'Confirm booking','#fff0d9')]},
  {id:'architecture',name:'App architecture',description:'Frontend, API, authentication and storage.',make:()=>[text(0,-60,'App architecture',26),box(0,0,220,140,'Frontend','#dff0e5'),{type:'arrow',x:240,y:70,width:120,height:0,label:{text:'HTTPS',fontFamily:2,fontSize:14}},box(380,0,220,140,'Backend API','#e5eadc'),{type:'arrow',x:620,y:70,width:120,height:0,label:{text:'reads / writes',fontFamily:2,fontSize:14}},box(760,0,220,140,'Database','#dce9f6'),box(380,260,220,110,'Authentication','#fff0d9'),{type:'arrow',x:490,y:240,width:0,height:-80,label:{text:'verifies',fontFamily:2,fontSize:14}}]},
];
export function templateElements(id){const t=templates.find(t=>t.id===id);return convertToExcalidrawElements(t.make().map(e=>({roughness:0,...e})));}
