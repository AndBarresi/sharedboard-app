// Copyright (c) 2026 Andrew Barresi. SPDX-License-Identifier: MIT
import React,{useEffect,useRef,useState} from 'react';
import {Modal} from './Modal.jsx';
import {Icon} from './Icons.jsx';
import {buildImaginePrompt,previousImaginePasses} from '../shared/imagine.mjs';
import {imagineAvailability,savedImagineDirection} from './imagine-state.mjs';
import './imagine.css';

export function ImaginePanel({view,getSync,onClose,onConnect,draft,onDraft,onHistory,referenceIds,targetIds,onChangeReference,onChangeTarget}) {
  const [capture,setCapture]=useState(null),[preparing,setPreparing]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(false),[requestId,setRequestId]=useState(null);
  const mounted=useRef(true),generation=useRef(0),sending=useRef(false);
  const available=imagineAvailability(view),message=view.messages?.find(message=>message.id===requestId);
  const applied=message?.imagine?.result&&!message.imagine.result.undoneAt;
  const direction=draft.designDirection??savedImagineDirection(view),instructions=draft.instructions??'';
  const previous=previousImaginePasses(view.board.elements);
  useEffect(()=>()=>{mounted.current=false;},[]);
  const prepare=async()=>{
    const attempt=++generation.current;setPreparing(true);setError('');setCapture(null);
    try {
      const next=await getSync().prepareContext({scope:'selection',imagine:true,referenceIds});
      if(mounted.current&&generation.current===attempt)setCapture(next);
    } catch(error) {if(mounted.current&&generation.current===attempt)setError(error.message);}
    finally {if(mounted.current&&generation.current===attempt)setPreparing(false);}
  };
  useEffect(()=>{prepare();return()=>{generation.current++;};},[JSON.stringify(referenceIds)]);
  const send=async event=>{
    event.preventDefault();if(sending.current||!capture||!available.enabled)return;
    sending.current=true;setBusy(true);setError('');
    const id=crypto.randomUUID();
    try {
      const result=await getSync().sendChat({id,intent:'work',text:buildImaginePrompt({instructions,designDirection:direction,previousPasses:previous}),capturedContext:capture,imagine:{instructions,designDirection:direction}});
      if(!mounted.current)return;
      setRequestId(id);
      const sent=result.messages.find(message=>message.id===id);
      if(!sent?.reply&&sent?.delivery!=='queued')setError(sent?.deliveryError||'This request is saved, but delivery needs attention. Open its chat entry before retrying.');
    } catch(error) {
      if(mounted.current){
        setError(error.message);
        // Delivery can finish even when the response is lost. Keep its original
        // identity visible and let the saved chat own any explicit retry.
        if(!error.status||error.status>=500||error.deliveryUnknown)setRequestId(id);
      }
    }
    finally {sending.current=false;if(mounted.current)setBusy(false);}
  };
  const changed=capture&&(capture.expectedRevision!==view.board.revision||capture.expectedPlanningVersion!==view.planning?.version);
  return <Modal title="Imagine" subtitle="Turn a selected wireframe into a polished, editable design." wide onClose={onClose}>
    <form className="imagine-form" onSubmit={send}>
      {!requestId?<>
        <p className="imagine-intro">Your reference and wireframe were selected on the canvas. Your AI will carry the reference’s colors, typography, spacing and repeated components into the wireframe.</p>
        <div className="imagine-roles"><div><strong>1. Reference</strong><span>{referenceIds.length} objects · kept on the board</span><button type="button" onClick={onChangeReference} disabled={busy}>Change reference</button></div><div><strong>2. Wireframe</strong><span>{targetIds.length} objects · to imagine</span><button type="button" onClick={onChangeTarget} disabled={busy}>Change wireframe</button></div></div>
        <div className="imagine-previews" aria-busy={preparing}>
          <figure><figcaption>Selection to imagine</figcaption>{capture?.visual?<img src={capture.visual} alt="Selected wireframe to be replaced"/>:<div className="imagine-empty">{preparing?'Preparing your selection…':'Select a wireframe on the board.'}</div>}</figure>
          <figure><figcaption>Visual reference · kept on the board</figcaption>{capture?.imagineReferences?.visual?<img src={capture.imagineReferences.visual} alt="Existing design used for visual consistency"/>:<div className="imagine-empty">{preparing?'Preparing the design reference…':'No other artwork in this reference. Add a finished page or describe the design direction below.'}</div>}</figure>
        </div>
        <label>What should this become? <span className="imagine-optional">optional</span><textarea aria-label="What should this become?" aria-describedby="imagine-default-brief" maxLength={2000} value={instructions} onChange={event=>onDraft({...draft,instructions:event.target.value})} placeholder="For example: A contact page with a short form and the same navigation and buttons as my index page." disabled={busy}/><small id="imagine-default-brief">Leave both fields empty to use the wireframe and reference as your brief.</small></label>
        <label>Design direction <span className="imagine-optional">optional</span><textarea aria-label="Design direction" maxLength={2000} value={direction} onChange={event=>onDraft({...draft,designDirection:event.target.value})} placeholder="Keep the existing visual style, or describe details to preserve across pages." disabled={busy}/><small>Saved with this request and remembered after a successful pass. Board requirements and earlier Imagine results are included too.</small></label>
        {previous.length>0&&<details className="imagine-memory"><summary>Design memory from {previous.length} earlier {previous.length===1?'pass':'passes'}</summary>{previous.map((pass,index)=><p key={pass.passId??index}>{pass.designSummary}</p>)}</details>}
        {changed&&<p className="imagine-notice" role="status">The board changed after this preview. Refresh it to include the latest design.</p>}
        {!available.enabled&&<p className="imagine-notice" role="status">{available.reason}</p>}
        {error&&<p className="imagine-error" role="alert">{error}</p>}
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="secondary-button" onClick={prepare} disabled={preparing||busy}>Refresh preview</button>{available.connect?<button type="button" className="primary-button" onClick={onConnect}>AI connection</button>:<button className="primary-button" disabled={!capture||preparing||busy||changed||!available.enabled}><Icon name="imagine" size={16}/>{busy?'Sending…':'Imagine selection'}</button>}</div>
      </>:<div className="imagine-progress" aria-live="polite"><span className="imagine-status-icon"><Icon name={applied?'check':'imagine'} size={26}/></span><h3>{message?.imagine?.result?.undoneAt?'Imagine pass undone':applied?'Selection reimagined':message?.reply?'Your AI replied':error?'Delivery needs attention':'Your AI is imagining this selection'}</h3><p>{message?.imagine?.result?.undoneAt?'The original selection was restored. Start a new Imagine pass when you are ready.':message?.imagine?.result?.designSummary??message?.reply??'The captured wireframe and its visual reference are saved together. The result will appear on the canvas when your AI completes the replacement.'}</p>{applied&&<small>A recovery copy of the original is available in Checkpoints & history. You can also undo this pass in AI changes.</small>}{error&&<p className="imagine-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onHistory}>Open request in chat</button><button type="button" className="primary-button" onClick={onClose}>Back to the board</button></div></div>}
    </form>
  </Modal>;
}
