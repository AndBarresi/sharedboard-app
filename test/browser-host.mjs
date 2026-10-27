// An isolated MCP Apps host for testing the actual browser card without an AI account.
// Run with Node and open the printed localhost URL. It never opens the user's board.
import http from 'node:http';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {startServer} from '../server/index.mjs';

const directory=mkdtempSync(path.join(os.tmpdir(),'sharedboard-browser-check-'));
const board=await startServer({port:0,dataDir:directory,startTunnel:async({url})=>({url,stop(){}})});
const local=async(route,input)=>{const response=await fetch(`${board.url}/api/${route}`,{method:input===undefined?'GET':'POST',headers:{'x-board-token':board.token,'content-type':'application/json'},...(input===undefined?{}:{body:JSON.stringify(input)})});return response.json();};
await local('connection/web/start',{provider:'chatgpt-web',permission:'edit'});await board.webConnector.ready;
const origin=board.webConnector.publicOrigin;
const clientInfo=board.webConnector.auth.register({redirect_uris:['https://test.example/callback']});
const secret=randomBytes(40).toString('base64url');const request=board.webConnector.auth.request({client_id:clientInfo.client_id,redirect_uri:clientInfo.redirect_uris[0],response_type:'code',code_challenge_method:'S256',code_challenge:createHash('sha256').update(secret).digest('base64url')});
await local('connection/web/approve',{id:request.id,allow:true});
const code=new URL(board.webConnector.auth.poll(request.id).redirect).searchParams.get('code');
const tokens=board.webConnector.auth.issue({grant_type:'authorization_code',client_id:clientInfo.client_id,redirect_uri:clientInfo.redirect_uris[0],code,code_verifier:secret},board.webConnector.expiresAt);
const client=new Client({name:'simulated-chat-host',version:'1'});await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`),{requestInit:{headers:{Authorization:`Bearer ${tokens.access_token}`}}}));
const call=(name,args={})=>client.callTool({name,arguments:args});
const opened=await call('open_sharedboard');
const widget=readFileSync(new URL('../server/chat-app.html',import.meta.url),'utf8');
let accepted=0,rejectNext=false;
const host=http.createServer(async(req,res)=>{
  const json=(data,status=200)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));};
  try{
    if(req.url==='/rpc'&&req.method==='POST'){
      let text='';for await(const chunk of req)text+=chunk;const message=JSON.parse(text);
      if(message.method==='tools/call')return json(await call(message.params.name,message.params.arguments));
      if(message.method==='ui/message'){
        if(rejectNext){rejectNext=false;return json({isError:true});}
        accepted++;const prompt=message.params.content[0].text,id=prompt.match(/"id":"([a-f0-9-]+)"/)?.[1];
        if(!id)return json({isError:true});
        const isReview=prompt.includes('read_review_request');await call(isReview?'read_review_request':'read_chat_message',{id});const read=await call('read_board');await call('confirm_connection',{revision:read.structuredContent.revision});
        await call(isReview?'complete_review_request':'reply_to_chat_message',isReview?{id,summary:`Simulated host reviewed board revision ${read.structuredContent.revision}.`}:{id,text:`Simulated host response: I read board revision ${read.structuredContent.revision}. No drawing changes were made. This validates the app bridge, not a live provider account.`});
        return json({});
      }
      return json({});
    }
    if(req.url==='/from-board'&&req.method==='POST'){await local('chat',{id:randomUUID(),intent:'discuss',text:'Browser relay check from the board page. Inspect only, then reply.',expectedRevision:board.store.board.revision,selectedIds:[]});return json({ok:true});}
    if(req.url==='/reject'&&req.method==='POST'){rejectNext=true;return json({ok:true});}
    if(req.url==='/proof')return json({accepted,connection:await local('connection'),messages:(await local('chat')).messages});
    if(req.url==='/widget'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(widget);return;}
    if(req.url!=='/'){res.writeHead(404);res.end();return;}
    res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(`<!doctype html><html><title>Sharedboard · simulated chat host</title><style>body{font:13px/1.6 system-ui;margin:0;background:#e8eddf;color:#405139}header{padding:12px 22px;display:flex;gap:12px;align-items:center}button{padding:8px 12px;border:1px solid #bacba7;border-radius:8px;background:#fff;color:#416039}small{margin-left:auto}iframe{border:0;width:100%;height:590px;background:#fbfbf6}p{padding:0 22px}</style><header><strong>Simulated chat host · isolated test board</strong><button id="from-board">Send a request from the board</button><button id="reject">Reject the next handoff</button><small id="proof">No handoffs yet</small></header><iframe id="card" src="/widget" title="Sharedboard chat card" sandbox="allow-scripts allow-same-origin"></iframe><p>This test host uses the real HTTP MCP tools and the actual connector card. It does not use ChatGPT or Claude accounts.</p><script>const card=document.querySelector('#card'),opened=${JSON.stringify(opened).replaceAll('<','\\u003c')};window.addEventListener('message',async event=>{if(event.source!==card.contentWindow)return;const m=event.data;if(m.method==='ui/initialize'){event.source.postMessage({jsonrpc:'2.0',id:m.id,result:{protocolVersion:'2026-01-26',hostInfo:{name:'test-host',version:'1'},hostCapabilities:{message:{text:true},serverTools:{},serverResources:{}},hostContext:{}}},'*');setTimeout(()=>event.source.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:opened},'*'),20);return;}if(m.id===undefined)return;try{const result=await fetch('/rpc',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(m)}).then(r=>r.json());event.source.postMessage({jsonrpc:'2.0',id:m.id,result},'*');}catch(e){event.source.postMessage({jsonrpc:'2.0',id:m.id,error:{code:-32000,message:e.message}},'*');}});document.querySelector('#from-board').onclick=()=>fetch('/from-board',{method:'POST'});document.querySelector('#reject').onclick=()=>fetch('/reject',{method:'POST'});setInterval(async()=>{const p=await fetch('/proof').then(r=>r.json());document.querySelector('#proof').textContent=p.accepted+' accepted handoffs · '+p.messages.filter(m=>m.reply).length+' replies · board v'+${board.store.board.revision};},1000);</script></html>`);
  }catch(e){json({error:e.message},500);}
});
await new Promise(resolve=>host.listen(0,'127.0.0.1',resolve));
console.log(`Browser test host: http://127.0.0.1:${host.address().port}/`);
console.log(`Isolated board: ${board.url}/`);
async function close(){host.closeAllConnections();host.close();await client.close();await board.close();rmSync(directory,{recursive:true,force:true});process.exit(0);}
process.on('SIGINT',close);process.on('SIGTERM',close);
process.stdin.on('data',chunk=>{if(chunk.toString().includes('stop'))close();});

