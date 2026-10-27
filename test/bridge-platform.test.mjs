import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {codexExecutableCandidates,findCodexExecutable,findCodexQueueExecutable,supportsCodexQueue} from '../bridge/codex.mjs';
import {defaultDataDir} from '../bridge/paths.mjs';

function files(entries){
 const saved=new Map(entries.map(entry=>[entry.path,entry]));
 return {
  existsSync:filename=>saved.has(filename),
  statSync:filename=>{const entry=saved.get(filename);if(!entry)throw new Error('Missing fixture file');return {isFile:()=>entry.file!==false,mtimeMs:entry.mtime??0};},
  accessSync:filename=>{if(!saved.get(filename)?.executable)throw new Error('Fixture is not executable');},
  readdirSync:directory=>[...saved.keys()].filter(filename=>filename.startsWith(directory+'\\')&&!filename.slice(directory.length+1).includes('\\')).map(filename=>filename.slice(directory.length+1)),
 };
}

test('macOS GUI discovery finds documented standalone and compatibility bundle paths without shell PATH',async()=>{
 const standalone='/Users/Tester/.local/bin/codex',bundle='/Applications/Codex.app/Contents/Resources/codex',fileSystem=files([{path:standalone,executable:true},{path:bundle,executable:true}]),options={env:{PATH:'/usr/bin:/bin'},platform:'darwin',homeDirectory:'/Users/Tester',fileSystem};
 assert.deepEqual(codexExecutableCandidates(options),[standalone,bundle]);
 const probed=[];assert.equal(await findCodexQueueExecutable({...options,probe:async filename=>{probed.push(filename);return filename===bundle;}}),bundle);assert.deepEqual(probed,[standalone,bundle]);
 assert.equal(await findCodexQueueExecutable({...options,probe:async()=>false}),null,'finding an executable alone must not claim automatic delivery');
});

test('POSIX discovery honors explicit executables, colon-separated PATH and install directory while excluding non-executable files',()=>{
 const paths=['/explicit/codex','/tools/codex','/other/codex','/configured/codex','/Users/Tester/.local/bin/codex'],fileSystem=files(paths.map(filename=>({path:filename,executable:filename!=='/other/codex'})));
 const options={env:{CODEX_CLI_PATH:'/explicit/codex',PATH:'/tools:/other:.:relative',CODEX_INSTALL_DIR:'/configured'},platform:'darwin',homeDirectory:'/Users/Tester',fileSystem};
 assert.deepEqual(codexExecutableCandidates(options),[paths[0],paths[1],paths[3],paths[4]]);assert.equal(findCodexExecutable(options),paths[0]);
 assert.equal(findCodexExecutable({...options,env:{CODEX_CLI_PATH:'/other/codex',PATH:''},homeDirectory:'/Nobody'}),null);
});

test('Windows discovery preserves PATH and newest bundled app versions and adds documented standalone installer location',()=>{
 const appRoot='C:\\Local\\OpenAI\\Codex\\bin',standalone='C:\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe',fileSystem=files([
  {path:'C:\\Tools\\codex.exe'}, {path:standalone},
  {path:appRoot+'\\older',file:false,mtime:1},{path:appRoot+'\\newer',file:false,mtime:2},
  {path:appRoot+'\\older\\codex.exe'},{path:appRoot+'\\newer\\codex.exe'}
 ]);
 assert.deepEqual(codexExecutableCandidates({env:{PATH:'C:\\Tools;C:\\Missing',LOCALAPPDATA:'C:\\Local'},platform:'win32',fileSystem}),['C:\\Tools\\codex.exe',standalone,appRoot+'\\newer\\codex.exe',appRoot+'\\older\\codex.exe']);
});

test('queue capability checks inspect help only and require the actual queue flags',async()=>{
 const probe=(output,exitCode=0)=>supportsCodexQueue('/Applications/Codex.app/Contents/Resources/codex',{spawnProcess:(command,args,options)=>{
  assert.equal(command,'/Applications/Codex.app/Contents/Resources/codex');assert.deepEqual(args,['queue','--help']);assert.equal(options.shell,false);
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
  queueMicrotask(()=>{child.stdout.end(output);child.emit('close',exitCode);});return child;
 }});
 assert.equal(await probe('Queue a message. --thread <ID> --message <TEXT>'),true);
 assert.equal(await probe('Unknown subcommand: queue',2),false);assert.equal(await probe('Other help without required arguments'),false);
 assert.equal(await supportsCodexQueue('/missing/codex',{spawnProcess:()=>{throw new Error('Not installed');}}),false);
});

test('bridge private data follows macOS Application Support and platform-specific overrides',()=>{
 assert.equal(defaultDataDir({},'darwin','/Users/Tester'),'/Users/Tester/Library/Application Support/SharedBoardBridge/data');
 assert.equal(defaultDataDir({SHARED_BOARD_BRIDGE_DATA_DIR:'/Volumes/Private/Board data'},'darwin','/Users/Tester'),'/Volumes/Private/Board data');
 assert.equal(defaultDataDir({LOCALAPPDATA:'C:\\Local'},'win32','C:\\Users\\Tester'),'C:\\Local\\SharedBoardBridge\\data');
 assert.equal(defaultDataDir({},'linux','/home/tester'),'/home/tester/.local/share/SharedBoardBridge/data');
});
