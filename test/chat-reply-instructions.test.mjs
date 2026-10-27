import test from 'node:test';
import assert from 'node:assert/strict';
import {createMcpHandler} from '@modelcontextprotocol/server';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {createBoardMcp} from '../server/tools.mjs';

test('actual MCP discovery tells the model to complete every board reply, including Discuss batches',async()=>{
 const handler=createMcpHandler(()=>createBoardMcp(()=>assert.fail('Discovery must not execute board operations'),{remote:true,remotePair:true,proposals:false})),client=new Client({name:'board-reply-policy-test',version:'1'});
 try{
  await client.connect(new StreamableHTTPClientTransport(new URL('https://connector.example/mcp'),{fetch:(input,init)=>handler.fetch(new Request(input,init))}));
  const instructions=client.getInstructions(),listed=await client.listTools(),read=listed.tools.find(tool=>tool.name==='read_chat_message'),reply=listed.tools.find(tool=>tool.name==='reply_to_chat_message');
  assert.match(instructions,/before ending, send that ID's complete actual answer through reply_to_chat_message/);assert.match(instructions,/answer only in the AI conversation is not delivery to the board/);
  assert.match(instructions,/Discuss explicitly permits posting this board reply while forbidding drawing changes, code generation, and execution of work/);assert.match(instructions,/batch, complete each delivered captured ID separately/);assert.match(instructions,/read\/reading status or acknowledgement is not a reply/);assert.match(instructions,/If a real reply already exists, do not repeat its work or overwrite it/);assert.match(instructions,/Never fabricate canned answers, execution, or completion/);
  assert.match(read.description,/Inspect actual message.reply: skip only if a real reply exists/);assert.match(read.description,/for this same ID with reply_to_chat_message before ending/);assert.match(read.description,/AI-chat-only answer is not board delivery/);assert.match(read.description,/Discuss permits inspection, explanation, and posting that reply, but no drawing\/code work/);assert.match(read.description,/For batches, read and complete every delivered captured ID separately/);
  assert.match(reply.description,/complete actual user-facing answer/);assert.match(reply.description,/separate answer for each unanswered captured ID/);assert.match(reply.description,/Skip only an actual existing message.reply/);assert.equal(reply.annotations.destructiveHint,false);
 }finally{await client.close();await handler.close();}
});

test('captured MCP reads expose actual replies distinctly from a reading status for separate IDs',async()=>{
 const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'],calls=[];
 const messages=new Map([[ids[0],{id:ids[0],intent:'discuss',status:'reading',text:'First captured question'}],[ids[1],{id:ids[1],intent:'discuss',status:'reading',text:'Second captured question'}],[ids[2],{id:ids[2],intent:'discuss',status:'answered',text:'Earlier captured question',reply:'An actual earlier answer'}]]);
 const handler=createMcpHandler(()=>createBoardMcp(async(operation,input)=>{calls.push({operation,input});assert.equal(operation,'chat');return {message:messages.get(input.id),board:{revision:3,elements:[]}};},{remote:true,remotePair:true,proposals:false})),client=new Client({name:'board-reply-fields-test',version:'1'});
 try{
  await client.connect(new StreamableHTTPClientTransport(new URL('https://connector.example/mcp'),{fetch:(input,init)=>handler.fetch(new Request(input,init))}));
  const results=await Promise.all(ids.map(id=>client.callTool({name:'read_chat_message',arguments:{id}})));
  for(let index=0;index<2;index++){assert.equal(results[index].structuredContent.message.id,ids[index]);assert.equal(results[index].structuredContent.message.status,'reading');assert.equal(results[index].structuredContent.message.reply,undefined);}
  assert.equal(results[2].structuredContent.message.reply,'An actual earlier answer');assert.deepEqual(calls.map(call=>call.input.id).sort(),[...ids].sort());assert.ok(calls.every(call=>call.operation==='chat'),'reading does not post or imply a reply');
 }finally{await client.close();await handler.close();}
});
