// Copyright (c) 2026 Andrew Barresi. SPDX-License-Identifier: MIT
import {createElements} from '../server/elements.mjs';
import {replaceSelectionSchema} from '../server/schemas.mjs';
import {imagineSelection} from '../shared/imagine.mjs';
import {same} from '../shared/scene.mjs';
import {browserFailure} from './browser-validation.mjs';

export function prepareImagineReplacement(record, raw, connection, at) {
  if(connection.permission!=='edit')throw browserFailure('Imagine requires drawing edit access.',403,'IMAGINE_ACCESS_REQUIRED');
  const input=replaceSelectionSchema.parse(raw),message=record.messages?.find(item=>item.id===input.messageId);
  if(!message||message.boardId!==record.id||message.connectionId!==connection.id)throw browserFailure('This Imagine request belongs to another board or connection.',403,'IMAGINE_REQUEST_SCOPE');
  if(!message.imagine||message.intent!=='work'||message.scope!=='selection'||!message.snapshot?.elements.length)throw browserFailure('Only an explicit captured Imagine selection can be replaced.',403,'IMAGINE_REQUEST_REQUIRED');
  const fingerprint=JSON.stringify(input);
  if(message.imagine.result){
    if(message.imagine.fingerprint!==fingerprint)throw browserFailure('This Imagine request was already applied. Start a new pass for a different result.',409,'IMAGINE_ALREADY_APPLIED');
    return {result:structuredClone(message.imagine.result)};
  }
  if(message.status!=='reading')throw browserFailure('Read this captured Imagine message before replacing its selection.',409,'IMAGINE_CAPTURE_UNREAD');
  const originals=message.snapshot.elements,ids=new Set(originals.map(element=>element.id)),live=new Map(record.board.elements.map(element=>[element.id,element]));
  const conflicts=originals.filter(element=>!live.has(element.id)||live.get(element.id).isDeleted||record.board.elementVersions[element.id]!==message.snapshot.elementVersions[element.id]).map(element=>element.id);
  // Adding a new frame child or bound label after capture must never cause that
  // new human object to be silently deleted with its old parent.
  for(const element of imagineSelection(record.board.elements,[...ids]))if(!ids.has(element.id))conflicts.push(element.id);
  if(conflicts.length)throw Object.assign(browserFailure('The selected design changed since Imagine was requested. Nothing was replaced. Select its current version and start a new pass.',409,'IMAGINE_SELECTION_CHANGED'),{conflicts:[...new Set(conflicts)]});
  const references=message.snapshot.imagineReferences;
  if(references){
    const changed=references.elements.filter(element=>!live.has(element.id)||live.get(element.id).isDeleted||record.board.elementVersions[element.id]!==references.elementVersions[element.id]).map(element=>element.id);
    for(const [id,file] of Object.entries(references.files))if(file.dataURL!==record.board.files[id]?.dataURL||file.mimeType!==record.board.files[id]?.mimeType)changed.push(id);
    if(changed.length)throw Object.assign(browserFailure('The existing design reference changed while Imagine was working. Nothing was replaced. Prepare a new preview using the updated design.',409,'IMAGINE_REFERENCE_CHANGED'),{conflicts:[...new Set(changed)]});
  }
  const directionNote=record.planning.project.notes.find(note=>note.title==='Imagine design direction'&&!note.elementIds.length&&note.status==='open');
  const capturedDirection=message.snapshot.planning.notes.find(note=>note.title==='Imagine design direction'&&!note.elementIds.length&&note.status==='open');
  if(!same(directionNote,capturedDirection))throw browserFailure('The project design direction changed while Imagine was working. Start a new pass using the current direction.',409,'IMAGINE_DIRECTION_CHANGED');
  const contextIds=new Set([...ids,...(references?.elements??[]).map(element=>element.id)]);
  const relevant=notes=>notes.filter(note=>(note.kind==='requirement'||note.title==='Imagine design memory')&&(!note.elementIds.length||note.elementIds.some(id=>contextIds.has(id)))).sort((a,b)=>a.id.localeCompare(b.id));
  if(!same(relevant(record.planning.project.notes),relevant(message.snapshot.planning.notes)))throw browserFailure('The design requirements changed while Imagine was working. Start a new pass to include the current requirements.',409,'IMAGINE_REQUIREMENTS_CHANGED');
  const outerFrames=originals.filter(element=>['frame','magicframe'].includes(element.type)&&!ids.has(element.frameId));
  if(outerFrames.length>1)throw browserFailure('Imagine one page frame at a time to preserve its editable frame structure.',400,'IMAGINE_MULTIPLE_FRAMES');
  const wrapper=outerFrames[0]??null;
  const parents=new Set(originals.filter(element=>!element.containerId&&!ids.has(element.frameId)).map(element=>element.frameId??null));
  if(!wrapper&&parents.size>1)throw browserFailure('Select objects within one page frame, or select the whole page frame, before imagining.',400,'IMAGINE_MULTIPLE_FRAMES');
  const frameId=wrapper?.id??[...parents][0]??null;
  const removedIds=new Set([...ids].filter(id=>id!==wrapper?.id));
  const roots=originals.filter(element=>!element.containerId);
  const groupIds=(roots[0]?.groupIds??[]).filter(id=>roots.every(element=>element.groupIds?.includes(id)));
  const passId=crypto.randomUUID();
  const specs=input.elements.map(spec=>({...spec,id:spec.id??crypto.randomUUID()})),styles=new Map(specs.map(spec=>[spec.id,spec]));
  const created=createElements(specs).map(element=>{
    const style=styles.get(element.containerId??element.id);
    return {...element,frameId,groupIds:[...groupIds],roughness:style.roughness,strokeWidth:style.strokeWidth,opacity:style.opacity,...(element.type==='text'?{fontFamily:style.fontFamily}:{}),...(element.type==='rectangle'?{roundness:style.corners==='rounded'?{type:3}:null}:{}),customData:{sharedboardImagine:{passId,designSummary:input.designSummary,completedAt:at}}};
  });
  if(new Set(created.map(element=>element.id)).size!==created.length||created.some(element=>Object.hasOwn(record.board.elementVersions,element.id)))throw browserFailure('Imagine replacement IDs must be new and unique.',409,'IMAGINE_ID_CONFLICT');
  const changes=originals.map(element=>({id:element.id,expectedVersion:record.board.elementVersions[element.id],element:{...live.get(element.id),...(wrapper?.id===element.id?{customData:{...element.customData,sharedboardImagine:{passId,designSummary:input.designSummary,completedAt:at}}}:{isDeleted:true}),version:(live.get(element.id).version??1)+1,versionNonce:Math.floor(Math.random()*2**30),updated:Date.parse(at)}}));
  // Keep external arrows and geometry. Remove only their bindings to objects
  // being replaced, so no surviving object points at a deleted container.
  for(const element of record.board.elements){
    if(element.isDeleted||ids.has(element.id))continue;
    const next={...element};let changed=false;
    for(const field of ['startBinding','endBinding'])if(removedIds.has(element[field]?.elementId)){next[field]=null;changed=true;}
    if(element.boundElements?.some(bound=>removedIds.has(bound.id))){next.boundElements=element.boundElements.filter(bound=>!removedIds.has(bound.id));changed=true;}
    if(changed)changes.push({id:element.id,expectedVersion:record.board.elementVersions[element.id],element:{...next,version:(element.version??1)+1,versionNonce:Math.floor(Math.random()*2**30),updated:Date.parse(at)}});
  }
  changes.push(...created.map(element=>({id:element.id,expectedVersion:0,element})));
  return {changes,summary:input.summary,operation:'replace_selection',changed:'chat',imagine:{messageId:message.id,fingerprint,createdIds:created.map(element=>element.id),removedIds:[...removedIds],...(wrapper?{frameId:wrapper.id}:{}),designSummary:input.designSummary,designDirection:message.imagine.designDirection,completedAt:at}};
}

