#!/usr/bin/env node
// Copyright (c) 2026 Andrew Barresi. SPDX-License-Identifier: MIT
import {homedir} from 'node:os';
import path from 'node:path';
import {StdioServerTransport} from '@modelcontextprotocol/sdk-v1/server/stdio.js';
import {createCodexPlugin} from './server.mjs';
let plugin;
const diagnostic=code=>process.stderr.write(`SharedBoard: ${/^[A-Z_]{1,64}$/.test(code)?code:'PLUGIN_RUNTIME_FAILED'}\n`);
try{
  if(Number(process.versions.node.split('.')[0])<22)throw new Error('runtime');
  const codexHome=process.env.CODEX_HOME||path.join(homedir(),'.codex');
  plugin=createCodexPlugin({dataDirectory:path.join(codexHome,'sharedboard-plugin'),nativeThreadId:process.env.CODEX_THREAD_ID,onDiagnostic:diagnostic});
  const shutdown=()=>{plugin?.client.close();void plugin?.server.close().catch(()=>{});};process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);process.stdin.once('end',shutdown);
  plugin.server.onerror=()=>diagnostic('PLUGIN_PROTOCOL_ERROR');
  plugin.server.onclose=()=>plugin.client.close();
  await plugin.server.connect(new StdioServerTransport());
}catch{plugin?.client.close();diagnostic('PLUGIN_START_FAILED');process.exitCode=1;}
