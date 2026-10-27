import { readFile,writeFile,mkdir } from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import { callBoard } from './agent-client.mjs';

const args=process.argv.slice(2);
let dataDir=process.env.WHITEBOARD_DATA_DIR??fileURLToPath(new URL('../data/',import.meta.url));
if(args[0]==='--data-dir'){if(!args[1])throw new Error('Pass a board data directory after --data-dir.');dataDir=path.resolve(args[1]);args.splice(0,2);}
const [operation = 'read', filename] = args;
const call=(op,body)=>callBoard(op,body,{dataDir});
try {
  if(operation==='snapshot'){
    if(!filename)throw new Error('Pass a destination PNG path.');
    const result=await call('visual');if(!result.available)throw new Error(result.message);await writeFile(filename,Buffer.from(result.visual.dataURL.split(',')[1],'base64'));console.log(JSON.stringify({path:filename,revision:result.visual.revision,latestRevision:result.latestRevision,stale:result.stale}));process.exit(0);
  }
  if (!['read', 'read_full', 'add', 'edit','propose', 'reviews', 'review', 'complete_review', 'chats', 'chat', 'reply','pair','connection','confirm'].includes(operation)) throw new Error('Use read, read_full, add, edit, propose <json-file>, snapshot <png-path>, reviews, review <id>, complete_review <json-file>, chats, chat <id>, reply <json-file>, pair <code>, connection, or confirm <revision>.');
  let body;
  if(operation==='pair'){if(!filename)throw new Error('Copy a pairing code from SharedBoard.app.');body={code:filename,...(process.env.CODEX_THREAD_ID?{threadId:process.env.CODEX_THREAD_ID}:{})};}
  if(operation==='confirm'){const revision=Number(filename);if(!filename||!Number.isSafeInteger(revision)||revision<0)throw new Error('Pass the exact revision from read.');body={revision};}
  if (operation === 'review' || operation === 'chat') {
    if (!filename) throw new Error('Pass the review request ID.');
    body = { id: filename };
  }
  if (operation === 'add' || operation === 'edit' || operation === 'propose' || operation === 'complete_review' || operation === 'reply') {
    if (filename) body = JSON.parse(await readFile(filename, 'utf8'));
    else {
      let input = '';
      for await (const chunk of process.stdin) input += chunk;
      body = JSON.parse(input);
    }
  }
  const result=await call(operation,body);
  if(result.board?.visual?.dataURL){const directory=path.join(dataDir,'captures');await mkdir(directory,{recursive:true});const imagePath=path.join(directory,`${body.id}.png`);await writeFile(imagePath,Buffer.from(result.board.visual.dataURL.split(',')[1],'base64'));const {dataURL,...metadata}=result.board.visual;result.board.visual={...metadata,imagePath,instructions:'Inspect this captured PNG with your image-viewing tool alongside the structured drawing and requirements.'};}
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(JSON.stringify({ error: error.message, status: error.status, details: error.details }));
  process.exitCode = 1;
}
