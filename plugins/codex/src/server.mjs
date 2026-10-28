// Copyright (c) 2026 Andrew Barresi. SPDX-License-Identifier: MIT
import {createPluginServer,CHANNEL_INSTRUCTIONS} from '../../claude-code/src/tools.mjs';
import {UUID,pluginError} from '../../claude-code/src/state.mjs';
import {createCodexQueue} from './queue.mjs';
import metadata from '../package.json' with {type:'json'};

const connectDefinition={name:'connect_board',description:'Connect this local plugin to the exact existing Codex conversation and browser board. Supply the user\'s fresh website code and actual CODEX_THREAD_ID from this conversation\'s environment. Never guess an ID or create a new chat.',inputSchema:{type:'object',properties:{connectionCode:{type:'string'},providerSessionId:{type:'string',format:'uuid',description:'The actual CODEX_THREAD_ID, read from this conversation\'s environment.'},label:{type:'string',minLength:1,maxLength:80}},required:['connectionCode','providerSessionId'],additionalProperties:false},annotations:{destructiveHint:false}};

export function createCodexPlugin({dataDirectory,queue=createCodexQueue(),nativeThreadId,client:providedClient,clientOptions={},onDiagnostic=()=>{}}={}){
  let target=null,plugin;
  const instructions=CHANNEL_INSTRUCTIONS.replaceAll('Claude Code','Codex').replaceAll('Answering only in Claude','Answering only in Codex')+'\nThis local plugin queues routing-only messages using the installed Codex queue command. Connect only with the actual CODEX_THREAD_ID read in the intended conversation. Queue acceptance is not proof that the model read or answered the capture. Do not override the conversation model, permissions, or project directory.';
  plugin=createPluginServer({dataDirectory,client:providedClient,version:metadata.version,serverName:'sharedboard-codex',instructions,capabilities:{tools:{}},connectDefinition,onDiagnostic,clientOptions:{...clientOptions,expectedDeliveryMode:'codex-channel',notify:async message=>{if(!target)throw pluginError('CODEX_THREAD_REQUIRED','The intended Codex conversation has not been bound.');await queue(target,message);}}});
  const connect=plugin.client.connect.bind(plugin.client),disconnect=plugin.client.disconnect.bind(plugin.client);
  plugin.client.connect=async input=>{
    if(!UUID.test(input?.providerSessionId)||nativeThreadId&&input.providerSessionId!==nativeThreadId)throw pluginError('CODEX_THREAD_REQUIRED','Use the actual CODEX_THREAD_ID of this conversation, never a guessed or different ID.');
    if(target)throw pluginError('CHANNEL_ALREADY_CONNECTED','Disconnect this plugin explicitly before choosing another conversation.');
    target=input.providerSessionId;
    try{return await connect(input);}catch(error){target=null;throw error;}
  };
  plugin.client.disconnect=async()=>{target=null;return disconnect();};
  return plugin;
}
