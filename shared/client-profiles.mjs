// Copyright (c) 2026 Andrew Barresi. SPDX-License-Identifier: MIT
// Client names are setup choices, never evidence of an active event subscription.
export const CLIENT_PROFILES=Object.freeze([
 {id:'codex',label:'Codex',miniChat:'unavailable',miniChatLabel:'Mini chat unavailable',detail:'Board tools in your Codex conversation.'},
 {id:'claude-code',label:'Claude Code',miniChat:'unavailable',miniChatLabel:'Mini chat unavailable',detail:'Board tools in your Claude Code session.'},
 {id:'chatgpt',label:'ChatGPT',miniChat:'verify',miniChatLabel:'Mini chat needs verification',detail:'Requires Work Cloud and verified incoming events.'},
 {id:'claude',label:'Claude (web)',miniChat:'unavailable',miniChatLabel:'Mini chat unavailable',detail:'Board tools in your Claude conversation.'},
 {id:'other',label:'Other MCP client',miniChat:'verify',miniChatLabel:'Mini chat needs verification',detail:'Requires a client with verified incoming events.'},
].map(profile=>Object.freeze(profile)));
export const clientProfile=id=>CLIENT_PROFILES.find(profile=>profile.id===id)??null;
export const isClientProvider=id=>Boolean(clientProfile(id));

export function miniChatState(connection,now=Date.now()){
 if(connection?.connected!==true||connection.revoked)return {enabled:false,reason:'Connect an AI with verified mini-chat delivery to use Talk it through.'};
 if(connection.automaticMessages!==true)return {enabled:false,reason:'Mini chat is unavailable for this connection. Use board tools in your AI chat.'};
 const deadline=connection.messageExpiresAt??connection.eventExpiresAt;
 if(deadline!==undefined&&deadline!==null){
  const expires=typeof deadline==='number'?deadline:Date.parse(deadline);
  if(!Number.isFinite(expires)||expires<=now)return {enabled:false,reason:'Mini-chat delivery expired. Renew the event subscription in your AI chat.'};
 }
 if(connection.browserOnline===false||connection.relayAvailable===false)return {enabled:false,reason:'Mini chat is offline. Keep this board connected and try again.'};
 return {enabled:true,reason:'Mini chat is available through this connection’s verified incoming events.'};
}
