import http from 'node:http';
import { randomUUID, randomBytes } from 'node:crypto';
import { readFile, mkdir, writeFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VhubDriver, PROJECTS } from './lib/driver.mjs';
import { Store } from './lib/store.mjs';
import { buildPatch } from './lib/tiles.mjs';
import { ocrConfig, readLabels } from './lib/ocr.mjs';
import { codeOf, nearestAnchors, worldToPixel, worldToPixelCalibrated, pixelToWorldCalibrated,
  calibrateImageWorld, approvalKey, approvePosition } from './lib/domain.mjs';

const root = dirname(fileURLToPath(import.meta.url)), dataRoot = join(root, '.data');
const MAX_BATCH = 50;
await mkdir(join(dataRoot, 'scans'), { recursive: true });
const store = new Store(dataRoot); await store.init();
const scans = new Map();
for (const name of await readdir(join(dataRoot, 'scans'))) {
  if (!/^[a-f0-9-]+\.json$/.test(name)) continue;
  const scan = JSON.parse(await readFile(join(dataRoot, 'scans', name), 'utf8'));
  scans.set(scan.id, scan);
}
const scanSessionId = randomUUID();
let job = null, abort = null;
let anchorVersion = null, anchorOptions = {};
const notify = message => { if (job?.status === 'running') { job.message = message; job.updatedAt = new Date().toISOString(); } };
const driver = new VhubDriver(dataRoot, notify);
const key = randomBytes(24).toString('hex');
const port = Number(process.env.PORT || 4318), origin = `http://127.0.0.1:${port}`;
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT không hợp lệ.');

