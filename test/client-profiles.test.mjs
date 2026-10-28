import test from 'node:test';
import assert from 'node:assert/strict';
import {CLIENT_PROFILES,clientProfile,isClientProvider,miniChatState,channelTestAvailable} from '../shared/client-profiles.mjs';

const now=Date.now();
const live=changes=>({connected:true,provider:'codex',permission:'read',deliveryMode:'live-session',automaticMessages:true,liveSession:{id:'11111111-1111-4111-8111-111111111111',status:'waiting',expiresAt:now+1_200_000,waitExpiresAt:now+40_000},...changes});

test('coding clients come first and ChatGPT native setup is distinct from experimental active-run support',()=>{
 assert.deepEqual(CLIENT_PROFILES.slice(0,2).map(client=>client.id),['codex','claude-code']);
 for(const id of ['codex','claude-code','claude','chatgpt','other'])assert.ok(isClientProvider(id));
 assert.equal(clientProfile('claude').label,'Claude (web)');assert.equal(clientProfile('claude-code').label,'Claude Code');
 for(const id of ['__proto__','cursor',null,{},'not-a-client'])assert.equal(isClientProvider(id),false);
 assert.equal(clientProfile('chatgpt').label,'ChatGPT Work Cloud');assert.match(clientProfile('chatgpt').miniChatLabel,/native event setup/);assert.match(clientProfile('chatgpt').detail,/Work with Cloud selected/);assert.match(clientProfile('chatgpt').detail,/Availability depends on your account/);
 assert.ok(CLIENT_PROFILES.every(client=>client.miniChat==='verify'));
 assert.match(clientProfile('claude-code').miniChatLabel,/Channels plugin setup/);assert.match(clientProfile('claude-code').detail,/each session/);assert.match(clientProfile('claude-code').detail,/Node.js is required/);
 assert.match(clientProfile('codex').miniChatLabel,/local plugin setup/);assert.match(clientProfile('codex').detail,/Codex CLI queue support/);assert.match(clientProfile('codex').detail,/actual reply test/);
 assert.ok(CLIENT_PROFILES.filter(client=>!['codex','chatgpt','claude-code'].includes(client.id)).every(client=>client.miniChatLabel==='Live mini chat · AI session must stay active'&&/Experimental/.test(client.detail)));
});

test('local plugins require current authenticated presence and actual proof, with a separate explicit test gate',()=>{
 for(const [provider,deliveryMode] of [['claude-code','claude-channel'],['codex','codex-channel']]){
 const connection={provider,id:'connection',boardId:'board',connected:true,browserOnline:true,deliveryMode,channelConnected:true,channelSessionId:'process-instance',channelExpiresAt:now+60000,channelVerified:false,automaticMessages:false,automaticReviews:false};
 assert.equal(channelTestAvailable(connection,now),true);assert.equal(miniChatState(connection,now).enabled,false);assert.equal(miniChatState(connection,now).testAvailable,true);
 for(const changes of [{provider:'claude-code',deliveryMode:'manual'},{channelConnected:false},{channelSessionId:''},{channelExpiresAt:now},{channelExpiresAt:'invalid'},{channelExpiresAt:Infinity},{browserOnline:false},{browserOnline:undefined},{relayAvailable:false},{connected:false},{revoked:true}]){const current={...connection,...changes,channelVerified:true,automaticMessages:true};assert.equal(channelTestAvailable(current,now),false,JSON.stringify(changes));assert.equal(miniChatState(current,now).enabled,false);}
 for(const channelVerified of [undefined,false,'true'])assert.equal(miniChatState({...connection,channelVerified,automaticMessages:true},now).enabled,false,'a socket and cached automatic flag do not establish proof');
 const verified={...connection,channelVerified:true,automaticMessages:true};assert.equal(miniChatState(verified,now).enabled,true);assert.equal(miniChatState(verified,now).mode,deliveryMode);assert.equal(miniChatState(verified,now+60000).enabled,false);
 assert.equal(miniChatState({...verified,automaticMessages:false,automaticReviews:true},now).enabled,false,'review capability alone does not enable mini chat');
 }
});

