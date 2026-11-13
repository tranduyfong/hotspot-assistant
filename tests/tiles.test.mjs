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

test('cropped tile mosaics preserve source pixels at non-aligned origins and tile seams', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vhub-tiles-'));
  const pixel = (x, y) => [x % 251, y % 251, Math.floor(x / 512) + 4 * Math.floor(y / 512)];
  const context = { request: { get: async url => {
    const [, row, col] = url.match(/\/(\d+)_(\d+)\.jpg$/).map(Number);
    const bytes = Buffer.alloc(512 * 512 * 3);
    for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++)
      bytes.set(pixel((col - 1) * 512 + x, (row - 1) * 512 + y), (y * 512 + x) * 3);
    const buffer = await sharp(bytes, { raw: { width: 512, height: 512, channels: 3 } }).png().toBuffer();
    return { ok: () => true, body: async () => buffer };
  } } };
  const map = { id: 'test-map', width: 1536, height: 1536, baseIndex: 1,
    levels: [{ tileSize: 512, url: '/tours/test/%v_%h.jpg' }] };
  try {
    for (const center of [{ x: 700, y: 750 }, { x: 100, y: 150 }]) {
      const output = join(root, 'patch.png');
      const bounds = await buildPatch({ context, map, center, radius: 500, root, output, notify: () => {} });
      const { data, info } = await sharp(output).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      assert.equal(info.width, bounds.width); assert.equal(info.height, bounds.height);
      for (const [x, y] of [[0, 0], [400, 400], [512 - bounds.left, 512 - bounds.top], [info.width - 1, info.height - 1]]) {
        const i = (y * info.width + x) * 3;
        assert.deepEqual([...data.subarray(i, i + 3)], pixel(bounds.left + x, bounds.top + y));
      }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
