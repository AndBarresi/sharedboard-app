// SharedBoard.app — Andrew Barresi (https://github.com/AndBarresi). MIT.
import {spawn,execFileSync} from 'node:child_process';
import {closeSync,existsSync,lstatSync,mkdirSync,openSync,readFileSync,readdirSync,realpathSync,renameSync,rmSync,statSync,unlinkSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import net from 'node:net';

const resources=path.dirname(fileURLToPath(import.meta.url));
const sourceApp=path.resolve(resources,'../..');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const json=file=>JSON.parse(readFileSync(file,'utf8'));
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
const canonical=value=>realpathSync.native(value);
const same=(left,right)=>{try{return canonical(left)===canonical(right);}catch{return false;}};
const lsregister='/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';

export function parseOptions(args){
  const options={action:'start',noBrowser:false,skipProtocolRegistration:false,port:4319};let action;
  for(let i=0;i<args.length;i++){
    const flag=args[i];
    if(['--install','--start','--stop'].includes(flag)){if(action)throw new Error('Choose one bridge action.');action=flag.slice(2);options.action=action;}
    else if(flag==='--no-browser')options.noBrowser=true;
    else if(flag==='--skip-protocol-registration')options.skipProtocolRegistration=true;
    else if(['--install-dir','--data-dir','--port'].includes(flag)){
      const value=args[++i];if(!value)throw new Error(`A value is required for ${flag}.`);
      if(flag==='--port'){options.port=Number(value);if(!Number.isInteger(options.port)||options.port<1||options.port>65535)throw new Error('Choose a port from 1 to 65535.');}
      else options[flag==='--install-dir'?'installDir':'dataDir']=path.resolve(value);
    }else throw new Error(`Unknown bridge option: ${flag}`);
  }
  if(options.skipProtocolRegistration&&(options.action!=='install'||!options.installDir||!options.dataDir))throw new Error('Skipping protocol registration requires install with explicit installation and data folders.');
  return options;
}
function assertOrdinaryTree(directory){
  const stat=lstatSync(directory);if(stat.isSymbolicLink())throw new Error('Bridge application files cannot be filesystem links.');
  if(stat.isDirectory()){for(const item of readdirSync(directory))assertOrdinaryTree(path.join(directory,item));}
  else if(!stat.isFile())throw new Error('Bridge applications must contain ordinary files.');
}
function ps(pid,field){
  return execFileSync('/bin/ps',['-ww','-p',String(pid),'-o',`${field}=`],{encoding:'utf8',env:{...process.env,LC_ALL:'C'},stdio:['ignore','pipe','ignore']}).trim();
}
function identity(pid,node,entry,dataDir,port){
  try{
    if(!Number.isSafeInteger(pid)||pid<=0||Number(ps(pid,'uid'))!==process.getuid())return null;
    if(!same(ps(pid,'comm'),node))return null;
    if(ps(pid,'command')!==[node,entry,'--port',String(port),'--data-dir',dataDir].join(' '))return null;
    return ps(pid,'lstart');
  }catch{return null;}
}
async function health(port){
  try{const response=await fetch(`http://127.0.0.1:${port}/bridge/health`,{signal:AbortSignal.timeout(1500)});if(!response.ok)return null;return await response.json();}catch{return null;}
}
function readOwned(file,{app,node,entry,dataDir}){
  try{
    const saved=json(file);
    if(saved.schemaVersion!==1||!same(saved.app,app)||!same(saved.dataDir,dataDir)||!Number.isInteger(saved.port)||saved.port<1||saved.port>65535||typeof saved.bridgeId!=='string')return null;
    const created=identity(saved.pid,node,entry,dataDir,saved.port);
    return created&&created===saved.created?saved:null;
  }catch{return null;}
}
async function stopOwned(file,context){
  const saved=readOwned(file,context);if(!saved)return false;
  process.kill(saved.pid,'SIGTERM');
  for(let attempt=0;attempt<100;attempt++){if(!identity(saved.pid,context.node,context.entry,context.dataDir,saved.port))return true;await sleep(100);}
  throw new Error('The bridge is still stopping. Wait a moment, then try again.');
}
async function lock(file){
  const deadline=Date.now()+30000;
  while(Date.now()<deadline){
    try{const descriptor=openSync(file,'wx',0o600);writeFileSync(descriptor,JSON.stringify({pid:process.pid,uid:process.getuid(),created:ps(process.pid,'lstart'),command:ps(process.pid,'command')}));closeSync(descriptor);return ()=>{try{if(json(file).pid===process.pid)unlinkSync(file);}catch{}};}
    catch(error){
      if(error.code!=='EEXIST')throw error;
      let owner=false;
      try{const saved=json(file);owner=alive(saved.pid)&&saved.uid===process.getuid()&&Number(ps(saved.pid,'uid'))===saved.uid&&ps(saved.pid,'lstart')===saved.created&&ps(saved.pid,'command')===saved.command;}catch{}
      try{if(!owner&&Date.now()-statSync(file).mtimeMs>1000)unlinkSync(file);}catch{}
      await sleep(100);
    }
  }
  throw new Error('Another bridge installation or launch is in progress. Wait a moment and try again.');
}
async function requireFreePort(port){
  const server=net.createServer();
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});}
  catch{throw new Error(`Port ${port} is already used by another application. Stop that application before starting this bridge.`);}
  finally{if(server.listening)await new Promise(resolve=>server.close(resolve));}
}
function ownedApplication(app){
  try{return json(path.join(app,'Contents/Resources/app/package.json')).name==='sharedboard-bridge';}catch{return false;}
}
export function assertSeparateData(app,dataDir,source=sourceApp){
  const resolved=value=>{const parts=[];let current=path.resolve(value);while(!existsSync(current)){parts.unshift(path.basename(current));const parent=path.dirname(current);if(parent===current)throw new Error('The bridge path could not be resolved.');current=parent;}return path.join(canonical(current),...parts);};
  const inside=(left,right)=>{const relative=path.relative(right,left);return !relative||relative!=='..'&&!relative.startsWith(`..${path.sep}`)&&!path.isAbsolute(relative);};
  const data=resolved(dataDir);
  for(const bundle of [resolved(app),resolved(source)])if(inside(data,bundle)||inside(bundle,data))throw new Error('Keep the bridge data folder separate from both application bundles.');
}
function installApplication(app){
  assertOrdinaryTree(sourceApp);
  if(same(sourceApp,app))return {commit(){},rollback(){}};
  if(existsSync(app)&&!ownedApplication(app))throw new Error('The installation target already contains another application. It has been preserved.');
  if(existsSync(app))assertOrdinaryTree(app);
  const parent=path.dirname(app);mkdirSync(parent,{recursive:true});
  const staged=path.join(parent,`.SharedBoard-Bridge-install-${randomUUID()}.app`),previous=path.join(parent,`.SharedBoard-Bridge-previous-${randomUUID()}.app`);
  let replaced=false;
  try{
    // Keep Gatekeeper quarantine and other metadata; never strip downloaded-file flags.
    execFileSync('/usr/bin/ditto',['--rsrc','--extattr','--qtn',sourceApp,staged],{stdio:'pipe'});
    if(existsSync(app)){renameSync(app,previous);replaced=true;}
    try{renameSync(staged,app);}catch(error){if(replaced)renameSync(previous,app);throw error;}
    return {
      commit(){if(replaced)rmSync(previous,{recursive:true,force:true});},
      rollback(){if(ownedApplication(app))rmSync(app,{recursive:true,force:true});if(replaced&&existsSync(previous)){renameSync(previous,app);try{execFileSync(lsregister,['-f',app],{stdio:'pipe'});}catch{}}}
    };
  }finally{if(existsSync(staged))rmSync(staged,{recursive:true,force:true});}
}

