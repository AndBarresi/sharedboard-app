import test from 'node:test';
import assert from 'node:assert/strict';
import {panelStatus,panelOperation,queuePanelRequest,clearPanel} from '../cloudflare/panel-state.mjs';
import {hash} from '../cloudflare/protocol.mjs';

const copy=value=>value===undefined?undefined:structuredClone(value);
class MemoryStorage{
 values=new Map();tail=Promise.resolve();
 async get(key){await this.tail;return copy(this.values.get(key));}
 async put(key,value){await this.tail;this.values.set(key,copy(value));}
 async delete(key){await this.tail;return this.values.delete(key);}
 transaction(operation){
  const result=this.tail.then(async()=>{const draft=new Map([...this.values].map(([key,value])=>[key,copy(value)])),transaction={get:async key=>copy(draft.get(key)),put:async(key,value)=>{draft.set(key,copy(value));},delete:async key=>draft.delete(key)};const value=await operation(transaction);this.values=draft;return copy(value);});
  this.tail=result.catch(()=>{});return result;
 }
}
const boardId='00000000-0000-4000-8000-000000000001',connectionId='00000000-0000-4000-8000-000000000002',familyId='00000000-0000-4000-8000-000000000003';
const id=index=>`00000000-0000-4000-8000-${String(index).padStart(12,'0')}`;
function fixture(){
 let now=Date.parse('2026-10-27T12:00:00Z'),counter=0;const storage=new MemoryStorage(),options={storage,boardId,connectionId,familyId,label:'Synthetic connected chat',permission:'read',now:()=>now,randomSecret:()=>String(++counter).padStart(64,'0')};
 const operation=(name,input)=>panelOperation(name,input,options),queue=input=>queuePanelRequest(input,options),advance=amount=>{now+=amount;};return {storage,options,operation,queue,advance,now:()=>now};
}
const open=f=>f.operation('open');
const attach=(f,view)=>f.operation('attach',{viewKey:view.viewKey});
const state=(f,view)=>f.operation('state',{viewKey:view.viewKey});
const request=index=>({id:id(index),kind:'chat',intent:'discuss'});

test('panel views expose their secret only on open and persist hashed, scoped routing metadata',async()=>{
 const f=fixture();assert.deepEqual(await panelStatus(f.options),{linked:false,expiresAt:null});
 const view=await open(f);assert.match(view.viewKey,/^[a-f0-9]{64}$/);assert.equal(view.linked,false);assert.equal(view.boardId,boardId);assert.equal(view.connectionId,connectionId);assert.deepEqual(view.pending,[]);
 const linked=await attach(f,view);assert.equal(linked.linked,true);assert.equal(linked.label,f.options.label);assert.equal(linked.permission,'read');assert.equal(Date.parse(linked.expiresAt),f.now()+30000);assert.equal(linked.viewKey,undefined);
 const input={...request(10),text:'DO NOT STORE THIS MESSAGE BODY',visual:'DO NOT STORE THIS DRAWING',reply:'DO NOT STORE THIS ANSWER'},queued=await f.queue(input);assert.match(queued.receipt,/^panel_[a-f0-9]{64}$/);
 const pending=await state(f,view);assert.deepEqual(pending.pending,[{...request(10),status:'pending',delivery:'panel'}]);assert.equal(pending.viewKey,undefined);
 const serialized=JSON.stringify([...f.storage.values]);assert.equal(serialized.includes(view.viewKey),false);assert.equal(serialized.includes('DO NOT STORE'),false);assert.equal(serialized.includes(await hash(view.viewKey)),true);assert.equal(serialized.includes(boardId),true);assert.equal(serialized.includes(connectionId),true);assert.equal(serialized.includes(familyId),true);
});

test('invalid keys and another board, connection or authorization family cannot inspect, attach, claim or confirm a view',async()=>{
 const f=fixture(),view=await open(f);await attach(f,view);const queued=await f.queue(request(11));
 for(const viewKey of [undefined,'bad','f'.repeat(64)])for(const operation of ['state','attach','detach','claim','confirm'])await assert.rejects(f.operation(operation,{viewKey,id:id(11),kind:'chat',receipt:queued.receipt}),error=>error.status===403&&error.code==='PANEL_VIEW_INVALID');
 for(const override of [{boardId:id(100)},{connectionId:id(101)},{familyId:id(102)}]){
  const other={...f.options,...override};assert.equal((await panelStatus(other)).linked,false);
  for(const operation of ['state','attach','detach','claim','confirm'])await assert.rejects(panelOperation(operation,{viewKey:view.viewKey,id:id(11),kind:'chat',receipt:queued.receipt},other),error=>error.status===403);
  await clearPanel(other);assert.equal((await panelStatus(f.options)).linked,true);
 }
 assert.equal((await state(f,view)).pending.length,1);
});

