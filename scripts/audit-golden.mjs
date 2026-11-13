// Read-only VHUB inventory and OCR coverage; does not approve, stage or save hotspots.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import sharp from 'sharp';
import { VhubDriver } from '../lib/driver.mjs';
import { tileUrl, pixelToWorld } from '../lib/domain.mjs';
import { readLabels } from '../lib/ocr.mjs';

const root = '.data/run/golden-audit';
await mkdir(root, { recursive: true });
const driver = new VhubDriver('.data', console.log);
driver.setProject('vinhomes-golden-city');
try {
  await driver.connect();
  await driver.page.reload({ waitUntil: 'domcontentloaded' });
  await driver.sync();
  const { map, products, hotspots, pending } = driver;
  await writeFile(`${root}/inventory.json`, JSON.stringify({ map, products, hotspots, pending }));
  const level = map.levels.at(-1), size = level.tileSize;
  const rows = [];
  for (let row = 0; row < Math.ceil(map.height / size); row++) {
    const parts = [];
    for (let col = 0; col < Math.ceil(map.width / size); col++) {
      const file = `${root}/tile-${row}-${col}.jpg`;
      let buffer;
      try { buffer = await readFile(file); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        const response = await driver.context.request.get(tileUrl(level.url, row + map.baseIndex, col + map.baseIndex));
        if (!response.ok()) throw new Error(`Tile ${row},${col}: ${response.status()}`);
        buffer = await response.body(); await writeFile(file, buffer);
      }
      parts.push({ input: buffer, left: col * size, top: 0 });
    }
    const file = `${root}/row-${row}.png`;
    await sharp({ create: { width: Math.ceil(map.width / size) * size, height: size, channels: 3, background: '#fff' } })
      .composite(parts).extract({ left: 0, top: 0, width: map.width, height: Math.min(size, map.height - row * size) }).png().toFile(file);
    rows.push({ input: file, left: 0, top: row * size });
    console.log(`Tiles ${row + 1}/${Math.ceil(map.height / size)}`);
  }
  await sharp({ create: { width: map.width, height: map.height, channels: 3, background: '#fff' } })
    .composite(rows).png().toFile(`${root}/map.png`);
  const candidates = await readLabels(`${root}/map.png`, console.log, null, null, {
    project: driver.projectId, angles: [0], knownCodes: [...new Set([...products, ...hotspots].map(p => p.code))],
  });
  await writeFile(`${root}/candidates.json`, JSON.stringify(candidates));
  const inventory = pending.map(p => {
    const observations = candidates.filter(c => c.code === p.code && c.confidence >= .8);
    return { code: p.code, status: observations.length === 1 ? 'needs-visual-review' : observations.length ? 'ambiguous' : 'not-found',
      observations: observations.map(c => ({ ...c, ...pixelToWorld(c, map) })) };
  });
  await writeFile(`${root}/review.json`, JSON.stringify({ createdAt: new Date().toISOString(), mapId: map.id,
    scanAngles: [0], coordinateStatus: 'Flat source pixels; visual review required before saving', inventory }, null, 2));
  console.log(JSON.stringify({ total: inventory.length, found: inventory.filter(p => p.status === 'needs-visual-review').length,
    ambiguous: inventory.filter(p => p.status === 'ambiguous').length, missing: inventory.filter(p => p.status === 'not-found').length }));
} catch (error) { console.error(error); process.exit(1); }
process.exit();
