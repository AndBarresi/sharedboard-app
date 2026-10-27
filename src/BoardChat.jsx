// Copyright (c) 2026 Andrew Barresi. SPDX-License-Identifier: MIT
import React,{useState} from 'react';
import {BoardChat as LocalBoardChat} from './BoardChatPanel.jsx';
import {Icon} from './Icons.jsx';
import {Modal} from './Modal.jsx';
import {MarkdownReply} from './MarkdownReply.jsx';
import {miniChatState} from '../shared/client-profiles.mjs';

export function BoardChat(props){
  const browserOnly=props.browserOnly||props.view.storageMode==='browser'||import.meta.env.VITE_STORAGE_MODE==='browser';
  const browserConnected=Boolean(props.view.chatConnected);
  return browserOnly&&!browserConnected?<BrowserChat key={props.view.board.id??'browser-board'} {...props}/>:<LocalBoardChat {...props}/>;
}

function BrowserChat({open,setOpen,view,focused,prepareContext,onConnect}){
  const [busy,setBusy]=useState(false),[preview,setPreview]=useState(null),[error,setError]=useState(null);
  const miniChat=miniChatState(view.chatConnected?view.connection:null);
  const prepare=async()=>{
    if(!prepareContext||busy)return;setBusy(true);setError(null);
    try{const context=await prepareContext({scope:view.selectedIds?.length?'selection':'board'});if(context.visual&&!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(context.visual))throw new Error('The drawing preview could not be opened.');setPreview(context);}
    catch(cause){setError(cause.message||'Could not prepare the drawing preview. Your drawing is still here.');}
    finally{setBusy(false);}
  };
  if(!open)return focused?null:<button className="chat-bubble browser-chat-bubble" disabled={!miniChat.enabled} aria-label={miniChat.enabled?'Open board chat':'Talk it through unavailable'} title={miniChat.enabled?'Open board chat':miniChat.reason} onClick={()=>{if(miniChat.enabled)setOpen(true);}}><Icon name="chat" size={22}/><span>Talk it through</span></button>;
  return <section className="board-chat chat-upgraded browser-chat" aria-label="Board chat" onPointerDown={event=>event.stopPropagation()} onKeyDown={event=>event.stopPropagation()}>
    <header className="chat-header"><span className="chat-avatar"><Icon name="chat"/></span><div><h2>Saved board requests</h2><p>Board tools and automatic mini chat are checked separately.</p></div><div className="chat-window-actions"><button type="button" aria-label="Minimize board chat" onClick={()=>setOpen(false)}><Icon name="minus"/></button></div></header>
    <div className="browser-chat-content"><span className="browser-chat-lock"><Icon name="chat" size={24}/></span><h3>Use your AI with this board.</h3><p>Connect your existing AI client through the SharedBoard hosted relay to use board tools. Automatic mini chat remains unavailable unless that connection has a verified incoming-message route. Your boards and saved requests stay in this browser.</p><div className="browser-chat-connect-actions"><button type="button" className="primary-button" onClick={onConnect}>Connect an AI</button><button type="button" className="secondary-button" disabled={busy||!prepareContext} onClick={prepare}>{busy?'Preparing…':'Preview drawing context'}</button></div>{error&&<p className="chat-error" role="alert">{error}</p>}{view.messages?.length>0&&<div className="browser-chat-history"><p className="eyebrow">SAVED CONVERSATION</p>{view.messages.map(message=><div className="chat-exchange" key={message.id}><div className="chat-message user"><small>You · {message.intent==='work'?'Request work':'Discuss'} · revision {message.boardRevision}</small><p>{message.text}</p></div>{message.delivery==='manual'&&<p className="message-state">Saved without automatic delivery. This request will not replay when a connection becomes available.</p>}{message.reply?<div className="chat-message assistant"><small>AI</small><MarkdownReply text={message.reply}/></div>:message.delivery!=='manual'&&<p className="message-state">{message.delivery==='queued'?'Automatic submission is unverified. Check its AI conversation before retrying.':message.deliveryError||'No reply recorded. Reconnect to check this request.'}</p>}</div>)}</div>}</div>
    <div className="chat-unavailable" role="status"><strong>Mini chat unavailable</strong><p>{miniChat.reason}</p></div>
    {preview&&<Modal title="Your drawing context" subtitle={`Preview only · saved revision ${preview.expectedRevision}`} onClose={()=>setPreview(null)} wide><div className="context-preview-drawing">{preview.visual?<img src={preview.visual} alt="Drawing context preview saved in this browser"/>:<p>The captured drawing is empty.</p>}</div><div className="context-preview-notes"><h3>Included notes & requirements <span>{preview.notes?.length||0}</span></h3>{preview.notes?.length?preview.notes.map((note,index)=><article key={note.id??index}><small>{note.kind==='task'?'Work card':note.kind==='requirement'?'Requirement':'Note'}</small><strong>{note.title}</strong>{note.text&&<p>{note.text}</p>}</article>):<p>No notes are attached to this scope.</p>}</div><p className="muted">This is a local preview. No message or drawing has been sent to an AI.</p><div className="modal-actions"><button type="button" className="primary-button" onClick={()=>setPreview(null)}>Back to the board</button></div></Modal>}
  </section>;
}
