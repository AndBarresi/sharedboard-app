// Copyright (c) 2026 Andrew Barresi. SPDX-License-Identifier: MIT
import React,{useEffect,useRef,useState} from 'react';
import {Modal} from './Modal.jsx';

const requestParameter='sharedboard_connect';
const loopback=hostname=>['localhost','127.0.0.1','[::1]'].includes(hostname);
const expiresAt=value=>typeof value==='number'?value:Date.parse(value);
function initialRequest(){
 const values=new URLSearchParams(globalThis.location?.search??'').getAll(requestParameter);
 if(!values.length)return null;
 if(values.length!==1||!/^[A-Za-z0-9_-]{32,128}$/.test(values[0]))return {id:null,error:'This connection request address is invalid. Return to your AI app and start a fresh connection.'};
 return {id:values[0],error:null};
}
function callbackOrigin(value){
 let url;try{url=new URL(value);}catch{throw new Error('The AI callback address could not be verified. Start again from your AI app.');}
 if(url.origin!==value||url.username||url.password||url.protocol!=='https:'&&!(url.protocol==='http:'&&loopback(url.hostname)))throw new Error('The AI callback address could not be verified. Start again from your AI app.');
 return url.origin;
}
export function checkedAuthorizationRedirect(value,expectedOrigin){
 let url;try{url=new URL(value);}catch{throw new Error('The connector returned an invalid callback. Return to your AI app and start again.');}
 if(url.username||url.password||url.hash||url.protocol!=='https:'&&!(url.protocol==='http:'&&loopback(url.hostname))||url.origin!==callbackOrigin(expectedOrigin))throw new Error('The connector returned an unexpected callback. Return to your AI app and start again.');
 return url.href;
}
function checkedRequest(value,id){
 if(!value||value.id!==id||!Array.isArray(value.scopes)||!value.scopes.includes('board.read')||value.scopes.some(scope=>!['board.read','board.write'].includes(scope))||!['waiting','approved','denied'].includes(value.status)||!Number.isFinite(expiresAt(value.expiresAt)))throw new Error('The connection request could not be verified. Start again from your AI app.');
 return {...value,clientName:typeof value.clientName==='string'?value.clientName.trim().slice(0,100)||'AI connector':'AI connector',callbackOrigin:callbackOrigin(value.callbackOrigin)};
}

