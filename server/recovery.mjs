import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

const LIMIT=12;
const INTERVAL_MS=5*60*1000;
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
function atomic(filename,data){writeFileSync(`${filename}.tmp`,JSON.stringify(data),{encoding:'utf8',flush:true});renameSync(`${filename}.tmp`,filename);}
function contentHash(board,project){
  // Rendering and save metadata are not another version of the user's idea.
  const active=board.elements.filter(element=>!element.isDeleted);
  const elements=active.map(({version,versionNonce,updated,index,...element})=>element);
  const usedFiles=new Set(active.map(element=>element.fileId).filter(Boolean));
  const files=Object.fromEntries(Object.entries(board.files??{}).filter(([id])=>usedFiles.has(id)).sort(([a],[b])=>a.localeCompare(b)).map(([id,{created,lastRetrieved,...file}])=>[id,file]));
  return createHash('sha256').update(JSON.stringify({boardId:board.id,elements,files,project})).digest('hex');
}

export class RecoveryStore{
  constructor(directory,boardId){
    this.boardId=boardId;
    this.directory=path.join(directory,'recoveries');
    this.filename=path.join(directory,'recovery-history.json');
    mkdirSync(this.directory,{recursive:true});
    this.state=existsSync(this.filename)?JSON.parse(readFileSync(this.filename,'utf8')):{boardId,entries:[]};
    if(this.state.boardId!==boardId||!Array.isArray(this.state.entries)||this.state.entries.some(entry=>!entry||!/^[a-f0-9-]{36}$/i.test(entry.id)||!/^\w{64}$/.test(entry.hash??'')||typeof entry.name!=='string'||!Number.isSafeInteger(entry.revision)||entry.revision<0||!Number.isFinite(Date.parse(entry.at))||!Number.isSafeInteger(entry.objectCount)||entry.objectCount<0))throw new Error('The recovery history is unreadable or belongs to another board. Its original files were preserved.');
  }
  list(){return this.state.entries.map(({hash,...entry})=>structuredClone(entry));}
  save(board,project,reason,{force=false,now=Date.now()}={}){
    if(board.id!==this.boardId)throw fail('Recovery cannot capture a different board.');
    const hash=contentHash(board,project);
    if(this.state.entries.some(entry=>entry.hash===hash))return null;
    const latest=this.state.entries[0];
    if(!force&&latest&&now-Date.parse(latest.at)<INTERVAL_MS)return null;
    const entry={id:randomUUID(),name:String(reason||'Automatic recovery').trim().slice(0,100)||'Automatic recovery',revision:board.revision,at:new Date(now).toISOString(),objectCount:board.elements.filter(element=>!element.isDeleted).length,automatic:true,hash};
    atomic(path.join(this.directory,`${entry.id}.json`),{board:structuredClone(board),project:structuredClone(project)});
    const previous=this.state.entries;
    const entries=[entry,...previous].slice(0,LIMIT);
    atomic(this.filename,{boardId:this.boardId,entries});
    this.state={boardId:this.boardId,entries};
    for(const old of previous.slice(LIMIT-1)){
      try{unlinkSync(path.join(this.directory,`${old.id}.json`));}catch(error){if(error.code!=='ENOENT')throw error;}
    }
    const {hash:internalHash,...metadata}=entry;
    return structuredClone(metadata);
  }
  read(id){
    if(!this.state.entries.some(entry=>entry.id===id))throw fail('That recovery save is no longer available.',404);
    const snapshot=JSON.parse(readFileSync(path.join(this.directory,`${id}.json`),'utf8'));
    if(snapshot.board?.id!==this.boardId||!Array.isArray(snapshot.board.elements)||!snapshot.project)throw new Error('That recovery save is unreadable. Its original file was preserved.');
    return snapshot;
  }
}
