// Copyright (c) 2026 Andrew Barresi. SPDX-License-Identifier: MIT
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildPlugin} from '../plugins/claude-code/scripts/build.mjs';
import {writeStaticZip} from './package-web.mjs';
import {collectBrowserLicenses,listStaticFiles,projectRoot} from './build-web.mjs';

export function claudeMarketplace({version,sha256}){
  if(!/^\d+\.\d+\.\d+$/.test(version)||! /^[a-f0-9]{64}$/.test(sha256))throw new Error('A version and verified archive digest are required.');
  return {
    name:'sharedboard',owner:{name:'Andrew Barresi'},
    metadata:{description:'Connect your running Claude Code session to SharedBoard.app.',version},
    plugins:[{name:'sharedboard',version,description:'Browser-saved boards and automatic messages through a Claude Code Channels plugin. Research preview; Node 22 or later required.',
      source:{source:'archive',url:`https://sharedboard.app/claude/sharedboard-${version}.zip`,sha256}}],
  };
}

export async function buildClaudePluginAssets(directory){
  const root=path.resolve(directory),release=JSON.parse(await readFile(path.join(projectRoot,'releases.json'),'utf8'));
  const temporary=await mkdtemp(path.join(tmpdir(),'sharedboard-claude-build-'));
  try{
    await buildPlugin(temporary);
    for(const name of ['package.json','.claude-plugin/plugin.json']){
      const location=path.join(temporary,name),manifest=JSON.parse(await readFile(location,'utf8'));
      if(manifest.version!==release.version)throw new Error('The plugin version must match the recorded application release.');
    }
    collectBrowserLicenses(temporary,{dependencyNames:['@modelcontextprotocol/sdk-v1','zod'],distribution:'Claude Code plugin'});
    const files=listStaticFiles(temporary);
    if(files.some(file=>file.name.includes('node_modules/')||/\.(?:exe|log|token|map)$/i.test(file.name)))throw new Error('The plugin archive contains an unexpected development artifact.');
    await mkdir(path.join(root,'claude'),{recursive:true});
    const archive=path.join(root,'claude',`sharedboard-${release.version}.zip`);
    writeStaticZip(files,archive);
    const sha256=createHash('sha256').update(await readFile(archive)).digest('hex');
    await writeFile(path.join(root,'claude-marketplace.json'),JSON.stringify(claudeMarketplace({version:release.version,sha256}),null,2)+'\n');
    return {version:release.version,archive,sha256,files:files.length};
  }finally{
    const relative=path.relative(path.resolve(tmpdir()),temporary);
    if(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(temporary).startsWith('sharedboard-claude-build-'))await rm(temporary,{recursive:true});
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==3)throw new Error('Supply the website output directory.');
  console.log(JSON.stringify(await buildClaudePluginAssets(process.argv[2]),null,2));
}
