import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,statSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';

const native=process.platform==='darwin'&&Boolean(process.env.BRIDGE_PACKAGE_ZIP);
const registration='/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
const health=()=>fetch('http://127.0.0.1:4319/bridge/health',{signal:AbortSignal.timeout(1000)}).then(response=>response.json());
async function until(predicate){for(let attempt=0;attempt<120;attempt++){try{const result=await predicate();if(result)return result;}catch{}await new Promise(resolve=>setTimeout(resolve,250));}throw new Error('The native Mac release did not become ready.');}
async function command(directory,action,...args){
  return new Promise((resolve,reject)=>{
    const child=spawn('/bin/bash',[path.join(directory,`${action} SharedBoard Bridge.command`),...args],{stdio:['ignore','pipe','pipe']});let output='';
    child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{output+=chunk;});
    const timer=setTimeout(()=>{child.kill();reject(new Error('Mac release command timed out. '+output));},45000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('close',code=>{clearTimeout(timer);resolve({code,output});});
  });
}

test('actual Mac download preserves executables, signatures, manifest, and safe LaunchServices start/reuse/stop',{skip:!native,timeout:150000},async t=>{
  const temporary=realpathSync.native(os.tmpdir()),directory=realpathSync.native(mkdtempSync(path.join(temporary,"sharedboard Mac release 'case "))),extracted=path.join(directory,'download');
  const installed=path.join(os.homedir(),'Applications','SharedBoard Bridge.app'),data=path.join(os.homedir(),'Library','Application Support','SharedBoardBridge','data');
  const readLauncher=()=>JSON.parse(readFileSync(path.join(data,'launcher-macos.json')));
  const readyAfter=previous=>until(async()=>{
    const ready=await health(),record=readLauncher();
    if(record.bridgeId!==ready.bridgeId||record.pid===previous.pid&&record.created===previous.created)return false;
    return {ready,record};
  });
  let ownsInstallation=false;
  try{
    mkdirSync(extracted);execFileSync('/usr/bin/ditto',['-x','-k',path.resolve(process.env.BRIDGE_PACKAGE_ZIP),extracted]);
    const manifest=JSON.parse(readFileSync(path.join(extracted,'package-manifest.json'))),app=path.join(extracted,'SharedBoard Bridge.app');
    assert.equal(manifest.platform,`macos-${process.arch}`);assert.equal(manifest.minimumOSVersion,'13.5');
    for(const item of manifest.files){const file=path.join(extracted,item.path);assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'),item.sha256);assert.equal(statSync(file).mode&0o777,item.mode);}
    for(const file of ['Install SharedBoard Bridge.command','Start SharedBoard Bridge.command','Stop SharedBoard Bridge.command','SharedBoard Bridge.app/Contents/Resources/bridge.command','SharedBoard Bridge.app/Contents/Resources/runtime/node','SharedBoard Bridge.app/Contents/MacOS/SharedBoardBridge'])assert.ok(statSync(path.join(extracted,file)).mode&0o111,`ZIP extraction must preserve executable bits: ${file}`);
    execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',app]);
    const runtime=path.join(app,'Contents/Resources/runtime/node');assert.equal(execFileSync(runtime,['-p','process.platform+"-"+process.arch'],{encoding:'utf8'}).trim(),`darwin-${process.arch}`);
    // Only disposable GitHub runners may register the real scheme/default install.
    if(process.env.GITHUB_ACTIONS!=='true'){t.diagnostic('Bundle checks passed; real scheme registration is restricted to disposable GitHub runners.');return;}
    if(existsSync(installed)||existsSync(data)){t.skip('A pre-existing bridge installation is preserved.');return;}
    try{await health();t.skip('A pre-existing local bridge is preserved.');return;}catch{}
    ownsInstallation=true;
    const result=await command(extracted,'Install');assert.equal(result.code,0,result.output);
    const ready=await until(()=>health()),state=readLauncher();assert.equal(ready.bridgeId,state.bridgeId);
    const stop=await command(extracted,'Stop');assert.equal(stop.code,0,stop.output);await assert.rejects(health());
    execFileSync('/usr/bin/open',['-g',installed]);
    assert.equal((await readyAfter(state)).ready.bridgeId,state.bridgeId,'a normal app launch must start the installed bridge and write its ownership record');
    const normalStop=await command(extracted,'Stop');assert.equal(normalStop.code,0,normalStop.output);await assert.rejects(health());
    const beforeURL=readLauncher();
    const marker=path.join(directory,`must-not-execute-${randomUUID()}`),url=`sharedboard-bridge://open?command=${encodeURIComponent(`touch '${marker}'`)}&pair=untrusted`;
    execFileSync('/usr/bin/open',['-g',url]);
    const {record:first}=await readyAfter(beforeURL);
    assert.equal(existsSync(marker),false,'URL contents must never become a command');
    execFileSync('/usr/bin/open',['-g',url]);await new Promise(resolve=>setTimeout(resolve,1500));
    assert.equal(readLauncher().pid,first.pid,'the real URL handler must reuse the running bridge');assert.equal(existsSync(marker),false);
    const stopped=await command(extracted,'Stop');assert.equal(stopped.code,0,stopped.output);await assert.rejects(health());
  }finally{
    if(ownsInstallation){
      await command(extracted,'Stop').catch(()=>{});
      try{execFileSync(registration,['-u',installed],{stdio:'ignore'});}catch{}
      if(existsSync(installed)){const pkg=JSON.parse(readFileSync(path.join(installed,'Contents/Resources/app/package.json')));if(pkg.name!=='sharedboard-bridge')throw new Error('Refusing to remove another application.');rmSync(installed,{recursive:true,force:true});}
      if(existsSync(data))rmSync(data,{recursive:true,force:true});
    }
    const relative=path.relative(temporary,directory);if(!relative||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative)||!path.basename(directory).startsWith("sharedboard Mac release 'case "))throw new Error('Refusing release fixture cleanup outside its temporary directory.');
    rmSync(directory,{recursive:true,force:true});
  }
});
