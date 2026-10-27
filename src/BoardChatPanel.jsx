import React,{useEffect,useRef,useState} from 'react';
import {Icon} from './Icons.jsx';
import {copyText} from './ConnectionSetup.jsx';
import {Modal} from './Modal.jsx';
import {MarkdownReply} from './MarkdownReply.jsx';
import {chatStorageKey,isPreparedContextStale,hasSelectionContextChanged,serializePendingChat,isAcceptedChatMessage,shouldResetChatCapture} from './chat-format.mjs';
import {miniChatState} from '../shared/client-profiles.mjs';
import './chat-upgrade.css';

const readStorage=key=>{try{return sessionStorage.getItem(key);}catch{return null;}};
const writeStorage=(key,value)=>{try{if(value===null)sessionStorage.removeItem(key);else sessionStorage.setItem(key,value);return true;}catch{return false;}};
function readJson(key){try{return JSON.parse(readStorage(key));}catch{return null;}}
function validPending(value,boardId){return value&&typeof value.id==='string'&&typeof value.text==='string'&&['discuss','work'].includes(value.intent)&&(!value.boardId||value.boardId===boardId)?value:null;}

const panelRequest=message=>message?.deliveryMode==='panel'||typeof message?.receipt==='string'&&message.receipt.startsWith('panel_');
const liveReceipt=message=>typeof message?.receipt==='string'&&/^live_[a-f0-9]{64}$/i.test(message.receipt);
const canRetryRequest=(message,connection)=>!panelRequest(message)&&message?.delivery!=='manual'&&(!(connection?.deliveryMode==='live-session'||message?.liveSessionId||liveReceipt(message))||Boolean(message.liveSessionId&&message.liveSessionId===connection?.liveSession?.id));
const acceptedDirectMessage=message=>typeof message?.reply==='string'&&Boolean(message.reply.trim())||message?.delivery!=='manual'&&!panelRequest(message)&&isAcceptedChatMessage(message);
function deliveryLabel(message,automatic){
  if(message.status==='reading')return 'The agent is reading your message…';
  if(message.delivery==='app')return 'This request belongs to an earlier connection. Its saved context is preserved.';
  if(message.delivery==='uncertain')return 'Delivery unconfirmed. Check your linked chat before retrying.';
  if(message.delivery==='queued')return liveReceipt(message)?'Accepted by the live AI session · waiting for a confirmed read and reply':!automatic||panelRequest(message)?'Automatic submission is unverified. Check its AI conversation before retrying.':'Queued for your AI · waiting for a confirmed read and reply';
  return message.delivery==='pending'?'Sending to your AI…':message.deliveryError||'Delivery needs attention';
}

