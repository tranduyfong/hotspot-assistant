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
  if (result.origin !== 'https://vhub.com.vn' || !result.pathname.startsWith('/tours/')) throw new Error('Nguồn ảnh không được hỗ trợ.');
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
