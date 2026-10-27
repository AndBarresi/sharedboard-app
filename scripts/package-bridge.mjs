// SharedBoard.app — Andrew Barresi (https://github.com/AndBarresi). MIT.
import {copyFileSync,existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
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
export function prepareBridgeStage({sourceRoot=root,runtimeDirectory,stageDirectory,sourceHash}={}){
  sourceRoot=path.resolve(sourceRoot);stageDirectory=path.resolve(stageDirectory);
  if(!runtimeDirectory)throw new Error('A verified runtime folder is required.');
  runtimeDirectory=path.resolve(runtimeDirectory);
  if(readdirSync(stageDirectory).length)throw new Error('Bridge staging requires a new empty folder.');
  const pkg=JSON.parse(readFileSync(ordinaryFile(path.join(sourceRoot,'package.json'),sourceRoot),'utf8'));
  const runtime=JSON.parse(readFileSync(ordinaryFile(path.join(sourceRoot,'packaging/runtime.json'),sourceRoot),'utf8'));
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
  for(const name of ['node.exe','LICENSE','README.md'])copyFileSync(ordinaryFile(path.join(runtimeDirectory,name),runtimeDirectory),path.join(stageDirectory,'runtime',name));
  mkdirSync(path.join(stageDirectory,'app/bridge'),{recursive:true});
  for(const name of bridgeSourceFiles)copyFileSync(ordinaryFile(path.join(sourceRoot,'bridge',name),sourceRoot),path.join(stageDirectory,'app/bridge',name));
  writeFileSync(path.join(stageDirectory,'app/package.json'),JSON.stringify({name:'sharedboard-bridge',version:pkg.version,private:true,type:'module',author:pkg.author,license:'MIT',homepage:pkg.homepage})+'\n');
  for(const name of bridgeLauncherFiles)copyFileSync(ordinaryFile(path.join(sourceRoot,'packaging/bridge',name),sourceRoot),path.join(stageDirectory,name));
  for(const name of ['LICENSE','AUTHORS.md'])copyFileSync(ordinaryFile(path.join(sourceRoot,name),sourceRoot),path.join(stageDirectory,name));
  const files=listBridgePackageFiles(stageDirectory);
  const manifest={product:'SharedBoard Bridge',version:pkg.version,sourceHash,platform:'windows-x64',nodeVersion:runtime.version,author:pkg.author,license:'MIT',homepage:pkg.homepage,files:files.map(file=>({path:file.name,sha256:hash(file.file)}))};
  writeFileSync(path.join(stageDirectory,'package-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  return {files:listBridgePackageFiles(stageDirectory),manifest};
}
export async function packageBridge({output,runtimeCache}={}){
  if(process.platform!=='win32')throw new Error('Build the Windows bridge package on Windows.');
  execFileSync(process.execPath,['scripts/release.mjs','check'],{cwd:root,stdio:'inherit'});
  const pkg=read('package.json'),runtime=read('packaging/runtime.json');
  output=path.resolve(output??path.join(root,'..',`SharedBoard-Bridge-${pkg.version}-windows-x64.zip`));
  if(!output.toLowerCase().endsWith('.zip')||existsSync(output)||existsSync(`${output}.sha256`))throw new Error('Choose a new .zip output; release archives are never overwritten.');
  const cache=path.resolve(runtimeCache??path.join(os.tmpdir(),'sharedboard-bridge-runtime'));mkdirSync(cache,{recursive:true});
  const archive=path.join(cache,runtime.archive);
  if(!existsSync(archive)){const response=await fetch(runtime.url,{signal:AbortSignal.timeout(180000)});if(!response.ok)throw new Error('The official Node runtime download failed.');writeFileSync(archive,Buffer.from(await response.arrayBuffer()));}
  if(hash(archive)!==runtime.sha256)throw new Error('The bundled Node runtime failed its pinned checksum.');
  const stage=mkdtempSync(path.join(os.tmpdir(),'sharedboard-bridge-package-')),extracted=mkdtempSync(path.join(os.tmpdir(),'sharedboard-bridge-node-'));
  execFileSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command','Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory($env:SB_BRIDGE_ARCHIVE,$env:SB_BRIDGE_EXTRACT)'],{env:{...process.env,SB_BRIDGE_ARCHIVE:archive,SB_BRIDGE_EXTRACT:extracted},stdio:'inherit'});
  const runtimeDirectory=path.join(extracted,`node-v${runtime.version}-win-x64`);
  if(execFileSync(path.join(runtimeDirectory,'node.exe'),['--version'],{encoding:'utf8'}).trim()!==`v${runtime.version}`)throw new Error('The runtime executable version does not match its pin.');
  const {files}=prepareBridgeStage({runtimeDirectory,stageDirectory:stage});
  mkdirSync(path.dirname(output),{recursive:true});writeStaticZip(files,output);
  const sha256=hash(output);writeFileSync(`${output}.sha256`,`${sha256}  ${path.basename(output)}\n`,{flag:'wx'});
  const result={archive:output,sha256,stage,version:pkg.version,files:files.length,boardDataIncluded:false};console.log(JSON.stringify(result,null,2));return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),options={};for(let i=0;i<args.length;i+=2){if(!args[i+1])throw new Error('Each packaging option requires a value.');if(args[i]==='--output')options.output=args[i+1];else if(args[i]==='--runtime-cache')options.runtimeCache=args[i+1];else throw new Error('Use --output <zip> or --runtime-cache <directory>.');}await packageBridge(options);
}