function state() {
  const summary = driver.summary();
  if (anchorVersion !== driver.syncedAt) {
    anchorOptions = Object.fromEntries(driver.pending.map(p => [p.code, nearestAnchors(p.code, driver.hotspots)]));
    anchorVersion = driver.syncedAt;
  }
  const approvals = Object.values(store.data.approvals).filter(p => p.mapId === driver.map?.id);
  const recognizedCodes = [...new Set([...scans.values()].filter(s => s.mapId === driver.map?.id)
    .flatMap(s => s.candidates.map(c => c.code)))];
  return { ...summary, projects: Object.values(PROJECTS), approvals, recognizedCodes, anchorOptions, ocrReady: ocrConfig().ready, job,
    history: store.data.history.slice(0, 25) };
}
function worldToMapPixel(world) {
  const calibration = Object.values(store.data.approvals).find(p => p.mapId === driver.map?.id && p.coordinateCalibration)?.coordinateCalibration;
  return calibration ? worldToPixelCalibrated(world, calibration) : worldToPixel(world, driver.map);
}
function startJob(action, callback, cancellable = false) {
  if (job?.status === 'running') throw new Error('Tool đang xử lý một việc khác.');
  job = { id: randomUUID(), action, status: 'running', message: 'Đang bắt đầu…', startedAt: new Date().toISOString(), cancellable };
  abort = new AbortController();
  const active = job;
  Promise.resolve().then(() => callback(abort.signal)).then(async result => {
    active.status = 'completed'; active.message = 'Hoàn tất'; active.result = result;
  }).catch(error => {
    active.status = abort.signal.aborted ? 'cancelled' : 'failed';
    active.message = String(error.message || error).split('Call log:')[0].slice(0, 1800);
  }).finally(() => { active.finishedAt = new Date().toISOString(); });
  return { jobId: active.id };
}
async function persistScan(scan) {
  scans.set(scan.id, scan);
  await writeFile(join(dataRoot, 'scans', `${scan.id}.json`), JSON.stringify(scan));
  return scan;
}
async function scanCode(body, signal) {
  if (!driver.map) throw new Error('Bấm Kết nối & đồng bộ trước.');
  const code = codeOf(body.code);
  if (!driver.pending.some(p => p.code === code)) throw new Error('Căn này không còn nằm trong danh sách chờ gắn.');
  if (!body.force) {
    const reusable = [...scans.values()].reverse().find(s => s.sessionId === scanSessionId && s.mapId === driver.map.id && s.candidates.some(c => c.code === code));
    if (reusable) return persistScan({ ...reusable, id: randomUUID(), code, reused: true });
  }
  const anchors = nearestAnchors(code, driver.hotspots);
  const anchor = body.anchorCode ? anchors.find(a => a.code === body.anchorCode) : anchors[0];
  const approved = store.data.approvals[approvalKey(driver.map.id, code)];
  if (!anchor && !approved && !body.currentView) throw new Error('Chưa có mốc cùng dãy mã. Dùng Lấy vùng đang xem sau khi tự di chuyển bản đồ tới dãy này.');
  let center = approved || (anchor && worldToMapPixel(anchor));
  if (body.currentView) {
    const world = await driver.page.evaluate(() => { const k = document.getElementById('krpanoSWFObject'); return { ath: k.get('view.hlookat'), atv: k.get('view.vlookat') }; });
    center = worldToMapPixel(world);
  }
  const id = randomUUID(), output = join(dataRoot, 'scans', `${id}.png`);
  const bounds = await buildPatch({ context: driver.context, map: driver.map, center, radius: body.radius,
    root: dataRoot, output, notify, signal });
  const scan = { id, imageId: id, code, mapId: driver.map.id, ...bounds, anchorCode: anchor?.code || null,
    candidates: [], createdAt: new Date().toISOString(), sessionId: scanSessionId };
  // Keep the readable patch even if OCR is cancelled or its dependencies are absent.
  await persistScan(scan);
  if (body.ocr !== false && ocrConfig().ready) {
    scan.candidates = (await readLabels(output, notify, signal, code)).map(c => ({ ...c, id: randomUUID() }));
  } else scan.warning = 'Vùng ảnh đã sẵn sàng. Có thể chọn vị trí trực tiếp; chạy CAI_OCR.bat để bật dò mã tự động.';
  return persistScan(scan);
}
async function bodyOf(req) {
  let data = ''; for await (const chunk of req) { data += chunk; if (data.length > 256000) throw new Error('Yêu cầu quá lớn.'); }
  return data ? JSON.parse(data) : {};
}
function json(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); }
async function post(path, body) {
  if (path === '/api/cancel') {
    if (job?.status !== 'running' || !job.cancellable) throw new Error('Chỉ dừng được công việc dò ảnh đang chạy.');
    notify('Đang dừng dò mã…'); abort.abort(); return { ok: true };
  }
  if (path === '/api/connect' || path === '/api/sync') return startJob('sync', async () => {
    if (body.projectId && body.projectId !== driver.projectId) {
      if (driver.ownDrafts.size) throw new Error('Hãy lưu hoặc hủy nháp do tool tạo trước khi đổi dự án.');
      if (driver.page && driver.connected && driver.map) {
        try {
          await driver.ensureManager();
          if (await driver.nativeDraftCount())
            throw new Error('VHUB còn bản nháp ở dự án hiện tại. Hãy xử lý nháp rồi mới đổi dự án.');
        } catch (error) {
          if (error.message.includes('còn bản nháp')) throw error;
          throw new Error(`Không kiểm tra được bản nháp ở dự án hiện tại: ${error.message}`);
        }
      }
      driver.setProject(body.projectId);
      if (driver.page && !driver.page.isClosed()) await driver.page.goto(driver.url, { waitUntil: 'domcontentloaded' });
    }
    const result = await driver.sync(); await store.log('sync', { pending: result.pending.length, assigned: result.assignedCount });
    return { pending: result.pending.length, assigned: result.assignedCount };
  });
  if (path === '/api/scan') return startJob('scan', signal => scanCode(body, signal), true);
  if (path === '/api/scan-batch') return startJob('scan-batch', async signal => {
    const codes = [...new Set((body.codes || []).map(codeOf))];
    if (!codes.length || codes.length > MAX_BATCH) throw new Error(`Chọn từ 1 tới ${MAX_BATCH} căn mỗi lượt dò.`);
    const results = [];
    for (const code of codes) { signal.throwIfAborted(); results.push(await scanCode({ code, radius: body.radius }, signal)); }
    return { scanIds: results.map(s => s.id), codes };
  }, true);
  if (job?.status === 'running') throw new Error('Tool đang xử lý. Hãy chờ công việc hiện tại hoàn tất.');
  if (path === '/api/approve') {
    const scan = scans.get(body.scanId);
    if (scan && scan.sessionId !== scanSessionId) throw new Error('Scan belongs to an earlier run. Scan it again before approval.');
    if (!scan) throw new Error('Không tìm thấy ảnh xem trước. Hãy dò lại.');
    if (!driver.pending.some(p => p.code === body.code)) throw new Error('Căn này không còn chờ gắn.');
    const position = approvePosition({ ...body, scan, currentMapId: driver.map?.id });
    const calibration = calibrateImageWorld(scan, driver.hotspots, driver.map, position.code);
    const world = pixelToWorldCalibrated({ x: position.x, y: position.y }, calibration);
    position.ath = world.ath; position.atv = world.atv; position.coordinateCalibration = calibration;
    position.scanId = scan.id;
    store.data.approvals[approvalKey(position.mapId, position.code)] = position;
    await store.log('approve', { codes: [position.code] }); return { position };
  }
  if (path === '/api/unapprove') {
    const code = codeOf(body.code);
    const key = approvalKey(driver.map?.id, code);
    if (!store.data.approvals[key]) throw new Error('Căn này chưa có vị trí đã xác nhận.');
    if (driver.ownDrafts.has(code)) throw new Error('Căn này đang có bản nháp. Hủy nháp trước khi xóa vị trí.');
    delete store.data.approvals[key];
    await store.log('unapprove', { codes: [code] }); return { code };
  }
  if (path === '/api/zoom') return startJob('zoom', async () => {
    const code = codeOf(body.code);
    const position = store.data.approvals[approvalKey(driver.map?.id, code)];
    const anchor = driver.hotspots.find(h => h.code === body.anchorCode) || nearestAnchors(code, driver.hotspots)[0];
    const point = position || anchor;
    if (!point) throw new Error('Chưa có vị trí hoặc mốc cùng dãy cho căn này.');
    await driver.zoom(point); await driver.page.bringToFront();
    return { code, anchorCode: position ? null : anchor.code };
  });
  if (path === '/api/stage') return startJob('stage', async () => {
    const codes = [...new Set((body.codes || []).map(codeOf))];
    const positions = codes.map(c => store.data.approvals[approvalKey(driver.map?.id, c)]);
    if (positions.some(p => !p)) throw new Error('Chỉ đặt các căn đã xác nhận vị trí.');
    for (const position of positions) {
      const scan = position.scanId && scans.get(position.scanId);
      if (!scan || scan.sessionId !== scanSessionId || !position.coordinateCalibration ||
          !Number.isFinite(position.ath) || !Number.isFinite(position.atv))
        throw new Error(`Vị trí ${position.code} cần được dò và xác nhận lại để hiệu chuẩn bản đồ.`);
    }
    const result = await driver.stage(positions); await store.log('stage', { codes }); return result;
  });
  if (path === '/api/save') return startJob('save', async () => {
    const result = await driver.commit(); await store.log('save', { codes: result.saved }); return { saved: result.saved };
  });
  if (path === '/api/discard') return startJob('discard', async () => {
    const codes = [...driver.ownDrafts]; await driver.discard(); await store.log('discard', { codes }); return { discarded: codes };
  });
  throw new Error('Thao tác chưa được hỗ trợ.');
}
const server = http.createServer(async (req, res) => {
  try {
    if (req.headers.host !== `127.0.0.1:${port}` || (req.headers.origin && req.headers.origin !== origin)) return json(res, 403, { error: 'Chỉ truy cập từ giao diện cục bộ.' });
    const url = new URL(req.url, origin), path = url.pathname;
    if (path === '/health') return json(res, 200, { ok: true, name: 'vhub-hotspot-assistant' });
    if (path.startsWith('/api/')) {
      if (req.headers['x-tool-key'] !== key) return json(res, 403, { error: 'Hãy tải lại giao diện tool.' });
      if (req.method === 'GET' && path === '/api/state') return json(res, 200, state());
      if (req.method === 'GET' && path === '/api/export') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="vhub-positions.json"' });
        return res.end(JSON.stringify({ version: 1, approvals: Object.values(store.data.approvals), history: store.data.history }, null, 2));
      }
      if (req.method === 'GET' && path.startsWith('/api/preview/')) {
        const id = path.slice('/api/preview/'.length), scan = scans.get(id);
        if (!scan) return json(res, 404, { error: 'Không tìm thấy vùng ảnh.' });
        const buffer = await readFile(join(dataRoot, 'scans', `${scan.imageId}.png`));
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' }); return res.end(buffer);
      }
      if (req.method === 'POST' && req.headers['content-type']?.startsWith('application/json')) return json(res, 200, await post(path, await bodyOf(req)));
      return json(res, 404, { error: 'Không tìm thấy thao tác.' });
    }
    const staticFiles = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
    if (!staticFiles[path] || req.method !== 'GET') return json(res, 404, { error: 'Không tìm thấy.' });
    const [file, type] = staticFiles[path];
    let content = await readFile(join(root, 'public', file), 'utf8');
    if (file === 'index.html') content = content.replace('__TOOL_KEY__', key);
    res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'" });
    res.end(content);
  } catch (error) { json(res, 400, { error: String(error.message).split('Call log:')[0].slice(0, 1800) }); }
});
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Cổng ${port} đang được dùng. Mở ${origin} hoặc đặt PORT khác.` : error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', async () => {
  console.log(`VHUB Hotspot Assistant: ${origin}`);
  if (process.argv.includes('--open')) {
    try { await driver.connect(); const tab = driver.context.pages().find(p => p.url().startsWith(origin)) || await driver.context.newPage(); await tab.goto(origin); await tab.bringToFront(); }
    catch { console.log('Mở địa chỉ local ở trên bằng trình duyệt để dùng tool.'); }
  }
});
process.on('SIGINT', () => { abort?.abort(); server.close(() => process.exit(0)); });
