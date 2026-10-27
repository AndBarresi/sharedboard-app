// Copyright (c) 2026 Andrew Barresi. SPDX-License-Identifier: MIT
import React,{useEffect,useRef,useState} from 'react';
import {Icon} from './Icons.jsx';
import {copyText} from './ConnectionSetup.jsx';
import {bridgeDownloadPath} from '../shared/bridge-downloads.mjs';

const platforms=[
  {id:'windows-x64',label:'Windows',download:'Windows x64',installer:'Install SharedBoard Bridge.cmd'},
  {id:'macos-arm64',label:'macOS · Apple Silicon',download:'macOS Apple Silicon',installer:'Install SharedBoard Bridge.command'},
  {id:'macos-x64',label:'macOS · Intel',download:'macOS Intel',installer:'Install SharedBoard Bridge.command'}
];

export function BrowserBridgeSetup({connection,online,begin,cancel,disconnect,onClose,onTest,detectBridge}){
  const connected=Boolean(connection?.connected&&connection.provider==='codex'),linked=connected||Boolean(connection?.provider==='codex'&&connection.id&&connection.connectedAt),manual=linked&&!connection.automaticMessages;
  const [availability,setAvailability]=useState('unknown'),[busy,setBusy]=useState(''),[error,setError]=useState(null),[pair,setPair]=useState(null),[copied,setCopied]=useState(false),[permission,setPermission]=useState(connection?.permission==='edit'?'edit':'read'),[clock,setClock]=useState(Date.now()),[platformId,setPlatformId]=useState(''),[installOpen,setInstallOpen]=useState(!linked);
  const dialog=useRef(null),close=useRef(null),opener=useRef(document.activeElement);
  const platform=platforms.find(item=>item.id===platformId),isMac=platformId.startsWith('macos-');
  useEffect(()=>{close.current?.focus();const timer=setInterval(()=>setClock(Date.now()),1000);return()=>{clearInterval(timer);opener.current?.focus?.();};},[]);
  useEffect(()=>{if(linked){setPair(null);setCopied(false);setInstallOpen(false);}},[linked,connection?.id]);
  const finish=async()=>{if(pair&&!linked)try{await cancel?.();}catch{}onClose();};
  const check=async()=>{
    if(busy)return;setBusy('detect');setError(null);
    try{if(!detectBridge)throw new Error('Bridge detection is unavailable. Reload this page and try again.');const result=await detectBridge();setAvailability(result?.available?'ready':'missing');if(result?.available)setInstallOpen(false);else if(result?.detail)setError(result.detail);}
    catch(cause){setAvailability('missing');setError(cause.message||'The bridge could not be reached. Open it, then check again.');}
    finally{setBusy('');}
  };
  const prepare=async()=>{
    if(busy||linked||availability!=='ready')return;setBusy('pair');setError(null);setCopied(false);
    try{setPair(await begin({provider:'codex',permission}));}
    catch(cause){setError(cause.message||'Could not prepare the connection. Check the bridge and try again.');}
    finally{setBusy('');}
  };
  const copy=async()=>{try{await copyText(pair.setup.prompt);setCopied(true);setError(null);}catch(cause){setError(cause.message);}};
  const changePermission=async value=>{if(busy||linked)return;setBusy('permission');setError(null);try{if(pair)await cancel?.();setPermission(value);setPair(null);setCopied(false);}catch(cause){setError(cause.message||'Could not cancel the previous instructions. Check the bridge and try again.');}finally{setBusy('');}};
  const leave=async()=>{if(busy||!connected)return;setBusy('disconnect');setError(null);try{await disconnect();setPair(null);setCopied(false);setAvailability('unknown');setInstallOpen(false);}catch(cause){setError(cause.message);}finally{setBusy('');}};
  const test=async()=>{if(busy||!connected)return;setBusy('test');setError(null);try{await onTest();onClose();}catch(cause){setError(cause.message||'The test request could not be prepared. Check the bridge and try again.');}finally{setBusy('');}};
  const expires=pair?Math.max(0,Math.ceil((Date.parse(pair.pairing.expiresAt)-clock)/1000)):0;
  const verified=(title,value,detail)=><li><span className={'checkmark '+(value?'done':'')}>{value?<Icon name="check" size={13}/>:<span>·</span>}</span><div><strong>{title}</strong><small>{value?(connected?'Verified':'Previously verified'):detail}</small></div></li>;
  const installer=<details className="bridge-install" open={installOpen} onToggle={event=>setInstallOpen(event.currentTarget.open)}>
    <summary>{linked?'Install or update the bridge':'First time? Download and install once'}</summary>
    <label className="bridge-platform-choice">This computer<select aria-label="Bridge download operating system" value={platformId} onChange={event=>setPlatformId(event.target.value)}><option value="" disabled>Choose Windows or Mac…</option>{platforms.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    {(!platform||isMac)&&<p className="bridge-mac-choice">On a Mac, open Apple menu → About This Mac. Choose Apple Silicon for an Apple M-series chip, or Intel for an Intel processor.</p>}
    {platform?<><ol>
      <li><a href={bridgeDownloadPath(platform.id)} className="bridge-download">Download the {platform.download} bridge ZIP</a><span>{isMac?'Requires macOS 13.5 or later.':'For 64-bit Windows.'} Have Codex installed and signed in on this computer.</span></li>
      <li><strong>Extract the ZIP, then open {platform.installer}.</strong><span>{isMac?'Keep the extracted files together. The installer puts SharedBoard Bridge.app in your user Applications folder (~/Applications).':'Extract all files before opening the installer.'} This one-time setup enables the Open bridge link and starts the helper.</span></li>
      <li><strong>Return here and check for the bridge.</strong><span>The installer has already started it. Use Open bridge on later visits, or if the helper has stopped.</span></li>
    </ol>{isMac&&<div className="bridge-mac-approval"><strong>macOS first-open approval</strong><p>This beta is not yet signed or notarized. First try opening the installer. If macOS blocks it as an unverified developer and you trust this download, open System Settings → Privacy &amp; Security, choose Open Anyway for the helper, then confirm Open. <a href="https://support.apple.com/en-us/102445" target="_blank" rel="noopener noreferrer">Apple’s guidance ↗</a></p></div>}</>:<p className="bridge-select-hint">Choose your system to see its download and installation steps.</p>}
    <p>The browser cannot install a desktop helper itself. Open its installer once; no commands or configuration files need to be typed.</p>
  </details>;
  return <div className="connection-overlay" onPointerDown={event=>{event.stopPropagation();if(event.target===event.currentTarget)finish();}}><section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="bridge-title" className="connection-dialog browser-bridge-dialog" onKeyDown={event=>{
    event.stopPropagation();if(event.key==='Escape'){event.preventDefault();finish();}
    if(event.key==='Tab'){const items=[...dialog.current.querySelectorAll('button,select,input,textarea,a[href],summary')].filter(element=>!element.disabled&&element.offsetParent!==null);if(event.shiftKey&&document.activeElement===items[0]){event.preventDefault();items.at(-1)?.focus();}else if(!event.shiftKey&&document.activeElement===items.at(-1)){event.preventDefault();items[0]?.focus();}}
  }}><header><span className="connect-mark">↗</span><div><p className="eyebrow">LOCAL CODEX ↔ YOUR BROWSER BOARD</p><h2 id="bridge-title">{linked?'Your Codex connection.':'Connect your Codex conversation.'}</h2></div><button ref={close} aria-label="Close connection setup" onClick={finish}><Icon name="close"/></button></header>
    <div className="connection-body"><p className="connect-intro">{linked?'Use the mini chat to discuss this board or request work in the conversation you linked.':'Link a Codex conversation already on this computer. Install the small bridge, choose your chat, then test a reply here.'} Your boards stay saved in this browser.</p>
      {linked?<>
        <section className="current-connection bridge-current"><div><span className={'connection-dot '+(connected?'connected':'')}/><strong>{connection.label||'Your Codex conversation'}</strong><span>{connection.permission==='edit'?'Read + edit':'Read only'}</span></div>{!connected&&<><p className="bridge-offline-status" role="status">Your conversation is still linked, but the bridge is not reached. Open it to resume; previous checks are shown below.</p><div className="connection-actions bridge-launch-actions"><a className="connect-secondary" href="sharedboard-bridge://open">Open bridge</a><button type="button" className="connect-primary" disabled={Boolean(busy)} onClick={check}>{busy==='detect'?'Checking…':'Check again'}</button></div>{availability==='ready'&&<p role="status">Bridge found. Waiting for this board connection to resume…</p>}</>}<ul className="connection-checks">{verified('Board access',connection.boardCheckedAt,'Waiting for Codex to read + confirm')}{verified('Message delivery',connection.deliveryCheckedAt,manual?'Copy-to-Codex handoff':'Not tested yet')}{verified('Reply to the board',connection.replyCheckedAt,'Not tested yet')}</ul><div className="connection-actions"><button type="button" className="connect-primary" disabled={Boolean(busy)||!online||!connected} onClick={test}>{busy==='test'?'Preparing test…':manual?'Copy test to Codex':'Test with a reply'}</button></div><p>{manual?'Automatic chat delivery is unavailable in this Codex installation. Copy the test into your linked Codex chat; its answer can still return to this board.':'The test opens the mini chat. A reply appears after Codex handles the request; it can wait while that chat finishes other work.'}</p></section>
        <details className="bridge-manage"><summary>Manage connection</summary><p>To change the Codex conversation or its board access, keep the bridge running, disconnect first, then link the chat you choose. Opening this section or downloading an update does not change your connection.</p><button type="button" className="connect-secondary" disabled={Boolean(busy)||!connected} onClick={leave}>{busy==='disconnect'?'Disconnecting…':'Disconnect and set up another chat'}</button>{installer}</details>
      </>:<>
        <div className="setup-section-heading"><span>01</span><h3>Connect this computer</h3></div>
        {installer}
        <div className="connection-actions bridge-launch-actions"><a className="connect-secondary" href="sharedboard-bridge://open">Open bridge</a><button type="button" className="connect-primary" disabled={Boolean(busy)} onClick={check}>{busy==='detect'?'Checking…':availability==='unknown'?'Check for bridge':'Check again'}</button></div>
        <p className={'bridge-detection '+(availability==='ready'?'is-ready':'')} role="status"><span className={'connection-dot '+(availability==='ready'?'connected':'')}/>{availability==='ready'?'Bridge found. You can link your conversation below.':availability==='missing'?'Bridge not reached. Open it and allow this site to connect to your device, then check again.':'Already installed? Open bridge, then check that this page can reach it.'}</p>
        <p className="bridge-browser-permission">Your browser may ask to open the bridge app or connect to this device. Allow the request for SharedBoard.app.</p>
        <div className="setup-section-heading"><span>02</span><h3>Choose your Codex chat</h3></div>
        <label className="access-choice">Board access<select aria-label="Codex bridge board access" value={permission} disabled={Boolean(busy)||availability!=='ready'} onChange={event=>changePermission(event.target.value)}><option value="read">Read only</option><option value="edit">Read and edit when I request changes</option><option value="propose" disabled>Propose changes · Planned</option></select></label>
        <button type="button" className="connect-primary create-pair" disabled={Boolean(busy)||availability!=='ready'||!online} onClick={prepare}>{busy==='pair'?'Preparing…':pair?'Create fresh instructions':'Prepare connection instructions'}</button>
        {availability!=='ready'&&<p className="cloud-limit">Check for the bridge in step 1 to continue.</p>}
        {pair&&<section className="pairing-steps"><p>Copy these instructions into the existing Codex chat you want to use. Codex handles the connection; you do not type commands. Keep this board tab open.</p><button type="button" className="connect-primary" disabled={!expires} onClick={copy}>{copied?'Copied · paste into your Codex chat':'Copy connection instructions'}</button><span className={'pairing-expiry '+(!expires?'expired':'')}>{expires?'Instructions expire in '+Math.floor(expires/60)+':'+String(expires%60).padStart(2,'0'):'Instructions expired · create fresh instructions'}</span><details><summary>View connection instructions</summary><textarea aria-label="Codex bridge connection instructions" readOnly value={pair.setup.prompt}/></details><p className="pairing-wait" aria-live="polite">Waiting for Codex. Once linked, the connection checks and reply test appear here.</p></section>}
        <p className="bridge-test-next"><strong>03 · Test a reply</strong> Once linked, choose Test with a reply to check delivery and the answer returning to this board.</p>
      </>}
      {error&&<p className="connection-error" role="alert">{error}</p>}
      <details className="bridge-help"><summary>Connection help</summary><ul>
        <li><strong>Which browser?</strong> Use Chrome or Edge for the local bridge on Windows or Mac. Safari bridge connections are not supported in this beta; drawing in the browser remains available. Embedded browsers may also require local-device permission.</li>
        <li><strong>Bridge not found?</strong> The installer starts it once. On later visits, use Open bridge. If that link is not recognized, extract the ZIP again and run the matching installer.</li>
        <li><strong>Browser permission blocked?</strong> Open this site’s controls beside the address bar, allow local-device or local-network access if listed, then check again. The bridge runs on this computer.</li>
        <li><strong>Codex will not connect?</strong> Make sure Codex is installed, signed in, and can accept queued messages in existing chats. If queue delivery is unavailable, use Copy to Codex from the mini chat. Paste fresh connection instructions if pairing expired.</li>
        <li><strong>Waiting for a reply?</strong> Keep this board tab and the bridge open. Codex may finish another turn before reading a queued request. Replies return when Codex posts an answer; this panel does not mirror every Codex message.</li>
        <li><strong>Changed computers or browsers?</strong> Boards belong to this browser profile. Export a backup, import it in the new browser, then install the bridge on that computer and pair again.</li>
      </ul></details>
      <details className="bridge-planned"><summary><Icon name="lock" size={13}/>More AI connections · Planned</summary><p>Codex through the local bridge is available now. Claude Code, Cursor and other MCP clients, plus direct ChatGPT and Claude in-chat connections, remain planned and unavailable in this browser beta.</p></details>
    </div><footer>SharedBoard.app · Your existing conversation. No hosted model.</footer>
  </section></div>;
}
