// A deliberately small Markdown grammar. Content is rendered as React text;
// HTML, image loading, and executable URL schemes are never enabled.
export function safeChatHref(value){
  if(typeof value!=='string'||!/^https?:\/\//i.test(value)||/[\u0000-\u0020\u007f]/.test(value))return null;
  try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}catch{return null;}
}
function trimUrl(raw){
  let value=raw.replace(/[.,!?;:]+$/,'');
  while(value.endsWith(')')&&(value.match(/\)/g)?.length??0)>(value.match(/\(/g)?.length??0))value=value.slice(0,-1);
  return value;
}
export function inlineChatTokens(source){
  const text=String(source??''),tokens=[],pattern=/`([^`\n]+)`|\[([^\]\n]+)\]\(([^)\n]+)\)|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|https?:\/\/[^\s<>]+/gi;
  let last=0,match;
  while((match=pattern.exec(text))){
    if(match.index>last)tokens.push({type:'text',text:text.slice(last,match.index)});
    const [raw,code,label,href,strong,emphasis]=match;
    if(code!==undefined)tokens.push({type:'code',text:code});
    else if(label!==undefined){const safe=safeChatHref(href);tokens.push(safe&&text[match.index-1]!=='!'?{type:'link',text:label,href:safe}:{type:'text',text:raw});}
    else if(strong!==undefined)tokens.push({type:'strong',text:strong});
    else if(emphasis!==undefined)tokens.push({type:'emphasis',text:emphasis});
    else{const trimmed=trimUrl(raw),safe=safeChatHref(trimmed);tokens.push(safe?{type:'link',text:trimmed,href:safe}:{type:'text',text:trimmed});if(trimmed.length<raw.length)tokens.push({type:'text',text:raw.slice(trimmed.length)});}
    last=pattern.lastIndex;
  }
  if(last<text.length)tokens.push({type:'text',text:text.slice(last)});
  return tokens;
}
function tableCells(line){return line.trim().replace(/^\|/,'').replace(/\|$/,'').split(/(?<!\\)\|/).map(cell=>cell.trim().replace(/\\\|/g,'|'));}
const tableDivider=line=>/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
const listLine=line=>/^\s*(?:([-+*])|\d+\.)\s+(.+)$/.exec(line);
export function parseChatMarkdown(source){
  const lines=String(source??'').replace(/\r\n?/g,'\n').split('\n'),blocks=[];
  let i=0;
  const isBoundary=index=>/^\s*(`{3,}|~{3,})/.test(lines[index])||/^#{1,6}\s+/.test(lines[index])||/^\s*>/.test(lines[index])||Boolean(listLine(lines[index]))||/^\s*(?:---+|\*\*\*+)\s*$/.test(lines[index])||(index+1<lines.length&&lines[index].includes('|')&&tableDivider(lines[index+1]));
  while(i<lines.length){
    const line=lines[i];if(!line.trim()){i++;continue;}
    const fence=/^\s*(`{3,}|~{3,})(.*)$/.exec(line);
    if(fence){const marker=fence[1][0],length=fence[1].length,body=[];let closed=false;i++;while(i<lines.length){const end=/^\s*(`{3,}|~{3,})\s*$/.exec(lines[i]);if(end&&end[1][0]===marker&&end[1].length>=length){closed=true;i++;break;}body.push(lines[i++]);}blocks.push({type:'code',language:fence[2].trim().replace(/[^\w.+#-]/g,'').slice(0,32),text:body.join('\n'),closed});continue;}
    const heading=/^(#{1,6})\s+(.+)$/.exec(line);if(heading){blocks.push({type:'heading',level:heading[1].length,text:heading[2]});i++;continue;}
    if(/^\s*(?:---+|\*\*\*+)\s*$/.test(line)){blocks.push({type:'separator'});i++;continue;}
    if(i+1<lines.length&&line.includes('|')&&tableDivider(lines[i+1])){const headers=tableCells(line).slice(0,12),rows=[];i+=2;while(i<lines.length&&lines[i].trim()&&lines[i].includes('|')){rows.push(tableCells(lines[i++]).slice(0,12));}blocks.push({type:'table',headers,rows});continue;}
    const list=listLine(line);if(list){const ordered=!list[1],items=[];while(i<lines.length){const next=listLine(lines[i]);if(!next||!next[1]!==ordered)break;items.push(next[2]);i++;}blocks.push({type:'list',ordered,items});continue;}
    if(/^\s*>/.test(line)){const body=[];while(i<lines.length&&/^\s*>/.test(lines[i]))body.push(lines[i++].replace(/^\s*>\s?/,''));blocks.push({type:'quote',text:body.join('\n')});continue;}
    const paragraph=[line];i++;while(i<lines.length&&lines[i].trim()&&!isBoundary(i))paragraph.push(lines[i++]);blocks.push({type:'paragraph',text:paragraph.join('\n')});
  }
  return blocks;
}
export function chatStorageKey(boardId,kind){return `sharedboard-chat:${encodeURIComponent(String(boardId||'legacy'))}:${kind}`;}
export function isPreparedContextStale(context,board,planning){
  if(!context)return false;
  const currentBoardId=board?.id??board?.boardId;
  if(context.boardId&&context.boardId!==currentBoardId)return true;
  if(context.expectedRevision!==board?.revision)return true;
  const planningVersion=context.expectedPlanningVersion??context.planningVersion;
  return planningVersion!==undefined&&planningVersion!==planning?.version;
}
export function hasSelectionContextChanged(context,selection=[]){
  return context?.scope==='selection'&&JSON.stringify([...(context.selectedIds??[])].sort())!==JSON.stringify([...selection].sort());
}
export function serializePendingChat(pending){
  const full=JSON.stringify(pending);
  // Keep a stable retry ID even when a large PNG exceeds browser storage quotas.
  return full.length<=900_000?full:JSON.stringify({id:pending.id,text:pending.text,intent:pending.intent,boardId:pending.boardId,attachmentNotStored:true});
}
