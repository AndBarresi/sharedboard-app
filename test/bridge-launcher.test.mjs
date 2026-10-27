import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn,execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {copyFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,realpathSync,renameSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {bridgeSourceFiles,bridgeLauncherFiles,prepareBridgeStage,listBridgePackageFiles} from '../scripts/package-bridge.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const sourceHash='f'.repeat(64);
function fixture(){
  // Hosted Windows runners may expose TEMP through an 8.3 alias (RUNNER~1).
  // Canonicalize both the cleanup boundary and fixture before deriving paths.
  const temporary=realpathSync.native(os.tmpdir());
  const directory=realpathSync.native(mkdtempSync(path.join(temporary,"sharedboard bridge 'case ")));
  const source=path.join(directory,'source'),runtime=path.join(directory,'runtime'),stage=path.join(directory,'extracted ZIP'),installed=path.join(directory,"installed bridge ' copy");
  for(const item of ['bridge','packaging/bridge'])mkdirSync(path.join(source,item),{recursive:true});
  mkdirSync(runtime);mkdirSync(stage);
  for(const name of ['package.json','LICENSE','AUTHORS.md'])copyFileSync(path.join(root,name),path.join(source,name));
  copyFileSync(path.join(root,'packaging/runtime.json'),path.join(source,'packaging/runtime.json'));
  for(const name of bridgeSourceFiles)copyFileSync(path.join(root,'bridge',name),path.join(source,'bridge',name));
  for(const name of bridgeLauncherFiles)copyFileSync(path.join(root,'packaging/bridge',name),path.join(source,'packaging/bridge',name));
  copyFileSync(process.execPath,path.join(runtime,'node.exe'));
  writeFileSync(path.join(runtime,'LICENSE'),'Fixture runtime license');writeFileSync(path.join(runtime,'README.md'),'Fixture runtime readme');
  return {directory,source,runtime,stage,installed,prepare(target=stage){return prepareBridgeStage({sourceRoot:source,runtimeDirectory:runtime,stageDirectory:target,sourceHash});},clean(){
    const resolved=realpathSync.native(directory),relative=path.relative(temporary,resolved);
    if(!relative||relative==='..'||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative)||!path.basename(resolved).startsWith("sharedboard bridge 'case "))throw new Error('Refusing bridge fixture cleanup outside its temporary folder.');
    rmSync(resolved,{recursive:true,force:true});
  }};
}
function run(directory,...flags){
  return new Promise((resolve,reject)=>{
    const child=spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(directory,'bridge.ps1'),...flags],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    let output='';child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{output+=chunk;});
    const timer=setTimeout(()=>{child.kill();reject(new Error('Bridge launcher fixture timed out. '+output));},45000);
    child.on('error',error=>{clearTimeout(timer);reject(error);});
    // A deliberately detached server may keep inherited Windows pipe handles open.
    child.on('exit',code=>{clearTimeout(timer);child.stdout.destroy();child.stderr.destroy();resolve({code,output});});
  });
}
async function unusedPort(){const server=http.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
const metadata=directory=>JSON.parse(readFileSync(path.join(directory,'data/launcher.json'),'utf8').replace(/^\uFEFF/,''));
const health=port=>fetch(`http://127.0.0.1:${port}/bridge/health`,{signal:AbortSignal.timeout(1500)}).then(response=>response.json());

test('bridge staging includes only the declared code/runtime and verifiable versioned manifest',()=>{
  const f=fixture();
  try{
    mkdirSync(path.join(f.source,'data'));writeFileSync(path.join(f.source,'data/agent-private.json'),'private grant');
    writeFileSync(path.join(f.source,'bridge/agent-private.json'),'private grant');writeFileSync(path.join(f.source,'bridge/private-extra.mjs'),'private helper');
    writeFileSync(path.join(f.source,'packaging/bridge/.env'),'PRIVATE_KEY=not-for-release');
    const {files,manifest}=f.prepare();
    assert.equal(manifest.product,'SharedBoard Bridge');assert.equal(manifest.version,JSON.parse(readFileSync(path.join(root,'package.json'))).version);assert.equal(manifest.sourceHash,sourceHash);
    const expected=[...bridgeSourceFiles.map(name=>`app/bridge/${name}`),...bridgeLauncherFiles,'app/package.json','runtime/node.exe','runtime/LICENSE','runtime/README.md','LICENSE','AUTHORS.md','package-manifest.json'].sort();
    assert.deepEqual(files.map(file=>file.name).sort(),expected);assert.equal(existsSync(path.join(f.stage,'data')),false);
    const packaged=JSON.parse(readFileSync(path.join(f.stage,'app/package.json')));assert.equal(packaged.version,manifest.version);assert.equal(packaged.author.name,'Andrew Barresi');
    for(const item of manifest.files)assert.equal(item.sha256,createHash('sha256').update(readFileSync(path.join(f.stage,item.path))).digest('hex'));
    mkdirSync(path.join(f.stage,'data'));writeFileSync(path.join(f.stage,'data/bridge-state.json'),'private');
    assert.throws(()=>listBridgePackageFiles(f.stage),/Private bridge data/);
  }finally{f.clean();}
});

test('bridge staging rejects unbundled dependencies and linked source trees',()=>{
  const f=fixture();
  try{
    const client=path.join(f.source,'bridge/client.mjs'),original=readFileSync(client,'utf8');
    writeFileSync(client,original+"\nimport missing from 'unbundled-package';\n");
    assert.throws(()=>f.prepare(),/unbundled dependency/);assert.equal(readdirSync(f.stage).length,0);
    writeFileSync(client,original);
    renameSync(path.join(f.source,'bridge'),path.join(f.source,'actual-bridge'));
    symlinkSync(path.join(f.source,'actual-bridge'),path.join(f.source,'bridge'),process.platform==='win32'?'junction':'dir');
    assert.throws(()=>f.prepare(),/filesystem links/);
  }finally{f.clean();}
});

test('isolated bridge install/start/reinstall/stop preserves grants and never owns another process',{skip:process.platform!=='win32',timeout:120000},async()=>{
  const f=fixture(),port=await unusedPort();let saved,spoof;
  const connectionFile=path.join(f.installed,'data/launcher.json');
  try{
    f.prepare();
    const installed=await run(f.stage,'-Install','-InstallDir',f.installed,'-SkipProtocolRegistration','-NoBrowser','-Port',String(port));
    assert.equal(installed.code,0,installed.output);saved=metadata(f.installed);
    assert.equal(realpathSync.native(saved.root),realpathSync.native(f.installed));assert.equal(realpathSync.native(saved.dataDir),realpathSync.native(path.join(f.installed,'data')));assert.equal(saved.port,port);
    assert.equal(existsSync(path.join(f.installed,'package-manifest.json')),true);assert.equal(existsSync(path.join(f.installed,'app/app')),false);
    const originalHealth=await health(port);assert.equal(originalHealth.product,'SharedBoard Bridge');assert.equal(originalHealth.bridgeId,saved.bridgeId);assert.equal(originalHealth.version,JSON.parse(readFileSync(path.join(f.installed,'app/package.json'))).version);
    const pairing=await fetch(`http://127.0.0.1:${port}/bridge/browser/pair`,{method:'POST',headers:{Origin:'https://sharedboard.app','Content-Type':'application/json'},body:JSON.stringify({boardId:randomUUID(),title:'Private installation fixture',permission:'read',clientId:'fixture_tab'})});
    assert.equal(pairing.status,200);const paired=await pairing.json();assert.equal(typeof paired.browserToken,'string');
    const originalGrants=JSON.parse(readFileSync(path.join(f.installed,'data/bridge-state.json'))).grants;assert.equal(originalGrants.length,1);
    const repeated=await run(f.installed,'-Start','-NoBrowser','-Port',String(port));assert.equal(repeated.code,0,repeated.output);assert.equal(metadata(f.installed).pid,saved.pid);

    // A copied launcher record must not authorize stopping this installation.
    mkdirSync(path.join(f.stage,'data'));writeFileSync(path.join(f.stage,'data/launcher.json'),JSON.stringify(saved));
    const wrongCopy=await run(f.stage,'-Stop');assert.equal(wrongCopy.code,0,wrongCopy.output);assert.match(wrongCopy.output,/No matching/);assert.equal((await health(port)).bridgeId,saved.bridgeId);
    const otherStart=await run(f.stage,'-Start','-NoBrowser','-Port',String(port));assert.equal(otherStart.code,1);assert.match(otherStart.output,/another service or bridge installation/);

    // Exact arguments matter, even for a process using this copy's node.exe and
    // containing both the real entry and data paths elsewhere on its command line.
    const ownNode=path.join(f.installed,'runtime/node.exe'),entry=path.join(f.installed,'app/bridge/index.mjs');
    spoof=spawn(ownNode,['--eval','setInterval(()=>{},1000)','--',entry,'--port',String(port),'--data-dir',saved.dataDir],{windowsHide:true,stdio:'ignore'});
    await new Promise((resolve,reject)=>{spoof.once('spawn',resolve);spoof.once('error',reject);});
    const created=execFileSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',`(Get-CimInstance Win32_Process -Filter 'ProcessId = ${spoof.pid}').CreationDate.ToUniversalTime().ToString('o')`],{encoding:'utf8',windowsHide:true}).trim();
    writeFileSync(connectionFile,JSON.stringify({...saved,pid:spoof.pid,created}));
    const wrongArgs=await run(f.installed,'-Stop');assert.equal(wrongArgs.code,0,wrongArgs.output);assert.match(wrongArgs.output,/No matching/);assert.equal(spoof.exitCode,null);assert.equal((await health(port)).bridgeId,saved.bridgeId);
    writeFileSync(connectionFile,JSON.stringify({...saved,created:'2000-01-01T00:00:00.0000000Z'}));
    const reusedPid=await run(f.installed,'-Stop');assert.equal(reusedPid.code,0,reusedPid.output);assert.match(reusedPid.output,/No matching/);assert.equal((await health(port)).bridgeId,saved.bridgeId);
    writeFileSync(connectionFile,JSON.stringify(saved));
    const spoofStopped=new Promise(resolve=>spoof.once('exit',resolve));spoof.kill();await spoofStopped;spoof=null;

    writeFileSync(path.join(f.installed,'data/fixture-private.txt'),'saved connection metadata remains');
    const reinstalled=await run(f.stage,'-Install','-InstallDir',f.installed,'-SkipProtocolRegistration','-NoBrowser','-Port',String(port));assert.equal(reinstalled.code,0,reinstalled.output);saved=metadata(f.installed);
    assert.equal((await health(port)).bridgeId,originalHealth.bridgeId);assert.equal(readFileSync(path.join(f.installed,'data/fixture-private.txt'),'utf8'),'saved connection metadata remains');
    assert.deepEqual(JSON.parse(readFileSync(path.join(f.installed,'data/bridge-state.json'))).grants,originalGrants,'reinstall must preserve the actual saved browser grant');
    const stopped=await run(f.installed,'-Stop');assert.equal(stopped.code,0,stopped.output);await assert.rejects(health(port));
    assert.equal(readFileSync(path.join(f.installed,'data/fixture-private.txt'),'utf8'),'saved connection metadata remains');
  }finally{
    if(spoof){const ended=new Promise(resolve=>spoof.once('exit',resolve));spoof.kill();await ended;}
    if(saved&&existsSync(connectionFile))writeFileSync(connectionFile,JSON.stringify(saved));
    await run(f.installed,'-Stop').catch(()=>{});f.clean();
  }
});

test('bridge launcher refuses an occupied unrelated port and incomplete extraction',{skip:process.platform!=='win32',timeout:60000},async()=>{
  const f=fixture(),server=http.createServer((request,response)=>response.end(JSON.stringify({product:'SharedBoard Bridge',bridgeId:randomUUID()})));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
  try{
    f.prepare();const result=await run(f.stage,'-Start','-NoBrowser','-Port',String(port));assert.equal(result.code,1);assert.match(result.output,/another service/);assert.equal(existsSync(path.join(f.stage,'data/launcher.json')),false);
    assert.equal((await health(port)).product,'SharedBoard Bridge','an unrelated lookalike service must remain running');
    rmSync(path.join(f.stage,'runtime/node.exe'));
    const incomplete=await run(f.stage,'-Install','-InstallDir',f.installed,'-SkipProtocolRegistration','-NoBrowser');assert.equal(incomplete.code,1);assert.match(incomplete.output,/Extract the whole ZIP/);assert.equal(existsSync(f.installed),false);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));f.clean();}
});

test('Windows PowerShell parses every multiline bridge release workflow step',{skip:process.platform!=='win32'},()=>{
  const f=fixture();
  try{
    const workflow=readFileSync(path.join(root,'.github/workflows/bridge-release.yml'),'utf8');
    const blocks=[...workflow.matchAll(/^        run: \|\r?\n((?:          .*\r?\n|\r?\n)+)/gm)].map(match=>match[1].split(/\r?\n/).map(line=>line.startsWith('          ')?line.slice(10):line).join('\n'));
    assert.ok(blocks.length>=2,'release tag and publication commands must be checked');
    for(const [index,block] of blocks.entries()){
      const script=path.join(f.directory,`workflow-${index}.ps1`);writeFileSync(script,block);
      execFileSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',"$errorsFound = $null; $null = [System.Management.Automation.Language.Parser]::ParseFile($env:SB_BRIDGE_TEST_SCRIPT,[ref]$null,[ref]$errorsFound); if ($errorsFound.Count) { $errorsFound | ForEach-Object { Write-Output $_.Message }; exit 1 }"],{env:{...process.env,SB_BRIDGE_TEST_SCRIPT:script},windowsHide:true});
    }
  }finally{f.clean();}
});
