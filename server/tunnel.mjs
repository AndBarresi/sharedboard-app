import {readFile,writeFile,mkdir,rename,chmod} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function ensureTunnelHelper(directory,{fetcher=fetch,platform=process.platform,arch=process.arch,onProgress=()=>{}}={}){
  const assetName=platform==='win32'&&arch==='x64'?'cloudflared-windows-amd64.exe':['linux','darwin'].includes(platform)&&['x64','arm64'].includes(arch)?`cloudflared-${platform}-${arch==='x64'?'amd64':'arm64'}${platform==='darwin'?'.tgz':''}`:null;
  if(!assetName)throw new Error('The temporary web connector supports Windows x64, macOS and Linux x64 / ARM64. Other computers can still use the local MCP connection.');
  await mkdir(directory,{recursive:true});
  const binary=path.join(directory,platform==='win32'?'cloudflared.exe':'cloudflared'),metadata=path.join(directory,'helper.json');
  try{const saved=JSON.parse(await readFile(metadata,'utf8'));if(saved.asset===assetName&&saved.sha256===sha(await readFile(binary)))return binary;}catch{}
  onProgress('Downloading the connection helper…');
  const releaseResponse=await fetcher('https://api.github.com/repos/cloudflare/cloudflared/releases/latest',{headers:{'User-Agent':'SharedBoard.app-prototype','Accept':'application/vnd.github+json'},signal:AbortSignal.timeout(30000)});
  if(!releaseResponse.ok)throw new Error('Could not check the official connection helper download. Try again later.');
  const release=await releaseResponse.json(),asset=release.assets?.find(a=>a.name===assetName);
  if(!asset||!/^https:\/\/github\.com\/cloudflare\/cloudflared\/releases\/download\//.test(asset.browser_download_url))throw new Error('The official connection helper is unavailable for this computer.');
  const checksum=asset.digest?.match(/^sha256:([a-f0-9]{64})$/i)?.[1]??release.body?.match(new RegExp(`${assetName.replaceAll('.','\\.')}[^a-f0-9]+([a-f0-9]{64})`,'i'))?.[1];
  if(!checksum)throw new Error('The official download has no verification checksum. The helper was not installed.');
  const download=await fetcher(asset.browser_download_url,{signal:AbortSignal.timeout(120000)});
  if(!download.ok)throw new Error('Could not download the connection helper. Try again.');
  const parts=[];let length=0;
  for await(const chunk of download.body){length+=chunk.length;if(length>100_000_000)throw new Error('The connection helper download exceeded its size limit.');parts.push(chunk);}
  const bytes=Buffer.concat(parts);
  if(sha(bytes)!==checksum.toLowerCase())throw new Error('The connection helper failed verification and was not installed.');
  let executable=bytes;
  if(platform==='darwin'){
    const archive=gunzipSync(bytes,{maxOutputLength:150_000_000});executable=null;
    for(let offset=0;offset+512<=archive.length;){const header=archive.subarray(offset,offset+512),name=header.subarray(0,100).toString().replace(/\0.*$/s,''),size=parseInt(header.subarray(124,136).toString().replace(/\0.*$/s,'').trim()||'0',8);if(!Number.isFinite(size)||size<0||offset+512+size>archive.length)throw new Error('The connection helper archive is invalid.');if(path.posix.basename(name)==='cloudflared'&&['0','\0'].includes(header.subarray(156,157).toString())){executable=archive.subarray(offset+512,offset+512+size);break;}offset+=512+Math.ceil(size/512)*512;}
    if(!executable)throw new Error('The verified archive did not contain the connection helper.');
  }
  await writeFile(`${binary}.tmp`,executable,{mode:0o700});await rename(`${binary}.tmp`,binary);await chmod(binary,0o700);
  await writeFile(metadata,JSON.stringify({asset:assetName,version:release.tag_name,sha256:sha(executable)}),{mode:0o600});
  return binary;
}

export async function startQuickTunnel({directory,url,onProgress=()=>{},onExit=()=>{},onDiagnostic=()=>{}}){
  const binary=await ensureTunnelHelper(directory,{onProgress});
  // An explicit empty configuration avoids changing or loading the user's Cloudflare configuration.
  const config=path.join(directory,'session.yml');await writeFile(config,'{}\n');
  onProgress('Opening the temporary connection…');
  const guardian=spawn(process.execPath,[fileURLToPath(new URL('./tunnel-guardian.mjs',import.meta.url)),binary,config,url],{shell:false,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
  let settled=false,stopping=false,log='';
  const stop=()=>{stopping=true;if(guardian.connected)guardian.send('stop');};
  const address=await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{stop();reject(new Error('The temporary connection did not become ready. Check your network and try again.'));},60000);
    const read=chunk=>{onDiagnostic(chunk.toString());log=(log+chunk.toString()).slice(-16000);const found=log.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/);if(found&&!settled&&log.includes('Registered tunnel connection')){settled=true;clearTimeout(timeout);resolve(found[0]);}};
    guardian.stdout.on('data',read);guardian.stderr.on('data',read);
    guardian.once('error',()=>{clearTimeout(timeout);reject(new Error('The connection helper could not start.'));});
    guardian.once('exit',()=>{clearTimeout(timeout);if(!settled)reject(new Error('The connection helper stopped before it was ready. Check your network and try again.'));if(!stopping)onExit();});
  });
  return {url:address,stop};
}
