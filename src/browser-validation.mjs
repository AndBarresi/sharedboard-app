// Created by Andrew Barresi: https://github.com/AndBarresi
// Copyright (c) 2026 Andrew Barresi
// Licensed under the MIT License. See LICENSE.
import * as z from 'zod/v4';

export const browserIdSchema=z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).refine(id=>!['__proto__','constructor','prototype'].includes(id));
const number=z.number().finite(),ids=z.array(browserIdSchema).max(10000);
export const browserElementSchema=z.object({id:browserIdSchema,type:z.string().max(50),x:number,y:number,width:number,height:number}).passthrough();
export const browserFilesSchema=z.record(browserIdSchema,z.object({id:browserIdSchema,dataURL:z.string().startsWith('data:image/').max(20_000_000),mimeType:z.string().max(100),created:number,lastRetrieved:number.optional()}).passthrough()).refine(files=>Object.entries(files).every(([id,file])=>file.id===id),'Image file IDs must match their saved keys');
export const browserPatchSchema=z.object({changes:z.array(z.object({id:browserIdSchema,expectedVersion:z.number().int().min(0),element:browserElementSchema}).refine(change=>change.id===change.element.id,'Object IDs must match')).max(10000),files:browserFilesSchema.optional(),summary:z.string().max(200).optional(),clientId:browserIdSchema.optional()}).refine(body=>new Set(body.changes.map(change=>change.id)).size===body.changes.length,'Duplicate object IDs');
export const browserProjectSchema=z.object({
 title:z.string().trim().min(1).max(100),
 areas:z.array(z.object({id:z.string().uuid(),name:z.string().trim().min(1).max(100),elementIds:ids,bounds:z.object({x:number,y:number,width:number.positive(),height:number.positive()})})).max(100),
 notes:z.array(z.object({id:z.string().uuid(),title:z.string().trim().min(1).max(160),text:z.string().max(8000),kind:z.enum(['note','requirement','task']),status:z.enum(['open','done']),elementIds:ids,createdAt:z.string().datetime(),result:z.string().max(8000).default('')})).max(300),
 library:z.array(z.object({id:z.string().uuid(),name:z.string().trim().min(1).max(100),elements:z.array(z.object({id:browserIdSchema}).passthrough()).max(300),files:z.record(z.string(),z.object({id:z.string(),dataURL:z.string().startsWith('data:image/').max(7_000_000),mimeType:z.string()}).passthrough())})).max(40),
});
export const browserBackupSchema=z.object({type:z.literal('sharedboard-project'),formatVersion:z.literal(1),board:z.object({elements:z.array(browserElementSchema),files:browserFilesSchema}),project:browserProjectSchema});
export function browserFailure(message,status=409,code){return Object.assign(new Error(message),{status,...(code?{code}:{})});}
export function validateBrowserProject(value){
 const project=browserProjectSchema.parse(value);
 for(const key of ['areas','notes','library'])if(new Set(project[key].map(item=>item.id)).size!==project[key].length)throw browserFailure('Project items must have unique IDs.',400);
 for(const block of project.library)validateImageReferences(block.elements,block.files);
 if(new TextEncoder().encode(JSON.stringify(project)).length>10_000_000)throw browserFailure('The project library is too large. Export large references separately.',413);
 return project;
}
export function validateBrowserBackup(value){
 const backup=browserBackupSchema.parse(value);backup.project=validateBrowserProject(backup.project);
 if(new Set(backup.board.elements.map(element=>element.id)).size!==backup.board.elements.length)throw browserFailure('Backup object IDs must be unique.',400);
 validateImageReferences(backup.board.elements,backup.board.files);
 return backup;
}
function validateImageReferences(elements,files){
 if(Object.entries(files).some(([id,file])=>id!==file.id)||elements.some(element=>!element.isDeleted&&element.type==='image'&&(!element.fileId||!files[element.fileId])))throw browserFailure('This backup or reusable block has missing or mismatched image files. The current board has been preserved.',400,'INVALID_IMAGE_FILES');
}
export function parseBrowserBody(body,{backup=false}={}){
 try{const value=typeof body==='string'?JSON.parse(body):body??{};if(!backup&&new TextEncoder().encode(JSON.stringify(value)).length>25_000_000)throw browserFailure('This board update is too large (25 MB maximum).',413);return value;}
 catch(error){if(error.status)throw error;throw browserFailure('Request must contain valid JSON.',400);}
}
export function normalizeBrowserError(error){
 if(error?.status)return error;
 if(error instanceof z.ZodError)return browserFailure('Invalid board operation. Check the requested data and try again.',400,'INVALID_BOARD_DATA');
 if(error?.name==='QuotaExceededError')return browserFailure('Browser storage is full. Your drawing is still open; export it before clearing storage or retrying.',507,'BROWSER_STORAGE_FULL');
 if(['AbortError','TransactionInactiveError','InvalidStateError'].includes(error?.name))return browserFailure('The browser could not finish saving. Keep this tab open and retry.',503,'BROWSER_STORAGE_WRITE_FAILED');
 return browserFailure('Browser storage could not be opened or saved. Keep this tab open and allow site storage, then retry.',503,'BROWSER_STORAGE_UNAVAILABLE');
}
export function validateBrowserVisual(value){
 if(typeof value!=='string'||value.length>4_000_000||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value)||!value.startsWith('data:image/png;base64,iVBORw0KGgo'))throw browserFailure('Expected a PNG visual preview.',400);
 return value;
}
