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
const compiled=await build({stdin:{contents:"export {BoardChat} from './src/BoardChat.jsx'; export {DrawingToolbar} from './src/DrawingToolbar.jsx'; export {CloudConnectionSetup} from './src/CloudConnectionSetup.jsx';",resolveDir:root,sourcefile:'mini-chat-ui-entry.mjs'},bundle:true,format:'esm',platform:'node',write:false,loader:{'.css':'empty'},define:{'import.meta.env.VITE_STORAGE_MODE':'"browser"'},plugins:[{name:'ui-render-dependencies',setup(builder){
 builder.onResolve({filter:/^react$/},()=>({path:pathToFileURL(require.resolve('react')).href,external:true}));
 // Toolbar editing behavior has separate integration tests. These exports are not
 // invoked by server rendering; the fixture isolates its accessibility controls.
 builder.onResolve({filter:/^@excalidraw\/excalidraw$/},()=>({path:'drawing-editor',namespace:'ui-render'}));
 builder.onLoad({filter:/.*/,namespace:'ui-render'},()=>({contents:'export const CaptureUpdateAction={}; export const restoreElements=value=>value;',loader:'js'}));
}}]});
const {BoardChat,DrawingToolbar,CloudConnectionSetup}=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const render=(component,props)=>renderToStaticMarkup(React.createElement(component,props));
const board={id:'11111111-1111-4111-8111-111111111111',revision:3,elements:[]};
const view=connection=>({board,storageMode:'browser',chatConnected:Boolean(connection?.connected),connection,messages:[],selectedIds:[],online:true,planning:{project:{areas:[]}}});
const bubble=connection=>render(BoardChat,{open:false,focused:false,setOpen:()=>{},view:view(connection)});
const chatButton=html=>html.match(/<button[^>]*aria-label="(?:Open board chat(?:, new reply)?|Talk it through unavailable)"[^>]*>/)?.[0]??'';

test('Talk it through stays unavailable only for disconnected, revoked or offline connections',()=>{
 for(const connection of [null,{provider:'other',connected:false,automaticMessages:true},{connected:true,revoked:true},{connected:true,browserOnline:false},{connected:true,relayAvailable:false}]){
  const html=bubble(connection);assert.match(html,/Talk it through/);assert.match(chatButton(html),/disabled=""/);assert.match(chatButton(html),/title="[^"]+"/);
 }
 const active=bubble({provider:'other',connected:true,automaticMessages:true,eventExpiresAt:new Date(Date.now()+60_000).toISOString()});assert.ok(chatButton(active));assert.doesNotMatch(chatButton(active),/disabled=/);
});

test('a manual connected panel retains captured history, handoff instructions and a usable composer',()=>{
 const connection={provider:'codex',connected:true,automaticMessages:false,permission:'read'};
 const savedView={...view(connection),messages:[{id:'old-reply',boardRevision:3,intent:'discuss',text:'Keep this saved question',reply:'Keep this actual answer',repliedAt:'2026-10-27T12:00:00Z'},{id:'saved-handoff',boardRevision:3,intent:'discuss',text:'Prepared request',delivery:'manual',handoffPrompt:'Read the same captured request'}]};
 const html=render(BoardChat,{open:true,setOpen:()=>{},onConnect:()=>{},view:savedView});
 assert.match(html,/Let’s think together/);assert.match(html,/Keep this saved question/);assert.match(html,/Keep this actual answer/);assert.match(html,/Read the same captured request/);
 assert.match(html,/<form/);assert.match(html,/aria-label="Message the connected model"/);assert.match(html,/Copy to Codex/);assert.match(html,/Read-only drawing access/);assert.match(html,/Change drawing access/);
});

test('every connected provider can compose manually with read or edit permission',()=>{
 for(const provider of ['codex','claude-code','claude','chatgpt','other'])for(const permission of ['read','edit']){
  const connection={provider,permission,connected:true,automaticMessages:false};
  assert.doesNotMatch(chatButton(bubble(connection)),/disabled=/);
  const html=render(BoardChat,{open:true,setOpen:()=>{},view:view(connection)});
  assert.match(html,/<form/);assert.match(html,/copy the request into your connected AI chat/);assert.match(html,provider==='codex'?/Copy to Codex/:/Copy to AI/);
 }
});

test('a supported connected panel retains its composer while a disconnected panel exposes history without a send form',()=>{
 const active=render(BoardChat,{open:true,setOpen:()=>{},view:view({connected:true,automaticMessages:true})});assert.match(active,/<form/);assert.match(active,/aria-label="Message the connected model"/);
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
 assert.doesNotMatch(chatButton(bubble(expired)),/disabled=/);
 const openExpired=render(BoardChat,{open:true,setOpen:()=>{},view:view(expired)});assert.match(openExpired,/Copy to AI/);assert.match(openExpired,/<form/);assert.doesNotMatch(openExpired,/Mini chat unavailable/);
});

test('connection choices put coding clients first and distinguish mini-chat availability',()=>{
 const html=render(CloudConnectionSetup,{online:true,onClose:()=>{}});
 const choices=html.match(/<div class="ai-choices">([\s\S]*?)<\/div>/)?.[1]??'';
 assert.deepEqual([...choices.matchAll(/<strong>([^<]+)<\/strong>/g)].map(match=>match[1]),['Codex','Claude Code','ChatGPT','Claude (web)','Other MCP client']);
 assert.equal([...choices.matchAll(/class="client-mini-badge /g)].length,5);
 assert.equal([...choices.matchAll(/Mini chat · Copy to AI/g)].length,5);
 assert.match(choices,/Automatic delivery when your connection supports it/);
 assert.doesNotMatch(choices,/Mini chat unavailable|Mini chat needs verification/);
});

test('connection status retains saved-request access for manual clients and advertises only actual automatic support',()=>{
 const props={online:true,onClose:()=>{},onHistory:()=>{},hasSavedRequests:true};
 const manual=render(CloudConnectionSetup,{...props,connection:{id:'manual',provider:'codex',connected:true,automaticMessages:false}});
 assert.match(manual,/<strong>Mini chat available · Copy to AI<\/strong>/);assert.match(manual,/Write in Talk it through/);assert.match(manual,/Saved requests &amp; replies/);assert.match(manual,/Copy a test to AI/);
 const automatic=render(CloudConnectionSetup,{...props,connection:{id:'events',provider:'other',connected:true,automaticMessages:true,messageExpiresAt:new Date(Date.now()+60_000).toISOString()}});
 assert.match(automatic,/<strong>Mini chat available · Automatic<\/strong>/);assert.match(automatic,/Test with a reply/);assert.match(automatic,/Saved requests &amp; replies/);
 const unpaired=render(CloudConnectionSetup,props);assert.match(unpaired,/Saved requests &amp; replies/);
});
