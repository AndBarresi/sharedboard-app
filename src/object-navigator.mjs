const TYPES={rectangle:'Rectangle',ellipse:'Ellipse',diamond:'Diamond',text:'Text',arrow:'Arrow',line:'Line',freedraw:'Drawing',image:'Image',frame:'Frame',embeddable:'Embed',iframe:'Embed'};
const clean=text=>String(text??'').replace(/\s+/g,' ').trim();
export function elementLabel(element,elements){
  const named=clean(element.customData?.sharedboardName);if(named)return named;
  const text=clean(element.text??element.name);if(text)return text;
  const label=(element.boundElements??[]).filter(bound=>bound.type==='text').map(bound=>elements.find(item=>item.id===bound.id&&!item.isDeleted)?.text).filter(Boolean).join(' ');
  return clean(label)||TYPES[element.type]||'Object';
}
export function outlineEntries(elements){
  const active=elements.filter(element=>!element.isDeleted),map=new Map(active.map(element=>[element.id,element]));
  const roots=active.filter(element=>!element.containerId||!map.has(element.containerId)),entries=[],groups=new Map();
  for(const element of roots){
    const groupId=element.groupIds?.at(-1);
    const entry={id:element.id,kind:'element',type:element.type,name:elementLabel(element,active),elementIds:[element.id],element,groupIds:element.groupIds??[]};
    if(!groupId){entries.push(entry);continue;}
    let group=groups.get(groupId);
    if(!group){group={id:`group:${groupId}`,groupId,kind:'group',type:'group',name:'',elementIds:[],children:[]};groups.set(groupId,group);entries.push(group);}
    group.elementIds.push(element.id);group.children.push(entry);
  }
  let counter=0;
  for(const entry of entries)if(entry.kind==='group'){counter++;entry.name=clean(entry.children.map(child=>child.element.customData?.sharedboardGroupNames?.[entry.groupId]).find(Boolean))||`Group ${counter}`;}
  return entries.reverse();
}
export function associatedIds(elements,ids,{wholeGroups=false}={}){
  const active=elements.filter(element=>!element.isDeleted),selected=new Set(ids);
  if(wholeGroups){const groups=new Set(active.filter(element=>selected.has(element.id)).map(element=>element.groupIds?.at(-1)).filter(Boolean));for(const element of active)if(element.groupIds?.some(id=>groups.has(id)))selected.add(element.id);}
  let changed=true;
  while(changed){changed=false;for(const element of active){
    if(selected.has(element.id)){for(const bound of element.boundElements??[])if(bound.type==='text'&&!selected.has(bound.id)){selected.add(bound.id);changed=true;}}
    if((selected.has(element.containerId)||selected.has(element.frameId))&&!selected.has(element.id)){selected.add(element.id);changed=true;}
  }}
  return selected;
}
function bump(element,changes){return {...element,...changes,version:(element.version??0)+1,versionNonce:Math.floor(Math.random()*2**30),updated:Date.now()};}
export function editOutlineElements(elements,ids,action){
  const related=associatedIds(elements,ids),targets=elements.filter(element=>!element.isDeleted&&related.has(element.id));
  if(!targets.length)return elements;
  const hide=!targets.every(element=>(element.opacity??100)===0),lock=!targets.every(element=>element.locked);
  return elements.map(element=>{
    if(element.isDeleted||!related.has(element.id))return element;
    if(action==='lock')return element.locked===lock?element:bump(element,{locked:lock});
    if(action==='visibility'){
      const customData={...element.customData};
      if(hide){if(!customData.sharedboardHidden)customData.sharedboardPreviousOpacity=element.opacity??100;customData.sharedboardHidden=true;return bump(element,{opacity:0,customData});}
      const previous=customData.sharedboardPreviousOpacity;
      const opacity=typeof previous==='number'&&Number.isFinite(previous)?Math.max(0,Math.min(100,previous)):100;
      delete customData.sharedboardPreviousOpacity;delete customData.sharedboardHidden;
      return bump(element,{opacity,customData});
    }
    return element;
  });
}
export function renameOutlineEntry(elements,entry,name){
  const label=clean(name).slice(0,100);if(!label)return elements;
  const related=entry.kind==='group'?associatedIds(elements,entry.elementIds):new Set(entry.elementIds);
  return elements.map(element=>{
    if(element.isDeleted||!related.has(element.id))return element;
    const customData={...element.customData};
    if(entry.kind==='group')customData.sharedboardGroupNames={...customData.sharedboardGroupNames,[entry.groupId]:label};else customData.sharedboardName=label;
    return bump(element,{customData});
  });
}
export function reorderOutlineElements(elements,ids,direction){
  const selected=associatedIds(elements,ids,{wholeGroups:true});
  const moved=elements.filter(element=>!element.isDeleted&&selected.has(element.id)),others=elements.filter(element=>element.isDeleted||!selected.has(element.id));
  if(!moved.length)return elements;
  const ordered=direction==='front'?[...others,...moved]:[...moved,...others];
  // The editor will assign fresh ordering keys in this array order.
  return ordered.map(element=>selected.has(element.id)&&!element.isDeleted?bump(element,{index:null}):{...element,index:null});
}
export function rotatedBounds(element){
  const width=Math.max(1,Math.abs(element.width||0)),height=Math.max(1,Math.abs(element.height||0)),cx=element.x+width/2,cy=element.y+height/2,angle=element.angle||0;
  const cos=Math.cos(angle),sin=Math.sin(angle);
  const points=[[-width/2,-height/2],[width/2,-height/2],[width/2,height/2],[-width/2,height/2]].map(([x,y])=>[cx+x*cos-y*sin,cy+x*sin+y*cos]);
  const x=Math.min(...points.map(point=>point[0])),y=Math.min(...points.map(point=>point[1]));
  return {x,y,width:Math.max(...points.map(point=>point[0]))-x,height:Math.max(...points.map(point=>point[1]))-y};
}
export function navigatorBounds(elements,viewport){
  const boxes=elements.filter(element=>!element.isDeleted&&!element.containerId).map(rotatedBounds);
  if(viewport)boxes.push(viewport);
  if(!boxes.length)return {x:0,y:0,width:1000,height:700};
  const union=boxes.reduce((result,box)=>({x:Math.min(result.x,box.x),y:Math.min(result.y,box.y),right:Math.max(result.right,box.x+box.width),bottom:Math.max(result.bottom,box.y+box.height)}),{x:Infinity,y:Infinity,right:-Infinity,bottom:-Infinity});
  const padding=Math.max(20,Math.max(union.right-union.x,union.bottom-union.y)*.06);
  return {x:union.x-padding,y:union.y-padding,width:Math.max(1,union.right-union.x)+padding*2,height:Math.max(1,union.bottom-union.y)+padding*2};
}
