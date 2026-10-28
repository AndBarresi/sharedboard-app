// Copyright (c) 2026 Andrew Barresi. SPDX-License-Identifier: MIT
import {nativeChatAwaitingReply} from './chat-format.mjs';
import {miniChatState} from '../shared/client-profiles.mjs';
import {imagineSelection} from '../shared/imagine.mjs';

export function imagineAvailability(view) {
  if (!view.connection?.connected || !view.agentConnected) return {enabled:false,connect:true,reason:'Connect your AI conversation to imagine this selection.'};
  if (view.connection.permission !== 'edit') return {enabled:false,connect:true,reason:'Imagine needs a connection with drawing edits allowed.'};
  if (!view.online || ['error','offline','conflict'].includes(view.status)) return {enabled:false,reason:'Wait for the drawing to save and resolve any overlapping edits first.'};
  const route=miniChatState(view.chatConnected?view.connection:null);
  if (!route.enabled) return {enabled:false,connect:true,reason:route.reason};
  if (nativeChatAwaitingReply(view.messages,view.connection)) return {enabled:false,reason:'Let your AI finish the current request before starting another Imagine pass.'};
  return {enabled:true};
}

export function savedImagineDirection(view) {
  const notes=view.planning?.project.notes??[];
  const note=notes.find(note=>note.title==='Imagine design direction'&&note.status==='open'&&!note.elementIds?.length);
  if (note) return note.text;
  return [...(view.messages??[])].reverse().find(message=>message.imagine?.designDirection&&message.imagine.result&&!message.imagine.result.undoneAt)?.imagine.designDirection??'';
}

export function imagineRoleSelection(elements=[],selectedIds=[],{role='reference',referenceIds=[]}={}) {
  const active=new Set(elements.filter(element=>!element.isDeleted).map(element=>element.id));
  if(!selectedIds.length)return {error:'Drag to select objects on the board, or use an existing selection.'};
  if(selectedIds.some(id=>!active.has(id)))return {error:'That selection changed. Select its current objects on the board.'};
  const selected=imagineSelection(elements,selectedIds),ids=selected.map(element=>element.id),chosen=new Set(ids);
  if(role==='reference')return ids.length<=500?{ids}:{error:'Select a smaller reference with up to 500 objects.'};
  if(!referenceIds.length||referenceIds.some(id=>!active.has(id)))return {error:'The reference changed or was removed. Go back and select it again.'};
  if(referenceIds.some(id=>chosen.has(id)))return {error:'The reference and wireframe overlap. Select only the objects you want Imagine to change.'};
  const frames=selected.filter(element=>['frame','magicframe'].includes(element.type)&&!chosen.has(element.frameId));
  const parents=new Set(selected.filter(element=>!element.containerId&&!chosen.has(element.frameId)).map(element=>element.frameId??null));
  if(frames.length>1||!frames.length&&parents.size>1)return {error:'Imagine one page frame at a time, or select objects within the same page.'};
  return {ids};
}
