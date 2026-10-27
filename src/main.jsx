import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Excalidraw, serializeAsJSON, restoreElements, CaptureUpdateAction } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import { connectBoard } from './sync.mjs';
import './style.css';
import './canvas-ui.css';
import { DrawingToolbar } from './DrawingToolbar.jsx';
import { BoardChat } from './BoardChat.jsx';
import { Icon } from './Icons.jsx';
import {ConnectionSetup,copyText} from './ConnectionSetup.jsx';
import './connection-ui.css';
import {APP_VERSION,Changelog} from './Changelog.jsx';
import './planning.css';
import {PlanningPanel,SelectionBar,NotePins} from './PlanningPanel.jsx';
import {ReferenceImport} from './ReferenceImport.jsx';
import {SelectionDetails} from './SelectionDetails.jsx';
import {jumpTo,renderScene} from './canvas-actions.mjs';
import {ProjectTransfer} from './ProjectTransfer.jsx';
import {WorkspacePicker} from './WorkspacePicker.jsx';
import {ObjectNavigator} from './ObjectNavigator.jsx';
import {Modal} from './Modal.jsx';
import {CREATOR_NAME,CREATOR_URL} from '../shared/brand.mjs';
import './workspace-upgrade.css';
import './browser-mode-ui.css';

const browserBuild=import.meta.env.VITE_STORAGE_MODE==='browser';

function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function BrowserStorageDetails({onClose,onExport}){
  const supported=typeof navigator.storage?.persist==='function';
  const [persistence,setPersistence]=useState('checking'),[busy,setBusy]=useState(false);
  useEffect(()=>{let active=true;if(typeof navigator.storage?.persisted==='function')navigator.storage.persisted().then(granted=>{if(active)setPersistence(granted?'granted':'available');}).catch(()=>{if(active)setPersistence('available');});else setPersistence(supported?'available':'unsupported');return()=>{active=false;};},[]);
  const protect=async()=>{if(!supported||busy)return;setBusy(true);try{setPersistence(await navigator.storage.persist()?'granted':'declined');}catch{setPersistence('unavailable');}finally{setBusy(false);}};
  return <Modal title="Saved in this browser" subtitle="Your device, your browser profile, your boards." onClose={onClose}><div className="browser-storage-details"><p>Drawings, images, notes and recovery history are stored in this browser profile on this device. Opening the website elsewhere does not bring those boards with you.</p><p>Clearing this site’s data removes its saved boards. Export a board backup to keep a separate copy that you can restore later.</p><section className="browser-storage-protection"><h3>Browser storage protection</h3><p role="status">{persistence==='checking'?'Checking what this browser supports…':persistence==='granted'?'Persistent storage is granted for this site.':persistence==='declined'?'This browser did not grant persistent storage. You can still use the board and export backups.':persistence==='unsupported'||!supported?'This browser does not offer a storage-protection request.':persistence==='unavailable'?'The browser could not complete the request. Your saved boards are still available.':'You can ask the browser to reduce automatic removal of this site’s stored data.'}</p><button type="button" className="secondary-button" onClick={protect} disabled={!supported||busy||persistence==='checking'||persistence==='granted'}>{busy?'Requesting…':persistence==='granted'?'Storage protection granted':'Request storage protection'}</button><small>Granting the request is up to the browser. It does not prevent you from clearing site data and does not replace an exported backup.</small></section><div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Back to the board</button><button type="button" className="primary-button" onClick={onExport}>Export board backup</button></div></div></Modal>;
}

