// Live verification: sync + OCR; optional local approval. Never stages or saves a hotspot.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { pixelToWorld } from '../lib/domain.mjs';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9228');
try {
  const context = browser.contexts()[0];
  const page = context.pages().find(p => p.url().startsWith('http://127.0.0.1:4318')) || await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:4318');
  const getState = () => page.evaluate(async () => (await fetch('/api/state', { headers: { 'X-Tool-Key': document.querySelector('meta[name=tool-key]').content } })).json());
  const waitJob = async (action, timeout = 90000, jobId) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const value = await getState();
      if (value.job?.action === action && (!jobId || value.job.id === jobId) && value.job.status !== 'running') return value;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error(`Timeout while waiting for ${action}`);
  };
  const clickJob = async (button, path, action, timeout) => {
    const pending = page.waitForResponse(r => new URL(r.url()).pathname === path && r.request().method() === 'POST');
    await button.click();
    const result = await (await pending).json();
    assert.ok(result.jobId, result.error);
    const state = await waitJob(action, timeout, result.jobId);
    await page.bringToFront();
    await page.waitForFunction(() => !document.getElementById('connect').disabled, undefined, { timeout: 15000 });
    return state;
  };
  if (process.argv.includes('--sync')) {
    await clickJob(page.locator('#connect'), '/api/connect', 'sync', 90000);
  }
  let state = await getState();
  assert.equal(state.job?.status, 'completed', state.job?.message);
  assert.ok(state.pending.length > 0);
  assert.ok(state.assignedCount >= 806);
  console.log(JSON.stringify({ pending: state.pending.length, assigned: state.assignedCount, ocrReady: state.ocrReady,
    map: { width: state.map.width, height: state.map.height }, browserErrors: errors }));
  if (process.argv.includes('--scan')) {
    const code = 'AS76-09';
    await page.waitForFunction(() => !document.getElementById('connect').disabled, undefined, { timeout: 15000 });
    await page.locator(`button[data-code="${code}"]`).click();
    assert.equal(await page.locator('#target-title').innerText(), code);
    await page.getByLabel('Bán kính vùng ảnh').selectOption('800');
    await clickJob(page.getByRole('button', { name: 'Dò mã', exact: true }), '/api/scan', 'scan', 300000);
    state = await getState();
    assert.equal(state.job.status, 'completed', state.job.message);
    const result = state.job.result;
    assert.equal(result.code, code);
    console.log(JSON.stringify({ scan: { code, labels: result.candidates.length, matches: result.candidates.filter(c => c.code === code), bounds: { left: result.left, top: result.top, width: result.width, height: result.height } }, browserErrors: errors }));
    await page.locator('#map-canvas').waitFor({ state: 'visible' });
  }
  assert.deepEqual(errors, []);
  await mkdir('.data/qa', { recursive: true });
  if (process.argv.includes('--review-local')) {
    await page.locator('#confirm-code').fill('AS76-09');
    assert.equal(await page.locator('#approve').isEnabled(), true);
    const pending = page.waitForResponse(r => new URL(r.url()).pathname === '/api/approve' && r.request().method() === 'POST');
    await page.locator('#approve').click();
    const result = await (await pending).json();
    assert.equal(result.position?.code, 'AS76-09', result.error);
    state = await getState();
    assert.ok(state.approvals.some(p => p.code === 'AS76-09'));
    assert.equal(state.draftCodes.length, 0);
    console.log('Local position review passed; no live hotspot created.');
  }
  if (process.argv.includes('--zoom')) {
    await clickJob(page.locator('#zoom-vhub'), '/api/zoom', 'zoom', 30000);
    state = await getState();
    const position = state.approvals.find(p => p.code === 'AS76-09');
    assert.ok(position);
    const expected = pixelToWorld(position, state.map);
    const native = context.pages().find(p => p.url().includes('/du-an/vinhomes-sai-gon-park/'));
    const actual = await native.evaluate(world => {
      const k = document.getElementById('krpanoSWFObject'), p = k.spheretoscreen(world.ath, world.atv);
      const r = document.getElementById('lockcan-pano').getBoundingClientRect();
      const el = document.elementFromPoint(p.x + r.left, p.y + r.top);
      const q = k.screentosphere(p.x, p.y);
      return { ath: q.x, atv: q.y, visible: !!el && (!!el.closest('#lockcan-pano') || !!el.closest('.lc-fund-pin')) && !el.closest('aside') };
    }, expected);
    assert.ok(Math.abs(expected.ath - actual.ath) < .000001);
    assert.ok(Math.abs(expected.atv - actual.atv) < .000001);
    assert.ok(actual.visible, 'Reviewed point must be visible outside the hotspot manager.');
    await native.screenshot({ path: '.data/qa/vhub-position-AS76-09.png' });
    assert.equal(state.draftCodes.length, 0);
    console.log('Verified native VHUB zoom to the reviewed coordinate; no live hotspot created.');
  }
  await page.setViewportSize({ width: 1600, height: 1050 });
  await page.waitForTimeout(300);
  assert.ok(await page.evaluate(() => document.documentElement.scrollHeight < 2000), 'Desktop layout must keep the list and image in scrollable panels.');
  await page.screenshot({ path: '.data/qa/desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Mobile layout must not overflow horizontally.');
  await page.screenshot({ path: '.data/qa/mobile.png', fullPage: true });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.clearDeviceMetricsOverride'); await cdp.detach();
  await page.bringToFront();
  console.log('Read-only live verification passed. No hotspots staged or saved.');
} finally { await browser.close(); }
