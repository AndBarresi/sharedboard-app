import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import * as z from 'zod/v4';
import {idSchema} from './schemas.mjs';
import {same,isRenderNormalization} from '../shared/scene.mjs';
import {RecoveryStore} from './recovery.mjs';

const ids=z.array(idSchema).max(10000);
const bounds=z.object({x:z.number().finite(),y:z.number().finite(),width:z.number().finite().positive(),height:z.number().finite().positive()});
export const planningSchema=z.object({
  title:z.string().trim().min(1).max(100),
  areas:z.array(z.object({id:z.string().uuid(),name:z.string().trim().min(1).max(100),elementIds:ids,bounds})).max(100),
  notes:z.array(z.object({id:z.string().uuid(),title:z.string().trim().min(1).max(160),text:z.string().max(8000),kind:z.enum(['note','requirement','task']),status:z.enum(['open','done']),elementIds:ids,createdAt:z.string().datetime(),result:z.string().max(8000).default('')})).max(300),
  library:z.array(z.object({id:z.string().uuid(),name:z.string().trim().min(1).max(100),elements:z.array(z.object({id:idSchema}).passthrough()).max(300),files:z.record(z.string(),z.object({id:z.string(),dataURL:z.string().startsWith('data:image/').max(7_000_000),mimeType:z.string()}).passthrough())})).max(40),
});
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
function atomic(filename,data){writeFileSync(`${filename}.tmp`,JSON.stringify(data,null,2),{encoding:'utf8',flush:true});renameSync(`${filename}.tmp`,filename);}
export class PlanningStore{
  constructor(directory,boardId){
    this.directory=directory;this.boardId=boardId;this.filename=path.join(directory,'planning.json');this.checkpointDirectory=path.join(directory,'checkpoints');mkdirSync(this.checkpointDirectory,{recursive:true});
    this.state=existsSync(this.filename)?JSON.parse(readFileSync(this.filename,'utf8')):{boardId,version:0,project:{title:'Our shared project',areas:[],notes:[],library:[]},checkpoints:[],proposals:[],agentActions:[]};
    if(this.state.boardId!==boardId)throw new Error('The planning file belongs to another board. It has been preserved.');
    this.recovery=new RecoveryStore(directory,boardId);
  }
  save(){atomic(this.filename,this.state);}
  view(){return {...structuredClone(this.state),recoveries:this.recovery.list(),proposals:this.state.proposals.map(({changes,...metadata})=>structuredClone(metadata)),agentActions:this.state.agentActions.map(({before,after,...metadata})=>structuredClone(metadata))};}
  automaticRecovery(board,reason,options){return this.recovery.save(board,this.state.project,reason,options);}
  readRecovery(id){return this.recovery.read(id);}
  restoreRecovery(board,id,expectedRevision){
    if(board.revision!==expectedRevision)throw fail('The board changed. Review the recovery save again before restoring.');
    const snapshot=this.readRecovery(id);
    return this.replace(board,snapshot,expectedRevision,'You restored an automatic recovery save',{recovery:'automatic'});
  }
  context(elementIds=[]){const selected=new Set(elementIds);return {version:this.state.version,title:this.state.project.title,areas:this.state.project.areas,notes:this.state.project.notes.filter(n=>!selected.size||!n.elementIds.length||n.elementIds.some(id=>selected.has(id))),pendingProposals:this.state.proposals.filter(p=>p.status==='pending').map(({changes,...metadata})=>metadata)};}
  update(expectedVersion,project){
    if(expectedVersion!==this.state.version)throw fail('Project details changed in another window. Your draft is preserved; close and reopen the panel to use the latest details.');
    const parsed=planningSchema.parse(project);
    for(const key of ['areas','notes','library'])if(new Set(parsed[key].map(item=>item.id)).size!==parsed[key].length)throw fail('Project items must have unique IDs.',400);
    if(Buffer.byteLength(JSON.stringify(parsed))>10_000_000)throw fail('The project library is too large. Export large references separately.',413);
    this.state.project=parsed;this.state.version++;this.save();return this.view();
  }
  checkpoint(board,name){
    if(this.state.checkpoints.length>=40)throw fail('You have 40 checkpoints. Remove an old checkpoint before saving another.',429);
    const checkpoint={id:randomUUID(),name,revision:board.revision,at:new Date().toISOString(),objectCount:board.elements.filter(e=>!e.isDeleted).length};
    atomic(path.join(this.checkpointDirectory,`${checkpoint.id}.json`),{board:structuredClone(board),project:structuredClone(this.state.project)});
    this.state.checkpoints.unshift(checkpoint);this.state.version++;this.save();return checkpoint;
  }
  readCheckpoint(id){if(!this.state.checkpoints.some(c=>c.id===id))throw fail('That checkpoint no longer exists.',404);return JSON.parse(readFileSync(path.join(this.checkpointDirectory,`${id}.json`),'utf8'));}
  deleteCheckpoint(id){this.readCheckpoint(id);this.state.checkpoints=this.state.checkpoints.filter(c=>c.id!==id);this.state.version++;this.save();unlinkSync(path.join(this.checkpointDirectory,`${id}.json`));return this.view();}
  restore(board,id,expectedRevision){
    return this.replace(board,this.readCheckpoint(id),expectedRevision,'You restored a saved checkpoint');
  }
  replace(board,snapshot,expectedRevision,summary='You restored a project backup',{recovery='automatic'}={}){
    if(board.revision!==expectedRevision)throw fail('The board changed. Review the checkpoint again before restoring.');
    const wanted=new Map(snapshot.board.elements.map(e=>[e.id,e]));
    const changes=[];
    for(const e of board.elements){const old=wanted.get(e.id);if(old){wanted.delete(e.id);if(!same(old,e))changes.push({id:e.id,expectedVersion:board.elementVersions[e.id],element:{...old,version:Math.max(e.version??1,old.version??1)+1,versionNonce:Math.floor(Math.random()*2**30),updated:Date.now()}});}else if(!e.isDeleted)changes.push({id:e.id,expectedVersion:board.elementVersions[e.id],element:{...e,isDeleted:true,version:(e.version??1)+1,updated:Date.now()}});}
    for(const e of wanted.values())changes.push({id:e.id,expectedVersion:board.elementVersions[e.id]??0,element:{...e,version:(e.version??1)+1,updated:Date.now()}});
    // Save recovery before changing either drawing or planning details.
    if(recovery==='automatic')this.automaticRecovery(board,'Before restoring the board',{force:true});
    else this.checkpoint(board,'Before restoring a checkpoint or backup');
    return {changes,files:snapshot.board.files,summary,project:snapshot.project};
  }
  propose(board,{id= randomUUID(),title,summary,changes}){
    if(this.state.proposals.some(p=>p.id===id))throw fail('That proposal ID is already in use.');
    if(this.state.proposals.filter(p=>p.status==='pending').length>=20)throw fail('Review pending AI proposals before adding more.',429);
    if(!changes.length)throw fail('A proposal must contain a drawing change.',400);
    for(const c of changes)if((board.elementVersions[c.id]??0)!==c.expectedVersion)throw fail('The board changed before this proposal was saved. Read it again.');
    const proposal={id,title,summary,boardRevision:board.revision,at:new Date().toISOString(),status:'pending',count:changes.length,changes:structuredClone(changes)};
    this.state.proposals.unshift(proposal);this.state.proposals=this.state.proposals.filter((p,i)=>p.status==='pending'||i<40);this.state.version++;this.save();return {...proposal,changes:undefined};
  }
  proposal(id){const p=this.state.proposals.find(p=>p.id===id);if(!p)throw fail('That proposal does not exist.',404);return p;}
  resolve(id,status){const p=this.proposal(id);if(p.status!=='pending')throw fail('This proposal has already been handled.');p.status=status;p.resolvedAt=new Date().toISOString();this.state.version++;this.save();return this.view();}
  recordAgent(before,after,summary){
    const previous=new Map(before.elements.map(e=>[e.id,e]));
    const changed=after.elements.filter(e=>!same(previous.get(e.id),e));if(!changed.length)return;
    this.state.agentActions.unshift({id:randomUUID(),summary,at:new Date().toISOString(),revision:after.revision,count:changed.length,before:changed.map(e=>previous.get(e.id)??null),after:changed.map(e=>({id:e.id,expectedVersion:after.elementVersions[e.id]}))});
    this.state.agentActions=this.state.agentActions.slice(0,20);this.state.version++;this.save();
  }
  recordNormalization(before,after,changes){
    let dirty=false;
    for(const change of changes){
      const previous=before.elements.find(e=>e.id===change.id);
      if(!isRenderNormalization(previous,change.element))continue;
      for(const action of this.state.agentActions){if(action.undone)continue;const reference=action.after.find(e=>e.id===change.id);if(reference&&reference.expectedVersion===before.elementVersions[change.id]){reference.expectedVersion=after.elementVersions[change.id];dirty=true;}}
    }
    if(dirty){this.state.version++;this.save();}return dirty;
  }
  undo(board,id){
    const action=this.state.agentActions.find(a=>a.id===id);if(!action||action.undone)throw fail('That AI change has already been undone or is no longer available.');
    if(action.after.some(e=>board.elementVersions[e.id]!==e.expectedVersion))throw fail('Some of these objects were edited afterward. Their newer changes have been preserved. Use a checkpoint or ask for a new proposal.');
    return action.after.map((e,i)=>{const current=board.elements.find(c=>c.id===e.id);return {id:e.id,expectedVersion:e.expectedVersion,element:{...(action.before[i]??{...current,isDeleted:true}),version:(current.version??1)+1,versionNonce:Math.floor(Math.random()*2**30),updated:Date.now()}};});
  }
  markUndone(id){this.state.agentActions.find(a=>a.id===id).undone=true;this.state.version++;this.save();}
}
