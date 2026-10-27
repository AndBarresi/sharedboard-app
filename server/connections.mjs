import {shellQuote} from '../shared/shell-quote.mjs';
import {existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, statSync} from 'node:fs';
import path from 'node:path';
import {randomBytes,randomUUID,createHash,timingSafeEqual} from 'node:crypto';

const digest=value=>createHash('sha256').update(value).digest('hex');
const failure=(message,status=403)=>Object.assign(new Error(message),{status});
const equal=(a,b)=>{const x=Buffer.from(a??''),y=Buffer.from(b??'');return x.length===y.length&&timingSafeEqual(x,y);};
const names={codex:'Codex',claude:'Claude Code',cursor:'Cursor',other:'Other MCP app','chatgpt-web':'ChatGPT','claude-web':'Claude'};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const permissions=new Set(['read','propose','edit']);
const checkPermission=permission=>{if(!permissions.has(permission))throw failure('Choose read-only, propose changes, or edit access on the board.',400);};
export function findCodexExecutable(previous,{env=process.env,platform=process.platform}={}){
  const candidates=[env.CODEX_CLI_PATH,previous];
  for(const entry of (env.PATH??'').split(path.delimiter))candidates.push(path.join(entry,platform==='win32'?'codex.exe':'codex'));
  if(platform==='win32'&&env.LOCALAPPDATA){const root=path.join(env.LOCALAPPDATA,'OpenAI','Codex','bin');try{const dirs=readdirSync(root).filter(d=>!d.startsWith('.')).sort((a,b)=>statSync(path.join(root,b)).mtimeMs-statSync(path.join(root,a)).mtimeMs);for(const d of dirs)candidates.push(path.join(root,d,'codex.exe'));}catch{}}
  return candidates.find(p=>p&&path.isAbsolute(p)&&/^codex(?:\.exe)?$/i.test(path.basename(p))&&existsSync(p)&&statSync(p).isFile())??null;
}

