import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { startServer } from '../server/index.mjs';
import { ReviewStore } from '../server/reviews.mjs';
import { notifyCodex } from '../server/notify-codex.mjs';
import {pairAgent} from './fixtures.mjs';

test('review click captures the requested selection, queues once, and needs real acknowledgement', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'shared-board-review-'));
  const deliveries = [];
  const app = await startServer({ port: 0, dataDir: directory, notifyReview: async (request) => { deliveries.push(request.id); return { queueMessageId: randomUUID() }; } });
  const grant=await pairAgent(app);
  const send = async (route, body, method = 'POST') => {
    const response = await fetch(`${app.url}${route}`, { method, headers: { 'x-board-token': app.token, 'x-agent-key':grant.agentKey, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  try {
    await send('/api/agent/add', { elements: [{ id: 'review_box', type: 'rectangle', text: 'Inspect me' }, { id: 'unselected_box', type: 'ellipse', x: 500 }] });
    const input = { id: randomUUID(), expectedRevision: 1, selectedIds: ['review_box'] };
    const created = await send('/api/reviews', input);
    assert.equal(created.status, 200);
    assert.equal(created.data.request.delivery, 'queued');
    assert.equal(created.data.request.status, 'requested');
    assert.equal(created.data.request.objectCount, 2);
    assert.equal(created.data.request.snapshot, undefined, 'metadata endpoint must not send full snapshots');
    assert.equal(app.store.board.revision, 1, 'requesting a review must not edit the drawing');
    await send('/api/reviews', input);
    await send('/api/reviews', { ...input, id: randomUUID() });
    assert.equal(deliveries.length, 1, 'duplicate click must not queue a second message');
    assert.equal((await send('/api/agent/complete_review', { id: input.id, summary: 'Premature' })).status, 409);
    await send('/api/agent/edit', { edits: [{ id: 'review_box_label', expectedVersion: 1, changes: { text: 'Changed afterward' } }] });
    const reviewed = await send('/api/agent/review', { id: input.id });
    assert.equal(reviewed.data.request.status, 'reviewing');
    assert.equal(reviewed.data.boardChangedSinceRequest, true);
    assert.equal(reviewed.data.board.elements.find((element) => element.id === 'review_box_label').text, 'Inspect me');
    assert.equal(reviewed.data.board.elements.some((element) => element.id === 'unselected_box'), false);
    const complete = await send('/api/agent/complete_review', { id: input.id, summary: 'Reviewed the selected box and its bound label.' });
    assert.equal(complete.data.status, 'reviewed');
    assert.equal(new ReviewStore(directory).find(input.id).summary, 'Reviewed the selected box and its bound label.');
    assert.equal((await send('/api/reviews', { id: randomUUID(), expectedRevision: 1, selectedIds: [] })).status, 409);
    assert.equal((await send('/api/reviews', { id: randomUUID(), expectedRevision: 2, selectedIds: ['missing'] })).status, 409);
  } finally { await app.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('failed delivery remains explicit and can be retried without creating another request', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'shared-board-review-fail-'));
  let attempt = 0;
  const app = await startServer({ port: 0, dataDir: directory, notifyReview: async () => { if (++attempt === 1) throw new Error('Test connection unavailable'); return { queueMessageId: randomUUID() }; } });
  await pairAgent(app);
  const send = async (route, body) => fetch(`${app.url}${route}`, { method: 'POST', headers: { 'x-board-token': app.token, 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((response) => response.json());
  try {
    const id = randomUUID();
    const result = await send('/api/reviews', { id, expectedRevision: 0, selectedIds: [] });
    assert.equal(result.request.delivery, 'failed');
    assert.equal(result.request.status, 'requested');
    const retry = await send('/api/reviews/retry', { id });
    assert.equal(retry.requests.length, 1);
    assert.equal(retry.requests[0].delivery, 'queued');
    await send('/api/reviews/retry', { id });
    assert.equal(attempt, 2, 'successful delivery is never sent again by retry');
  } finally { await app.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('Codex delivery targets only the configured chat and does not put drawing content in process arguments', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'shared-board-notify-'));
  const threadId = randomUUID();
  const executable = path.join(directory, 'codex.exe');
  writeFileSync(executable, 'test placeholder; never executed');
  writeFileSync(path.join(directory, 'agent-target.json'), JSON.stringify({ threadId, codexPath: executable }));
  try {
    const receipt = await notifyCodex({ id: randomUUID(), boardRevision: 3, scope: 'board', objectCount: 4, snapshot: { text: 'PRIVATE_BOARD_TEXT' } }, {
      dataDir: directory, projectRoot: directory,
      run: async (command, args) => {
        assert.equal(command, executable);
        assert.deepEqual(args.slice(0, 3), ['queue', '--thread', threadId]);
        assert.equal(args[3], '--message');
        assert.ok(args[4].includes('inspection') || args[4].includes('inspect'));
        assert.equal(args[4].includes('PRIVATE_BOARD_TEXT'), false);
        return `Queued message ${randomUUID()} for thread ${threadId}.`;
      },
    });
    assert.equal(receipt.provider, 'codex-cli');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
