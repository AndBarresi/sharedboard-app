// Copyright (c) 2026 Andrew Barresi. SPDX-License-Identifier: MIT
import React,{useEffect,useRef,useState} from 'react';
import {Icon} from './Icons.jsx';
import {CLIENT_PROFILES,clientProfile,miniChatState} from '../shared/client-profiles.mjs';

const providers=CLIENT_PROFILES;
const clientSteps={
 codex:['Open Settings, then MCP servers, and choose Add server.','Choose Streamable HTTP and paste the URL below. Save the server and authenticate it.','Enable the tools in your existing conversation. If the client requests a restart, return to that same conversation afterward.'],
 'claude-code':['In Claude on the web, open Customize, then Connectors. Add a custom connector using the URL below and approve its board access.','Use Claude Code signed in with the same claude.ai subscription account. Open /mcp to check that the connector is available. API-key and third-party-provider sessions do not inherit claude.ai connectors.','Pair this board with the intended Claude Code session to use its board tools. Automatic mini chat is a work in progress; a no-download incoming-message route has not been verified.'],
 chatgpt:['Open ChatGPT on the web and go to Plugins.','Choose the plus button, then Add custom MCP server. Paste the URL below and choose OAuth.','Approve the board access on SharedBoard, install or enable the resulting connector, then select it with @ in your existing chat.'],
 claude:['Open Claude on the web and go to Customize, then Connectors.','Add a custom connector using the URL below and complete its browser approval.','Enable the connector in your existing conversation. Your Claude account or workspace must allow custom connectors.'],
 other:['Open the remote MCP or connector settings in your AI client.','Add the URL below with OAuth authentication and automatic client registration.','Approve access on SharedBoard and enable its tools in the conversation you want to keep using.'],
};
const expiration=value=>typeof value==='number'?value:Date.parse(value);

