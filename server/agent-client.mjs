import { readFile, writeFile, rename } from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
export async function callBoard(operation, body,{dataDir}={}) {
  const directory=dataDir??process.env.WHITEBOARD_DATA_DIR ?? path.join(root,'data');
  const identity=process.env.WHITEBOARD_CLIENT_ID ?? process.env.CODEX_THREAD_ID ?? 'local-helper';
  const keyfile=path.join(directory,`.agent-session-${createHash('sha256').update(identity).digest('hex').slice(0,24)}.json`);
  let connection;
  try {
    connection = JSON.parse(await readFile(path.join(directory, '.connection.json'), 'utf8'));
  } catch { throw new Error('Start the whiteboard app first. No running board connection was found.'); }
  if (!/^http:\/\/127\.0\.0\.1:\d+(?:\/boards\/[a-f0-9-]{36})?$/i.test(connection.url)) throw new Error('Only a local whiteboard connection is supported.');
  const endpoint = operation === 'read_full' ? '/api/agent/read?full=1' : `/api/agent/${operation}`;
  let response;
  let key;try{key=JSON.parse(await readFile(keyfile,'utf8')).key;}catch{}
  try {
    response = await fetch(`${connection.url}${endpoint}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'x-board-token': connection.token, 'content-type': 'application/json', ...(key?{'x-agent-key':key}:{}),...(process.env.CODEX_THREAD_ID?{'x-agent-thread':process.env.CODEX_THREAD_ID}:{}) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000),
    });
  } catch { throw new Error('The local whiteboard is not reachable. Start the app and try again.'); }
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error ?? 'Whiteboard operation failed.'), { status: response.status, details: result.details, conflicts: result.conflicts });
  if(operation==='pair'&&result.agentKey){await writeFile(`${keyfile}.tmp`,JSON.stringify({key:result.agentKey,connectionId:result.connection.id}),{mode:0o600});await rename(`${keyfile}.tmp`,keyfile);delete result.agentKey;}
  return result;
}
