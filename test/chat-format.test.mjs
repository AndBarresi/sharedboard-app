import test from 'node:test';
import assert from 'node:assert/strict';
import {safeChatHref,inlineChatTokens,parseChatMarkdown,chatStorageKey,isPreparedContextStale,hasSelectionContextChanged,serializePendingChat,isAcceptedChatMessage} from '../src/chat-format.mjs';
test('chat links allow explicit web URLs and reject executable, local, disguised, credentialed and control-character destinations',()=>{
  assert.equal(safeChatHref('https://example.com/docs?q=a%20b'),'https://example.com/docs?q=a%20b');
  for(const url of ['javascript:alert(1)','data:text/html,hi','file:///C:/private.txt','//example.com',' https://example.com','https://exam\nple.com','https://user:secret@example.com','https:\\example.com','vbscript:msgbox(1)'])assert.equal(safeChatHref(url),null,url);
  const tokens=inlineChatTokens('[run](javascript:alert(1)) [safe](https://example.com) <img src=x onerror=alert(1)>');
  assert.deepEqual(tokens.filter(t=>t.type==='link').map(t=>t.href),['https://example.com/']);
  assert.ok(tokens.some(t=>t.type==='text'&&t.text.includes('<img')));
  assert.equal(inlineChatTokens('![private](https://example.com/pixel)').filter(t=>t.type==='link').length,0,'Markdown images never fetch remote content');
});
test('chat Markdown keeps code literal, handles unclosed fences, and renders useful planning blocks',()=>{
  const parsed=parseChatMarkdown('# Plan\n\n1. Read the screen\n2. Keep the data\n\n```js\n<img onerror="run()">\nconst url = "javascript:bad";\n```\n\n| File | Change |\n| --- | --- |\n| app.jsx | Header |\n\n> Confirm the intent\n\n**Preserve** `balance` and [docs](https://example.com).');
  assert.deepEqual(parsed.map(b=>b.type),['heading','list','code','table','quote','paragraph']);
  assert.equal(parsed[1].ordered,true);assert.equal(parsed[1].items.length,2);
  assert.equal(parsed[2].text,'<img onerror="run()">\nconst url = "javascript:bad";');assert.equal(parsed[2].closed,true);
  assert.equal(parsed[3].rows[0][0],'app.jsx');
  assert.equal(parseChatMarkdown('```sh\necho safe')[0].text,'echo safe');
  assert.equal(parseChatMarkdown('```sh\necho safe')[0].closed,false);
});
test('bare URLs preserve surrounding punctuation without granting other schemes link behavior',()=>{
  const tokens=inlineChatTokens('See https://example.com/path. Then https://example.com/a_(b).');
  assert.deepEqual(tokens.filter(t=>t.type==='link').map(t=>t.text),['https://example.com/path','https://example.com/a_(b)']);
});
test('board-scoped drafts stay separate and a preview becomes stale when drawing or planning changes',()=>{
  assert.notEqual(chatStorageKey('board-a','draft'),chatStorageKey('board-b','draft'));
  const captured={boardId:'board-a',expectedRevision:7,expectedPlanningVersion:2};
  assert.equal(isPreparedContextStale(captured,{id:'board-a',revision:7},{version:2}),false);
  assert.equal(isPreparedContextStale(captured,{id:'board-b',revision:7},{version:2}),true);
  assert.equal(isPreparedContextStale(captured,{id:'board-a',revision:8},{version:2}),true);
  assert.equal(isPreparedContextStale(captured,{id:'board-a',revision:7},{version:3}),true);
  assert.equal(hasSelectionContextChanged({...captured,scope:'selection',selectedIds:['b','a']},['a','b']),false);
  assert.equal(hasSelectionContextChanged({...captured,scope:'selection',selectedIds:['a']},['b']),true);
  assert.equal(hasSelectionContextChanged({...captured,scope:'board',selectedIds:[]},['b']),false);
});
test('large attachments retain the original retry identity without filling per-board browser storage',()=>{
  const pending={id:'same-request',text:'Inspect this',intent:'discuss',boardId:'board-a',capturedContext:{visual:'x'.repeat(1_000_000)}};
  const stored=JSON.parse(serializePendingChat(pending));assert.equal(stored.id,pending.id);assert.equal(stored.text,pending.text);assert.equal(stored.attachmentNotStored,true);assert.equal(stored.capturedContext,undefined);
});

test('pending, failed, and uncertain delivery never acknowledge a draft merely because automatic support was selected',()=>{
 for(const delivery of ['pending','failed','uncertain']){
  const attempted={id:'same-request',delivery,receipt:'attempted-event',handoffPrompt:'Old copied instructions',automaticMessages:true};
  assert.equal(isAcceptedChatMessage(attempted),false,delivery);
 }
 const failedHandoff={id:'same-request',delivery:'failed',deliveryError:'The subscription expired and the handoff could not be prepared'};
 assert.equal(isAcceptedChatMessage(failedHandoff),false,'a failed fallback retains the pending request and draft');
 for(const receipt of [undefined,null,false,true,{},[],0,'','   ',{provider:'codex-cli'},{queueMessageId:'unknown-provider'},{provider:'codex-cli',queueMessageId:'  '}])assert.equal(isAcceptedChatMessage({delivery:'queued',receipt}),false);
 for(const handoffPrompt of [undefined,null,true,{},'','   '])assert.equal(isAcceptedChatMessage({delivery:'manual',handoffPrompt}),false);
 assert.equal(isAcceptedChatMessage(null),false);
});

test('only a confirmed receipt, prepared manual instructions, or an actual reply acknowledges a chat request',()=>{
 assert.equal(isAcceptedChatMessage({delivery:'queued',receipt:'evt_confirmed'}),true);
 assert.equal(isAcceptedChatMessage({delivery:'queued',receipt:{provider:'codex-cli',queueMessageId:'stored-queue-message'}}),true);
 assert.equal(isAcceptedChatMessage({delivery:'manual',handoffPrompt:'Read the captured request with its original ID'}),true);
 assert.equal(isAcceptedChatMessage({delivery:'uncertain',reply:'The actual assistant answer returned to this board'}),true,'an actual answer proves completion despite earlier delivery uncertainty');
 assert.equal(isAcceptedChatMessage({status:'answered',reply:'  '}),false,'a label alone is not an actual reply');
});
