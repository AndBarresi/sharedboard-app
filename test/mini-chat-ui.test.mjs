import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {realpathSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {chatStorageKey} from '../src/chat-format.mjs';
import {claudeChannelSetup,codexChannelSetup} from '../shared/connection-instructions.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(import.meta.url),requireWrangler=createRequire(realpathSync(new URL('../node_modules/wrangler/package.json',import.meta.url)));
const {build}=requireWrangler('esbuild');
const compiled=await build({stdin:{contents:"export {BoardChat} from './src/BoardChat.jsx'; export {DrawingToolbar,ShapesMenu} from './src/DrawingToolbar.jsx'; export {CloudConnectionSetup,ClaudeChannelSteps,CodexChannelSteps} from './src/CloudConnectionSetup.jsx'; export {PlanningPanel} from './src/PlanningPanel.jsx';",resolveDir:root,sourcefile:'mini-chat-ui-entry.mjs'},bundle:true,format:'esm',platform:'node',write:false,loader:{'.css':'empty'},define:{'import.meta.env.VITE_STORAGE_MODE':'"browser"'},plugins:[{name:'ui-render-dependencies',setup(builder){
 builder.onResolve({filter:/^(?:react|react-dom)$/},args=>({path:pathToFileURL(require.resolve(args.path)).href,external:true}));
 // Toolbar editing behavior has separate integration tests. These exports are not
 // invoked by server rendering; the fixture isolates its accessibility controls.
 builder.onResolve({filter:/^@excalidraw\/excalidraw$/},()=>({path:'drawing-editor',namespace:'ui-render'}));
 builder.onLoad({filter:/.*/,namespace:'ui-render'},()=>({contents:'export const CaptureUpdateAction={}; export const restoreElements=value=>value; export const convertToExcalidrawElements=value=>value; export const exportToBlob=()=>{throw new Error("Canvas export is outside this UI fixture")};',loader:'js'}));
}}]});
const {BoardChat,DrawingToolbar,ShapesMenu,CloudConnectionSetup,ClaudeChannelSteps,CodexChannelSteps,PlanningPanel}=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
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

test('drawing toolbar exposes discoverable pointer, style and help controls while explaining unavailable Imagine',()=>{
 const props={getApi:()=>null,ui:{tool:'laser'},focused:false,onFullscreen:()=>{},onImagine:()=>{},imagineDisabled:true,imagineUnavailableReason:'Select objects to imagine them'};
 const html=render(DrawingToolbar,props),control=label=>html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))?.[0]??'';
 assert.match(control('Laser pointer \\(K\\)'),/aria-pressed="true"/);
 assert.ok(control('More tools'));assert.ok(control('Drawing style'));assert.ok(control('Info &amp; keyboard shortcuts'));
 assert.match(control('Imagine selection'),/disabled=""/);assert.match(control('Imagine selection'),/title="Select objects to imagine them"/);
 const available=render(DrawingToolbar,{...props,imagineDisabled:false});
 assert.doesNotMatch(available.match(/<button[^>]*aria-label="Imagine selection"[^>]*>/)?.[0]??'',/disabled=/);
});

