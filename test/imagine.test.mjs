import test from 'node:test';
import assert from 'node:assert/strict';
import {imagineSelection,buildImaginePrompt,previousImaginePasses} from '../shared/imagine.mjs';
import {createCaptured,prepareAgentOperation,metadata} from '../src/browser-ai.mjs';
import {completeImagineReplacement,undoImagineReplacement} from '../src/imagine-operation.mjs';
import {createElements} from '../server/elements.mjs';
import {replaceSelectionSchema} from '../server/schemas.mjs';

const at='2026-10-28T18:00:00.000Z';
const note=(title,text,elementIds=[])=>({id:crypto.randomUUID(),title,text,elementIds,kind:'requirement',status:'open',createdAt:at,result:''});
function fixture(){
  const boardId=crypto.randomUUID(),connection={id:crypto.randomUUID(),boardId,connected:true,permission:'edit',automaticMessages:true};
  const items=createElements([
    {id:'index_page',type:'rectangle',x:0,y:0,width:960,height:720,backgroundColor:'#fcfcfa',strokeColor:'#718b64'},
    {id:'index_nav',type:'rectangle',x:24,y:24,width:912,height:64,text:'STUDIO        Work        About        Contact',fontSize:18,backgroundColor:'#e5eadc',strokeColor:'#275c46'},
    {id:'index_heading',type:'text',x:64,y:160,text:'Thoughtful design for everyday life',fontSize:40,strokeColor:'#275c46'},
    {id:'contact_sketch',type:'rectangle',x:1200,y:0,width:960,height:720,backgroundColor:'#fff'},
    {id:'contact_heading',type:'text',x:1250,y:100,text:'Contact me',fontSize:30},
    {id:'contact_form',type:'rectangle',x:1250,y:200,width:500,height:350,text:'Name\nEmail\nMessage\nSend'},
    {id:'unrelated',type:'rectangle',x:2500,y:900,width:100,height:100},
  ]);
  const record={id:boardId,board:{id:boardId,revision:1,elements:items,files:{},elementVersions:Object.fromEntries(items.map(e=>[e.id,1])),activity:[]},planning:{version:0,project:{title:'Studio website',areas:[],notes:[note('Index page styling','Sage navigation, cream surface, dark green text and generous 24px spacing.',['index_page'])]}},messages:[]};
  const message={id:crypto.randomUUID(),boardId,expectedRevision:1,expectedPlanningVersion:0,selectedIds:['contact_sketch','contact_heading','contact_form'],scope:'selection',text:buildImaginePrompt({instructions:'Make the contact page match my finished index page.'}),intent:'work',imagine:{designDirection:'Use the existing index page design system.',instructions:'A polished contact form.'},imagineReferences:{elementIds:items.filter(e=>e.id.startsWith('index_')).map(e=>e.id)}};
  const replacement={messageId:message.id,elements:[{id:'contact_surface',type:'rectangle',x:1200,y:0,width:960,height:720,backgroundColor:'#fcfcfa',strokeColor:'#718b64',corners:'sharp'},{id:'contact_nav',type:'rectangle',x:1224,y:24,width:912,height:64,text:'STUDIO        Work        About        Contact',fontSize:18,backgroundColor:'#e5eadc',strokeColor:'#275c46'},{id:'contact_title',type:'text',x:1264,y:160,text:'Let’s work together',fontSize:40,strokeColor:'#275c46'},{id:'contact_email',type:'rectangle',x:1264,y:270,width:600,height:56,text:'Your email address',fontSize:18,backgroundColor:'#ffffff',strokeColor:'#718b64'},{id:'contact_send',type:'rectangle',x:1264,y:580,width:180,height:48,text:'Send message',fontSize:18,backgroundColor:'#275c46',strokeColor:'#275c46',textColor:'#ffffff'}],designSummary:'Cream #fcfcfa surfaces, sage #e5eadc navigation, green #275c46 text/buttons, 18px labels, 40px headings, 24px spacing.'};
  return {record,connection,message,replacement};
}
function captureAndRead(f){createCaptured(f.record,f.message,'chat',f.connection,at);return prepareAgentOperation(f.record,'read_chat_message',{id:f.message.id},f.connection,at).result;}

test('Imagine selection closes nested frames and bound labels without deleting connected external arrows',()=>{
  const frame={id:'frame',type:'frame'},nested={id:'nested',type:'frame',frameId:'frame'},box={id:'box',type:'rectangle',frameId:'nested',boundElements:[{id:'label',type:'text'},{id:'arrow',type:'arrow'}]},label={id:'label',type:'text',containerId:'box'},arrow={id:'arrow',type:'arrow'};
  assert.deepEqual(imagineSelection([label,box,nested,frame,arrow],['frame']).map(e=>e.id).sort(),['box','frame','label','nested']);
  assert.deepEqual(imagineSelection([frame,box,label,arrow],[]),[]);
});

