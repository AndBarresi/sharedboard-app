import {createHash,randomBytes,timingSafeEqual,randomInt} from 'node:crypto';

const hash=value=>createHash('sha256').update(value).digest('hex');
const nonce=()=>randomBytes(32).toString('hex');
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
export function permissionFromScopes(scope){const scopes=new Set(String(scope||'').split(' ').filter(Boolean));return scopes.has('board.write')?'edit':scopes.has('board.propose')?'propose':'read';}
const supportedScopes=permission=>['board.read',...(permission==='edit'?['board.write','board.propose']:permission==='propose'?['board.propose']:[])];
const defaultScopes=permission=>`board.read${permission==='edit'?' board.write':permission==='propose'?' board.propose':''}`;
export class WebAuthorization {
  constructor({origin,permission,approve,valid,now=Date.now}){Object.assign(this,{origin,permission,approve,valid,now});this.clients=new Map();this.requests=new Map();this.codes=new Map();this.tokens=new Map();this.refresh=new Map();}
  resource(){return `${this.origin}/mcp`;}
  metadata(){return {issuer:this.origin,authorization_endpoint:`${this.origin}/authorize`,token_endpoint:`${this.origin}/token`,registration_endpoint:`${this.origin}/register`,revocation_endpoint:`${this.origin}/revoke`,response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],token_endpoint_auth_methods_supported:['none'],code_challenge_methods_supported:['S256'],scopes_supported:supportedScopes(this.permission)};}
  register(input){
    if(this.clients.size>=50)throw fail('Too many connector registrations. Restart this temporary connection.',429);
    if(!Array.isArray(input.redirect_uris)||!input.redirect_uris.length||input.redirect_uris.length>5)throw fail('A connector callback is required.');
    const redirects=input.redirect_uris.map(uri=>{
      const url=new URL(uri);if(url.protocol!=='https:'||url.username||url.password||url.hash)throw fail('Connector callbacks must use HTTPS.');return url.href;
    });
    if(input.token_endpoint_auth_method&&input.token_endpoint_auth_method!=='none')throw fail('This connector uses a public OAuth client with PKCE.');
    const client={client_id:nonce(),client_name:String(input.client_name||'AI connector').slice(0,100),redirect_uris:redirects,token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']};
    this.clients.set(client.client_id,client);return client;
  }
  request(params){
    for(const [id,item] of this.requests)if(item.expiresAt<=this.now())this.requests.delete(id);
    if(this.requests.size>=30)throw fail('Too many connection requests. Restart the temporary connection.',429);
    const client=this.clients.get(params.client_id);
    if(!client||!client.redirect_uris.includes(params.redirect_uri))throw fail('Unknown connector or mismatched callback.');
    if(params.response_type!=='code'||params.code_challenge_method!=='S256'||!/^[A-Za-z0-9_-]{43}$/.test(params.code_challenge||''))throw fail('Authorization code with PKCE S256 is required.');
    if(params.resource&&params.resource!==this.resource())throw fail('The requested board resource does not match.');
    const scopes=(params.scope||defaultScopes(this.permission)).split(' ').filter(Boolean);
    if(!scopes.length||scopes.some(s=>!this.metadata().scopes_supported.includes(s)))throw fail('The requested access exceeds the permission chosen on the board.');
    const item={id:nonce(),clientId:client.client_id,clientName:client.client_name,redirect:params.redirect_uri,state:params.state||'',challenge:params.code_challenge,scope:scopes.join(' '),resource:this.resource(),verification:String(randomInt(100000,1000000)),status:'waiting',expiresAt:this.now()+5*60_000};
    this.requests.set(item.id,item);return item;
  }
  pending(){return [...this.requests.values()].filter(r=>r.status==='waiting'&&r.expiresAt>this.now()).map(r=>({id:r.id,name:r.clientName,callbackOrigin:new URL(r.redirect).origin,verification:r.verification}));}
  decide(id,allow){const item=this.requests.get(id);if(!item||item.expiresAt<=this.now()||item.status!=='waiting')throw fail('This approval request expired or was already handled.',409);item.status=allow?'approved':'denied';if(allow){const code=nonce();item.code=code;this.codes.set(hash(code),item);}return {ok:true};}
  poll(id){
    const item=this.requests.get(id);if(!item||item.expiresAt<=this.now())return {status:'expired'};
    if(item.status==='waiting')return {status:'waiting'};
    const target=new URL(item.redirect);if(item.state)target.searchParams.set('state',item.state);
    if(item.status==='approved')target.searchParams.set('code',item.code);else target.searchParams.set('error','access_denied');
    return {status:item.status,redirect:target.href};
  }
  issue(params,sessionExpires){
    if(sessionExpires<=this.now())throw fail('This temporary connection expired. Start a new one from SharedBoard.app.',401);
    let grant;
    if(params.grant_type==='authorization_code'){
      const item=this.codes.get(hash(params.code||''));
      if(!item||item.expiresAt<=this.now()||item.clientId!==params.client_id||item.redirect!==params.redirect_uri||item.resource!==(params.resource||this.resource()))throw fail('Invalid or expired authorization code.');
      if(!/^[A-Za-z0-9._~-]{43,128}$/.test(params.code_verifier||''))throw fail('Invalid PKCE verifier.');
      const actual=createHash('sha256').update(params.code_verifier).digest('base64url'),a=Buffer.from(actual),b=Buffer.from(item.challenge);
      if(a.length!==b.length||!timingSafeEqual(a,b))throw fail('PKCE verification failed.');
      this.codes.delete(hash(params.code));item.status='used';delete item.code;
      grant=this.approve({scope:item.scope,clientId:item.clientId});
    }else if(params.grant_type==='refresh_token'){
      const saved=this.refresh.get(hash(params.refresh_token||''));
      if(!saved||saved.clientId!==params.client_id||saved.expiresAt<=this.now()||!this.valid(saved.grant))throw fail('This connection has ended. Reconnect from SharedBoard.app.',401);
      this.refresh.delete(hash(params.refresh_token));grant=saved.grant;
    }else throw fail('Unsupported authorization grant.');
    const access=nonce(),refresh=nonce(),expiresAt=Math.min(sessionExpires,this.now()+30*60_000);
    const entry={grant,clientId:params.client_id,expiresAt};this.tokens.set(hash(access),entry);this.refresh.set(hash(refresh),{...entry,expiresAt:sessionExpires});
    return {access_token:access,token_type:'Bearer',expires_in:Math.max(0,Math.floor((expiresAt-this.now())/1000)),refresh_token:refresh,scope:grant.scope};
  }
  verify(token){const item=this.tokens.get(hash(token||''));if(!item||item.expiresAt<=this.now()||!this.valid(item.grant))throw fail('Authorize this connector from SharedBoard.app first.',401);return item.grant;}
  revoke(token){this.tokens.delete(hash(token||''));this.refresh.delete(hash(token||''));}
  clear(){this.tokens.clear();this.refresh.clear();this.codes.clear();this.requests.clear();this.clients.clear();}
}

