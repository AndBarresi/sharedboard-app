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
import {isSupportedEmbed} from '../shared/embeds.mjs';

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

test('production web embeds permit engine iframe destinations while parent scripts, relay connections and privacy controls remain restricted',async()=>{
  const f=fixture(),app=await startWebPreview({directory:f.directory,port:0,validate:false});
  try{
    const response=await fetch(app.url+'/'),policy=response.headers.get('content-security-policy');
    const directives=new Map(policy.split(';').map(part=>part.trim().split(/\s+/)).map(([name,...sources])=>[name,sources]));
    assert.deepEqual(directives.get('frame-src'),["'self'",'https://www.youtube.com','https://player.vimeo.com','https://www.figma.com','https://embed.figma.com','https://link.excalidraw.com','https://stackblitz.com','https://www.stackblitz.com','https://val.town','https://www.val.town','https://giphy.com','https://*.simplepdf.eu']);
    assert.deepEqual(directives.get('connect-src'),["'self'",'https://connect.sharedboard.app','wss://connect.sharedboard.app']);
    assert.deepEqual(directives.get('img-src'),["'self'",'data:','blob:']);
    assert.deepEqual(directives.get('font-src'),["'self'",'data:']);
    assert.deepEqual(directives.get('default-src'),["'self'"]);assert.deepEqual(directives.get('object-src'),["'none'"]);assert.deepEqual(directives.get('frame-ancestors'),["'none'"]);assert.deepEqual(directives.get('form-action'),["'self'"]);
    assert.ok(directives.get('script-src').every(source=>["'self'","'wasm-unsafe-eval'"].includes(source)||/^'sha256-[A-Za-z0-9+/=]+'$/.test(source)),'embedding must not trust external scripts in SharedBoard or inherited srcDoc content');
    assert.equal(response.headers.get('referrer-policy'),'no-referrer');assert.equal(response.headers.get('x-frame-options'),'DENY');assert.equal(response.headers.get('permissions-policy'),'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    assert.ok(directives.get('frame-src').every(source=>source==="'self'"||source.startsWith('https://')));assert.deepEqual(directives.get('frame-src').filter(source=>source.includes('*')),['https://*.simplepdf.eu']);
    assert.equal(directives.get('frame-src').includes('https:'),false);assert.equal(directives.get('frame-src').includes('*'),false);assert.equal(directives.get('frame-src').includes('https://example.com'),false);
    f.validate();
    const headersFile=path.join(f.directory,'_headers'),original=readFileSync(headersFile,'utf8');
    for(const change of [text=>text.replace("frame-src 'self' ","frame-src * "),text=>text.replace('https://*.simplepdf.eu;','https://*.simplepdf.eu https://example.com;'),text=>text.replace(/; frame-src[^;]+/,''),text=>text.replace('; worker-src',"; frame-src *; worker-src")]){
      writeFileSync(headersFile,change(original));assert.throws(()=>f.validate(),/only its supported HTTPS web-embed frames/);
    }
  }finally{await app.close();f.clean();}
});

test('web embed validation accepts supported HTTPS frames and rejects srcDoc widgets and unrelated or insecure destinations',()=>{
  for(const url of ['https://www.youtube.com/watch?v=abc123','https://youtu.be/abc123','https://vimeo.com/123456','https://player.vimeo.com/video/123456','https://www.figma.com/design/abc/Page','https://embed.figma.com/proto/abc/Page','https://link.excalidraw.com/readonly/board','https://stackblitz.com/edit/example','https://www.stackblitz.com/edit/example','https://val.town/v/user.demo','https://www.val.town/embed/user.demo','https://giphy.com/embed/abc123','https://www.giphy.com/gifs/abc123','https://editor.simplepdf.eu/editor','https://customer-name.simplepdf.eu/editor'])assert.equal(isSupportedEmbed(url),true,url);
  for(const url of ['https://twitter.com/user/status/123','https://x.com/user/status/123','https://reddit.com/r/example/comments/abc/post','https://gist.github.com/user/abc','https://platform.twitter.com/widgets.js','https://embed.reddit.com/widgets.js','https://example.com/','https://youtube.com.attacker.example/watch?v=abc','https://customer.simplepdf.eu.attacker.example/','https://evil.customer.simplepdf.eu/','https://simplepdf.eu/','http://www.youtube.com/embed/abc','https://www.youtube.com:8443/embed/abc','https://username:password@www.youtube.com/embed/abc','javascript:alert(1)','data:text/html,<h1>Example</h1>','//www.youtube.com/embed/abc','www.youtube.com/watch?v=abc','not a URL'])assert.equal(isSupportedEmbed(url),false,url);
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
