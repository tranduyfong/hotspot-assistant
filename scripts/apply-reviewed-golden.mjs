// Only accepts codes individually inspected in the generated review sheets.
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { pixelToWorld } from '../lib/domain.mjs';
const root = '.data/run/golden-audit';
const base = 'http://127.0.0.1:4318';
const html = await (await fetch(base)).text();
const key = html.split('name="tool-key" content="')[1].split('"')[0];
async function api(path, body) {
  const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'X-Tool-Key': key, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const value = await r.json(); if (!r.ok) throw new Error(value.error); return value;
}
async function job(path, body) {
  const { jobId } = await api(path, body); let last;
  for (;;) {
    const s = await api('/api/state'), j = s.job;
    if (j?.id !== jobId) throw new Error('Job changed outside this run');
    if (j.message !== last) { console.log(j.message); last = j.message; }
    if (j.status === 'completed') return j.result;
    if (j.status !== 'running') throw new Error(j.message);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}
const review = JSON.parse(await readFile(`${root}/review.json`));
const verified = JSON.parse(await readFile(`${root}/visually-reviewed.json`));
const state = await api('/api/state');
if (state.tour !== 'vinhomes-golden-city' || state.map?.id !== review.mapId || state.job?.status === 'running' || state.draftCodes.length)
  throw new Error('Golden City is not ready or has active drafts');
const pending = new Set(state.pending.map(p => p.code));
const selected = verified.filter(code => pending.has(code)).slice(0, Number(process.argv[2] || 1));
const browser = await chromium.connectOverCDP('http://127.0.0.1:9228');
const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('/vinhomes-golden-city/mat-bang-quy-can'));
if (!page) throw new Error('Golden City page is not open');
const report = [];
for (const code of selected) {
  const item = review.inventory.find(p => p.code === code);
  if (item?.observations.length !== 1) throw new Error(`Ambiguous ${code}`);
  const c = item.observations[0];
  const world = pixelToWorld(c, state.map);
  await page.evaluate(({ world, scene }) => {
    const k = document.getElementById('krpanoSWFObject');
    if (String(k.get('xml.scene')).toLowerCase() !== scene) throw new Error('Scene changed');
    k.set('view.hlookat', world.ath); k.set('view.vlookat', world.atv);
  }, { world, scene: state.scene });
  const scan = await job('/api/scan', { code, ocr: false, force: true, currentView: true, radius: 800 });
  const point = { x: c.x - scan.left, y: c.y - scan.top };
  await api('/api/approve', { code, scanId: scan.id, point });
  report.push({ code, x: c.x, y: c.y, checkedBy: 'assistant-visual-review', scanId: scan.id });
  await writeFile(`${root}/apply-reviewed-progress.json`, JSON.stringify(report, null, 2));
}
if (selected.length) {
  await job('/api/stage', { codes: selected });
  const saved = await job('/api/save', {});
  await writeFile(`${root}/saved-${Date.now()}.json`, JSON.stringify({ report, saved }, null, 2));
  console.log('SAVED', JSON.stringify(saved));
} else console.log('No remaining selected codes');
process.exit();
