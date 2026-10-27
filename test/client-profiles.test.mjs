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

test('mini chat requires actual automatic-message capability rather than a provider, permission, or review subscription',()=>{
 for(const provider of CLIENT_PROFILES.map(client=>client.id)){
  for(const permission of ['read','edit'])assert.equal(miniChatState({provider,permission,connected:true,automaticReviews:true}).enabled,false);
 }
 for(const connection of [null,{connected:false,automaticMessages:true},{connected:true,automaticMessages:'true'},{connected:true,automaticMessages:true,revoked:true},{connected:true,automaticMessages:true,browserOnline:false},{connected:true,automaticMessages:true,relayAvailable:false}])assert.equal(miniChatState(connection).enabled,false);
 assert.equal(miniChatState({provider:'other',connected:true,automaticMessages:true}).enabled,true);
});

test('chat expiry uses its own deadline and never inherits an earlier review deadline',()=>{
 const now=Date.now(),active={connected:true,automaticMessages:true,messageExpiresAt:new Date(now+60_000).toISOString(),eventExpiresAt:new Date(now-1000).toISOString()};
 assert.equal(miniChatState(active,now).enabled,true);
 assert.equal(miniChatState(active,now+60_000).enabled,false);
 assert.equal(miniChatState({...active,messageExpiresAt:'invalid'},now).enabled,false);
 assert.equal(miniChatState({connected:true,automaticMessages:true,eventExpiresAt:now-1},now).enabled,false);
});
