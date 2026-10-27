export async function beginPairing(app,provider='other',permission='edit'){
  const r=await fetch(`${app.url}/api/connection/pairing`,{method:'POST',headers:{'x-board-token':app.token,'content-type':'application/json'},body:JSON.stringify({provider,permission})});
  if(!r.ok)throw new Error(`Pair setup failed: ${await r.text()}`);return r.json();
}
export async function pairAgent(app,provider='other',permission='edit'){
  const {pairing}=await beginPairing(app,provider,permission);
  const r=await fetch(`${app.url}/api/agent/pair`,{method:'POST',headers:{'x-board-token':app.token,'content-type':'application/json'},body:JSON.stringify({code:pairing.code})});
  if(!r.ok)throw new Error(`Pairing failed: ${await r.text()}`);return r.json();
}
