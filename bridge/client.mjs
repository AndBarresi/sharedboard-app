// SharedBoard.app — created by Andrew Barresi (https://github.com/AndBarresi).
// Copyright (c) 2026 Andrew Barresi. MIT; see LICENSE.
import {readFileSync,mkdirSync,writeFileSync,renameSync,existsSync} from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {defaultDataDir} from './paths.mjs';

export function checkedBridgeUrl(value='http://127.0.0.1:4319'){
  const url=new URL(value);
  if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new Error('The bridge must use a local loopback HTTP address.');
  return url.origin;
}
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
function credentialFile(dataDir,boardId){return path.join(dataDir,`agent-${boardId}.json`);}
function credentials(dataDir,boardId){
  const file=credentialFile(dataDir,boardId);
  if(!existsSync(file))return null;
  const state=JSON.parse(readFileSync(file,'utf8'));
  if(state.schemaVersion!==1||state.boardId!==boardId||typeof state.agentKey!=='string')throw new Error('Bridge credentials are unreadable. Pair again from the webpage; the file has been preserved.');
  return state;
}
async function jsonRequest(origin,route,{body,headers={}}={}){
  const response=await fetch(origin+route,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(45000),redirect:'error'});
  let data;try{data=await response.json();}catch{throw new Error('The local bridge returned an invalid response. Open SharedBoard Bridge and try again.');}
  if(!response.ok)throw Object.assign(new Error(data.error??'The bridge request failed.'),{status:response.status,code:data.code,details:data.details});
  return data;
}
export async function pairBridge(code,{boardId,dataDir=defaultDataDir(),bridgeUrl='http://127.0.0.1:4319',threadId=process.env.CODEX_THREAD_ID}={}){
  if(!uuid(threadId))throw new Error('Run the pairing instruction inside the existing Codex chat so its real CODEX_THREAD_ID is available. Do not invent a chat ID.');
  if(!uuid(boardId))throw new Error('Use the complete pairing instruction from the board, including --board-id.');
  if(typeof code!=='string'||!code.trim())throw new Error('Use a current pairing code from Connect Codex on the webpage.');
  const origin=checkedBridgeUrl(bridgeUrl),health=await jsonRequest(origin,'/bridge/health');
  if(health.product!=='SharedBoard Bridge')throw new Error('That local service is not SharedBoard Bridge.');
  const paired=await jsonRequest(origin,'/bridge/agent/pair',{body:{code,threadId}});
  if(paired.boardId!==boardId||typeof paired.agentKey!=='string'||paired.agentKey.length<32)throw new Error('The paired board did not match the webpage instruction. Return to the board and prepare a new pairing code.');
  const state={schemaVersion:1,agentKey:paired.agentKey,boardId,threadId,bridgeUrl:origin,bridgeId:health.bridgeId};
  mkdirSync(dataDir,{recursive:true,mode:0o700});
  const temporary=path.join(dataDir,`.agent-credentials-${randomUUID()}.tmp`);writeFileSync(temporary,JSON.stringify(state),{mode:0o600,flush:true});renameSync(temporary,credentialFile(dataDir,boardId));
  return {boardId,connection:paired.connection,next:'Read the board, then confirm its exact current revision. No drawing changes are needed for pairing.'};
}
export async function callBridge(operation,input={}, {boardId,dataDir=defaultDataDir(),bridgeUrl,threadId=process.env.CODEX_THREAD_ID}={}){
  if(!uuid(boardId))throw new Error('Pass --board-id from the board pairing instruction. Board commands never choose another board automatically.');
  const grant=credentials(dataDir,boardId);
  if(!grant||!uuid(threadId)||grant.threadId!==threadId)throw new Error('This Codex chat is not paired with that browser board. Use Connect Codex on the webpage.');
  const origin=checkedBridgeUrl(bridgeUrl??grant.bridgeUrl);
  if(origin!==grant.bridgeUrl)throw new Error('The saved grant belongs to another bridge address. Pair again instead of forwarding credentials.');
  let requestId;
  if(['add_elements','edit_elements'].includes(operation)){
    const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
    input=canonical(input);
    const explicit=input.requestId;delete input.requestId;
    if(explicit!==undefined&&!uuid(explicit))throw new Error('A drawing requestId must be a UUID. Keep it the same when retrying the same operation.');
    if(explicit)requestId=explicit;
    else{
      const key=createHash('sha256').update(JSON.stringify({key:grant.agentKey,operation,input})).digest('hex'),directory=path.join(dataDir,'command-ids',boardId),file=path.join(directory,`${key}.json`);
      mkdirSync(directory,{recursive:true,mode:0o700});
      try{writeFileSync(file,JSON.stringify({schemaVersion:1,id:randomUUID()}),{mode:0o600,flag:'wx',flush:true});}catch(error){if(error.code!=='EEXIST')throw error;}
      const saved=JSON.parse(readFileSync(file,'utf8'));if(saved.schemaVersion!==1||!uuid(saved.id))throw new Error('This drawing operation has unreadable retry metadata. Its outcome must be checked on the live board.');requestId=saved.id;
    }
    // Generated IDs also protect a committed add after its browser result cache
    // has expired. Retrying can never create another copy with fresh shape IDs.
    if(operation==='add_elements'&&Array.isArray(input.elements))input={...input,elements:input.elements.map((spec,index)=>({...spec,id:spec.id??`bridge_${requestId.replaceAll('-','')}_${index}`}))};
  }
  return jsonRequest(origin,'/bridge/agent/command',{body:{boardId,operation,input,...(requestId?{requestId}:{})},headers:{'x-sharedboard-agent':grant.agentKey,'x-sharedboard-thread':threadId}});
}
