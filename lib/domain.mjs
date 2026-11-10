import { createHash } from 'node:crypto';

export function codeOf(value) {
  const code = String(value ?? '').trim().toUpperCase();
  if (!/^[A-ZĐ][A-ZĐ0-9.]*(?:-\d+[A-ZĐ]?)+$/u.test(code) || code.length > 80)
    throw new Error('Mã căn không hợp lệ. Ví dụ: AS76-09.');
  return code;
}
export function codeParts(value) {
  const code = codeOf(value);
  const i = code.lastIndexOf('-');
  return { prefix: code.slice(0, i), number: Number.parseInt(code.slice(i + 1), 10), code };
}
export function nearestAnchors(code, hotspots, count = 5) {
  const target = codeParts(code);
  return hotspots.flatMap(h => {
    try {
      const p = codeParts(h.code);
      if (p.prefix !== target.prefix || p.code === target.code || h.duplicate) return [];
      return [{ ...h, distance: Math.abs(p.number - target.number), sameParity: p.number % 2 === target.number % 2 }];
    } catch { return []; }
  }).sort((a, b) => a.distance - b.distance || Number(b.sameParity) - Number(a.sameParity) || a.code.localeCompare(b.code)).slice(0, count);
}
const rad = n => n * Math.PI / 180;
const deg = n => n * 180 / Math.PI;
export function pixelToWorld(point, map) {
  validatePoint(point, map.width, map.height);
  const scale = 2 * Math.tan(rad(map.hfov) / 2) / map.width;
  const x = (point.x - map.width / 2) * scale;
  const y = (point.y - map.height / 2) * scale;
  return { ath: deg(Math.atan(x)), atv: deg(Math.atan(y / Math.sqrt(1 + x * x))) };
}
function solveAffine(pairs) {
  const totalWeight = pairs.reduce((sum, p) => sum + p.weight, 0);
  const mean = key => pairs.reduce((sum, p) => sum + p[key] * p.weight, 0) / totalWeight;
  const ma = mean('ath'), mv = mean('atv'), mx = mean('x'), my = mean('y');
  let aa = 0, av = 0, vv = 0, xa = 0, xv = 0, ya = 0, yv = 0;
  for (const p of pairs) {
    const a = p.ath - ma, v = p.atv - mv, x = p.x - mx, y = p.y - my;
    aa += p.weight * a * a; av += p.weight * a * v; vv += p.weight * v * v;
    xa += p.weight * x * a; xv += p.weight * x * v;
    ya += p.weight * y * a; yv += p.weight * y * v;
  }
  const det = aa * vv - av * av;
  if (det < 1e-12) throw new Error('KhÃ´ng Ä‘á»§ mÃ³c VHUB phÃ¢n bá»‘ quanh Ã´ Ä‘áº¥t Ä‘á»ƒ hiá»‡u chuáº©n tá»a Ä‘á»™.');
  const xAth = (xa * vv - xv * av) / det, xAtv = (xv * aa - xa * av) / det;
  const yAth = (ya * vv - yv * av) / det, yAtv = (yv * aa - ya * av) / det;
  return { xAth, xAtv, xOffset: mx - xAth * ma - xAtv * mv,
    yAth, yAtv, yOffset: my - yAth * ma - yAtv * mv };
}
export function calibrateImageWorld(scan, hotspots, map, targetCode) {
  const byCode = new Map();
  for (const c of scan.candidates || []) {
    let code;
    try { code = codeOf(c.code); } catch { continue; }
    if (!Array.isArray(c.polygon) || c.polygon.length < 3 || !Number.isFinite(c.x) || !Number.isFinite(c.y) || (c.confidence || 0) < 0.55) continue;
    const prior = byCode.get(code);
    if (!prior || prior.confidence < c.confidence) byCode.set(code, c);
  }
  const anchors = new Map();
  for (const h of hotspots) {
    if (h.duplicate || !Number.isFinite(h.ath) || !Number.isFinite(h.atv)) continue;
    const c = byCode.get(h.code);
    if (!c || h.code === targetCode) continue;
    const x = scan.left + c.x, y = scan.top + c.y;
    if (x >= 0 && y >= 0 && x < map.width && y < map.height)
      anchors.set(h.code, { ath: h.ath, atv: h.atv, x, y, weight: Math.max(0.25, c.confidence ** 2) });
  }
  if (anchors.size < 4) throw new Error('ChÆ°a cÃ³ Ä‘á»§ mÃ£ lÃ´ cÃ³ marker sẵn quanh vÃ¹ng nÃ y Ä‘á»ƒ hiá»‡u chuáº©n. HÃ£y dÃ² vÃ¹ng rá»™ng hÆ¡n.');
  let pairs = [...anchors.values()], model = solveAffine(pairs);
  const residual = p => Math.hypot(model.xAth * p.ath + model.xAtv * p.atv + model.xOffset - p.x,
    model.yAth * p.ath + model.yAtv * p.atv + model.yOffset - p.y);
  const errors = pairs.map(residual).sort((a, b) => a - b), median = errors[Math.floor(errors.length / 2)];
  pairs = pairs.filter(p => residual(p) <= Math.max(55, median * 2.5));
  if (pairs.length < 4) throw new Error('CÃ¡c marker láº¥y lÃ m má»‘c khÃ´ng khá»›p áº£nh quÃ©t. HÃ£y dÃ² láº¡i trÆ°á»›c khi Ä‘áº·t nhÃ¡p.');
  model = solveAffine(pairs);
  const rms = Math.sqrt(pairs.reduce((sum, p) => sum + residual(p) ** 2, 0) / pairs.length);
  if (!Number.isFinite(rms) || rms > 55) throw new Error('Hiá»‡u chuáº©n báº£n Ä‘á»“ khÃ´ng Ä‘á»§ chÃ­nh xÃ¡c. HÃ£y dÃ² láº¡i vÃ¹ng nÃ y.');
  return { ...model, anchorCount: pairs.length, rms };
}
export function pixelToWorldCalibrated(point, calibration) {
  const det = calibration.xAth * calibration.yAtv - calibration.xAtv * calibration.yAth;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) throw new Error('Hiá»‡u chuáº©n tá»a Ä‘á»™ khÃ´ng há»£p lá»‡.');
  const x = point.x - calibration.xOffset, y = point.y - calibration.yOffset;
  return { ath: (x * calibration.yAtv - y * calibration.xAtv) / det,
    atv: (y * calibration.xAth - x * calibration.yAth) / det };
}
export function worldToPixelCalibrated(point, calibration) {
  if (![point.ath, point.atv].every(Number.isFinite)) throw new Error('Tá»a Ä‘á»™ hotspot khÃ´ng há»£p lá»‡.');
  return { x: calibration.xAth * point.ath + calibration.xAtv * point.atv + calibration.xOffset,
    y: calibration.yAth * point.ath + calibration.yAtv * point.atv + calibration.yOffset };
}
export function worldToPixel(point, map) {
  if (![point.ath, point.atv].every(Number.isFinite)) throw new Error('Tọa độ hotspot không hợp lệ.');
  const scale = map.width / (2 * Math.tan(rad(map.hfov) / 2));
  return { x: map.width / 2 + Math.tan(rad(point.ath)) * scale,
    y: map.height / 2 + Math.tan(rad(point.atv)) / Math.cos(rad(point.ath)) * scale };
}
export function sameWorldPoint(a, b, map, tolerance = 3) {
  const p = worldToPixel(a, map), q = worldToPixel(b, map);
  return Math.hypot(p.x - q.x, p.y - q.y) <= tolerance;
}
export function validatePoint(p, width, height) {
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.y < 0 || p.x >= width || p.y >= height)
    throw new Error('Vị trí nằm ngoài ảnh mặt bằng.');
}
export function tileUrl(template, row, col, origin = 'https://vhub.com.vn') {
  const url = template.replace(/%(0*)([vh])/g, (_, zeroes, axis) => String(axis === 'v' ? row : col).padStart(zeroes.length + 1, '0'));
  const result = new URL(url, origin);
  if (!/(?:^|\.)vhub\.com\.vn$/u.test(result.hostname) || !result.pathname.startsWith('/tours/')) throw new Error('Nguồn ảnh không được hỗ trợ.');
  return result.href;
}
export function fingerprint(descriptor, overview) {
  return createHash('sha256').update(JSON.stringify(descriptor)).update(overview).digest('hex');
}
export function normalizeProducts(products) {
  const seen = new Set();
  return products.flatMap(p => {
    let code;
    try { code = codeOf(p.productCode); } catch { return []; }
    if (seen.has(code)) throw new Error(`Dữ liệu sản phẩm có mã trùng: ${code}. Dừng đồng bộ để kiểm tra.`);
    seen.add(code);
    return [{ code, id: p.id, available: p.stateLine === 'available' && p.isNotShow !== true,
      status: p.stateLineName || p.status || p.stateLine,
      area: Number(p.landArea) || null, price: Number(p.totalPrice) || null,
      group: p.fundGroupsSellName || '', subdivision: p.subdivisionName || '' }];
  });
}
export function normalizeHotspots(hotspots, scene) {
  const counts = new Map();
  const result = hotspots.flatMap(h => {
    if (String(h.sceneName).toLowerCase() !== scene.toLowerCase() || h.isAmenity || h.isPolygon || h.isImageHotspot || h.isRuler) return [];
    if (h.hotspotType && h.hotspotType !== 'product') return [];
    let code;
    try { code = codeOf(h.productCode || h.hotspotCode); } catch { return []; }
    if (!Number.isFinite(h.ath) || !Number.isFinite(h.atv)) return [];
    counts.set(code, (counts.get(code) || 0) + 1);
    return [{ id: h.id, code, ath: h.ath, atv: h.atv }];
  });
  return result.map(h => ({ ...h, duplicate: counts.get(h.code) > 1 }));
}
export function pendingProducts(products, hotspots) {
  const assigned = new Set(hotspots.map(h => h.code));
  return products.filter(p => p.available && !assigned.has(p.code)).sort((a, b) => a.code.localeCompare(b.code, 'vi', { numeric: true }));
}
export function approvalKey(mapId, code) { return `${mapId}:${codeOf(code)}`; }
export function assertDraftOwnership(nativeCount, ownCodes) {
  if (nativeCount !== ownCodes.length) throw new Error('Bản nháp trên VHUB khác với bản nháp do tool tạo. Hãy xử lý trên VHUB trước khi tiếp tục.');
}
export function approvePosition({ code, typedCode, point, scan, currentMapId }) {
  code = codeOf(code);
  if (codeOf(typedCode) !== code) throw new Error('Mã xác nhận chưa khớp căn đang chọn.');
  if (scan.code !== code || scan.mapId !== currentMapId) throw new Error('Ảnh xem trước đã cũ hoặc thuộc căn khác. Hãy dò lại.');
  validatePoint(point, scan.width, scan.height);
  return { code, x: scan.left + point.x, y: scan.top + point.y, mapId: currentMapId, verifiedAt: new Date().toISOString(), source: 'user-reviewed' };
}
