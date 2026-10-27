import React,{useEffect,useRef,useState} from 'react';
import {Icon} from './Icons.jsx';
import {copyText} from './ConnectionSetup.jsx';
import {Modal} from './Modal.jsx';
import {MarkdownReply} from './MarkdownReply.jsx';
import {chatStorageKey,isPreparedContextStale,hasSelectionContextChanged,serializePendingChat,isAcceptedChatMessage} from './chat-format.mjs';
import {miniChatState} from '../shared/client-profiles.mjs';
import './chat-upgrade.css';

const readStorage=key=>{try{return sessionStorage.getItem(key);}catch{return null;}};
const writeStorage=(key,value)=>{try{if(value===null)sessionStorage.removeItem(key);else sessionStorage.setItem(key,value);return true;}catch{return false;}};
function readJson(key){try{return JSON.parse(readStorage(key));}catch{return null;}}
function validPending(value,boardId){return value&&typeof value.id==='string'&&typeof value.text==='string'&&['discuss','work'].includes(value.intent)&&(!value.boardId||value.boardId===boardId)?value:null;}

function HandoffInstructions({message,provider}){
  const [copied,setCopied]=useState(false),[expanded,setExpanded]=useState(false),[failed,setFailed]=useState(false);
  const copy=async()=>{
    try{await copyText(message.handoffPrompt);setCopied(true);setFailed(false);}
    catch{setCopied(false);setFailed(true);setExpanded(true);}
  };
  return <div className="chat-handoff"><button type="button" onClick={()=>void copy()}>{copied?'Copied · paste into your AI chat':provider==='codex'?'Copy to Codex':'Copy to AI'}</button>
    <details open={expanded} onToggle={event=>setExpanded(event.currentTarget.open)}><summary>View request instructions</summary><p>{failed?'Clipboard unavailable. Select and copy the complete instructions below.':'Paste these complete instructions into your connected AI chat to keep this request attached to its saved drawing.'}</p><textarea aria-label={`AI request instructions for message ${message.id}`} readOnly rows={6} value={message.handoffPrompt} onFocus={event=>event.currentTarget.select()}/></details>
  </div>;
}

