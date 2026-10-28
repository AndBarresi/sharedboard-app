import React from 'react';
import './imagine-selection.css';

export function ImagineSelectionFlow({phase,selectedCount=0,referenceCount=0,error,onUseSelection,onCancel,onBack}){
  if(!['reference','target'].includes(phase))return null;
  const reference=phase==='reference',count=Math.max(0,selectedCount);
  return <section className="imagine-selection-flow" aria-label={reference?'Choose an Imagine reference':'Choose what to imagine'} onPointerDown={event=>event.stopPropagation()}>
    <div className="imagine-selection-heading"><div><p className="eyebrow">IMAGINE · {reference?'1. REFERENCE':'2. WIREFRAME'}</p><h2>{reference?'Select a reference on the board':'Select the wireframe to imagine'}</h2></div><span className="imagine-selection-count" role="status" aria-live="polite">{count} selected</span></div>
    <p className="imagine-selection-instructions">{reference?'Drag around a finished screen or component, then use it as the reference.':`${referenceCount} reference ${referenceCount===1?'object is':'objects are'} saved. Drag around the wireframe or elements you want to refine.`}</p>
    {error&&<p className="imagine-selection-error" role="alert">{error}</p>}
    <div className="imagine-selection-actions"><button type="button" className="imagine-selection-cancel" onClick={onCancel}>Cancel</button>{!reference&&onBack&&<button type="button" className="secondary-button" onClick={onBack}>Back to reference</button>}<button type="button" className="primary-button" onClick={onUseSelection} disabled={!count} title={!count?'Select objects on the board to continue':undefined}>{reference?'Use as reference':'Imagine this selection'}</button></div>
  </section>;
}
