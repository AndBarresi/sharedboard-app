// Copyright (c) 2026 Andrew Barresi. SPDX-License-Identifier: MIT
import {mkdir,copyFile,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {generateBoardTools} from './generate-tools.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
export async function buildPlugin(outDirectory){
  const target=path.resolve(outDirectory),relative=path.relative(root,target),back=path.relative(target,root);if(!relative||!relative.startsWith('..')&&!path.isAbsolute(relative)||!back.startsWith('..')&&!path.isAbsolute(back))throw new Error('Build the plugin into a separate staging directory, never over its source or an ancestor.');
  await generateBoardTools({check:true});await mkdir(path.join(target,'.claude-plugin'),{recursive:true});await mkdir(path.join(target,'skills','connect'),{recursive:true});
  for(const file of ['.claude-plugin/plugin.json','skills/connect/SKILL.md','README.md'])await copyFile(path.join(root,file),path.join(target,file));
  const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));delete pkg.dependencies;await writeFile(path.join(target,'package.json'),`${JSON.stringify(pkg,null,2)}\n`);
  await copyFile(fileURLToPath(new URL('../../../LICENSE',import.meta.url)),path.join(target,'LICENSE'));
  await build({entryPoints:[path.join(root,'src','main.mjs')],outfile:path.join(target,'src','main.mjs'),bundle:true,platform:'node',target:'node22',format:'esm',logLevel:'silent',packages:'bundle'});
  return {directory:target,version:pkg.version};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  if(!process.argv[2])throw new Error('Supply an output staging directory.');await buildPlugin(process.argv[2]);
}
