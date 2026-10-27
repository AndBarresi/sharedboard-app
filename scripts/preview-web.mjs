import http from 'node:http';
import {createReadStream,existsSync,lstatSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateWebBuild,webDirectory} from './build-web.mjs';
import {bridgeDownloadRedirect} from '../shared/bridge-downloads.mjs';

const types={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.mjs':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.ico':'image/x-icon','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf','.otf':'font/otf','.txt':'text/plain; charset=utf-8','.md':'text/plain; charset=utf-8'};

export async function startWebPreview({directory=webDirectory,port=4173,validate=true}={}){
  directory=path.resolve(directory);if(validate)validateWebBuild(directory);
  const headers={'Cache-Control':'no-store'};
  for(const line of readFileSync(path.join(directory,'_headers'),'utf8').split(/\r?\n/)){const match=/^\s+([^:]+):\s*(.+)$/.exec(line);if(match)headers[match[1]]=match[2];}
  const server=http.createServer((request,response)=>{
    try{
      if(!['GET','HEAD'].includes(request.method)){response.writeHead(405,{'Allow':'GET, HEAD',...headers});response.end();return;}
      let route;try{route=decodeURIComponent(new URL(request.url,'http://localhost').pathname);}catch{response.writeHead(400,headers);response.end('Invalid path.');return;}
      if(route.includes('\0')||route.includes('\\')){response.writeHead(400,headers);response.end('Invalid path.');return;}
      const download=bridgeDownloadRedirect(route);
      if(download){response.writeHead(302,{...headers,Location:download});response.end();return;}
      let file=path.resolve(directory,`.${route}`),status=200;
      if(file!==directory&&!file.startsWith(directory+path.sep)){response.writeHead(403,headers);response.end();return;}
      if(route==='/'||/^\/boards\/[^/]+(?:\/.*)?$/.test(route))file=path.join(directory,'index.html');
      else if(route==='/_headers'||route==='/_redirects'||!existsSync(file)||!lstatSync(file).isFile()){file=path.join(directory,'404.html');status=404;}
      const stat=lstatSync(file);if(stat.isSymbolicLink()){response.writeHead(403,headers);response.end();return;}
      response.writeHead(status,{'Content-Type':types[path.extname(file).toLowerCase()]??'application/octet-stream','Content-Length':stat.size,...headers});
      if(request.method==='HEAD')response.end();else createReadStream(file).on('error',()=>response.destroy()).pipe(response);
    }catch{if(!response.headersSent)response.writeHead(500,headers);response.end('The static preview could not serve this file.');}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return {server,url:`http://127.0.0.1:${server.address().port}`,async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),options={};for(let i=0;i<args.length;i+=2){if(args[i]==='--port'&&args[i+1]!==undefined){options.port=Number(args[i+1]);if(!Number.isInteger(options.port)||options.port<0||options.port>65535)throw new Error('Choose a valid preview port.');}else if(args[i]==='--dir'&&args[i+1])options.directory=args[i+1];else throw new Error('Use preview:web [--port 4173] [--dir <dist-web path>].');}
  const app=await startWebPreview(options);console.log(`SharedBoard.app browser preview ready at ${app.url}/`);console.log('Board data is stored by this browser profile at this exact origin. Export before moving to another address.');
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await app.close();process.exit(0);});
}
