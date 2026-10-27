import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BoardStore } from '../server/store.mjs';
import { createElements } from '../server/elements.mjs';
import { rebaseElements } from '../shared/scene.mjs';

test('saved drawings survive reopening, disjoint concurrent writes merge, overlapping batches reject atomically', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'shared-board-store-'));
  try {
    const store = new BoardStore(directory);
    const [a, b] = createElements([{ id: 'a', x: 10 }, { id: 'b', x: 200 }]);
    store.apply({ changes: [a, b].map((element) => ({ id: element.id, expectedVersion: 0, element })) });
    store.apply({ changes: [{ id: 'a', expectedVersion: 1, element: { ...a, x: 40 } }], actor: 'agent' });
    store.apply({ changes: [{ id: 'b', expectedVersion: 1, element: { ...b, y: 80 } }] });
    const revision = store.board.revision;
    assert.throws(() => store.apply({ changes: [
      { id: 'b', expectedVersion: 2, element: { ...b, y: 999 } },
      { id: 'a', expectedVersion: 1, element: { ...a, x: 999 } },
    ] }), { status: 409 });
    assert.equal(store.board.revision, revision);
    const reopened = new BoardStore(directory);
    assert.equal(reopened.board.elements.find((element) => element.id === 'a').x, 40);
    assert.equal(reopened.board.elements.find((element) => element.id === 'b').y, 80);
    assert.equal(reopened.board.revision, revision);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('browser rebase preserves local changes to different objects and reports overlapping edits', () => {
  const base = [{ id: 'a', x: 1 }, { id: 'b', x: 2 }];
  const local = [{ id: 'a', x: 10 }, { id: 'b', x: 2 }];
  const remote = [{ id: 'a', x: 1 }, { id: 'b', x: 20 }];
  const merged = rebaseElements(base, local, remote);
  assert.deepEqual(merged.conflicts, []);
  assert.deepEqual(merged.elements, [{ id: 'a', x: 10 }, { id: 'b', x: 20 }]);
  assert.deepEqual(rebaseElements(base, local, [{ id: 'a', x: 30 }, { id: 'b', x: 2 }]).conflicts, ['a']);
  assert.deepEqual(rebaseElements(base, local, local).conflicts, []);
});