test('long Imagine memory cannot truncate user instructions or the atomic replacement and reply contract',()=>{
  const direction='d'.repeat(2000),instructions='i'.repeat(2000),previousPasses=Array.from({length:8},()=>({designSummary:'p'.repeat(2000)}));
  const prompt=buildImaginePrompt({designDirection:direction,instructions,previousPasses});
  assert.ok(prompt.length<=8000);assert.ok(prompt.includes(direction));assert.ok(prompt.includes(instructions));assert.match(prompt,/Use replace_selection/);assert.match(prompt,/reply_to_chat_message/);assert.match(prompt,/manually|drawn by hand/);
});

test('manual index-page design and its scoped requirements reach the immutable contact-page capture without entering replacement targets',()=>{
  const f=fixture(),read=captureAndRead(f);
  assert.ok(read.board.elements.every(e=>e.id.startsWith('contact_')));
  assert.ok(read.board.imagineReferences.elements.every(e=>e.id.startsWith('index_')));
  assert.match(read.board.planning.notes[0].text,/Sage navigation/);
  f.record.board.elements.find(e=>e.id==='index_nav').backgroundColor='#ff0000';
  assert.equal(read.board.imagineReferences.elements.find(e=>e.id==='index_nav').backgroundColor,'#e5eadc');
  assert.deepEqual(previousImaginePasses(f.record.board.elements),[],'handmade references do not require an earlier Imagine pass');
});

test('polished replacement preserves untouched manual design, uses clean editable fonts/colors/corners, and keeps one result for identical retries',()=>{
  const f=fixture();captureAndRead(f);
  const untouched=structuredClone(f.record.board.elements.filter(e=>e.id.startsWith('index_')));
  const prepared=prepareAgentOperation(f.record,'replace_selection',f.replacement,f.connection,at),created=prepared.changes.filter(change=>change.expectedVersion===0).map(change=>change.element);
  assert.ok(created.every(e=>e.roughness===0&&e.strokeWidth===1));assert.ok(created.filter(e=>e.type==='text').every(e=>e.fontFamily===2));
  assert.equal(created.find(e=>e.id==='contact_surface').roundness,null);assert.deepEqual(created.find(e=>e.id==='contact_send').roundness,{type:3});assert.equal(created.find(e=>e.id==='contact_send_label').strokeColor,'#ffffff');
  assert.ok(prepared.changes.every(change=>!change.id.startsWith('index_')));
  const result=completeImagineReplacement(f.record,prepared.imagine,2);assert.deepEqual(prepareAgentOperation(f.record,'replace_selection',f.replacement,f.connection,at).result,result);
  assert.deepEqual(f.record.board.elements.filter(e=>e.id.startsWith('index_')),untouched);
  assert.equal(metadata(f.record.messages[0]).imagine.fingerprint,undefined);
  assert.throws(()=>prepareAgentOperation(f.record,'replace_selection',{...f.replacement,designSummary:'Different result'},f.connection,at),error=>error.code==='IMAGINE_ALREADY_APPLIED');
  assert.ok(previousImaginePasses(created).length===1);
});

test('Imagine preserves requested text families for standalone text and bound labels without changing ordinary additions',()=>{
  const f=fixture();captureAndRead(f);
  const replacement={...f.replacement,elements:[
    {id:'hand_heading',type:'text',text:'Hand drawn heading',fontFamily:1},
    {id:'code_heading',type:'text',text:'Code heading',fontFamily:3},
    {id:'hand_button',type:'rectangle',text:'Hand drawn label',fontFamily:1},
    {id:'code_button',type:'rectangle',text:'Code label',fontFamily:3},
    {id:'default_heading',type:'text',text:'Default heading'},
  ]};
  const created=prepareAgentOperation(f.record,'replace_selection',replacement,f.connection,at).changes.filter(change=>change.expectedVersion===0).map(change=>change.element);
  for(const [id,family] of [['hand_heading',1],['code_heading',3],['hand_button_label',1],['code_button_label',3],['default_heading',2]])assert.equal(created.find(element=>element.id===id).fontFamily,family,id);
  assert.equal(created.find(element=>element.id==='hand_button').fontFamily,undefined,'text family does not add unsupported shape properties');
  assert.equal(createElements([{id:'ordinary_text',type:'text',text:'An ordinary addition',fontFamily:1}])[0].fontFamily,2,'ordinary add/edit behavior is unchanged');
  assert.equal(replaceSelectionSchema.safeParse({...replacement,elements:[{type:'text',text:'Unsupported family',fontFamily:99}]}).success,false);
});

