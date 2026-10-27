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
const active=changes=>({connected:true,automaticMessages:true,deliveryMode:'events',messageExpiresAt:new Date(Date.now()+60_000).toISOString(),...changes});
const live=changes=>active({provider:'codex',deliveryMode:'live-session',liveSession:{id:'22222222-2222-4222-8222-222222222222',status:'waiting',expiresAt:new Date(Date.now()+1_200_000).toISOString(),waitExpiresAt:new Date(Date.now()+40_000).toISOString()},...changes});
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
 assert.match(html,/Saved without automatic delivery/);assert.match(html,/will not replay/);assert.match(html,/Start live collaboration once/);
 assert.doesNotMatch(html,/<form|aria-label="Message the connected model"|Copy to (?:AI|Codex)|Read the same captured request/);
});

test('verified events remain available for every provider while cached panel links stay disabled',()=>{
 for(const provider of ['codex','claude-code','claude','chatgpt','other'])for(const permission of ['read','edit']){
  const connection={provider,permission,connected:true,automaticMessages:false};
  assert.match(chatButton(bubble(connection)),/disabled=/);
  const unavailable=render(BoardChat,{open:true,setOpen:()=>{},view:view(connection)});assert.doesNotMatch(unavailable,/<form/);
  const linked=active({...connection,automaticMessages:true}),html=render(BoardChat,{open:true,setOpen:()=>{},onConnect:()=>{},view:view(linked)});
  assert.doesNotMatch(chatButton(bubble(linked)),/disabled=/);
  assert.match(html,/<form/);assert.match(html,/aria-label="Message the connected model"/);assert.match(html,/>Send<\/button>/);
  assert.doesNotMatch(html,/Copy to (?:AI|Codex)|paste.*request|Link this chat/i);
  if(permission==='read'){assert.match(html,/Read-only drawing access/);assert.match(html,/Change drawing access/);}
  const cached=active({...connection,automaticMessages:true,deliveryMode:'panel',panelConnected:true});
  assert.match(chatButton(bubble(cached)),/disabled=/);assert.doesNotMatch(render(BoardChat,{open:true,setOpen:()=>{},view:view(cached)}),/<form/);
 }
});

test('a verified event connection retains its composer while a disconnected connection exposes history without a send form',()=>{
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
 const available={connected:true,deliveryMode:'events',automaticMessages:true,automaticReviews:false,eventExpiresAt:past,messageExpiresAt:future};
 assert.doesNotMatch(chatButton(bubble(available)),/disabled=/);
 const expired={...available,automaticReviews:true,eventExpiresAt:future,messageExpiresAt:past};
 assert.match(chatButton(bubble(expired)),/disabled=/);
 const openExpired=render(BoardChat,{open:true,setOpen:()=>{},view:view(expired)});assert.match(openExpired,/Automatic mini chat unavailable/);assert.doesNotMatch(openExpired,/<form|Copy to AI|Link this chat/);
});

