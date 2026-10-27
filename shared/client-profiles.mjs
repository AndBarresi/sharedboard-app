// Copyright (c) 2026 Andrew Barresi. SPDX-License-Identifier: MIT
// Client names never prove a working route into an existing conversation.
// Mini chat only sends through an active panel lease or verified event route.
export const CLIENT_PROFILES=Object.freeze([
 {id:'codex',label:'Codex',miniChat:'link',miniChatLabel:'Direct mini chat · Link in your AI',detail:'Board tools work independently. Direct chat needs a supported conversation panel or incoming messages.'},
 {id:'claude-code',label:'Claude Code',miniChat:'link',miniChatLabel:'Direct mini chat · Link in your AI',detail:'Connect your existing session. Direct chat depends on its messaging capabilities.'},
 {id:'chatgpt',label:'ChatGPT',miniChat:'link',miniChatLabel:'Direct mini chat · Link in your AI',detail:'Link the conversation panel or use a verified incoming-message connection.'},
 {id:'claude',label:'Claude (web)',miniChat:'link',miniChatLabel:'Direct mini chat · Link in your AI',detail:'Open the SharedBoard conversation panel and link it in the chat you want to use.'},
 {id:'other',label:'Other MCP client',miniChat:'link',miniChatLabel:'Direct mini chat · Link in your AI',detail:'Requires remote board tools and a supported direct-message route.'},
].map(profile=>Object.freeze(profile)));
export const clientProfile=id=>CLIENT_PROFILES.find(profile=>profile.id===id)??null;
export const isClientProvider=id=>Boolean(clientProfile(id));

export function miniChatState(connection,now=Date.now()){
 if(connection?.connected!==true||connection.revoked)return {enabled:false,automatic:false,mode:'unavailable',reason:'Connect an AI to use Talk it through.'};
 if(connection.browserOnline===false||connection.relayAvailable===false)return {enabled:false,automatic:false,mode:'unavailable',reason:'Mini chat is offline. Keep this board connected and try again.'};
 const needsLink={enabled:false,automatic:false,mode:'unavailable',reason:'Open the SharedBoard conversation panel in your AI chat and click Link this chat. Keep the panel and this board open. Your AI app must support panel messages or verified incoming messages.'};
 if(connection.automaticMessages!==true)return needsLink;
 const mode=connection.deliveryMode==='panel'?'panel':'events';
 const deadline=connection.messageExpiresAt??(mode==='panel'?connection.panelExpiresAt:connection.eventExpiresAt);
 const expires=typeof deadline==='number'?deadline:typeof deadline==='string'?Date.parse(deadline):NaN;
 if(!Number.isFinite(expires)||expires<=now)return needsLink;
 return {enabled:true,automatic:true,mode,reason:mode==='panel'?'Direct mini chat is linked. Keep the conversation panel and this board open.':'Direct mini chat is available through verified incoming messages.'};
}
