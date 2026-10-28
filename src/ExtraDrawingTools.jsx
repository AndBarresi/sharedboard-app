import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {convertToExcalidrawElements,restoreElements,CaptureUpdateAction} from '@excalidraw/excalidraw';
import {bucketElements,frameForShape,lassoIds,recognizeStroke,scenePoint} from './drawing-tools.mjs';

// These tools deliberately create ordinary editable Excalidraw objects. No
// private editor internals or separate canvas storage are involved.
export function ExtraDrawingTools({tool,getApi,root,onError,onFinish}){
  const [trail,setTrail]=useState([]),[shell,setShell]=useState(null);
  const space=useRef(false);
  useEffect(()=>{
    const host=root.current?.closest('.canvas-shell');setShell(host);
    if(!host||!tool)return;
    let drag=null;
    const point=e=>scenePoint(e,getApi().getAppState(),host.getBoundingClientRect());
    const screen=e=>({x:e.clientX-host.getBoundingClientRect().left,y:e.clientY-host.getBoundingClientRect().top});
    const stop=e=>{e.preventDefault();e.stopImmediatePropagation();};
    const down=e=>{
      if(e.button!==0||space.current||!e.target.closest?.('.excalidraw canvas'))return;
      const api=getApi();if(!api||api.getAppState().viewModeEnabled)return;
      stop(e);
      if(tool==='bucket'){
        const state=api.getAppState(),color=state.currentItemBackgroundColor==='transparent'?'#e5eadc':state.currentItemBackgroundColor;
        const elements=bucketElements(api.getSceneElementsIncludingDeleted(),point(e),color);
        if(elements){api.updateScene({elements,appState:{currentItemBackgroundColor:color},captureUpdate:CaptureUpdateAction.IMMEDIATELY});}
        else onError?.('Click inside a closed shape to fill it.');
        return;
      }
      drag={id:e.pointerId,points:[point(e)],shift:e.shiftKey,selected:{...api.getAppState().selectedElementIds}};
      host.setPointerCapture(e.pointerId);setTrail([screen(e)]);
    };
    const move=e=>{
      if(!drag||drag.id!==e.pointerId)return;
      stop(e);const next=point(e),last=drag.points.at(-1);
      if(Math.hypot(next.x-last.x,next.y-last.y)<1/getApi().getAppState().zoom.value)return;
      drag.points.push(next);setTrail(values=>[...values,screen(e)]);
    };
    const finish=e=>{
      if(!drag||drag.id!==e.pointerId)return;
      stop(e);const current=drag;drag=null;setTrail([]);
      if(host.hasPointerCapture(e.pointerId))host.releasePointerCapture(e.pointerId);
      if(e.type==='pointercancel')return;
      const api=getApi();if(!api)return;
      current.points.push(point(e));
      if(tool==='lasso'){
        const ids=lassoIds(api.getSceneElements(),current.points),selectedElementIds=current.shift?{...current.selected}:{};
        for(const id of ids)selectedElementIds[id]=true;
        api.updateScene({appState:{selectedElementIds,selectedGroupIds:{}}});
      }else{
        const shape=recognizeStroke(current.points);if(!shape)return;
        const state=api.getAppState();
        const elements=convertToExcalidrawElements([{...shape,frameId:frameForShape(api.getSceneElements(),shape),...(shape.type==='freedraw'?{id:crypto.randomUUID(),pressures:[],simulatePressure:true}:{}),strokeColor:state.currentItemStrokeColor,backgroundColor:state.currentItemBackgroundColor,fillStyle:state.currentItemFillStyle,strokeWidth:state.currentItemStrokeWidth,strokeStyle:state.currentItemStrokeStyle,roughness:0,opacity:state.currentItemOpacity}]);
        api.updateScene({elements:restoreElements([...api.getSceneElementsIncludingDeleted(),...elements],null,{repairBindings:true,normalizeIndices:true}),captureUpdate:CaptureUpdateAction.IMMEDIATELY});
      }
      onFinish?.();
    };
    const keyDown=e=>{if(e.code==='Space')space.current=true;if(e.key==='Escape'){drag=null;setTrail([]);}};
    const keyUp=e=>{if(e.code==='Space')space.current=false;};
    const blur=()=>{space.current=false;drag=null;setTrail([]);};
    host.dataset.extraTool=tool;
    host.addEventListener('pointerdown',down,true);host.addEventListener('pointermove',move,true);host.addEventListener('pointerup',finish,true);host.addEventListener('pointercancel',finish,true);
    window.addEventListener('keydown',keyDown,true);window.addEventListener('keyup',keyUp,true);window.addEventListener('blur',blur);
    return()=>{
      if(drag&&host.hasPointerCapture(drag.id))host.releasePointerCapture(drag.id);
      delete host.dataset.extraTool;setTrail([]);
      host.removeEventListener('pointerdown',down,true);host.removeEventListener('pointermove',move,true);host.removeEventListener('pointerup',finish,true);host.removeEventListener('pointercancel',finish,true);
      window.removeEventListener('keydown',keyDown,true);window.removeEventListener('keyup',keyUp,true);window.removeEventListener('blur',blur);
    };
  },[tool,getApi,root,onError,onFinish]);
  if(!shell||!tool)return null;
  return createPortal(<><svg className="extra-tool-overlay" aria-hidden="true"><polyline points={trail.map(p=>`${p.x},${p.y}`).join(' ')} fill={tool==='lasso'?'#718b6418':'none'} stroke="#275c46" strokeWidth="1.5" strokeDasharray={tool==='lasso'?'5 4':undefined}/></svg><p className="extra-tool-hint" role="status">{tool==='lasso'?'Draw around objects to select · Shift adds · Esc exits':tool==='bucket'?'Click a closed shape to fill · Choose color in Drawing style · Esc exits':'Draw a rectangle, ellipse, diamond or line · Esc exits'}</p></>,shell);
}
