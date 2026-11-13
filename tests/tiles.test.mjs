import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { buildPatch } from '../lib/tiles.mjs';

test('partial tile crop pixels agree with reported map origin', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vhub-crop-'));
  try {
    const map = { id: 'fixture', width: 1600, height: 1600, baseIndex: 1,
      levels: [{ tileSize: 512, url: '/tours/test/%v/%h.jpg' }] };
    const context = { request: { get: async url => {
      const [, row, col] = new URL(url).pathname.match(/\/(\d+)\/(\d+)\.jpg$/);
      const buffer = await sharp({ create: { width: 512, height: 512, channels: 3,
        background: { r: Number(col) * 50, g: Number(row) * 50, b: 0 } } }).png().toBuffer();
      return { ok: () => true, body: async () => buffer };
    } } };
    const output = join(root, 'patch.png');
    const bounds = await buildPatch({ context, map, center: { x: 700, y: 800 }, radius: 500, root, output, notify: () => {} });
    assert.deepEqual(bounds, { left: 200, top: 300, width: 1000, height: 1000 });
    const { data, info } = await sharp(output).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    for (const [x, y] of [[0, 0], [311, 211], [312, 212], [900, 900]]) {
      const i = (y * info.width + x) * info.channels;
      assert.equal(data[i], (Math.floor((x + bounds.left) / 512) + 1) * 50);
      assert.equal(data[i + 1], (Math.floor((y + bounds.top) / 512) + 1) * 50);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
