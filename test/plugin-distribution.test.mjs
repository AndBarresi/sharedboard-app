import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {claudeMarketplace} from '../scripts/build-claude-plugin.mjs';
import {codexMarketplace} from '../scripts/build-codex-plugin.mjs';
import {publishCodexDirectory} from '../scripts/publish-codex-plugin.mjs';

test('marketplace catalogs pin the website archive and match the repository catalog',async()=>{
  const hash='a'.repeat(64),catalog=claudeMarketplace({version:'0.12.0',sha256:hash});
  assert.deepEqual(catalog.plugins[0].source,{source:'archive',url:'https://sharedboard.app/claude/sharedboard-0.12.0.zip',sha256:hash});
  assert.throws(()=>claudeMarketplace({version:'../x',sha256:hash}));assert.throws(()=>claudeMarketplace({version:'0.12.0',sha256:'missing'}));
  const actual=JSON.parse(await readFile(new URL('../.agents/plugins/marketplace.json',import.meta.url),'utf8'));
  assert.deepEqual(codexMarketplace(),actual);
  assert.equal(actual.plugins[0].source.path,'./plugin-dist/codex');assert.equal(actual.plugins[0].source.ref,'codex/plugin-dist');
});

test('publishing a built Codex plugin preserves the checkout and index and only advances its artifact branch',async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'sharedboard-publish-test-'));
  t.after(async()=>{const relative=path.relative(path.resolve(tmpdir()),directory);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(directory).startsWith('sharedboard-publish-test-'));await rm(directory,{recursive:true});});
  const remote=path.join(directory,'origin.git'),repo=path.join(directory,'repo'),plugin=path.join(directory,'plugin');
  const git=(args,cwd=repo)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['pipe','pipe','pipe'],windowsHide:true}).trim();
  await mkdir(repo);git(['init','--bare',remote],directory);git(['init','--initial-branch=main']);git(['config','user.name','SharedBoard test']);git(['config','user.email','test@example.invalid']);git(['remote','add','origin',remote]);
  await writeFile(path.join(repo,'site.txt'),'website project');git(['add','site.txt']);git(['commit','-m','fixture']);git(['push','origin','main']);
  await writeFile(path.join(repo,'staged.txt'),'user staged file');git(['add','staged.txt']);await writeFile(path.join(repo,'site.txt'),'user unstaged edit');
  await mkdir(path.join(plugin,'src'),{recursive:true});await writeFile(path.join(plugin,'plugin.json'),JSON.stringify({name:'sharedboard',version:'0.12.0'}));await writeFile(path.join(plugin,'src','main.mjs'),'// bundled plugin fixture\n');
  const beforeStatus=git(['status','--porcelain']),beforeIndex=git(['diff','--cached']),beforeHead=git(['rev-parse','HEAD']);
  await assert.rejects(publishCodexDirectory(plugin,{repoRoot:repo}),/only be published/);
  const first=await publishCodexDirectory(plugin,{repoRoot:repo,allowTestRemote:true});
  assert.equal(first.published,true);assert.equal(first.branch,'codex/plugin-dist');
  assert.equal(git(['branch','--show-current']),'main');assert.equal(git(['rev-parse','HEAD']),beforeHead);assert.equal(git(['status','--porcelain']),beforeStatus);assert.equal(git(['diff','--cached']),beforeIndex);
  assert.equal(git(['show',`${first.commit}:site.txt`]),'website project');assert.equal(git(['show',`${first.commit}:plugin-dist/codex/src/main.mjs`]),'// bundled plugin fixture');
  const repeat=await publishCodexDirectory(plugin,{repoRoot:repo,allowTestRemote:true});assert.equal(repeat.published,false);assert.equal(repeat.commit,first.commit);
  await writeFile(path.join(plugin,'src','main.mjs'),'// updated bundle\n');const next=await publishCodexDirectory(plugin,{repoRoot:repo,allowTestRemote:true});
  assert.equal(next.published,true);assert.equal(git(['rev-parse',`${next.commit}^`]),first.commit);assert.equal(git(['status','--porcelain']),beforeStatus);
  await writeFile(path.join(plugin,'.env'),'private');await assert.rejects(publishCodexDirectory(plugin,{repoRoot:repo,allowTestRemote:true}),/unexpected files/);
});
