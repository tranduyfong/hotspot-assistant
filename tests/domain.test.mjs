import test from 'node:test';
import assert from 'node:assert/strict';
import { codeOf, nearestAnchors, pixelToWorld, worldToPixel, tileUrl, normalizeHotspots,
  normalizeProducts, pendingProducts, approvePosition, assertDraftOwnership, fingerprint, sameWorldPoint } from '../lib/domain.mjs';

test('giữ nguyên chữ số và số 0 đầu của mã; không suy diễn O thành 0', () => {
  assert.equal(codeOf(' as76-07 '), 'AS76-07');
  assert.notEqual(codeOf('AS76-07'), codeOf('AS76-7'));
  assert.equal(codeOf('AS7O-07'), 'AS7O-07');
  for (const code of ['AS76', '../AS76-07', 'AS76-07 garbage', '<AS76-07>']) assert.throws(() => codeOf(code));
});
test('mốc chỉ lấy đúng dãy, ưu tiên khoảng cách; không trộn AS7 và AS76', () => {
  const list = nearestAnchors('AS76-09', ['AS7-09', 'AS76-08', 'AS76-07', 'AS76-11', 'AS760-09'].map(code => ({ code })));
  assert.deepEqual(list.map(p => p.code), ['AS76-08', 'AS76-07', 'AS76-11']);
  assert.equal(nearestAnchors('TL1-09', list).length, 0);
});
test('tọa độ ảnh phẳng khứ hồi ở giữa, cạnh và góc trên ảnh không vuông', () => {
  const map = { width: 60032, height: 42464, hfov: 1 };
  for (const p of [{ x: 30016, y: 21232 }, { x: 0, y: 0 }, { x: 59999, y: 40000 }, { x: 22595, y: 26800 }]) {
    const q = worldToPixel(pixelToWorld(p, map), map);
    assert.ok(Math.abs(q.x - p.x) < 1e-7); assert.ok(Math.abs(q.y - p.y) < 1e-7);
  }
  assert.throws(() => pixelToWorld({ x: NaN, y: 0 }, map));
  assert.throws(() => pixelToWorld({ x: map.width, y: 0 }, map));
});
test('đường dẫn tile krpano dùng ba chữ số và đúng thứ tự hàng/cột', () => {
  assert.equal(tileUrl('/tours/demo/l8/%00v/l8_%00v_%00h.jpg', 9, 24), 'https://vhub.com.vn/tours/demo/l8/009/l8_009_024.jpg');
  assert.throws(() => tileUrl('https://other.example/tours/%v/%h.jpg', 1, 1));
});
test('đọc lại tọa độ cho phép sai số click nhỏ, chặn điểm bị di chuyển sang ô khác', () => {
  const map = { width: 60032, height: 42464, hfov: 1 };
  const p = pixelToWorld({ x: 22500, y: 26800 }, map);
  assert.equal(sameWorldPoint(p, pixelToWorld({ x: 22501, y: 26801 }, map), map), true);
  assert.equal(sameWorldPoint(p, pixelToWorld({ x: 22520, y: 26800 }, map), map), false);
});
test('căn chờ gắn loại sold, hidden, đã gắn; mã trùng làm đồng bộ thất bại', () => {
  const source = [
    { productCode: 'AS76-07', stateLine: 'available' }, { productCode: 'AS76-09', stateLine: 'available' },
    { productCode: 'AS76-11', stateLine: 'sold' }, { productCode: 'AS76-13', stateLine: 'available', isNotShow: true },
  ];
  const hs = normalizeHotspots([
    { productCode: 'AS76-07', sceneName: 'scene_MB_quy_can', ath: 0, atv: 0 },
    { productCode: 'AS76-09', sceneName: 'scene_other', ath: 0, atv: 0 },
    { productCode: 'AS76-13', sceneName: 'scene_mb_quy_can', ath: 0, atv: 0, isAmenity: true },
  ], 'scene_mb_quy_can');
  assert.deepEqual(pendingProducts(normalizeProducts(source), hs).map(p => p.code), ['AS76-09']);
  assert.throws(() => normalizeProducts([source[0], source[0]]), /trùng/);
  const duplicates = normalizeHotspots([{ productCode: 'AS76-07', sceneName: 's', ath: 0, atv: 0 }, { productCode: 'AS76-07', sceneName: 's', ath: 1, atv: 0 }], 's');
  assert.equal(duplicates.length, 2); assert.ok(duplicates.every(h => h.duplicate));
  assert.deepEqual(nearestAnchors('AS76-09', duplicates), []);
});
test('xác nhận chặn nhầm mã, ảnh cũ và điểm nằm ngoài vùng ảnh', () => {
  const scan = { code: 'AS76-09', mapId: 'map-1', left: 100, top: 200, width: 1000, height: 800 };
  const body = { code: 'AS76-09', typedCode: 'AS76-09', point: { x: 50, y: 60 }, scan, currentMapId: 'map-1' };
  const result = approvePosition(body);
  assert.equal(result.x, 150); assert.equal(result.y, 260); assert.equal(result.source, 'user-reviewed');
  assert.throws(() => approvePosition({ ...body, typedCode: 'AS76-08' }));
  assert.throws(() => approvePosition({ ...body, currentMapId: 'map-2' }));
  assert.throws(() => approvePosition({ ...body, point: { x: 1000, y: 5 } }));
});
test('không trộn nháp người dùng với nháp của tool', () => {
  assertDraftOwnership(2, ['AS76-09', 'AS76-11']);
  assert.throws(() => assertDraftOwnership(3, ['AS76-09', 'AS76-11']));
  assert.throws(() => assertDraftOwnership(0, ['AS76-09']));
});
test('đổi ảnh hoặc scene làm vô hiệu vị trí đã ghi nhớ', () => {
  assert.notEqual(fingerprint({ scene: 'a' }, Buffer.from('old')), fingerprint({ scene: 'a' }, Buffer.from('new')));
  assert.notEqual(fingerprint({ scene: 'a' }, Buffer.from('old')), fingerprint({ scene: 'b' }, Buffer.from('old')));
});
