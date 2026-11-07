import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../lib/store.mjs';
test('vị trí đã duyệt và nhật ký giữ được sau khi khởi động lại', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vhub-store-'));
  const store = new Store(root); await store.init();
  store.data.approvals['map:AS76-09'] = { code: 'AS76-09', x: 10, y: 20, mapId: 'map' };
  await store.log('approve', { codes: ['AS76-09'] });
  const reopened = new Store(root); await reopened.init();
  assert.equal(reopened.data.approvals['map:AS76-09'].x, 10);
  assert.equal(reopened.data.history[0].action, 'approve');
  assert.doesNotMatch(await readFile(join(root, 'store.json'), 'utf8'), /authorization|password|cookie/i);
});
