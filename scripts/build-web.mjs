import {cpSync,copyFileSync,existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,realpathSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

export const projectRoot=fileURLToPath(new URL('../',import.meta.url));
export const webDirectory=path.join(projectRoot,'dist-web');
export const pagesAssetLimit=25*1024*1024;
const read=name=>JSON.parse(readFileSync(path.join(projectRoot,name),'utf8'));

export function listStaticFiles(directory,prefix=''){
  const output=[];
  for(const item of readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
    const file=path.join(directory,item.name),name=prefix?`${prefix}/${item.name}`:item.name,stat=lstatSync(file);
    if(stat.isSymbolicLink())throw new Error(`Static builds cannot contain filesystem links: ${name}`);
    if(stat.isDirectory())output.push(...listStaticFiles(file,name));else if(stat.isFile())output.push({name,file,size:stat.size});else throw new Error(`Unexpected static file type: ${name}`);
  }
  return output;
}

export function validateWebBuild(directory=webDirectory,{version,sourceHash,maxFiles=1000}={}){
  const release=read('releases.json');version??=release.version;sourceHash??=release.sourceHash;
  for(const file of ['index.html','404.html','_headers','_redirects','build-info.json'])if(!existsSync(path.join(directory,file)))throw new Error(`Static build is incomplete: ${file} is missing. Run pnpm run build:web.`);
  const info=JSON.parse(readFileSync(path.join(directory,'build-info.json'),'utf8'));
  if(info.version!==version||info.sourceHash!==sourceHash||info.storageMode!=='browser')throw new Error('The browser build is stale or uses local-server storage. Run pnpm run build:web.');
  const files=listStaticFiles(directory);
  if(files.length>maxFiles)throw new Error(`The static build has ${files.length} files; the configured upload limit is ${maxFiles}. Dashboard uploads support 1,000 files; Wrangler supports 20,000.`);
  for(const {name,size} of files){
    if(size>pagesAssetLimit)throw new Error(`Cloudflare Pages assets must be at most 25 MiB: ${name}`);
    if(/(^|\/)(server|data|node_modules|functions|\.git|\.wrangler|connector-runtime)(\/|$)/i.test(name)||/(^|\/)(\.env(?:\..*)?|\.token|\.connection\.json|ai-connection\.json|agent-target\.json|\.agent-session[^/]*|_worker\.js)$/i.test(name)||/\.(log|map|exe|ps1|cmd)$/i.test(name))throw new Error(`Server, private or development artifact in static build: ${name}`);
  }
  if(!readFileSync(path.join(directory,'_redirects'),'utf8').includes('/boards/* / 200'))throw new Error('The browser build is missing its canonical board route rewrite.');
  return {files,version:info.version,sourceHash:info.sourceHash,totalBytes:files.reduce((total,file)=>total+file.size,0),largestFile:files.reduce((largest,file)=>file.size>largest.size?{name:file.name,size:file.size}:largest,{name:null,size:0})};
}

export function installPagesFiles(directory=webDirectory){
  for(const name of ['_redirects','404.html'])copyFileSync(path.join(projectRoot,'hosting/cloudflare-pages',name),path.join(directory,name));
  const html=readFileSync(path.join(directory,'index.html'),'utf8'),hashes=[];
  for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))if(!/\bsrc\s*=/i.test(match[1])&&match[2])hashes.push(`'sha256-${createHash('sha256').update(match[2]).digest('base64')}'`);
  const policy=["default-src 'self'",`script-src 'self' 'wasm-unsafe-eval' ${hashes.join(' ')}`.trim(),"style-src 'self' 'unsafe-inline'","img-src 'self' data: blob:","font-src 'self' data:","connect-src 'self' http://127.0.0.1:4319","worker-src 'self' blob:","object-src 'none'","base-uri 'self'","form-action 'self'","frame-ancestors 'none'"].join('; ');
  writeFileSync(path.join(directory,'_headers'),`/*\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Referrer-Policy: no-referrer\n  Cross-Origin-Opener-Policy: same-origin\n  Cross-Origin-Resource-Policy: same-origin\n  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()\n  Content-Security-Policy: ${policy}\n`);
}

