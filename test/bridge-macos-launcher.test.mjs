import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {chmodSync,copyFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {bridgeRuntimePin,prepareBridgeStage,prepareMacBridgeApp,macBridgeLauncherFiles} from '../scripts/package-bridge.mjs';
import {parseOptions,assertSeparateData} from '../packaging/bridge-macos/launcher.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),native=process.platform==='darwin';
const target=`macos-${process.arch==='arm64'?'arm64':'x64'}`;
function fixture(){
  const temporary=realpathSync.native(os.tmpdir()),directory=realpathSync.native(mkdtempSync(path.join(temporary,"sharedboard mac 'case ")));
  const runtime=path.join(directory,'runtime'),stage=path.join(directory,'extracted ZIP'),installed=path.join(directory,"installed bridge ' copy.app"),data=path.join(directory,'private grants');
  mkdirSync(path.join(runtime,'bin'),{recursive:true});mkdirSync(stage);
  copyFileSync(process.execPath,path.join(runtime,'bin/node'));chmodSync(path.join(runtime,'bin/node'),0o755);
  writeFileSync(path.join(runtime,'LICENSE'),'Fixture runtime license');writeFileSync(path.join(runtime,'README.md'),'Fixture runtime readme');
  return {directory,runtime,stage,installed,data,prepare(){return prepareMacBridgeApp({sourceRoot:root,runtimeDirectory:runtime,stageDirectory:stage,target,sourceHash:'f'.repeat(64)});},clean(){
    const actual=realpathSync.native(directory),relative=path.relative(temporary,actual);
    if(!relative||relative==='..'||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative)||!path.basename(actual).startsWith("sharedboard mac 'case "))throw new Error('Refusing Mac fixture cleanup outside its temporary folder.');
    rmSync(actual,{recursive:true,force:true});
  }};
}
export function runMacCommand(directory,action,...args){
  return new Promise((resolve,reject)=>{
    const child=spawn('/bin/bash',[path.join(directory,`${action} SharedBoard Bridge.command`),...args],{stdio:['ignore','pipe','pipe']});let output='';
    child.stdout.on('data',data=>{output+=data;});child.stderr.on('data',data=>{output+=data;});
    const timer=setTimeout(()=>{child.kill();reject(new Error('Mac bridge launcher timed out. '+output));},45000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('close',code=>{clearTimeout(timer);resolve({code,output});});
  });
}
const health=port=>fetch(`http://127.0.0.1:${port}/bridge/health`,{signal:AbortSignal.timeout(1000)}).then(response=>response.json());
const saved=f=>JSON.parse(readFileSync(path.join(f.data,'launcher-macos.json'),'utf8'));
const flags=(f,port)=>['--install-dir',f.installed,'--data-dir',f.data,'--port',String(port),'--no-browser'];
async function freePort(){const server=http.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}

test('Mac runtime pins and resource manifests separate architecture, licenses, version, and private state',()=>{
  for(const arch of ['arm64','x64']){
    const pin=bridgeRuntimePin(`macos-${arch}`);assert.equal(pin.arch,arch);assert.equal(pin.platform,'darwin');assert.equal(pin.minimumOSVersion,'13.5');assert.match(pin.url,new RegExp(`^https://nodejs.org/download/release/v24\\.22\\.1/node-v24\\.22\\.1-darwin-${arch}\\.tar\\.gz$`));assert.match(pin.sha256,/^[a-f0-9]{64}$/);
  }
  assert.throws(()=>bridgeRuntimePin('macos-universal'),/Choose/);
  const f=fixture();
  try{
    const prepared=prepareBridgeStage({runtimeDirectory:f.runtime,stageDirectory:f.stage,sourceHash:'f'.repeat(64),target});
    assert.equal(prepared.manifest.platform,target);assert.equal(prepared.manifest.minimumOSVersion,'13.5');assert.ok(prepared.files.some(file=>file.name==='runtime/node'));
    assert.equal(prepared.files.some(file=>/node\.exe|\.ps1|\.cmd|^data\//.test(file.name)),false);
    for(const name of macBridgeLauncherFiles)assert.ok(prepared.files.some(file=>file.name===name));
    for(const item of prepared.manifest.files)assert.equal(item.sha256,createHash('sha256').update(readFileSync(path.join(f.stage,item.path))).digest('hex'));
    assert.throws(()=>assertSeparateData(f.installed,path.join(f.installed,'Contents','data')),/separate/);
    assert.throws(()=>assertSeparateData(f.installed,path.dirname(f.installed)),/separate/);
    assert.doesNotThrow(()=>assertSeparateData(f.installed,f.data));
    assert.throws(()=>parseOptions(['--install','--stop']),/one bridge action/);assert.throws(()=>parseOptions(['--install','--skip-protocol-registration']),/explicit/);
  }finally{f.clean();}
});

test('native Mac installer preserves quarantine metadata, actual grants, and ownership across updates',{skip:!native,timeout:120000},async()=>{
  const f=fixture(),port=await freePort();let latest,spoof;
  try{
    const {app}=f.prepare();
    execFileSync('/usr/bin/xattr',['-w','app.sharedboard.fixture','preserve this metadata',app]);
    const quarantine=`0000;00000000;SharedBoardFixture;${randomUUID()}`;
    execFileSync('/usr/bin/xattr',['-w','com.apple.quarantine',quarantine,app]);
    mkdirSync(f.data);writeFileSync(path.join(f.data,'launcher-macos.lock'),JSON.stringify({pid:process.pid,uid:process.getuid(),created:'stale process identity',command:'stale launcher'}));
    const installed=await runMacCommand(f.stage,'Install',...flags(f,port),'--skip-protocol-registration');assert.equal(installed.code,0,installed.output);latest=saved(f);
    assert.equal((await health(port)).bridgeId,latest.bridgeId);assert.equal(execFileSync('/usr/bin/xattr',['-p','app.sharedboard.fixture',f.installed],{encoding:'utf8'}).trim(),'preserve this metadata');
    assert.equal(execFileSync('/usr/bin/xattr',['-p','com.apple.quarantine',f.installed],{encoding:'utf8'}).trim(),quarantine);
    const paired=await fetch(`http://127.0.0.1:${port}/bridge/browser/pair`,{method:'POST',headers:{Origin:'https://sharedboard.app','Content-Type':'application/json'},body:JSON.stringify({boardId:randomUUID(),clientId:'fixture_tab',permission:'read',title:'Private Mac fixture'})});assert.equal(paired.status,200);
    const grants=JSON.parse(readFileSync(path.join(f.data,'bridge-state.json'))).grants;assert.equal(grants.length,1);
    const repeated=await runMacCommand(f.stage,'Start',...flags(f,port));assert.equal(repeated.code,0,repeated.output);assert.equal(saved(f).pid,latest.pid);
    const installedLauncher=path.join(f.installed,'Contents/Resources/launcher.mjs');
    execFileSync(path.join(f.installed,'Contents/Resources/runtime/node'),[installedLauncher,'--install',...flags(f,port),'--skip-protocol-registration']);assert.equal(saved(f).pid,latest.pid,'reopening the installed app must reuse its running bridge');
    const otherData=path.join(f.directory,'wrong-copy data');mkdirSync(otherData);writeFileSync(path.join(otherData,'launcher-macos.json'),JSON.stringify(latest));
    const wrongCopy=await runMacCommand(f.stage,'Stop','--install-dir',f.installed,'--data-dir',otherData);assert.equal(wrongCopy.code,0,wrongCopy.output);assert.match(wrongCopy.output,/No matching/);assert.equal((await health(port)).bridgeId,latest.bridgeId);
    const occupied=await runMacCommand(f.stage,'Start','--install-dir',f.installed,'--data-dir',otherData,'--port',String(port),'--no-browser');assert.equal(occupied.code,1);assert.match(occupied.output,/another service or bridge installation/);
    const node=path.join(f.installed,'Contents/Resources/runtime/node'),entry=path.join(f.installed,'Contents/Resources/app/bridge/index.mjs');
    spoof=spawn(node,['--eval','setInterval(()=>{},1000)','--',entry,'--port',String(port),'--data-dir',f.data],{stdio:'ignore'});await new Promise((resolve,reject)=>{spoof.once('spawn',resolve);spoof.once('error',reject);});
    const created=execFileSync('/bin/ps',['-ww','-p',String(spoof.pid),'-o','lstart='],{encoding:'utf8',env:{...process.env,LC_ALL:'C'}}).trim();
    writeFileSync(path.join(f.data,'launcher-macos.json'),JSON.stringify({...latest,pid:spoof.pid,created}));
    const wrongArgs=await runMacCommand(f.stage,'Stop',...flags(f,port));assert.equal(wrongArgs.code,0,wrongArgs.output);assert.match(wrongArgs.output,/No matching/);assert.equal(spoof.exitCode,null);assert.equal((await health(port)).bridgeId,latest.bridgeId);
    writeFileSync(path.join(f.data,'launcher-macos.json'),JSON.stringify(latest));const exited=new Promise(resolve=>spoof.once('exit',resolve));spoof.kill();await exited;spoof=null;
    const update=await runMacCommand(f.stage,'Install',...flags(f,port),'--skip-protocol-registration');assert.equal(update.code,0,update.output);latest=saved(f);
    assert.deepEqual(JSON.parse(readFileSync(path.join(f.data,'bridge-state.json'))).grants,grants);assert.equal(execFileSync('/usr/bin/xattr',['-p','app.sharedboard.fixture',f.installed],{encoding:'utf8'}).trim(),'preserve this metadata');
    assert.equal(execFileSync('/usr/bin/xattr',['-p','com.apple.quarantine',f.installed],{encoding:'utf8'}).trim(),quarantine);
    const stopped=await runMacCommand(f.stage,'Stop',...flags(f,port));assert.equal(stopped.code,0,stopped.output);await assert.rejects(health(port));
  }finally{
    if(spoof){const exited=new Promise(resolve=>spoof.once('exit',resolve));spoof.kill();await exited;}
    if(latest&&existsSync(f.data))writeFileSync(path.join(f.data,'launcher-macos.json'),JSON.stringify(latest));
    await runMacCommand(f.stage,'Stop',...flags(f,port)).catch(()=>{});f.clean();
  }
});

test('native Mac failed activation restores the previous app and preserves private state',{skip:!native,timeout:90000},async()=>{
  const f=fixture(),port=await freePort();
  try{
    f.prepare();let result=await runMacCommand(f.stage,'Install',...flags(f,port),'--skip-protocol-registration');assert.equal(result.code,0,result.output);
    result=await runMacCommand(f.stage,'Stop',...flags(f,port));assert.equal(result.code,0,result.output);
    const original=readFileSync(path.join(f.installed,'Contents/Resources/app/bridge/index.mjs'),'utf8'),state=readFileSync(path.join(f.data,'bridge-state.json'),'utf8');
    writeFileSync(path.join(f.stage,'SharedBoard Bridge.app/Contents/Resources/app/bridge/index.mjs'),"throw new Error('fixture broken update');\n");
    result=await runMacCommand(f.stage,'Install',...flags(f,port),'--skip-protocol-registration');assert.equal(result.code,1);assert.match(result.output,/startup|could not be identified/);
    assert.equal(readFileSync(path.join(f.installed,'Contents/Resources/app/bridge/index.mjs'),'utf8'),original);assert.equal(readFileSync(path.join(f.data,'bridge-state.json'),'utf8'),state);
  }finally{await runMacCommand(f.stage,'Stop',...flags(f,port)).catch(()=>{});f.clean();}
});
