#!/usr/bin/env node
// Copyright (c) 2026 Andrew Barresi. SPDX-License-Identifier: MIT
import {StdioServerTransport} from '@modelcontextprotocol/sdk-v1/server/stdio.js';
import {createPluginServer} from './tools.mjs';

let plugin;
const diagnostic=code=>process.stderr.write(`SharedBoard: ${/^[A-Z_]{1,64}$/.test(code)?code:'CHANNEL_RUNTIME_FAILED'}\n`);
try{
  if(Number(process.versions.node.split('.')[0])<22)throw new Error('runtime');
  plugin=createPluginServer({dataDirectory:process.env.CLAUDE_PLUGIN_DATA,onDiagnostic:diagnostic});
  const transport=new StdioServerTransport();
  const shutdown=()=>{plugin?.client.close();void plugin?.server.close().catch(()=>{});};
  process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);process.stdin.once('end',shutdown);
  plugin.server.onerror=()=>diagnostic('CHANNEL_PROTOCOL_ERROR');
  plugin.server.onclose=()=>plugin.client.close();
  await plugin.server.connect(transport);
}catch{plugin?.client.close();diagnostic('CHANNEL_START_FAILED');process.exitCode=1;}
