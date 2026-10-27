import React,{useEffect,useRef,useState} from 'react';
import {Modal} from './Modal.jsx';
import {createBackupPreviewReader} from './backup-preview.mjs';
export function ProjectTransfer({getSync,onClose}){
  const [preview,setPreview]=useState(null),[error,setError]=useState(null),[busy,setBusy]=useState(false),[reading,setReading]=useState(false);
  const sync=useRef(getSync);sync.current=getSync;
  const reader=useRef(null);
  if(!reader.current)reader.current=createBackupPreviewReader({browserOnly:import.meta.env.VITE_STORAGE_MODE==='browser',waitUntilSaved:()=>sync.current().waitUntilSaved(),getPlanningVersion:()=>sync.current().getPlanning().version,onChange:state=>{setPreview(state.preview);setError(state.error);setReading(state.reading);}});
  useEffect(()=>()=>reader.current.cancel(),[]);
  const read=event=>reader.current.read(event.target.files?.[0]);
  return <Modal title="Restore a board backup" subtitle="Bring back a drawing and its planning details together." onClose={()=>{if(!busy)onClose();}}><div className="planner-form"><label>Board backup<input type="file" accept=".sharedboard,application/json" disabled={busy} onChange={read}/></label>{reading&&<p className="muted" role="status">Reading backup…</p>}{preview&&<article className="planner-card"><h3>{preview.backup.project.title}</h3><p>{preview.backup.board.elements.filter(e=>!e.isDeleted).length} objects · {preview.backup.project.areas.length} areas · {preview.backup.project.notes.length} notes and work cards</p></article>}<p className="muted">Restoring replaces the current drawing and planning details. SharedBoard.app saves an automatic recovery save first. Your AI connection and mini chat stay with this workspace.</p>{error&&<p className="planner-error" role="alert">{error}</p>}<div className="modal-actions"><button className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button><button className="primary-button" disabled={!preview||busy||reading} onClick={async()=>{setBusy(true);setError(null);try{await getSync().importProject(preview.backup,preview.expectedRevision,preview.expectedVersion);onClose();}catch(e){setError(e.message);}finally{setBusy(false);}}}>{busy?'Restoring…':'Restore board'}</button></div></div></Modal>;
}
