// SharedBoard.app — Andrew Barresi (https://github.com/AndBarresi). MIT.
import {chmodSync,copyFileSync,cpSync,existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeStaticZip} from './package-web.mjs';
import {isBuiltin} from 'node:module';

const root=fileURLToPath(new URL('../',import.meta.url));
const read=name=>JSON.parse(readFileSync(path.join(root,name),'utf8'));
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
export const bridgeSourceFiles=Object.freeze(['index.mjs','server.mjs','paths.mjs','codex.mjs','client.mjs','agent-cli.mjs']);
export const bridgeLauncherFiles=Object.freeze(['bridge.ps1','README.txt','Start SharedBoard Bridge.cmd','Stop SharedBoard Bridge.cmd','Install SharedBoard Bridge.cmd']);
export const macBridgeLauncherFiles=Object.freeze(['launcher.mjs','bridge.command']);
export const macBridgeCommandFiles=Object.freeze(['Install SharedBoard Bridge.command','Start SharedBoard Bridge.command','Stop SharedBoard Bridge.command']);
export const bridgeTargets=Object.freeze(['windows-x64','macos-arm64','macos-x64']);

export function bridgeRuntimePin(target='windows-x64',sourceRoot=root){
  if(!bridgeTargets.includes(target))throw new Error('Choose windows-x64, macos-arm64, or macos-x64.');
  const pin=target==='windows-x64'?JSON.parse(readFileSync(path.join(sourceRoot,'packaging/runtime.json'),'utf8')):JSON.parse(readFileSync(path.join(sourceRoot,'packaging/runtime-macos.json'),'utf8'))[target.slice(6)];
  const archive=target==='windows-x64'?`node-v${pin.version}-win-x64.zip`:`node-v${pin.version}-darwin-${pin.arch}.tar.gz`;
  if(!/^\d+\.\d+\.\d+$/.test(pin.version)||pin.archive!==archive||pin.url!==`https://nodejs.org/download/release/v${pin.version}/${archive}`||!/^[a-f0-9]{64}$/.test(pin.sha256))throw new Error('The bridge runtime must use an exact official Node release and pinned checksum.');
  if(target!=='windows-x64'&&(pin.platform!=='darwin'||pin.arch!==target.slice(6)||pin.minimumOSVersion!=='13.5'))throw new Error('Invalid macOS runtime target metadata.');
  return pin;
}