export function BoardChat(props){
  const boardId=props.view.board.id??props.view.board.boardId??'legacy';
  return <BoardChatSession key={boardId} {...props} boardId={boardId}/>;
}
function BoardChatSession({open,setOpen,view,send,retry,focused,onJump,prepareContext,legacyDraftBoardId,boardId,onExpand,onConnect}){
  const scoped=kind=>chatStorageKey(boardId,kind);
  const initialValue=kind=>readStorage(scoped(kind))??(boardId===legacyDraftBoardId?readStorage(`sharedboard-chat-${kind}`):null);
  const [draft,setDraft]=useState(()=>initialValue('draft')||'');
  const [intent,setIntent]=useState(()=>readStorage(scoped('intent'))==='work'?'work':'discuss');
  const [sending,setSending]=useState(false),[preparing,setPreparing]=useState(false),[error,setError]=useState(null);
  const [pending,setPending]=useState(()=>{try{return validPending(JSON.parse(initialValue('pending')),boardId);}catch{return null;}});
  const [scopeChoice,setScopeChoice]=useState(view.selectedIds?.length?'selection':'board');
  const [prepared,setPrepared]=useState(null),[previewOpen,setPreviewOpen]=useState(false),[storageWarning,setStorageWarning]=useState(false);
  const storedSize=readJson(scoped('size'));
  const [size,setSize]=useState(()=>storedSize&&Number.isFinite(storedSize.width)&&Number.isFinite(storedSize.height)?{width:Math.max(320,Math.min(800,storedSize.width)),height:Math.max(280,Math.min(900,storedSize.height))}:null);
  const [expanded,setExpanded]=useState(()=>Boolean(storedSize?.expanded)),[short,setShort]=useState(false);
  const bottom=useRef(null),composer=useRef(null),panel=useRef(null),lastSeen=useRef(initialValue('seen')||''),active=useRef(true);
  const messages=view.messages||[],lastReply=messages.filter(m=>m.reply).at(-1)?.repliedAt||'';
  const currentConnection=useRef(null);currentConnection.current=view.chatConnected?view.connection:null;
  const miniChat=miniChatState(currentConnection.current);
  const manualHosted=view.storageMode==='browser'&&view.chatConnected&&!miniChat.enabled;
  const unread=!open&&lastReply&&lastReply!==lastSeen.current;
  const areas=view.planning?.project.areas??[],matchingPending=Boolean(pending&&pending.text===draft.trim()&&pending.intent===intent);
  const attachment=matchingPending&&pending.capturedContext?pending.capturedContext:prepared;
  const stale=isPreparedContextStale(attachment,view.board,view.planning)||hasSelectionContextChanged(attachment,view.selectedIds);
  const missingRetryAttachment=Boolean(prepareContext&&matchingPending&&pending.attachmentNotStored&&!pending.capturedContext);
  const scopeMissing=scopeChoice==='selection'&&!view.selectedIds?.length||scopeChoice.startsWith('area:')&&!areas.some(a=>`area:${a.id}`===scopeChoice);
  const needsPreview=Boolean(prepareContext)&&!matchingPending&&(!attachment||stale);

  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
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
    if(pending&&messages.some(m=>m.id===pending.id&&isAcceptedChatMessage(m))){if(draft.trim()===pending.text)setDraft('');setPending(null);}
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
      if(manualHosted&&matchingPending&&messages.some(message=>message.id===input.id)){await retry(input.id);return;}
      const result=await send(input),message=result.messages.find(m=>m.id===input.id);
      if(!isAcceptedChatMessage(message))throw new Error(message?.deliveryError||'The request is saved, but delivery or its copy instructions could not be confirmed. Retry keeps this same request.');
      if(message?.handoffPrompt)await copyText(message.handoffPrompt);
      if(active.current){setDraft('');setPending(null);}
    }catch(err){
      if(!active.current)return;
      if([400,409,413].includes(err.status)){setPending(null);setPrepared(null);}
      setError(err.message||'Could not confirm sending. Retry keeps the same request and its original attachment.');
    }finally{if(active.current)setSending(false);}
  };
  const toggleSize=()=>{const next=!expanded;setExpanded(next);setSize(next?{width:620,height:740}:{width:390,height:580});};
  if(!open)return focused?null:<button className={`chat-bubble ${miniChat.enabled&&unread?'unread':''}`} disabled={!miniChat.enabled} aria-label={miniChat.enabled?(unread?'Open board chat, new reply':'Open board chat'):'Talk it through unavailable'} title={miniChat.enabled?'Open board chat':miniChat.reason} onClick={()=>{if(miniChat.enabled)setOpen(true);}}><Icon name="chat" size={22}/><span>Talk it through</span>{miniChat.enabled&&unread&&<i/>}</button>;
  return <section ref={panel} className={`board-chat chat-upgraded ${expanded?'is-expanded':''} ${short?'is-short':''}`} style={expanded?{width:size?.width??620,height:'calc(100% - 24px)'}:size??undefined} aria-label="Board chat" onPointerDown={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}>
    <header className="chat-header"><span className="chat-avatar"><Icon name="chat"/></span><div><h2>{miniChat.enabled?'Let’s think together':'Saved board requests'}</h2><p><span className={`connection-dot ${miniChat.enabled?'connected':''}`}/>{view.chatConnected?(view.connectionLabel||'Your connected AI'):'Chat not connected'}</p></div><div className="chat-window-actions"><button type="button" aria-label="Change chat size" aria-pressed={expanded} title={expanded?'Return to compact chat':'Expand chat to use the canvas height'} onClick={toggleSize}><Icon name={expanded?'collapse':'expand'} size={16}/></button><button type="button" aria-label="Minimize board chat" onClick={()=>setOpen(false)}><Icon name="minus"/></button></div></header>
    <div className="chat-timeline" aria-live="polite" aria-relevant="additions text">
      {!messages.length&&<div className="chat-welcome"><span>↗</span><h3>{miniChat.enabled?'A little room for big ideas.':'No saved requests yet.'}</h3><p>{miniChat.enabled?'Talk about your drawing, ask a question, or request the next change. Messages are delivered to the conversation that subscribed to this board.':'Your AI chat can use board tools. Prepared requests and actual replies appear here; mini-chat sending requires verified incoming messages.'}</p><small>Only messages sent from this board and the agent’s replies appear here.</small></div>}
      {messages.map(message=><div className="chat-exchange" key={message.id}><div className="chat-message user"><small>You · {message.intent==='work'?'Request work':'Discuss'} · revision {message.boardRevision}</small><p>{message.text}</p>{message.selectedIds?.length>0&&<button type="button" className="chat-context-link" onClick={()=>onJump?.(message.selectedIds)}>Jump to the attached selection · revision {message.boardRevision}</button>}{message.hasVisual&&<small>Captured drawing image{message.noteCount?` · ${message.noteCount} notes / requirements`:''}</small>}</div>{message.reply?<div className="chat-message assistant"><div className="reply-meta"><small>AI</small><button type="button" onClick={()=>copyText(message.reply).catch(err=>setError(err.message))}>Copy reply</button></div><MarkdownReply text={message.reply}/></div>:<div className="message-state"><span>{message.status==='reading'?'The agent is reading your message…':message.delivery==='app'?'This request belongs to an earlier connection. Its saved context is preserved.':message.delivery==='manual'?'Paste this request into your connected AI chat. The reply will return here.':message.delivery==='uncertain'?'Delivery unconfirmed. Check your linked chat before retrying.':message.delivery==='queued'?'Queued in your chat · replies when ready':message.delivery==='pending'?'Sending to your AI…':message.deliveryError||'Delivery needs attention'}</span>{message.handoffPrompt&&<HandoffInstructions message={message} provider={view.connection?.provider}/>}{view.chatConnected&&['failed','uncertain'].includes(message.delivery)&&<button type="button" onClick={async()=>{setError(null);try{await retry(message.id);}catch(err){setError(err.message);}}}>{message.delivery==='uncertain'?'I checked my chat · retry':manualHosted?'Retry preparation':'Retry delivery'}</button>}</div>}</div>)}
      <div ref={bottom}/>
    </div>
    {miniChat.enabled?<form className="chat-composer" onSubmit={submit}>
      <div className="chat-compose-fields">
      <div className="chat-intent"><label>Message intent<select aria-label="Message intent" value={intent} onChange={e=>setIntent(e.target.value)}><option value="discuss">Discuss · review only</option><option value="work">Request work · allow changes</option></select></label><span>{view.connection?.permission==='propose'?'Drawing proposals need approval':view.selectedIds?.length?`${view.selectedIds.length} selected`:'Whole board'}</span></div>
      {prepareContext?<div className={`chat-context-picker ${stale?'is-stale':''}`}>
        <div className="chat-context-controls"><label>Attach drawing<select aria-label="Drawing context" value={scopeChoice} disabled={preparing||sending||matchingPending} onChange={e=>{setScopeChoice(e.target.value);setPrepared(null);}}><option value="board">Whole board</option><option value="selection" disabled={!view.selectedIds?.length}>Current selection{view.selectedIds?.length?` (${view.selectedIds.length})`:''}</option>{areas.map(area=><option key={area.id} value={`area:${area.id}`}>{area.name}</option>)}</select></label><button type="button" onClick={prepare} disabled={preparing||sending||scopeMissing||!view.online||matchingPending}>{preparing?'Preparing…':prepared?'Refresh preview':'Preview attachment'}</button></div>
        {attachment?<button type="button" className="chat-attachment-summary" onClick={()=>setPreviewOpen(true)} aria-label="View attached drawing and requirements">{attachment.visual?<img src={attachment.visual} alt="Attached drawing thumbnail"/>:<span className="attachment-empty"><Icon name="rectangle" size={19}/></span>}<span><strong>{scopeLabel(attachment)} · revision {attachment.expectedRevision}</strong><small>{attachment.scope==='area'?'Saved named area':attachment.selectedIds?.length?`${attachment.selectedIds.length} selected objects`:'Entire saved drawing'} · {attachment.notes?.length||0} notes / requirements</small></span><Icon name="chevron" size={14}/></button>:<p>Preview the drawing and requirements that will travel with your message.</p>}
        {stale&&<p className="context-stale" role="status">The drawing, selection or planning details changed after this preview. {matchingPending?'Retry checks the same saved request and keeps its original attachment.':'Refresh it before sending.'}</p>}
        {matchingPending&&<p className="context-pending">A send is unconfirmed. Retry preserves its request ID and original context.</p>}
      </div>:<div className="chat-context-summary">{view.selectedIds?.length?'Selected objects':'Whole board'}{view.board.elements.some(element=>!element.isDeleted)?' + drawing image':''} + attached notes. A saved revision travels with each message.</div>}
      <textarea ref={composer} aria-label="Message the connected model" placeholder={intent==='work'?'Describe the work you want me to do…':'What should we think through?'} value={draft} maxLength={8000} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();e.currentTarget.form.requestSubmit();}}}/>
      {storageWarning&&<p className="chat-storage-hint">This attachment is too large to keep after closing the tab. Your request ID and text are kept; check delivery before starting a new message.</p>}
      {missingRetryAttachment&&<div className="chat-storage-hint" role="status">The original attachment was not retained after reopening. Check your AI chat for this request before starting another one.<button type="button" className="chat-context-link" onClick={()=>{setPending(null);setPrepared(null);setStorageWarning(false);}}>Start a new request with this text</button></div>}
      {error&&<p className="chat-error" role="alert">{error}</p>}
      </div>
      <div className="chat-send"><small>{needsPreview?'Preview the attachment before sending.':intent==='work'?'Allows only the work you ask for.':'Discussion does not approve changes.'}</small><button type="submit" disabled={!draft.trim()||sending||preparing||needsPreview||missingRetryAttachment||!view.chatConnected||!view.online||view.status==='conflict'}><Icon name="send" size={16}/>{sending?'Sending…':matchingPending?(manualHosted?'Retry preparation':'Retry saved send'):miniChat.enabled?'Send':view.connection?.provider==='codex'?'Copy to Codex':'Copy to AI'}</button></div>
    </form>:<div className="chat-unavailable" role="status"><strong>Mini chat unavailable</strong><p>{miniChat.reason} Saved requests and replies remain available here. Use Copy to AI on a prepared request to continue in your AI app.</p>{onConnect&&<button type="button" className="secondary-button" onClick={onConnect}>Connection details</button>}</div>}
    {previewOpen&&attachment&&<Modal title="Your AI’s drawing context" subtitle={`${scopeLabel(attachment)} · saved revision ${attachment.expectedRevision}`} onClose={()=>setPreviewOpen(false)} wide><div className="context-preview-drawing">{attachment.visual?<img src={attachment.visual} alt="Exact drawing image prepared for this message"/>:<p>The captured drawing is empty.</p>}</div>{stale&&<p className="planner-error" role="status">The board or planning details changed after this capture. Close this preview and refresh it before a new send.</p>}<div className="context-preview-notes"><h3>Included notes & requirements <span>{attachment.notes?.length||0}</span></h3>{attachment.notes?.length?attachment.notes.map((note,index)=><article key={note.id??index}><small>{note.kind==='task'?'Work card':note.kind==='requirement'?'Requirement':'Note'}{note.status==='done'?' · resolved':''}</small><strong>{note.title}</strong>{note.text&&<p>{note.text}</p>}</article>):<p>No notes are attached to this scope.</p>}</div><p className="muted">This saved drawing image, its editable object data and the listed planning context travel with your message. Later drawing changes do not replace this snapshot.</p><div className="modal-actions"><button type="button" className="primary-button" onClick={()=>setPreviewOpen(false)}>Use this attachment</button></div></Modal>}
  </section>;
}
