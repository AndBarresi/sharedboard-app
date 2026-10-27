// Copyright (c) 2026 Andrew Barresi.
import React,{useState} from 'react';
import {BoardChat as LocalBoardChat} from './BoardChatPanel.jsx';
import {Icon} from './Icons.jsx';
import {Modal} from './Modal.jsx';

export function BoardChat(props){
  const browserOnly=props.browserOnly||props.view.storageMode==='browser'||import.meta.env.VITE_STORAGE_MODE==='browser';
  return browserOnly?<BrowserChat key={props.view.board.id??'browser-board'} {...props}/>:<LocalBoardChat {...props}/>;
}

function BrowserChat({open,setOpen,view,focused,prepareContext}){
  const [busy,setBusy]=useState(false),[preview,setPreview]=useState(null),[error,setError]=useState(null);
  const prepare=async()=>{
    if(!prepareContext||busy)return;setBusy(true);setError(null);
    try{const context=await prepareContext({scope:view.selectedIds?.length?'selection':'board'});if(context.visual&&!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(context.visual))throw new Error('The drawing preview could not be opened.');setPreview(context);}
    catch(cause){setError(cause.message||'Could not prepare the drawing preview. Your drawing is still here.');}
    finally{setBusy(false);}
  };
  if(!open)return focused?null:<button className="chat-bubble browser-chat-bubble" aria-label="Open board chat, work in progress" onClick={()=>setOpen(true)}><Icon name="chat" size={22}/><span>AI chat · WIP</span><Icon name="lock" size={13}/></button>;
  return <section className="board-chat chat-upgraded browser-chat" aria-label="Board chat work in progress" onPointerDown={event=>event.stopPropagation()} onKeyDown={event=>event.stopPropagation()}>
    <header className="chat-header"><span className="chat-avatar"><Icon name="chat"/></span><div><h2>AI chat · Work in progress</h2><p>No model is connected in this browser edition.</p></div><div className="chat-window-actions"><button type="button" aria-label="Minimize board chat" onClick={()=>setOpen(false)}><Icon name="minus"/></button></div></header>
    <div className="browser-chat-content"><span className="browser-chat-lock"><Icon name="lock" size={24}/></span><h3>A place for the next conversation.</h3><p>Live messages and AI replies are planned. You can keep drawing and preview the context an AI would receive. Nothing is sent to a model here.</p><button type="button" className="secondary-button" disabled={busy||!prepareContext} onClick={prepare}>{busy?'Preparing…':'Preview drawing context'}</button>{error&&<p className="chat-error" role="alert">{error}</p>}</div>
    <form className="chat-composer browser-chat-composer" onSubmit={event=>event.preventDefault()}><label>Message your AI<textarea aria-label="Planned AI message, work in progress" disabled placeholder="Live AI chat is coming in a future release."/></label><div className="chat-send"><small>AI connection required · WIP</small><button type="submit" disabled><Icon name="lock" size={14}/>Send · WIP</button></div></form>
    {preview&&<Modal title="Your drawing context" subtitle={`Preview only · saved revision ${preview.expectedRevision}`} onClose={()=>setPreview(null)} wide><div className="context-preview-drawing">{preview.visual?<img src={preview.visual} alt="Drawing context preview saved in this browser"/>:<p>The captured drawing is empty.</p>}</div><div className="context-preview-notes"><h3>Included notes & requirements <span>{preview.notes?.length||0}</span></h3>{preview.notes?.length?preview.notes.map((note,index)=><article key={note.id??index}><small>{note.kind==='task'?'Work card':note.kind==='requirement'?'Requirement':'Note'}</small><strong>{note.title}</strong>{note.text&&<p>{note.text}</p>}</article>):<p>No notes are attached to this scope.</p>}</div><p className="muted">This is a local preview. No message or drawing has been sent to an AI.</p><div className="modal-actions"><button type="button" className="primary-button" onClick={()=>setPreview(null)}>Back to the board</button></div></Modal>}
  </section>;
}
