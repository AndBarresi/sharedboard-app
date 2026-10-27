// Copyright (c) 2026 Andrew Barresi. SPDX-License-Identifier: MIT
import React,{useEffect,useRef,useState} from 'react';
import {Icon} from './Icons.jsx';
import {copyText} from './ConnectionSetup.jsx';

const downloadUrl='https://github.com/AndBarresi/sharedboard-app/releases/latest/download/SharedBoard-Bridge-windows-x64.zip';
const otherApps=['Claude Code','Cursor','Other MCP app','ChatGPT','Claude'];

export function BrowserBridgeSetup({connection,online,begin,cancel,disconnect,onClose,onTest,detectBridge}){
  const [availability,setAvailability]=useState('unknown'),[busy,setBusy]=useState(''),[error,setError]=useState(null),[pair,setPair]=useState(null),[copied,setCopied]=useState(false),[permission,setPermission]=useState(connection?.permission==='edit'?'edit':'read'),[clock,setClock]=useState(Date.now());
  const dialog=useRef(null),close=useRef(null),opener=useRef(document.activeElement);
  const connected=Boolean(connection?.connected&&connection.provider==='codex');
  useEffect(()=>{close.current?.focus();const timer=setInterval(()=>setClock(Date.now()),1000);return()=>{clearInterval(timer);opener.current?.focus?.();};},[]);
  useEffect(()=>{if(connected){setPair(null);setCopied(false);}},[connected,connection?.id]);
  const finish=async()=>{if(pair&&!connected)try{await cancel?.();}catch{}onClose();};
  const check=async()=>{
    if(busy)return;setBusy('detect');setError(null);
    try{if(!detectBridge)throw new Error('Bridge detection is unavailable. Reload this page and try again.');const result=await detectBridge();setAvailability(result?.available?'ready':'missing');if(!result?.available&&result?.detail)setError(result.detail);}
    catch(cause){setAvailability('missing');setError(cause.message||'The bridge could not be reached. Open it, then check again.');}
    finally{setBusy('');}
  };
  const prepare=async()=>{
    if(busy||availability!=='ready')return;setBusy('pair');setError(null);setCopied(false);
    try{setPair(await begin({provider:'codex',permission}));}
    catch(cause){setError(cause.message||'Could not prepare the connection. Check the bridge and try again.');}
    finally{setBusy('');}
  };
  const copy=async()=>{try{await copyText(pair.setup.prompt);setCopied(true);setError(null);}catch(cause){setError(cause.message);}};
  const changePermission=async value=>{if(busy)return;setBusy('permission');setError(null);try{if(pair)await cancel?.();setPermission(value);setPair(null);setCopied(false);}catch(cause){setError(cause.message||'Could not cancel the previous instructions. Check the bridge and try again.');}finally{setBusy('');}};
  const leave=async()=>{if(busy)return;setBusy('disconnect');setError(null);try{await disconnect();setPair(null);setCopied(false);}catch(cause){setError(cause.message);}finally{setBusy('');}};
  const test=async()=>{if(busy||!connected)return;setBusy('test');setError(null);try{await onTest();onClose();}catch(cause){setError(cause.message||'The test message could not be sent. Check the bridge and try again.');}finally{setBusy('');}};
  const expires=pair?Math.max(0,Math.ceil((Date.parse(pair.pairing.expiresAt)-clock)/1000)):0;
  const verified=(title,value,detail)=><li><span className={`checkmark ${value?'done':''}`}>{value?<Icon name="check" size={13}/>:<span>·</span>}</span><div><strong>{title}</strong><small>{value?'Verified':detail}</small></div></li>;
  return <div className="connection-overlay" onPointerDown={event=>{event.stopPropagation();if(event.target===event.currentTarget)finish();}}><section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="bridge-title" className="connection-dialog browser-bridge-dialog" onKeyDown={event=>{
    event.stopPropagation();if(event.key==='Escape'){event.preventDefault();finish();}
    if(event.key==='Tab'){const items=[...dialog.current.querySelectorAll('button,select,input,textarea,a[href]')].filter(element=>!element.disabled&&element.offsetParent!==null);if(event.shiftKey&&document.activeElement===items[0]){event.preventDefault();items.at(-1)?.focus();}else if(!event.shiftKey&&document.activeElement===items.at(-1)){event.preventDefault();items[0]?.focus();}}
  }}><header><span className="connect-mark">↗</span><div><p className="eyebrow">YOUR BOARD. YOUR CODEX CONVERSATION.</p><h2 id="bridge-title">Connect Codex on this computer.</h2></div><button ref={close} aria-label="Close connection setup" onClick={finish}><Icon name="close"/></button></header>
    <div className="connection-body"><p className="connect-intro">Use your existing Codex conversation and chosen model. The Windows bridge lets this board exchange requests and replies with Codex on your computer. Your boards still save in this browser.</p>
      <div className="ai-choices browser-bridge-choices"><button type="button" className="chosen" aria-pressed="true"><strong>Codex</strong><small>Available with the Windows bridge</small></button>{otherApps.map(name=><button key={name} type="button" className="is-wip" disabled title="Work in progress. This browser edition currently connects to Codex only."><strong>{name}<Icon name="lock" size={13}/></strong><small>WIP · Planned connection</small></button>)}</div>
      {connected&&<section className="current-connection bridge-current"><div><span className="connection-dot connected"/><strong>{connection.label||'Your Codex conversation'}</strong><span>{connection.permission==='edit'?'Read + edit':'Read only'}</span></div><p>Mini-chat messages go to this existing Codex conversation. An answer appears here only after Codex reads the message and posts a reply.</p><ul className="connection-checks">{verified('Board access',connection.boardCheckedAt,'Waiting for Codex to read + confirm')}{verified('Message delivery',connection.deliveryCheckedAt,'Not tested yet')}{verified('Reply to the board',connection.replyCheckedAt,'Not tested yet')}</ul><div className="connection-actions"><button type="button" className="connect-primary" disabled={Boolean(busy)||!online} onClick={test}>{busy==='test'?'Sending test…':'Test with a reply'}</button><button type="button" className="connect-quiet" disabled={Boolean(busy)} onClick={leave}>Disconnect</button></div></section>}
      <div className="setup-section-heading"><span>01</span><h3>Open your bridge</h3></div><p className="bridge-step-copy">Already installed? Open the bridge, then check that this page can reach it.</p>
      <div className="connection-actions bridge-launch-actions"><a className="connect-secondary" href="sharedboard-bridge://open">Open bridge</a><button type="button" className="connect-primary" disabled={Boolean(busy)} onClick={check}>{busy==='detect'?'Checking…':availability==='unknown'?'Check for bridge':'Check again'}</button></div>
      <p className={`bridge-detection ${availability==='ready'?'is-ready':''}`} role="status"><span className={`connection-dot ${availability==='ready'?'connected':''}`}/>{availability==='ready'?'Bridge found. You can prepare your Codex connection below.':availability==='missing'?'Bridge not reached yet. Install or open it, then check again.':'Check for the bridge when you are ready.'}</p>
      <p className="bridge-browser-permission">Your browser may ask permission to connect to the bridge on this device. Windows may also ask before opening the app.</p>
      {availability!=='ready'&&<details className="bridge-install" open={availability==='missing'}><summary>First time? Install the Windows bridge</summary><ol><li><a href={downloadUrl} className="bridge-download" rel="noopener noreferrer">Download the Windows x64 bridge ZIP</a><span>The Codex app or CLI should already be installed and signed in.</span></li><li><strong>Extract the ZIP, then open Install SharedBoard Bridge.cmd.</strong><span>Extract all files before opening the installer. This one-time setup adds the Open bridge link to Windows.</span></li><li><strong>Return here, choose Open bridge, then Check again.</strong><span>The page will confirm when the bridge is reachable.</span></li></ol><p>The browser cannot install a desktop helper for you. You choose when to run its setup and open the bridge; no commands or configuration files need to be typed.</p></details>}
      <div className="setup-section-heading"><span>02</span><h3>{connected?'Link a different Codex conversation':'Link your existing Codex conversation'}</h3></div>
      <label className="access-choice">Board access<select aria-label="Codex bridge board access" value={permission} disabled={Boolean(busy)} onChange={event=>changePermission(event.target.value)}><option value="read">Read only</option><option value="edit">Read and edit when I request changes</option><option value="propose" disabled>Propose changes · WIP</option></select></label>
      <button type="button" className="connect-primary create-pair" disabled={Boolean(busy)||availability!=='ready'||!online} onClick={prepare}>{busy==='pair'?'Preparing…':pair?'Create fresh connection instructions':'Prepare connection instructions'}</button>
      {availability!=='ready'&&<p className="cloud-limit">Check for the bridge first to prepare this board’s connection.</p>}
      {pair&&<section className="pairing-steps"><p>Copy these instructions and paste them into the Codex conversation you want to keep using. Codex completes the connection through the bridge; you do not need to enter commands yourself. Keep this window open while it connects.</p><button type="button" className="connect-primary" disabled={!expires} onClick={copy}>{copied?'Copied · paste into your Codex chat':'Copy connection instructions'}</button><span className={`pairing-expiry ${!expires?'expired':''}`}>{expires?`Instructions expire in ${Math.floor(expires/60)}:${String(expires%60).padStart(2,'0')}`:'Instructions expired · prepare a fresh connection'}</span><details><summary>View connection instructions</summary><textarea aria-label="Codex bridge connection instructions" readOnly value={pair.setup.prompt}/></details><p className="pairing-wait" aria-live="polite">Waiting for Codex to connect. The checks above update from actual connection activity.</p></section>}
      {!connected&&<section className="bridge-next-step"><Icon name="chat" size={18}/><div><strong>Then test both directions</strong><p>Once Codex connects, choose Test with a reply. We check board access, delivery to your conversation, and the answer returning to the mini chat separately.</p></div></section>}
      {error&&<p className="connection-error" role="alert">{error}</p>}
    </div><footer>SharedBoard.app · Browser storage + your local Codex bridge. No hosted model.</footer>
  </section></div>;
}