test('selection, reference, image, and relevant requirement drift reject the complete replacement while unrelated edits survive',()=>{
  for(const [mutate,code] of [
    [f=>{f.record.board.elementVersions.contact_form++;},'IMAGINE_SELECTION_CHANGED'],
    [f=>{f.record.board.elementVersions.index_nav++;},'IMAGINE_REFERENCE_CHANGED'],
    [f=>{f.record.planning.project.notes[0].text='Change index branding to violet.';},'IMAGINE_REQUIREMENTS_CHANGED'],
    [f=>{f.record.planning.project.notes.push(note('Imagine design direction','New direction'));},'IMAGINE_DIRECTION_CHANGED'],
  ]){
    const f=fixture();captureAndRead(f);mutate(f);const before=structuredClone(f.record);
    assert.throws(()=>prepareAgentOperation(f.record,'replace_selection',f.replacement,f.connection,at),error=>error.code===code);assert.deepEqual(f.record,before);
  }
  const f=fixture();captureAndRead(f);f.record.board.elementVersions.unrelated++;f.record.board.elements.find(e=>e.id==='unrelated').x=3000;f.record.planning.project.notes.push(note('Unrelated card','Keep this separate.',['unrelated']));
  assert.ok(prepareAgentOperation(f.record,'replace_selection',f.replacement,f.connection,at).changes.length>0);
});

test('Imagine requires explicit read work request, same connection, current editable grant and bounded fresh IDs',()=>{
  const f=fixture();createCaptured(f.record,f.message,'chat',f.connection,at);
  assert.throws(()=>prepareAgentOperation(f.record,'replace_selection',f.replacement,f.connection,at),error=>error.code==='IMAGINE_CAPTURE_UNREAD');
  captureAndRead(f);
  assert.throws(()=>prepareAgentOperation(f.record,'replace_selection',f.replacement,{...f.connection,permission:'read'},at),error=>error.status===403);
  assert.throws(()=>prepareAgentOperation(f.record,'replace_selection',f.replacement,{...f.connection,id:crypto.randomUUID()},at),error=>error.code==='IMAGINE_REQUEST_SCOPE');
  assert.throws(()=>prepareAgentOperation(f.record,'replace_selection',{...f.replacement,elements:[{id:'index_page',text:'Overwrite'}]},f.connection,at),error=>error.code==='IMAGINE_ID_CONFLICT');
  assert.equal(replaceSelectionSchema.safeParse({...f.replacement,elements:[{id:'x'.repeat(123),text:'Too long for a label'}]}).success,false);
  assert.equal(replaceSelectionSchema.safeParse({...f.replacement,elements:[{id:'x'.repeat(122),text:'Valid label ID'}]}).success,true);
});

test('single-frame Imagine preserves its wrapper and external frame bindings, and partial replacements retain surviving frame/group membership',()=>{
  const f=fixture(),frame={id:'contact_frame',type:'frame',x:1200,y:0,width:960,height:720,version:1};f.record.board.elements.push(frame);f.record.board.elementVersions[frame.id]=1;
  for(const e of f.record.board.elements.filter(e=>e.id.startsWith('contact_')&&e.id!=='contact_frame'))e.frameId='contact_frame';
  const arrow={id:'external_arrow',type:'arrow',x:1000,y:300,width:100,height:0,endBinding:{elementId:frame.id,focus:0,gap:1}};f.record.board.elements.push(arrow);f.record.board.elementVersions[arrow.id]=1;
  f.message.selectedIds=[frame.id];captureAndRead(f);
  const result=prepareAgentOperation(f.record,'replace_selection',f.replacement,f.connection,at);
  assert.equal(result.changes.find(c=>c.id===frame.id).element.isDeleted,undefined);assert.equal(result.imagine.removedIds.includes(frame.id),false);assert.ok(result.changes.filter(c=>c.expectedVersion===0).every(c=>c.element.frameId===frame.id));assert.equal(result.changes.some(c=>c.id===arrow.id),false);
  const partial=fixture(),parent={id:'page',type:'frame'};partial.record.board.elements.push(parent);partial.record.board.elementVersions.page=1;for(const e of partial.record.board.elements.filter(e=>e.id.startsWith('contact_'))){e.frameId='page';e.groupIds=['contact_group'];}captureAndRead(partial);
  const changes=prepareAgentOperation(partial.record,'replace_selection',partial.replacement,partial.connection,at).changes;
  assert.ok(changes.filter(c=>c.expectedVersion===0).every(c=>c.element.frameId==='page'&&c.element.groupIds.includes('contact_group')));assert.equal(changes.some(c=>c.id==='page'),false);
});

test('undo removes only the pass memory it still owns and marks the result reverted while preserving newer human design notes',()=>{
  const f=fixture();captureAndRead(f);const prepared=prepareAgentOperation(f.record,'replace_selection',f.replacement,f.connection,at);completeImagineReplacement(f.record,prepared.imagine,2);
  const direction=f.record.planning.project.notes.find(n=>n.title==='Imagine design direction');direction.text='The human refined the direction after this pass.';
  undoImagineReplacement(f.record,prepared.imagine.undo,'2026-10-28T19:00:00.000Z');
  assert.equal(f.record.planning.project.notes.find(n=>n.title==='Imagine design direction').text,direction.text);assert.equal(f.record.planning.project.notes.some(n=>n.title==='Imagine design memory'),false);assert.equal(f.record.messages[0].imagine.result.undoneAt,'2026-10-28T19:00:00.000Z');
});
