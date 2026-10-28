// Copyright (c) 2026 Andrew Barresi. SPDX-License-Identifier: MIT
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

export const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const pluginError=(code,message)=>Object.assign(new Error(message),{code});
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const MAX_CLAIMS=4096,MAX_BYTES=2_000_000;

export function validateRouting(request,connection,instanceId){
  if(!object(request)||!UUID.test(request.id)||!['chat','review'].includes(request.kind)||!['discuss','work'].includes(request.intent)||request.boardId!==connection.boardId||request.connectionId!==connection.sessionId||request.instanceId!==instanceId||request.receipt!==`ch_${request.kind}_${request.id}`||request.kind==='review'&&request.intent!=='discuss')throw pluginError('CHANNEL_SCOPE_MISMATCH','The channel request does not match this running session and board.');
  return {id:request.id,kind:request.kind,intent:request.intent,boardId:request.boardId,connectionId:request.connectionId,instanceId,receipt:request.receipt};
}

export function createClaimStore(dataDirectory){
  if(typeof dataDirectory!=='string'||!path.isAbsolute(dataDirectory))throw pluginError('PLUGIN_DATA_REQUIRED','The AI app must provide its private plugin data directory.');
  const directory=path.resolve(dataDirectory);let tail=Promise.resolve();
  const run=operation=>{const pending=tail.then(operation);tail=pending.catch(()=>{});return pending;};
  const prepare=async()=>{
    await fs.mkdir(directory,{recursive:true,mode:0o700});
    const stat=await fs.lstat(directory);if(!stat.isDirectory()||stat.isSymbolicLink())throw pluginError('PLUGIN_STORAGE_UNSAFE','The plugin data directory is not a private directory.');
  };
  const fileFor=connection=>{
    if(!UUID.test(connection?.sessionId)||!UUID.test(connection?.boardId))throw pluginError('CHANNEL_SCOPE_MISMATCH','The channel connection has an invalid board scope.');
    return path.join(directory,`claims-${connection.sessionId}.json`);
  };
  const load=async(connection,file)=>{
    let stat;try{stat=await fs.lstat(file);}catch(error){if(error.code==='ENOENT')return {version:1,connectionId:connection.sessionId,boardId:connection.boardId,claims:[]};throw error;}
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_BYTES)throw pluginError('PLUGIN_STORAGE_UNSAFE','The notification receipt file is invalid.');
    let state;try{state=JSON.parse(await fs.readFile(file,'utf8'));}catch{throw pluginError('PLUGIN_STORAGE_INVALID','The notification receipt file could not be read. It was not replaced.');}
    if(!object(state)||state.version!==1||state.connectionId!==connection.sessionId||state.boardId!==connection.boardId||!Array.isArray(state.claims)||state.claims.length>MAX_CLAIMS||state.claims.some(item=>!object(item)||!UUID.test(item.id)||!['chat','review'].includes(item.kind)||item.receipt!==`ch_${item.kind}_${item.id}`))throw pluginError('PLUGIN_STORAGE_INVALID','The notification receipts do not match this board. They were not replaced.');
    return state;
  };
  const save=async(file,state)=>{
    const temporary=path.join(directory,`.claims-${randomUUID()}.tmp`);let handle;
    try{handle=await fs.open(temporary,'wx',0o600);await handle.writeFile(`${JSON.stringify(state)}\n`,'utf8');await handle.sync();await handle.close();handle=null;await fs.rename(temporary,file);}
    finally{await handle?.close().catch(()=>{});await fs.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  };
  return {
    ready(){return run(prepare);},
    drain(){return tail;},
    async claim(connection,request){return run(async()=>{
      await prepare();const file=fileFor(connection),state=await load(connection,file),existing=state.claims.find(item=>item.id===request.id&&item.kind===request.kind);
      if(existing){if(existing.receipt!==request.receipt)throw pluginError('CHANNEL_REQUEST_CONFLICT','This request already has another notification receipt.');return false;}
      if(state.claims.length>=MAX_CLAIMS)throw pluginError('CHANNEL_RECEIPT_LIMIT','This connection reached its notification receipt limit. Reconnect explicitly from the website.');
      state.claims.push({id:request.id,kind:request.kind,receipt:request.receipt});await save(file,state);return true;
    });},
  };
}
