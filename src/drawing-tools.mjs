import {associatedIds} from './object-navigator.mjs';

export const NATIVE_TOOLS=[['selection','select','Select','V / 1'],['hand','hand','Pan','H'],['rectangle','rectangle','Rectangle','R / 2'],['diamond','diamond','Diamond','D / 3'],['ellipse','ellipse','Ellipse','O / 4'],['arrow','arrow','Arrow','A / 5'],['line','line','Line','L / 6'],['freedraw','freedraw','Draw','P / 7'],['text','text','Text','T / 8'],['image','image','Image','9'],['eraser','eraser','Eraser','E / 0']];
export const SHAPE_TOOLS=NATIVE_TOOLS.filter(([type])=>['rectangle','diamond','ellipse'].includes(type));
export const EXTRA_TOOLS=[['frame','frame','Frame','F'],['embeddable','embed','Web embed','W'],['recognize','shape','Draw to shape','Shift+X'],['bucket','bucket','Bucket fill','B'],['lasso','lasso','Lasso selection','J']];

export function typingTarget(target,appState={}){
  return Boolean(appState.editingTextElement||target?.isContentEditable||target?.closest?.('input,textarea,select,[contenteditable="true"],[role="textbox"]'));
}
export function shortcutAction(event,appState={}){
  if(event.defaultPrevented||event.isComposing||typingTarget(event.target,appState))return null;
  const key=event.key.toLowerCase(),mod=event.ctrlKey||event.metaKey;
  if(key==='escape')return 'close';
  if(key==='f1'||event.key==='?')return 'help';
  if(mod&&!event.altKey){
    if(key==='/'||event.shiftKey&&key==='p')return 'help';
    if(event.code==='Quote'||key==="'")return 'grid';
    if(key==='s')return event.shiftKey?'backup':'export';
    if(key==='o')return 'import';
    if(key==='k'||key==='f')return 'find';
    return null;
  }
  if(mod)return null;
  if(event.altKey)return key==='z'?'fullscreen':key==='/'?'objects':null;
  if(!event.shiftKey&&(key==='s'||key==='g')||event.shiftKey&&key==='f')return 'style';
  if(event.shiftKey&&key==='x')return 'recognize';
  if(!event.shiftKey&&key==='b')return 'bucket';
  if(!event.shiftKey&&key==='j')return 'lasso';
  if(!event.shiftKey&&key==='w')return 'embeddable';
  return null;
}
export function gridUpdate(state){
  return {gridModeEnabled:!state.gridModeEnabled,gridSize:state.gridSize||20,objectsSnapModeEnabled:false};
}
export function scenePoint(event,state,rect){
  return {x:(event.clientX-rect.left)/state.zoom.value-state.scrollX,y:(event.clientY-rect.top)/state.zoom.value-state.scrollY};
}
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
export function pointInPolygon(point,polygon){
  let inside=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[i],b=polygon[j];
    if((a.y>point.y)!==(b.y>point.y)&&point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
  }
  return inside;
}
function corners(element){
  const points=element.points?.length?element.points:null,minX=points?Math.min(...points.map(p=>p[0])):0,minY=points?Math.min(...points.map(p=>p[1])):0,maxX=points?Math.max(...points.map(p=>p[0])):element.width,maxY=points?Math.max(...points.map(p=>p[1])):element.height;
  const x1=element.x+Math.min(minX,maxX),y1=element.y+Math.min(minY,maxY),x2=element.x+Math.max(minX,maxX),y2=element.y+Math.max(minY,maxY);
  const cx=(x1+x2)/2,cy=(y1+y2)/2,c=Math.cos(element.angle||0),s=Math.sin(element.angle||0);
  return [[x1,y1],[x2,y1],[x2,y2],[x1,y2]].map(([x,y])=>({x:cx+(x-cx)*c-(y-cy)*s,y:cy+(x-cx)*s+(y-cy)*c}));
}
function blockedByAncestors(element,map){
  const queue=[element],seen=new Set();
  while(queue.length){const item=queue.pop();if(!item||seen.has(item.id))continue;seen.add(item.id);if(item.isDeleted||item.locked||item.opacity===0)return true;queue.push(map.get(item.containerId),map.get(item.frameId));}
  return false;
}
function crosses(a,b,c,d){
  const side=(p,q,r)=>(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);
  return side(a,b,c)*side(a,b,d)<0&&side(c,d,a)*side(c,d,b)<0;
}
export function lassoIds(elements,polygon){
  if(polygon.length<3)return [];
  const map=new Map(elements.map(e=>[e.id,e]));
  const blocked=element=>blockedByAncestors(element,map);
  const hits=elements.filter(e=>{
    if(blocked(e))return false;
    const box=corners(e);
    if(e.type==='frame'||e.type==='magicframe')return box.every(p=>pointInPolygon(p,polygon));
    return box.some(p=>pointInPolygon(p,polygon))||polygon.some(p=>pointInPolygon(p,box))||box.some((p,i)=>polygon.some((q,j)=>crosses(p,box[(i+1)%4],q,polygon[(j+1)%polygon.length])));
  }).map(e=>e.containerId||e.id);
  return [...associatedIds(elements,hits,{wholeGroups:true})].filter(id=>!blocked(map.get(id)));
}
export function frameForShape(elements,shape){
  const box=corners(shape);
  return [...elements].reverse().find(e=>['frame','magicframe'].includes(e.type)&&!e.isDeleted&&!e.locked&&e.opacity!==0&&box.every(point=>containsFillPoint({...e,type:'rectangle'},point)))?.id??null;
}
export function containsFillPoint(element,point){
  if(element.isDeleted||element.locked||element.opacity===0)return false;
  const local=element.points?.length?element.points:null;
  const cx=element.x+(local?(Math.min(...local.map(p=>p[0]))+Math.max(...local.map(p=>p[0])))/2:element.width/2),cy=element.y+(local?(Math.min(...local.map(p=>p[1]))+Math.max(...local.map(p=>p[1])))/2:element.height/2),c=Math.cos(-(element.angle||0)),s=Math.sin(-(element.angle||0));
  const x=cx+(point.x-cx)*c-(point.y-cy)*s-element.x,y=cy+(point.x-cx)*s+(point.y-cy)*c-element.y;
  if(element.type==='rectangle')return x>=0&&y>=0&&x<=element.width&&y<=element.height;
  if(element.type==='ellipse')return ((x-element.width/2)/(element.width/2))**2+((y-element.height/2)/(element.height/2))**2<=1;
  if(element.type==='diamond')return Math.abs((x-element.width/2)/(element.width/2))+Math.abs((y-element.height/2)/(element.height/2))<=1;
  if(['freedraw','line'].includes(element.type)&&element.points?.length>=3){
    const polygon=element.points.map(([x,y])=>({x,y}));
    if(distance(polygon[0],polygon.at(-1))>Math.max(12,Math.min(element.width,element.height)*.15))return false;
    return pointInPolygon({x,y},polygon);
  }
  return false;
}
export function bucketElements(elements,point,color){
  const map=new Map(elements.map(e=>[e.id,e]));
  const hit=[...elements].reverse().find(e=>!blockedByAncestors(e,map)&&containsFillPoint(e,point));
  if(!hit)return null;
  return elements.map(e=>e.id===hit.id?{...e,backgroundColor:color,fillStyle:'solid',version:(e.version||0)+1,versionNonce:Math.floor(Math.random()*2**30),updated:Date.now()}:e);
}
export function recognizeStroke(points){
  if(points.length<2)return null;
  const xs=points.map(p=>p.x),ys=points.map(p=>p.y),x=Math.min(...xs),y=Math.min(...ys),width=Math.max(...xs)-x,height=Math.max(...ys)-y;
  const first=points[0],last=points.at(-1),length=points.slice(1).reduce((sum,p,i)=>sum+distance(p,points[i]),0);
  if(Math.max(width,height)<5)return null;
  if(distance(first,last)>Math.max(16,Math.min(width,height)*.35)||Math.min(width,height)<5){
    if(distance(first,last)/length>.88)return {type:'line',x:first.x,y:first.y,width:last.x-first.x,height:last.y-first.y,points:[[0,0],[last.x-first.x,last.y-first.y]]};
    return {type:'freedraw',x,y,width,height,points:points.map(p=>[p.x-x,p.y-y])};
  }
  const sampled=points.flatMap((p,i)=>{if(!i)return [p];const previous=points[i-1],steps=Math.max(1,Math.ceil(distance(p,previous)/(Math.max(width,height)/12)));return Array.from({length:steps},(_,j)=>({x:previous.x+(p.x-previous.x)*(j+1)/steps,y:previous.y+(p.y-previous.y)*(j+1)/steps}));});
  const normalized=sampled.map(p=>({x:(p.x-x-width/2)/(width/2),y:(p.y-y-height/2)/(height/2)}));
  const error=fn=>normalized.reduce((sum,p)=>sum+fn(p),0)/normalized.length;
  const errors=[['rectangle',error(p=>Math.min(Math.abs(Math.abs(p.x)-1),Math.abs(Math.abs(p.y)-1)))],['ellipse',error(p=>Math.abs(Math.hypot(p.x,p.y)-1))],['diamond',error(p=>Math.abs(Math.abs(p.x)+Math.abs(p.y)-1))]];
  errors.sort((a,b)=>a[1]-b[1]);
  return {type:errors[0][0],x,y,width,height};
}

