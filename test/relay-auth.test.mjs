import test from 'node:test';
import assert from 'node:assert/strict';
import {RelayAuthorization} from '../cloudflare/auth.mjs';
import {hash,secret} from '../cloudflare/protocol.mjs';
import {MemoryStorage} from './relay-fixtures.mjs';
async function fixture(permission='edit'){
 let now=Date.now();const storage=new MemoryStorage(),auth=new RelayAuthorization({storage,now:()=>now});
 const client=await auth.register({client_name:'Test model',redirect_uris:['https://client.example/callback']},'fixture'),verifier=secret(),bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))),challenge=btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
 const params={client_id:client.client_id,redirect_uri:client.redirect_uris[0],response_type:'code',code_challenge:challenge,code_challenge_method:'S256',resource:'https://connect.sharedboard.app/mcp',state:'preserve-me'},request=await auth.start(params,'fixture'),session={id:crypto.randomUUID(),boardId:crypto.randomUUID(),permission};
 return {auth,storage,client,verifier,params,request,session,advance(ms){now+=ms;},async approve(){const approved=await auth.decide(request.id,true,session),code=new URL(approved.redirect).searchParams.get('code'),exchange={grant_type:'authorization_code',client_id:client.client_id,redirect_uri:params.redirect_uri,code_verifier:verifier,resource:params.resource,code};return {...approved,exchange};}};
}
test('relay OAuth uses PKCE, exact callbacks and one-time codes; no raw access or refresh keys are persisted',async()=>{
 const f=await fixture(),approval=await f.approve();assert.equal(new URL(approval.redirect).searchParams.get('state'),'preserve-me');assert.equal(new URL(approval.redirect).searchParams.get('iss'),'https://connect.sharedboard.app');
 await assert.rejects(f.auth.issue({...approval.exchange,code_verifier:secret()}),/PKCE/);const issued=await f.auth.issue(approval.exchange);assert.equal((await f.auth.verify(issued.tokens.access_token)).boardId,f.session.boardId);await assert.rejects(f.auth.issue(approval.exchange),/Invalid or expired/);
 const stored=JSON.stringify([...f.storage.map]);assert.ok(!stored.includes(issued.tokens.access_token));assert.ok(!stored.includes(issued.tokens.refresh_token));assert.ok(!stored.includes(approval.exchange.code));assert.equal(issued.grant.scope,'board.read board.write');
});
test('relay authorization reduces requested drawing write scope to the browser-chosen read permission',async()=>{
 const f=await fixture('read'),approval=await f.approve(),issued=await f.auth.issue(approval.exchange);assert.equal(issued.tokens.scope,'board.read');assert.equal(issued.grant.permission,'read');
});
test('relay OAuth rejects wrong audience, callback, unsupported scope and native non-loopback HTTP',async()=>{
 const f=await fixture();await assert.rejects(f.auth.start({...f.params,resource:'https://attacker.example/mcp'}),/resource/);await assert.rejects(f.auth.start({...f.params,redirect_uri:'https://attacker.example/callback'}),/callback/);await assert.rejects(f.auth.start({...f.params,scope:'board.read admin'}),/supported board/);await assert.rejects(f.auth.register({redirect_uris:['http://example.com/callback']}),/HTTPS/);
 const native=await f.auth.register({redirect_uris:['http://127.0.0.1:1455/auth/callback']});assert.equal(native.redirect_uris[0],'http://127.0.0.1:1455/auth/callback');
});
test('refresh tokens rotate and revoking an access token revokes its refresh family and sibling access tokens',async()=>{
 const f=await fixture(),approval=await f.approve(),first=await f.auth.issue(approval.exchange),params={grant_type:'refresh_token',client_id:f.client.client_id,refresh_token:first.tokens.refresh_token},next=await f.auth.issue(params);await assert.rejects(f.auth.issue(params),/expired/);await f.auth.revoke(first.tokens.access_token);await assert.rejects(f.auth.verify(next.tokens.access_token),/revoked/);await assert.rejects(f.auth.issue({...params,refresh_token:next.tokens.refresh_token}),/expired/);
});
test('expired OAuth requests cannot be approved; denied requests return no authorization code',async()=>{
 const f=await fixture();const denied=await f.auth.decide(f.request.id,false,f.session);assert.equal(new URL(denied.redirect).searchParams.get('error'),'access_denied');assert.equal(new URL(denied.redirect).searchParams.has('code'),false);await assert.rejects(f.auth.decide(f.request.id,true,f.session),/already handled/);
 const second=await f.auth.start(f.params);f.advance(300001);await assert.rejects(f.auth.decide(second.id,true,f.session),/expired/);
});
test('rate limiting applies to anonymous registrations and session creation',async()=>{
 const storage=new MemoryStorage(),auth=new RelayAuthorization({storage});for(let i=0;i<10;i++)await auth.rate('pair','test-ip');await assert.rejects(auth.rate('pair','test-ip'),error=>error.status===429);
});
