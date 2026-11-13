import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ocrConfig } from './ocr.mjs';
import { calibrateImageWorld } from './domain.mjs';

export async function registerScan(driver, scan, source, screenshot) {
  await driver.ensureManager();
  const page = driver.page;
  const geometry = () => page.evaluate(() => {
    const k = document.getElementById('krpanoSWFObject');
    const r = k.getBoundingClientRect();
    const panels = [...document.querySelectorAll('aside')].map(p => p.getBoundingClientRect()).filter(p => p.width && p.height);
    const right = Math.min(r.right, ...panels.filter(p => p.left > r.left).map(p => p.left));
    return { view: [k.get('xml.scene'), k.get('view.hlookat'), k.get('view.vlookat'), k.get('view.fov')],
      rect: { left: r.left, top: r.top },
      regions: [{ x: r.left, y: r.top + 100, width: Math.max(0, right - r.left - 10), height: Math.max(0, r.height - 250) }] };
  });
  await page.waitForTimeout(1500);
  const before = await geometry();
  if (String(before.view[0]).toLowerCase() !== driver.scene) throw new Error('Hãy mở lại mặt bằng quỹ căn.');
  await page.screenshot({ path: screenshot });
  const result = await new Promise((resolve, reject) => {
    const child = spawn(ocrConfig().python, [fileURLToPath(new URL('../scripts/register_image.py', import.meta.url))],
      { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    let output = '', errors = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { errors = (errors + data).slice(-1500); });
    child.on('error', reject);
    child.on('close', code => {
      try { const value = JSON.parse(output); if (code || value.error) throw new Error(value.error || errors); resolve(value); }
      catch (error) { reject(new Error(`Chưa căn chỉnh được ảnh VHUB: ${error.message}. Đưa VHUB tới vùng ảnh đang dò rồi thử lại.`)); }
    });
    child.stdin.end(JSON.stringify({ source, screen: screenshot, regions: before.regions }));
  });
  const after = await geometry();
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Góc nhìn VHUB đã thay đổi trong lúc căn chỉnh. Hãy thử lại.');
  const worlds = await page.evaluate(({ pairs, rect }) => {
    const k = document.getElementById('krpanoSWFObject');
    return pairs.map(p => { const w = k.screentosphere(p.screen[0] - rect.left, p.screen[1] - rect.top); return { ath: w.x, atv: w.y }; });
  }, { pairs: result.pairs, rect: before.rect });
  const candidates = result.pairs.map((p, i) => ({ code: `F-${i}`, x: p.image[0], y: p.image[1], confidence: 1,
    polygon: [[0, 0], [1, 0], [1, 1]] }));
  const hotspots = worlds.map((p, i) => ({ ...p, code: `F-${i}` }));
  const calibration = calibrateImageWorld({ ...scan, candidates }, hotspots, driver.map, 'NONE');
  if (calibration.rms > 1.5) throw new Error('Sai lệch quy đổi ảnh vượt 1,5 pixel. Hãy căn chỉnh lại.');
  return { ...calibration, method: 'image-registration', mapId: driver.map.id,
    matchedFeatures: result.matchedFeatures, validationCount: result.validationCount,
    validationP95: result.validationP95, validationRms: result.validationRms };
}
