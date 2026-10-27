import React,{useEffect,useRef} from 'react';
import {Icon} from './Icons.jsx';
export function Modal({title,subtitle,onClose,children,wide=false}){
  const dialog=useRef(null);
  useEffect(()=>{const node=dialog.current,previous=document.activeElement;node.showModal();node.querySelector('input:not([type="file"]),textarea,select')?.focus();const cancel=e=>{e.preventDefault();onClose();};node.addEventListener('cancel',cancel);return()=>{node.removeEventListener('cancel',cancel);node.close();previous?.focus?.();};},[]);
  return <dialog ref={dialog} className={`sb-modal ${wide?'wide':''}`} aria-label={title} onClick={e=>{if(e.target===dialog.current)onClose();}} onKeyDown={e=>e.stopPropagation()}><div className="modal-inner"><header className="modal-header"><div><p className="eyebrow">SHAREDBOARD</p><h2>{title}</h2>{subtitle&&<p>{subtitle}</p>}</div><button type="button" className="icon-button" aria-label={`Close ${title}`} onClick={onClose}><Icon name="close"/></button></header><div className="modal-body">{children}</div></div></dialog>;
}