export function authorizationPage(item){
  // Request text is inserted as textContent, never executable HTML.
  const data=JSON.stringify({id:item.id,verification:item.verification,name:item.clientName}).replaceAll('<','\\u003c');
  return `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Connect SharedBoard.app</title><style>body{font:15px/1.7 system-ui;background:#f4f5ec;color:#405139;display:grid;place-items:center;min-height:95vh}main{background:#fff;padding:36px;border:1px solid #d4ddc7;border-radius:20px;max-width:440px}h1{font-weight:500}b{display:block;letter-spacing:8px;font-size:32px;color:#275c46}p{color:#7b8c6d}small{color:#829271}</style><main><small>SHAREDBOARD.APP · LINK YOUR AI</small><h1>Approve on your board.</h1><p>Return to SharedBoard.app’s connection window. Match this number before allowing access.</p><b id="code"></b><p id="name"></p><p id="state">Waiting for your approval in SharedBoard.app…</p></main><script>const data=${data};document.querySelector('#code').textContent=data.verification;document.querySelector('#name').textContent='Requested by '+data.name;let busy=false;const timer=setInterval(async()=>{if(busy)return;busy=true;try{const result=await fetch('/oauth-status?id='+encodeURIComponent(data.id)).then(r=>r.json());if(result.redirect){clearInterval(timer);location.replace(result.redirect);}else if(result.status==='expired'){clearInterval(timer);document.querySelector('#state').textContent='This request expired. Connect again from your AI app.';}}catch{document.querySelector('#state').textContent='Connection interrupted. Keep SharedBoard.app open and try again.';}finally{busy=false;}},1500);</script></html>`;
}