export function completeImagineReplacement(record, prepared, revision, randomUUID=()=>crypto.randomUUID()) {
  const {messageId,fingerprint,designSummary,designDirection,...result}=prepared;
  const message=record.messages.find(item=>item.id===messageId);
  message.imagine={...message.imagine,fingerprint,result:{...result,messageId,designSummary,revision}};
  prepared.undo={messageId,notes:[]};
  // These are ordinary global requirement notes, retained by board backups and
  // included in the next page's selection context even after the chat ages out.
  for(const [title,text] of [['Imagine design direction',designDirection],['Imagine design memory',designSummary]]){
    if(!text)continue;
    const note=record.planning.project.notes.find(note=>note.title===title&&!note.elementIds.length);
    const before=note?structuredClone(note):null;
    if(note){note.text=text;note.status='open';}
    else if(record.planning.project.notes.length<300)record.planning.project.notes.push({id:randomUUID(),title,text,kind:'requirement',status:'open',elementIds:[],createdAt:prepared.completedAt,result:''});
    const after=record.planning.project.notes.find(note=>note.title===title&&!note.elementIds.length);
    if(after)prepared.undo.notes.push({id:after.id,before,after:structuredClone(after)});
  }
  return structuredClone(message.imagine.result);
}

export function undoImagineReplacement(record, undo, at) {
  if(!undo)return;
  for(const memory of undo.notes){
    const index=record.planning.project.notes.findIndex(note=>note.id===memory.id);
    if(index<0||!same(record.planning.project.notes[index],memory.after))continue;
    if(memory.before)record.planning.project.notes[index]=structuredClone(memory.before);
    else record.planning.project.notes.splice(index,1);
  }
  const message=record.messages.find(item=>item.id===undo.messageId);
  if(message?.imagine?.result){
    message.imagine.result.undoneAt=at;
    for(const cached of record.bridgeResults??[])if(cached.result?.messageId===undo.messageId)cached.result=structuredClone(message.imagine.result);
  }
}
