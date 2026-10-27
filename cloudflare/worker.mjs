// SharedBoard.app hosted relay. No drawing, screenshot, message or reply is written to cloud storage.
import {createMcpHandler} from '@modelcontextprotocol/server';
import {createBoardMcp} from '../server/tools.mjs';
import {RelayAuthorization} from './auth.mjs';
import {BoardRelay} from './relay.mjs';
import {json,fail,body,failureResponse,uuid,tokenSession,internal,hash,permissionFor} from './protocol.mjs';
import {attachEventHandlers} from './events.mjs';
import {attachChatPanel} from './chat-panel.mjs';
import {APP_VERSION} from '../shared/version.mjs';
export {BoardRelay};
const ORIGIN='https://connect.sharedboard.app',APP='https://sharedboard.app';
const authStub=env=>env.RELAY_AUTH.get(env.RELAY_AUTH.idFromName('sharedboard-oauth-v1'));
const sessionStub=(env,id)=>env.BOARD_RELAY.get(env.BOARD_RELAY.idFromName(uuid(id,'session ID')));
function expectedOrigin(env){return env.RELAY_ORIGIN??ORIGIN;}
function requireBrowser(request,env){if(request.headers.get('origin')!==(env.APP_ORIGIN??APP))throw fail('This website is not allowed to use the SharedBoard connector.',403,'ORIGIN_DENIED');}
function cors(response,request,env,{publicRoute=false}={}){const origin=request.headers.get('origin'),headers=new Headers(response.headers);if(publicRoute)headers.set('Access-Control-Allow-Origin','*');else if(origin===(env.APP_ORIGIN??APP)){headers.set('Access-Control-Allow-Origin',origin);headers.append('Vary','Origin');}headers.set('Access-Control-Expose-Headers','WWW-Authenticate, MCP-Protocol-Version, Mcp-Session-Id');return new Response(response.body,{status:response.status,statusText:response.statusText,headers,...(response.webSocket?{webSocket:response.webSocket}:{})});}
async function authenticate(request,env){const token=request.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/i)?.[1];if(!token)throw fail('Authorize the SharedBoard connector from its browser page.',401,'UNAUTHORIZED');const grant=await internal(authStub(env),'/verify',{token});await internal(sessionStub(env,grant.sessionId),'/agent/check',{grant,connected:false});return grant;}
export class RelayAuth{
 constructor(ctx,env){this.ctx=ctx;this.auth=new RelayAuthorization({storage:ctx.storage,origin:expectedOrigin(env),appOrigin:env.APP_ORIGIN??APP});this.ready=ctx.blockConcurrencyWhile(async()=>{if(!await ctx.storage.getAlarm())await ctx.storage.setAlarm(Date.now()+60*60_000);});}
 async fetch(request){await this.ready;try{const url=new URL(request.url),input=await body(request,16384);let result;
  if(url.pathname==='/metadata')result=this.auth.metadata();
  else if(url.pathname==='/register')result=await this.auth.register(input.body,input.ip);
  else if(url.pathname==='/authorize')result=await this.auth.start(input.params,input.ip);
  else if(url.pathname==='/request')result=await this.auth.requestInfo(input.id);
  else if(url.pathname==='/decide')result=await this.auth.decide(input.id,input.allow,input.session);
  else if(url.pathname==='/token')result=await this.auth.issue(input.params,input.ip);
  else if(url.pathname==='/verify')result=await this.auth.verify(input.token);
  else if(url.pathname==='/revoke')result=await this.auth.revoke(input.token);
  else if(url.pathname==='/rate')result=await this.auth.rate(input.key,input.ip);
  else throw fail('Unknown authorization operation.',404);
  return json(result);
 }catch(error){return failureResponse(error);}}
 async alarm(){await this.auth.cleanup();await this.ctx.storage.setAlarm(Date.now()+60*60_000);}
}
export async function handleRequest(request,env){
 const url=new URL(request.url),origin=expectedOrigin(env),path=url.pathname,publicRoute=!path.startsWith('/browser/')&&!path.startsWith('/oauth/');
 try{
  if(url.origin!==origin)throw fail('Use the configured SharedBoard connector address.',403,'HOST_DENIED');
  if(request.method==='OPTIONS'){
   if(!publicRoute)requireBrowser(request,env);const requested=(request.headers.get('access-control-request-headers')??'').split(',').map(v=>v.trim().toLowerCase()).filter(Boolean),allowed=new Set(publicRoute?['authorization','content-type','mcp-protocol-version','mcp-session-id','mcp-method','mcp-name','last-event-id']:['content-type','x-sharedboard-browser']);if(requested.some(header=>!allowed.has(header)))throw fail('These connector request headers are not allowed.',403);
   return cors(new Response(null,{status:204,headers:{'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':[...allowed].join(', '),'Access-Control-Max-Age':'300','Cache-Control':'no-store'}}),request,env,{publicRoute});
  }
  if(path==='/health'&&request.method==='GET')return cors(json({ok:true,product:'SharedBoard Relay',version:APP_VERSION,storage:'browser',modelHosted:false}),request,env,{publicRoute:true});
  if(path==='/.well-known/oauth-authorization-server'&&request.method==='GET')return cors(json(await internal(authStub(env),'/metadata')),request,env,{publicRoute:true});
  if(['/.well-known/oauth-protected-resource','/.well-known/oauth-protected-resource/mcp'].includes(path)&&request.method==='GET')return cors(json({resource:`${origin}/mcp`,authorization_servers:[origin],scopes_supported:['board.read','board.write'],bearer_methods_supported:['header'],resource_name:'SharedBoard.app browser board'}),request,env,{publicRoute:true});
  const ip=await hash(request.headers.get('cf-connecting-ip')??'unknown');
  if(path==='/register'&&request.method==='POST')return cors(json(await internal(authStub(env),'/register',{body:await body(request,16384),ip}),201),request,env,{publicRoute:true});
  if(path==='/authorize'&&request.method==='GET'){
   if([...new Set(url.searchParams.keys())].some(key=>url.searchParams.getAll(key).length>1))throw fail('Duplicate OAuth parameters are not allowed.');const result=await internal(authStub(env),'/authorize',{params:Object.fromEntries(url.searchParams),ip});return new Response(null,{status:302,headers:{Location:result.redirect,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
  }
  if(path==='/token'&&request.method==='POST'){
   const issued=await internal(authStub(env),'/token',{params:await body(request,16384),ip});await internal(sessionStub(env,issued.grant.sessionId),'/agent/check',{grant:issued.grant,connected:false});return cors(json(issued.tokens),request,env,{publicRoute:true});
  }
  if(path==='/revoke'&&request.method==='POST'){const input=await body(request,16384),revoked=await internal(authStub(env),'/revoke',input);if(revoked.grant)await internal(sessionStub(env,revoked.grant.sessionId),'/agent/revoke',{grant:revoked.grant});return cors(json({ok:true}),request,env,{publicRoute:true});}
  if(path==='/oauth/request'&&request.method==='GET'){requireBrowser(request,env);return cors(json(await internal(authStub(env),'/request',{id:url.searchParams.get('id')})),request,env);}
  if(path==='/oauth/deny'&&request.method==='POST'){requireBrowser(request,env);const input=await body(request,8192);return cors(json(await internal(authStub(env),'/decide',{id:input.requestId,allow:false})),request,env);}
  if(path==='/browser/socket'&&request.method==='GET'){
   requireBrowser(request,env);const id=uuid(url.searchParams.get('session'),'session ID');const headers=new Headers(request.headers);return sessionStub(env,id).fetch(new Request(`${origin}/socket`,{method:'GET',headers}));
  }
  if(path==='/browser/pair'&&request.method==='POST'){
   requireBrowser(request,env);await internal(authStub(env),'/rate',{key:'pair',ip});const input=await body(request,8192),id=crypto.randomUUID();return cors(json(await internal(sessionStub(env,id),'/create',{...input,id})),request,env);
  }
  if(path.startsWith('/browser/')){
   requireBrowser(request,env);const token=request.headers.get('x-sharedboard-browser'),id=tokenSession(token),stub=sessionStub(env,id),input=request.method==='POST'?await body(request,8192):{};
   if(!['/browser/status','/browser/disconnect','/browser/handoff','/browser/notify','/browser/approve'].includes(path))throw fail('Unknown browser connector operation.',404);
   if(path==='/browser/status'&&request.method!=='GET'||path!=='/browser/status'&&request.method!=='POST')throw fail('This connector method is not supported.',405);
   if(path==='/browser/approve'){
    if(typeof input.allow!=='boolean')throw fail('Choose whether to approve this AI connection.');const info=await internal(authStub(env),'/request',{id:input.requestId});
    const owner=await internalBrowser(stub,'/browser/owner',{},token);if(input.allow&&(owner.activated||owner.authorizedClient&&owner.authorizedClient!==info.clientId))throw fail('This board is already connected or authorizes another AI client. Use its existing connector or disconnect before authorizing again.',409,'CONNECTION_REPLACED');const decision=await internal(authStub(env),'/decide',{id:input.requestId,allow:input.allow,session:owner});if(decision.grant)await internalBrowser(stub,'/browser/authorize',{clientId:decision.grant.clientId,scope:decision.grant.scope,familyId:decision.grant.familyId},token);return cors(json({redirect:decision.redirect,connection:(await internalBrowser(stub,'/browser/status',{},token)).connection}),request,env);
   }
   return cors(json(await internalBrowser(stub,path,input,token)),request,env);
  }
  if(path==='/mcp'){
   const grant=await authenticate(request,env),stub=sessionStub(env,grant.sessionId);
   const handler=createMcpHandler(()=>{
    const mcp=createBoardMcp((operation,input)=>internal(stub,'/agent/call',{grant,operation,input}),{remote:true,remotePair:true,proposals:false});
    attachEventHandlers(mcp,(method,params)=>internal(stub,'/agent/events',{grant,method,params}));
    return attachChatPanel(mcp,(operation,input)=>internal(stub,'/agent/panel',{grant,operation,input}),{serverURL:`${origin}/mcp`,provider:async()=>(await internal(stub,'/agent/check',{grant,connected:false})).connection.provider});
   },{responseMode:'auto',maxRequestBodySize:4_000_000});
   const response=await handler.fetch(request,{authInfo:{token:'verified',clientId:grant.clientId,scopes:grant.scope.split(' '),extra:{grant}}});return cors(response,request,env,{publicRoute:true});
  }
  throw fail('Unknown SharedBoard connector route.',404);
 }catch(error){
  let response;if(path==='/token'||path==='/register')response=json({error:String(error.code??'invalid_request').toLowerCase(),error_description:error.status&&error.status<500?error.message:'The connector could not finish this request.'},error.status??400);else response=failureResponse(error);
  if(error.status===401&&path==='/mcp'){const headers=new Headers(response.headers);headers.set('WWW-Authenticate',`Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`);response=new Response(response.body,{status:401,headers});}
  return cors(response,request,env,{publicRoute});
 }
}
async function internalBrowser(stub,path,input,token){const response=await stub.fetch(new Request(`https://internal${path}`,{method:'POST',headers:{'content-type':'application/json','x-sharedboard-browser':token},body:JSON.stringify(input)}));const result=await response.json();if(!response.ok)throw fail(result.error,response.status,result.code);return result;}
export default {fetch:handleRequest};