function App() {
  const workspace = useRef(null);
  const sync = useRef(null);
  const initiallyFramed = useRef(false);
  const [initial, setInitial] = useState(null);
  const [view, setView] = useState({ status: 'loading', selectedIds: [], reviews: [], agentConnected: false, board: { revision: 0, activity: [], elements: [] } });
  const browserOnly=browserBuild||view.storageMode==='browser';
  const [bootError, setBootError] = useState(null);
  const [requestingReview, setRequestingReview] = useState(false);
  const [reviewError, setReviewError] = useState(null);
  const [focused,setFocused]=useState(false);
  const [chatOpen,setChatOpen]=useState(false);
  const [connectionOpen,setConnectionOpen]=useState(false);
  const [changelogOpen,setChangelogOpen]=useState(false);
  const [storageDetailsOpen,setStorageDetailsOpen]=useState(false);
  const [planner,setPlanner]=useState(null),[plannerAction,setPlannerAction]=useState(null),[referenceOpen,setReferenceOpen]=useState(false),[selectionOpen,setSelectionOpen]=useState(false);
  const [projectImportOpen,setProjectImportOpen]=useState(false);
  const [workspaceOpen,setWorkspaceOpen]=useState(false),[navigatorOpen,setNavigatorOpen]=useState(false);
  const [ui,setUi]=useState({tool:'selection',zoom:1,stroke:'#26352e',fill:'transparent',fontSize:20});
  const uiSignature=useRef('');
  const setDrawingApi = useCallback((api) => sync.current?.setApi(api), []);
  const onDrawingChange = useCallback((elements, appState) => {
    sync.current?.onChange(elements, appState);
    const selection=elements.find(e=>appState.selectedElementIds[e.id]&&!e.isDeleted);
    const next={tool:appState.activeTool.type,zoom:appState.zoom.value,scrollX:appState.scrollX,scrollY:appState.scrollY,width:appState.width,height:appState.height,selected:Boolean(selection),stroke:selection?.strokeColor??appState.currentItemStrokeColor,fill:selection?.backgroundColor??appState.currentItemBackgroundColor,strokeWidth:selection?.strokeWidth??appState.currentItemStrokeWidth,fontSize:selection?.fontSize??appState.currentItemFontSize,roughness:selection?.roughness??appState.currentItemRoughness};
    const signature=JSON.stringify(next);if(uiSignature.current!==signature){uiSignature.current=signature;setUi(next);}
    if (!initiallyFramed.current && sync.current?.initial.elements.some((element) => !element.isDeleted) && elements.some((element) => !element.isDeleted)) {
      initiallyFramed.current = true;
      requestAnimationFrame(() => sync.current?.getApi()?.scrollToContent(elements.filter((element) => !element.isDeleted), { fitToViewport: true, viewportZoomFactor: 0.65, minZoom: 0.1, maxZoom: 1 }));
    }
  }, []);
  const drawingInitialData = useMemo(() => initial ? { elements: structuredClone(initial.elements), files: structuredClone(initial.files), appState: { viewBackgroundColor: '#fcfcfa', currentItemFontFamily: 2, currentItemStrokeColor:'#26352e',currentItemBackgroundColor:'transparent',currentItemFontSize:20,gridSize:null }, scrollToContent: true } : null, [initial]);
  const drawingUi = useMemo(() => ({ canvasActions: { loadScene: true, saveToActiveFile: false, export: { saveFileToDisk: true }, toggleTheme: false } }), []);
  const openPlanner=(tab,action=null)=>{if(window.innerWidth<1200)setChatOpen(false);setNavigatorOpen(false);setPlanner(tab);setPlannerAction(action?{...action,id:crypto.randomUUID()}:null);};
  const setChatVisibility=value=>{if(value&&window.innerWidth<1200){setPlanner(null);setNavigatorOpen(false);}setChatOpen(value);};
  useEffect(()=>{
    const shortcut=e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();openPlanner('areas');}};
    document.addEventListener('keydown',shortcut);return()=>document.removeEventListener('keydown',shortcut);
  },[]);
  useEffect(() => {
    let disposed = false;
    connectBoard((next) => { if (!disposed) setView(next); }).then((connection) => {
      if (disposed) return connection.close();
      sync.current = connection;
      setInitial(connection.initial);
    }).catch((error) => setBootError(error.message));
    const leave = (event) => { if (sync.current?.hasUnsaved()) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', leave);
    const releasePointer = () => sync.current?.pointerUp();
    window.addEventListener('pointerup', releasePointer);
    return () => { disposed = true; sync.current?.close(); window.removeEventListener('beforeunload', leave); window.removeEventListener('pointerup', releasePointer); };
  }, []);

  useEffect(()=>{
    const changed=()=>{if(!document.fullscreenElement)setFocused(false);};
    const escaped=e=>{if(e.key==='Escape'&&!document.fullscreenElement)setFocused(false);};
    document.addEventListener('fullscreenchange',changed);document.addEventListener('keydown',escaped);
    return()=>{document.removeEventListener('fullscreenchange',changed);document.removeEventListener('keydown',escaped);};
  },[]);
  useEffect(()=>{requestAnimationFrame(()=>sync.current?.getApi()?.refresh());},[focused]);
  useEffect(()=>{if(view.status!=='saved'||!initial)return;const timer=setTimeout(()=>sync.current?.updateVisual().catch(()=>{}),1000);return()=>clearTimeout(timer);},[view.board.revision,view.status,initial]);
  const toggleFullscreen=async()=>{
    if(focused){if(document.fullscreenElement)await document.exitFullscreen().catch(()=>{});setFocused(false);return;}
    setChatOpen(false);setPlanner(null);setNavigatorOpen(false);setFocused(true);
    try{await workspace.current.requestFullscreen?.();}catch{}
  };
  const exportBoard = () => {
    const api = sync.current?.getApi();
    if (api) download(`${(view.planning?.project.title||'sharedboard').replace(/[^a-z0-9-]/gi,'-')}.excalidraw`, serializeAsJSON(api.getSceneElementsIncludingDeleted(), api.getAppState(), api.getFiles(), 'local'));
  };
  const exportProject=async()=>{try{const backup=await sync.current.exportProject();download(`${backup.project.title.replace(/[^a-z0-9-]/gi,'-')}.sharedboard`,JSON.stringify(backup,null,2));}catch(e){setReviewError(e.message);}};
  const importBoard=async(file)=>{
    const api=sync.current?.getApi();if(!api)return;
    if(file.size>20_000_000)throw new Error('Choose a drawing smaller than 20 MB.');
    const scene=JSON.parse(await file.text());
    if(scene.type!=='excalidraw'||!Array.isArray(scene.elements))throw new Error('Choose an Excalidraw drawing file.');
    const ids=new Map(scene.elements.map(e=>[e.id,crypto.randomUUID()]));
    const fileIds=new Map(Object.keys(scene.files??{}).map(id=>[id,crypto.randomUUID()]));
    const groupIds=new Map(scene.elements.flatMap(e=>e.groupIds??[]).map(id=>[id,crypto.randomUUID()]));
    const imported=restoreElements(scene.elements.filter(e=>!e.isDeleted).map(e=>({...e,id:ids.get(e.id),index:null,groupIds:(e.groupIds??[]).map(id=>groupIds.get(id)),frameId:ids.get(e.frameId)??null,containerId:e.containerId?ids.get(e.containerId):null,boundElements:e.boundElements?.map(b=>({...b,id:ids.get(b.id)})).filter(b=>b.id),startBinding:e.startBinding?{...e.startBinding,elementId:ids.get(e.startBinding.elementId)}:null,endBinding:e.endBinding?{...e.endBinding,elementId:ids.get(e.endBinding.elementId)}:null,...(e.fileId?{fileId:fileIds.get(e.fileId)}:{})})),null,{refreshDimensions:true,repairBindings:true,normalizeIndices:true});
    api.addFiles(Object.entries(scene.files??{}).map(([id,f])=>({...f,id:fileIds.get(id)})));
    api.updateScene({elements:[...api.getSceneElementsIncludingDeleted(),...imported],captureUpdate:CaptureUpdateAction.IMMEDIATELY});
    api.scrollToContent(imported,{fitToViewport:true,viewportZoomFactor:.8,maxZoom:1});
  };
  const askForReview = async () => {
    if(browserOnly&&!view.agentConnected){setConnectionOpen(true);return;}
    setRequestingReview(true);
    setReviewError(null);
    try { const result=await sync.current.requestReview();if(result.handoffPrompt)await copyText(result.handoffPrompt); }
    catch (error) { setReviewError(error.message || 'Delivery could not be confirmed. Please try again.'); }
    finally { setRequestingReview(false); }
  };
  const retryReview = async (id) => {
    if(browserOnly&&!view.agentConnected){setConnectionOpen(true);return;}
    setRequestingReview(true); setReviewError(null);
    try { await sync.current.retryReview(id); }
    catch (error) { setReviewError(error.message); }
    finally { setRequestingReview(false); }
  };
  const testConnection=async()=>{
    const id=crypto.randomUUID();
    const result=await sync.current.sendChat({id,intent:'discuss',text:'Connection check only. Please read the live board and confirm its exact revision with confirm_connection (or the helper confirm command), then reply to this mini chat to acknowledge that the connection works. No drawing changes are requested.'});
    setChatVisibility(true);
    const message=result.messages.find(item=>item.id===id);
    if(message?.handoffPrompt){try{await copyText(message.handoffPrompt);}catch{setReviewError('The test is saved in the mini chat. Choose Copy to Codex there, then paste it into your linked conversation.');}}
    else if(!view.connection?.automaticMessages&&!message?.reply)throw new Error(message?.deliveryError||'The test is saved, but its copy-to-Codex instructions could not be prepared. Retry preparation from the mini chat.');
  };
  const latestReview = view.reviews[0];
  const reviewCurrent=latestReview&&(!latestReview.connectionId||latestReview.connectionId===view.connection?.id);
  const samePendingReview = reviewCurrent && latestReview.boardRevision === view.board.revision && latestReview.planningVersion===view.planning?.version && JSON.stringify([...latestReview.selectedIds].sort()) === JSON.stringify([...view.selectedIds].sort()) && ['requested', 'reviewing'].includes(latestReview.status) && latestReview.delivery !== 'failed';
  const reviewHeading = !latestReview ? '' : latestReview.status === 'reviewed' ? 'AI reviewed your board' : latestReview.status === 'reviewing' ? 'AI is reviewing' : latestReview.delivery === 'uncertain' ? 'Check your linked chat before retrying' : latestReview.delivery === 'app' ? 'Waiting for your connected chat card' : latestReview.delivery === 'manual' ? 'Review ready to copy to your AI' : latestReview.delivery === 'failed' ? 'Review saved · delivery needs attention' : latestReview.delivery === 'queued' ? 'Waiting for AI' : 'Sending your review request…';
  const statusText = { loading: browserOnly?'Opening browser storage…':'Connecting…', saving: 'Saving your changes…', saved: browserOnly?'Saved in this browser':'Saved on this computer', offline: browserOnly?'Browser storage needs attention':'Reconnecting · keep this tab open', error: 'Save needs attention', conflict: 'Two edits need your choice' }[view.status];
  const count = view.board.elements.filter((element) => !element.isDeleted).length;
  const reviewVisible=reviewError || (reviewCurrent && (latestReview.status!=='reviewed' || latestReview.boardRevision===view.board.revision));
  return (
    <div className={`workspace ${focused?'is-focused':''} ${browserOnly?'browser-mode':''}`} ref={workspace}>
      <aside className="rail">
        <div className="brand" aria-label="SharedBoard.app"><span className="brand-mark" aria-hidden="true">↗</span><span>Shared<span className="brand-light">Board.app</span><span className="prototype">VERSION {APP_VERSION} · {browserOnly?'BROWSER BETA':'LOCAL BETA'}</span></span></div>
        <div className="intro compact-intro"><p className="eyebrow">A SPACE TO THINK TOGETHER</p><h1>Make the idea clearer.</h1></div>
        <div className="project-label"><span className="small-dot" /> YOUR WORKSPACE</div>
        <button className="project-card project-switcher" aria-label="Open projects and boards" disabled={!initial} onClick={()=>setWorkspaceOpen(true)}><Icon name="grid" size={25}/><span><small>{view.workspace?.projects.find(p=>p.id===view.workspace.currentProjectId)?.name||'Your project'}</small><strong>{view.planning?.project.title||'Our shared project'}</strong><small>{count} objects · Revision {view.board.revision}</small></span><Icon name="chevron" size={15}/></button>
        <nav className="workspace-nav" aria-label="Workspace navigation"><button onClick={()=>{setPlanner(null);setNavigatorOpen(v=>!v);}}><Icon name="rectangle" size={16}/><span>Objects & minimap</span></button><button onClick={()=>openPlanner('areas')}><Icon name="search" size={16}/><span>Areas & search</span><kbd>Ctrl K</kbd></button><button onClick={()=>openPlanner('notes')}><Icon name="chat" size={16}/><span>Notes & work cards</span><small>{view.planning?.project.notes.filter(n=>n.status==='open').length||''}</small></button><button onClick={()=>openPlanner('library')}><Icon name="grid" size={16}/><span>Reusable blocks</span></button><button onClick={()=>openPlanner('history')}><Icon name="history" size={16}/><span>Checkpoints & history</span></button><button onClick={()=>openPlanner('proposals')}><Icon name="review" size={16}/><span>AI changes</span>{!browserOnly&&view.planning?.proposals.some(p=>p.status==='pending')&&<i/>}</button></nav>
        {view.planning?.project.areas.length>0&&<section className="rail-areas"><p className="eyebrow">YOUR AREAS</p>{view.planning.project.areas.slice(0,6).map(area=><button key={area.id} onClick={()=>jumpTo(sync.current.getApi(),area)}><Icon name="fit" size={13}/>{area.name}</button>)}</section>}
        <section className="focus-card"><p className="eyebrow">SHARED FOCUS</p><div className="focus-count">{view.selectedIds.length ? `${view.selectedIds.length} selected` : 'The whole board'}</div><p>{browserOnly&&!view.agentConnected?'Select objects to preview a focused drawing context. Connect Codex when you want to discuss it.':view.selectedIds.length ? 'Ask AI to look will send this selection for review.' : 'Select objects to focus a review, or ask about the whole board.'}</p></section>
        <section className="activity"><div className="section-label">ON THE BOARD <span>{view.lastAgentAt ? 'Agent reached board' : browserOnly?'Your next idea starts here':'Ready for an agent'}</span></div>
          {view.board.activity.length ? view.board.activity.slice(0, 4).map((event) => <div className="activity-item" key={event.revision}><span className={`actor ${event.actor === 'agent' ? 'agent' : ''}`}>{event.actor === 'agent' ? 'AI' : 'Y'}</span><div><p>{event.summary}</p><small>Revision {event.revision} · {new Date(event.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</small></div></div>) : <p className="empty-activity">Your first mark starts the conversation.</p>}
        </section>
        <div className="rail-footer"><p>Drawing engine by the open-source Excalidraw editor.</p></div>
      </aside>
      <main className="main">
        <header className="topbar"><div className="breadcrumb">WORKSPACE <span>/</span> <strong>{view.planning?.project.title||'Our shared project'}</strong></div><div className="top-actions"><button className={`connection-chip ${view.connection?.connected?'connected':''}`} disabled={!initial} onClick={()=>setConnectionOpen(true)} title={browserOnly?'Set up or manage your Codex bridge':'Manage this board’s AI connection'}><span className="connection-dot"/><span>{view.connection?.connected?view.connection.label:browserOnly?'Connect Codex':'Connect an AI'}</span><small>{view.connection?.permission==='propose'?'Approval required':view.connection?.permission==='read'?'Read only':view.connection?.connected?'Read + edit':''}</small></button></div></header>
        {reviewVisible && <section className={`review-strip ${latestReview?.status ?? ''}`} aria-live="polite"><div className="review-strip-main"><span className="review-symbol" aria-hidden="true">{latestReview?.status === 'reviewed' ? '✓' : '↗'}</span><div><strong>{reviewError || reviewHeading}</strong>{latestReview && <p>{latestReview.scope === 'selection' ? `${latestReview.selectedIds.length} selected objects` : 'Whole board'} · Board version {latestReview.boardRevision}{latestReview.boardRevision < view.board.revision ? ' · More changes since this request' : ''}</p>}</div>{['failed','uncertain'].includes(latestReview?.delivery) && <button className="review-retry" onClick={() => retryReview(latestReview.id)} disabled={requestingReview}>{latestReview.delivery==='uncertain'?'I checked my chat · retry':'Retry delivery'}</button>}{latestReview?.delivery==='manual'&&latestReview.handoffPrompt&&<button className="review-retry" onClick={()=>copyText(latestReview.handoffPrompt).catch(e=>setReviewError(e.message))}>Copy review to {view.connection?.provider==='codex'?'Codex':'AI'}</button>}</div>{latestReview?.summary ? <details className="review-result"><summary>View review summary</summary><p>{latestReview.summary}</p></details> : <p className="review-hint">{latestReview?.delivery==='uncertain'?'Delivery could not be confirmed. Check your linked chat for this request before retrying; the saved request keeps its original ID and context.':latestReview?.delivery==='manual'?'Paste this saved request into your linked chat. The reply returns when your AI posts its review.':latestReview?.deliveryError || 'This request asks only for a review of the drawing. The response will appear in your linked chat.'}</p>}</section>}
        {(view.status === 'error' || view.status === 'conflict') && <div className="notice" role="alert"><p>{view.status === 'conflict' ? 'You and the agent edited the same object. Your drawing is preserved in this tab. Choose which edits to keep.' : view.error}</p><div>{view.status === 'conflict' ? <><button onClick={() => sync.current.resolveConflict(true)}>Keep my edits</button><button onClick={() => sync.current.resolveConflict(false)}>Use saved version</button><button onClick={exportBoard}>Export my drawing first</button></> : <button onClick={() => sync.current.retry()}>Retry save</button>}</div></div>}
        <div className="canvas-shell" onPointerDown={() => sync.current?.pointerDown()}>
          {bootError ? <div className="loading" role="alert">{browserOnly?'Could not open browser storage':'Could not open the board'}: {bootError}<button onClick={() => location.reload()}>Try again</button></div> : initial ? <Excalidraw
            excalidrawAPI={setDrawingApi}
            initialData={drawingInitialData}
            onChange={onDrawingChange}
            theme="light"
            UIOptions={drawingUi}
            renderTopRightUI={() => null}
            handleKeyboardGlobally={true}
          /> : <div className="loading"><span className="loading-mark">↗</span>{browserOnly?'Opening your saved browser canvas…':'Opening our canvas…'}</div>}
          {initial&&<DrawingToolbar browserOnly={browserOnly} onStorageDetails={()=>setStorageDetailsOpen(true)} getApi={()=>sync.current?.getApi()} ui={ui} focused={focused} onFullscreen={toggleFullscreen} onChat={()=>setChatVisibility(!chatOpen)} onConnect={()=>setConnectionOpen(true)} onReview={askForReview} reviewDisabled={requestingReview||samePendingReview||!view.agentConnected||view.status==='conflict'||!view.online} onExport={exportBoard} onImport={importBoard} onError={setReviewError} onPlanner={tab=>openPlanner(tab)} onReference={()=>setReferenceOpen(true)} onChangelog={()=>setChangelogOpen(true)} onExportProject={exportProject} onImportProject={()=>setProjectImportOpen(true)} onWorkspace={()=>setWorkspaceOpen(true)} onNavigator={()=>{setPlanner(null);setNavigatorOpen(v=>!v);}}/>}
          {initial&&<NotePins view={view} ui={ui} onOpen={noteId=>openPlanner('notes',{type:'note-open',noteId})}/>}
          {initial&&!planner&&!navigatorOpen&&<SelectionBar view={view} getApi={()=>sync.current.getApi()} onNote={()=>openPlanner('notes',{type:'note'})} onArea={()=>openPlanner('areas',{type:'area'})} onInspect={()=>setSelectionOpen(true)}/>}
          {initial&&navigatorOpen&&<ObjectNavigator view={view} ui={ui} getApi={()=>sync.current.getApi()} onClose={()=>setNavigatorOpen(false)}/>}
          {initial&&planner&&<PlanningPanel browserOnly={browserOnly} tab={planner} setTab={setPlanner} view={view} getSync={()=>sync.current} action={plannerAction} onClose={()=>{setPlanner(null);setPlannerAction(null);}} onReference={()=>setReferenceOpen(true)} onDiscuss={async text=>{if(browserOnly&&!view.chatConnected){setConnectionOpen(true);return;}setChatOpen(true);const id=crypto.randomUUID();const result=await sync.current.sendChat({id,text,intent:'discuss'});const message=result.messages.find(m=>m.id===id);if(message?.handoffPrompt)await copyText(message.handoffPrompt);}}/>}
          {initial&&<BoardChat onConnect={()=>setConnectionOpen(true)} browserOnly={browserOnly} open={chatOpen} setOpen={setChatVisibility} onExpand={expanded=>{if(expanded){setPlanner(null);setNavigatorOpen(false);}}} view={view} send={input=>sync.current.sendChat(input)} retry={id=>sync.current.retryChat(id)} focused={focused} prepareContext={options=>sync.current.prepareContext(options)} legacyDraftBoardId={view.workspace?.legacyBoardId} onJump={ids=>{const api=sync.current.getApi();const elements=api.getSceneElements().filter(e=>ids.includes(e.id));if(elements.length)api.scrollToContent(elements,{fitToViewport:true,viewportZoomFactor:.7,maxZoom:1});}}/>}
          {initial&&count===0&&!planner&&!navigatorOpen&&!chatOpen&&<div className="canvas-welcome"><span className="welcome-symbol">↗</span><p className="eyebrow">EVERY GOOD BUILD STARTS SOMEWHERE</p><h2>What are we thinking through?</h2><p>Start with a screen, a system, or a screenshot.<br/>{browserOnly?'Sketch first. Your work stays in this browser.':'Your AI and your ideas share the same space.'}</p><div onPointerDown={e=>e.stopPropagation()}><button className="primary-button" onClick={()=>openPlanner('library')}>Choose a starting block</button><button className="secondary-button" onClick={()=>setReferenceOpen(true)}>Add a screenshot</button></div><small>Or pick a tool above and make your first mark.</small></div>}
        </div>
        <footer className="canvas-footer"><span><span className="footer-dot" />{statusText}</span><a className="footer-creator" href={CREATOR_URL} target="_blank" rel="author noopener noreferrer">Created by {CREATOR_NAME}</a><button className="footer-changelog" onClick={()=>setChangelogOpen(true)}>v{APP_VERSION} · What’s new</button></footer>
      </main>
      {changelogOpen&&<Changelog onClose={()=>setChangelogOpen(false)}/>}
      {referenceOpen&&<ReferenceImport getApi={()=>sync.current.getApi()} onClose={()=>setReferenceOpen(false)}/>}
      {selectionOpen&&<SelectionDetails getApi={()=>sync.current.getApi()} onClose={()=>setSelectionOpen(false)}/>}
      {projectImportOpen&&<ProjectTransfer getSync={()=>sync.current} onClose={()=>setProjectImportOpen(false)}/>}
      {workspaceOpen&&view.workspace&&<WorkspacePicker browserOnly={browserOnly} workspace={view.workspace} onClose={()=>setWorkspaceOpen(false)} run={input=>sync.current.workspaceAction(input)} openBoard={id=>sync.current.openBoard(id)}/>}
      {storageDetailsOpen&&<BrowserStorageDetails onClose={()=>setStorageDetailsOpen(false)} onExport={exportProject}/>}
      {connectionOpen&&<ConnectionSetup detectBridge={()=>sync.current.detectBridge()} browserOnly={browserOnly} connection={view.connection} online={view.online} begin={input=>sync.current.beginPairing(input)} cancel={()=>sync.current.cancelPairing()} disconnect={()=>sync.current.disconnect()} onClose={()=>setConnectionOpen(false)} onTest={testConnection}/>}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);


