export const webConnectionWip='ChatGPT and Claude web connectors are work in progress and locked in this local beta. Use a local AI connection below.';
export const isWebProvider=provider=>['chatgpt-web','claude-web'].includes(provider);

// Old web sessions must not look usable while the local beta is being loaded.
export function localConnectionView(connection){
  if(!connection)return connection;
  const web={...connection.web,phase:'locked',available:false,wip:true,pending:[],url:null,chatOpen:false};
  if(!isWebProvider(connection.provider)&&connection.deliveryMode!=='app')return {...connection,web};
  return {...connection,id:null,provider:null,label:null,connected:false,automaticMessages:false,deliveryMode:'manual',permission:null,boardCheckedAt:null,deliveryCheckedAt:null,replyCheckedAt:null,web};
}