test('one Shapes control groups native geometry while the open menu exposes its choices and circle/square gestures',()=>{
 const html=render(DrawingToolbar,{getApi:()=>null,ui:{tool:'ellipse'},focused:false,onFullscreen:()=>{}});
 assert.equal([...html.matchAll(/aria-label="Shapes"/g)].length,1);
 assert.match(html,/<button[^>]*aria-label="Shapes"[^>]*aria-pressed="true"[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"/);
 assert.doesNotMatch(html,/aria-label="(?:Rectangle|Diamond|Ellipse) \(/);
 assert.match(html,/aria-label="Arrow \(A \/ 5\)"/);assert.match(html,/aria-label="Line \(L \/ 6\)"/);
 const menu=render(ShapesMenu,{selected:'ellipse',onChoose:()=>{},onClose:()=>{}});
 assert.match(menu,/role="menu" aria-label="Shapes"/);assert.equal([...menu.matchAll(/role="menuitemradio"/g)].length,3);
 assert.match(menu,/aria-checked="true"[^>]*>[\s\S]*?Ellipse/);assert.equal([...menu.matchAll(/aria-checked="true"/g)].length,1);
 for(const label of ['Rectangle','Diamond','Ellipse','Hold Shift for a square','Hold Shift for a circle','R / 2','D / 3','O / 4'])assert.ok(menu.includes(label));
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
 assert.deepEqual([...choices.matchAll(/<strong>([^<]+)<\/strong>/g)].map(match=>match[1]),['Codex','Claude Code','ChatGPT Work Cloud','Claude (web)','Other MCP client']);
 assert.equal([...choices.matchAll(/class="client-mini-badge /g)].length,5);
 assert.equal([...choices.matchAll(/Live mini chat · AI session must stay active/g)].length,2);assert.match(choices,/Automatic mini chat · native event setup/);assert.match(choices,/Automatic mini chat · Channels plugin setup/);assert.match(choices,/Automatic mini chat · local plugin setup/);
 assert.match(choices,/Experimental/);assert.match(choices,/only fill a composer draft/);
 assert.doesNotMatch(choices,/Mini chat unavailable|Mini chat needs verification/);
});

test('Claude Code channel setup requires an authenticated live process and actual proof, while legacy remote grants stay finite',()=>{
 const connection={id:'channel-connection',boardId:board.id,provider:'claude-code',permission:'read',connected:true,browserOnline:true,deliveryMode:'claude-channel',channelConnected:true,channelSessionId:'current-process',channelExpiresAt:Date.now()+60000,channelVerified:false,automaticMessages:false,automaticReviews:false},props={online:true,onClose:()=>{}};
 const pending=render(CloudConnectionSetup,{...props,connection});assert.match(pending,/Claude Code · test reply needed/);assert.doesNotMatch(pending.match(/<button[^>]*>Test automatic reply<\/button>/)?.[0]??'',/disabled=/);assert.match(chatButton(bubble(connection)),/disabled=/);assert.match(pending,/an actual read and reply verifies delivery/);assert.match(pending,/Pair a restarted Claude Code session/);assert.match(pending,/earlier requests will not replay/);assert.doesNotMatch(pending,/Start live collaboration · experimental|Copy native setup instructions|Add custom connector/);
 const verified={...connection,channelVerified:true,automaticMessages:true,automaticReviews:true};assert.doesNotMatch(chatButton(bubble(verified)),/disabled=/);assert.match(render(CloudConnectionSetup,{...props,connection:verified}),/automatic reply verified/);
 const expired={...verified,channelExpiresAt:Date.now()-1};assert.match(chatButton(bubble(expired)),/disabled=/);assert.match(render(CloudConnectionSetup,{...props,connection:expired}).match(/<button[^>]*>Test automatic reply<\/button>/)?.[0]??'',/disabled=/);
 const legacy=render(CloudConnectionSetup,{...props,connection:{...connection,deliveryMode:'manual',channelConnected:undefined}});assert.match(legacy,/Start live collaboration · experimental/);assert.match(legacy,/wait_for_board_request/);assert.doesNotMatch(legacy,/Pair a restarted Claude Code session|Test automatic reply/);
});

test('Claude Code install steps show only plugin pairing with honest runtime, preview and restart instructions',()=>{
 const setup=claudeChannelSetup({connectionCode:`${board.id}.${'a'.repeat(64)}`}),html=render(ClaudeChannelSteps,{setup,expires:120,copied:'',copy:()=>{}});
 assert.match(html,/Node.js 22 or newer/);assert.match(html,/Claude Code 2.1.275/);assert.match(html,/plugin install sharedboard --marketplace https:\/\/sharedboard.app\/claude-marketplace.json/);assert.match(html,/claude --resume --dangerously-load-development-channels/);assert.match(html,/must be enabled for each session/);assert.match(html,/does not bypass tool permissions/);assert.match(html,/sharedboard:connect/);assert.match(html,/Restarting Claude Code needs a fresh connection code/);assert.doesNotMatch(html,/MCP server URL|OAuth|Register automatically|wait_for_board_request|everything included/);
 assert.match(html,/Pro\/Max, eligible Team\/Enterprise/);assert.match(html,/separately billed Claude Console API access/);assert.match(html,/Free Claude alone is insufficient/);assert.match(html,/organization must allow Channels/);
 const expired=render(ClaudeChannelSteps,{setup,expires:0,copied:'',copy:()=>{}});assert.match(expired,/<button type="button" class="connect-primary" disabled="">Copy one-use connect command<\/button>/);
});

test('Codex plugin setup requires actual reply proof and uses its own supported install and connect path',()=>{
 const connection={id:'codex-channel-connection',boardId:board.id,provider:'codex',permission:'read',connected:true,browserOnline:true,deliveryMode:'codex-channel',channelConnected:true,channelSessionId:'codex-process',channelExpiresAt:Date.now()+60000,channelVerified:false,automaticMessages:false,automaticReviews:false},props={online:true,onClose:()=>{}};
 const pending=render(CloudConnectionSetup,{...props,connection});assert.match(pending,/Codex · test reply needed/);assert.match(pending,/Codex plugin guidance/);assert.match(pending,/Pair a restarted Codex session/);assert.doesNotMatch(pending,/dangerously-load-development-channels|Claude Code Channels guidance|Start live collaboration · experimental/);assert.match(chatButton(bubble(connection)),/disabled=/);assert.doesNotMatch(pending.match(/<button[^>]*>Test automatic reply<\/button>/)?.[0]??'',/disabled=/);
 const verified={...connection,channelVerified:true,automaticMessages:true,automaticReviews:true};assert.doesNotMatch(chatButton(bubble(verified)),/disabled=/);assert.match(render(CloudConnectionSetup,{...props,connection:verified}),/Codex · automatic reply verified/);
 const legacy=render(CloudConnectionSetup,{...props,connection:{...connection,deliveryMode:'manual'}});assert.match(legacy,/Start live collaboration · experimental/);assert.match(legacy,/has not been converted to a local plugin/);assert.doesNotMatch(legacy,/Pair a restarted Codex session/);
 const setup=codexChannelSetup({connectionCode:`${board.id}.${'b'.repeat(64)}`}),steps=render(CodexChannelSteps,{setup,expires:120,copied:'',copy:()=>{}});assert.match(steps,/codex plugin marketplace add AndBarresi\/sharedboard-app/);assert.match(steps,/codex plugin add sharedboard@sharedboard/);assert.match(steps,/\$sharedboard-connect/);assert.match(steps,/actual native conversation ID from CODEX_THREAD_ID/);assert.match(steps,/queue receipt only acknowledges routing/);assert.match(steps,/Node.js 22 or newer/);assert.doesNotMatch(steps,/dangerously-load-development-channels|claude-marketplace.json|OAuth|codex:\/\//);
 const expired=render(CodexChannelSteps,{setup,expires:0,copied:'',copy:()=>{}});assert.match(expired,/<button type="button" class="connect-primary" disabled="">Copy one-use connect prompt<\/button>/);
});

test('a saved bootstrap test replaces setup prompts and blocks a new test only for its current board and process',()=>{
 for(const [provider,deliveryMode] of [['codex','codex-channel'],['claude-code','claude-channel']]){
  const connection={id:'current-connection',boardId:board.id,provider,permission:'read',connected:true,browserOnline:true,deliveryMode,channelConnected:true,channelSessionId:'current-process',channelExpiresAt:Date.now()+60000,channelVerified:false,automaticMessages:false,automaticReviews:false};
  const base={id:'original-test',boardId:board.id,connectionId:connection.id,channelSessionId:connection.channelSessionId,deliveryMode,channelTest:true,text:'Original saved test',intent:'discuss',boardRevision:3,status:'waiting'};
  for(const [changes,title] of [[{delivery:'pending'},'Test saved · delivery pending'],[{delivery:'queued',receipt:'ch_chat_original-test'},'Test queued · waiting for reply'],[{delivery:'queued',receipt:'ch_chat_original-test',status:'reading'},'Test read · waiting for reply'],[{delivery:'uncertain'},'Test delivery unconfirmed'],[{delivery:'failed'},'Saved test · retry needed']]){
   const message={...base,...changes},props={connection,messages:[message],online:true,onClose:()=>{},onHistory:()=>{},hasSavedRequests:true};
   const setup=render(CloudConnectionSetup,props),chat=render(BoardChat,{open:true,setOpen:()=>{},onConnect:()=>{},retry:()=>{},view:{...view(connection),messages:[message]}});
   assert.ok(setup.includes(title));assert.ok(chat.includes(title));assert.match(setup,/<button type="button" class="connect-primary" disabled="">(?:Sending saved test…|Waiting for test reply…|Check saved test|Use saved test retry)<\/button>/);
   assert.doesNotMatch(setup,/is connected\. Choose Test automatic reply once/);assert.doesNotMatch(chat,/is connected\. Choose Test automatic reply once|<form/);assert.match(chat,/Original saved test/);
   if(changes.delivery==='uncertain')assert.match(chat,/I checked my chat · retry/);else if(changes.delivery==='failed')assert.match(chat,/Retry delivery/);else assert.doesNotMatch(chat,/I checked my chat · retry|Retry delivery/);
  }
  for(const changes of [{connectionId:'earlier-connection'},{boardId:'different-board'},{boardId:undefined},{channelSessionId:'earlier-process'},{deliveryMode:deliveryMode==='codex-channel'?'claude-channel':'codex-channel'},{reply:'Actual completed test answer',status:'answered'}]){
   const messages=[{...base,delivery:'queued',receipt:'ch_chat_original-test',...changes}],setup=render(CloudConnectionSetup,{connection,messages,online:true,onClose:()=>{}});
   assert.match(setup,/<button type="button" class="connect-primary">Test automatic reply<\/button>/);assert.match(setup,/test reply needed/);assert.doesNotMatch(setup,/Test queued · waiting for reply/);
  }
  const verified={...connection,channelVerified:true,automaticMessages:true,automaticReviews:true},answered={...base,delivery:'queued',reply:'Actual completed test answer',status:'answered'};
  const ready=render(CloudConnectionSetup,{connection:verified,messages:[answered],online:true,onClose:()=>{}});assert.match(ready,/automatic reply verified/);assert.doesNotMatch(ready,/Waiting for test reply…/);
 }
});

test('ChatGPT account and browser mismatch help remains conditional and preserves stored work',()=>{
 const id='22222222-2222-4222-8222-222222222222',html=render(CloudConnectionSetup,{online:true,onClose:()=>{},connection:{id,boardId:board.id,provider:'chatgpt',connected:true,deliveryMode:'manual'}});assert.match(html,/If setup reports an existing connection or the wrong board/);assert.match(html,/connector account may still authorize the earlier board/);assert.match(html,/reconnect or re-authorize the SharedBoard connector account/);assert.match(html,/Chrome and the in-app browser have separate board storage/);assert.match(html,/Disconnecting a link keeps the board and saved history/);assert.match(html,/clearing site data or creating a new chat is not a repair step/);
 assert.match(html,/even if the old board tab is unavailable/);assert.match(html,/Copy AI disconnect instructions/);assert.match(html,/Native tasks are not deleted/);assert.match(html,/normal provider reauthorization and fresh pairing are still required/);
 const prompt=html.match(/<textarea aria-label="Exact SharedBoard link disconnect instructions"[^>]*>([\s\S]*?)<\/textarea>/)?.[1]??'';assert.ok(prompt.includes(board.id));assert.ok(prompt.includes(id));assert.match(prompt,/actual boardId and id must exactly match/);assert.match(prompt,/disconnect_board/);
 const incomplete=render(CloudConnectionSetup,{online:true,onClose:()=>{},connection:{id:'unknown',provider:'chatgpt',connected:true,deliveryMode:'manual'}});assert.doesNotMatch(incomplete,/Copy AI disconnect instructions/,'missing trusted IDs cannot create a release prompt');
 assert.doesNotMatch(render(CloudConnectionSetup,{online:true,onClose:()=>{},connection:{id:'codex-board',provider:'codex',connected:true,deliveryMode:'manual'}}),/Replace an existing ChatGPT board or conversation link/);
});

test('Claude channel keeps the next draft and same-process proof retry while refusing old-process replay',()=>{
 const connection={id:'channel-connection',boardId:board.id,provider:'claude-code',connected:true,browserOnline:true,deliveryMode:'claude-channel',channelConnected:true,channelSessionId:'current-process',channelExpiresAt:Date.now()+60000,channelVerified:true,automaticMessages:true,automaticReviews:true},message={id:'channel-first',connectionId:connection.id,boardId:board.id,boardRevision:3,intent:'discuss',text:'First channel question',deliveryMode:'claude-channel',channelSessionId:connection.channelSessionId,delivery:'queued',receipt:'ch_chat_channel-first'};
 const originalStorage=globalThis.sessionStorage;globalThis.sessionStorage={getItem:key=>key===chatStorageKey(board.id,'draft')?'Keep this next channel draft':null};
 try{
  const props={open:true,setOpen:()=>{},view:{...view(connection),messages:[message]}},blocked=render(BoardChat,props);assert.match(blocked,/Waiting for the previous reply/);assert.match(blocked,/aria-label="Message the connected model"[^>]*>Keep this next channel draft<\/textarea>/);assert.match(blocked,/<button type="submit" disabled=""/);assert.match(blocked,/Accepted by the Claude Code channel/);
  const answered=render(BoardChat,{...props,view:{...props.view,messages:[{...message,status:'answered',reply:'The actual channel answer'}]}});assert.match(answered,/Keep this next channel draft/);assert.match(answered,/The actual channel answer/);assert.doesNotMatch(answered,/<button type="submit" disabled=/);
  const probing={...connection,channelVerified:false,automaticMessages:false,automaticReviews:false},probe={...message,channelTest:true,receipt:undefined,delivery:'uncertain'},pending=render(BoardChat,{...props,view:{...view(probing),messages:[probe]}});assert.match(pending,/I checked my chat · retry/);assert.doesNotMatch(pending,/<form/);
  const old=render(BoardChat,{...props,view:{...view(probing),messages:[{...probe,channelSessionId:'earlier-process'}]}});assert.doesNotMatch(old,/I checked my chat · retry|Retry delivery/);assert.match(old,/First channel question/);
 }finally{if(originalStorage===undefined)delete globalThis.sessionStorage;else globalThis.sessionStorage=originalStorage;}
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

test('processing allows opening drafts but disables new sends and understanding checks',()=>{
 const connection=live();connection.liveSession={...connection.liveSession,status:'processing',waitExpiresAt:Date.now()-1};connection.automaticMessages=false;
 assert.doesNotMatch(chatButton(bubble(connection)),/disabled=/);
 const html=render(BoardChat,{open:true,setOpen:()=>{},onStopLive:()=>{},view:view(connection)});
 assert.match(html,/<form/);assert.match(html,/AI is not waiting right now/);assert.match(html,/your draft is kept/i);assert.match(html,/<button type="submit" disabled=""/);assert.match(html,/Waiting for AI…/);assert.match(html,/Pause live collaboration/);
 assert.match(html,/Let’s think together/);assert.doesNotMatch(html,/Saved board requests/);
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

test('connected ChatGPT offers native Work Cloud setup while real subscription state still gates sending',()=>{
 const props={online:true,onClose:()=>{},onStopLive:()=>{}},connection={id:'native-connection',boardId:board.id,provider:'chatgpt',connected:true,permission:'read',automaticMessages:false,deliveryMode:'manual'};
 const html=render(CloudConnectionSetup,{...props,connection});
 assert.match(html,/Native mini chat · setup needed/);assert.match(html,/Work with Cloud selected/);assert.match(html,/Set up automatic ChatGPT delivery/);assert.match(html,/Copy native setup instructions/);
 const instructions=html.match(/<textarea aria-label="Native ChatGPT setup instructions"[^>]*>([\s\S]*?)<\/textarea>/)?.[1]??'';
 assert.ok(instructions.includes(board.id));assert.match(instructions,/sharedboard\.message\.created/);assert.match(instructions,/sharedboard\.review\.requested/);assert.match(instructions,/sequentially, never in parallel/);assert.doesNotMatch(instructions,/wait_for_board_request|20 minutes/);
 assert.doesNotMatch(html,/Start live collaboration · experimental|Copy start instructions/);assert.match(testButton(html),/disabled=/);assert.match(chatButton(bubble(connection)),/disabled=/);
 assert.match(html,/Your AI app controls model execution and settings/);assert.doesNotMatch(html,/Keep your existing conversation and model/);
 const available={...connection,...active({provider:'chatgpt'})};assert.doesNotMatch(testButton(render(CloudConnectionSetup,{...props,connection:available})),/disabled=/);assert.doesNotMatch(chatButton(bubble(available)),/disabled=/);
 const expired={...available,messageExpiresAt:Date.now()-1};assert.match(testButton(render(CloudConnectionSetup,{...props,connection:expired})),/disabled=/);assert.match(chatButton(bubble(expired)),/disabled=/);
 const offline=render(CloudConnectionSetup,{...props,connection:{...connection,browserOnline:false}});assert.match(offline,/<strong>Mini chat offline<\/strong>/);assert.match(offline,/Keep this board connected to the relay before testing delivery/);assert.doesNotMatch(offline,/<strong>Native mini chat · setup needed<\/strong>/);
});

test('an older ChatGPT live session retains Pause while its setup instructions use native tasks',()=>{
 const props={online:true,onClose:()=>{},onStopLive:()=>{}},connection=live({id:'old-live-connection',boardId:board.id,provider:'chatgpt'}),html=render(CloudConnectionSetup,{...props,connection});
 assert.match(html,/Live AI session · waiting/);assert.match(html,/Pause live collaboration/);assert.match(html,/Native ChatGPT setup instructions/);assert.match(html,/sharedboard\.message\.created/);assert.doesNotMatch(html,/wait_for_board_request|Start live collaboration · experimental/);
});

test('an outstanding native answer keeps drafts and history open while preventing another send',()=>{
 const connection=active({id:'native-chat-connection',boardId:board.id,provider:'chatgpt'}),message={id:'native-first',connectionId:connection.id,boardId:board.id,boardRevision:3,intent:'discuss',text:'First native question',delivery:'queued',receipt:'evt_chat_native-first'};
 const originalStorage=globalThis.sessionStorage;globalThis.sessionStorage={getItem:key=>key===chatStorageKey(board.id,'draft')?'Keep my next question':null};
 try{
  const props={open:true,setOpen:()=>{},view:{...view(connection),messages:[message]}},blocked=render(BoardChat,props);
  assert.match(blocked,/Waiting for the previous reply/);assert.match(blocked,/Your next draft is kept here/);assert.match(blocked,/aria-label="Message the connected model"[^>]*>Keep my next question<\/textarea>/);assert.doesNotMatch(blocked,/<textarea[^>]*disabled=/);
  assert.match(blocked,/<button type="submit" disabled=""[^>]*>[\s\S]*?Waiting for reply…<\/button>/);assert.match(blocked,/First native question/);assert.doesNotMatch(chatButton(render(BoardChat,{...props,open:false})),/disabled=/);
  const completed=render(BoardChat,{...props,view:{...props.view,messages:[{...message,status:'answered',reply:'Actual model answer'}]}});assert.doesNotMatch(completed,/Waiting for the previous reply/);assert.match(completed,/Actual model answer/);assert.match(completed,/Keep my next question/);assert.doesNotMatch(completed,/<button type="submit" disabled=/);
  const stale=render(BoardChat,{...props,view:{...props.view,messages:[{...message,connectionId:'previous-connection'}]}});assert.doesNotMatch(stale,/Waiting for the previous reply/);
 }finally{if(originalStorage===undefined)delete globalThis.sessionStorage;else globalThis.sessionStorage=originalStorage;}
});
