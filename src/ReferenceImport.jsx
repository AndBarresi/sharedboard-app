import React,{useState} from 'react';
import {convertToExcalidrawElements} from '@excalidraw/excalidraw';
import {Modal} from './Modal.jsx';
import {viewport,applyElements} from './canvas-actions.mjs';
export function ReferenceImport({getApi,onClose}){
  const [file,setFile]=useState(null),[name,setName]=useState('Current reference'),[busy,setBusy]=useState(false),[error,setError]=useState(null);
  const add=async event=>{event.preventDefault();if(!file)return;setBusy(true);setError(null);try{
    if(!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type)||file.size>7_000_000)throw new Error('Choose a PNG, JPEG, WebP or GIF smaller than 7 MB.');
    const dataURL=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Could not open this image.'));reader.readAsDataURL(file);});
    const dimensions=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve({width:img.naturalWidth,height:img.naturalHeight});img.onerror=()=>reject(new Error('This image could not be read.'));img.src=dataURL;});
    const api=getApi(),v=viewport(api),id=crypto.randomUUID(),fileId=crypto.randomUUID(),scale=Math.min(1,850/dimensions.width);
    const base=convertToExcalidrawElements([{type:'rectangle',x:v.x+80,y:v.y+120,width:dimensions.width*scale,height:dimensions.height*scale}])[0];
    const image={...base,id,type:'image',fileId,status:'saved',scale:[1,1],crop:null,locked:true};
    const title=convertToExcalidrawElements([{type:'text',x:image.x,y:image.y-45,text:name.trim()||'Current reference',fontFamily:2,fontSize:24,strokeColor:'#275c46'}]);
    api.addFiles([{id:fileId,dataURL,mimeType:file.type,created:Date.now(),lastRetrieved:Date.now()}]);
    applyElements(api,[...api.getSceneElementsIncludingDeleted(),...title,image],[]);api.scrollToContent([...title,image],{fitToViewport:true,viewportZoomFactor:.7,maxZoom:1});onClose();
  }catch(e){setError(e.message);}finally{setBusy(false);}};
  return <Modal title="Add a screenshot reference" subtitle="Pin the current app, then sketch the changes over it." onClose={onClose}><form className="planner-form" onSubmit={add}><label>Reference name<input autoFocus value={name} maxLength={100} onChange={e=>setName(e.target.value)}/></label><label>Screenshot<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" required onChange={e=>setFile(e.target.files?.[0]??null)}/></label><p className="muted">The image is saved with your board and pinned against accidental dragging. Use the References list to select or unlock it later. You can also paste ordinary images directly onto the canvas.</p>{error&&<p className="planner-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={!file||busy}>{busy?'Adding…':'Add pinned reference'}</button></div></form></Modal>;
}
