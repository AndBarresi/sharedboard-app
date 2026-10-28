// Copyright (c) 2026 Andrew Barresi. SPDX-License-Identifier: MIT
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildPlugin} from '../plugins/codex/scripts/build.mjs';
import {writeStaticZip} from './package-web.mjs';
import {collectBrowserLicenses,listStaticFiles,projectRoot} from './build-web.mjs';

export function codexMarketplace(){return {
  name:'sharedboard',interface:{displayName:'SharedBoard.app'},
  plugins:[{name:'sharedboard',source:{source:'git-subdir',url:'https://github.com/AndBarresi/sharedboard-app.git',path:'./plugin-dist/codex',ref:'codex/plugin-dist'},policy:{installation:'AVAILABLE',authentication:'ON_INSTALL'},category:'Productivity'}],
};}

export async function stageCodexPlugin(directory){
  const release=JSON.parse(await readFile(path.join(projectRoot,'releases.json'),'utf8'));
  await buildPlugin(directory);
  for(const name of ['package.json','plugin.json'])if(JSON.parse(await readFile(path.join(directory,name),'utf8')).version!==release.version)throw new Error('The Codex plugin version must match the recorded application release.');
  collectBrowserLicenses(directory,{dependencyNames:['@modelcontextprotocol/sdk-v1','zod'],distribution:'Codex plugin'});
  return {directory,version:release.version,files:listStaticFiles(directory)};
}

export async function buildCodexPluginAssets(directory){
  const root=path.resolve(directory),temporary=await mkdtemp(path.join(tmpdir(),'sharedboard-codex-build-'));
  try{
    const staged=await stageCodexPlugin(temporary);
    if(staged.files.some(file=>file.name.includes('node_modules/')||/\.(?:exe|log|token|map)$/i.test(file.name)))throw new Error('The plugin archive contains an unexpected development artifact.');
    await mkdir(path.join(root,'codex'),{recursive:true});
    const archive=path.join(root,'codex',`sharedboard-${staged.version}.zip`);writeStaticZip(staged.files,archive);
    const sha256=createHash('sha256').update(await readFile(archive)).digest('hex');
    await writeFile(path.join(root,'codex-marketplace.json'),JSON.stringify(codexMarketplace(),null,2)+'\n');
    return {version:staged.version,archive,sha256,files:staged.files.length};
  }finally{
    const relative=path.relative(path.resolve(tmpdir()),temporary);
    if(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(temporary).startsWith('sharedboard-codex-build-'))await rm(temporary,{recursive:true});
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==3)throw new Error('Supply the website output directory.');
  console.log(JSON.stringify(await buildCodexPluginAssets(process.argv[2]),null,2));
}