test('connection choices put coding clients first and distinguish mini-chat availability',()=>{
 const html=render(CloudConnectionSetup,{online:true,onClose:()=>{}});
 const choices=html.match(/<div class="ai-choices">([\s\S]*?)<\/div>/)?.[1]??'';
 assert.deepEqual([...choices.matchAll(/<strong>([^<]+)<\/strong>/g)].map(match=>match[1]),['Codex','Claude Code','ChatGPT','Claude (web)','Other MCP client']);
 assert.equal([...choices.matchAll(/class="client-mini-badge /g)].length,5);
 assert.equal([...choices.matchAll(/Live mini chat · AI session must stay active/g)].length,5);
 assert.match(choices,/Experimental/);assert.match(choices,/only fill a composer draft/);
 assert.doesNotMatch(choices,/Mini chat unavailable|Mini chat needs verification/);
});

test('connection status explains unavailable mini chat without a diagnostic-panel link loop',()=>{
 const props={online:true,onClose:()=>{},onHistory:()=>{},hasSavedRequests:true};
 const manual=render(CloudConnectionSetup,{...props,connection:{id:'manual',provider:'codex',connected:true,automaticMessages:false}});
 assert.match(manual,/<strong>Live mini chat · start an AI session<\/strong>/);assert.match(manual,/Start live collaboration once/);assert.match(manual,/Saved requests &amp; replies/);assert.match(testButton(manual),/disabled=/);
 assert.doesNotMatch(manual,/open_sharedboard_chat|Link this chat|Copy a test|Copy to AI|paste.*prepared/i);
 const automatic=render(CloudConnectionSetup,{...props,connection:active({id:'events',provider:'other',deliveryMode:'events'})});
 assert.match(automatic,/<strong>Automatic mini chat connected<\/strong>/);assert.doesNotMatch(testButton(automatic),/disabled=/);assert.match(automatic,/Saved requests &amp; replies/);assert.match(automatic,/verified incoming messages/i);
 const panel=render(CloudConnectionSetup,{...props,connection:active({id:'panel',provider:'claude',deliveryMode:'panel'})});
 assert.match(panel,/draft-only app messages and diagnostic panels do not enable mini chat/);assert.match(testButton(panel),/disabled=/);assert.doesNotMatch(panel,/Link this chat/);
 const expired=render(CloudConnectionSetup,{...props,connection:active({id:'expired',messageExpiresAt:Date.now()-1})});assert.match(testButton(expired),/disabled=/);
 const unpaired=render(CloudConnectionSetup,props);assert.match(unpaired,/Saved requests &amp; replies/);
});

test('AI understanding checks require the same direct link and never offer a copied request',()=>{
 const planning={project:{title:'Test project',areas:[],notes:[],library:[]},proposals:[],agentActions:[]};
 const props={tab:'proposals',setTab:()=>{},getSync:()=>{},onClose:()=>{},onDiscuss:()=>{}};
 const unavailable=render(PlanningPanel,{...props,view:{...view({connected:true}),planning}});
 assert.match(unavailable,/<button[^>]+disabled=""[^>]*>[^<]+<\/button>/);assert.doesNotMatch(unavailable,/Copy understanding|Copy to AI|Link this chat/);
 const available=render(PlanningPanel,{...props,view:{...view(active()),planning}});
 assert.match(available,/<button class="primary-button" title="[^"]+">Check AI understanding<\/button>/);
 const panel=render(PlanningPanel,{...props,view:{...view(active({deliveryMode:'panel'})),planning}});assert.match(panel,/<button[^>]+disabled=""[^>]*>[^<]+<\/button>/);
});

test('saved queued records do not claim submission when panel delivery is disabled or events expired',()=>{
 const saved={id:'saved-draft',text:'Keep the original pending question',intent:'discuss',boardRevision:3,delivery:'queued',receipt:'panel_original'};
 for(const connection of [active({provider:'claude',deliveryMode:'panel'}),active({messageExpiresAt:Date.now()-1000}),{connected:false}]){
  const html=render(BoardChat,{open:true,setOpen:()=>{},view:{...view(connection),messages:[saved]}});
  assert.match(html,/Keep the original pending question/);assert.match(html,/Automatic submission is unverified\. Check its AI conversation before retrying\./);
  assert.doesNotMatch(html,/Queued (?:in|for) your|replies when ready|Copy to AI|Retry delivery/);
 }
 const replied=render(BoardChat,{open:true,setOpen:()=>{},view:{...view({connected:true,provider:'claude'}),messages:[{...saved,reply:'Keep the actual answer'}]}});
 assert.match(replied,/Keep the actual answer/);assert.doesNotMatch(replied,/Automatic submission is unverified/);
});

test('finite live waiting enables mini chat for both drawing permissions and exposes pause',()=>{
 for(const provider of ['codex','claude-code','claude','chatgpt','other'])for(const permission of ['read','edit']){
  const connection=live({provider,permission});assert.doesNotMatch(chatButton(bubble(connection)),/disabled=/);
  const html=render(BoardChat,{open:true,setOpen:()=>{},onStopLive:()=>{},view:view(connection)});
  assert.match(html,/<form/);assert.match(html,/aria-label="Message the connected model"/);assert.match(html,/active AI session is waiting/);assert.match(html,/>Pause live collaboration<\/button>/);assert.match(html,/>Send<\/button>/);
  assert.doesNotMatch(html,/Copy to AI|Copy to Codex|Link this chat/);
 }
});

test('processing keeps the draft composer but disables new sends and understanding checks',()=>{
 const connection=live();connection.liveSession={...connection.liveSession,status:'processing',waitExpiresAt:Date.now()-1};connection.automaticMessages=false;
 assert.match(chatButton(bubble(connection)),/disabled=/);
 const html=render(BoardChat,{open:true,setOpen:()=>{},onStopLive:()=>{},view:view(connection)});
 assert.match(html,/<form/);assert.match(html,/AI is not waiting right now/);assert.match(html,/your draft is kept/i);assert.match(html,/<button type="submit" disabled=""/);assert.match(html,/Waiting for AI…/);assert.match(html,/Pause live collaboration/);
 const planning={project:{title:'Test project',areas:[],notes:[],library:[]},proposals:[],agentActions:[]};
 const check=render(PlanningPanel,{tab:'proposals',setTab:()=>{},getSync:()=>{},onClose:()=>{},onDiscuss:()=>{},view:{...view(connection),planning}});
 assert.match(check,/<button class="primary-button" disabled="" title="The AI is not waiting/);
});

test('ended live sessions stop new sends while retaining actual replies and accepted request state',()=>{
 const waiting=live(),receipt='live_'+'a'.repeat(64),messages=[{id:'accepted',text:'Original captured question',intent:'discuss',boardRevision:3,delivery:'queued',receipt,liveSessionId:waiting.liveSession.id},{id:'answered',text:'Earlier question',intent:'discuss',boardRevision:3,reply:'Actual AI answer'}];
 for(const status of ['stopped','expired']){
  const connection={...waiting,liveSession:{...waiting.liveSession,status}},html=render(BoardChat,{open:true,setOpen:()=>{},onStopLive:()=>{},view:{...view(connection),messages}});
  assert.doesNotMatch(html,/<form|Pause live collaboration|Retry delivery/);assert.match(html,/Start or resume live collaboration once/);assert.match(html,/Original captured question/);assert.match(html,/Accepted by the live AI session/);assert.match(html,/Actual AI answer/);
 }
 const disconnected=render(BoardChat,{open:true,setOpen:()=>{},view:{...view({connected:false}),messages}});assert.match(disconnected,/Accepted by the live AI session/);assert.match(disconnected,/Actual AI answer/);assert.doesNotMatch(disconnected,/<form|Retry delivery/);
});

test('an old live or panel request never offers replay into a replacement session',()=>{
 const connection=live(),messages=[{id:'old-live',text:'Preserve old live capture',intent:'discuss',boardRevision:3,delivery:'failed',receipt:'live_'+'b'.repeat(64),liveSessionId:'33333333-3333-4333-8333-333333333333'},{id:'old-panel',text:'Preserve draft-only panel capture',intent:'discuss',boardRevision:3,delivery:'uncertain',receipt:'panel_old'},{id:'same-live',text:'Same session uncertain request',intent:'discuss',boardRevision:3,delivery:'uncertain',liveSessionId:connection.liveSession.id}];
 const html=render(BoardChat,{open:true,setOpen:()=>{},view:{...view(connection),messages}});
 assert.match(html,/Preserve old live capture/);assert.match(html,/Preserve draft-only panel capture/);assert.equal([...html.matchAll(/I checked my chat · retry/g)].length,1);assert.doesNotMatch(html,/Copy to AI|Copy to Codex/);
});

test('live-session setup requires one-time AI start and explains finite runs, usage and pause',()=>{
 const props={online:true,onClose:()=>{},onStopLive:()=>{},onHistory:()=>{}},waiting=live({id:'connection',boardId:board.id}),html=render(CloudConnectionSetup,{...props,connection:waiting});
 assert.match(html,/Live AI session · waiting/);assert.doesNotMatch(testButton(html),/disabled=/);assert.match(html,/Start live collaboration · experimental/);assert.match(html,/Copy start instructions/);assert.match(html,/wait_for_board_request/);assert.match(html,/at most 20 minutes/);assert.match(html,/can use your AI allowance even when no message arrives/);assert.match(html,/cannot wake a closed or ended run/);assert.match(html,/Pause live collaboration/);assert.match(html,/Do not create another chat, scheduled polling monitor/);assert.match(html,/reply_to_chat_message/);assert.doesNotMatch(html,/Link this chat|Copy to AI/);
 const processing=render(CloudConnectionSetup,{...props,connection:{...waiting,automaticMessages:false,liveSession:{...waiting.liveSession,status:'processing'}}});assert.match(processing,/Live AI session · not waiting/);assert.match(testButton(processing),/disabled=/);assert.match(processing,/Pause live collaboration/);
 const expired=render(CloudConnectionSetup,{...props,connection:{...waiting,liveSession:{...waiting.liveSession,status:'expired'}}});assert.match(testButton(expired),/disabled=/);assert.doesNotMatch(expired,/Pause live collaboration/);
});

test('start instructions resume the exact active live ID and only omit it after the session ends',()=>{
 const original=live({id:'connection',boardId:board.id}),props={online:true,onClose:()=>{},onStopLive:()=>{}};
 const instructions=connection=>render(CloudConnectionSetup,{...props,connection}).match(/<textarea aria-label="Start live collaboration instructions"[^>]*>([\s\S]*?)<\/textarea>/)?.[1]??'';
 for(const status of ['waiting','processing']){
  const text=instructions({...original,liveSession:{...original.liveSession,status}});assert.match(text,/Resume the current live session/);assert.ok(text.includes(original.liveSession.id));assert.match(text,/Do not omit sessionId or create a replacement session/);assert.doesNotMatch(text,/without sessionId on the first call/);
 }
 for(const liveSession of [undefined,{...original.liveSession,status:'stopped'},{...original.liveSession,status:'expired'},{...original.liveSession,status:'processing',expiresAt:Date.now()-1}]){
  const text=instructions({...original,liveSession});assert.match(text,/without sessionId on the first call/);assert.doesNotMatch(text,/Resume the current live session/);assert.ok(!text.includes(original.liveSession.id));
 }
});
