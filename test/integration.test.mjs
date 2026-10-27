import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { startServer, projectRoot } from '../server/index.mjs';
import {beginPairing} from './fixtures.mjs';

test('real MCP client can read, create, move, rename, reject stale changes and delete on the persisted board', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'shared-board-mcp-'));
  const app = await startServer({ port: 0, dataDir: directory });
  const client = new Client({ name: 'prototype-verification', version: '1.0.0' });
  try {
    const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(projectRoot, 'server/mcp.mjs')], cwd: projectRoot, env: { ...process.env, WHITEBOARD_DATA_DIR: directory } });
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), ['add_elements', 'complete_review_request', 'edit_elements', 'list_review_requests', 'read_board', 'read_review_request','list_chat_messages','read_chat_message','reply_to_chat_message','connection_status','connect_board','confirm_connection','view_board','propose_changes'].sort());
    const call = async (name, args) => {
      const response = await client.callTool({ name, arguments: args });
      return { ...response, data: response.structuredContent ?? (response.isError?{error:response.content[0].text}:JSON.parse(response.content[0].text)) };
    };
    assert.equal((await call('read_board',{})).isError,true,'a new local agent must pair before reading the drawing');
    const {pairing}=await beginPairing(app);
    const connected=await call('connect_board',{code:pairing.code});assert.equal(connected.isError,undefined);assert.equal(connected.data.agentKey,undefined,'the private client stores its grant instead of putting it in model context');
    const initial = await call('read_board', {});
    assert.equal(initial.data.revision, 0);
    const confirmed=await call('confirm_connection',{revision:0});assert.ok(confirmed.data.boardCheckedAt);
    const added = await call('add_elements', { elements: [{ id: 'mcp_box', type: 'rectangle', x: 40, y: 50, text: 'Shared editing works' }], summary: 'MCP added a box' });
    assert.equal(added.data.createdIds.length, 2);
    const moved = await call('edit_elements', { edits: [{ id: 'mcp_box', expectedVersion: 1, changes: { x: 150 } }] });
    assert.equal(moved.data.editedIds.length, 2);
    const renamed = await call('edit_elements', { edits: [{ id: 'mcp_box_label', expectedVersion: 2, changes: { text: 'The updated label' } }] });
    assert.equal(renamed.isError, undefined);
    const stale = await client.callTool({ name: 'edit_elements', arguments: { edits: [{ id: 'mcp_box', expectedVersion: 1, changes: { x: 999 } }] } });
    assert.equal(stale.isError, true);
    const read = await call('read_board', {});
    assert.equal(read.data.elements.find((element) => element.id === 'mcp_box').x, 150);
    assert.equal(read.data.elements.find((element) => element.id === 'mcp_box_label').text, 'The updated label');
    assert.equal(app.store.board.elements.length, 2);
    const deleted = await call('edit_elements', { edits: [{ id: 'mcp_box', expectedVersion: read.data.elements.find(element=>element.id==='mcp_box').editVersion, changes: { isDeleted: true } }] });
    assert.equal(deleted.isError, undefined);
    assert.ok(app.store.board.elements.every((element) => element.isDeleted));
    const resumed=new Client({name:'reopened-client',version:'1.0.0'});
    try{
      await resumed.connect(new StdioClientTransport({command:process.execPath,args:[path.join(projectRoot,'server/mcp.mjs')],cwd:projectRoot,env:{...process.env,WHITEBOARD_DATA_DIR:directory}}));
      const response=await resumed.callTool({name:'read_board',arguments:{}});
      assert.equal(response.isError,undefined,'reopening the configured MCP process should reuse the saved grant');
    }finally{await resumed.close();}
  } finally { await client.close(); await app.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('HTTP interface rejects unauthenticated, cross-site and invalid edits', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'shared-board-http-'));
  const app = await startServer({ port: 0, dataDir: directory });
  try {
    assert.equal((await fetch(`${app.url}/api/board`)).status, 401);
    assert.equal((await fetch(`${app.url}/api/session`, { headers: { origin: 'https://example.com' } })).status, 403);
    const headers = { 'x-board-token': app.token, 'content-type': 'application/json' };
    assert.equal((await fetch(`${app.url}/api/board`, { method: 'PATCH', headers, body: JSON.stringify({ changes: [{ id: 'wrong', expectedVersion: 0, element: { id: 'different', type: 'rectangle', x: 0, y: 0, width: 1, height: 1 } }] }) })).status, 400);
    assert.equal(app.store.board.revision, 0);
  } finally { await app.close(); rmSync(directory, { recursive: true, force: true }); }
});