export class ConnectionStore {
  constructor(directory,{boardId,projectRoot,now=()=>Date.now(),findExecutable=findCodexExecutable}={}){
    this.directory=directory;this.boardId=boardId;this.projectRoot=projectRoot;this.now=now;this.findExecutable=findExecutable;
    mkdirSync(directory,{recursive:true});this.filename=path.join(directory,'ai-connection.json');this.pairFile=path.join(directory,'.pairing.json');this.attempts=[];
    this.current=existsSync(this.filename)?JSON.parse(readFileSync(this.filename,'utf8')):null;
    // Temporary web authorizations live only in the running connector session.
    if(this.current?.deliveryMode==='app'){this.current={id:randomUUID(),provider:'disconnected'};this.save();this.write(path.join(directory,'agent-target.json'),{provider:'disconnected'});}
    this.challenge=existsSync(this.pairFile)?JSON.parse(readFileSync(this.pairFile,'utf8')):null;
    // Preserve the already chosen prototype chat without publishing its identity or path.
    if(!this.current){try{const old=JSON.parse(readFileSync(path.join(directory,'agent-target.json'),'utf8'));if(uuid.test(old.threadId)&&old.codexPath&&existsSync(old.codexPath)){this.current={id:randomUUID(),provider:'codex',label:old.label||'This Codex chat',permission:'edit',threadId:old.threadId,codexPath:old.codexPath,legacy:true,connectedAt:new Date(this.now()).toISOString()};this.save();}}catch{}}
  }
  write(file,value){writeFileSync(`${file}.tmp`,JSON.stringify(value,null,2),{mode:0o600,encoding:'utf8',flush:true});renameSync(`${file}.tmp`,file);}
  save(){this.write(this.filename,this.current);}
  status(){const c=this.current,connected=Boolean(c&&c.provider!=='disconnected');return {connected,id:connected?c.id:null,provider:connected?c.provider:null,label:connected?c.label:'No AI connected',permission:connected?c.permission:null,deliveryMode:connected?c.deliveryMode??'local':null,automaticMessages:connected&&c.provider==='codex'&&Boolean(c.codexPath),boardCheckedAt:connected?c.boardCheckedAt??null:null,deliveryCheckedAt:connected?c.deliveryCheckedAt??null:null,replyCheckedAt:connected?c.replyCheckedAt??null:null,connectedAt:connected?c.connectedAt:null,pairingExpiresAt:this.challenge?.expiresAt>this.now()?new Date(this.challenge.expiresAt).toISOString():null};}
  begin({provider,permission}){
    checkPermission(permission);
    const code=randomBytes(16).toString('hex');this.challenge={id:randomUUID(),hash:digest(code),provider,permission,expiresAt:this.now()+10*60*1000};this.write(this.pairFile,this.challenge);
    return {code,provider,permission,expiresAt:new Date(this.challenge.expiresAt).toISOString()};
  }
  cancel(){this.challenge=null;this.write(this.pairFile,null);}
  pair({code,threadId,label}){
    this.attempts=this.attempts.filter(t=>t>this.now()-60000);if(this.attempts.length>=8)throw failure('Too many pairing attempts. Wait a minute and create a new code.',429);this.attempts.push(this.now());
    const p=this.challenge;
    if(!p||p.expiresAt<=this.now()||!equal(digest(code),p.hash))throw failure('That pairing code is invalid or expired. Create a new one in SharedBoard.app.');
    if(p.provider==='codex'&&(!threadId||!uuid.test(threadId)))throw failure('Use the real ID of this existing Codex chat. The local helper can read CODEX_THREAD_ID automatically.',400);
    if(threadId)threadId=threadId.toLowerCase();
    const key=randomBytes(32).toString('hex'),previous=this.current;
    const codexPath=p.provider==='codex'?this.findExecutable(previous?.codexPath):null;
    this.current={id:randomUUID(),provider:p.provider,label:label||`My ${names[p.provider]} ${p.provider==='codex'?'chat':'connection'}`,permission:p.permission,keyHash:digest(key),connectedAt:new Date(this.now()).toISOString(),...(p.provider==='codex'?{threadId,codexPath}:{})};
    this.save();
    this.write(path.join(this.directory,'agent-target.json'),p.provider==='codex'&&codexPath?{provider:'codex-cli',threadId,codexPath,label:this.current.label,connectionId:this.current.id}:{provider:'manual',connectionId:this.current.id});
    this.cancel();this.attempts=[];
    return {connection:this.status(),agentKey:key,instructions:'Read the board now, then call confirm_connection with the exact revision you read. Keep using this existing conversation. Do not create a new AI chat.'};
  }
  authorize({key,threadId},write=false){
    const c=this.current;if(!c||c.provider==='disconnected')throw failure('Connect this AI using a pairing code from SharedBoard.app first.');
    const granted=key&&c.keyHash&&equal(digest(key),c.keyHash);
    const legacy=c.legacy&&threadId&&threadId===c.threadId;
    if(!granted&&!legacy)throw failure('This AI connection was replaced or disconnected. Pair this chat again from SharedBoard.app.');
    if(![false,true,'read','propose','edit'].includes(write))throw failure('Unknown board access operation.',400);
    if(write==='propose'&&!['propose','edit'].includes(c.permission))throw failure('This AI has read-only board access and cannot submit drawing proposals. Choose propose changes or edit access in SharedBoard.app.');
    if((write===true||write==='edit')&&c.permission!=='edit')throw failure(c.permission==='propose'?'This AI can propose drawing changes only. Submit a proposal for the user to review and accept on the board.':'This AI has read-only board access. Change the connection permission in SharedBoard.app to allow drawing edits.');
    return c;
  }
  recordRead(auth,revision){this.authorize(auth);this.current.lastReadRevision=revision;this.save();}
  confirm(auth,revision,currentRevision){this.authorize(auth);if(revision!==currentRevision||this.current.lastReadRevision!==revision)throw failure('Read the current board first, then confirm the exact revision you read.',409);this.current.boardCheckedAt=new Date(this.now()).toISOString();this.save();return this.status();}
  mark(type,connectionId){if(this.current&&this.current.provider!=='disconnected'&&connectionId===this.current.id){this.current[type]=new Date(this.now()).toISOString();this.save();}}
  disconnect(){this.current={id:randomUUID(),provider:'disconnected'};this.save();this.write(path.join(this.directory,'agent-target.json'),{provider:'disconnected'});this.cancel();return this.status();}
  connectWeb({provider,permission}){
    checkPermission(permission);
    const key=randomBytes(32).toString('hex');
    this.current={id:randomUUID(),provider,label:`My ${names[provider]} connection`,permission,keyHash:digest(key),connectedAt:new Date(this.now()).toISOString(),deliveryMode:'app'};
    this.save();this.cancel();this.write(path.join(this.directory,'agent-target.json'),{provider:'app',connectionId:this.current.id});
    return {connection:this.status(),key};
  }
  setup(provider,code){
    const name=`sharedboard-${this.boardId.slice(0,8)}`;
    const entry={type:'stdio',command:process.execPath,args:[path.join(this.projectRoot,'server','mcp.mjs')],env:{WHITEBOARD_DATA_DIR:this.directory,WHITEBOARD_CLIENT_ID:`${name}-${provider}`}};
    const config=JSON.stringify({mcpServers:{[name]:entry}},null,2);
    const quote=s=>`'${s.replaceAll("'","'\\''")}'`;
    const psQuote=s=>`'${s.replaceAll("'","''")}'`;
    const helper=`${process.platform==='win32'?'& ':''}${(process.platform==='win32'?psQuote:quote)(process.execPath)} ${(process.platform==='win32'?psQuote:quote)(path.join(this.projectRoot,'server','agent-cli.mjs'))} --data-dir ${(process.platform==='win32'?psQuote:quote)(this.directory)}`;
    const cli=`${helper} pair ${code}`;
    const prompt=provider==='codex'?[
      'Connect this existing Codex conversation to my local SharedBoard.app. Do not start a new chat or change the drawing.',
      'Run this command in the local shell. The helper reads this conversation ID from CODEX_THREAD_ID; do not guess a chat ID:',cli,
      `Then read the board with ${helper} read, and confirm with ${helper} confirm <revision>. Keep the same --data-dir option for later read, review, chat, reply, and drawing operations; it selects this board. Explain whether automatic message delivery is available.`,
      'Keep this connection for future board reviews, drawing changes I request, and replies to the mini chat.'
    ].join('\n\n'):[
      `Connect this existing ${names[provider]} conversation to my local SharedBoard.app using its installed MCP tools. Do not create a new chat or change the drawing.`,
      `Call connect_board with {"code":"${code}"}. Then read_board and confirm_connection using the exact revision you read.`,
      'Use the existing conversation for future requests. Board access is available through MCP. SharedBoard.app messages use Copy to AI for manual handoff; this connector does not automatically wake this chat.',
      'When handling a copied board message, read_chat_message and reply_to_chat_message send the answer back into the board.'
    ].join('\n\n');
    return {prompt,config,transport:'stdio',instructions:provider==='cursor'?'Add or merge this server entry in .cursor/mcp.json using Cursor’s MCP settings. Keep your other entries.':provider==='claude'?'Add or merge this server entry in your Claude Code .mcp.json, then approve it in /mcp. Keep your other entries.':'Add or merge this local server entry in your AI app’s MCP settings. Keep your other entries.',links:{codex:'https://learn.chatgpt.com/docs/developer-commands',claude:'https://code.claude.com/docs/en/mcp',cursor:'https://cursor.com/docs/mcp'}};
  }
}

