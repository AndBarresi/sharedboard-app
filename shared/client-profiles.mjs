// Copyright (c) 2026 Andrew Barresi. SPDX-License-Identifier: MIT
// Mini chat works through copied requests for every connected MCP client.
// Client names are never evidence of an active automatic-delivery subscription.
export const CLIENT_PROFILES=Object.freeze([
 {id:'codex',label:'Codex',miniChat:'manual',miniChatLabel:'Mini chat · Copy to AI',detail:'Read, edit, and reply through your connected chat.'},
 {id:'claude-code',label:'Claude Code',miniChat:'manual',miniChatLabel:'Mini chat · Copy to AI',detail:'Read, edit, and reply through your connected session.'},
 {id:'chatgpt',label:'ChatGPT',miniChat:'manual',miniChatLabel:'Mini chat · Copy to AI',detail:'Automatic delivery when your connection supports it.'},
 {id:'claude',label:'Claude (web)',miniChat:'manual',miniChatLabel:'Mini chat · Copy to AI',detail:'Read, edit, and reply through your connected chat.'},
 {id:'other',label:'Other MCP client',miniChat:'manual',miniChatLabel:'Mini chat · Copy to AI',detail:'Requires board tools; automatic delivery is checked separately.'},
].map(profile=>Object.freeze(profile)));
export const clientProfile=id=>CLIENT_PROFILES.find(profile=>profile.id===id)??null;
export const isClientProvider=id=>Boolean(clientProfile(id));

export function miniChatState(connection,now=Date.now()){
 if(connection?.connected!==true||connection.revoked)return {enabled:false,automatic:false,mode:'unavailable',reason:'Connect an AI to use Talk it through.'};
 if(connection.browserOnline===false||connection.relayAvailable===false)return {enabled:false,automatic:false,mode:'unavailable',reason:'Mini chat is offline. Keep this board connected and try again.'};
 const manual=reason=>({enabled:true,automatic:false,mode:'manual',reason});
 if(connection.automaticMessages!==true)return manual('Mini chat is available. Copy your request into your connected AI chat; its reply returns here.');
 const deadline=connection.messageExpiresAt??connection.eventExpiresAt;
 if(deadline!==undefined&&deadline!==null){
  const expires=typeof deadline==='number'?deadline:Date.parse(deadline);
  if(!Number.isFinite(expires)||expires<=now)return manual('Automatic delivery expired. You can still copy requests into your AI chat and receive replies here.');
 }
 return {enabled:true,automatic:true,mode:'events',reason:'Mini chat is available with automatic message delivery.'};
}
