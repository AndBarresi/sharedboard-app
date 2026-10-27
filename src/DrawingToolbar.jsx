import React,{useEffect,useRef,useState} from 'react';
import {CaptureUpdateAction,restoreElements} from '@excalidraw/excalidraw';
import {Icon} from './Icons.jsx';
const tools=[['selection','select','Select','V'],['hand','hand','Pan','H'],['rectangle','rectangle','Rectangle','R'],['diamond','diamond','Diamond','D'],['ellipse','ellipse','Ellipse','O'],['arrow','arrow','Arrow','A'],['line','line','Line','L'],['freedraw','freedraw','Draw','P'],['text','text','Text','T'],['image','image','Image','9'],['eraser','eraser','Eraser','E']];
const colors=['#26352e','#275c46','#718b64','#b56c43','#657c9b','#896284','#ffffff'];
const fills=['transparent','#e5eadc','#dff0e5','#fff0d9','#dce9f6','#eedfee','#ffffff'];
export function DrawingToolbar({getApi,ui,focused,onFullscreen,onChat,onConnect,onReview,reviewDisabled,onExport,onImport,onError,onPlanner,onReference,onChangelog,onExportProject,onImportProject,onWorkspace,onNavigator,browserOnly=false,onStorageDetails}){
  const [panel,setPanel]=useState(null);const root=useRef(null);const file=useRef(null);
  useEffect(()=>{const close=e=>{if(!root.current?.contains(e.target))setPanel(null);};const escape=e=>{if(e.key==='Escape')setPanel(null);};document.addEventListener('pointerdown',close);document.addEventListener('keydown',escape);return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',escape);};},[]);
  const button=(name,label,onClick,active=false,disabled=false)=><button type="button" key={label} className={`tool-button ${active?'active':''}`} aria-label={label} title={label} onClick={onClick} aria-pressed={active} disabled={disabled}><Icon name={name}/></button>;
  const choose=type=>{const api=getApi();if(!api)return;api.setActiveTool(type==='image'?{type,insertOnCanvasDirectly:true}:{type});setPanel(null);};
  const history=redo=>{const el=document.querySelector('.canvas-shell .excalidraw');el?.focus();el?.dispatchEvent(new KeyboardEvent('keydown',{key:'z',code:'KeyZ',ctrlKey:true,shiftKey:redo,bubbles:true,cancelable:true}));};
  const zoom=direction=>{const api=getApi();if(!api)return;const s=api.getAppState(), value=Math.min(5,Math.max(.1,s.zoom.value*direction));const cx=s.width/2/s.zoom.value-s.scrollX,cy=s.height/2/s.zoom.value-s.scrollY;api.updateScene({appState:{zoom:{value},scrollX:s.width/2/value-cx,scrollY:s.height/2/value-cy}});};
  const fit=()=>{const api=getApi();if(api)api.scrollToContent(api.getSceneElements(),{fitToViewport:true,viewportZoomFactor:.8,minZoom:.05,maxZoom:1});};
  const style=(key,value)=>{
    const api=getApi();if(!api)return;const s=api.getAppState();const defaults={strokeColor:'currentItemStrokeColor',backgroundColor:'currentItemBackgroundColor',strokeWidth:'currentItemStrokeWidth',fontSize:'currentItemFontSize',roughness:'currentItemRoughness'};
    const ids=new Set(Object.keys(s.selectedElementIds).filter(id=>s.selectedElementIds[id]));
    if(key==='strokeColor')for(const e of api.getSceneElements())if(ids.has(e.id))for(const b of e.boundElements??[])if(b.type==='text')ids.add(b.id);
    let elements=api.getSceneElementsIncludingDeleted().map(e=>ids.has(e.id)?{...e,[key]:value,version:e.version+1,versionNonce:Math.floor(Math.random()*2147483647),updated:Date.now()}:e);
    if(key==='fontSize')elements=restoreElements(elements,null,{refreshDimensions:true,repairBindings:true,normalizeIndices:true});
    api.updateScene({elements,appState:{[defaults[key]]:value},captureUpdate:CaptureUpdateAction.IMMEDIATELY});
  };
  return <div className="drawing-dock" ref={root} onPointerDown={e=>e.stopPropagation()}>
    <div className="shared-toolbar" role="toolbar" aria-label="Drawing tools">
      {button('menu','Board menu',()=>setPanel(panel==='menu'?null:'menu'),panel==='menu')}
      <span className="tool-divider"/>
      <div className="tool-scroll">{tools.map(([type,icon,label,key])=>button(icon,`${label} (${key})`,()=>choose(type),ui.tool===type))}</div>
      <span className="tool-divider"/>
      {button('palette','Drawing style',()=>setPanel(panel==='style'?null:'style'),panel==='style')}
      {button('undo','Undo',()=>history(false))}{button('redo','Redo',()=>history(true))}
      <span className="tool-divider"/>
      {button('review','Ask AI to look',onReview,false,reviewDisabled)}
      {focused&&button('chat','Open board chat',onChat)}
      {button(focused?'collapse':'expand',focused?'Exit full screen':'Full screen',()=>{setPanel(null);onFullscreen();},focused)}
    </div>
    {panel==='menu'&&<div className="dock-panel board-menu" role="region" aria-label="Board menu">
      <p className="eyebrow">OUR SHARED CANVAS</p>
      <div className={'board-menu-navigation '+(focused?'is-focused':'')}>
      <button onClick={()=>{onWorkspace();setPanel(null);}}><Icon name="grid"/> Projects & boards</button>
      <button onClick={()=>{onNavigator();setPanel(null);}}><Icon name="rectangle"/> Objects & minimap</button>
      <button onClick={()=>{onPlanner('areas');setPanel(null);}}><Icon name="search"/> Areas & search</button>
      <button onClick={()=>{onPlanner('notes');setPanel(null);}}><Icon name="chat"/> Notes & work cards</button>
      <button onClick={()=>{onPlanner('library');setPanel(null);}}><Icon name="grid"/> Reusable blocks</button>
      <button onClick={()=>{onPlanner('history');setPanel(null);}}><Icon name="history"/> Checkpoints & history</button>
      <button onClick={()=>{onPlanner('proposals');setPanel(null);}}><Icon name="review"/> AI changes</button>
      </div>
      <div className="zoom-row"><button aria-label="Zoom out" onClick={()=>zoom(1/1.2)}><Icon name="minus"/></button><span>{Math.round((ui.zoom||1)*100)}%</span><button aria-label="Zoom in" onClick={()=>zoom(1.2)}><Icon name="plus"/></button><button aria-label="Fit drawing" onClick={fit}><Icon name="fit"/></button></div>
      <button onClick={()=>{onExportProject();setPanel(null);}}><Icon name="download"/> Download board backup</button>
      <button onClick={()=>{onImportProject();setPanel(null);}}><Icon name="history"/> Restore board backup</button>
      <button onClick={()=>{onExport();setPanel(null);}}><Icon name="download"/> Export drawing (.excalidraw)</button>
      <button onClick={()=>file.current.click()}><Icon name="image"/> Import drawing</button>
      {focused&&<button onClick={()=>{onConnect();setPanel(null);}}><Icon name="review"/>{browserOnly?'AI connection':'AI connection'}</button>}
      {browserOnly&&<button onClick={()=>{onStorageDetails?.();setPanel(null);}}><Icon name="lock"/> Browser storage</button>}
      <button onClick={()=>{onReference();setPanel(null);}}><Icon name="image"/> Add screenshot reference</button>
      <button onClick={()=>{const api=getApi(),s=api.getAppState();api.updateScene({appState:{gridSize:s.gridSize?null:20}});setPanel(null);}}><Icon name="grid"/> Toggle alignment grid</button>
      {focused&&<button onClick={()=>{onChangelog();setPanel(null);}}><Icon name="history"/> What’s new</button>}
      <p className="shortcut-note">V select · H pan · P draw · T text<br/>Delete removes selection · Ctrl+Z undo<br/>Shift+1 fits · Ctrl+K finds areas and text</p>
      <small>Drawing engine by Excalidraw · MIT</small>
    </div>}
    {panel==='style'&&<div className="dock-panel style-panel" role="region" aria-label="Drawing style">
      <p className="eyebrow">{ui.selected?'STYLE THE SELECTION':'STYLE YOUR NEXT MARK'}</p>
      <label>Stroke</label><div className="swatches">{colors.map(color=><button key={color} title={`Stroke ${color}`} aria-label={`Stroke ${color}`} className={ui.stroke===color?'chosen':''} style={{background:color}} onClick={()=>style('strokeColor',color)}/>)}<input aria-label="Custom stroke color" type="color" value={ui.stroke||colors[0]} onChange={e=>style('strokeColor',e.target.value)}/></div>
      <label>Fill</label><div className="swatches">{fills.map(color=><button key={color} title={`Fill ${color}`} aria-label={`Fill ${color}`} className={`${ui.fill===color?'chosen':''} ${color==='transparent'?'no-fill':''}`} style={{background:color}} onClick={()=>style('backgroundColor',color)}/>)}</div>
      <div className="style-fields"><label>Line weight<select aria-label="Line weight" value={ui.strokeWidth||2} onChange={e=>style('strokeWidth',Number(e.target.value))}><option value="1">Fine</option><option value="2">Regular</option><option value="4">Bold</option></select></label><label>Text size<select aria-label="Text size" value={ui.fontSize||20} onChange={e=>style('fontSize',Number(e.target.value))}>{[12,16,20,28,36,48].map(v=><option key={v} value={v}>{v} px</option>)}</select></label></div>
      <label>Finish<select aria-label="Drawing finish" value={ui.roughness??1} onChange={e=>style('roughness',Number(e.target.value))}><option value="0">Clean</option><option value="1">Sketch</option><option value="2">Loose</option></select></label>
    </div>}
    <input ref={file} type="file" accept=".excalidraw,application/json" hidden onChange={async e=>{const item=e.target.files?.[0];e.target.value='';if(!item)return;try{await onImport(item);setPanel(null);}catch(error){onError(error.message);}}}/>
  </div>;
}
