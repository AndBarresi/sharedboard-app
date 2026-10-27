import {fail,hash,secret,uuid,allowedScope,scopes,permissionFor} from './protocol.mjs';
const MINUTE=60_000,HOUR=60*MINUTE,DAY=24*HOUR;
const safeClientName=value=>String(value??'AI connector').trim().slice(0,100)||'AI connector';
const callback=value=>{let url;try{url=new URL(value);}catch{throw fail('A valid OAuth callback is required.');}if(url.username||url.password||url.hash||url.href.length>2048||url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw fail('OAuth callbacks must use HTTPS or a native loopback callback.');return url.href;};
export class RelayAuthorization{
 constructor({storage,origin='https://connect.sharedboard.app',appOrigin='https://sharedboard.app',now=Date.now}={}){Object.assign(this,{storage,origin,appOrigin,now});this.tail=Promise.resolve();}
 run(task){const result=this.tail.then(task);this.tail=result.catch(()=>{});return result;}
 metadata(){return {issuer:this.origin,authorization_endpoint:`${this.origin}/authorize`,token_endpoint:`${this.origin}/token`,registration_endpoint:`${this.origin}/register`,revocation_endpoint:`${this.origin}/revoke`,response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],token_endpoint_auth_methods_supported:['none'],code_challenge_methods_supported:['S256'],scopes_supported:['board.read','board.write'],authorization_response_iss_parameter_supported:true};}
 async limited(key,limit,windowMs=MINUTE){const slot=Math.floor(this.now()/windowMs),name=`rate:${await hash(key)}:${slot}`,saved=await this.storage.get(name),count=saved?.count??saved??0;if(count>=limit)throw fail('Too many connector requests. Wait a little and try again.',429,'RATE_LIMITED');await this.storage.put(name,{count:count+1,expiresAt:(slot+1)*windowMs});}
 async cleanup(){for(const prefix of ['expiry:','rate:']){const cursorKey=`maintenance:${prefix}`,cursor=await this.storage.get(cursorKey),entries=await this.storage.list({prefix,limit:1000,...(cursor?{startAfter:cursor}:{})});for(const [key,entry] of entries){if(prefix==='expiry:'&&entry.at<=this.now())await this.storage.delete([key,entry.key]);else if(prefix==='rate:'&&entry.expiresAt<=this.now())await this.storage.delete(key);}if(entries.size<1000)await this.storage.delete(cursorKey);else await this.storage.put(cursorKey,[...entries.keys()].at(-1));}}
 async put(key,value,expiresAt){await this.storage.put(key,{...value,expiresAt});if(expiresAt)await this.storage.put(`expiry:${key}`,{key,at:expiresAt});}
 async get(key){const value=await this.storage.get(key);if(value?.expiresAt<=this.now()){await this.storage.delete([key,`expiry:${key}`]);return null;}return value??null;}
 register(input,ip='unknown'){return this.run(async()=>{
  await this.limited(`register:${ip}`,10);await this.limited('global:register',100);await this.limited('global:register-day',1000,DAY);if(!Array.isArray(input.redirect_uris)||!input.redirect_uris.length||input.redirect_uris.length>5)throw fail('Provide one to five OAuth callbacks.');
  if(input.token_endpoint_auth_method&&input.token_endpoint_auth_method!=='none')throw fail('This connector requires a public OAuth client with PKCE.');
  if((await this.storage.list({prefix:'client:',limit:5001})).size>=5000)throw fail('Connector registration is temporarily full.',429);
  const client={client_id:crypto.randomUUID(),client_name:safeClientName(input.client_name),redirect_uris:[...new Set(input.redirect_uris.map(callback))],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']};
  await this.put(`client:${client.client_id}`,client,this.now()+90*DAY);return client;
 });}
 start(params,ip='unknown'){return this.run(async()=>{
  await this.limited(`authorize:${ip}`,20);const client=await this.get(`client:${params.client_id}`);
  if(!client||!client.redirect_uris.includes(params.redirect_uri))throw fail('Unknown connector or mismatched callback.');
  if(params.response_type!=='code'||params.code_challenge_method!=='S256'||!/^[A-Za-z0-9_-]{43}$/.test(params.code_challenge??''))throw fail('Authorization code with PKCE S256 is required.');
  if(params.resource&&params.resource!==`${this.origin}/mcp`)throw fail('The OAuth resource does not match this connector.');
  if(typeof params.state==='string'&&params.state.length>2048)throw fail('OAuth state is too large.');
  const id=secret(),scope=allowedScope(params.scope||'board.read board.write'),item={id,clientId:client.client_id,clientName:client.client_name,redirect:params.redirect_uri,state:params.state??'',challenge:params.code_challenge,scope,resource:`${this.origin}/mcp`,verification:String(crypto.getRandomValues(new Uint32Array(1))[0]%900000+100000),status:'waiting'};
  await this.put(`request:${id}`,item,this.now()+5*MINUTE);return {id,redirect:`${this.appOrigin}/?sharedboard_connect=${id}`};
 });}
 async request(id){if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))throw fail('This connection request is invalid.',404);const item=await this.get(`request:${id}`);if(!item)throw fail('This connection request expired. Start again from your AI app.',410,'OAUTH_EXPIRED');return item;}
 async requestInfo(id){const item=await this.request(id);return {id:item.id,clientId:item.clientId,clientName:item.clientName,callbackOrigin:new URL(item.redirect).origin,scopes:item.scope.split(' '),verification:item.verification,status:item.status,expiresAt:new Date(item.expiresAt).toISOString()};}
 decide(id,allow,session){return this.run(async()=>{
  const item=await this.request(id);if(item.status!=='waiting')throw fail('This connection request was already handled.',409,'OAUTH_ALREADY_HANDLED');
  const target=new URL(item.redirect);if(item.state)target.searchParams.set('state',item.state);target.searchParams.set('iss',this.origin);
  if(!allow){item.status='denied';await this.put(`request:${id}`,item,item.expiresAt);target.searchParams.set('error','access_denied');return {redirect:target.href};}
  uuid(session.id,'session ID');uuid(session.boardId,'board ID');if(!['read','edit'].includes(session.permission))throw fail('Choose board access before approving.');
  const effective=[...scopes(item.scope)].filter(scope=>scope!=='board.write'||session.permission==='edit').join(' '),grant={id:session.id,familyId:crypto.randomUUID(),sessionId:session.id,boardId:session.boardId,clientId:item.clientId,scope:effective,permission:permissionFor(effective),authorizedAt:new Date(this.now()).toISOString()};
  const code=secret();await this.put(`code:${await hash(code)}`,{...item,grant},this.now()+MINUTE);item.status='approved';await this.put(`request:${id}`,item,item.expiresAt);target.searchParams.set('code',code);return {redirect:target.href,grant};
 });}
 issue(params,ip='unknown'){return this.run(async()=>{
  await this.limited(`token:${ip}`,60);let grant;
  if(params.grant_type==='authorization_code'){
   const key=`code:${await hash(params.code??'')}`,item=await this.get(key);
   if(!item||item.clientId!==params.client_id||item.redirect!==params.redirect_uri||item.resource!==(params.resource||`${this.origin}/mcp`))throw fail('Invalid or expired authorization code.',400,'INVALID_GRANT');
   if(!/^[A-Za-z0-9._~-]{43,128}$/.test(params.code_verifier??''))throw fail('Invalid PKCE verifier.',400,'INVALID_GRANT');
   const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(params.code_verifier)),actual=btoa(String.fromCharCode(...new Uint8Array(digest))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');if(actual!==item.challenge)throw fail('PKCE verification failed.',400,'INVALID_GRANT');
   await this.storage.delete([key,`expiry:${key}`]);grant=item.grant;
  }else if(params.grant_type==='refresh_token'){
   const key=`refresh:${await hash(params.refresh_token??'')}`,item=await this.get(key);if(!item||await this.get(`revoked:${item.grant.familyId}`)||item.grant.clientId!==params.client_id||params.resource&&params.resource!==`${this.origin}/mcp`)throw fail('This authorization expired. Reconnect from SharedBoard.app.',400,'INVALID_GRANT');
   if(params.scope&&params.scope!==item.grant.scope)throw fail('A refreshed token cannot change board access.',400,'INVALID_SCOPE');await this.storage.delete([key,`expiry:${key}`]);grant=item.grant;
  }else throw fail('Unsupported OAuth grant.',400,'UNSUPPORTED_GRANT_TYPE');
  const access=secret(),refresh=secret();await this.put(`access:${await hash(access)}`,{grant},this.now()+HOUR);await this.put(`refresh:${await hash(refresh)}`,{grant},this.now()+30*DAY);
  return {tokens:{access_token:access,token_type:'Bearer',expires_in:3600,refresh_token:refresh,scope:grant.scope},grant};
 });}
 async verify(token){if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))throw fail('Authorize this connector in SharedBoard.app first.',401,'UNAUTHORIZED');const item=await this.get(`access:${await hash(token)}`);if(!item||await this.get(`revoked:${item.grant.familyId}`))throw fail('This connector authorization expired or was revoked. Reconnect it.',401,'UNAUTHORIZED');return item.grant;}
 revoke(token){return this.run(async()=>{if(typeof token!=='string')return {ok:true};const digest=await hash(token),entry=await this.get(`access:${digest}`)??await this.get(`refresh:${digest}`);if(entry?.grant?.familyId)await this.put(`revoked:${entry.grant.familyId}`,{revoked:true},this.now()+31*DAY);await this.storage.delete([`access:${digest}`,`refresh:${digest}`,`expiry:access:${digest}`,`expiry:refresh:${digest}`]);return {ok:true,...(entry?.grant?{grant:entry.grant}:{})};});}
 rate(key,ip){return this.run(async()=>{await this.limited(`${key}:${ip}`,key==='pair'?10:60);if(key==='pair'){await this.limited('global:pair',100);await this.limited('global:pair-day',1000,DAY);}return {ok:true};});}
}
