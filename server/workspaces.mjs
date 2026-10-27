import {existsSync,readFileSync,writeFileSync,renameSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import * as z from 'zod/v4';
const fail=(message,status=404)=>Object.assign(new Error(message),{status});
const catalogSchema=z.object({version:z.number().int().min(0),legacyBoardId:z.string().uuid(),projects:z.array(z.object({id:z.string().uuid(),name:z.string().min(1).max(100)})).min(1).max(50),boards:z.array(z.object({id:z.string().uuid(),projectId:z.string().uuid(),title:z.string().min(1).max(100)})).min(1).max(150)}).refine(data=>new Set(data.projects.map(p=>p.id)).size===data.projects.length&&new Set(data.boards.map(b=>b.id)).size===data.boards.length&&data.boards.every(b=>data.projects.some(p=>p.id===b.projectId))&&data.boards.some(b=>b.id===data.legacyBoardId));
export class WorkspaceCatalog{
  constructor(directory,{legacyBoardId,title='Our shared project'}={}){
    this.directory=directory;this.filename=path.join(directory,'workspaces.json');this.services=new Map();this.opening=new Map();this.listeners=new Set();
    if(existsSync(this.filename))this.state=JSON.parse(readFileSync(this.filename,'utf8'));
    else{const projectId=randomUUID();this.state={version:0,legacyBoardId,projects:[{id:projectId,name:'My first project'}],boards:[{id:legacyBoardId,projectId,title}]};this.save();}
    const parsed=catalogSchema.safeParse(this.state);if(!parsed.success)throw new Error('The workspace catalog is unreadable. Its original file and drawings were preserved.');this.state=parsed.data;
    if(this.state.legacyBoardId!==legacyBoardId)throw new Error('The workspace catalog does not match the original board. Existing data was preserved.');
  }
  save(){mkdirSync(this.directory,{recursive:true});writeFileSync(`${this.filename}.tmp`,JSON.stringify(this.state,null,2),{encoding:'utf8',flush:true});renameSync(`${this.filename}.tmp`,this.filename);}
  view(boardId){const board=this.board(boardId);return {...structuredClone(this.state),currentBoardId:boardId,currentProjectId:board.projectId};}
  board(id){const board=this.state.boards.find(b=>b.id===id);if(!board)throw fail('That board does not exist.');return board;}
  directoryFor(id){this.board(id);return id===this.state.legacyBoardId?this.directory:path.join(this.directory,'boards',id);}
  change(input){
    if(input.action==='create-project'){if(this.state.projects.length>=50)throw fail('This workspace supports up to 50 projects.',429);this.state.projects.push({id:randomUUID(),name:input.name});}
    if(input.action==='rename-project'){const project=this.state.projects.find(p=>p.id===input.id);if(!project)throw fail('That project does not exist.');project.name=input.name;}
    if(input.action==='create-board'){if(!this.state.projects.some(p=>p.id===input.projectId))throw fail('Choose an existing project.');if(this.state.boards.length>=150)throw fail('This workspace supports up to 150 boards.',429);this.state.boards.push({id:randomUUID(),projectId:input.projectId,title:input.title});}
    if(input.action==='rename-board')this.board(input.id).title=input.title;
    this.state.version++;this.save();for(const listener of this.listeners)listener();return this.state;
  }
  renameBoard(id,title){if(this.board(id).title===title)return;this.change({action:'rename-board',id,title});}
  pathFor(id){return id===this.state.legacyBoardId?'/':`/boards/${id}/`;}
  publicUrl(id){return `${this.origin}${this.pathFor(id)}`;}
  async open(id){
    if(this.closing)throw fail('SharedBoard.app is closing. Reopen the app to continue.',503);
    this.board(id);if(this.services.has(id))return this.services.get(id);
    if(this.opening.has(id))return this.opening.get(id);
    const pending=Promise.resolve().then(()=>this.factory(this.board(id))).then(service=>{this.services.set(id,service);return service;}).finally(()=>this.opening.delete(id));this.opening.set(id,pending);return pending;
  }
  subscribe(callback){this.listeners.add(callback);return()=>this.listeners.delete(callback);}
  async closeChildren(){this.closing=true;await Promise.allSettled([...this.opening.values()]);await Promise.allSettled([...this.services].filter(([id])=>id!==this.state.legacyBoardId).map(([,service])=>service.close()));this.services.clear();}
}
