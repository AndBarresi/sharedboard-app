export class MemoryStorage{
 constructor(){this.map=new Map();this.alarmAt=null;}
 async get(key){return structuredClone(this.map.get(key));}
 async put(key,value){this.map.set(key,structuredClone(value));}
 async delete(keys){for(const key of Array.isArray(keys)?keys:[keys])this.map.delete(key);}
 async deleteAll(){this.map.clear();}
 async list({prefix='',limit=Infinity,startAfter}={}){return new Map([...this.map].sort(([a],[b])=>a.localeCompare(b)).filter(([key])=>key.startsWith(prefix)&&(!startAfter||key>startAfter)).slice(0,limit).map(([key,value])=>[key,structuredClone(value)]));}
 async setAlarm(value){this.alarmAt=value;}
 async getAlarm(){return this.alarmAt;}
}
