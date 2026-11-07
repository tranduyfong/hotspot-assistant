import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tileUrl } from './domain.mjs';

export async function buildPatch({ context, map, center, radius = 1200, root, output, notify, signal }) {
  radius = Math.min(1800, Math.max(500, Number(radius) || 1200));
  const level = map.levels.at(-1), size = level.tileSize;
  const left = Math.max(0, Math.floor(center.x - radius)), top = Math.max(0, Math.floor(center.y - radius));
  const right = Math.min(map.width, Math.ceil(center.x + radius)), bottom = Math.min(map.height, Math.ceil(center.y + radius));
  const col0 = Math.floor(left / size), row0 = Math.floor(top / size);
  const col1 = Math.floor((right - 1) / size), row1 = Math.floor((bottom - 1) / size);
  const cache = join(root, 'tiles', map.id);
  await mkdir(cache, { recursive: true });
  const tasks = [];
  for (let row = row0; row <= row1; row++) for (let col = col0; col <= col1; col++) tasks.push({ row, col });
  let completed = 0; const composites = [];
  for (let start = 0; start < tasks.length; start += 4) {
    signal?.throwIfAborted();
    const batch = await Promise.all(tasks.slice(start, start + 4).map(async ({ row, col }) => {
      const url = tileUrl(level.url, row + map.baseIndex, col + map.baseIndex);
      const file = join(cache, createHash('sha256').update(url).digest('hex') + '.jpg');
      let buffer;
      try { buffer = await readFile(file); }
      catch (e) {
        if (e.code !== 'ENOENT') throw e;
        const response = await context.request.get(url, { timeout: 30000 });
        if (!response.ok()) throw new Error(`Không tải được ô ảnh (${row}, ${col}): ${response.status()}.`);
        buffer = await response.body();
        await writeFile(file, buffer);
      }
      signal?.throwIfAborted();
      notify(`Tải vùng mặt bằng ${++completed}/${tasks.length} ô ảnh`);
      return { input: buffer, left: (col - col0) * size, top: (row - row0) * size };
    }));
    composites.push(...batch);
  }
  const width = right - left, height = bottom - top;
  await sharp({ create: { width: (col1 - col0 + 1) * size, height: (row1 - row0 + 1) * size,
    channels: 3, background: '#ffffff' } }).composite(composites)
    .extract({ left: left - col0 * size, top: top - row0 * size, width, height }).png().toFile(output);
  return { left, top, width, height };
}
