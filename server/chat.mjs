import {existsSync, mkdirSync, readFileSync, writeFileSync, renameSync} from 'node:fs';
import path from 'node:path';
import {selectElements} from '../shared/scene.mjs';

const fail=(message,status=409)=>Object.assign(new Error(message),{status});
export class ChatStore {
  constructor(directory) {
    mkdirSync(directory,{recursive:true}); this.filename=path.join(directory,'chat-messages.json');
    this.messages=existsSync(this.filename)?JSON.parse(readFileSync(this.filename,'utf8')):[];
    if(!Array.isArray(this.messages))throw new Error('The saved board conversation is unreadable. Its original file was preserved.');
    let interrupted=false;
    for(const m of this.messages)if(m.delivery==='pending'){m.delivery='uncertain';m.deliveryError='The app restarted before delivery was confirmed. Check the connected chat before retrying.';interrupted=true;}
    if(interrupted)this.save();
  }
  save(){writeFileSync(`${this.filename}.tmp`,JSON.stringify(this.messages,null,2),{encoding:'utf8',flush:true});renameSync(`${this.filename}.tmp`,this.filename);}
  metadata(m){const {snapshot,targetThreadId,...rest}=m;return structuredClone(rest);}
  list(){return this.messages.map(m=>this.metadata(m));}
  find(id){const m=this.messages.find(m=>m.id===id);if(!m)throw fail('That board message does not exist.',404);return m;}
  create(board,input,targetThreadId){
    const selectedIds=[...input.selectedIds].sort();
    const duplicate=this.messages.find(m=>m.id===input.id);
    if(duplicate){if(duplicate.text!==input.text||duplicate.intent!==input.intent||duplicate.scope!==(input.scope??(selectedIds.length?'selection':'board'))||duplicate.areaId!==input.areaId||input.expectedPlanningVersion!==undefined&&duplicate.snapshot.planning?.version!==input.expectedPlanningVersion||duplicate.boardRevision!==input.expectedRevision||JSON.stringify(duplicate.selectedIds)!==JSON.stringify(selectedIds))throw fail('That message ID already belongs to another message.');return {message:duplicate,created:false};}
    if(board.revision!==input.expectedRevision)throw fail('The drawing changed before sending. Send again to include the latest board.');
    if(!targetThreadId)throw fail('Connect a Codex chat before sending a message.',503);
    if(this.messages.filter(m=>m.status!=='answered').length>=20)throw fail('Several messages are already waiting. Let the agent respond before sending more.',429);
    const active=board.elements.filter(e=>!e.isDeleted);
    if(selectedIds.some(id=>!active.some(e=>e.id===id)))throw fail('Part of the selection no longer exists. Select the objects again.');
    const elements=structuredClone(input.scope==='area'&&!selectedIds.length?[]:selectElements(board.elements,selectedIds));
    const files=Object.fromEntries(Object.entries(board.files).filter(([id])=>elements.some(e=>e.fileId===id)));
    const message={id:input.id,text:input.text,intent:input.intent,targetThreadId,createdAt:new Date().toISOString(),boardRevision:board.revision,selectedIds,scope:input.scope??(selectedIds.length?'selection':'board'),...(input.areaId?{areaId:input.areaId}:{}),objectCount:elements.length,status:'waiting',delivery:'pending',snapshot:{id:board.id,title:board.title,revision:board.revision,elements,files:structuredClone(files),elementVersions:Object.fromEntries(elements.map(e=>[e.id,board.elementVersions[e.id]]))}};
    this.messages.push(message);this.messages=this.messages.filter((m,i)=>i>=this.messages.length-100||m.status!=='answered');this.save();return {message,created:true};
  }
  delivered(id,receipt){Object.assign(this.find(id),{delivery:'queued',deliveredAt:new Date().toISOString(),receipt});delete this.find(id).deliveryError;this.save();}
  deliveryFailed(id,error){Object.assign(this.find(id),{delivery:error.deliveryUnknown?'uncertain':'failed',deliveryError:error.message});this.save();}
  read(id,latestRevision){const m=this.find(id);if(m.status!=='answered'){m.status='reading';m.startedAt??=new Date().toISOString();this.save();}return {message:this.metadata(m),board:{...structuredClone(m.snapshot),elementVersions:Object.fromEntries(m.snapshot.elements.map(e=>[e.id,m.snapshot.elementVersions[e.id]])),files:Object.fromEntries(Object.entries(m.snapshot.files).map(([id,f])=>[id,{id,mimeType:f.mimeType}]))},latestRevision,boardChangedSinceRequest:m.boardRevision!==latestRevision};}
  reply(id,text){const m=this.find(id);if(m.status==='answered'){if(m.reply!==text)throw fail('This message already has a reply. Do not overwrite it.');return this.metadata(m);}if(m.status!=='reading')throw fail('Read the board message before replying.');Object.assign(m,{status:'answered',reply:text,repliedAt:new Date().toISOString()});this.save();return this.metadata(m);}
}
