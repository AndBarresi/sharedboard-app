import React,{useEffect,useRef,useState} from 'react';
import {CaptureUpdateAction,restoreElements} from '@excalidraw/excalidraw';
import {Icon} from './Icons.jsx';
import {Modal} from './Modal.jsx';
import {ExtraDrawingTools} from './ExtraDrawingTools.jsx';
import {NATIVE_TOOLS,SHAPE_TOOLS,EXTRA_TOOLS,KEYBOARD_REFERENCE,gridUpdate,shortcutAction,typingTarget} from './drawing-tools.mjs';
const colors=['#26352e','#275c46','#718b64','#b56c43','#657c9b','#896284','#ffffff'];
const fills=['transparent','#e5eadc','#dff0e5','#fff0d9','#dce9f6','#eedfee','#ffffff'];
export function ShapesMenu({selected,onChoose,onClose}){
  const menu=useRef(null);
  useEffect(()=>{menu.current?.querySelector('[aria-checked="true"]')?.focus();},[]);
  const navigate=e=>{
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();onClose();return;}
    if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;
    e.preventDefault();e.stopPropagation();
    const items=[...menu.current.querySelectorAll('[role="menuitemradio"]')],index=items.indexOf(document.activeElement);
    const next=e.key==='Home'?0:e.key==='End'?items.length-1:(index+(e.key==='ArrowDown'?1:-1)+items.length)%items.length;
    items[next]?.focus();
  };
  return <div ref={menu} className="dock-panel more-tools-panel shapes-panel" role="menu" aria-label="Shapes" onKeyDown={navigate}><p className="eyebrow" role="presentation">SHAPES</p>{SHAPE_TOOLS.map(([type,icon,label,key])=><button type="button" role="menuitemradio" key={type} aria-checked={selected===type} tabIndex={selected===type?0:-1} onClick={()=>onChoose(type)}><Icon name={icon}/><span>{label}<small>{type==='rectangle'?'Hold Shift for a square':type==='ellipse'?'Hold Shift for a circle':'Drag to set the proportions'}</small></span><kbd>{key}</kbd></button>)}<p role="presentation">Choose a shape, then drag on the canvas.</p></div>;
}
export function DrawingToolbar({getApi,ui,focused,onFullscreen,onChat,chatDisabled=false,chatUnavailableReason='',onConnect,onReview,reviewDisabled,reviewUnavailableReason='',onImagine,imagineDisabled=false,imagineUnavailableReason='',onExport,onImport,onError,onPlanner,onReference,onChangelog,onExportProject,onImportProject,onWorkspace,onNavigator,browserOnly=false,onStorageDetails}){
  const [panel,setPanel]=useState(null),[help,setHelp]=useState(false),[extraTool,setExtraTool]=useState(null),[helpSearch,setHelpSearch]=useState(''),[lastShape,setLastShape]=useState(()=>SHAPE_TOOLS.some(([type])=>type===ui.tool)?ui.tool:'rectangle'),[portrait,setPortrait]=useState(()=>typeof window!=='undefined'&&window.matchMedia('(orientation:portrait)').matches);const root=useRef(null);const file=useRef(null);
  const callbacks=useRef({});callbacks.current={getApi,onFullscreen,onExport,onExportProject,onPlanner,onNavigator};
  const toggleGrid=()=>{const api=getApi();if(api)api.updateScene({appState:gridUpdate(api.getAppState())});};
  useEffect(()=>{const orientation=window.matchMedia('(orientation:portrait)'),changed=()=>setPortrait(orientation.matches);changed();orientation.addEventListener('change',changed);return()=>orientation.removeEventListener('change',changed);},[]);
  useEffect(()=>{
    const close=e=>{if(!root.current?.contains(e.target))setPanel(null);};
    const key=e=>{
      const actions=callbacks.current,api=actions.getApi(),state=api?.getAppState()??{};
      // Let dialogs and text editors own their keys, including literal S and G.
      if(document.querySelector('dialog[open]'))return;
      const action=shortcutAction(e,state);
      if(!action){
        if(!typingTarget(e.target,state)&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&/^[vrdoalptihefk1-9]$/i.test(e.key))setExtraTool(null);
        return;
      }
      if(action==='close'){setPanel(null);setExtraTool(null);return;}
      e.preventDefault();e.stopImmediatePropagation();
      if(action==='style'){api?.updateScene({appState:{openPopup:null}});setPanel(value=>value==='style'?null:'style');}
      if(action==='help'){setPanel(null);setHelp(true);}
      if(action==='grid'&&api)api.updateScene({appState:gridUpdate(state)});
      if(action==='find')actions.onPlanner('areas');
      if(action==='objects')actions.onNavigator();
      if(action==='export')actions.onExport();
      if(action==='backup')actions.onExportProject();
      if(action==='import')file.current?.click();
      if(action==='fullscreen')actions.onFullscreen();
      if(action==='embeddable'){setExtraTool(null);api?.setActiveTool({type:'embeddable'});setPanel(null);}
      if(['recognize','bucket','lasso'].includes(action)){api?.setActiveTool({type:'selection'});if(action!=='lasso')api?.updateScene({appState:{selectedElementIds:{},selectedGroupIds:{}}});setExtraTool(action);setPanel(null);}
    };
    document.addEventListener('pointerdown',close);document.addEventListener('keydown',key,true);
    return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',key,true);};
  },[]);
  useEffect(()=>{if(ui.tool!=='selection')setExtraTool(null);if(SHAPE_TOOLS.some(([type])=>type===ui.tool))setLastShape(ui.tool);},[ui.tool]);
  const button=(name,label,onClick,active=false,disabled=false,title=label,extra={})=><button type="button" key={label} className={`tool-button ${active?'active':''}`} aria-label={label} title={title} onClick={onClick} aria-pressed={active} disabled={disabled} {...extra}><Icon name={name}/></button>;
  const choose=type=>{const api=getApi();if(!api)return;const custom=['recognize','bucket','lasso'].includes(type);setExtraTool(custom?type:null);api.setActiveTool(type==='image'?{type,insertOnCanvasDirectly:true}:{type:custom?'selection':type});if(custom&&type!=='lasso')api.updateScene({appState:{selectedElementIds:{},selectedGroupIds:{}}});setPanel(null);};
  const history=redo=>{const el=document.querySelector('.canvas-shell .excalidraw'),mac=/Mac|iPhone|iPad/.test(navigator.platform);el?.focus();el?.dispatchEvent(new KeyboardEvent('keydown',{key:'z',code:'KeyZ',ctrlKey:!mac,metaKey:mac,shiftKey:redo,bubbles:true,cancelable:true}));};
  const zoom=direction=>{const api=getApi();if(!api)return;const s=api.getAppState(), value=Math.min(5,Math.max(.1,s.zoom.value*direction));const cx=s.width/2/s.zoom.value-s.scrollX,cy=s.height/2/s.zoom.value-s.scrollY;api.updateScene({appState:{zoom:{value},scrollX:s.width/2/value-cx,scrollY:s.height/2/value-cy}});};
  const fit=()=>{const api=getApi();if(api)api.scrollToContent(api.getSceneElements(),{fitToViewport:true,viewportZoomFactor:.8,minZoom:.05,maxZoom:1});};
  const style=(key,value)=>{
    const api=getApi();if(!api)return;const s=api.getAppState();const defaults={strokeColor:'currentItemStrokeColor',backgroundColor:'currentItemBackgroundColor',strokeWidth:'currentItemStrokeWidth',fontSize:'currentItemFontSize',fontFamily:'currentItemFontFamily',roughness:'currentItemRoughness'};
    const ids=new Set(Object.keys(s.selectedElementIds).filter(id=>s.selectedElementIds[id]));
    if(['strokeColor','fontSize','fontFamily'].includes(key))for(const e of api.getSceneElements())if(ids.has(e.id))for(const b of e.boundElements??[])if(b.type==='text')ids.add(b.id);
    let elements=api.getSceneElementsIncludingDeleted().map(e=>ids.has(e.id)&&(!['fontSize','fontFamily'].includes(key)||e.type==='text')?{...e,[key]:value,version:e.version+1,versionNonce:Math.floor(Math.random()*2147483647),updated:Date.now()}:e);
    if(key==='fontSize'||key==='fontFamily')elements=restoreElements(elements,null,{refreshDimensions:true,repairBindings:true,normalizeIndices:true});
    api.updateScene({elements,appState:{[defaults[key]]:value},captureUpdate:CaptureUpdateAction.IMMEDIATELY});
  };
  return <div className="drawing-dock" ref={root} onPointerDown={e=>e.stopPropagation()}>
    <div className="shared-toolbar" role="toolbar" aria-label="Drawing tools" aria-orientation={portrait?'vertical':'horizontal'}>
      {button('menu','Board menu',()=>setPanel(panel==='menu'?null:'menu'),panel==='menu')}
      <span className="tool-divider"/>
      <div className="tool-scroll">{NATIVE_TOOLS.map(([type,icon,label,key])=>SHAPE_TOOLS.some(([shape])=>shape===type)?type==='rectangle'?button(SHAPE_TOOLS.find(([shape])=>shape===lastShape)[1],'Shapes',()=>setPanel(panel==='shapes'?null:'shapes'),panel==='shapes'||!extraTool&&SHAPE_TOOLS.some(([shape])=>shape===ui.tool),false,'Shapes · rectangle, diamond, ellipse',{'aria-haspopup':'menu','aria-expanded':panel==='shapes',onKeyDown:e=>{if(e.key==='ArrowDown'){e.preventDefault();e.stopPropagation();setPanel('shapes');}}}):null:button(icon,`${label} (${key})`,()=>choose(type),!extraTool&&ui.tool===type))}</div>
      {button('laser','Laser pointer (K)',()=>choose('laser'),ui.tool==='laser')}
      {button('more','More tools',()=>setPanel(panel==='tools'?null:'tools'),panel==='tools'||Boolean(extraTool)||['frame','embeddable'].includes(ui.tool))}
      <span className="tool-divider"/>
      {button('palette','Drawing style',()=>setPanel(panel==='style'?null:'style'),panel==='style',false,'Drawing style (S)')}
      {button('undo','Undo',()=>history(false))}{button('redo','Redo',()=>history(true))}
      <span className="tool-divider"/>
      {onImagine&&button('imagine','Imagine selection',()=>{setPanel(null);setExtraTool(null);getApi()?.setActiveTool({type:'selection'});onImagine();},false,imagineDisabled,imagineDisabled?imagineUnavailableReason||'Select something to imagine':'Imagine selection')}
      {button('review','Ask AI to look',onReview,false,reviewDisabled,reviewDisabled?reviewUnavailableReason||'Board review unavailable for this connection':'Ask AI to look')}
      {focused&&button('chat','Open board chat',()=>{if(!chatDisabled)onChat();},false,chatDisabled,chatDisabled?chatUnavailableReason||'Mini chat unavailable for this connection':'Open board chat')}
      {button(focused?'collapse':'expand',focused?'Exit full screen':'Full screen',()=>{setPanel(null);onFullscreen();},focused)}
      {button('info','Info & keyboard shortcuts',()=>{setPanel(null);setHelp(true);},help,false,'Info & keyboard shortcuts (?)')}
    </div>
    {panel==='shapes'&&<ShapesMenu selected={lastShape} onChoose={type=>{setLastShape(type);choose(type);root.current?.querySelector('[aria-label="Shapes"]')?.focus();}} onClose={()=>{setPanel(null);root.current?.querySelector('[aria-label="Shapes"]')?.focus();}}/>}
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
      <button className="menu-history-entry" onClick={()=>history(false)}><Icon name="undo"/> Undo <kbd>Ctrl/⌘ Z</kbd></button>
      <button className="menu-history-entry" onClick={()=>history(true)}><Icon name="redo"/> Redo <kbd>Ctrl/⌘ Shift Z</kbd></button>
      <button onClick={()=>{onExportProject();setPanel(null);}}><Icon name="download"/> Download board backup</button>
      <button onClick={()=>{onImportProject();setPanel(null);}}><Icon name="history"/> Restore board backup</button>
      <button onClick={()=>{onExport();setPanel(null);}}><Icon name="download"/> Export drawing (.excalidraw)</button>
      <button onClick={()=>file.current.click()}><Icon name="image"/> Import drawing</button>
      {focused&&<button onClick={()=>{onConnect();setPanel(null);}}><Icon name="review"/>{browserOnly?'AI connection':'AI connection'}</button>}
      {browserOnly&&<button onClick={()=>{onStorageDetails?.();setPanel(null);}}><Icon name="lock"/> Browser storage</button>}
      <button onClick={()=>{onReference();setPanel(null);}}><Icon name="image"/> Add screenshot reference</button>
      <button className="menu-review-entry" disabled={reviewDisabled} title={reviewDisabled?reviewUnavailableReason:undefined} onClick={()=>{setPanel(null);onReview();}}><Icon name="review"/> Ask AI to look</button>
      <button aria-pressed={Boolean(ui.gridModeEnabled)} onClick={toggleGrid}><Icon name="grid"/> Alignment grid <span className="menu-state">{ui.gridModeEnabled?'On':'Off'}</span></button>
      {focused&&<button onClick={()=>{onChangelog();setPanel(null);}}><Icon name="history"/> What’s new</button>}
      <small>Drawing engine by Excalidraw · MIT</small>
    </div>}
    {panel==='tools'&&<div className="dock-panel more-tools-panel" role="region" aria-label="More drawing tools"><p className="eyebrow">MORE DRAWING TOOLS</p>{EXTRA_TOOLS.map(([type,icon,label,key])=><button type="button" key={type} aria-pressed={extraTool===type||ui.tool===type} onClick={()=>choose(type)}><Icon name={icon}/><span>{label}</span>{key&&<kbd>{key}</kbd>}</button>)}<p>Draw to shape recognizes rectangles, ellipses, diamonds and straight lines. Bucket fill colors closed shapes.</p></div>}
    {panel==='style'&&<div className="dock-panel style-panel" role="region" aria-label="Drawing style">
      <p className="eyebrow">{ui.selected?'STYLE THE SELECTION':'STYLE YOUR NEXT MARK'}</p>
      <label>Stroke</label><div className="swatches">{colors.map(color=><button key={color} title={`Stroke ${color}`} aria-label={`Stroke ${color}`} className={ui.stroke===color?'chosen':''} style={{background:color}} onClick={()=>style('strokeColor',color)}/>)}<input aria-label="Custom stroke color" type="color" value={ui.stroke||colors[0]} onChange={e=>style('strokeColor',e.target.value)}/></div>
      <label>Fill</label><div className="swatches">{fills.map(color=><button key={color} title={`Fill ${color}`} aria-label={`Fill ${color}`} className={`${ui.fill===color?'chosen':''} ${color==='transparent'?'no-fill':''}`} style={{background:color}} onClick={()=>style('backgroundColor',color)}/>)}</div>
      <div className="style-fields"><label>Line weight<select aria-label="Line weight" value={ui.strokeWidth||2} onChange={e=>style('strokeWidth',Number(e.target.value))}><option value="1">Fine</option><option value="2">Regular</option><option value="4">Bold</option></select></label><label>Text size<select aria-label="Text size" value={ui.fontSize||20} onChange={e=>style('fontSize',Number(e.target.value))}>{[12,16,20,28,36,48].map(v=><option key={v} value={v}>{v} px</option>)}</select></label></div>
      <label>Text font<select aria-label="Text font" value={ui.fontFamily||2} onChange={e=>style('fontFamily',Number(e.target.value))}><option value="2">Sans serif</option><option value="1">Hand drawn</option><option value="3">Monospace</option></select></label>
      <label>Finish<select aria-label="Drawing finish" value={ui.roughness??1} onChange={e=>style('roughness',Number(e.target.value))}><option value="0">Clean</option><option value="1">Sketch</option><option value="2">Loose</option></select></label>
    </div>}
    <ExtraDrawingTools tool={extraTool} getApi={getApi} root={root} onError={onError}/>
    {help&&<Modal title="Info & keyboard shortcuts" subtitle="A quick reference for your shared canvas." wide onClose={()=>setHelp(false)}><div className="keyboard-reference"><p>Use <kbd>Ctrl</kbd> on Windows and Linux, or <kbd>⌘</kbd> on Mac wherever you see <kbd>Mod</kbd>. Shortcuts stay out of the way while you type.</p><label className="keyboard-search">Find a shortcut<input value={helpSearch} onChange={e=>setHelpSearch(e.target.value)} placeholder="Search tools, selection, zoom…" type="search"/></label>{KEYBOARD_REFERENCE.map(([heading,items])=>{const found=items.filter(([label,keys])=>`${heading} ${label} ${keys}`.toLowerCase().includes(helpSearch.toLowerCase()));return found.length?<section key={heading}><h3>{heading}</h3><dl>{found.map(([label,keys])=><div key={label}><dt>{label}</dt><dd><kbd>{keys}</kbd></dd></div>)}</dl></section>:null;})}{!KEYBOARD_REFERENCE.some(([heading,items])=>items.some(([label,keys])=>`${heading} ${label} ${keys}`.toLowerCase().includes(helpSearch.toLowerCase())))&&<p role="status">No shortcuts match “{helpSearch}”.</p>}<p className="keyboard-footnote">The canvas saves your drawing automatically. Web embeds support YouTube, Vimeo, Figma, StackBlitz, Val Town, Giphy, SimplePDF and Excalidraw links. On Mac, use Mod+Alt+[ or ] to send to back or bring to front.</p></div></Modal>}
    <input ref={file} type="file" accept=".excalidraw,application/json" hidden onChange={async e=>{const item=e.target.files?.[0];e.target.value='';if(!item)return;try{await onImport(item);setPanel(null);}catch(error){onError(error.message);}}}/>
  </div>;
}
