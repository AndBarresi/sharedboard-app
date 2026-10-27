import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const read=name=>JSON.parse(readFileSync(path.join(root,name),'utf8'));
const write=(name,value)=>writeFileSync(path.join(root,name),`${JSON.stringify(value,null,2)}\n`);
function fingerprint(){
  const hash=createHash('sha256');
  const walk=directory=>{for(const item of readdirSync(path.join(root,directory),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const name=`${directory}/${item.name}`;if(item.isDirectory())walk(name);else{hash.update(name);hash.update(readFileSync(path.join(root,name)));}}};
  for(const directory of ['src','server','shared','scripts','packaging','hosting','.github','bridge'])walk(directory);
  for(const name of ['index.html','vite.config.mjs','pnpm-lock.yaml','.node-version','.gitattributes','LICENSE','AUTHORS.md']){try{hash.update(name);hash.update(readFileSync(path.join(root,name)));}catch(error){if(error.code!=='ENOENT')throw error;}}
  const pkg=read('package.json');hash.update(JSON.stringify({scripts:pkg.scripts,dependencies:pkg.dependencies,devDependencies:pkg.devDependencies}));return hash.digest('hex');
}
function markdown(releases){return '# SharedBoard.app changelog\n\n'+releases.entries.map(entry=>`## ${entry.version} — ${entry.title}\n\n${entry.added?.length?'### Added\n\n'+entry.added.map(text=>`- ${text}`).join('\n')+'\n\n':''}${entry.fixed?.length?'### Fixed\n\n'+entry.fixed.map(text=>`- ${text}`).join('\n')+'\n\n':''}`).join('');}
const [action,...args]=process.argv.slice(2),releases=read('releases.json');
if(action==='check'){
  let notes='';try{notes=readFileSync(path.join(root,'CHANGELOG.md'),'utf8');}catch{}
  if(read('package.json').version!==releases.version||releases.entries[0]?.version!==releases.version||releases.sourceHash!==fingerprint()||notes!==markdown(releases)){console.error('Application changes need a version and changelog entry. Run pnpm change patch|minor "Change title" --added "What changed" [--fixed "What was fixed"].');process.exitCode=1;}else console.log(`SharedBoard.app ${releases.version}: version and changelog match the source.`);
}else if(action==='record'||action==='stamp'){
  if(action==='record'){
    const [kind,title,...details]=args;if(!['patch','minor','major'].includes(kind)||!title?.trim())throw new Error('Use record patch|minor|major "Title" --added "Change" --fixed "Fix".');
    const version=releases.version.split('.').map(Number);if(kind==='major'){version[0]++;version[1]=version[2]=0;}else if(kind==='minor'){version[1]++;version[2]=0;}else version[2]++;
    const entry={version:version.join('.'),title,added:[],fixed:[]};
    for(let i=0;i<details.length;i+=2){const key=details[i]==='--added'?'added':details[i]==='--fixed'?'fixed':null;if(!key||!details[i+1]?.trim())throw new Error('Every change must use --added or --fixed followed by its description.');entry[key].push(details[i+1]);}
    if(!entry.added.length&&!entry.fixed.length)throw new Error('Describe at least one change.');releases.version=entry.version;releases.entries.unshift(entry);
  }
  const pkg=read('package.json');pkg.version=releases.version;write('package.json',pkg);releases.sourceHash=fingerprint();write('releases.json',releases);writeFileSync(path.join(root,'CHANGELOG.md'),markdown(releases));console.log(`Recorded SharedBoard.app ${releases.version}.`);
}else throw new Error('Use check or record. stamp is reserved for initial version setup.');
