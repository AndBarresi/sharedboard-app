import React,{useEffect,useRef,useState} from 'react';
import {Modal} from './Modal.jsx';
import {Icon} from './Icons.jsx';
import './workspaces.css';

export function WorkspaceDeleteConfirmation({preview,busy,onCancel,onDelete}){
  const cancel=useRef(null);
  useEffect(()=>{cancel.current?.focus();},[]);
  const project=preview.kind==='project',count=preview.boardCount;
  return <Modal title={project?'Delete project?':'Delete board?'} subtitle="Review what will be removed before confirming." onClose={onCancel}>
    <div className="workspace-delete-summary"><p className="workspace-delete-target">{preview.title}</p><p>{project?count?`This permanently deletes the project and all ${count} ${count===1?'board':'boards'} in it from this browser.`:'This permanently deletes the project from this browser. It contains no boards.':'This permanently deletes the board from this browser.'}</p><p>Its drawings, notes, saved requests, replies, and recovery history will be removed. Connections to deleted boards will be revoked.</p><p className="workspace-delete-warning">This cannot be undone. Export any backups you want to keep before deleting.</p></div>
    <div className="modal-actions"><button ref={cancel} autoFocus type="button" className="secondary-button" disabled={busy} onClick={onCancel}>Cancel</button><button type="button" className="primary-button workspace-delete-confirm" disabled={busy} onClick={onDelete}>{busy?'Deleting…':project?'Delete project':'Delete board'}</button></div>
  </Modal>;
}

