// SharedBoard.app — created by Andrew Barresi (https://github.com/AndBarresi).
// Copyright (c) 2026 Andrew Barresi. Licensed under MIT; see LICENSE.
import { restoreElements, CaptureUpdateAction } from '@excalidraw/excalidraw';
import { diffElements, rebaseElements, indexById, same } from '../shared/scene.mjs';
import {selectElements} from '../shared/scene.mjs';
import {renderScene} from './canvas-actions.mjs';
import {isWebProvider,localConnectionView,webConnectionWip} from './connection-policy.mjs';
import {clearDeletedBoardChatStorage} from './chat-format.mjs';

const unavailableWeb=()=>Promise.reject(Object.assign(new Error(webConnectionWip),{status:501,code:'WEB_CONNECTOR_WIP'}));

export async function connectBoard(onState) {
  const basePath=/^\/boards\/[a-f0-9-]{36}(?=\/|$)/i.exec(location.pathname)?.[0]??'';
  const browserOnly=import.meta.env.VITE_STORAGE_MODE==='browser';
  const browserTransport=browserOnly?await (await import('./browser-store.mjs')).createBrowserTransport({basePath,bridgeBaseURL:import.meta.env.DEV?import.meta.env.VITE_RELAY_ORIGIN:undefined}):null;
  const session = browserOnly?null:await fetch(`${basePath}/api/session`).then((response) => response.json());
  const clientId = crypto.randomUUID();
  const request = async (route, options = {}) => {
    if(browserTransport)return browserTransport.request(route,options);
    const response = await fetch(`${basePath}${route}`, { ...options, headers: { 'Content-Type': 'application/json', 'x-board-token': session.token, ...options.headers } });
    const body = await response.json();
    if (!response.ok) throw Object.assign(new Error(body.error), { ...body, status: response.status });
    return body;
  };
  const [initial, reviewInfo, chatInfo, connectionInfo,planningInfo,workspaceInfo] = await Promise.all([request('/api/board'), request('/api/reviews'), request('/api/chat'),request('/api/connection'),request('/api/planning'),request('/api/workspaces')]);
  const localConnection=localConnectionView(connectionInfo);
  const state = { base: initial, api: null, saving: false, applying: false, dragging: false, conflict: null, queued: null, closed: false, online: browserOnly, lastAgentAt: null, reviews: reviewInfo.requests, agentConnected: Boolean(localConnection?.connected&&reviewInfo.connected), messages:chatInfo.messages, connectionLabel:localConnection?.label, chatConnected:Boolean(localConnection?.connected&&chatInfo.connected), connection:localConnection, automaticMessages:Boolean(localConnection?.connected&&localConnection.automaticMessages) };
  let saveTimer;
  let presenceTimer;
  let selectedIds = [];
  let errorMessage = null;
  let lastEmitted;
  state.planning=planningInfo;
  state.workspace=workspaceInfo;
  const chatInputs=new Map();
  const emit = (status) => {
    const next = {
      board: state.base, status: status ?? (state.conflict ? 'conflict' : state.online ? 'saved' : 'offline'),
      selectedIds, error: errorMessage, conflicts: state.conflict, online: state.online, lastAgentAt: state.lastAgentAt,
      reviews: state.reviews, agentConnected: state.agentConnected,
      messages:state.messages, connectionLabel:state.connectionLabel, chatConnected:state.chatConnected,
      connection:state.connection, automaticMessages:state.automaticMessages,
      planning:state.planning,
      workspace:state.workspace,
      deletedBoard:state.deletedBoard??null,
      storageMode:browserOnly?'browser':'local',
    };
    if (lastEmitted && Object.keys(next).every((key) => next[key] === lastEmitted[key])) return;
    lastEmitted = next;
    onState(next);
  };
  const applyToCanvas = (elements, files) => {
    if (!state.api) return;
    state.applying = true;
    const active=new Set(elements.filter(e=>!e.isDeleted).map(e=>e.id));
    const selection=Object.fromEntries(Object.entries(state.api.getAppState().selectedElementIds).filter(([id,chosen])=>chosen&&active.has(id)));
    selectedIds=Object.keys(selection);
    state.api.addFiles(Object.values(files));
    state.api.updateScene({ elements: restoreElements(structuredClone(elements), null, { refreshDimensions: true, repairBindings: true, normalizeIndices: true }), appState:{selectedElementIds:selection}, captureUpdate: CaptureUpdateAction.NEVER });
    request('/api/presence',{method:'POST',body:JSON.stringify({selectedIds})}).catch(()=>{});
    state.applying = false;
  };
  const accept = (remote, reference = state.base.elements) => {
    if (remote.revision < state.base.revision || state.closed) return;
    if (state.conflict) { state.queued = remote; return; }
    const local = state.api?.getSceneElementsIncludingDeleted() ?? reference;
    const merged = rebaseElements(reference, local, remote.elements);
    if (merged.conflicts.length) {
      state.conflict = merged.conflicts;
      state.queued = remote;
      clearTimeout(saveTimer);
      emit('conflict');
      return;
    }
    state.base = remote;
    applyToCanvas(merged.elements, remote.files);
    errorMessage = null;
    emit();
    scheduleSave();
  };
  const flush = async () => {
    if (!state.api || state.applying || state.saving || state.dragging || state.conflict || state.closed) return;
    const sent = structuredClone(state.api.getSceneElementsIncludingDeleted());
    const changes = diffElements(state.base.elements, sent).map((element) => ({ id: element.id, expectedVersion: state.base.elementVersions[element.id] ?? 0, element }));
    const files = state.api.getFiles();
    const changedFiles = Object.fromEntries(Object.entries(files).filter(([id, file]) => !same(state.base.files[id], file)));
    if (!changes.length && !Object.keys(changedFiles).length) { emit(); return; }
    state.saving = true;
    emit('saving');
    try {
      const remote = await request('/api/board', { method: 'PATCH', body: JSON.stringify({ changes, files: changedFiles, clientId, summary: 'You updated the drawing' }) });
      // Preserve edits made during the save request, using its sent scene as the reference.
      accept(remote, sent);
    } catch (error) {
      if (error.status === 409 && error.board) accept(error.board);
      else { errorMessage = error.message || 'Could not save. Keep this tab open and retry.'; emit('error'); }
    } finally {
      state.saving = false;
      if (state.queued && !state.conflict) { const queued = state.queued; state.queued = null; accept(queued); }
      if (!errorMessage && !state.conflict) scheduleSave();
    }
  };
  function scheduleSave() {
    clearTimeout(saveTimer);
    if (state.api && !state.conflict && !state.closed) saveTimer = setTimeout(flush, 350);
  }
  const events = browserTransport?.events??new EventSource(`${basePath}/api/events?token=${encodeURIComponent(session.token)}`);
  events.addEventListener('connected', (event) => {
    const data = JSON.parse(event.data);
    state.online = true;
    state.lastAgentAt = data.lastAgentAt;
    if(data.connection)state.connection=localConnectionView(data.connection);
    if (data.reviews) { state.reviews = data.reviews.requests; state.agentConnected = Boolean(state.connection?.connected&&data.reviews.connected); }
    if(data.chat){state.messages=data.chat.messages;state.chatConnected=Boolean(state.connection?.connected&&data.chat.connected);state.connectionLabel=state.connection?.label;state.automaticMessages=Boolean(state.connection?.connected&&state.connection.automaticMessages);}
    if(data.planning&&data.planning.version>=state.planning.version)state.planning=data.planning;
    if(data.workspace&&data.workspace.version>=state.workspace.version)state.workspace=data.workspace;
    if (data.board.revision > state.base.revision) accept(data.board);
    emit();
    scheduleSave();
  });
  events.addEventListener('board', (event) => {
    const { board, clientId: sender } = JSON.parse(event.data);
    if (sender === clientId || board.revision <= state.base.revision) return;
    if (state.saving || state.dragging || state.conflict) state.queued = board;
    else accept(board);
  });
  events.addEventListener('agent', (event) => { state.lastAgentAt = JSON.parse(event.data).lastAgentAt; emit(); });
  events.addEventListener('reviews', (event) => {
    const data = JSON.parse(event.data);
    state.reviews = data.requests;
    state.agentConnected = Boolean(state.connection?.connected&&data.connected);
    emit();
  });
  events.addEventListener('chat',(event)=>{const data=JSON.parse(event.data);state.messages=data.messages;state.chatConnected=Boolean(state.connection?.connected&&data.connected);state.connectionLabel=state.connection?.label;state.automaticMessages=Boolean(state.connection?.connected&&state.connection.automaticMessages);emit();});
  events.addEventListener('connection',event=>{state.connection=localConnectionView(JSON.parse(event.data));state.agentConnected=state.connection.connected;state.chatConnected=state.connection.connected;state.connectionLabel=state.connection.label;state.automaticMessages=state.connection.automaticMessages;emit();});
  events.addEventListener('planning',event=>{const next=JSON.parse(event.data);if(next.version>=state.planning.version){state.planning=next;emit();}});
  events.addEventListener('workspace',event=>{const next=JSON.parse(event.data);if(next.version>=state.workspace.version){clearDeletedBoardChatStorage(state.workspace.boards.filter(board=>!next.boards.some(saved=>saved.id===board.id)).map(board=>board.id),{legacyBoardId:state.workspace.legacyBoardId});state.workspace=next;emit();}});
  events.addEventListener('board-deleted',event=>{
    const deleted=JSON.parse(event.data);
    clearDeletedBoardChatStorage(state.workspace.boards.filter(board=>!deleted.workspace.boards.some(saved=>saved.id===board.id)).map(board=>board.id),{legacyBoardId:state.workspace.legacyBoardId});
    state.deletedBoard=deleted;state.closed=true;state.online=false;
    state.agentConnected=false;state.chatConnected=false;state.automaticMessages=false;
    clearTimeout(saveTimer);clearTimeout(presenceTimer);browserTransport?.close();emit('deleted');
  });
  events.onerror = () => { state.online = false; emit('offline'); };
  if(browserTransport)try{await browserTransport.ready();}catch(error){browserTransport.close();throw error;}
  emit(browserOnly?'saved':'loading');
  const waitUntilSaved=async()=>{
    if(!state.api||!state.online)throw new Error('Wait for the board to reconnect before sending.');
    if(state.conflict)throw new Error('Choose which edits to keep before sending.');
    const started=Date.now();
    while(true){
      await flush();
      if(state.conflict||errorMessage)throw new Error(errorMessage??'Resolve the overlapping edits before sending.');
      const dirty=diffElements(state.base.elements,state.api.getSceneElementsIncludingDeleted()).length>0;
      const dirtyFiles=Object.entries(state.api.getFiles()).some(([id,file])=>!same(state.base.files[id],file));
      if(!state.saving&&!dirty&&!dirtyFiles)break;
      if(Date.now()-started>10000)throw new Error('The drawing is still saving. Finish your edit and send again.');
      await new Promise(resolve=>setTimeout(resolve,30));
    }
    const selection=state.api.getAppState().selectedElementIds;
    return {expectedRevision:state.base.revision,selectedIds:Object.keys(selection).filter(id=>selection[id])};
  };
  const captureContext=async({scope,areaId}={})=>{
    const context=await waitUntilSaved(),board=structuredClone(state.base),plan=structuredClone(state.planning);
    scope??=context.selectedIds.length?'selection':'board';
    if(scope==='board')context.selectedIds=[];
    if(scope==='selection'&&!context.selectedIds.length)throw new Error('Select objects on the canvas before preparing this context.');
    if(scope==='area'){
      const area=plan.project.areas.find(a=>a.id===areaId);if(!area)throw new Error('Choose an existing named area.');
      const active=new Set(board.elements.filter(e=>!e.isDeleted).map(e=>e.id));
      context.selectedIds=area.elementIds.filter(id=>active.has(id));
      if(area.elementIds.length&&!context.selectedIds.length)throw new Error('The objects in this area were removed. Save a new named area first.');
      if(!area.elementIds.length){const b=area.bounds;context.selectedIds=board.elements.filter(e=>!e.isDeleted&&e.x+e.width>=b.x&&e.x<=b.x+b.width&&e.y+e.height>=b.y&&e.y<=b.y+b.height).map(e=>e.id);}
    }
    const elements=scope==='area'&&!context.selectedIds.length?[]:selectElements(board.elements,context.selectedIds);
    const visual=await renderScene(elements,board.files);
    if(context.expectedRevision!==state.base.revision||plan.version!==state.planning.version)throw new Error('The board or its notes changed while the image was being prepared. Refresh the preview.');
    if(visual&&visual.length>4_000_000)throw new Error('This view is too detailed for a chat image. Select a smaller area and send again.');
    const ids=new Set(elements.map(e=>e.id));
    const notes=plan.project.notes.filter(n=>scope==='board'||!n.elementIds.length||n.elementIds.some(id=>ids.has(id)));
    return {...context,boardId:board.id,expectedPlanningVersion:plan.version,scope,...(scope==='area'?{areaId}:{}),notes,...(visual?{visual}:{})};
  };
  return {
    initial,
    setApi(api) { state.api = api; scheduleSave(); },
    onChange(elements, appState) {
      if (state.applying || !state.api || state.closed) return;
      const active=new Set(elements.filter(e=>!e.isDeleted).map(e=>e.id));
      const nextSelection = Object.keys(appState.selectedElementIds).filter((id) => appState.selectedElementIds[id]&&active.has(id));
      if (!same(selectedIds, nextSelection)) {
        selectedIds = nextSelection;
        clearTimeout(presenceTimer);
        presenceTimer = setTimeout(() => request('/api/presence', { method: 'POST', body: JSON.stringify({ selectedIds }) }).catch(() => {}), 100);
        emit();
      }
      if (diffElements(state.base.elements, elements).length) { if (!state.conflict) emit('saving'); scheduleSave(); }
    },
    pointerDown() { state.dragging = true; },
    pointerUp() {
      state.dragging = false;
      if (state.queued && !state.saving && !state.conflict) { const queued = state.queued; state.queued = null; accept(queued); }
      scheduleSave();
    },
    retry() { errorMessage = null; scheduleSave(); },
    resolveConflict(keepLocal) {
      const remote = state.queued;
      if (!remote) return;
      let elements = remote.elements;
      if (keepLocal) {
        const changes = diffElements(state.base.elements, state.api.getSceneElementsIncludingDeleted());
        const map = indexById(remote.elements);
        for (const element of changes) map.set(element.id, element);
        elements = [...map.values()];
      }
      state.base = remote;
      state.conflict = null;
      state.queued = null;
      applyToCanvas(elements, { ...remote.files, ...state.api.getFiles() });
      emit(); scheduleSave();
    },
    getApi: () => state.api,
    getBase: () => state.base,
    getPlanning:()=>state.planning,
    flush,
    waitUntilSaved,
    prepareContext:captureContext,
    async workspaceAction(input){const legacyBoardId=state.workspace.legacyBoardId,result=await request('/api/workspaces',{method:'POST',body:JSON.stringify(input)});if(result.deletedBoardIds)clearDeletedBoardChatStorage(result.deletedBoardIds,{legacyBoardId});return result;},
    async previewWorkspaceDelete(input){await waitUntilSaved();return request('/api/workspaces/delete-preview',{method:'POST',body:JSON.stringify(input)});},
    openAfterDeletion(result){const url=new URL(result.url);if(url.origin!==location.origin||!/^\/(?:boards\/[a-f0-9-]{36}\/)?$/i.test(url.pathname)||url.search||url.hash)throw new Error('The remaining board address was invalid.');location.assign(url.href);},
    async openBoard(id){await waitUntilSaved();const result=await request('/api/workspaces/open',{method:'POST',body:JSON.stringify({id})});const url=new URL(result.url);if(url.origin!==location.origin||!/^\/(?:boards\/[a-f0-9-]{36}\/)?$/i.test(url.pathname))throw new Error('The board address was invalid.');const authorization=new URLSearchParams(location.search).get('sharedboard_connect');if(authorization&&/^[a-f0-9]{64}$/.test(authorization))url.searchParams.set('sharedboard_connect',authorization);location.assign(url.href);},
    async recoveryAction(id,action,expectedRevision,expectedVersion){if(action==='restore')await waitUntilSaved();return request('/api/recovery',{method:'POST',body:JSON.stringify({id,action,expectedRevision,expectedVersion})});},
    async updateVisual(){const board=structuredClone(state.base);if(!board.elements.some(e=>!e.isDeleted))return;const visual=await renderScene(board.elements,board.files);if(visual&&visual.length<=4_000_000&&!state.closed)await request('/api/visual',{method:'POST',body:JSON.stringify({expectedRevision:board.revision,visual})});},
    async saveProject(project,expectedVersion=state.planning.version){const result=await request('/api/planning',{method:'PUT',body:JSON.stringify({expectedVersion,project})});state.planning=result;emit();return result;},
    async checkpoint(name){const {expectedRevision}=await waitUntilSaved();return request('/api/checkpoints',{method:'POST',body:JSON.stringify({name,expectedRevision})});},
    async checkpointAction(id,action,expectedRevision,expectedVersion){if(action==='restore')await waitUntilSaved();return request('/api/checkpoint',{method:'POST',body:JSON.stringify({id,action,expectedRevision,expectedVersion})});},
    async exportProject(){await waitUntilSaved();return request('/api/project/export');},
    async importProject(backup,expectedRevision,expectedVersion){await waitUntilSaved();return request('/api/project/import',{method:'POST',body:JSON.stringify({backup,expectedRevision,expectedVersion})});},
    async proposalAction(id,action){if(action==='accept')await waitUntilSaved();return request('/api/proposal',{method:'POST',body:JSON.stringify({id,action})});},
    async undoAgent(id){await waitUntilSaved();return request('/api/undo-agent',{method:'POST',body:JSON.stringify({id})});},
    beginPairing:input=>isWebProvider(input?.provider)?unavailableWeb():request('/api/connection/pairing',{method:'POST',body:JSON.stringify(input)}),
    readConnectionRequest:id=>request(`/api/connection/oauth-request?id=${encodeURIComponent(id)}`),
    approveConnection:input=>request('/api/connection/approve',{method:'POST',body:JSON.stringify(input)}),
    detectBridge:()=>browserTransport?browserTransport.detectBridge():Promise.resolve({available:true,local:true}),
    bridgeStatus:()=>browserTransport?browserTransport.bridgeStatus():request('/api/connection'),
    cancelPairing:()=>request('/api/connection/cancel',{method:'POST',body:'{}'}),
    disconnect:()=>request('/api/connection/disconnect',{method:'POST',body:'{}'}),
    startWeb:unavailableWeb,
    stopWeb:()=>request('/api/connection/web/stop',{method:'POST',body:'{}'}),
    approveWeb:unavailableWeb,
    async sendChat(input){
      if(state.messages.some(m=>m.id===input.id))return {messages:state.messages,connected:state.chatConnected};
      if(!chatInputs.has(input.id)){
        const capture=input.capturedContext??await captureContext();
        if(capture.boardId!==state.base.id)throw new Error('This preview belongs to another board. Prepare a new preview.');
        const {notes,...context}=capture;
        chatInputs.set(input.id,{id:input.id,text:input.text,intent:input.intent,...context,...(browserOnly?{automaticRequired:true}:{})});
      }
      let data;try{data=await request('/api/chat',{method:'POST',body:JSON.stringify(chatInputs.get(input.id))});}catch(error){if(error.status===409&&error.message.includes('drawing changed before sending'))chatInputs.delete(input.id);throw error;}
      state.messages=data.messages;state.chatConnected=data.connected;state.connectionLabel=data.connectionLabel;emit();return data;
    },
    async retryChat(id){const data=await request('/api/chat/retry',{method:'POST',body:JSON.stringify({id})});state.messages=data.messages;state.chatConnected=data.connected;emit();return data;},
    async requestReview() {
      const body = { id: crypto.randomUUID(), ...await captureContext(), ...(browserOnly?{automaticRequired:true}:{}) };
      const result = await request('/api/reviews', { method: 'POST', body: JSON.stringify(body) });
      state.reviews = [result.request, ...state.reviews.filter((review) => review.id !== result.request.id)];
      state.agentConnected = result.connected;
      emit();
      return result.request;
    },
    async retryReview(id) {
      const result = await request('/api/reviews/retry', { method: 'POST', body: JSON.stringify({ id }) });
      state.reviews = result.requests;
      state.agentConnected = result.connected;
      emit();
    },
    close() { state.closed = true; clearTimeout(saveTimer); clearTimeout(presenceTimer); if(browserTransport)browserTransport.close();else events.close(); },
    hasUnsaved() { return !state.deletedBoard&&state.api && (state.saving || diffElements(state.base.elements, state.api.getSceneElementsIncludingDeleted()).length > 0 || Object.entries(state.api.getFiles()).some(([id,file])=>!same(state.base.files[id],file))); },
  };
}