export function BoardChat(props){
  const boardId=props.view.board.id??props.view.board.boardId??'legacy';
  return <BoardChatSession key={boardId} {...props} boardId={boardId}/>;
}
function BoardChatSession({open,setOpen,view,send,retry,focused,onJump,prepareContext,legacyDraftBoardId,boardId,onExpand,onConnect,onStopLive}){
  const scoped=kind=>chatStorageKey(boardId,kind);
  const initialValue=kind=>readStorage(scoped(kind))??(boardId===legacyDraftBoardId?readStorage(`sharedboard-chat-${kind}`):null);
  const [draft,setDraft]=useState(()=>initialValue('draft')||'');
  const [intent,setIntent]=useState(()=>readStorage(scoped('intent'))==='work'?'work':'discuss');
  const [sending,setSending]=useState(false),[preparing,setPreparing]=useState(false),[error,setError]=useState(null);
  const [clock,setClock]=useState(Date.now()),[stopping,setStopping]=useState(false);
  const [pending,setPending]=useState(()=>{try{return validPending(JSON.parse(initialValue('pending')),boardId);}catch{return null;}});
  const [scopeChoice,setScopeChoice]=useState(view.selectedIds?.length?'selection':'board');
  const [prepared,setPrepared]=useState(null),[previewOpen,setPreviewOpen]=useState(false),[storageWarning,setStorageWarning]=useState(false);
  const storedSize=readJson(scoped('size'));
  const [size,setSize]=useState(()=>storedSize&&Number.isFinite(storedSize.width)&&Number.isFinite(storedSize.height)?{width:Math.max(320,Math.min(800,storedSize.width)),height:Math.max(280,Math.min(900,storedSize.height))}:null);
  const [expanded,setExpanded]=useState(()=>Boolean(storedSize?.expanded)),[short,setShort]=useState(false);
  const bottom=useRef(null),composer=useRef(null),panel=useRef(null),lastSeen=useRef(initialValue('seen')||''),active=useRef(true);
  const messages=view.messages||[],lastReply=messages.filter(m=>m.reply).at(-1)?.repliedAt||'';
  const currentConnection=useRef(null);currentConnection.current=view.chatConnected?view.connection:null;
  const miniChat=miniChatState(currentConnection.current,clock),composerAvailable=miniChat.enabled||miniChat.sessionActive;
  const unread=!open&&lastReply&&lastReply!==lastSeen.current;
  const areas=view.planning?.project.areas??[],matchingPending=Boolean(pending&&pending.text===draft.trim()&&pending.intent===intent);
  const attachment=matchingPending&&pending.capturedContext?pending.capturedContext:prepared;
  const stale=isPreparedContextStale(attachment,view.board,view.planning)||hasSelectionContextChanged(attachment,view.selectedIds);
  const missingRetryAttachment=Boolean(prepareContext&&matchingPending&&pending.attachmentNotStored&&!pending.capturedContext);
  const scopeMissing=scopeChoice==='selection'&&!view.selectedIds?.length||scopeChoice.startsWith('area:')&&!areas.some(a=>`area:${a.id}`===scopeChoice);
  const needsPreview=Boolean(prepareContext)&&!matchingPending&&(!attachment||stale);

  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  useEffect(()=>{const connection=currentConnection.current,parse=value=>typeof value==='number'?value:Date.parse(value),deadlines=[connection?.messageExpiresAt??connection?.eventExpiresAt,connection?.liveSession?.expiresAt,connection?.liveSession?.waitExpiresAt].map(parse).filter(Number.isFinite);let timer;const tick=()=>{const now=Date.now();setClock(now);const future=deadlines.filter(value=>value>now);if(future.length)timer=setTimeout(tick,Math.min(2147483647,Math.min(...future)-now+1));};tick();return()=>clearTimeout(timer);},[view.connection?.id,view.connection?.deliveryMode,view.connection?.automaticMessages,view.connection?.messageExpiresAt,view.connection?.eventExpiresAt,view.connection?.liveSession?.id,view.connection?.liveSession?.status,view.connection?.liveSession?.expiresAt,view.connection?.liveSession?.waitExpiresAt]);
  useEffect(()=>{
    if(boardId!==legacyDraftBoardId||readStorage(scoped('legacy-migrated')))return;
    const oldDraft=readStorage('sharedboard-chat-draft'),oldPending=readJson('sharedboard-chat-pending');
    if(!draft&&oldDraft)setDraft(oldDraft);
    if(!pending&&validPending(oldPending,boardId))setPending({...oldPending,boardId});
    writeStorage(scoped('legacy-migrated'),'1');
    for(const kind of ['draft','pending','seen'])writeStorage(`sharedboard-chat-${kind}`,null);
  },[legacyDraftBoardId]);
  useEffect(()=>{writeStorage(scoped('draft'),draft);},[draft]);
  useEffect(()=>{writeStorage(scoped('intent'),intent);},[intent]);
  useEffect(()=>{
    if(!pending){writeStorage(scoped('pending'),null);return;}
    const value=serializePendingChat(pending);
    if(!writeStorage(scoped('pending'),value)){writeStorage(scoped('pending'),JSON.stringify({id:pending.id,text:pending.text,intent:pending.intent,boardId,attachmentNotStored:true}));setStorageWarning(true);}
    else setStorageWarning(Boolean(JSON.parse(value).attachmentNotStored));
  },[pending]);
  useEffect(()=>{
    if(pending&&messages.some(m=>m.id===pending.id&&acceptedDirectMessage(m))){setDraft(current=>current.trim()===pending.text?'':current);setPending(current=>current?.id===pending.id?null:current);}
    if(open){lastSeen.current=lastReply;writeStorage(scoped('seen'),lastReply);bottom.current?.scrollIntoView({block:'nearest'});}
  },[open,messages,lastReply]);
  useEffect(()=>{if(open)composer.current?.focus();},[open]);
  useEffect(()=>{if(!miniChat.enabled)setPreviewOpen(false);},[miniChat.enabled]);
  useEffect(()=>{if(open)onExpand?.(expanded);},[open,expanded]);
  useEffect(()=>{
    if(!open||!panel.current||typeof ResizeObserver==='undefined')return;
    let timer;const observer=new ResizeObserver(()=>{const box=panel.current?.getBoundingClientRect();if(!box)return;setShort(box.height<480);clearTimeout(timer);timer=setTimeout(()=>writeStorage(scoped('size'),JSON.stringify({width:Math.round(box.width),height:Math.round(box.height),expanded})),150);});
    observer.observe(panel.current);return()=>{clearTimeout(timer);observer.disconnect();};
  },[open,expanded]);
  const scopeLabel=context=>context?.scopeLabel??(context?.scope==='area'?'Named area':context?.selectedIds?.length?'Selected objects':'Whole board');
  const prepare=async()=>{
    if(!miniChatState(currentConnection.current).enabled||!prepareContext||preparing)return;
    setPreparing(true);setError(null);
    try{
      const choice=scopeChoice.startsWith('area:')?{scope:'area',areaId:scopeChoice.slice(5)}:{scope:scopeChoice};
      const context=await prepareContext(choice);
      if(!active.current)return;
      const latestChat=miniChatState(currentConnection.current);if(!latestChat.enabled){setPreviewOpen(false);setError(latestChat.reason);return;}
      if(context.boardId&&context.boardId!==boardId)throw new Error('The board changed while preparing this attachment. Open the correct board and try again.');
      if(context.visual&&!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(context.visual))throw new Error('The drawing preview could not be read. Please prepare it again.');
      setPrepared({...context,scope:choice.scope,scopeLabel:choice.scope==='area'?areas.find(a=>a.id===choice.areaId)?.name:choice.scope==='selection'?'Selected objects':'Whole board'});setPreviewOpen(true);
    }catch(err){if(active.current)setError(err.message||'Could not prepare the attachment. Your message is still here.');}
    finally{if(active.current)setPreparing(false);}
  };
  const submit=async event=>{
    event.preventDefault();const latestChat=miniChatState(currentConnection.current);if(!latestChat.enabled){setError(latestChat.reason);return;}if(!draft.trim()||sending||needsPreview||missingRetryAttachment)return;
    setSending(true);setError(null);
    const input=matchingPending?pending:{id:crypto.randomUUID(),text:draft.trim(),intent,boardId,...(prepared?{capturedContext:prepared}:{})};
    setPending(input);
    try{
      const existing=matchingPending?messages.find(message=>message.id===input.id):null;
      if(existing&&panelRequest(existing))throw Object.assign(new Error('Automatic submission through that panel was not verified. Check the original AI conversation; this saved request will not be replayed.'),{code:'PANEL_DIRECT_DELIVERY_UNAVAILABLE',deliveryUnknown:true});
      if(existing&&!canRetryRequest(existing,currentConnection.current))throw Object.assign(new Error('This saved request belongs to its original AI session. Check that conversation; it will not be sent into a new live session.'),{code:'LIVE_REQUEST_SESSION_CHANGED',deliveryUnknown:true});
      if(existing?.delivery==='uncertain')throw new Error('Delivery is unconfirmed. Check your linked chat, then use I checked my chat · retry on this saved request.');
      const result=existing?await retry(input.id):await send(input);
      if(existing&&!result)return;
      const message=result?.messages?.find(m=>m.id===input.id);
      if(!acceptedDirectMessage(message))throw new Error(message?.deliveryError||'Automatic submission could not be confirmed. Your text and original request are kept. Check the AI conversation before retrying.');
      if(active.current){setDraft(current=>current.trim()===input.text?'':current);setPending(current=>current?.id===input.id?null:current);}
    }catch(err){
      if(!active.current)return;
      if(shouldResetChatCapture(err)){setPending(null);setPrepared(null);}
      setError(err.message||'Could not confirm sending. Retry keeps the same request and its original attachment.');
    }finally{if(active.current)setSending(false);}
  };
  const pause=async()=>{if(stopping||!onStopLive)return;setStopping(true);setError(null);try{await onStopLive();}catch(cause){if(active.current)setError(cause.message||'Could not pause live collaboration.');}finally{if(active.current)setStopping(false);}};
  const toggleSize=()=>{const next=!expanded;setExpanded(next);setSize(next?{width:620,height:740}:{width:390,height:580});};
  if(!open)return focused?null:<button className={`chat-bubble ${composerAvailable&&unread?'unread':''}`} disabled={!composerAvailable} aria-label={composerAvailable?(unread?'Open board chat, new reply':'Open board chat'):'Talk it through unavailable'} title={composerAvailable?'Open board chat':miniChat.reason} onClick={()=>{if(composerAvailable)setOpen(true);}}><Icon name="chat" size={22}/><span>Talk it through</span>{composerAvailable&&unread&&<i/>}</button>;
  return <section ref={panel} className={`board-chat chat-upgraded ${expanded?'is-expanded':''} ${short?'is-short':''}`} style={expanded?{width:size?.width??620,height:'calc(100% - 24px)'}:size??undefined} aria-label="Board chat" onPointerDown={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}>
    <header className="chat-header"><span className="chat-avatar"><Icon name="chat"/></span><div><h2>{composerAvailable?'Let’s think together':'Saved board requests'}</h2><p><span className={`connection-dot ${miniChat.enabled?'connected':''}`}/>{view.chatConnected?(view.connectionLabel||'Your connected AI'):'Chat not connected'}</p></div><div className="chat-window-actions"><button type="button" aria-label="Change chat size" aria-pressed={expanded} title={expanded?'Return to compact chat':'Expand chat to use the canvas height'} onClick={toggleSize}><Icon name={expanded?'collapse':'expand'} size={16}/></button><button type="button" aria-label="Minimize board chat" onClick={()=>setOpen(false)}><Icon name="minus"/></button></div></header>
    <div className="chat-timeline" aria-live="polite" aria-relevant="additions text">
      {!messages.length&&<div className="chat-welcome"><span>↗</span><h3>{composerAvailable?'A little room for big ideas.':'No saved requests yet.'}</h3><p>{miniChat.enabled?miniChat.mode==='live-session'?'Your active AI run is waiting. Send a question or a requested change; its actual answer returns here.':'Talk about your drawing, ask a question, or request the next change. Actual answers return here.':miniChat.reason}</p><small>Only messages sent from this board and the agent’s replies appear here.</small></div>}
      {messages.map(message=><div className="chat-exchange" key={message.id}><div className="chat-message user"><small>You · {message.intent==='work'?'Request work':'Discuss'} · revision {message.boardRevision}</small><p>{message.text}</p>{message.selectedIds?.length>0&&<button type="button" className="chat-context-link" onClick={()=>onJump?.(message.selectedIds)}>Jump to the attached selection · revision {message.boardRevision}</button>}{message.hasVisual&&<small>Captured drawing image{message.noteCount?` · ${message.noteCount} notes / requirements`:''}</small>}</div>{message.delivery==='manual'&&<p className="message-state">Saved without automatic delivery. This request will not replay when a connection becomes available.</p>}{message.reply?<div className="chat-message assistant"><div className="reply-meta"><small>AI</small><button type="button" onClick={()=>copyText(message.reply).catch(err=>setError(err.message))}>Copy reply</button></div><MarkdownReply text={message.reply}/></div>:message.delivery!=='manual'&&<div className="message-state"><span>{deliveryLabel(message,miniChat.automatic)}</span>{miniChat.enabled&&view.online&&canRetryRequest(message,view.connection)&&['failed','uncertain'].includes(message.delivery)&&<button type="button" onClick={async()=>{setError(null);try{const latestChat=miniChatState(currentConnection.current);if(!latestChat.enabled)throw new Error(latestChat.reason);if(!canRetryRequest(message,currentConnection.current))throw new Error('This request belongs to its original AI session and will not be replayed.');await retry(message.id);}catch(err){setError(err.message);}}}>{message.delivery==='uncertain'?'I checked my chat · retry':'Retry delivery'}</button>}</div>}</div>)}
      <div ref={bottom}/>
    </div>
    {composerAvailable?<form className="chat-composer" onSubmit={submit}>
      <div className="chat-compose-fields">
      {miniChat.mode==='live-session'&&<p className="chat-storage-hint" role="status">{miniChat.reason} {miniChat.sessionActive&&onStopLive&&<button type="button" className="chat-context-link" disabled={stopping} onClick={pause}>{stopping?'Pausing…':'Pause live collaboration'}</button>}</p>}
      <div className="chat-intent"><label>Message intent<select aria-label="Message intent" value={intent} onChange={e=>setIntent(e.target.value)}><option value="discuss">Discuss · review only</option><option value="work">Request work · allow changes</option></select></label><span>{view.connection?.permission==='propose'?'Drawing proposals need approval':view.selectedIds?.length?`${view.selectedIds.length} selected`:'Whole board'}</span></div>
      {view.connection?.permission==='read'&&<p className="chat-storage-hint">Read-only drawing access: discussion and replies work. Drawing edits require reconnecting with read-and-edit access.{onConnect&&<button type="button" className="chat-context-link" onClick={onConnect}>Change drawing access</button>}</p>}
      {prepareContext?<div className={`chat-context-picker ${stale?'is-stale':''}`}>
        <div className="chat-context-controls"><label>Attach drawing<select aria-label="Drawing context" value={scopeChoice} disabled={preparing||sending||matchingPending} onChange={e=>{setScopeChoice(e.target.value);setPrepared(null);}}><option value="board">Whole board</option><option value="selection" disabled={!view.selectedIds?.length}>Current selection{view.selectedIds?.length?` (${view.selectedIds.length})`:''}</option>{areas.map(area=><option key={area.id} value={`area:${area.id}`}>{area.name}</option>)}</select></label><button type="button" onClick={prepare} disabled={!miniChat.enabled||preparing||sending||scopeMissing||!view.online||matchingPending}>{preparing?'Preparing…':prepared?'Refresh preview':'Preview attachment'}</button></div>
        {attachment?<button type="button" className="chat-attachment-summary" onClick={()=>setPreviewOpen(true)} aria-label="View attached drawing and requirements">{attachment.visual?<img src={attachment.visual} alt="Attached drawing thumbnail"/>:<span className="attachment-empty"><Icon name="rectangle" size={19}/></span>}<span><strong>{scopeLabel(attachment)} · revision {attachment.expectedRevision}</strong><small>{attachment.scope==='area'?'Saved named area':attachment.selectedIds?.length?`${attachment.selectedIds.length} selected objects`:'Entire saved drawing'} · {attachment.notes?.length||0} notes / requirements</small></span><Icon name="chevron" size={14}/></button>:<p>Preview the drawing and requirements that will travel with your message.</p>}
        {stale&&<p className="context-stale" role="status">The drawing, selection or planning details changed after this preview. {matchingPending?'Retry checks the same saved request and keeps its original attachment.':'Refresh it before sending.'}</p>}
        {matchingPending&&<p className="context-pending">A send is unconfirmed. Retry preserves its request ID and original context.</p>}
      </div>:<div className="chat-context-summary">{view.selectedIds?.length?'Selected objects':'Whole board'}{view.board.elements.some(element=>!element.isDeleted)?' + drawing image':''} + attached notes. A saved revision travels with each message.</div>}
      <textarea ref={composer} aria-label="Message the connected model" placeholder={intent==='work'?'Describe the work you want me to do…':'What should we think through?'} value={draft} maxLength={8000} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();e.currentTarget.form.requestSubmit();}}}/>
      {storageWarning&&<p className="chat-storage-hint">This attachment is too large to keep after closing the tab. Your request ID and text are kept; check delivery before starting a new message.</p>}
      {missingRetryAttachment&&<div className="chat-storage-hint" role="status">The original attachment was not retained after reopening. Check your AI chat for this request before starting another one.<button type="button" className="chat-context-link" onClick={()=>{setPending(null);setPrepared(null);setStorageWarning(false);}}>Start a new request with this text</button></div>}
      {error&&<p className="chat-error" role="alert">{error}</p>}
      </div>
      <div className="chat-send"><small>{!miniChat.enabled?miniChat.phase==='processing'?'The AI is not waiting; your draft is kept.':'Wait for your AI to call the board wait tool.':needsPreview?'Preview the attachment before sending.':intent==='work'?'Allows only the work you ask for.':'Discussion does not approve changes.'}</small><button type="submit" disabled={!miniChat.enabled||!draft.trim()||sending||preparing||needsPreview||missingRetryAttachment||!view.chatConnected||!view.online||view.status==='conflict'}><Icon name="send" size={16}/>{sending?'Sending…':matchingPending?'Retry saved send':miniChat.phase==='processing'?'Waiting for AI…':'Send'}</button></div>
    </form>:<div className="chat-unavailable" role="status"><strong>Automatic mini chat unavailable</strong><p>{miniChat.reason} Saved requests and replies remain available here.</p>{error&&<p className="chat-error" role="alert">{error}</p>}{onConnect&&<button type="button" className="secondary-button" onClick={onConnect}>Connection details</button>}</div>}
    {previewOpen&&attachment&&<Modal title="Your AI’s drawing context" subtitle={`${scopeLabel(attachment)} · saved revision ${attachment.expectedRevision}`} onClose={()=>setPreviewOpen(false)} wide><div className="context-preview-drawing">{attachment.visual?<img src={attachment.visual} alt="Exact drawing image prepared for this message"/>:<p>The captured drawing is empty.</p>}</div>{stale&&<p className="planner-error" role="status">The board or planning details changed after this capture. Close this preview and refresh it before a new send.</p>}<div className="context-preview-notes"><h3>Included notes & requirements <span>{attachment.notes?.length||0}</span></h3>{attachment.notes?.length?attachment.notes.map((note,index)=><article key={note.id??index}><small>{note.kind==='task'?'Work card':note.kind==='requirement'?'Requirement':'Note'}{note.status==='done'?' · resolved':''}</small><strong>{note.title}</strong>{note.text&&<p>{note.text}</p>}</article>):<p>No notes are attached to this scope.</p>}</div><p className="muted">This saved drawing image, its editable object data and the listed planning context travel with your message. Later drawing changes do not replace this snapshot.</p><div className="modal-actions"><button type="button" className="primary-button" onClick={()=>setPreviewOpen(false)}>Use this attachment</button></div></Modal>}
  </section>;
}
