import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtempSync,mkdirSync,copyFileSync,linkSync,readFileSync,realpathSync,writeFileSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

const launcher=fileURLToPath(new URL('../scripts/portable.ps1',import.meta.url));
const stub=`import http from 'node:http';import fs from 'node:fs';import path from 'node:path';import {randomBytes} from 'node:crypto';import {fileURLToPath} from 'node:url';
const dataDir=process.env.WHITEBOARD_DATA_DIR,projectRoot=fileURLToPath(new URL('../',import.meta.url)),token=randomBytes(32).toString('hex');
fs.mkdirSync(dataDir,{recursive:true});const marker=path.join(dataDir,'saved-work.txt');if(!fs.existsSync(marker))fs.writeFileSync(marker,'tester drawing stays here');
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.url==='/api/session'?{token}:{ok:true,name:'shared-board',version:'fixture'}));});
server.listen(Number(process.env.PORT),'127.0.0.1',()=>{fs.writeFileSync(path.join(dataDir,'.connection.json'),JSON.stringify({url:'http://127.0.0.1:'+server.address().port,token,pid:process.pid,projectRoot,dataDir}));});`;

function staging(){
  const temporary=realpathSync.native(os.tmpdir()),directory=realpathSync.native(mkdtempSync(path.join(temporary,"sharedboard portable 'case ")));
  for(const folder of ['scripts','runtime','app/server','app/dist'])mkdirSync(path.join(directory,folder),{recursive:true});
  copyFileSync(launcher,path.join(directory,'scripts','portable.ps1'));
  try{linkSync(process.execPath,path.join(directory,'runtime','node.exe'));}catch{copyFileSync(process.execPath,path.join(directory,'runtime','node.exe'));}
  writeFileSync(path.join(directory,'app','package.json'),'{"type":"module"}');writeFileSync(path.join(directory,'app','server','index.mjs'),stub);writeFileSync(path.join(directory,'app','dist','index.html'),'fixture');
  return {directory,connection:()=>JSON.parse(readFileSync(path.join(directory,'data','.connection.json'),'utf8')),clean(){const resolved=realpathSync.native(directory),relative=path.relative(temporary,resolved);if(!relative||relative==='..'||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative)||!path.basename(resolved).startsWith("sharedboard portable 'case "))throw new Error('Refusing fixture cleanup outside the temporary staging folder.');rmSync(resolved,{recursive:true,force:true});}};
}

function run(directory,...flags){
  return new Promise((resolve,reject)=>{
    const child=spawn('powershell.exe',['-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(directory,'scripts','portable.ps1'),...flags],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    let output='';child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{output+=chunk;});
    const timer=setTimeout(()=>{child.kill();reject(new Error('Portable launcher fixture timed out. '+output));},45000);
    // A detached Windows service can inherit a pipe handle even after PowerShell exits.
    // The launcher's own exit is the completion event; its service intentionally remains alive.
    child.on('error',error=>{clearTimeout(timer);reject(error);});child.on('exit',code=>{clearTimeout(timer);child.stdout.destroy();child.stderr.destroy();resolve({code,output});});
  });
}

test('portable launch isolates occupied ports, reuses its own service and stops only the matching copy',{skip:process.platform!=='win32',timeout:90000},async()=>{
  const first=staging(),second=staging(),occupied=http.createServer((req,res)=>res.end('unrelated app'));
  await new Promise(resolve=>occupied.listen(0,'127.0.0.1',resolve));
  const port=occupied.address().port;
  try{
    assert.ok(port<=65000,'the fixture needs a normal user port');
    const launched=await run(first.directory,'-NoBrowser','-PreferredPort',String(port));assert.equal(launched.code,0,launched.output);
    const connection=first.connection();assert.notEqual(new URL(connection.url).port,String(port));assert.equal(realpathSync.native(connection.dataDir),realpathSync.native(path.join(first.directory,'data')));
    assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(),'unrelated app');
    const repeated=await run(first.directory,'-NoBrowser','-PreferredPort',String(port));assert.equal(repeated.code,0,repeated.output);assert.equal(first.connection().pid,connection.pid,'double-clicking again must reuse this copy');
    mkdirSync(path.join(second.directory,'data'));copyFileSync(path.join(first.directory,'data','.connection.json'),path.join(second.directory,'data','.connection.json'));
    const wrongCopy=await run(second.directory,'-Stop');assert.equal(wrongCopy.code,0,wrongCopy.output);assert.match(wrongCopy.output,/No matching/);assert.equal((await fetch(connection.url+'/api/health')).status,200,'copied metadata cannot stop another installation');
    const stopped=await run(first.directory,'-Stop');assert.equal(stopped.code,0,stopped.output);
    await assert.rejects(fetch(connection.url+'/api/health'));
    assert.equal(readFileSync(path.join(first.directory,'data','saved-work.txt'),'utf8'),'tester drawing stays here');
    const restarted=await run(first.directory,'-NoBrowser','-PreferredPort',String(port));assert.equal(restarted.code,0,restarted.output);assert.equal(readFileSync(path.join(first.directory,'data','saved-work.txt'),'utf8'),'tester drawing stays here');
  }finally{await run(first.directory,'-Stop').catch(()=>{});occupied.closeAllConnections();await new Promise(resolve=>occupied.close(resolve));first.clean();second.clean();}
});

test('portable launcher explains missing extraction files without starting an external runtime',{skip:process.platform!=='win32',timeout:45000},async()=>{
  const f=staging();
  try{
    const runtime=path.join(f.directory,'runtime','node.exe');rmSync(runtime);
    const result=await run(f.directory,'-NoBrowser');assert.equal(result.code,1);assert.match(result.output,/bundled runtime is missing/);assert.match(result.output,/Extract All/);
  }finally{f.clean();}
});
