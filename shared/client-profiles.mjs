// Copyright (c) 2026 Andrew Barresi. SPDX-License-Identifier: MIT
// Client names never prove a working route into an existing conversation.
// MCP App text support can mean draft-only. Mini chat needs verified events
// or an actual pending wait in a finite, active AI collaboration session.
export const CLIENT_PROFILES=Object.freeze([
 {id:'codex',label:'Codex',miniChat:'verify',miniChatLabel:'Live mini chat · AI session must stay active',detail:'Experimental. Requires remote board tools and an active wait in your existing AI run.'},
 {id:'claude-code',label:'Claude Code',miniChat:'verify',miniChatLabel:'Live mini chat · AI session must stay active',detail:'Experimental. Requires remote board tools and an active wait in your existing AI run.'},
 {id:'chatgpt',label:'ChatGPT',miniChat:'verify',miniChatLabel:'Live mini chat · AI session must stay active',detail:'Experimental. Your host must keep the wait tool running; its limits need a real test.'},
 {id:'claude',label:'Claude (web)',miniChat:'verify',miniChatLabel:'Live mini chat · AI session must stay active',detail:'Experimental active-run mode. Claude app messages alone only fill a composer draft.'},
 {id:'other',label:'Other MCP client',miniChat:'verify',miniChatLabel:'Live mini chat · AI session must stay active',detail:'Experimental. Requires remote MCP and a host that can keep the wait tool active.'},
].map(profile=>Object.freeze(profile)));
export const clientProfile=id=>CLIENT_PROFILES.find(profile=>profile.id===id)??null;
export const isClientProvider=id=>Boolean(clientProfile(id));

export function miniChatState(connection,now=Date.now()){
 if(connection?.connected!==true||connection.revoked)return {enabled:false,automatic:false,mode:'unavailable',reason:'Connect an AI to use Talk it through.'};
 if(connection.browserOnline===false||connection.relayAvailable===false)return {enabled:false,automatic:false,mode:'unavailable',reason:'Mini chat is offline. Keep this board connected and try again.'};
 const deadline=value=>typeof value==='number'?value:typeof value==='string'?Date.parse(value):NaN;
 const live=connection.liveSession,sessionActive=Boolean(typeof live?.id==='string'&&live.id.trim()&&['waiting','processing'].includes(live.status)&&Number.isFinite(deadline(live.expiresAt))&&deadline(live.expiresAt)>now);
 if(connection.deliveryMode==='live-session'){
  if(sessionActive&&live.status==='processing')return {enabled:false,automatic:false,mode:'live-session',phase:'processing',sessionActive:true,reason:'The AI is not waiting right now; your draft is kept until it resumes. New sends open when the same live session calls the wait tool again.'};
  if(sessionActive&&live.status==='waiting'&&connection.automaticMessages===true&&Number.isFinite(deadline(live.waitExpiresAt))&&deadline(live.waitExpiresAt)>now)return {enabled:true,automatic:true,mode:'live-session',phase:'waiting',sessionActive:true,reason:'Your active AI session is waiting for a board request. Keep that run and this board open.'};
  return {enabled:false,automatic:false,mode:'live-session',phase:live?.status??'inactive',sessionActive,reason:'Start or resume live collaboration once in your AI conversation. Mini chat opens while its wait tool is active; it cannot wake an ended or closed AI run. Board tools remain available.'};
 }
 const reason='Start live collaboration once in your AI conversation, or use a verified incoming-event connection. A live session must keep its wait tool active; it cannot wake an ended or closed run. Board tools remain available in your AI chat.';
 const unavailable={enabled:false,automatic:false,mode:'unavailable',reason};
 if(connection.automaticMessages!==true||connection.deliveryMode!=='events')return unavailable;
 const expires=deadline(connection.messageExpiresAt??connection.eventExpiresAt);
 if(!Number.isFinite(expires)||expires<=now)return unavailable;
 return {enabled:true,automatic:true,mode:'events',reason:'Automatic mini chat is available through verified incoming messages.'};
}
