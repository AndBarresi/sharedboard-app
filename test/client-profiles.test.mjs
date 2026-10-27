import test from 'node:test';
import assert from 'node:assert/strict';
import {CLIENT_PROFILES,clientProfile,isClientProvider,miniChatState} from '../shared/client-profiles.mjs';

test('client choices preserve legacy identities and distinguish Claude Code from Claude web',()=>{
 assert.deepEqual(CLIENT_PROFILES.slice(0,2).map(client=>client.id),['codex','claude-code']);
 for(const id of ['codex','claude-code','claude','chatgpt','other'])assert.ok(isClientProvider(id));
 assert.equal(clientProfile('claude').label,'Claude (web)');assert.equal(clientProfile('claude-code').label,'Claude Code');
 for(const id of ['__proto__','cursor',null,{},'not-a-client'])assert.equal(isClientProvider(id),false);
 assert.ok(CLIENT_PROFILES.every(client=>client.miniChatLabel.includes('Mini chat')&&client.detail));
});

test('manual mini chat works for every connected provider and drawing permission',()=>{
 for(const provider of CLIENT_PROFILES.map(client=>client.id)){
  for(const permission of ['read','edit']){
   const state=miniChatState({provider,permission,connected:true,automaticReviews:true});
   assert.equal(state.enabled,true);assert.equal(state.automatic,false);assert.equal(state.mode,'manual');
   assert.equal(miniChatState({provider,permission,connected:true,automaticMessages:true}).automatic,true);
  }
 }
 for(const connection of [null,{connected:false,automaticMessages:true},{connected:true,automaticMessages:true,revoked:true},{connected:true,automaticMessages:true,browserOnline:false},{connected:true,automaticMessages:true,relayAvailable:false}])assert.equal(miniChatState(connection).enabled,false);
 assert.equal(miniChatState({connected:true,automaticMessages:'true'}).automatic,false);
});

test('chat expiry uses its own deadline and never inherits an earlier review deadline',()=>{
 const now=Date.now(),active={connected:true,automaticMessages:true,messageExpiresAt:new Date(now+60_000).toISOString(),eventExpiresAt:new Date(now-1000).toISOString()};
 assert.equal(miniChatState(active,now).automatic,true);
 for(const connection of [active,{...active,messageExpiresAt:'invalid'},{connected:true,automaticMessages:true,eventExpiresAt:now-1}]){
  const state=miniChatState(connection,now+60_000);assert.equal(state.enabled,true);assert.equal(state.automatic,false);assert.equal(state.mode,'manual');
 }
});
