// Copyright (c) 2026 Andrew Barresi. SPDX-License-Identifier: MIT
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createMcpHandler} from '@modelcontextprotocol/server';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {createBoardMcp} from '../../../server/tools.mjs';

export async function discoverBoardTools(){
  const handler=createMcpHandler(()=>createBoardMcp(()=>{throw new Error('Tool discovery cannot execute board operations.');},{remote:true,remotePair:true,proposals:false}));
  const client=new Client({name:'sharedboard-plugin-tool-generator',version:'1'});
  try{await client.connect(new StreamableHTTPClientTransport(new URL('https://discovery.invalid/mcp'),{fetch:(input,init)=>handler.fetch(new Request(input,init))}));return (await client.listTools()).tools.filter(tool=>!['connect_board','disconnect_board'].includes(tool.name));}
  finally{await client.close();await handler.close();}
}
export async function generateBoardTools({check=false}={}){
  const tools=await discoverBoardTools(),destination=new URL('../src/board-tools.json',import.meta.url),source=`${JSON.stringify(tools,null,2)}\n`;
  if(check){if(await readFile(destination,'utf8')!==source)throw new Error('Refresh Claude plugin board tool definitions before recording the release.');}
  else await writeFile(destination,source,'utf8');return tools;
}
if(process.argv[1]===fileURLToPath(import.meta.url))await generateBoardTools({check:process.argv.includes('--check')});
