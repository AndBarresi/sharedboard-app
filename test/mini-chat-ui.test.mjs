import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {realpathSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const root=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(import.meta.url),requireWrangler=createRequire(realpathSync(new URL('../node_modules/wrangler/package.json',import.meta.url)));
const {build}=requireWrangler('esbuild');
const compiled=await build({stdin:{contents:"export {BoardChat} from './src/BoardChat.jsx'; export {DrawingToolbar} from './src/DrawingToolbar.jsx'; export {CloudConnectionSetup} from './src/CloudConnectionSetup.jsx'; export {PlanningPanel} from './src/PlanningPanel.jsx';",resolveDir:root,sourcefile:'mini-chat-ui-entry.mjs'},bundle:true,format:'esm',platform:'node',write:false,loader:{'.css':'empty'},define:{'import.meta.env.VITE_STORAGE_MODE':'"browser"'},plugins:[{name:'ui-render-dependencies',setup(builder){
 builder.onResolve({filter:/^react$/},()=>({path:pathToFileURL(require.resolve('react')).href,external:true}));
 // Toolbar editing behavior has separate integration tests. These exports are not
 // invoked by server rendering; the fixture isolates its accessibility controls.
 builder.onResolve({filter:/^@excalidraw\/excalidraw$/},()=>({path:'drawing-editor',namespace:'ui-render'}));
 builder.onLoad({filter:/.*/,namespace:'ui-render'},()=>({contents:'export const CaptureUpdateAction={}; export const restoreElements=value=>value; export const convertToExcalidrawElements=value=>value; export const exportToBlob=()=>{throw new Error("Canvas export is outside this UI fixture")};',loader:'js'}));
}}]});
const {BoardChat,DrawingToolbar,CloudConnectionSetup,PlanningPanel}=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const render=(component,props)=>renderToStaticMarkup(React.createElement(component,props));
const board={id:'11111111-1111-4111-8111-111111111111',revision:3,elements:[]};
const view=connection=>({board,storageMode:'browser',chatConnected:Boolean(connection?.connected),connection,messages:[],selectedIds:[],online:true,planning:{project:{areas:[]}}});
const bubble=connection=>render(BoardChat,{open:false,focused:false,setOpen:()=>{},view:view(connection)});
const chatButton=html=>html.match(/<button[^>]*aria-label="(?:Open board chat(?:, new reply)?|Talk it through unavailable)"[^>]*>/)?.[0]??'';
const active=changes=>({connected:true,automaticMessages:true,messageExpiresAt:new Date(Date.now()+60_000).toISOString(),...changes});
const testButton=html=>html.match(/<button[^>]*>Test with a reply<\/button>/)?.[0]??'';

test('Talk it through stays unavailable until a direct route is active and online',()=>{
 for(const connection of [null,{provider:'other',connected:false,automaticMessages:true},{connected:true,automaticMessages:false},{connected:true,automaticMessages:true},active({revoked:true}),active({browserOnline:false}),active({relayAvailable:false})]){
  const html=bubble(connection);assert.match(html,/Talk it through/);assert.match(chatButton(html),/disabled=""/);assert.match(chatButton(html),/title="[^"]+"/);
 }
 const html=bubble(active({provider:'other'}));assert.ok(chatButton(html));assert.doesNotMatch(chatButton(html),/disabled=/);
});

test('a connected board without direct delivery preserves history, removes handoffs, and has no composer',()=>{
 const connection={provider:'codex',connected:true,automaticMessages:false,permission:'read'};
 const savedView={...view(connection),messages:[{id:'old-reply',boardRevision:3,intent:'discuss',text:'Keep this saved question',reply:'Keep this actual answer',repliedAt:'2026-10-27T12:00:00Z'},{id:'saved-handoff',boardRevision:3,intent:'discuss',text:'Prepared request',delivery:'manual',handoffPrompt:'Read the same captured request'}]};
 const html=render(BoardChat,{open:true,setOpen:()=>{},onConnect:()=>{},view:savedView});
 assert.match(html,/Saved board requests/);assert.match(html,/Keep this saved question/);assert.match(html,/Keep this actual answer/);assert.match(html,/Prepared request/);
 assert.match(html,/Saved without automatic delivery/);assert.match(html,/will not replay/);assert.match(html,/conversation panel.*Link this chat/);
 assert.doesNotMatch(html,/<form|aria-label="Message the connected model"|Copy to (?:AI|Codex)|Read the same captured request/);
});

test('every provider requires direct delivery, while read and edit grants can both use linked mini chat',()=>{
 for(const provider of ['codex','claude-code','claude','chatgpt','other'])for(const permission of ['read','edit']){
  const connection={provider,permission,connected:true,automaticMessages:false};
  assert.match(chatButton(bubble(connection)),/disabled=/);
  const unavailable=render(BoardChat,{open:true,setOpen:()=>{},view:view(connection)});assert.doesNotMatch(unavailable,/<form/);
  for(const deliveryMode of ['panel','events']){
   const linked=active({...connection,automaticMessages:true,deliveryMode}),html=render(BoardChat,{open:true,setOpen:()=>{},onConnect:()=>{},view:view(linked)});
   assert.doesNotMatch(chatButton(bubble(linked)),/disabled=/);
   assert.match(html,/<form/);assert.match(html,/aria-label="Message the connected model"/);assert.match(html,/>Send<\/button>/);
   assert.doesNotMatch(html,/Copy to (?:AI|Codex)|paste.*request/i);
   if(permission==='read'){assert.match(html,/Read-only drawing access/);assert.match(html,/Change drawing access/);}
   if(deliveryMode==='panel')assert.match(html,/Keep the SharedBoard conversation panel and this board open/);
  }
 }
});

test('a supported connected panel retains its composer while a disconnected panel exposes history without a send form',()=>{
 const linked=render(BoardChat,{open:true,setOpen:()=>{},view:view(active())});assert.match(linked,/<form/);assert.match(linked,/aria-label="Message the connected model"/);
 const disconnectedView={...view({connected:false,automaticMessages:true}),messages:[{id:'preserved',text:'Saved request',reply:'Saved reply',intent:'discuss',boardRevision:3}]};
 const disconnected=render(BoardChat,{open:true,setOpen:()=>{},view:disconnectedView});assert.match(disconnected,/Saved reply/);assert.match(disconnected,/Mini chat unavailable/);assert.doesNotMatch(disconnected,/<form/);
});

test('fullscreen chat entry honors the same disabled capability and explains why',()=>{
 const props={getApi:()=>null,ui:{tool:'selection'},focused:true,onFullscreen:()=>{},onChat:()=>{},chatDisabled:true,chatUnavailableReason:'This client has no active message subscription'};
 const disabled=chatButton(render(DrawingToolbar,props));assert.match(disabled,/disabled=""/);assert.match(disabled,/title="This client has no active message subscription"/);
 assert.doesNotMatch(chatButton(render(DrawingToolbar,{...props,chatDisabled:false})),/disabled=/);
});

test('message expiry controls rendered mini chat independently of an earlier review expiry',()=>{
 const future=new Date(Date.now()+60_000).toISOString(),past=new Date(Date.now()-1000).toISOString();
 const available={connected:true,automaticMessages:true,automaticReviews:false,eventExpiresAt:past,messageExpiresAt:future};
 assert.doesNotMatch(chatButton(bubble(available)),/disabled=/);
 const expired={...available,automaticReviews:true,eventExpiresAt:future,messageExpiresAt:past};
 assert.match(chatButton(bubble(expired)),/disabled=/);
 const openExpired=render(BoardChat,{open:true,setOpen:()=>{},view:view(expired)});assert.match(openExpired,/Direct mini chat needs a link/);assert.doesNotMatch(openExpired,/<form|Copy to AI/);
});

test('connection choices put coding clients first and distinguish mini-chat availability',()=>{
 const html=render(CloudConnectionSetup,{online:true,onClose:()=>{}});
 const choices=html.match(/<div class="ai-choices">([\s\S]*?)<\/div>/)?.[1]??'';
 assert.deepEqual([...choices.matchAll(/<strong>([^<]+)<\/strong>/g)].map(match=>match[1]),['Codex','Claude Code','ChatGPT','Claude (web)','Other MCP client']);
 assert.equal([...choices.matchAll(/class="client-mini-badge /g)].length,5);
 assert.equal([...choices.matchAll(/Direct mini chat · Link in your AI/g)].length,5);
 assert.match(choices,/Direct chat needs a supported conversation panel/);
 assert.doesNotMatch(choices,/Mini chat unavailable|Mini chat needs verification/);
});

test('connection status instructs linking and enables tests only for actual direct support',()=>{
 const props={online:true,onClose:()=>{},onHistory:()=>{},hasSavedRequests:true};
 const manual=render(CloudConnectionSetup,{...props,connection:{id:'manual',provider:'codex',connected:true,automaticMessages:false}});
 assert.match(manual,/<strong>Direct mini chat needs a link<\/strong>/);assert.match(manual,/open_sharedboard_chat/);assert.match(manual,/Link this chat/);assert.match(manual,/Saved requests &amp; replies/);assert.match(testButton(manual),/disabled=/);
 assert.doesNotMatch(manual,/Copy a test|Copy to AI|paste.*prepared/i);
 const automatic=render(CloudConnectionSetup,{...props,connection:active({id:'events',provider:'other',deliveryMode:'events'})});
 assert.match(automatic,/<strong>Direct mini chat linked<\/strong>/);assert.doesNotMatch(testButton(automatic),/disabled=/);assert.match(automatic,/Saved requests &amp; replies/);assert.match(automatic,/Verified incoming messages/);
 const panel=render(CloudConnectionSetup,{...props,connection:active({id:'panel',provider:'claude',deliveryMode:'panel'})});
 assert.match(panel,/Keep that panel and this board open/);assert.doesNotMatch(testButton(panel),/disabled=/);
 const expired=render(CloudConnectionSetup,{...props,connection:active({id:'expired',messageExpiresAt:Date.now()-1})});assert.match(testButton(expired),/disabled=/);
 const unpaired=render(CloudConnectionSetup,props);assert.match(unpaired,/Saved requests &amp; replies/);
});

test('AI understanding checks require the same direct link and never offer a copied request',()=>{
 const planning={project:{title:'Test project',areas:[],notes:[],library:[]},proposals:[],agentActions:[]};
 const props={tab:'proposals',setTab:()=>{},getSync:()=>{},onClose:()=>{},onDiscuss:()=>{}};
 const unavailable=render(PlanningPanel,{...props,view:{...view({connected:true}),planning}});
 assert.match(unavailable,/<button[^>]+disabled=""[^>]*>Link direct mini chat to check understanding<\/button>/);assert.doesNotMatch(unavailable,/Copy understanding|Copy to AI/);
 const available=render(PlanningPanel,{...props,view:{...view(active({deliveryMode:'panel'})),planning}});
 assert.match(available,/<button class="primary-button" title="[^"]+">Check AI understanding<\/button>/);assert.match(available,/Keep its SharedBoard panel and this board open/);
});
