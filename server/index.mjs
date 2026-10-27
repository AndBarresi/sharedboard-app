import http from 'node:http';
import { createReadStream, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import * as z from 'zod/v4';
import { BoardStore } from './store.mjs';
import { patchSchema, specSchema, editsSchema, idSchema,visualSchema } from './schemas.mjs';
import { createElements, editElements } from './elements.mjs';
import { summarizeScene } from '../shared/scene.mjs';
import { ReviewStore } from './reviews.mjs';
import { notifyCodex } from './notify-codex.mjs';
import { ChatStore } from './chat.mjs';
import {ConnectionStore,manualHandoff} from './connections.mjs';
import {WebConnector} from './web-connector.mjs';
import {APP_VERSION} from '../shared/version.mjs';
import {PlanningStore,planningSchema} from './planning.mjs';
import {VisualStore} from './visual.mjs';
import {WorkspaceCatalog} from './workspaces.mjs';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));

export async function startServer({ port = Number(process.env.PORT ?? 4317), dataDir = process.env.WHITEBOARD_DATA_DIR ?? path.join(projectRoot, 'data'), dev = false, notifyReview, notifyChat, startTunnel,enableWebConnectors=false,workspaceCatalog,boardId,boardTitle,distDir=path.join(projectRoot,'dist') } = {}) {
  const store = new BoardStore(dataDir,{id:boardId,title:boardTitle});
  const planning = new PlanningStore(dataDir,store.board.id);
  if(boardTitle&&!existsSync(planning.filename)){planning.state.project.title=boardTitle;planning.save();}
  const ownsCatalog=!workspaceCatalog;
  const catalog=workspaceCatalog??new WorkspaceCatalog(dataDir,{legacyBoardId:store.board.id,title:planning.state.project.title});
  const visuals=new VisualStore(dataDir);
  const reviews = new ReviewStore(dataDir);
  const chats = new ChatStore(dataDir);
  const connections=new ConnectionStore(dataDir,{boardId:store.board.id,projectRoot});
  const chatInFlight = new Map();
  const deliveryInFlight = new Map();
  const deliver = notifyReview ?? ((request) => notifyCodex(request, { dataDir, projectRoot }));
  const tokenFile = path.join(dataDir, '.token');
  const token = existsSync(tokenFile) ? readFileSync(tokenFile, 'utf8').trim() : randomBytes(32).toString('hex');
  writeFileSync(tokenFile, token, { mode: 0o600 });
  const streams = new Set();
  let presence = { selectedIds: [], updatedAt: null };
  let lastAgentAt = null;
  let vite;
  let webConnector;
  if (dev) {
    const { createServer } = await import('vite');
    vite = await createServer({ root: projectRoot, server: { middlewareMode: true }, appType: 'spa' });
  }
  const sendEvent = (type, data) => {
    for (const stream of streams) stream.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const webFeatures={webConnectors:enableWebConnectors};
  const lockedWebStatus={phase:'locked',available:false,wip:true,provider:null,permission:null,url:null,expiresAt:null,detail:'ChatGPT and Claude web connectors are work in progress in this local beta.',error:null,pending:[],chatOpen:false};
  const webState=()=>enableWebConnectors?{...(webConnector?.status()??{phase:'off',pending:[]}),available:true,wip:false}:lockedWebStatus;
  const connectionState=()=>({...connections.status(),features:webFeatures,web:webState()});
  const requireWebConnectors=()=>{if(!enableWebConnectors)throw Object.assign(new Error('ChatGPT and Claude web connectors are locked as work in progress in the SharedBoard.app local beta. Use Codex, Claude Code or another local MCP client.'),{status:501,code:'WEB_CONNECTOR_WIP'});};
  const publishConnection=()=>sendEvent('connection',connectionState());
  const publishPlanning=()=>sendEvent('planning',planning.view());
  const publishWorkspace=()=>sendEvent('workspace',catalog.view(store.board.id));
  const unsubscribeWorkspace=catalog.subscribe(publishWorkspace);
  const saveRecovery=(reason,force=false)=>{if(planning.automaticRecovery(store.board,reason,{force}))publishPlanning();};
  const captureFields={boardId:z.string().uuid().optional(),expectedPlanningVersion:z.number().int().min(0).optional(),scope:z.enum(['board','selection','area']).optional(),areaId:z.string().uuid().optional()};
  const validateCapture=(input,exists)=>{
    if(exists)return;
    if(input.boardId&&input.boardId!==store.board.id)throw Object.assign(new Error('This preview belongs to another board. Prepare a new preview.'),{status:409});
    if(input.expectedPlanningVersion!==undefined&&input.expectedPlanningVersion!==planning.state.version)throw Object.assign(new Error('The planning notes changed. Refresh the context preview before sending.'),{status:409});
    if(input.scope==='board'&&input.selectedIds.length||input.scope==='selection'&&!input.selectedIds.length)throw Object.assign(new Error('The requested scope does not match the selection.'),{status:400});
    if(input.scope==='area'&&!planning.state.project.areas.some(a=>a.id===input.areaId))throw Object.assign(new Error('That named area no longer exists. Refresh the preview.'),{status:409});
  };
  const capturePlanning=input=>{const context=structuredClone(planning.context(input.selectedIds));if(input.scope==='area'&&!input.selectedIds.length)context.notes=context.notes.filter(n=>!n.elementIds.length);return context;};
  const automatic=()=>Boolean(notifyChat||notifyReview||connectionState().automaticMessages);
  const reviewState = () => ({ requests: reviews.list().map(r=>({...r,...(r.delivery==='manual'?{handoffPrompt:manualHandoff('review',r,projectRoot,dataDir)}:{})})), connected: connectionState().connected, automaticMessages:automatic() });
  const publishReviews = () => sendEvent('reviews', reviewState());
  const chatState = () => ({ messages: chats.list().map(m=>({...m,...(m.delivery==='manual'?{handoffPrompt:manualHandoff('chat',m,projectRoot,dataDir)}:{})})), connected: connectionState().connected, connectionLabel: connectionState().label, automaticMessages:automatic() });
  const publishChat = () => sendEvent('chat', chatState());
  const deliverChat = (message) => {
    if(chatInFlight.has(message.id))return chatInFlight.get(message.id);
    const pending=Promise.resolve().then(()=>notifyChat?notifyChat(message):notifyCodex(message,{dataDir,projectRoot,kind:'chat'})).then(receipt=>{chats.delivered(message.id,receipt);connections.mark('deliveryCheckedAt',message.connectionId);}).catch(error=>chats.deliveryFailed(message.id,error)).finally(()=>{chatInFlight.delete(message.id);publishChat();publishConnection();});
    chatInFlight.set(message.id,pending);return pending;
  };
  const deliverRequest = (review) => {
    if (deliveryInFlight.has(review.id)) return deliveryInFlight.get(review.id);
    const pending = Promise.resolve().then(() => deliver(review)).then((receipt) => {reviews.delivered(review.id, receipt);connections.mark('deliveryCheckedAt',review.connectionId);}).catch((error) => reviews.deliveryFailed(review.id, error.message)).finally(() => { deliveryInFlight.delete(review.id); publishReviews();publishConnection(); });
    deliveryInFlight.set(review.id, pending);
    return pending;
  };
  const json = (response, status, data) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(data)); };
  const readBody = async (request) => {
    let length = 0;
    const parts = [];
    for await (const part of request) {
      length += part.length;
      if (length > 25_000_000) throw Object.assign(new Error('This board update is too large (25 MB maximum).'), { status: 413 });
      parts.push(part);
    }
    try { return JSON.parse(Buffer.concat(parts).toString('utf8')); }
    catch { throw Object.assign(new Error('Request must contain valid JSON.'), { status: 400 }); }
  };
  const publish = (body, actor) => {
    const board = store.apply({ ...body, actor });
    sendEvent('board', { board, clientId: body.clientId ?? null });
    return board;
  };
  const server = http.createServer(async (request, response) => {
    try {
      const host = request.headers.host;
      if (!host || !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return json(response, 403, { error: 'Only local connections are accepted.' });
      const url = new URL(request.url, `http://${host}`);
      const origin = request.headers.origin;
      if ((origin && origin !== `http://${host}`) || request.headers['sec-fetch-site'] === 'cross-site') return json(response, 403, { error: 'Cross-site access is disabled.' });
      const boardRoute=/^\/boards\/([0-9a-f-]{36})(\/.*)?$/i.exec(url.pathname);
      if(ownsCatalog&&boardRoute){
        const child=await catalog.open(boardRoute[1]);
        if(!boardRoute[2]){response.writeHead(302,{Location:`/boards/${boardRoute[1]}/`});response.end();return;}
        const upstream=http.request(new URL(child.internalUrl),{method:request.method,path:`${boardRoute[2]}${url.search}`,headers:request.headers},remote=>{response.writeHead(remote.statusCode,remote.headers);remote.pipe(response);});
        upstream.on('error',()=>{if(!response.headersSent)json(response,502,{error:'This board could not be reached. Reopen it from Projects.'});else response.end();});
        response.on('close',()=>upstream.destroy());request.pipe(upstream);return;
      }
      if (url.pathname === '/api/health') return json(response, 200, { ok: true, name: 'shared-board',product:'SharedBoard.app', version:APP_VERSION, revision: store.board.revision,features:webFeatures });
      if (url.pathname === '/api/session' && request.method === 'GET') return json(response, 200, { token,boardId:store.board.id });
      if (url.pathname.startsWith('/api/')) {
        const supplied = Buffer.from(request.headers['x-board-token'] ?? url.searchParams.get('token') ?? '');
        const wanted = Buffer.from(token);
        if (supplied.length !== wanted.length || !timingSafeEqual(supplied, wanted)) return json(response, 401, { error: 'Local board connection is not authenticated.' });
        if (url.pathname.startsWith('/api/agent')) {
          lastAgentAt = new Date().toISOString();
          sendEvent('agent', { lastAgentAt });
        }
        const agentAuth={key:request.headers['x-agent-key'],threadId:request.headers['x-agent-thread']};
        if(url.pathname.startsWith('/api/agent/')&&!['/api/agent/pair','/api/agent/connection'].includes(url.pathname))connections.authorize(agentAuth,url.pathname==='/api/agent/propose'?'propose':['/api/agent/add','/api/agent/edit'].includes(url.pathname));
        if(url.pathname==='/api/workspaces'&&request.method==='GET')return json(response,200,catalog.view(store.board.id));
        if(url.pathname==='/api/workspaces'&&request.method==='POST'){
          const input=z.discriminatedUnion('action',[
            z.object({action:z.literal('create-project'),name:z.string().trim().min(1).max(100)}),
            z.object({action:z.literal('rename-project'),id:z.string().uuid(),name:z.string().trim().min(1).max(100)}),
            z.object({action:z.literal('create-board'),projectId:z.string().uuid(),title:z.string().trim().min(1).max(100)}),
            z.object({action:z.literal('rename-board'),id:z.string().uuid(),title:z.string().trim().min(1).max(100)})
          ]).parse(await readBody(request));
          catalog.change(input);
          if(input.action==='rename-board'){const service=await catalog.open(input.id);await service.rename(input.title);}
          return json(response,200,catalog.view(store.board.id));
        }
        if(url.pathname==='/api/workspaces/open'&&request.method==='POST'){
          const {id}=z.object({id:z.string().uuid()}).parse(await readBody(request));await catalog.open(id);return json(response,200,{url:catalog.publicUrl(id)});
        }
        if(url.pathname==='/api/planning'&&request.method==='GET')return json(response,200,planning.view());
        if(url.pathname==='/api/project/export'&&request.method==='GET'){
          const elements=store.board.elements.filter(e=>!e.isDeleted),fileIds=new Set(elements.map(e=>e.fileId).filter(Boolean));
          return json(response,200,{type:'sharedboard-project',formatVersion:1,appVersion:APP_VERSION,exportedAt:new Date().toISOString(),board:{elements,files:Object.fromEntries(Object.entries(store.board.files).filter(([id])=>fileIds.has(id)))},project:planning.state.project});
        }
        if(url.pathname==='/api/project/import'&&request.method==='POST'){
          const body=z.object({expectedRevision:z.number().int().min(0),expectedVersion:z.number().int().min(0),backup:z.object({type:z.literal('sharedboard-project'),formatVersion:z.literal(1),board:z.object({elements:patchSchema.shape.changes.element.shape.element.array().max(10000),files:patchSchema.shape.files.unwrap()}),project:planningSchema})}).parse(await readBody(request));
          if(body.expectedVersion!==planning.state.version)throw Object.assign(new Error('Project notes changed. Reopen the backup preview before restoring.'),{status:409});
          if(new Set(body.backup.board.elements.map(e=>e.id)).size!==body.backup.board.elements.length)throw Object.assign(new Error('Backup object IDs must be unique.'),{status:400});
          saveRecovery('Before importing a project backup',true);const restore=planning.replace(store.board,body.backup,body.expectedRevision);const board=publish(restore,'user');planning.state.project=restore.project;planning.state.version++;planning.save();catalog.renameBoard(store.board.id,restore.project.title);publishPlanning();return json(response,200,{revision:board.revision});
        }
        if(url.pathname==='/api/visual'&&request.method==='POST'){
          const {expectedRevision,visual}=z.object({expectedRevision:z.number().int().min(0),visual:visualSchema}).parse(await readBody(request));
          if(!visual)throw Object.assign(new Error('A PNG preview is required.'),{status:400});return json(response,200,visuals.put(store.board,expectedRevision,visual));
        }
        if(url.pathname==='/api/agent/visual'&&request.method==='GET')return json(response,200,visuals.read(store.board));
        if(url.pathname==='/api/planning'&&request.method==='PUT'){
          const {expectedVersion,project}=z.object({expectedVersion:z.number().int().min(0),project:planningSchema}).parse(await readBody(request));
          if(expectedVersion===planning.state.version)saveRecovery('Before updating planning notes');
          const result=planning.update(expectedVersion,project);catalog.renameBoard(store.board.id,project.title);publishPlanning();return json(response,200,result);
        }
        if(url.pathname==='/api/recovery'&&request.method==='POST'){
          const {id,action,expectedRevision,expectedVersion}=z.object({id:z.string().uuid(),action:z.enum(['read','restore']),expectedRevision:z.number().int().min(0).optional(),expectedVersion:z.number().int().min(0).optional()}).parse(await readBody(request));
          if(action==='read')return json(response,200,planning.readRecovery(id));
          if(expectedVersion!==planning.state.version)throw Object.assign(new Error('Project details changed. Reopen the recovery preview before restoring.'),{status:409});
          const restore=planning.restoreRecovery(store.board,id,expectedRevision);const board=publish(restore,'user');planning.state.project=restore.project;planning.state.version++;planning.save();catalog.renameBoard(store.board.id,restore.project.title);publishPlanning();return json(response,200,{revision:board.revision});
        }
        if(url.pathname==='/api/checkpoints'&&request.method==='POST'){
          const {name,expectedRevision}=z.object({name:z.string().trim().min(1).max(100),expectedRevision:z.number().int().min(0)}).parse(await readBody(request));
          if(expectedRevision!==store.board.revision)throw Object.assign(new Error('The board changed. Save your checkpoint again.'),{status:409});
          const checkpoint=planning.checkpoint(store.board,name);publishPlanning();return json(response,200,checkpoint);
        }
        if(url.pathname==='/api/checkpoint'&&request.method==='POST'){
          const {id,action,expectedRevision,expectedVersion}=z.object({id:z.string().uuid(),action:z.enum(['read','restore','delete']),expectedRevision:z.number().int().min(0).optional(),expectedVersion:z.number().int().min(0).optional()}).parse(await readBody(request));
          if(action==='read')return json(response,200,planning.readCheckpoint(id));
          if(action==='delete'){planning.deleteCheckpoint(id);publishPlanning();return json(response,200,{ok:true});}
          if(expectedVersion!==undefined&&expectedVersion!==planning.state.version)throw Object.assign(new Error('Project details changed. Reopen the checkpoint preview before restoring.'),{status:409});
          saveRecovery('Before restoring a checkpoint',true);const restore=planning.restore(store.board,id,expectedRevision);
          const board=publish(restore,'user');planning.state.project=restore.project;planning.state.version++;planning.save();catalog.renameBoard(store.board.id,restore.project.title);publishPlanning();return json(response,200,{revision:board.revision});
        }
        if(url.pathname==='/api/proposal'&&request.method==='POST'){
          const {id,action}=z.object({id:z.string().uuid(),action:z.enum(['read','accept','reject'])}).parse(await readBody(request));
          const proposal=planning.proposal(id);if(action==='read')return json(response,200,proposal);
          if(proposal.status!=='pending')throw Object.assign(new Error('This proposal has already been handled.'),{status:409});
          if(action==='accept'){saveRecovery('Before accepting an AI proposal',true);const before=store.board;const after=publish({changes:proposal.changes,summary:proposal.summary},'agent');planning.recordAgent(before,after,proposal.summary);}
          planning.resolve(id,action==='accept'?'accepted':'rejected');publishPlanning();return json(response,200,planning.view());
        }
        if(url.pathname==='/api/undo-agent'&&request.method==='POST'){
          const {id}=z.object({id:z.string().uuid()}).parse(await readBody(request));
          const changes=planning.undo(store.board,id);saveRecovery('Before undoing an AI drawing change',true);
          publish({changes,summary:'You undid an AI drawing change'},'user');planning.markUndone(id);publishPlanning();return json(response,200,{ok:true});
        }
        if(url.pathname==='/api/connection'&&request.method==='GET')return json(response,200,connectionState());
        if(url.pathname==='/api/connection/web/start'&&request.method==='POST'){
          requireWebConnectors();
          const input=z.object({provider:z.enum(['chatgpt-web','claude-web']),permission:z.enum(['read','propose','edit'])}).parse(await readBody(request));
          return json(response,200,await webConnector.begin(input));
        }
        if(url.pathname==='/api/connection/web/stop'&&request.method==='POST'){await webConnector.stop();return json(response,200,webState());}
        if(url.pathname==='/api/connection/web/approve'&&request.method==='POST'){
          requireWebConnectors();
          const {id,allow}=z.object({id:z.string().regex(/^[a-f0-9]{64}$/),allow:z.boolean()}).parse(await readBody(request));return json(response,200,webConnector.decide(id,allow));
        }
        if(url.pathname==='/api/connection/pairing'&&request.method==='POST'){
          const body=z.object({provider:z.enum(['codex','claude','cursor','other']),permission:z.enum(['read','propose','edit'])}).parse(await readBody(request));
          const pairing=connections.begin(body);publishConnection();return json(response,200,{pairing,setup:connections.setup(body.provider,pairing.code)});
        }
        if(url.pathname==='/api/connection/cancel'&&request.method==='POST'){connections.cancel();publishConnection();return json(response,200,connectionState());}
        if(url.pathname==='/api/connection/disconnect'&&request.method==='POST'){await webConnector.stop();const result=connections.disconnect();publishConnection();publishChat();publishReviews();return json(response,200,result);}
        if(url.pathname==='/api/agent/connection'&&request.method==='GET')return json(response,200,connectionState());
        if(url.pathname==='/api/agent/pair'&&request.method==='POST'){
          const body=z.object({code:z.string().min(1).max(128),threadId:z.string().uuid().optional(),label:z.string().trim().min(1).max(80).optional()}).parse(await readBody(request));
          const result=connections.pair(body);await webConnector.stop();publishConnection();publishChat();publishReviews();return json(response,200,result);
        }
        if(url.pathname==='/api/agent/confirm'&&request.method==='POST'){
          const {revision}=z.object({revision:z.number().int().min(0)}).parse(await readBody(request));const result=connections.confirm(agentAuth,revision,store.board.revision);publishConnection();return json(response,200,result);
        }
        if (url.pathname === '/api/events' && request.method === 'GET') {
          response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
          response.write(`event: connected\ndata: ${JSON.stringify({ board: store.board, lastAgentAt, reviews: reviewState(), chat: chatState(), connection:connectionState(),planning:planning.view(),workspace:catalog.view(store.board.id) })}\n\n`);
          streams.add(response);
          const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 15000);
          request.on('close', () => { streams.delete(response); clearInterval(heartbeat); });
          return;
        }
        if (url.pathname === '/api/board' && request.method === 'GET') return json(response, 200, store.board);
        if (url.pathname === '/api/chat' && request.method === 'GET') return json(response, 200, chatState());
        if (url.pathname === '/api/chat' && request.method === 'POST') {
          const input=z.object({id:z.string().uuid(),text:z.string().trim().min(1).max(8000),intent:z.enum(['discuss','work']),expectedRevision:z.number().int().min(0),selectedIds:z.array(idSchema).max(10000),visual:visualSchema,...captureFields}).parse(await readBody(request));
          if(!connectionState().connected)throw Object.assign(new Error('Connect an AI before sending a message.'),{status:503});
          validateCapture(input,chats.messages.some(m=>m.id===input.id));
          const {message,created}=chats.create(store.board,input,connections.current.threadId || connections.current.id);
          if(created){message.snapshot.title=planning.state.project.title;message.snapshot.planning=capturePlanning(input);if(input.visual){message.snapshot.visual={revision:store.board.revision,dataURL:input.visual};message.hasVisual=true;}message.noteCount=message.snapshot.planning.notes.length;message.connectionId=connections.current.id;if(connectionState().deliveryMode==='app')message.delivery='app';else if(!automatic())message.delivery='manual';chats.save();}
          publishChat();if(created&&automatic()&&connectionState().deliveryMode!=='app')await deliverChat(message);return json(response,200,chatState());
        }
        if (url.pathname === '/api/chat/retry' && request.method === 'POST') {
          const {id}=z.object({id:z.string().uuid()}).parse(await readBody(request));const message=chats.find(id);
          if(!connectionState().connected||message.connectionId&&message.connectionId!==connections.current.id)throw Object.assign(new Error('That message belongs to a previous connection. Send a new message to the current AI.'),{status:409});
          if(connectionState().deliveryMode==='app')throw Object.assign(new Error('Check the connected conversation before resending. Web connector requests are never retried automatically.'),{status:409});
          if(['failed','uncertain'].includes(message.delivery)&&message.status!=='answered')await deliverChat(message);
          return json(response,200,chatState());
        }
        if (url.pathname === '/api/agent/chats' && request.method === 'GET') return json(response,200,chatState());
        if (url.pathname === '/api/agent/chat' && request.method === 'POST') {
          const {id}=z.object({id:z.string().uuid()}).parse(await readBody(request));const result=chats.read(id,store.board.revision);publishChat();return json(response,200,result);
        }
        if (url.pathname === '/api/agent/reply' && request.method === 'POST') {
          const {id,text}=z.object({id:z.string().uuid(),text:z.string().trim().min(1).max(20000)}).parse(await readBody(request));const result=chats.reply(id,text);connections.mark('replyCheckedAt',result.connectionId);publishChat();publishConnection();return json(response,200,result);
        }
        if (url.pathname === '/api/reviews' && request.method === 'GET') return json(response, 200, reviewState());
        if (url.pathname === '/api/reviews' && request.method === 'POST') {
          const body = z.object({ id: z.string().uuid(), expectedRevision: z.number().int().min(0), selectedIds: z.array(idSchema).max(10000),visual:visualSchema,...captureFields }).parse(await readBody(request));
          if(!connectionState().connected)throw Object.assign(new Error('Connect an AI before requesting a review.'),{status:503});
          validateCapture(body,reviews.requests.some(r=>r.id===body.id));
          const { request: review, created } = reviews.create(store.board, {...body,currentPlanningVersion:planning.state.version,connectionId:connections.current.id,targetThreadId:connections.current.threadId});
          if(created){review.snapshot.title=planning.state.project.title;review.snapshot.planning=capturePlanning(body);if(body.visual){review.snapshot.visual={revision:store.board.revision,dataURL:body.visual};review.hasVisual=true;}if(connectionState().deliveryMode==='app')review.delivery='app';else if(!automatic())review.delivery='manual';reviews.save();}
          publishReviews();
          if (created&&automatic()&&connectionState().deliveryMode!=='app') await deliverRequest(review);
          return json(response, 200, { request: reviewState().requests.find((item) => item.id === review.id), connected: reviewState().connected });
        }
        if (url.pathname === '/api/reviews/retry' && request.method === 'POST') {
          const { id } = z.object({ id: z.string().uuid() }).parse(await readBody(request));
          const review = reviews.find(id);
          if(!connectionState().connected||review.connectionId&&review.connectionId!==connections.current.id)throw Object.assign(new Error('That review belongs to a previous connection. Request a new review.'),{status:409});
          if(connectionState().deliveryMode==='app')throw Object.assign(new Error('Check the connected conversation before resending this review.'),{status:409});
          if (review.delivery !== 'failed') return json(response, 200, reviewState());
          await deliverRequest(review);
          return json(response, 200, reviewState());
        }
        if (url.pathname === '/api/board' && request.method === 'PATCH') {
          const body = patchSchema.parse(await readBody(request));
          saveRecovery('Automatic drawing recovery');
          const before=store.board,board=publish(body,'user');
          if(planning.recordNormalization(before,board,body.changes))publishPlanning();
          return json(response, 200, board);
        }
        if (url.pathname === '/api/presence' && request.method === 'POST') {
          presence = { ...z.object({ selectedIds: z.array(idSchema).max(10000) }).parse(await readBody(request)), updatedAt: new Date().toISOString() };
          return json(response, 200, { ok: true });
        }
        if (url.pathname === '/api/agent/read' && request.method === 'GET') {
          connections.recordRead(agentAuth,store.board.revision);
          const board = url.searchParams.get('full') === '1' ? { ...store.board, files: Object.fromEntries(Object.entries(store.board.files).map(([id, file]) => [id, { id, mimeType: file.mimeType }])) } : summarizeScene(store.board, presence.selectedIds);
          return json(response, 200, { ...board, title:planning.state.project.title, planning:planning.context(),access:{permission:connections.current.permission}, selectedIds: presence.selectedIds, reviewRequests: reviews.list() });
        }
        if (url.pathname === '/api/agent/reviews' && request.method === 'GET') return json(response, 200, reviewState());
        if (url.pathname === '/api/agent/review' && request.method === 'POST') {
          const { id } = z.object({ id: z.string().uuid() }).parse(await readBody(request));
          const result = reviews.readForAgent(id, store.board.revision);
          publishReviews();
          return json(response, 200, result);
        }
        if (url.pathname === '/api/agent/complete_review' && request.method === 'POST') {
          const { id, summary } = z.object({ id: z.string().uuid(), summary: z.string().trim().min(1).max(4000) }).parse(await readBody(request));
          const result = reviews.complete(id, summary);
          publishReviews();
          return json(response, 200, result);
        }
        if (url.pathname === '/api/agent/add' && request.method === 'POST') {
          const body = z.object({ elements: z.array(specSchema).min(1).max(200), summary: z.string().max(200).default('Agent added objects') }).parse(await readBody(request));
          const elements = createElements(body.elements);
          if (elements.some((element) => store.board.elementVersions[element.id])) throw Object.assign(new Error('An object with that ID already exists. Choose a new ID.'), { status: 409 });
          saveRecovery('Before AI drawing changes',true);
          const before=store.board;
          const board = publish({ changes: elements.map((element) => ({ id: element.id, expectedVersion: 0, element })), summary: body.summary }, 'agent');
          planning.recordAgent(before,board,body.summary);publishPlanning();
          return json(response, 200, { revision: board.revision, createdIds: elements.map((element) => element.id), elementVersions: board.elementVersions });
        }
        if (url.pathname === '/api/agent/edit' && request.method === 'POST') {
          const body = z.object({ edits: editsSchema, summary: z.string().max(200).default('Agent edited objects') }).parse(await readBody(request));
          const changes = editElements(store.board, body.edits);
          saveRecovery('Before AI drawing changes',true);
          const before=store.board;
          const board = publish({ changes, summary: body.summary }, 'agent');
          planning.recordAgent(before,board,body.summary);publishPlanning();
          return json(response, 200, { revision: board.revision, editedIds: changes.map((change) => change.id), elementVersions: board.elementVersions });
        }
        if(url.pathname==='/api/agent/propose'&&request.method==='POST'){
          const body=z.object({id:z.string().uuid().optional(),title:z.string().trim().min(1).max(100),summary:z.string().trim().min(1).max(200),elements:z.array(specSchema).max(200).default([]),edits:editsSchema.optional()}).parse(await readBody(request));
          const added=createElements(body.elements);
          const changes=[...(body.edits?editElements(store.board,body.edits):[]),...added.map(element=>({id:element.id,expectedVersion:0,element}))];
          if(new Set(changes.map(c=>c.id)).size!==changes.length||added.some(e=>store.board.elementVersions[e.id]))throw Object.assign(new Error('Proposal object IDs must be new and unique.'),{status:400});
          const result=planning.propose(store.board,{...body,changes});publishPlanning();return json(response,200,result);
        }
        return json(response, 404, { error: 'Unknown board operation.' });
      }
      const assetRoot = dev ? path.join(projectRoot, 'node_modules/@excalidraw/excalidraw/dist/prod') : path.join(distDir, 'excalidraw');
      if (url.pathname.startsWith('/excalidraw/')) return serveFile(response, assetRoot, url.pathname.slice('/excalidraw/'.length));
      if (vite) return vite.middlewares(request, response);
      const dist = distDir;
      const asset = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      return serveFile(response, dist, asset);
    } catch (error) {
      if (response.headersSent) return response.end();
      json(response, error instanceof z.ZodError ? 400 : error.status ?? 500, { error: error instanceof z.ZodError ? 'Invalid board operation.' : error.message, code:error.code,details: error instanceof z.ZodError ? error.issues : undefined, conflicts: error.conflicts, board: error.board });
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const address = `http://127.0.0.1:${server.address().port}`;
  webConnector=new WebConnector({directory:dataDir,connections,store,chats,reviews,publishChat,publishReviews,startTunnel,onChange:publishConnection,captureSnapshot:()=>{const image=visuals.read(store.board);return {title:planning.state.project.title,planning:structuredClone(planning.context()),...(image.available&&!image.stale?{visual:image.visual}:{})};},callLocal:async(key,operation,input)=>{
    const endpoint=operation==='read_full'?'/api/agent/read?full=1':`/api/agent/${operation}`;
    const response=await fetch(`${address}${endpoint}`,{method:input===undefined?'GET':'POST',headers:{'Content-Type':'application/json','x-board-token':token,'x-agent-key':key},...(input===undefined?{}:{body:JSON.stringify(input)}),signal:AbortSignal.timeout(15000)});
    const result=await response.json();if(!response.ok)throw Object.assign(new Error(result.error),{status:response.status});return result;
  }});
  mkdirSync(dataDir, { recursive: true });
  if(ownsCatalog){catalog.origin=address;catalog.factory=board=>startServer({port:0,dataDir:catalog.directoryFor(board.id),notifyReview,notifyChat,startTunnel,enableWebConnectors,workspaceCatalog:catalog,boardId:board.id,boardTitle:board.title,distDir});}
  const publicUrl=ownsCatalog?address:catalog.publicUrl(store.board.id).replace(/\/$/,'');
  writeFileSync(path.join(dataDir, '.connection.json'), JSON.stringify({ url: publicUrl, token, pid: process.pid, projectRoot,dataDir:path.resolve(dataDir),boardId:store.board.id }), { mode: 0o600 });
  const service={ server, store, planning,catalog,url:publicUrl,internalUrl:address, token,webConnector,async rename(title){saveRecovery('Before renaming this board');planning.update(planning.state.version,{...planning.state.project,title});publishPlanning();}, async close() {if(ownsCatalog)await catalog.closeChildren();unsubscribeWorkspace();await webConnector.stop();for (const stream of streams) stream.end(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await vite?.close(); } };
  catalog.services.set(store.board.id,service);
  return service;
}

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml', '.png': 'image/png' };
function serveFile(response, directory, relative) {
  const filename = path.resolve(directory, relative);
  const inside = path.relative(directory, filename);
  if (inside.startsWith('..') || path.isAbsolute(inside) || !existsSync(filename)) { response.writeHead(404); response.end('Not found'); return; }
  response.writeHead(200, { 'Content-Type': types[path.extname(filename)] ?? 'application/octet-stream' });
  createReadStream(filename).on('error', () => response.destroy()).pipe(response);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await startServer({ dev: process.argv.includes('--dev') });
  console.log(`SharedBoard.app is ready at ${app.url}`);
  console.log('Boards are saved in the project data folder. Keep this process running while drawing.');
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await app.close(); process.exit(0); });
}