function ordinaryFile(file,boundary){
  const relative=path.relative(boundary,file);
  if(relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative))throw new Error('Bridge package sources must stay inside their source folder.');
  let current=boundary;
  if(lstatSync(current).isSymbolicLink())throw new Error('Bridge package sources cannot contain filesystem links.');
  for(const part of relative.split(path.sep)){current=path.join(current,part);if(lstatSync(current).isSymbolicLink())throw new Error('Bridge package sources cannot contain filesystem links.');}
  if(!lstatSync(file).isFile())throw new Error(`Bridge package source must be an ordinary file: ${file}`);
  return file;
}
export function listBridgePackageFiles(directory){
  const files=[];
  const walk=(folder,prefix='')=>{for(const entry of readdirSync(folder,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
    const name=prefix?`${prefix}/${entry.name}`:entry.name,file=path.join(folder,entry.name),stat=lstatSync(file);
    if(stat.isSymbolicLink())throw new Error('Bridge packages cannot contain filesystem links.');
    if(/(^|\/)(data|\.env[^/]*|agent-.*\.json|bridge-state\.json)(\/|$)|\.(?:log|token)$/i.test(name))throw new Error('Private bridge data is forbidden in a release.');
    if(stat.isDirectory())walk(file,name);else if(stat.isFile())files.push({name,file,size:stat.size});else throw new Error('Bridge packages can only contain ordinary files.');
  }};
  walk(directory);return files;
}

// Pure staging is separate from runtime download/release checks so isolated fixtures can
// verify the exact distributed layout without touching an installed user's bridge.
export function prepareBridgeStage({sourceRoot=root,runtimeDirectory,stageDirectory,sourceHash,target='windows-x64'}={}){
  sourceRoot=path.resolve(sourceRoot);stageDirectory=path.resolve(stageDirectory);
  if(!runtimeDirectory)throw new Error('A verified runtime folder is required.');
  runtimeDirectory=path.resolve(runtimeDirectory);
  if(readdirSync(stageDirectory).length)throw new Error('Bridge staging requires a new empty folder.');
  const pkg=JSON.parse(readFileSync(ordinaryFile(path.join(sourceRoot,'package.json'),sourceRoot),'utf8'));
  const runtime=bridgeRuntimePin(target,sourceRoot),mac=target.startsWith('macos-');
  sourceHash??=JSON.parse(readFileSync(ordinaryFile(path.join(sourceRoot,'releases.json'),sourceRoot),'utf8')).sourceHash;
  if(!/^\d+\.\d+\.\d+$/.test(pkg.version)||!/^\d+\.\d+\.\d+$/.test(runtime.version)||!/^[a-f0-9]{64}$/.test(sourceHash))throw new Error('Bridge package version/source metadata is invalid.');
  const allowed=new Set(bridgeSourceFiles);
  for(const name of bridgeSourceFiles){
    const source=ordinaryFile(path.join(sourceRoot,'bridge',name),sourceRoot),text=readFileSync(source,'utf8');
    for(const match of text.matchAll(/\bfrom\s+['"]([^'"]+)['"]|\bimport\s*(?:\(\s*)?['"]([^'"]+)['"]/g)){
      const specifier=match[1]??match[2];
      if(isBuiltin(specifier))continue;
      if(!specifier.startsWith('./')||!allowed.has(specifier.slice(2)))throw new Error(`Bridge package has an unbundled dependency: ${name} imports ${specifier}.`);
    }
  }
  mkdirSync(path.join(stageDirectory,'runtime'));
  for(const name of [mac?'node':'node.exe','LICENSE','README.md'])copyFileSync(ordinaryFile(path.join(runtimeDirectory,mac&&name==='node'?'bin/node':name),runtimeDirectory),path.join(stageDirectory,'runtime',name));
  if(mac)chmodSync(path.join(stageDirectory,'runtime/node'),0o755);
  mkdirSync(path.join(stageDirectory,'app/bridge'),{recursive:true});
  for(const name of bridgeSourceFiles)copyFileSync(ordinaryFile(path.join(sourceRoot,'bridge',name),sourceRoot),path.join(stageDirectory,'app/bridge',name));
  writeFileSync(path.join(stageDirectory,'app/package.json'),JSON.stringify({name:'sharedboard-bridge',version:pkg.version,private:true,type:'module',author:pkg.author,license:'MIT',homepage:pkg.homepage})+'\n');
  for(const name of mac?macBridgeLauncherFiles:bridgeLauncherFiles){copyFileSync(ordinaryFile(path.join(sourceRoot,mac?'packaging/bridge-macos':'packaging/bridge',name),sourceRoot),path.join(stageDirectory,name));if(name.endsWith('.command'))chmodSync(path.join(stageDirectory,name),0o755);}
  for(const name of ['LICENSE','AUTHORS.md'])copyFileSync(ordinaryFile(path.join(sourceRoot,name),sourceRoot),path.join(stageDirectory,name));
  const files=listBridgePackageFiles(stageDirectory);
  const manifest={product:'SharedBoard Bridge',version:pkg.version,sourceHash,platform:target,nodeVersion:runtime.version,...(mac?{minimumOSVersion:runtime.minimumOSVersion}:{}),author:pkg.author,license:'MIT',homepage:pkg.homepage,files:files.map(file=>({path:file.name,sha256:hash(file.file)}))};
  writeFileSync(path.join(stageDirectory,'package-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  return {files:listBridgePackageFiles(stageDirectory),manifest};
}

export function prepareMacBridgeApp({sourceRoot=root,runtimeDirectory,stageDirectory,sourceHash,target=`macos-${process.arch}`}={}){
  if(process.platform!=='darwin'||!target.startsWith('macos-')||target!==`macos-${process.arch}`)throw new Error('Build and test each Mac package on its matching native macOS architecture. Rosetta is not installed automatically.');
  const runtime=bridgeRuntimePin(target,sourceRoot),pkg=JSON.parse(readFileSync(path.join(sourceRoot,'package.json'),'utf8'));
  const app=path.join(stageDirectory,'SharedBoard Bridge.app');
  execFileSync('/usr/bin/osacompile',['-o',app,ordinaryFile(path.join(sourceRoot,'packaging/bridge-macos/application.applescript'),sourceRoot)],{stdio:'pipe'});
  const appResources=path.join(app,'Contents/Resources'),companion=mkdtempSync(path.join(os.tmpdir(),'sharedboard-macos-resources-'));
  const prepared=prepareBridgeStage({sourceRoot,runtimeDirectory,stageDirectory:companion,sourceHash,target});
  for(const name of readdirSync(companion))cpSync(path.join(companion,name),path.join(appResources,name),{recursive:true,errorOnExist:true,force:false});
  const plist=path.join(app,'Contents/Info.plist'),info=JSON.parse(execFileSync('/usr/bin/plutil',['-convert','json','-o','-',plist],{encoding:'utf8'}));
  Object.assign(info,{CFBundleIdentifier:'app.sharedboard.bridge',CFBundleName:'SharedBoard Bridge',CFBundleDisplayName:'SharedBoard Bridge',CFBundleShortVersionString:pkg.version,CFBundleVersion:pkg.version,LSMinimumSystemVersion:runtime.minimumOSVersion,LSUIElement:true,CFBundleURLTypes:[{CFBundleURLName:'app.sharedboard.bridge',CFBundleURLSchemes:['sharedboard-bridge'],CFBundleTypeRole:'Viewer'}]});
  writeFileSync(plist,JSON.stringify(info));execFileSync('/usr/bin/plutil',['-convert','xml1',plist]);
  const executable=path.join(app,'Contents/MacOS',info.CFBundleExecutable);
  const architectures=execFileSync('/usr/bin/lipo',['-archs',executable],{encoding:'utf8'}).trim().split(/\s+/);
  if(!architectures.includes(process.arch==='arm64'?'arm64':'x86_64'))throw new Error('The generated Mac application does not support its target architecture.');
  const loadCommands=execFileSync('/usr/bin/otool',['-l','-arch',process.arch==='arm64'?'arm64':'x86_64',executable],{encoding:'utf8'});
  const minimums=loadCommands.split(/Load command \d+/).flatMap(block=>/cmd LC_BUILD_VERSION\b/.test(block)?[block.match(/\bminos\s+([\d.]+)/)?.[1]]:/cmd LC_VERSION_MIN_MACOSX\b/.test(block)?[block.match(/\bversion\s+([\d.]+)/)?.[1]]:[]).filter(Boolean);
  const numeric=value=>value.split('.').reduce((total,part,index)=>total+Number(part)*1000**(2-index),0);
  if(!minimums.length||minimums.some(value=>numeric(value)>numeric(runtime.minimumOSVersion)))throw new Error('The generated Mac app requires a newer operating system than the documented minimum.');
  chmodSync(executable,0o755);
  // Ad-hoc signing seals bundle integrity; it is not Developer ID signing/notarization.
  // It does not change Gatekeeper or remove downloaded-file quarantine attributes.
  execFileSync('/usr/bin/codesign',['--force','--sign','-',app],{stdio:'pipe'});
  execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',app],{stdio:'pipe'});
  for(const name of macBridgeCommandFiles){copyFileSync(ordinaryFile(path.join(sourceRoot,'packaging/bridge-macos',name),sourceRoot),path.join(stageDirectory,name));chmodSync(path.join(stageDirectory,name),0o755);}
  copyFileSync(ordinaryFile(path.join(sourceRoot,'packaging/bridge-macos/README.txt'),sourceRoot),path.join(stageDirectory,'README.txt'));
  for(const name of ['LICENSE','AUTHORS.md'])copyFileSync(ordinaryFile(path.join(sourceRoot,name),sourceRoot),path.join(stageDirectory,name));
  const manifest={...prepared.manifest,files:listBridgePackageFiles(stageDirectory).map(file=>({path:file.name,sha256:hash(file.file),mode:lstatSync(file.file).mode&0o777}))};
  writeFileSync(path.join(stageDirectory,'package-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  return {app,files:listBridgePackageFiles(stageDirectory),manifest};
}

export async function packageBridge({output,runtimeCache,target=process.platform==='darwin'?`macos-${process.arch}`:'windows-x64'}={}){
  const runtime=bridgeRuntimePin(target),mac=target.startsWith('macos-');
  if(mac?(process.platform!=='darwin'||process.arch!==runtime.arch):process.platform!=='win32')throw new Error('Build each bridge package on its matching native operating system and architecture.');
  execFileSync(process.execPath,['scripts/release.mjs','check'],{cwd:root,stdio:'inherit'});
  const pkg=read('package.json');
  output=path.resolve(output??path.join(root,'..',`SharedBoard-Bridge-${pkg.version}-${target}.zip`));
  if(!output.toLowerCase().endsWith('.zip')||existsSync(output)||existsSync(`${output}.sha256`))throw new Error('Choose a new .zip output; release archives are never overwritten.');
  const cache=path.resolve(runtimeCache??path.join(os.tmpdir(),'sharedboard-bridge-runtime'));mkdirSync(cache,{recursive:true});
  const archive=path.join(cache,runtime.archive);
  if(!existsSync(archive)){const response=await fetch(runtime.url,{signal:AbortSignal.timeout(180000)});if(!response.ok)throw new Error('The official Node runtime download failed.');writeFileSync(archive,Buffer.from(await response.arrayBuffer()));}
  if(hash(archive)!==runtime.sha256)throw new Error('The bundled Node runtime failed its pinned checksum.');
  const stage=mkdtempSync(path.join(os.tmpdir(),'sharedboard-bridge-package-')),extracted=mkdtempSync(path.join(os.tmpdir(),'sharedboard-bridge-node-'));
  if(mac)execFileSync('/usr/bin/tar',['-xzf',archive,'-C',extracted],{stdio:'inherit'});
  else execFileSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command','Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory($env:SB_BRIDGE_ARCHIVE,$env:SB_BRIDGE_EXTRACT)'],{env:{...process.env,SB_BRIDGE_ARCHIVE:archive,SB_BRIDGE_EXTRACT:extracted},stdio:'inherit'});
  const runtimeDirectory=path.join(extracted,`node-v${runtime.version}-${mac?'darwin-'+runtime.arch:'win-x64'}`),runtimeNode=path.join(runtimeDirectory,mac?'bin/node':'node.exe');
  if(execFileSync(runtimeNode,['--version'],{encoding:'utf8'}).trim()!==`v${runtime.version}`)throw new Error('The runtime executable version does not match its pin.');
  const actual=execFileSync(runtimeNode,['-p','process.platform+"-"+process.arch'],{encoding:'utf8'}).trim();
  if(actual!==`${runtime.platform}-${runtime.arch}`)throw new Error('The runtime architecture does not match its package target.');
  const {files}=mac?prepareMacBridgeApp({runtimeDirectory,stageDirectory:stage,target}):prepareBridgeStage({runtimeDirectory,stageDirectory:stage,target});
  mkdirSync(path.dirname(output),{recursive:true});
  if(mac)execFileSync('/usr/bin/ditto',['-c','-k','--norsrc',stage,output],{stdio:'inherit'});else writeStaticZip(files,output);
  const sha256=hash(output);writeFileSync(`${output}.sha256`,`${sha256}  ${path.basename(output)}\n`,{flag:'wx'});
  const result={archive:output,sha256,stage,version:pkg.version,platform:target,files:files.length,boardDataIncluded:false};console.log(JSON.stringify(result,null,2));return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),options={};for(let i=0;i<args.length;i+=2){if(!args[i+1])throw new Error('Each packaging option requires a value.');if(args[i]==='--output')options.output=args[i+1];else if(args[i]==='--runtime-cache')options.runtimeCache=args[i+1];else if(args[i]==='--target')options.target=args[i+1];else throw new Error('Use --output <zip>, --runtime-cache <directory>, or --target windows-x64|macos-arm64|macos-x64.');}await packageBridge(options);
}
