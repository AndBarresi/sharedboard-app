import test from 'node:test';
import assert from 'node:assert/strict';
import {CLIENT_PROFILES,clientProfile,isClientProvider,miniChatState} from '../shared/client-profiles.mjs';

test('client choices preserve legacy identities and distinguish Claude Code from Claude web',()=>{
 assert.deepEqual(CLIENT_PROFILES.slice(0,2).map(client=>client.id),['codex','claude-code']);
 for(const id of ['codex','claude-code','claude','chatgpt','other'])assert.ok(isClientProvider(id));
 assert.equal(clientProfile('claude').label,'Claude (web)');assert.equal(clientProfile('claude-code').label,'Claude Code');
 for(const id of ['__proto__','cursor',null,{},'not-a-client'])assert.equal(isClientProvider(id),false);
 assert.ok(CLIENT_PROFILES.every(client=>client.miniChatLabel==='Direct mini chat · Link in your AI'&&client.detail));
});

test('direct mini chat requires an active route for every provider and drawing permission',()=>{
 const now=Date.now();
 for(const provider of CLIENT_PROFILES.map(client=>client.id)){
  for(const permission of ['read','edit']){
   const state=miniChatState({provider,permission,connected:true,automaticReviews:true});
   assert.equal(state.enabled,false);assert.equal(state.automatic,false);assert.equal(state.mode,'unavailable');
   assert.match(state.reason,/conversation panel.*Link this chat/);
   assert.doesNotMatch(state.reason,/copy|paste/i);
   for(const deliveryMode of ['panel','events']){
    const active=miniChatState({provider,permission,connected:true,automaticMessages:true,deliveryMode,messageExpiresAt:now+60_000},now);
    assert.equal(active.enabled,true);assert.equal(active.automatic,true);assert.equal(active.mode,deliveryMode);
   }
  }
 }
 for(const connection of [null,{connected:false,automaticMessages:true},{connected:true,automaticMessages:true,revoked:true},{connected:true,automaticMessages:true,browserOnline:false},{connected:true,automaticMessages:true,relayAvailable:false}])assert.equal(miniChatState(connection).enabled,false);
 assert.equal(miniChatState({connected:true,automaticMessages:'true'}).automatic,false);
});

test('chat expiry requires a valid future deadline and never inherits a review deadline',()=>{
 const now=Date.now(),active={connected:true,automaticMessages:true,messageExpiresAt:new Date(now+60_000).toISOString(),eventExpiresAt:new Date(now-1000).toISOString()};
 assert.equal(miniChatState(active,now).automatic,true);
 for(const connection of [active,{...active,messageExpiresAt:'invalid'},{connected:true,automaticMessages:true,eventExpiresAt:now-1},{connected:true,automaticMessages:true},{connected:true,automaticMessages:true,messageExpiresAt:Infinity},{connected:true,automaticMessages:true,reviewExpiresAt:now+120_000}]){
  const state=miniChatState(connection,now+60_000);assert.equal(state.enabled,false);assert.equal(state.automatic,false);assert.equal(state.mode,'unavailable');
 }
 assert.equal(miniChatState({connected:true,automaticMessages:true,deliveryMode:'panel',panelExpiresAt:now+30_000},now).mode,'panel');
 assert.equal(miniChatState({connected:true,automaticMessages:true,eventExpiresAt:now+30_000},now).mode,'events');
 assert.equal(miniChatState({...active,messageExpiresAt:now-1,eventExpiresAt:now+60_000},now).enabled,false,'an expired message deadline must not borrow a live review/event deadline');
});