export const KEYBOARD_REFERENCE=[
  ['Drawing tools', [...NATIVE_TOOLS.map(([, ,label,key])=>[label,key]),['Frame','F'],['Laser pointer','K'],['Web embed','W'],['Draw to shape','Shift+X'],['Bucket fill closed shapes','B'],['Lasso selection','J'],['Keep current tool active','Q'],['Cycle arrow style','A while arrow tool is active'],['Multi-point line / arrow','L / A, then click points']]],
  ['Selection & editing', [['Select all','Mod+A'],['Add to selection','Shift+click'],['Enter a group','Ctrl/Cmd+click'],['Edit text / frame name','Enter / double-click'],['Edit line / arrow points','Mod+Enter'],['New line while editing text','Enter / Shift+Enter'],['Finish text editing','Escape / Mod+Enter'],['Crop image / finish crop','Double-click / Enter'],['Delete selection','Delete / Backspace'],['Duplicate','Mod+D / Alt+drag'],['Group / ungroup','Mod+G / Mod+Shift+G'],['Lock / unlock','Mod+Shift+L'],['Move selection','Arrow keys'],['Move in larger steps','Shift+Arrow keys'],['Constrain proportions / angle','Shift+drag'],['Draw from center','Alt+drag'],['Prevent arrow binding','Hold Mod while drawing'],['Copy / cut / paste','Mod+C / Mod+X / Mod+V'],['Undo','Mod+Z'],['Redo','Mod+Shift+Z / Ctrl+Y']]],
  ['Style & arrangement', [['Drawing style / stroke','S'],['Drawing style / fill','G'],['Text style','Shift+F'],['Smaller / larger text','Mod+Shift+, / Mod+Shift+.'],['Pick stroke / fill color','Shift+S / Shift+G / I'],['Copy / paste style','Mod+Alt+C / Mod+Alt+V'],['Bring forward / send backward','Mod+] / Mod+['],['Bring to front / send to back','Mod+Shift+] / Mod+Shift+['],['Flip horizontal / vertical','Shift+H / Shift+V'],['Align selection','Mod+Shift+Arrow keys'],['Distribute horizontally / vertically','Alt+H / Alt+V'],['Object snapping','Alt+S'],['Alignment grid & snapping',"Mod+'"]]],
  ['Navigate & board', [['Pan temporarily','Space+drag / middle drag'],['Pan a page vertically','Page Up / Page Down'],['Pan a page horizontally','Shift+Page Up / Page Down'],['Zoom','Mod+wheel / pinch'],['Zoom in / out','Mod++ / Mod+-'],['Reset zoom','Mod+0'],['Fit drawing','Shift+1'],['Fit selection','Shift+2'],['Zoom to selection','Shift+3'],['Find areas & text','Mod+K / Mod+F'],['Objects & minimap','Alt+/'],['Export drawing','Mod+S'],['Download board backup','Mod+Shift+S'],['Import drawing','Mod+O'],['Copy selection as PNG','Shift+Alt+C'],['Export image','Mod+Shift+E'],['Read only viewing mode','Alt+R'],['Canvas only / full screen','Alt+Z'],['Keyboard reference','? / F1'],['Search keyboard reference','Mod+/ / Mod+Shift+P'],['Cancel / close','Escape']]],
];