export function collectBrowserLicenses(directory){
  const pkg=read('package.json'),seen=new Set(),queue=Object.keys(pkg.dependencies).map(name=>({name,from:projectRoot,optional:false})),packages=[];
  while(queue.length){
    const requested=queue.shift(),lookup=createRequire(path.join(requested.from,'package.json')).resolve.paths(requested.name)??[];
    const manifestFile=lookup.map(directory=>path.join(directory,...requested.name.split('/'),'package.json')).find(file=>existsSync(file));
    if(!manifestFile){if(requested.optional)continue;throw new Error(`Installed dependency ${requested.name} is missing. Run pnpm install --frozen-lockfile.`);}
    const source=realpathSync(path.dirname(manifestFile)),manifest=JSON.parse(readFileSync(path.join(source,'package.json'),'utf8')),key=`${manifest.name}@${manifest.version}`;
    if(seen.has(key))continue;seen.add(key);packages.push({source,manifest});
    for(const name of Object.keys({...manifest.dependencies,...manifest.optionalDependencies}))queue.push({name,from:source,optional:Boolean(manifest.optionalDependencies?.[name])});
    for(const name of Object.keys(manifest.peerDependencies??{}))queue.push({name,from:source,optional:true});
  }
  const licenses=path.join(directory,'licenses');mkdirSync(path.join(licenses,'packages'),{recursive:true});
  for(const name of ['LICENSE','AUTHORS.md'])copyFileSync(path.join(projectRoot,name),path.join(directory,name));
  cpSync(path.join(projectRoot,'packaging/licenses'),path.join(licenses,'supplemental'),{recursive:true});
  const supplemental=read('packaging/licenses/sources.json'),inventory=[];
  for(const {source,manifest} of packages.sort((a,b)=>a.manifest.name.localeCompare(b.manifest.name)||a.manifest.version.localeCompare(b.manifest.version))){
    const {name,version,license}=manifest,id=`${name.replace(/[^a-z0-9._-]/gi,'_')}-${version}`;
    const files=readdirSync(source).filter(file=>/^(licen[cs]e|copying|notice|copyright|ofl)([._-]|$)/i.test(file)&&lstatSync(path.join(source,file)).isFile());
    const supplements=supplemental.packages.filter(p=>(p.name===name||p.namePrefix&&name.startsWith(p.namePrefix))&&(!p.version||p.version===version)&&(!p.versions||p.versions.some(v=>typeof v==='string'?v===version:v.name===name&&v.version===version)));
    if(!files.length&&!supplements.length)throw new Error(`No license text was collected for ${name}@${version}.`);
    const destination=path.join(licenses,'packages',id);mkdirSync(destination,{recursive:true});
    for(const file of files)copyFileSync(path.join(source,file),path.join(destination,file));
    inventory.push({name,version,license:license??null,files:files.map(file=>`packages/${id}/${file}`),supplementalFiles:supplements.flatMap(s=>s.files.map(file=>`supplemental/${file}`))});
  }
  writeFileSync(path.join(licenses,'inventory.json'),JSON.stringify({packages:inventory,fonts:supplemental.fonts},null,2)+'\n');
  writeFileSync(path.join(directory,'THIRD_PARTY_NOTICES.md'),'# SharedBoard.app browser build notices\n\nSharedBoard.app is created by Andrew Barresi and released under the MIT license; see LICENSE and AUTHORS.md.\n\nThis static build incorporates the open-source Excalidraw editor, React, Zod and their dependencies. The licenses/ directory contains license and copyright texts collected from the project production dependency closure, including supplemental notices and exact font licenses. Some notices describe components used only by the separate local application.\n\n- licenses/inventory.json lists installed package versions and notice locations.\n- licenses/packages/ contains installed dependency notices.\n- licenses/supplemental/ contains upstream notices and font provenance in sources.json.\n\nThird-party components retain their respective licenses.\n');
}

export function buildWeb(){
  execFileSync(process.execPath,['scripts/release.mjs','check'],{cwd:projectRoot,stdio:'inherit'});
  const env={...process.env,VITE_STORAGE_MODE:'browser'};
  execFileSync(process.execPath,[path.join(projectRoot,'node_modules/vite/bin/vite.js'),'build'],{cwd:projectRoot,env,stdio:'inherit'});
  execFileSync(process.execPath,['scripts/copy-assets.mjs'],{cwd:projectRoot,env,stdio:'inherit'});
  installPagesFiles();collectBrowserLicenses(webDirectory);
  const result=validateWebBuild();console.log(JSON.stringify({product:'SharedBoard.app',storageMode:'browser',directory:webDirectory,version:result.version,files:result.files.length,totalBytes:result.totalBytes,largestFile:result.largestFile},null,2));return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))buildWeb();
