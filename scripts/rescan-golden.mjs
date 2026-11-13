import { readFile, writeFile } from 'node:fs/promises';
import { readLabels } from '../lib/ocr.mjs';
import sharp from 'sharp';
const root = '.data/run/golden-audit';
const data = JSON.parse(await readFile(`${root}/inventory.json`));
const angle = Number(process.argv[2] || 0);
if (![0, 90, -15, 15, -35, 55].includes(angle)) throw new Error('Unsupported audit angle');
// Map overview inspection: all five developed subdivisions lie inside this ROI.
// The first full-map pass remains available for codes outside it.
const roi = process.argv.includes('--central')
  ? { left: 6800, top: 3300, width: 5200, height: 4700 }
  : { left: 2000, top: 3000, width: 14500, height: 5400 };
const source = `${root}/map-roi-${angle}.png`;
await sharp(`${root}/map.png`).extract(roi).png().toFile(source);
const candidates = await readLabels(source, console.log, null, null, {
  project: 'vinhomes-golden-city', angles: [angle], magnification: 1.5,
  knownCodes: [...new Set([...data.products, ...data.hotspots].map(p => p.code))],
});
for (const c of candidates) {
  c.x += roi.left; c.y += roi.top;
  c.textBox = c.textBox.map(([x, y]) => [x + roi.left, y + roi.top]);
}
await writeFile(`${root}/candidates-${angle}.json`, JSON.stringify(candidates));
console.log('DONE', angle, candidates.length);