test('every provider and drawing permission needs actual live waiting or verified events',()=>{
 for(const provider of CLIENT_PROFILES.map(client=>client.id))for(const permission of ['read','edit']){
  const inactive=miniChatState({provider,permission,connected:true,automaticReviews:true},now);assert.equal(inactive.enabled,false);assert.match(inactive.reason,provider==='chatgpt'?/native event tasks once/:/Start live collaboration once/);assert.match(inactive.reason,/board tools remain available/i);assert.doesNotMatch(inactive.reason,/copy|paste/i);
  const waiting=miniChatState(live({provider,permission}),now);assert.equal(waiting.enabled,true);assert.equal(waiting.automatic,true);assert.equal(waiting.mode,'live-session');assert.equal(waiting.phase,'waiting');
  const events=miniChatState({provider,permission,connected:true,automaticMessages:true,deliveryMode:'events',messageExpiresAt:now+60_000},now);assert.equal(events.enabled,true);assert.equal(events.mode,'events');
  for(const deliveryMode of ['panel','manual',null])assert.equal(miniChatState(live({provider,permission,deliveryMode,panelConnected:true,panelExpiresAt:now+60_000}),now).enabled,false);
 }
 for(const connection of [null,live({connected:false}),live({revoked:true}),live({browserOnline:false}),live({relayAvailable:false}),live({automaticMessages:'true'}),live({automaticMessages:false})])assert.equal(miniChatState(connection,now).enabled,false);
});

test('live sessions require their own ID, waiting status and both future deadlines',()=>{
 const session=live().liveSession;
 for(const liveSession of [null,{}, {...session,id:''},{...session,id:42},{...session,status:'processing'},{...session,status:'stopped'},{...session,status:'expired'},{...session,status:'unknown'},{...session,expiresAt:now},{...session,expiresAt:Infinity},{...session,expiresAt:'invalid'},{...session,expiresAt:undefined},{...session,waitExpiresAt:now},{...session,waitExpiresAt:Infinity},{...session,waitExpiresAt:'invalid'},{...session,waitExpiresAt:undefined}])assert.equal(miniChatState(live({liveSession,eventExpiresAt:now+60_000,messageExpiresAt:now+60_000}),now).enabled,false,JSON.stringify(liveSession));
 assert.equal(miniChatState(live({liveSession:{...session,expiresAt:new Date(session.expiresAt).toISOString(),waitExpiresAt:new Date(session.waitExpiresAt).toISOString()}}),now).enabled,true);
 assert.equal(miniChatState(live(),now+40_000).enabled,false,'the wait deadline disables sending before the overall session deadline');
 assert.equal(miniChatState(live({deliveryMode:'events',automaticMessages:false}),now).enabled,false,'a session object does not establish its delivery mode');
});

test('processing preserves an active session but disables new messages; stopped sessions explain resume',()=>{
 const processing=miniChatState(live({liveSession:{...live().liveSession,status:'processing',waitExpiresAt:now-1}}),now);
 assert.equal(processing.enabled,false);assert.equal(processing.automatic,false);assert.equal(processing.sessionActive,true);assert.equal(processing.phase,'processing');assert.match(processing.reason,/AI is not waiting right now/);assert.match(processing.reason,/draft is kept until it resumes/);
 for(const status of ['stopped','expired']){const ended=miniChatState(live({liveSession:{...live().liveSession,status}}),now);assert.equal(ended.sessionActive,false);assert.match(ended.reason,/Start or resume/);assert.match(ended.reason,/cannot wake an ended or closed AI run/);}
});

test('event expiry is independent from review deadlines and diagnostic panels stay ineligible',()=>{
 const active={connected:true,deliveryMode:'events',automaticMessages:true,messageExpiresAt:new Date(now+60_000).toISOString(),eventExpiresAt:now-1000};
 assert.equal(miniChatState(active,now).automatic,true);
 for(const extra of [{messageExpiresAt:'invalid'},{messageExpiresAt:now},{messageExpiresAt:Infinity},{messageExpiresAt:undefined,eventExpiresAt:undefined,reviewExpiresAt:now+120_000}])assert.equal(miniChatState({...active,...extra},now).enabled,false);
 assert.equal(miniChatState({...active,deliveryMode:'panel',panelConnected:true,panelExpiresAt:now+120_000},now).enabled,false);
 assert.equal(miniChatState({...active,messageExpiresAt:undefined,eventExpiresAt:now+30_000},now).mode,'events');
});
