import React from 'react';
import {Modal} from './Modal.jsx';
import {selectionAction,boundsOf} from './canvas-actions.mjs';
export function SelectionDetails({getApi,onClose}){
  const api=getApi(),ids=new Set(Object.keys(api.getAppState().selectedElementIds).filter(id=>api.getAppState().selectedElementIds[id])),elements=api.getSceneElements().filter(e=>ids.has(e.id)),b=boundsOf(elements);
  return <Modal title="Selection details" subtitle={`${elements.length} selected objects`} onClose={onClose}><div className="selection-info">{b&&<><span>Position <strong>{Math.round(b.x)}, {Math.round(b.y)}</strong></span><span>Size <strong>{Math.round(b.width)} × {Math.round(b.height)}</strong></span></>}</div><p className="muted">Arrange the selected objects, or pin a reference so you can draw over it. Bound labels move with their shapes.</p><div className="selection-options">{[['align-left','Align left'],['align-center','Align centers'],['align-top','Align top'],['group','Group'],['ungroup','Ungroup'],['duplicate','Duplicate'],['lock',elements.every(e=>e.locked)?'Unlock selection':'Lock selection']].map(([action,label])=><button className="secondary-button" key={action} onClick={()=>{selectionAction(api,action);onClose();}}>{label}</button>)}</div></Modal>;
}
