import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,rmdirSync,truncateSync,symlinkSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {inflateRawSync} from 'node:zlib';
import {installPagesFiles,listStaticFiles,pagesAssetLimit,validateWebBuild} from '../scripts/build-web.mjs';
import {writeStaticZip} from '../scripts/package-web.mjs';
import {startWebPreview} from '../scripts/preview-web.mjs';

function fixture(){
  const directory=mkdtempSync(path.join(os.tmpdir(),'sharedboard-static-package-'));
  writeFileSync(path.join(directory,'index.html'),'<!doctype html><title>Fixture</title><script>window.EXCALIDRAW_ASSET_PATH = "/excalidraw/";</script>');
  writeFileSync(path.join(directory,'build-info.json'),JSON.stringify({version:'fixture',sourceHash:'fixture-hash',storageMode:'browser'}));
  installPagesFiles(directory);
  return {directory,validate:(extra={})=>validateWebBuild(directory,{version:'fixture',sourceHash:'fixture-hash',...extra}),clean(){const actual=path.resolve(directory);if(!actual.startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(actual).startsWith('sharedboard-static-package-'))throw new Error('Refusing to remove a non-fixture directory.');rmSync(actual,{recursive:true,force:true});}};
}

test('static build validation rejects stale storage stamps, private files and Pages size/count overruns',()=>{
  const f=fixture();
  try{
    assert.equal(f.validate().files.length,5);
    assert.match(readFileSync(path.join(f.directory,'_redirects'),'utf8'),/^\/boards\/\* \/ 200$/m);
    writeFileSync(path.join(f.directory,'_redirects'),'/boards/* /index.html 200\n');assert.throws(()=>f.validate(),/canonical board route rewrite/);installPagesFiles(f.directory);
    assert.throws(()=>f.validate({version:'another-version'}),/stale/);
    writeFileSync(path.join(f.directory,'build-info.json'),JSON.stringify({version:'fixture',sourceHash:'fixture-hash',storageMode:'local'}));assert.throws(()=>f.validate(),/local-server storage/);
    writeFileSync(path.join(f.directory,'build-info.json'),JSON.stringify({version:'fixture',sourceHash:'fixture-hash',storageMode:'browser'}));
    writeFileSync(path.join(f.directory,'.env'),'example-key');assert.throws(()=>f.validate(),/private or development artifact/);rmSync(path.join(f.directory,'.env'));
    mkdirSync(path.join(f.directory,'data'));writeFileSync(path.join(f.directory,'data','board.json'),'{}');assert.throws(()=>f.validate(),/private or development artifact/);rmSync(path.join(f.directory,'data','board.json'));rmdirSync(path.join(f.directory,'data'));
    for(const installer of ['Install SharedBoard Bridge.command','SharedBoard-Bridge-windows-x64.zip','SharedBoard-Bridge-macos-arm64.zip.sha256']){writeFileSync(path.join(f.directory,installer),'retired download');assert.throws(()=>f.validate(),/private or development artifact/);rmSync(path.join(f.directory,installer));}
    writeFileSync(path.join(f.directory,'_redirects'),'/boards/* / 200\n/downloads/SharedBoard-Bridge-windows-x64.zip https://example.com/installer.zip 302\n');assert.throws(()=>f.validate(),/downloads have been retired/);installPagesFiles(f.directory);
    const productionHeaders=readFileSync(path.join(f.directory,'_headers'),'utf8');
    writeFileSync(path.join(f.directory,'_headers'),productionHeaders.replace('https://connect.sharedboard.app wss://connect.sharedboard.app','http://127.0.0.1:4319'));assert.throws(()=>f.validate(),/only to its hosted relay/);installPagesFiles(f.directory);
    const oversized=path.join(f.directory,'oversized.bin');writeFileSync(oversized,'');truncateSync(oversized,pagesAssetLimit+1);assert.throws(()=>f.validate(),/25 MiB/);rmSync(oversized);
    assert.throws(()=>f.validate({maxFiles:4}),/configured upload limit/);
  }finally{f.clean();}
});

test('static files reject filesystem links instead of copying content from outside the build',t=>{
  const f=fixture();
  try{try{symlinkSync(path.join(f.directory,'index.html'),path.join(f.directory,'linked.html'),'file');}catch(error){if(['EPERM','EACCES'].includes(error.code)){t.skip('This Windows user cannot create symlinks.');return;}throw error;}assert.throws(()=>listStaticFiles(f.directory),/filesystem links/);}finally{f.clean();}
});

