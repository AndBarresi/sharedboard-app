import {closeSync,existsSync,mkdirSync,openSync,readFileSync,unlinkSync,writeFileSync,writeSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {deflateRawSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {projectRoot,validateWebBuild,webDirectory} from './build-web.mjs';

const crcTable=Uint32Array.from({length:256},(_,index)=>{let value=index;for(let bit=0;bit<8;bit++)value=value&1?0xedb88320^(value>>>1):value>>>1;return value>>>0;});
const crc32=bytes=>{let value=0xffffffff;for(const byte of bytes)value=crcTable[(value^byte)&255]^(value>>>8);return (value^0xffffffff)>>>0;};

// A small standard ZIP writer keeps static packaging independent of OS commands.
// Files are capped by validateWebBuild well below ZIP32's individual file limit.
export function writeStaticZip(files,output,{date=new Date('2026-01-01T00:00:00Z')}={}){
  if(files.length>65535)throw new Error('The archive has too many ZIP entries.');
  const year=Math.max(1980,Math.min(2107,date.getUTCFullYear())),dosDate=((year-1980)<<9)|((date.getUTCMonth()+1)<<5)|date.getUTCDate(),dosTime=(date.getUTCHours()<<11)|(date.getUTCMinutes()<<5)|(date.getUTCSeconds()>>1);
  let descriptor,offset=0;const central=[];
  try{
    descriptor=openSync(output,'wx');
    const write=bytes=>{writeSync(descriptor,bytes);offset+=bytes.length;if(offset>0xffffffff)throw new Error('The archive exceeds the supported ZIP32 size.');};
    for(const {name,file} of files){
      const filename=Buffer.from(name,'utf8'),bytes=readFileSync(file),compressed=deflateRawSync(bytes,{level:9}),crc=crc32(bytes),start=offset;
      const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x0800,6);local.writeUInt16LE(8,8);local.writeUInt16LE(dosTime,10);local.writeUInt16LE(dosDate,12);local.writeUInt32LE(crc,14);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(bytes.length,22);local.writeUInt16LE(filename.length,26);
      write(local);write(filename);write(compressed);
      const header=Buffer.alloc(46);header.writeUInt32LE(0x02014b50);header.writeUInt16LE(20,4);header.writeUInt16LE(20,6);header.writeUInt16LE(0x0800,8);header.writeUInt16LE(8,10);header.writeUInt16LE(dosTime,12);header.writeUInt16LE(dosDate,14);header.writeUInt32LE(crc,16);header.writeUInt32LE(compressed.length,20);header.writeUInt32LE(bytes.length,24);header.writeUInt16LE(filename.length,28);header.writeUInt32LE(start,42);central.push(header,filename);
    }
    const centralStart=offset;for(const bytes of central)write(bytes);const centralSize=offset-centralStart,end=Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(centralSize,12);end.writeUInt32LE(centralStart,16);write(end);
    closeSync(descriptor);descriptor=undefined;
  }catch(error){if(descriptor!==undefined){closeSync(descriptor);unlinkSync(output);}throw error;}
}

export function packageWeb({output}={}){
  execFileSync(process.execPath,['scripts/release.mjs','check'],{cwd:projectRoot,stdio:'inherit'});
  const build=validateWebBuild(webDirectory),release=JSON.parse(readFileSync(path.join(projectRoot,'releases.json'),'utf8'));
  output=path.resolve(output??path.join(projectRoot,'..',`SharedBoard.app-${build.version}-cloudflare-pages.zip`));
  if(!output.toLowerCase().endsWith('.zip'))throw new Error('Choose an output filename ending in .zip.');
  if(existsSync(output)||existsSync(`${output}.sha256`))throw new Error('That release archive or checksum already exists. Choose a new output filename.');
  mkdirSync(path.dirname(output),{recursive:true});writeStaticZip(build.files,output,{date:new Date(`${release.entries[0].date}T00:00:00Z`)});
  const sha256=createHash('sha256').update(readFileSync(output)).digest('hex');writeFileSync(`${output}.sha256`,`${sha256}  ${path.basename(output)}\n`,{flag:'wx'});
  console.log(JSON.stringify({archive:output,sha256,version:build.version,storageMode:'browser',files:build.files.length,staticOnly:true},null,2));return {output,sha256};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);if(args.length&&!(args.length===2&&args[0]==='--output'))throw new Error('Use package:web [--output <zip path>].');packageWeb({output:args[1]});
}
