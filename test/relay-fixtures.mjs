export class MemoryStorage{
 constructor(){this.map=new Map();this.alarmAt=null;this.tail=Promise.resolve();}
 // Serialize ordinary operations with transactions too: a concurrent put must
 // not be lost when a transaction publishes its private draft.
 run(operation){const result=this.tail.then(operation);this.tail=result.catch(()=>{});return result;}
 get(key){return this.run(()=>structuredClone(this.map.get(key)));}
 put(key,value){return this.run(()=>{this.map.set(key,structuredClone(value));});}
 delete(keys){return this.run(()=>{for(const key of Array.isArray(keys)?keys:[keys])this.map.delete(key);});}
 deleteAll(){return this.run(()=>{this.map.clear();});}
 list(options){return this.run(()=>list(this.map,options));}
 setAlarm(value){return this.run(()=>{this.alarmAt=value;});}
 getAlarm(){return this.run(()=>this.alarmAt);}
 transaction(operation){return this.run(async()=>{
  const draft=structuredClone(this.map);let alarmAt=this.alarmAt;
  const transaction={
   get:async key=>structuredClone(draft.get(key)),
   put:async(key,value)=>{draft.set(key,structuredClone(value));},
   delete:async keys=>{for(const key of Array.isArray(keys)?keys:[keys])draft.delete(key);},
   deleteAll:async()=>{draft.clear();},
   list:async options=>list(draft,options),
   setAlarm:async value=>{alarmAt=value;},
   getAlarm:async()=>alarmAt,
  };
  // A rejected callback leaves both the durable values and alarm unchanged.
  const result=await operation(transaction);this.map=draft;this.alarmAt=alarmAt;return result;
 });}
}
function list(map,{prefix='',limit=Infinity,startAfter}={}){return new Map([...map].sort(([a],[b])=>a.localeCompare(b)).filter(([key])=>key.startsWith(prefix)&&(!startAfter||key>startAfter)).slice(0,limit).map(([key,value])=>[key,structuredClone(value)]));}