export function CloudConnectionSetup({connection,online,begin,cancel,disconnect,onClose,onTest,onHistory,hasSavedRequests=false,copyValue}){
  const [provider,setProvider]=useState(clientProfile(connection?.provider)?connection.provider:'codex');
  const [permission,setPermission]=useState(connection?.permission==='edit'?'edit':'read');
  const [pair,setPair]=useState(null),[busy,setBusy]=useState(''),[error,setError]=useState(null),[copied,setCopied]=useState(''),[clock,setClock]=useState(Date.now());
  const dialog=useRef(null),close=useRef(null),opener=useRef(globalThis.document?.activeElement);
  const connected=Boolean(connection?.connected),linked=connected||Boolean(connection?.id&&connection.connectedAt),miniChat=miniChatState(connection,clock),automatic=miniChat.automatic===true;
  const providerLabel=clientProfile(provider)?.label??'your AI';
  const expires=pair?Math.max(0,Math.ceil((expiration(pair.pairing.expiresAt)-clock)/1000)):0;
  useEffect(()=>{close.current?.focus();const timer=setInterval(()=>setClock(Date.now()),1000);return()=>{clearInterval(timer);opener.current?.focus?.();};},[]);
  useEffect(()=>{if(linked){setPair(null);setCopied('');}},[linked,connection?.id]);
  // Closing the instructions must not revoke the code the user just copied.
  const finish=async()=>{if(!busy)onClose();};
  const choose=async(nextProvider,nextPermission)=>{if(busy||linked)return;setBusy('choose');setError(null);try{if(pair)await cancel?.();setPair(null);setCopied('');setProvider(nextProvider);setPermission(nextPermission);}catch(cause){setError(cause.message);}finally{setBusy('');}};
  const prepare=async()=>{
    if(busy||linked||!online)return;setBusy('prepare');setError(null);setCopied('');
    try{
      const result=await begin({provider,permission});
      if(typeof result?.setup?.url!=='string'||!result?.setup?.prompt?.trim()||!Number.isFinite(expiration(result?.pairing?.expiresAt)))throw new Error('The connection instructions are not ready. Please try again.');
      let url;try{url=new URL(result.setup.url);}catch{throw new Error('The connection instructions are not ready. Please try again.');}
      if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new Error('The connection instructions are not ready. Please try again.');
      setPair(result);
    }catch(cause){setError(cause.message||'Could not prepare the connection. Keep this board open and try again.');}
    finally{setBusy('');}
  };
  const copy=async(text,label)=>{try{await copyValue(text);setCopied(label);setError(null);}catch(cause){setError(cause.message||'Select the text below and copy it manually.');}};
  const leave=async()=>{if(busy)return;setBusy('disconnect');setError(null);try{await disconnect();setPair(null);setCopied('');}catch(cause){setError(cause.message);}finally{setBusy('');}};
  const test=async()=>{if(busy||!connected||!online||!miniChatState(connection).automatic)return;setBusy('test');setError(null);try{await onTest();onClose();}catch(cause){setError(cause.message||'The test request could not be sent. Check the direct connection before retrying.');}finally{setBusy('');}};
  const verified=(title,value,detail)=><li><span className={'checkmark '+(value?'done':'')}>{value?<Icon name="check" size={13}/>:<span>·</span>}</span><div><strong>{title}</strong><small>{value?(connected?'Verified':'Previously verified'):detail}</small></div></li>;
  return <div className="connection-overlay" onPointerDown={event=>{event.stopPropagation();if(event.target===event.currentTarget)void finish();}}><section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="cloud-connect-title" className="connection-dialog cloud-connection-dialog" onKeyDown={event=>{
    event.stopPropagation();if(event.key==='Escape'){event.preventDefault();void finish();}
    if(event.key==='Tab'){const items=[...dialog.current.querySelectorAll('button,select,input,textarea,a[href],summary')].filter(element=>!element.disabled&&element.offsetParent!==null);if(event.shiftKey&&document.activeElement===items[0]){event.preventDefault();items.at(-1)?.focus();}else if(!event.shiftKey&&document.activeElement===items.at(-1)){event.preventDefault();items[0]?.focus();}}
  }}><header><span className="connect-mark">↗</span><div><p className="eyebrow">YOUR BOARD. YOUR EXISTING CONVERSATION.</p><h2 id="cloud-connect-title">{linked?'Your AI connection.':'Connect your AI.'}</h2></div><button ref={close} type="button" disabled={Boolean(busy)} aria-label="Close connection setup" onClick={()=>void finish()}><Icon name="close"/></button></header>
    <div className="connection-body"><p className="connect-intro">Connect through SharedBoard’s hosted relay. Keep your existing conversation and model; there is no SharedBoard software to install. Your drawing stays saved in this browser.</p>
      {linked?<section className="current-connection"><div><span className={'connection-dot '+(connected?'connected':'')}/><strong>{connection.label||'Your AI conversation'}</strong><span>{connection.permission==='edit'?'Read + edit':'Read only'}</span></div>
        <div className={`connection-mini-status ${miniChat.enabled?'is-ready':''}`} role="status"><strong>{automatic?'Automatic mini chat connected':connected?'Automatic mini chat · Work in progress':'Mini chat offline'}</strong><span>{automatic?'Verified incoming messages are enabled for this connection.':miniChat.reason}</span></div>
        <p>{!connected?'This connection is saved, but the AI is not connected right now. Keep the board open and return to the linked chat.':automatic?'A reply appears after your AI reads the request and posts its actual answer.':'Board access is connected. Use SharedBoard’s tools from your existing AI conversation. Talk it through stays unavailable until the connection supports verified automatic delivery.'}</p>
        {connected&&!automatic&&<p className="cloud-limit">The conversation panel is diagnostic only. Text-message support does not prove automatic submission or a model response. Opening that panel will not enable mini chat, and saved requests will not replay automatically.</p>}
        {connection.permission!=='edit'&&<p className="cloud-limit"><strong>Drawing edits are off.</strong> Read-only access supports board reading and replies. Automatic mini chat additionally requires a verified incoming-message route. To let your AI make changes you request, disconnect below, choose <strong>Read and edit when I request changes</strong>, then reconnect and approve the new access.</p>}
        <ul className="connection-checks">{verified('Board access',connection.boardCheckedAt,'Waiting for a real board read + confirmation')}{verified('Message received',connection.deliveryCheckedAt,automatic?'Waiting for a real direct message':'Automatic mini chat unavailable')}{verified('Reply to the board',connection.replyCheckedAt,'Waiting for an actual reply')}</ul>
        <div className="connection-actions"><button type="button" className="connect-primary" disabled={Boolean(busy)||!connected||!online||!automatic} onClick={test}>{busy==='test'?'Sending test…':'Test with a reply'}</button>{onHistory&&<button type="button" className="connect-secondary" disabled={Boolean(busy)} onClick={onHistory}>Saved requests & replies</button>}<button type="button" className="connect-quiet" disabled={Boolean(busy)} onClick={leave}>{busy==='disconnect'?'Disconnecting…':'Disconnect'}</button></div>
        <p className="cloud-limit">To choose another conversation or change its access, disconnect this link. Your drawing and saved messages stay here.</p>
      </section>:<>
        <div className="setup-section-heading"><span>01</span><h3>Choose your AI app</h3></div>
        <div className="ai-choices">{providers.map(({id,label,miniChatLabel,detail,miniChat})=><button type="button" key={id} disabled={Boolean(busy)} aria-pressed={provider===id} className={provider===id?'chosen':''} onClick={()=>void choose(id,permission)}><strong>{label}</strong><span className={`client-mini-badge ${miniChat}`}>{miniChatLabel}</span><small className="client-detail">{detail}</small></button>)}</div>
        <p className="cloud-limit">Choose the app where you talk to your AI. Board tools require remote connectors. Automatic mini chat is a work in progress and is enabled only for a verified incoming-message route; a conversation panel cannot establish it. Drawing edits require read-and-edit access.</p>
        <label className="access-choice">Board access<select aria-label="AI board access" value={permission} disabled={Boolean(busy)} onChange={event=>void choose(provider,event.target.value)}><option value="read">Read only</option><option value="edit">Read and edit when I request changes</option></select></label>
        <button type="button" className="connect-primary create-pair" disabled={Boolean(busy)||!online} onClick={prepare}>{busy==='prepare'?'Preparing…':pair?'Create fresh connection instructions':'Prepare connection'}</button>
        {!online&&<p className="connection-error" role="status">Wait for this board to reconnect before preparing a connection.</p>}
        {pair&&<section className="pairing-steps">
          <div className="setup-section-heading"><span>02</span><h3>Add SharedBoard to {providerLabel}</h3></div>
          <ol>{clientSteps[provider].map(step=><li key={step}>{step}</li>)}</ol>
          <label className="access-choice">SharedBoard MCP server URL<input aria-label="SharedBoard MCP server URL" readOnly value={pair.setup.url}/></label>
          <button type="button" className="connect-secondary" onClick={()=>void copy(pair.setup.url,'url')}>{copied==='url'?'Copied server URL':'Copy server URL'}</button>
          {['claude','claude-code'].includes(provider)&&<details><summary>Claude registration choice</summary><p>If Claude asks how to register this connector, choose <strong>Register automatically</strong>. SharedBoard supports dynamic client registration with PKCE; you do not need a client secret.</p></details>}
          <div className="setup-section-heading"><span>03</span><h3>Pair your existing conversation</h3></div>
          <p>Use these one-time setup instructions in that conversation. Your AI pairs with this board, reads its current contents, and confirms the revision. This connects board tools; automatic mini chat is checked separately. Keep this board tab open.</p>
          <button type="button" className="connect-primary" disabled={!expires} onClick={()=>void copy(pair.setup.prompt,'prompt')}>{copied==='prompt'?'Copied · paste into your AI chat':'Copy pairing instructions'}</button>
          <span className={'pairing-expiry '+(!expires?'expired':'')}>{expires?'Pairing instructions expire in '+Math.floor(expires/60)+':'+String(expires%60).padStart(2,'0'):'Instructions expired · create fresh instructions'}</span>
          <details><summary>View pairing instructions</summary><textarea aria-label="AI pairing instructions" readOnly value={pair.setup.prompt}/></details>
          <p className="pairing-wait" aria-live="polite">Waiting for your AI to pair. This window updates when the connection is established.</p>
        </section>}
      </>}
      {!linked&&hasSavedRequests&&onHistory&&<div className="connection-actions"><button type="button" className="connect-secondary" onClick={onHistory}>Saved requests & replies</button></div>}
      <details className="bridge-troubleshooting"><summary>Connection help</summary><p>If your AI cannot find SharedBoard’s tools, check that the server URL is enabled in that conversation. If pairing expires, prepare fresh instructions here. If a request is unconfirmed, keep its original ID and check the linked chat before retrying.</p><p>Claude’s app-message feature fills a draft in Claude’s composer; it does not submit it or start the model. SharedBoard will not present that as automatic mini chat. Codex and Claude Code also have no verified no-download incoming route here. An active, verified incoming-event connection is required before Talk it through becomes available.</p><p>Cursor and VS Code can use remote board tools through Other MCP client. Their complete automatic mini-chat workflow has not been verified for SharedBoard.</p></details>
      {error&&<p className="connection-error" role="alert">{error}</p>}
    </div><footer>SharedBoard.app · Browser-saved boards + a hosted connection to your AI. No hosted model.</footer>
  </section></div>;
}