test('state renews a live owner lease but status never renews it and an expired lease needs explicit attach',async()=>{
 const f=fixture(),view=await open(f);await attach(f,view);await f.queue(request(12));f.advance(20000);const renewed=await state(f,view);assert.equal(Date.parse(renewed.expiresAt),f.now()+30000);
 f.advance(20000);const status=await panelStatus(f.options);assert.equal(status.linked,true);assert.equal(status.expiresAt,renewed.expiresAt);
 f.advance(10001);assert.deepEqual(await panelStatus(f.options),{linked:false,expiresAt:null});assert.equal((await state(f,view)).linked,false);assert.deepEqual((await state(f,view)).pending,[]);await assert.rejects(f.queue(request(13)),error=>error.code==='PANEL_NOT_LINKED');await assert.rejects(f.operation('claim',{viewKey:view.viewKey,id:id(12),kind:'chat'}),error=>error.code==='PANEL_NOT_LINKED');
 const reattached=await attach(f,view);assert.equal(reattached.linked,true);assert.equal(reattached.pending[0].id,id(12),'explicitly relinking the same view may resume its still-unclaimed request');
});

test('view lifetime is bounded to one hour and at most four unexpired views exist',async()=>{
 const f=fixture(),views=[];for(let index=0;index<4;index++)views.push(await open(f));await assert.rejects(open(f),error=>error.status===429&&error.code==='PANEL_VIEW_LIMIT');
 await attach(f,views[0]);for(let index=0;index<179;index++){f.advance(20000);assert.equal((await state(f,views[0])).linked,true);}f.advance(19999);const last=await state(f,views[0]);assert.equal(Date.parse(last.expiresAt),Date.parse('2026-10-27T13:00:00Z'));
 f.advance(1);assert.equal((await panelStatus(f.options)).linked,false);await assert.rejects(state(f,views[0]),error=>error.code==='PANEL_VIEW_INVALID');assert.match((await open(f)).viewKey,/^[a-f0-9]{64}$/);
});

test('changing the active view starts a new generation without inheriting old pending requests or receipts',async()=>{
 const f=fixture(),a=await open(f),b=await open(f);await attach(f,a);const old=await f.queue(request(20));assert.equal((await state(f,a)).pending.length,1);
 const next=await attach(f,b);assert.equal(next.linked,true);assert.deepEqual(next.pending,[]);assert.equal((await state(f,a)).linked,false);await assert.rejects(f.queue(request(20)),error=>error.code==='PANEL_REQUEST_REPLACED');await assert.rejects(f.operation('claim',{viewKey:b.viewKey,id:id(20),kind:'chat'}),error=>error.code==='PANEL_REQUEST_REPLACED');await assert.rejects(f.operation('confirm',{viewKey:b.viewKey,receipt:old.receipt}),error=>error.code==='PANEL_RECEIPT_INVALID');
 await f.queue(request(21));await f.operation('detach',{viewKey:a.viewKey});assert.equal((await state(f,b)).linked,true,'an old view cannot detach the active conversation');const returned=await attach(f,a);assert.deepEqual(returned.pending,[]);await assert.rejects(f.operation('claim',{viewKey:a.viewKey,id:id(21),kind:'chat'}),error=>error.code==='PANEL_REQUEST_REPLACED');assert.deepEqual((await attach(f,a)).pending,[],'reattaching the same owner does not create another generation');
});

