// Created by Andrew Barresi: https://github.com/AndBarresi
// Copyright (c) 2026 Andrew Barresi
// Licensed under the MIT License. See LICENSE.
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {startBridge} from './server.mjs';

export async function main(args=process.argv.slice(2)){
 const options={};for(let i=0;i<args.length;i++){
  const flag=args[i],value=args[++i];if(value===undefined)throw new Error(`A value is required for ${flag}.`);
  if(flag==='--port'){const port=Number(value);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Choose a port from 1 to 65535.');options.port=port;}
  else if(flag==='--data-dir')options.dataDir=path.resolve(value);
  else if(flag==='--installPath')options.installPath=path.resolve(value);
  else throw new Error(`Unknown option: ${flag}`);
 }
 const bridge=await startBridge(options);process.stdout.write(`SharedBoard Bridge is listening at ${bridge.url}. Open https://sharedboard.app to connect your board.\n`);
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void bridge.close().then(()=>process.exit(0)));
 return bridge;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{process.stderr.write(`${error.message}\n`);process.exitCode=1;});
