import React,{useEffect,useRef,useState} from 'react';
import {parseChatMarkdown,inlineChatTokens} from './chat-format.mjs';
import {copyText} from './ConnectionSetup.jsx';
function Inline({text}){return inlineChatTokens(text).map((token,index)=>token.type==='link'?<a key={index} href={token.href} target="_blank" rel="noopener noreferrer">{token.text}</a>:token.type==='code'?<code key={index}>{token.text}</code>:token.type==='strong'?<strong key={index}>{token.text}</strong>:token.type==='emphasis'?<em key={index}>{token.text}</em>:<React.Fragment key={index}>{token.text}</React.Fragment>);}
function CodeBlock({block}){
  const [copied,setCopied]=useState(false),[error,setError]=useState(null),timer=useRef(null);
  useEffect(()=>()=>clearTimeout(timer.current),[]);
  return <div className="reply-code"><header><span>{block.language||'Code'}</span><button type="button" onClick={async()=>{try{await copyText(block.text);setCopied(true);setError(null);clearTimeout(timer.current);timer.current=setTimeout(()=>setCopied(false),2000);}catch(e){setError(e.message);}}} aria-label="Copy code block">{copied?'Copied':'Copy'}</button></header><pre><code>{block.text}</code></pre>{error&&<small role="alert">{error}</small>}</div>;
}
export function MarkdownReply({text}){return <div className="markdown-reply">{parseChatMarkdown(text).map((block,index)=>{
  if(block.type==='code')return <CodeBlock key={index} block={block}/>;
  if(block.type==='heading')return <h3 className={`reply-heading level-${block.level}`} key={index}><Inline text={block.text}/></h3>;
  if(block.type==='list'){const Tag=block.ordered?'ol':'ul';return <Tag key={index}>{block.items.map((item,i)=><li key={i}><Inline text={item}/></li>)}</Tag>;}
  if(block.type==='quote')return <blockquote key={index}><Inline text={block.text}/></blockquote>;
  if(block.type==='separator')return <hr key={index}/>;
  if(block.type==='table')return <div className="reply-table" key={index}><table><thead><tr>{block.headers.map((cell,i)=><th key={i}><Inline text={cell}/></th>)}</tr></thead><tbody>{block.rows.map((row,i)=><tr key={i}>{block.headers.map((_,j)=><td key={j}><Inline text={row[j]??''}/></td>)}</tr>)}</tbody></table></div>;
  return <p key={index}><Inline text={block.text}/></p>;
})}</div>;}