test('parallel claims forward a pending request once and repeated queue calls never requeue claimed or delivered requests',async()=>{
 const f=fixture(),view=await open(f);await attach(f,view);const input={id:id(30),kind:'chat',intent:'work'},queued=await f.queue(input);assert.deepEqual(await f.queue(input),queued);
 const claims=await Promise.allSettled([f.operation('claim',{viewKey:view.viewKey,id:input.id,kind:input.kind}),f.operation('claim',{viewKey:view.viewKey,id:input.id,kind:input.kind})]);assert.equal(claims.filter(result=>result.status==='fulfilled').length,1);assert.equal(claims.find(result=>result.status==='rejected').reason.code,'PANEL_REQUEST_CLAIMED');const claim=claims.find(result=>result.status==='fulfilled').value;
 assert.equal(claim.receipt,queued.receipt);assert.match(claim.prompt,/read_chat_message/);assert.match(claim.prompt,new RegExp(input.id));assert.match(claim.prompt,new RegExp(boardId));assert.match(claim.prompt,/reply_to_chat_message/);assert.equal(claim.viewKey,undefined);assert.deepEqual(claim.pending,[]);
 assert.deepEqual(await f.queue(input),queued);assert.deepEqual((await state(f,view)).pending,[]);await assert.rejects(f.queue({...input,intent:'discuss'}),error=>error.code==='PANEL_REQUEST_CONFLICT');await assert.rejects(f.queue({...input,kind:'review',intent:'discuss'}),error=>error.code==='PANEL_REQUEST_CONFLICT');
 const confirmed=await f.operation('confirm',{viewKey:view.viewKey,receipt:claim.receipt});assert.equal(confirmed.linked,true);assert.deepEqual(confirmed.pending,[]);assert.deepEqual(await f.operation('confirm',{viewKey:view.viewKey,receipt:claim.receipt}),confirmed);assert.deepEqual(await f.queue(input),queued);await assert.rejects(f.operation('claim',{viewKey:view.viewKey,id:input.id,kind:'chat'}),error=>error.code==='PANEL_REQUEST_CLAIMED');
});

test('confirmation requires a claimed receipt in the same active view generation and reviews stay inspection-only',async()=>{
 const f=fixture(),view=await open(f);await attach(f,view);const review={id:id(40),kind:'review',intent:'discuss'},queued=await f.queue(review);await assert.rejects(f.operation('confirm',{viewKey:view.viewKey,receipt:queued.receipt}),error=>error.code==='PANEL_RECEIPT_INVALID');
 const claimed=await f.operation('claim',{viewKey:view.viewKey,id:review.id,kind:'review'});assert.match(claimed.prompt,/read_review_request/);assert.match(claimed.prompt,/complete_review_request/);assert.match(claimed.prompt,/Inspect and explain only/);
 await assert.rejects(f.queue({...review,id:id(41),intent:'work'}),error=>error.code==='PANEL_REQUEST_INVALID');await assert.rejects(f.operation('confirm',{viewKey:view.viewKey,receipt:'unknown-receipt'}),error=>error.code==='PANEL_RECEIPT_INVALID');await f.operation('detach',{viewKey:view.viewKey});assert.equal((await panelStatus(f.options)).linked,false);await assert.rejects(f.operation('confirm',{viewKey:view.viewKey,receipt:claimed.receipt}),error=>error.code==='PANEL_NOT_LINKED');
 await attach(f,view);assert.equal((await f.operation('confirm',{viewKey:view.viewKey,receipt:claimed.receipt})).linked,true);const other=await open(f);await attach(f,other);await assert.rejects(f.operation('confirm',{viewKey:other.viewKey,receipt:claimed.receipt}),error=>error.code==='PANEL_RECEIPT_INVALID');
});

test('durable pending metadata survives module callers and capacity limits never forget a claimed request ID',async()=>{
 const f=fixture(),view=await open(f);await attach(f,view);for(let index=100;index<200;index++)await f.queue(request(index));assert.equal((await state(f,view)).pending.length,100);await assert.rejects(f.queue(request(200)),error=>error.code==='PANEL_REQUEST_LIMIT');
 const caller={...f.options};assert.equal((await panelOperation('state',{viewKey:view.viewKey},caller)).pending.length,100);const first=await f.operation('claim',{viewKey:view.viewKey,id:id(100),kind:'chat'});await f.operation('confirm',{viewKey:view.viewKey,receipt:first.receipt});assert.equal((await state(f,view)).pending.length,99);await assert.rejects(f.queue(request(200)),error=>error.code==='PANEL_REQUEST_LIMIT');assert.deepEqual(await f.queue(request(100)),{receipt:first.receipt});
 await clearPanel(f.options);assert.equal(f.storage.values.size,0);assert.deepEqual(await panelStatus(f.options),{linked:false,expiresAt:null});await assert.rejects(state(f,view),error=>error.code==='PANEL_VIEW_INVALID');await assert.rejects(f.queue(request(201)),error=>error.code==='PANEL_NOT_LINKED');
});

test('a lease expiring during asynchronous receipt hashing cannot accept a late queue item',async()=>{
 const f=fixture(),view=await open(f);await attach(f,view);await assert.rejects(queuePanelRequest(request(300),{...f.options,hash:async value=>{f.advance(30001);return hash(value);}}),error=>error.code==='PANEL_NOT_LINKED');assert.deepEqual((await state(f,view)).pending,[]);
});
