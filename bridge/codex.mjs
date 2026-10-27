// Created by Andrew Barresi: https://github.com/AndBarresi
// Copyright (c) 2026 Andrew Barresi
// Licensed under the MIT License. See LICENSE.
import {spawn} from 'node:child_process';
import {existsSync,readdirSync,statSync,accessSync,constants} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';

const localFileSystem={existsSync,readdirSync,statSync,accessSync};

export function codexExecutableCandidates({env=process.env,platform=process.platform,homeDirectory=homedir(),fileSystem=localFileSystem}={}){
 const paths=platform==='win32'?path.win32:path.posix,executable=platform==='win32'?'codex.exe':'codex',candidates=[env.CODEX_CLI_PATH];
 for(const directory of (env.PATH??'').split(platform==='win32'?';':':'))if(directory&&paths.isAbsolute(directory))candidates.push(paths.join(directory,executable));
 if(env.CODEX_INSTALL_DIR&&paths.isAbsolute(env.CODEX_INSTALL_DIR))candidates.push(paths.join(env.CODEX_INSTALL_DIR,executable));
 if(platform==='win32'&&env.LOCALAPPDATA){
  candidates.push(paths.join(env.LOCALAPPDATA,'Programs','OpenAI','Codex','bin',executable));
  const root=paths.join(env.LOCALAPPDATA,'OpenAI','Codex','bin');try{for(const entry of fileSystem.readdirSync(root).filter(name=>!name.startsWith('.')).sort((a,b)=>fileSystem.statSync(paths.join(root,b)).mtimeMs-fileSystem.statSync(paths.join(root,a)).mtimeMs))candidates.push(paths.join(root,entry,executable));}catch{}
 }
 if(platform!=='win32'&&paths.isAbsolute(homeDirectory))candidates.push(paths.join(homeDirectory,'.local','bin',executable));
 // Official app troubleshooting documents this retained compatibility bundle.
 // Do not infer another app's private resource layout or search its contents.
 if(platform==='darwin')candidates.push('/Applications/Codex.app/Contents/Resources/codex');
 return [...new Set(candidates)].filter(candidate=>{
  try{if(!candidate||!paths.isAbsolute(candidate)||paths.basename(candidate).toLowerCase()!==executable||!fileSystem.existsSync(candidate)||!fileSystem.statSync(candidate).isFile())return false;if(platform!=='win32')fileSystem.accessSync(candidate,constants.X_OK);return true;}catch{return false;}
 });
}

export function findCodexExecutable(options={}){return codexExecutableCandidates(options)[0]??null;}

export function supportsCodexQueue(command,{spawnProcess=spawn,timeoutMs=5000}={}){
 return new Promise(resolve=>{
  let child;try{child=spawnProcess(command,['queue','--help'],{windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});}catch{resolve(false);return;}
  let output='',settled=false;const finish=value=>{if(settled)return;settled=true;clearTimeout(timer);resolve(value);};
  const timer=setTimeout(()=>{child.kill();finish(false);},timeoutMs);timer.unref?.();
  child.stdout.on('data',chunk=>{output=(output+chunk.toString()).slice(-32000);});child.stderr.resume();
  child.once('error',()=>finish(false));child.once('close',code=>finish(code===0&&/--thread\b/.test(output)&&/--message\b/.test(output)));
 });
}

export async function findCodexQueueExecutable({probe=supportsCodexQueue,...options}={}){
 for(const candidate of codexExecutableCandidates(options))try{if(await probe(candidate))return candidate;}catch{}
 return null;
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
