// Copyright (c) 2026 Andrew Barresi. SPDX-License-Identifier: MIT
// Client names never prove a working route into an existing conversation.
// An MCP App can accept text while only filling a draft. Only a verified
// incoming-event route is eligible for automatic mini-chat delivery.
export const CLIENT_PROFILES=Object.freeze([
 {id:'codex',label:'Codex',miniChat:'wip',miniChatLabel:'Automatic mini chat · Work in progress',detail:'Board tools are available. A no-download incoming-message route has not been verified.'},
 {id:'claude-code',label:'Claude Code',miniChat:'wip',miniChatLabel:'Automatic mini chat · Work in progress',detail:'Board tools are available. A no-download incoming-message route has not been verified.'},
 {id:'chatgpt',label:'ChatGPT',miniChat:'wip',miniChatLabel:'Automatic mini chat · Work in progress',detail:'Board tools are available. Automatic chat requires a client with verified incoming-event support.'},
 {id:'claude',label:'Claude (web)',miniChat:'wip',miniChatLabel:'Automatic mini chat · Work in progress',detail:'Board tools are available. App messages fill a draft in Claude and do not start its model.'},
 {id:'other',label:'Other MCP client',miniChat:'wip',miniChatLabel:'Automatic mini chat · Work in progress',detail:'Board tools require remote MCP. Automatic messages depend on verified incoming events.'},
].map(profile=>Object.freeze(profile)));
export const clientProfile=id=>CLIENT_PROFILES.find(profile=>profile.id===id)??null;
export const isClientProvider=id=>Boolean(clientProfile(id));

export function miniChatState(connection,now=Date.now()){
 if(connection?.connected!==true||connection.revoked)return {enabled:false,automatic:false,mode:'unavailable',reason:'Connect an AI to use Talk it through.'};
 if(connection.browserOnline===false||connection.relayAvailable===false)return {enabled:false,automatic:false,mode:'unavailable',reason:'Mini chat is offline. Keep this board connected and try again.'};
 const reason=connection.provider==='claude'?'Automatic mini chat is unavailable for this Claude connection. App messages fill a draft; they do not submit it or start the model. Board tools remain available in your AI chat.':['codex','claude-code'].includes(connection.provider)?`Automatic mini chat is a work in progress. A no-download incoming-message route has not been verified for this ${clientProfile(connection.provider).label} connection. Board tools remain available in your AI chat.`:'Automatic mini chat requires a supported, verified incoming-message connection. Board tools remain available in your AI chat.';
 const unavailable={enabled:false,automatic:false,mode:'unavailable',reason};
 if(connection.automaticMessages!==true||connection.deliveryMode!=='events')return unavailable;
 const deadline=connection.messageExpiresAt??connection.eventExpiresAt;
 const expires=typeof deadline==='number'?deadline:typeof deadline==='string'?Date.parse(deadline):NaN;
 if(!Number.isFinite(expires)||expires<=now)return unavailable;
 return {enabled:true,automatic:true,mode:'events',reason:'Automatic mini chat is available through verified incoming messages.'};
}
