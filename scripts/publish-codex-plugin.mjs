// Copyright (c) 2026 Andrew Barresi. SPDX-License-Identifier: MIT
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {stageCodexPlugin} from './build-codex-plugin.mjs';
import {listStaticFiles,projectRoot} from './build-web.mjs';

const branch='codex/plugin-dist';
const publicOrigins=new Set(['https://github.com/AndBarresi/sharedboard-app.git','https://github.com/AndBarresi/sharedboard-app','git@github.com:AndBarresi/sharedboard-app.git']);
const git=(args,options={})=>execFileSync('git',args,{cwd:projectRoot,encoding:'utf8',maxBuffer:8_000_000,windowsHide:true,...options}).trim();

// A separate temporary index changes no checkout, staged user files, or local branch.
export async function publishCodexDirectory(directory,{repoRoot=projectRoot,allowTestRemote=false}={}){
  const origin=git(['remote','get-url','origin'],{cwd:repoRoot});
  if(!publicOrigins.has(origin)&&!allowTestRemote)throw new Error('The plugin can only be published to the SharedBoard.app repository.');
  const files=listStaticFiles(directory);
  if(!files.some(file=>file.name==='plugin.json')||!files.some(file=>file.name==='src/main.mjs')||files.some(file=>! /^[a-zA-Z0-9._/-]+$/.test(file.name)||file.name.split('/').some(part=>part==='..')||/(^|\/)(\.env|\.git|node_modules|data)(\/|$)/i.test(file.name)||/\.(?:token|log|exe|map)$/i.test(file.name)))throw new Error('The plugin staging directory contains unexpected files.');
  const temporary=await mkdtemp(path.join(tmpdir(),'sharedboard-codex-index-'));
  try{
    const refs=git(['ls-remote','--heads','origin',`refs/heads/${branch}`],{cwd:repoRoot}),parent=refs?refs.split(/\s/)[0]:null;
    if(parent)git(['fetch','--no-write-fetch-head','origin',`refs/heads/${branch}`],{cwd:repoRoot});
    const env={...process.env,GIT_INDEX_FILE:path.join(temporary,'index')},sourceHead=git(['rev-parse','HEAD'],{cwd:repoRoot});
    // Keep the website project valid on this generated branch as well. Pages
    // may build branch previews; only this subdirectory is installed by Codex.
    git(['read-tree',sourceHead],{cwd:repoRoot,env});
    const entries=[];
    for(const file of files){const digest=git(['hash-object','-w','--stdin'],{cwd:repoRoot,input:await readFile(file.file)});entries.push(`100644 ${digest}\tplugin-dist/codex/${file.name}\n`);}
    git(['update-index','--index-info'],{cwd:repoRoot,env,input:entries.join('')});
    const tree=git(['write-tree'],{cwd:repoRoot,env});
    if(parent&&git(['rev-parse',`${parent}^{tree}`],{cwd:repoRoot})===tree)return {published:false,commit:parent,branch};
    const version=JSON.parse(await readFile(path.join(directory,'plugin.json'),'utf8')).version;
    const commit=git(['commit-tree',tree,'-p',parent??sourceHead,'-m',`SharedBoard.app Codex plugin ${version} from ${sourceHead}`],{cwd:repoRoot});
    git(['push','origin',`${commit}:refs/heads/${branch}`],{cwd:repoRoot});
    return {published:true,commit,branch,version};
  }finally{
    const relative=path.relative(path.resolve(tmpdir()),temporary);
    if(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(temporary).startsWith('sharedboard-codex-index-'))await rm(temporary,{recursive:true});
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==3||process.argv[2]!=='--publish')throw new Error('Use --publish to explicitly publish the built plugin artifact.');
  const temporary=await mkdtemp(path.join(tmpdir(),'sharedboard-codex-publish-'));
  try{await stageCodexPlugin(temporary);console.log(JSON.stringify(await publishCodexDirectory(temporary),null,2));}
  finally{const relative=path.relative(path.resolve(tmpdir()),temporary);if(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(temporary).startsWith('sharedboard-codex-publish-'))await rm(temporary,{recursive:true});}
}