export async function main(args=process.argv.slice(2)){
  if(process.platform!=='darwin')throw new Error('Use the macOS bridge package on a Mac.');
  const options=parseOptions(args);
  const app=options.installDir??path.join(homedir(),'Applications','SharedBoard Bridge.app');
  if(!app.endsWith('.app'))throw new Error('Choose an application installation path ending in .app.');
  const dataDir=options.dataDir??path.join(homedir(),'Library','Application Support','SharedBoardBridge','data');
  assertSeparateData(app,dataDir);
  mkdirSync(dataDir,{recursive:true,mode:0o700});
  if(lstatSync(dataDir).isSymbolicLink())throw new Error('The bridge data folder must not be a filesystem link.');
  const context={app,node:path.join(app,'Contents/Resources/runtime/node'),entry:path.join(app,'Contents/Resources/app/bridge/index.mjs'),dataDir};
  const launcherFile=path.join(dataDir,'launcher-macos.json'),releaseLock=await lock(path.join(dataDir,'launcher-macos.lock'));
  let child,created,installation;
  try{
    if(options.action==='stop'){
      console.log(await stopOwned(launcherFile,context)?'SharedBoard Bridge is stopped. Browser boards and saved grants are preserved.':'No matching SharedBoard Bridge process is running for this installation.');return;
    }
    if(options.action==='install'){
      if(!same(sourceApp,app))await stopOwned(launcherFile,context);
      installation=installApplication(app);
      if(!options.skipProtocolRegistration)execFileSync(lsregister,['-f',app],{stdio:'pipe'});
    }
    if(!existsSync(context.node)||!existsSync(context.entry))throw new Error('Extract the whole ZIP and open Install SharedBoard Bridge.command first.');
    const saved=readOwned(launcherFile,context);
    if(saved){
      if(saved.port!==options.port)throw new Error('This bridge is already running on another port. Stop it before changing ports.');
      const ready=await health(options.port);if(ready?.product!=='SharedBoard Bridge'||ready.bridgeId!==saved.bridgeId)throw new Error('This bridge is running but not responding correctly. Stop it and try again.');
      console.log('SharedBoard Bridge is already available for this installation.');
    }else{
      if(await health(options.port))throw new Error(`Port ${options.port} is already used by another service or bridge installation.`);
      await requireFreePort(options.port);
      const out=openSync(path.join(dataDir,'bridge.log'),'a',0o600),err=openSync(path.join(dataDir,'bridge-error.log'),'a',0o600);
      try{
        const commandPath=[path.dirname(context.node),path.join(homedir(),'.local','bin'),'/opt/homebrew/bin','/usr/local/bin',...(process.env.PATH??'/usr/bin:/bin:/usr/sbin:/sbin').split(':')];
        child=spawn(context.node,[context.entry,'--port',String(options.port),'--data-dir',dataDir],{cwd:app,detached:true,env:{...process.env,PATH:[...new Set(commandPath)].join(':')},stdio:['ignore',out,err]});
        await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();
      }finally{closeSync(out);closeSync(err);}
      created=identity(child.pid,context.node,context.entry,dataDir,options.port);
      if(!created)throw new Error('The bridge process could not be identified safely. Check bridge-error.log.');
      let ready;
      for(let attempt=0;attempt<60;attempt++){
        await sleep(250);if(!identity(child.pid,context.node,context.entry,dataDir,options.port))throw new Error('The bridge stopped during startup. Check bridge-error.log.');
        ready=await health(options.port);
        let expectedId;try{expectedId=json(path.join(dataDir,'bridge-state.json')).bridgeId;}catch{}
        if(ready?.product==='SharedBoard Bridge'&&ready.bridgeId===expectedId)break;
        ready=null;
      }
      if(ready?.product!=='SharedBoard Bridge')throw new Error('The bridge did not become ready. Check bridge-error.log and try again.');
      writeFileSync(launcherFile,JSON.stringify({schemaVersion:1,pid:child.pid,created,port:options.port,bridgeId:ready.bridgeId,app,dataDir},null,2)+'\n',{mode:0o600});
      console.log('SharedBoard Bridge is ready. Return to the webpage and choose Check bridge.');
    }
    installation?.commit();installation=null;
    if(!options.noBrowser)execFileSync('/usr/bin/open',['https://sharedboard.app/'],{stdio:'ignore'});
  }catch(error){
    if(child&&created&&identity(child.pid,context.node,context.entry,dataDir,options.port)===created){try{process.kill(child.pid,'SIGTERM');}catch{}}
    if(installation)try{installation.rollback();}catch(rollbackError){error.message+=` The earlier application could not be restored automatically: ${rollbackError.message}`;}
    try{writeFileSync(path.join(dataDir,'launcher-error.log'),`${new Date().toISOString()} ${error.message}\n`,{mode:0o600});}catch{}
    throw error;
  }finally{releaseLock();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(`SharedBoard Bridge could not complete this action: ${error.message}`);process.exitCode=1;});