export function manualHandoff(kind,record,projectRoot,dataDir){
  const dataOption=dataDir?` --data-dir ${shellQuote(dataDir)}`:'';
  const message=kind==='review'?`Please review my SharedBoard.app drawing in this existing conversation. Call read_review_request with {"id":"${record.id}"}, inspect the captured snapshot, then complete_review_request with your summary. Inspection only; no drawing or code changes are authorized. Do not create a new chat.`:[`Please handle my SharedBoard.app message in this existing conversation. Call read_chat_message with {"id":"${record.id}"} to read my typed message and captured board.`,record.intent==='work'?'I selected Request work. Perform only the work I actually ask for; read the live board before edits.':'I selected Discuss. Inspect and explain only; do not make changes.',`Post your actual answer back with reply_to_chat_message using {"id":"${record.id}","text":"your answer"}. If already answered, do not repeat the work. Do not create another chat.`].join('\n\n');
  return message+(projectRoot?`\n\nIf the MCP tools are unavailable and you have local shell access, the equivalent helper is "${path.join(projectRoot,'server','agent-cli.mjs')}". Run it with Node.js using${dataOption} ${kind==='review'?'review':'chat'} ${record.id}, then ${kind==='review'?'complete_review':'reply'} <json-file>. The JSON contains id and ${kind==='review'?'summary':'text'}. Respect the same inspection / work intent.`:'');
}
