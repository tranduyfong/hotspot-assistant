// Prepare local contact sheets. This script does not approve or write to VHUB.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import sharp from 'sharp';
import { pixelToWorld } from '../lib/domain.mjs';
const root = '.data/run/golden-audit';
const html = await (await fetch('http://127.0.0.1:4318/')).text();
const key = html.split('name="tool-key" content="')[1].split('"')[0];
const state = await (await fetch('http://127.0.0.1:4318/api/state', { headers: { 'X-Tool-Key': key } })).json();
if (state.tour !== 'vinhomes-golden-city') throw new Error('Wrong project');
const files = (await readdir(root)).filter(f => /^candidates(?:-(?:[-\d]+|manual))?\.json$/.test(f));
const merged = [];
for (const file of files) for (const c of JSON.parse(await readFile(`${root}/${file}`))) {
  const index = merged.findIndex(p => p.code === c.code && Math.hypot(p.x - c.x, p.y - c.y) < 12);
  if (index < 0) merged.push(c);
  else if (c.confidence > merged[index].confidence) merged[index] = c;
}
const inventory = state.pending.map(p => ({ code: p.code, observations: merged.filter(c => c.code === p.code)
  .map(c => ({ ...c, ...pixelToWorld(c, state.map) })) }));
await writeFile(`${root}/review.json`, JSON.stringify({ mapId: state.map.id, sourceFiles: files,
  coordinateStatus: 'Flat projection validated against native VHUB imagery; visual code review required', inventory }, null, 2));
const proposals = inventory.filter(p => p.observations.length === 1).map(p => p.observations[0]);
const perSheet = 24, cellW = 350, cellH = 250;
for (let start = 0; start < proposals.length; start += perSheet) {
  const items = proposals.slice(start, start + perSheet), composites = [];
  for (let i = 0; i < items.length; i++) {
    const c = items[i], left = Math.max(0, Math.round(c.x) - 80), top = Math.max(0, Math.round(c.y) - 60);
    const crop = await sharp(`${root}/map.png`).extract({ left, top, width: 160, height: 120 })
      .rotate(-(c.angle || 0), { background: '#fff' }).resize(340, 210, { fit: 'contain', background: '#fff' }).png().toBuffer();
    const x = i % 4 * cellW, y = Math.floor(i / 4) * cellH;
    const title = `<svg width="350" height="35"><rect width="350" height="35" fill="white"/><text x="8" y="23" font-family="Arial" font-size="18">${start + i + 1}. ${c.code} (${c.confidence})</text></svg>`;
    composites.push({ input: Buffer.from(title), left: x, top: y }, { input: crop, left: x + 5, top: y + 35 });
  }
  await sharp({ create: { width: cellW * 4, height: cellH * Math.ceil(items.length / 4), channels: 3, background: '#ddd' } })
    .composite(composites).png().toFile(`${root}/pending-review-${start / perSheet + 1}.png`);
}
await writeFile(`${root}/review-proposals.json`, JSON.stringify(proposals, null, 2));
console.log(JSON.stringify({ pending: inventory.length, unique: proposals.length,
  ambiguous: inventory.filter(p => p.observations.length > 1).map(p => p.code), files }));
