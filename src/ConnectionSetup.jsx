import React,{useEffect,useRef,useState} from 'react';
import {Icon} from './Icons.jsx';
import {WebConnectionSetup} from './WebConnectionSetup.jsx';
import {isWebProvider,localConnectionView,webConnectionWip} from './connection-policy.mjs';

export async function copyText(text){
  try{await navigator.clipboard.writeText(text);return;}catch{}
  const el=document.createElement('textarea');el.value=text;el.style.position='fixed';el.style.left='-9999px';document.body.append(el);el.select();const done=document.execCommand('copy');el.remove();if(!done)throw new Error('Select the instructions and copy them manually.');
}
const apps=[['codex','Codex','Automatic board messages'],['claude','Claude Code','MCP tools + copy to chat'],['cursor','Cursor','MCP tools + copy to chat'],['other','Other MCP app','Standard local MCP tools'],['chatgpt-web','ChatGPT','WIP · Planned web connection'],['claude-web','Claude','WIP · Planned web connection']];
export function ConnectionSetup({connection:receivedConnection,online,begin,cancel,disconnect,onClose,onTest,browserOnly=false}){
  const connection=browserOnly?null:localConnectionView(receivedConnection);
  const [provider,setProvider]=useState(connection?.provider&&!isWebProvider(connection.provider)?connection.provider:'codex'),[permission,setPermission]=useState(connection?.permission??'edit'),[pair,setPair]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(null),[copied,setCopied]=useState(''),[clock,setClock]=useState(Date.now());
  const firstConnection=useRef(connection?.id),dialog=useRef(null),close=useRef(null),opener=useRef(document.activeElement);
  const paired=connection?.connected&&connection.id!==firstConnection.current;
  useEffect(()=>{close.current?.focus();return()=>opener.current?.focus?.();},[]);
  useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer);},[]);
  useEffect(()=>{if(paired)setPair(null);},[paired]);
  const copy=async(value,label)=>{try{await copyText(value);setCopied(label);setError(null);}catch(e){setError(e.message);}};
  const finish=async()=>{try{if(pair)await cancel();onClose();}catch(e){setError(e.message);}};
  const start=async()=>{if(browserOnly||isWebProvider(provider)){setError(browserOnly?'AI connections are work in progress in this browser edition.':webConnectionWip);return;}setBusy(true);setError(null);setCopied('');try{setPair(await begin({provider,permission}));}catch(e){setError(e.message);}finally{setBusy(false);}};
  const choose=async(nextProvider,nextPermission)=>{if(browserOnly||isWebProvider(nextProvider))return;setBusy(true);setError(null);setPair(null);setCopied('');try{await cancel();setProvider(nextProvider);setPermission(nextPermission);}catch(e){setError(e.message);}finally{setBusy(false);}};
  const leave=async()=>{setBusy(true);setError(null);try{await disconnect();firstConnection.current=null;setPair(null);}catch(e){setError(e.message);}finally{setBusy(false);}};
  const expires=pair?Math.min(600,Math.max(0,Math.ceil((Date.parse(pair.pairing.expiresAt)-clock)/1000))):0;
  const verified=(title,value,detail)=><li><span className={`checkmark ${value?'done':''}`}>{value?<Icon name="check" size={13}/>:<span>·</span>}</span><div><strong>{title}</strong><small>{value?'Verified':detail}</small></div></li>;
  return <div className="connection-overlay" onPointerDown={e=>{e.stopPropagation();if(e.target===e.currentTarget)finish();}}>
    <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="connect-title" className="connection-dialog" onKeyDown={e=>{
      e.stopPropagation();if(e.key==='Escape'){e.preventDefault();finish();}
      if(e.key==='Tab'){const items=[...dialog.current.querySelectorAll('button,select,input,textarea,a[href]')].filter(el=>!el.disabled&&el.offsetParent!==null);if(e.shiftKey&&document.activeElement===items[0]){e.preventDefault();items.at(-1)?.focus();}else if(!e.shiftKey&&document.activeElement===items.at(-1)){e.preventDefault();items[0]?.focus();}}
    }}>
      <header><span className="connect-mark">↗</span><div><p className="eyebrow">{browserOnly?'PLANNED FOR SHAREDBOARD.APP':'BRING YOUR AI TO THE BOARD'}</p><h2 id="connect-title">{browserOnly?'AI connections · Work in progress':'A connection to your conversation.'}</h2></div><button ref={close} aria-label="Close connection setup" onClick={finish}><Icon name="close"/></button></header>
      <div className="connection-body">
        <p className="connect-intro">{browserOnly?'This browser edition saves your boards on this device. Live connections to AI chats are still in development, so these options are visible as a preview of what is planned. No AI messages are sent from this edition.':'Keep your existing conversation and chosen model. This local beta connects to Codex, Claude Code and other local MCP clients. ChatGPT and Claude web connections are planned and locked below.'}</p>
        {connection?.connected&&<div className="current-connection"><div><span className="connection-dot connected"/><strong>{connection.label}</strong><span>{connection.permission==='edit'?'Read + edit':connection.permission==='propose'?'Proposals only':'Read only'}</span></div><p>{connection.automaticMessages?'Board messages can be queued into this Codex chat.':'Board tools are connected. Use Copy to AI to take a message into the existing chat; the AI posts its answer back here with the reply tool.'}</p>
          {connection.permission==='propose'&&<p>Drawing changes stay in AI changes until you review and accept them. Direct AI edits are blocked by the board.</p>}
          <ul className="connection-checks">{verified('Board access',connection.boardCheckedAt,'Waiting for the AI to read + confirm')}{verified('Message delivery',connection.deliveryCheckedAt,connection.automaticMessages?'Not tested yet':'Manual handoff')}{verified('Reply to the board',connection.replyCheckedAt,'Not tested yet')}</ul>
          <div className="connection-actions"><button className="connect-primary" disabled={busy||!online} onClick={async()=>{try{await onTest();onClose();}catch(e){setError(e.message);}}}>Test with a reply</button><button className="connect-quiet" disabled={busy} onClick={leave}>Disconnect</button></div>
        </div>}
        {!paired&&<>
          <div className="setup-section-heading"><span>01</span><h3>{browserOnly?'Planned AI connections':connection?.connected?'Connect a different chat':'Choose your AI app'}</h3></div>
          <div className="ai-choices">{apps.map(([id,label,description])=>{const locked=browserOnly||isWebProvider(id);return <button key={id} disabled={busy||locked} aria-pressed={!locked&&provider===id} className={locked?'is-wip':provider===id?'chosen':''} title={locked?(browserOnly?'Work in progress. Live AI connections are not available in this browser edition.':webConnectionWip):undefined} onClick={()=>choose(id,permission)}><strong>{label}{locked&&<Icon name="lock" size={13}/>}</strong><small>{browserOnly?'WIP · Planned AI connection':description}</small></button>;})}</div>
          {browserOnly?<section className="web-wip-note" aria-label="Browser AI connections work in progress"><Icon name="lock" size={15}/><div><strong>Your board is ready. Live AI links are planned.</strong><p>Keep sketching, organizing and previewing drawing context here. Export board backups to keep a copy outside this browser.</p></div></section>:<><WebConnectionSetup/>
            <p className="cloud-limit">Codex pairs from your existing chat and supports automatic message handoff. Claude Code, Cursor and other MCP clients need local tool setup and use Copy to AI for messages. They can still use your chosen online model.</p>
            <label className="access-choice">Board access<select aria-label="AI board access" value={permission} disabled={busy} onChange={e=>choose(provider,e.target.value)}><option value="edit">Read and edit when I request changes</option><option value="propose">Propose changes · approval required</option><option value="read">Read only</option></select></label>
            {permission==='propose'&&<p className="cloud-limit">Your AI can read the board and prepare drawing proposals. You accept or dismiss them in AI changes. This controls board edits; your AI app manages permissions for work outside SharedBoard.app.</p>}
            <button className="connect-primary create-pair" disabled={busy||!online} onClick={start}>{busy?'Preparing…':pair?'Create a fresh pairing code':'Prepare connection'}</button></>}
        </>}
        {pair&&<section className="pairing-steps">
          {provider!=='codex'&&<><div className="setup-section-heading"><span>02</span><h3>Add the board tools once</h3></div><p>{pair.setup.instructions}</p><details><summary>View MCP configuration</summary><pre>{pair.setup.config}</pre></details><button className="connect-secondary" onClick={()=>copy(pair.setup.config,'config')}>{copied==='config'?'Copied configuration':'Copy MCP configuration'}</button><a href={pair.setup.links[provider]||pair.setup.links.codex} target="_blank" rel="noreferrer">Official setup guide ↗</a></>}
          <div className="setup-section-heading"><span>{provider==='codex'?'02':'03'}</span><h3>Paste into the chat you want to keep using</h3></div>
          <p>{provider==='codex'?'Your agent can connect using the local helper. You do not need to find a chat ID or edit a settings file.':'After enabling the MCP tools, paste these instructions into your existing conversation.'}</p>
          <button className="connect-primary" disabled={!expires} onClick={()=>copy(pair.setup.prompt,'prompt')}>{copied==='prompt'?'Copied · paste into your AI chat':'Copy connection instructions'}</button>
          <span className={`pairing-expiry ${!expires?'expired':''}`}>{expires?`Pairing code expires in ${Math.floor(expires/60)}:${String(expires%60).padStart(2,'0')}`:'Code expired · create a fresh code'}</span>
          <details><summary>View connection instructions</summary><textarea aria-label="Connection instructions" readOnly value={pair.setup.prompt}/></details>
          <p className="pairing-wait" aria-live="polite">Waiting for your AI to connect. This window updates automatically.</p>
        </section>}
        {paired&&<div className="pair-success"><Icon name="check" size={25}/><h3>{connection.provider==='codex'?'Your conversation is linked.':'Your AI connection is ready.'}</h3><p>The AI can now use the board with the access you chose. The checks above show what has actually been verified.</p>{connection.provider!=='codex'&&<p>Board access applies to the configured MCP client. Use Copy to AI and paste requests into the existing chat you choose; its reply tool sends the answer back to this board.</p>}<button className="connect-secondary" onClick={finish}>Back to the board</button></div>}
        {error&&<p className="connection-error" role="alert">{error}</p>}
      </div><footer>{browserOnly?'SharedBoard.app · Browser edition. Boards stay in this browser profile on this device.':'SharedBoard.app · Local beta. Your drawing stays on this computer.'}</footer>
    </section>
  </div>;
}