export function CloudAuthorization({controller,view,onConnect,onChooseBoard,setupOpen=false}){
 const [initial]=useState(initialRequest),[request,setRequest]=useState(null),[loading,setLoading]=useState(Boolean(initial?.id)),[error,setError]=useState(initial?.error??null),[busy,setBusy]=useState(false),[attempt,setAttempt]=useState(0),[clock,setClock]=useState(Date.now()),[dismissed,setDismissed]=useState(false),[notice,setNotice]=useState(false),[paused,setPaused]=useState(false);
 const preparing=useRef(false),boardWindow=useRef(null),connectionId=view?.connection?.id;
 useEffect(()=>{if(!initial||dismissed)return;const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer);},[initial,dismissed]);
 useEffect(()=>{
  if(!initial?.id||!controller||dismissed)return;let active=true;setLoading(true);setError(null);
  Promise.resolve().then(()=>controller.readConnectionRequest(initial.id)).then(value=>{if(active)setRequest(checkedRequest(value,initial.id));}).catch(cause=>{if(active){setRequest(null);setError(cause.message||'Could not read this request. Keep the board open and try again.');}}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[controller,initial,dismissed,attempt]);
 useEffect(()=>{if(connectionId&&preparing.current&&!setupOpen){preparing.current=false;setPaused(false);}},[connectionId,setupOpen]);
 const dismiss=()=>{
  if(busy)return;
  const url=new URL(globalThis.location.href);url.searchParams.delete(requestParameter);globalThis.history.replaceState(globalThis.history.state,'',url.href);
  setDismissed(true);setNotice(true);
 };
 const openSetup=()=>{preparing.current=true;setPaused(true);onConnect?.();};
 const chooseBoard=()=>{preparing.current=true;setPaused(true);onChooseBoard?.();};
 const expired=Boolean(request&&clock>=expiresAt(request.expiresAt)),waiting=request?.status==='waiting'&&!expired;
 const permission=request?.scopes.includes('board.write')&&view?.connection?.permission==='edit'?'edit':'read';
 const boardTitle=view?.planning?.project?.title||view?.board?.title||'Current board';
 const project=view?.workspace?.projects?.find(item=>item.id===view.workspace.currentProjectId)?.name;
 const decide=async allow=>{
  if(busy||!controller||!request||!waiting||allow&&!connectionId)return;setBusy(true);setError(null);
  try{
   if(allow&&(!boardWindow.current||boardWindow.current.closed)){
    const pathname=globalThis.location.pathname;if(!/^\/(?:boards\/[a-f0-9-]{36}\/?)?$/i.test(pathname))throw new Error('Open the intended board before approving this connection.');
    const tab=globalThis.open(new URL(pathname,globalThis.location.origin).href,'_blank');
    if(!tab)throw new Error('The browser blocked the board tab. Allow SharedBoard to open that tab, then approve again. No access was approved.');
    try{tab.opener=null;}catch{}boardWindow.current=tab;
   }
   const result=await controller.approveConnection({requestId:initial.id,allow});const redirect=checkedAuthorizationRedirect(result?.redirect,request.callbackOrigin);globalThis.location.assign(redirect);
  }
  catch(cause){setError(cause.message||'Could not complete this decision. No success has been confirmed. Try again.');setBusy(false);}
 };
 if(!initial)return null;
 if(dismissed)return notice?<div className="notice" role="status" style={{position:'fixed',bottom:16,left:16,right:16,zIndex:50}}><p>AI approval dismissed. No access was approved here. Return to your AI app to start a fresh connection when you are ready.</p><button type="button" onClick={()=>setNotice(false)}>Dismiss</button></div>:null;
 if(paused)return <div className="notice" role="status" style={{position:'fixed',bottom:16,left:16,right:16,zIndex:50}}><p>AI approval is waiting while you choose a board or prepare its connection. Nothing has been approved.</p><button type="button" disabled={setupOpen} onClick={()=>{preparing.current=false;setPaused(false);}}>Return to AI approval</button></div>;
 return <Modal title="Allow this AI to use your board?" subtitle="Review the client, callback, board, and access before approving." onClose={dismiss}>
  {loading?<p className="muted" role="status">Reading the AI connection request…</p>:request?<>
   <article className="planner-card"><p className="eyebrow">AI CLIENT REQUEST</p><h3>{request.clientName}</h3><p>The client reports this name. After your decision, the browser will return to:</p><p style={{overflowWrap:'anywhere'}}><strong>{request.callbackOrigin}</strong></p>{typeof request.verification==='string'&&/^\d{6}$/.test(request.verification)&&<p>Request check code: <strong>{request.verification}</strong></p>}</article>
   <article className="planner-card"><p className="eyebrow">BOARD YOU ARE AUTHORIZING</p><h3>{boardTitle}</h3>{project&&<p>Project: {project}</p>}<p>This decision applies to this board. Its saved drawing stays in this browser.</p>{onChooseBoard&&(view?.workspace?.boards?.length??0)>1&&<button type="button" className="secondary-button" disabled={busy||!waiting} onClick={chooseBoard}>Choose another board</button>}</article>
   <div className="planner-form"><label>Requested access<input readOnly aria-label="AI requested access" value={request.scopes.includes('board.write')?'Read and edit':'Read only'}/></label><label>Access this approval will grant<input readOnly aria-label="AI effective board access" value={permission==='edit'?'Read and edit when you request changes':'Read only'}/></label></div>
   <p className="muted">Access is limited by both the client’s request and the permission you selected for this board. Reading can share drawing context with your AI provider. Edit access permits authorized drawing changes; it does not turn drawing contents into instructions.</p>
   {!connectionId&&waiting?<div className="planner-card"><h3>Prepare this board’s connection first</h3><p>Choose the AI app and read-only or requested-edit access, then return here to approve this client for the board shown above.</p><button type="button" className="primary-button" disabled={busy||!controller} onClick={openSetup}>Prepare board connection</button></div>:waiting&&<button type="button" className="secondary-button" disabled={busy} onClick={openSetup}>Change board access</button>}
   <p className="muted" role="status">{expired?'This request expired. Return to your AI app and start a fresh connection.':request.status==='approved'?'This request was already approved. Return to your AI app; start again there if the connection did not finish.':request.status==='denied'?'This request was already declined. Start again from your AI app if you want to connect.':`Approval request expires in ${Math.floor(Math.max(0,Math.ceil((expiresAt(request.expiresAt)-clock)/1000))/60)}:${String(Math.max(0,Math.ceil((expiresAt(request.expiresAt)-clock)/1000))%60).padStart(2,'0')}.`}</p>
   {waiting&&<p className="muted">Approving opens this board in a separate tab so it can stay connected when you return to the AI app. Keep that board tab open while your AI uses it.</p>}
   <div className="modal-actions"><button type="button" className="secondary-button" disabled={busy||!waiting||!controller} onClick={()=>void decide(false)}>{busy?'Completing decision…':'Deny access'}</button><button type="button" className="primary-button" disabled={busy||!waiting||!controller||!connectionId||view?.online===false} onClick={()=>void decide(true)}>{busy?'Completing decision…':`Approve ${permission==='edit'?'read + edit':'read-only'} access`}</button></div>
  </>:null}
  {error&&<p className="planner-error" role="alert">{error}</p>}
  {!loading&&!request&&initial.id&&<button type="button" className="secondary-button" disabled={!controller} onClick={()=>setAttempt(value=>value+1)}>Retry reading request</button>}
  <p className="muted">Closing this window dismisses this approval screen. It does not approve or deny the request automatically; restart from your AI app if needed.</p>
 </Modal>;
}
