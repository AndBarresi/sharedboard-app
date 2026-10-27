// Created by Andrew Barresi: https://github.com/AndBarresi
// Copyright (c) 2026 Andrew Barresi
// Licensed under the MIT License. See LICENSE.
import {spawn} from 'node:child_process';
import {existsSync,readdirSync,statSync} from 'node:fs';
import path from 'node:path';

export function findCodexExecutable({env=process.env,platform=process.platform}={}){
 const executable=platform==='win32'?'codex.exe':'codex',candidates=[env.CODEX_CLI_PATH];
 for(const directory of (env.PATH??'').split(path.delimiter))if(directory)candidates.push(path.join(directory,executable));
 if(platform==='win32'&&env.LOCALAPPDATA){const root=path.join(env.LOCALAPPDATA,'OpenAI','Codex','bin');try{for(const entry of readdirSync(root).filter(name=>!name.startsWith('.')).sort((a,b)=>statSync(path.join(root,b)).mtimeMs-statSync(path.join(root,a)).mtimeMs))candidates.push(path.join(root,entry,executable));}catch{}}
 return candidates.find(candidate=>{try{return candidate&&path.isAbsolute(candidate)&&path.basename(candidate).toLowerCase()===executable&&existsSync(candidate)&&statSync(candidate).isFile();}catch{return false;}})??null;
}

export function runCodexQueue(command,args,{cwd,timeoutMs=10000}={}){
 return new Promise((resolve,reject)=>{
  const child=spawn(command,args,{cwd,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});let output='',settled=false;
  const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(result);};
  const timer=setTimeout(()=>{child.kill();finish(Object.assign(new Error('Codex did not confirm delivery in time. Check the connected chat before retrying.'),{deliveryUnknown:true}));},timeoutMs);
  child.stdout.on('data',chunk=>{output=(output+chunk.toString()).slice(-32000);});child.stderr.resume();
  child.once('error',()=>finish(Object.assign(new Error('The installed Codex command could not be started. Reconnect the local chat.'),{notLaunched:true})));
  child.once('close',code=>code===0?finish(null,output):finish(Object.assign(new Error('Codex did not confirm delivery. Check the connected chat before retrying.'),{deliveryUnknown:true})));
 });
}

export function queueReceipt(output,threadId){
 const match=/Queued message ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}) for thread ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(String(output));
 if(!match||match[2].toLowerCase()!==threadId.toLowerCase())throw Object.assign(new Error('Codex did not confirm delivery to this conversation. Check the connected chat before retrying.'),{deliveryUnknown:true});
 return {provider:'codex-cli',queueMessageId:match[1].toLowerCase()};
}
