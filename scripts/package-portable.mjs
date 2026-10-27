import {cpSync,copyFileSync,existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,realpathSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';

const root=fileURLToPath(new URL('../',import.meta.url));
const read=name=>JSON.parse(readFileSync(path.join(root,name),'utf8'));
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const json=(file,value)=>writeFileSync(file,`${JSON.stringify(value,null,2)}\n`);
const argumentsMap=new Map();
for(let i=2;i<process.argv.length;i+=2){if(!['--output','--runtime-cache'].includes(process.argv[i])||!process.argv[i+1])throw new Error('Use --output <zip path> and/or --runtime-cache <directory>.');argumentsMap.set(process.argv[i],process.argv[i+1]);}
if(process.platform!=='win32')throw new Error('Build this Windows portable package on Windows.');
execFileSync(process.execPath,['scripts/release.mjs','check'],{cwd:root,stdio:'inherit'});
const pkg=read('package.json'),release=read('releases.json'),runtime=read('packaging/runtime.json');
const build=read('dist/build-info.json');
if(build.version!==pkg.version||build.sourceHash!==release.sourceHash)throw new Error('The built app is stale. Run pnpm build before packaging.');
const output=path.resolve(argumentsMap.get('--output')??path.join(root,'..',`SharedBoard.app-${pkg.version}-windows-x64.zip`));
if(!output.toLowerCase().endsWith('.zip'))throw new Error('The package output must be a ZIP file.');
if(existsSync(output))throw new Error('That ZIP already exists. Choose a new output filename; release archives are not overwritten.');
mkdirSync(path.dirname(output),{recursive:true});
const cache=path.resolve(argumentsMap.get('--runtime-cache')??path.join(os.tmpdir(),'sharedboard-app-runtime'));
mkdirSync(cache,{recursive:true});
const archive=path.join(cache,runtime.archive);
if(!existsSync(archive)){
  console.log('Downloading the official Windows Node runtime for the package…');
  const response=await fetch(runtime.url,{signal:AbortSignal.timeout(180000)});
  if(!response.ok)throw new Error(`Runtime download returned HTTP ${response.status}.`);
  writeFileSync(archive,Buffer.from(await response.arrayBuffer()));
}
if(hash(archive)!==runtime.sha256)throw new Error('The Node runtime archive failed its pinned SHA-256 check.');
const stage=mkdtempSync(path.join(os.tmpdir(),'sharedboard-app-package-'));
const extracted=mkdtempSync(path.join(os.tmpdir(),'sharedboard-app-node-'));
const powershell=(command,environment={})=>execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{env:{...process.env,...environment},stdio:'inherit'});
powershell('Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory($env:SB_RUNTIME_ARCHIVE,$env:SB_RUNTIME_EXTRACT)',{SB_RUNTIME_ARCHIVE:archive,SB_RUNTIME_EXTRACT:extracted});
const nodeDirectory=path.join(extracted,`node-v${runtime.version}-win-x64`);
mkdirSync(path.join(stage,'runtime'));
for(const name of ['node.exe','LICENSE','README.md'])copyFileSync(path.join(nodeDirectory,name),path.join(stage,'runtime',name));
const actualVersion=execFileSync(path.join(stage,'runtime/node.exe'),['--version'],{encoding:'utf8'}).trim();
if(actualVersion!==`v${runtime.version}`)throw new Error('The bundled executable version does not match the pinned runtime.');
const app=path.join(stage,'app');mkdirSync(app);
function rejectSourceLinks(directory){for(const entry of readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(lstatSync(file).isSymbolicLink())throw new Error('First-party release sources cannot contain filesystem links.');if(entry.isDirectory())rejectSourceLinks(file);}}
for(const directory of ['server','shared','dist','packaging'])rejectSourceLinks(path.join(root,directory));
for(const directory of ['server','shared','dist'])cpSync(path.join(root,directory),path.join(app,directory),{recursive:true});
copyFileSync(path.join(root,'releases.json'),path.join(app,'releases.json'));
const modules=read('node_modules/.package-map.json').packages;
function closure(names){
  const seen=new Map(),queue=names.map(name=>modules['.'].dependencies[name]);
  while(queue.length){
    const key=queue.shift();if(seen.has(key))continue;
    const entry=modules[key];if(!entry)throw new Error(`Installed dependency is missing from the pnpm map: ${key}`);
    const directory=realpathSync(path.resolve(root,'node_modules',entry.url));
    const manifest=JSON.parse(readFileSync(path.join(directory,'package.json'),'utf8'));
    seen.set(key,{key,directory,manifest});
    for(const name of Object.keys(manifest.dependencies??{})){if(!entry.dependencies[name])throw new Error(`Unresolved dependency ${manifest.name}: ${name}`);queue.push(entry.dependencies[name]);}
    for(const name of Object.keys(manifest.peerDependencies??{}))if(entry.dependencies[name])queue.push(entry.dependencies[name]);
  }
  return [...seen.values()].sort((a,b)=>a.key.localeCompare(b.key));
}
const backendNames=['@modelcontextprotocol/server','zod'],backend=closure(backendNames),copiedNames=new Map();
for(const item of backend){
  const {name,version}=item.manifest;
  if(copiedNames.has(name)&&copiedNames.get(name)!==version)throw new Error(`Runtime dependencies need isolated versions for ${name}.`);
  copiedNames.set(name,version);
  const destination=path.join(app,'node_modules',...name.split('/'));
  cpSync(item.directory,destination,{recursive:true,dereference:true,filter:source=>path.basename(source)!=='node_modules'&&!source.endsWith('.map')});
}
json(path.join(app,'package.json'),{name:'sharedboard-app',version:pkg.version,private:true,type:'module',author:pkg.author,license:pkg.license,homepage:pkg.homepage,dependencies:Object.fromEntries(backendNames.map(name=>[name,pkg.dependencies[name]]))});
mkdirSync(path.join(stage,'scripts'));
copyFileSync(path.join(root,'scripts/portable.ps1'),path.join(stage,'scripts/portable.ps1'));
for(const name of readdirSync(path.join(root,'packaging/windows'))){if(!name.endsWith('.cmd'))throw new Error('Only launcher CMD files belong in packaging/windows.');copyFileSync(path.join(root,'packaging/windows',name),path.join(stage,name));}
for(const name of readdirSync(path.join(root,'packaging/docs')))writeFileSync(path.join(stage,name),readFileSync(path.join(root,'packaging/docs',name),'utf8').replaceAll('{{VERSION}}',pkg.version));
for(const name of ['CHANGELOG.md','THIRD_PARTY_NOTICES.md','LICENSE','AUTHORS.md'])copyFileSync(path.join(root,name),path.join(stage,name));
cpSync(path.join(root,'packaging/licenses'),path.join(stage,'licenses/supplemental'),{recursive:true});
const supplemental=read('packaging/licenses/sources.json');
for(const item of [...supplemental.packages,...supplemental.fonts])for(const source of item.provenance??[]){
  const file=path.join(root,'packaging/licenses',source.path);
  if(hash(file)!==source.sha256)throw new Error('A supplemental license no longer matches its recorded provenance.');
}
for(const font of supplemental.fonts)for(const file of font.bundledFiles){
  if(hash(path.join(app,'dist/excalidraw/fonts',font.family,file.name))!==file.sha256)throw new Error(`Font license provenance does not match the bundled ${font.family} asset.`);
}
const licenseRoot=path.join(stage,'licenses/packages');mkdirSync(licenseRoot,{recursive:true});
const inventory=[];
for(const item of closure(Object.keys(pkg.dependencies))){
  const {name,version,license}=item.manifest;
  const identifier=`${name.replace(/[^a-z0-9._-]/gi,'_')}-${version}`;
  const files=readdirSync(item.directory).filter(name=>/^(licen[cs]e|copying|notice|copyright|ofl)([._-]|$)/i.test(name)&&lstatSync(path.join(item.directory,name)).isFile());
  const supplements=supplemental.packages.filter(p=>(p.name===name||p.namePrefix&&name.startsWith(p.namePrefix))&&(!p.version||p.version===version)&&(!p.versions||p.versions.some(value=>typeof value==='string'?value===version:value.name===name&&value.version===version)));
  if(!files.length&&!supplements.length)throw new Error(`No license text was collected for ${name}@${version}.`);
  const destination=path.join(licenseRoot,identifier);mkdirSync(destination,{recursive:true});
  for(const file of files)copyFileSync(path.join(item.directory,file),path.join(destination,file));
  inventory.push({name,version,license:license??null,files:files.map(file=>`packages/${identifier}/${file}`),supplementalFiles:supplements.flatMap(s=>s.files.map(file=>`supplemental/${file}`))});
}
copyFileSync(path.join(stage,'runtime/LICENSE'),path.join(stage,'licenses/NODE-LICENSE.txt'));
json(path.join(stage,'licenses/inventory.json'),{packages:inventory,fonts:supplemental.fonts,node:{version:runtime.version,file:'NODE-LICENSE.txt',source:runtime.url}});
json(path.join(stage,'package-manifest.json'),{product:'SharedBoard.app',version:pkg.version,channel:'local-testing',platform:'windows-x64',nodeVersion:runtime.version,nodeArchiveSha256:runtime.sha256,sourceHash:release.sourceHash,webConnectors:'locked-wip',localConnections:['codex','claude-code','cursor','mcp'],personalDataIncluded:false,backendPackages:backend.map(p=>({name:p.manifest.name,version:p.manifest.version})),dependencyNoticeCount:inventory.length});
function filesWithin(directory,prefix=''){
  const files=[];
  for(const entry of readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
    const name=prefix?`${prefix}/${entry.name}`:entry.name,file=path.join(directory,entry.name);
    if(lstatSync(file).isSymbolicLink())throw new Error(`Portable packages cannot contain filesystem links: ${name}`);
    if(entry.isDirectory())files.push(...filesWithin(file,name));else files.push({name,file});
  }
  return files;
}
const files=filesWithin(stage);
const privateHome=os.homedir(),privatePaths=[privateHome,privateHome.replaceAll('\\','/'),privateHome.replaceAll('\\','\\\\')].map(value=>Buffer.from(value.toLowerCase()));
for(const {name,file} of files){
  if(/(^|\/)(data|\.git|connector-runtime|\.token|\.connection\.json|ai-connection\.json|agent-target\.json|\.agent-session[^/]*)(\/|$)/i.test(name)||/\.(log|map)$/i.test(name))throw new Error(`Private or development artifact excluded from releases: ${name}`);
  if(/\.(mjs|cjs|js|json|html|css|ps1|cmd|md|txt)$/i.test(name)){const contents=Buffer.from(readFileSync(file,'utf8').toLowerCase());if(privatePaths.some(value=>contents.includes(value)))throw new Error(`A developer machine path was found in ${name}.`);}
}
writeFileSync(path.join(stage,'SHA256SUMS.txt'),files.map(({name,file})=>`${hash(file)}  ${name}`).join('\n')+'\n');
powershell('Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory($env:SB_PACKAGE_STAGE,$env:SB_PACKAGE_ZIP,[IO.Compression.CompressionLevel]::Optimal,$false)',{SB_PACKAGE_STAGE:stage,SB_PACKAGE_ZIP:output});
const checksum=hash(output);writeFileSync(`${output}.sha256`,`${checksum}  ${path.basename(output)}\n`);
console.log(JSON.stringify({archive:output,sha256:checksum,stage,version:pkg.version,bundledRuntime:actualVersion,backendPackages:backend.length,dependencyNotices:inventory.length},null,2));