export function WorkspacePicker({workspace,onClose,run,openBoard,browserOnly=false,previewDelete,onDeleted}){
  const [catalog,setCatalog]=useState(workspace);
  const [projectId,setProjectId]=useState(workspace?.currentProjectId??workspace?.projects?.[0]?.id??'');
  const [draft,setDraft]=useState(null);
  const [query,setQuery]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState(null);
  const [deletion,setDeletion]=useState(null);
  useEffect(()=>{if(workspace)setCatalog(workspace);},[workspace?.version,workspace?.currentBoardId]);
  const projects=catalog?.projects??[],boards=catalog?.boards??[];
  const selectedProject=projects.find(project=>project.id===projectId)??projects.find(project=>project.id===catalog?.currentProjectId)??projects[0];
  const currentBoard=boards.find(board=>board.id===catalog?.currentBoardId);
  const currentProject=projects.find(project=>project.id===currentBoard?.projectId);
  const projectBoards=boards.filter(board=>board.projectId===selectedProject?.id);
  const filteredBoards=projectBoards.filter(board=>board.title.toLowerCase().includes(query.trim().toLowerCase()));
  const startDraft=value=>{setDraft(value);setError(null);};
  const close=()=>{if(!busy)onClose();};
  const requestDelete=async(kind,id)=>{
    if(busy||!previewDelete)return;setBusy(true);setError(null);setDraft(null);
    try{
      const preview=await previewDelete({kind,id});
      if(preview?.kind!==kind||preview.id!==id||typeof preview.title!=='string'||!Number.isInteger(preview.expectedVersion)||!Array.isArray(preview.boards)||!Number.isInteger(preview.boardCount)||preview.boardCount<0||preview.boardCount!==preview.boards.length)throw new Error('The deletion preview is not ready. Please open it again.');
      setDeletion(preview);
    }catch(cause){setError(cause.message||'Could not prepare deletion. Nothing was deleted.');}
    finally{setBusy(false);}
  };
  const remove=async()=>{
    if(busy||!deletion)return;setBusy(true);setError(null);
    try{
      const result=await run({action:`delete-${deletion.kind}`,id:deletion.id,expectedVersion:deletion.expectedVersion,boards:deletion.boards}),updated=result?.workspace??result;
      if(updated?.projects&&updated?.boards){setCatalog(previous=>({...previous,...updated}));setProjectId(previous=>updated.projects.some(project=>project.id===previous)?previous:updated.currentProjectId??updated.projects[0]?.id??'');}
      setDeletion(null);setQuery('');
      if(result?.currentBoardDeleted)await onDeleted?.(result);
    }catch(cause){setDeletion(null);setError(cause.message||'Could not confirm deletion. Review the current boards before trying again.');}
    finally{setBusy(false);}
  };
  const deleteButton=(kind,entry)=>browserOnly&&previewDelete&&<button type="button" className="workspace-delete" disabled={busy} aria-label={`Delete ${kind} ${kind==='project'?entry.name:entry.title}`} title={`Delete ${kind}`} onClick={()=>void requestDelete(kind,entry.id)}><Icon name="trash" size={15}/></button>;
  const save=async event=>{
    event.preventDefault();if(!draft?.name.trim()||busy)return;
    setBusy(true);setError(null);
    const input={action:draft.action,...(draft.id?{id:draft.id}:{}),...(draft.projectId?{projectId:draft.projectId}:{}),...(draft.action.endsWith('board')?{title:draft.name.trim()}:{name:draft.name.trim()})};
    try{
      const result=await run(input),updated=result?.workspace??result;
      if(updated?.projects&&updated?.boards){
        setCatalog(previous=>({...previous,...updated}));
        if(draft.action==='create-project'){
          const created=updated.projects.find(project=>!projects.some(previous=>previous.id===project.id));
          if(created)setProjectId(created.id);
        }
      }
      setDraft(null);
    }catch(cause){setError(cause.message||'Could not save this entry. Your text is still here.');}
    finally{setBusy(false);}
  };
  const open=async board=>{
    if(busy)return;
    if(board.id===catalog.currentBoardId){onClose();return;}
    setBusy(true);setError(null);
    try{await openBoard(board.id);}
    catch(cause){setError(cause.message||'Could not open this board. Please try again.');setBusy(false);}
  };
  const editor=(label,placeholder)=> <form className="workspace-inline-form" onSubmit={save}>
    <label>{label}<input autoFocus required maxLength={100} value={draft.name} placeholder={placeholder} disabled={busy} onChange={event=>setDraft(previous=>({...previous,name:event.target.value}))}/></label>
    <div><button type="button" className="secondary-button" disabled={busy} onClick={()=>setDraft(null)}>Cancel</button><button type="submit" className="primary-button" disabled={busy||!draft.name.trim()}>{busy?'Saving…':draft.action.startsWith('create')?'Create':'Save name'}</button></div>
  </form>;
  return <><Modal title="Projects & boards" subtitle={browserOnly?'Your projects and boards, saved in this browser.':'A separate space for each thing you’re building.'} onClose={close} wide>
    <div className="workspace-current"><Icon name="grid" size={18}/><span>Current board<strong>{currentProject?.name||'Your project'} <span>/</span> {currentBoard?.title||'Your board'}</strong></span><span className="workspace-current-pill">Open now</span></div>
    {error&&<p className="planner-error workspace-picker-error" role="alert">{error}{draft&&<span>Your entry is kept below so you can try again.</span>}</p>}
    {!catalog?<p className="muted" role="status">Loading your projects…</p>:<div className="workspace-picker-layout">
      <section className="workspace-project-column" aria-label="Projects">
        <header><h3>Projects <span>{projects.length}</span></h3><button type="button" className="workspace-small-action" disabled={busy} onClick={()=>startDraft({action:'create-project',name:''})}><Icon name="plus" size={14}/>New</button></header>
        <div className="workspace-project-list">
          {projects.map(project=><div className={`workspace-project-entry ${project.id===selectedProject?.id?'selected':''}`} key={project.id}>
            <div className="workspace-project-row"><button type="button" className="workspace-project-choice" disabled={busy} aria-pressed={project.id===selectedProject?.id} onClick={()=>{setProjectId(project.id);setQuery('');}}><Icon name="grid" size={16}/><span>{project.name}</span><small>{boards.filter(board=>board.projectId===project.id).length}</small></button><span className="workspace-entry-actions"><button type="button" className="workspace-rename" disabled={busy} aria-label={`Rename project ${project.name}`} title="Rename project" onClick={()=>startDraft({action:'rename-project',id:project.id,name:project.name})}><Icon name="freedraw" size={14}/></button>{deleteButton('project',project)}</span></div>
            {draft?.action==='rename-project'&&draft.id===project.id&&editor('Project name','Name this project')}
          </div>)}
          {!projects.length&&<p className="workspace-empty">Create a project to start organizing your boards.</p>}
          {draft?.action==='create-project'&&editor('New project name','e.g. Travel website')}
        </div>
      </section>
      <section className="workspace-board-column" aria-label="Boards in selected project">
        <header><div><p className="eyebrow">BOARDS IN THIS PROJECT</p><h3>{selectedProject?.name||'Choose a project'}</h3></div><button type="button" className="secondary-button" disabled={busy||!selectedProject} onClick={()=>startDraft({action:'create-board',projectId:selectedProject.id,name:''})}><Icon name="plus" size={14}/>New board</button></header>
        {selectedProject&&<input className="workspace-board-search" type="search" aria-label="Search boards in project" placeholder="Find a board…" value={query} onChange={event=>setQuery(event.target.value)}/>}
        <div className="workspace-board-list">
          {draft?.action==='create-board'&&draft.projectId===selectedProject?.id&&editor('New board title','e.g. Mobile screens')}
          {filteredBoards.map(board=><article className={`workspace-board-entry ${board.id===catalog.currentBoardId?'current':''}`} key={board.id}>
            <div className="workspace-board-row"><button type="button" className="workspace-board-open" disabled={busy} aria-current={board.id===catalog.currentBoardId?'page':undefined} aria-label={board.id===catalog.currentBoardId?`Current board ${board.title}`:`Open board ${board.title}`} onClick={()=>open(board)}><span className="workspace-board-symbol"><Icon name="rectangle" size={22}/></span><span><strong>{board.title}</strong><small>{board.id===catalog.currentBoardId?'You’re working here':'Open this board'}</small></span>{board.id===catalog.currentBoardId?<Icon name="check" size={16}/>:<Icon name="review" size={16}/>}</button><span className="workspace-entry-actions"><button type="button" className="workspace-rename" disabled={busy} aria-label={`Rename board ${board.title}`} title="Rename board" onClick={()=>startDraft({action:'rename-board',id:board.id,name:board.title})}><Icon name="freedraw" size={15}/></button>{deleteButton('board',board)}</span></div>
            {draft?.action==='rename-board'&&draft.id===board.id&&editor('Board title','Name this board')}
          </article>)}
          {!filteredBoards.length&&selectedProject&&<div className="workspace-empty"><Icon name={query?'search':'rectangle'} size={28}/><h4>{query?'No matching boards':'Room for your next idea.'}</h4><p>{query?'Try another title, or choose a different project.':'Create a board for screens, architecture, references, or your next experiment.'}</p></div>}
        </div>
      </section>
    </div>}
    <p className="workspace-isolation-note"><Icon name="lock" size={15}/><span>{browserOnly?'These boards belong to this browser profile on this device. Opening the website on another device will not show them. Export backups before clearing this site’s data.':'Each board keeps its own drawing, notes, history, mini chat, and AI connection. New boards start with no AI connected.'}</span></p>
    <div className="workspace-picker-footer"><p>{busy?'Saving or opening your board…':'Opening another board saves your current drawing first.'}</p><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Back to the board</button></div>
  </Modal>{deletion&&<WorkspaceDeleteConfirmation preview={deletion} busy={busy} onCancel={()=>{if(!busy)setDeletion(null);}} onDelete={()=>void remove()}/>}</>;
}