test('static preview serves board deep links, applies CSP bootstrap hashes and exposes no API/config endpoints',async()=>{
  const f=fixture(),app=await startWebPreview({directory:f.directory,port:0,validate:false});
  try{
    const root=await fetch(app.url+'/'),deep=await fetch(app.url+'/boards/00000000-0000-4000-8000-000000000001/');assert.equal(root.status,200);assert.equal(await deep.text(),await root.text());
    const policy=root.headers.get('content-security-policy'),inline='window.EXCALIDRAW_ASSET_PATH = "/excalidraw/";';assert.ok(policy.includes(`'sha256-${createHash('sha256').update(inline).digest('base64')}'`));assert.match(policy,/(?:^|; )connect-src 'self' https:\/\/connect\.sharedboard\.app wss:\/\/connect\.sharedboard\.app(?:;|$)/);assert.doesNotMatch(policy,/localhost|127\.0\.0\.1|\[::1\]/);assert.equal(root.headers.get('x-content-type-options'),'nosniff');
    assert.equal((await fetch(app.url+'/api/board')).status,404);assert.equal((await fetch(app.url+'/_headers')).status,404);assert.equal((await fetch(app.url+'/_redirects')).status,404);assert.equal((await fetch(app.url+'/not-a-route')).status,404);
    assert.equal((await fetch(app.url+'/',{method:'POST',body:'{}'})).status,405);const head=await fetch(app.url+'/',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
    const routes=readFileSync(path.join(f.directory,'_redirects'),'utf8');
    assert.doesNotMatch(routes,/\/downloads|SharedBoard-Bridge/);
    for(const target of ['windows-x64','macos-arm64','macos-x64']){
      const route=`/downloads/SharedBoard-Bridge-${target}.zip`,download=await fetch(app.url+route,{redirect:'manual'});
      assert.equal(download.status,404);assert.equal(download.headers.get('location'),null);
      assert.equal((await fetch(app.url+route,{method:'POST',redirect:'manual'})).status,405);
    }
    assert.equal((await fetch(app.url+'/downloads/SharedBoard-Bridge-unknown.zip',{redirect:'manual'})).status,404);
    assert.equal((await fetch(app.url+'/downloads/https://example.com',{redirect:'manual'})).status,404);
  }finally{await app.close();f.clean();}
});

test('isolated relay preview permits only an explicit loopback origin without changing production headers',async()=>{
  const f=fixture();let app;
  try{
    const before=readFileSync(path.join(f.directory,'_headers'),'utf8');
    for(const relayPreviewOrigin of ['http://localhost:8787','http://127.0.0.1','https://127.0.0.1:8787','http://127.0.0.1:8787/other','http://user@127.0.0.1:8787','http://127.0.0.1:8787/?token=secret','https://example.com'])await assert.rejects(startWebPreview({directory:f.directory,port:0,validate:false,relayPreviewOrigin}),/explicit http:\/\/127\.0\.0\.1/);
    app=await startWebPreview({directory:f.directory,port:0,validate:false,relayPreviewOrigin:'http://127.0.0.1:8787'});
    const response=await fetch(app.url+'/'),policy=response.headers.get('content-security-policy');
    assert.match(policy,/(?:^|; )connect-src 'self' http:\/\/127\.0\.0\.1:8787 ws:\/\/127\.0\.0\.1:8787(?:;|$)/);assert.doesNotMatch(policy,/connect\.sharedboard\.app/);
    assert.equal(readFileSync(path.join(f.directory,'_headers'),'utf8'),before);
    f.validate();
  }finally{await app?.close();f.clean();}
});

test('static ZIP has standard compressed entries, UTF-8 paths and refuses to overwrite an archive',()=>{
  const f=fixture(),archive=path.join(f.directory,'site.zip');
  try{
    mkdirSync(path.join(f.directory,'assets'));writeFileSync(path.join(f.directory,'assets','name-é.txt'),'file with Unicode path');
    const entries=listStaticFiles(f.directory);writeStaticZip(entries,archive);assert.throws(()=>writeStaticZip(entries,archive),/EEXIST/);
    const zip=readFileSync(archive),decoded=new Map();let offset=0;
    while(zip.readUInt32LE(offset)===0x04034b50){assert.equal(zip.readUInt16LE(offset+8),8);assert.equal(zip.readUInt16LE(offset+6)&0x0800,0x0800);const length=zip.readUInt32LE(offset+18),filenameLength=zip.readUInt16LE(offset+26),extraLength=zip.readUInt16LE(offset+28),name=zip.subarray(offset+30,offset+30+filenameLength).toString('utf8'),start=offset+30+filenameLength+extraLength;decoded.set(name,inflateRawSync(zip.subarray(start,start+length)));offset=start+length;}
    assert.equal(zip.readUInt32LE(offset),0x02014b50);assert.equal(zip.readUInt32LE(zip.length-22),0x06054b50);assert.equal(zip.readUInt16LE(zip.length-12),entries.length);assert.equal(zip.readUInt32LE(zip.length-6),offset);
    for(const entry of entries)assert.deepEqual(decoded.get(entry.name),readFileSync(entry.file));assert.equal(decoded.get('assets/name-é.txt').toString(),'file with Unicode path');
  }finally{f.clean();}
});
