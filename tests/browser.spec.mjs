import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { VhubDriver } from '../lib/driver.mjs';
import { fingerprint } from '../lib/domain.mjs';

// Every network request is intercepted in this isolated browser. No live VHUB writes.
const fixture = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;font-family:Arial}#lockcan-pano{position:absolute;left:0;top:0;width:950px;height:750px;background:#ffe}
canvas{width:950px;height:750px}aside{position:absolute;left:1000px;top:20px;width:400px;padding:20px;background:white}
.row{display:flex;justify-content:space-between;padding:15px}button{padding:8px}.pin{position:absolute;left:20px;top:20px}
</style></head><body><div id="lockcan-pano"><canvas></canvas><div id="pins"></div></div><div id="krpanoSWFObject"></div><aside id="manager"></aside><script>
window.fixture={products:[{id:'p9',productCode:'AS76-09',stateLine:'available'},{id:'p11',productCode:'AS76-11',stateLine:'available'}],hotspots:[],drafts:[],search:'',tab:'pending',armed:null,posts:0};
const vars={'xml.scene':'scene_mb_quy_can','image.type':'flat','image.voffset':0,'image.prealign':'0|0|0','image.loadstate':3,'image.level.count':1,'image.hfov':1,'image.baseindex':1,'image.level[0].tiledimagewidth':3200,'image.level[0].tiledimageheight':2200,'image.level[0].tilesize':512,'image.level[0].flat.url':'/tours/demo/%00v/%00h.jpg','view.hlookat':0,'view.vlookat':0,'view.fov':.3};
const k=document.getElementById('krpanoSWFObject');k.get=x=>vars[x];k.set=(x,v)=>vars[x]=v;k.spheretoscreen=()=>({x:450,y:350});k.screentosphere=()=>({x:vars['view.hlookat']+(window.fixture.offset||0),y:vars['view.vlookat']});
function render(){const s=window.fixture;const all=[...s.hotspots,...s.drafts];const assigned=new Set(all.map(h=>h.productCode));const rows=(s.tab==='pending'?s.products.filter(p=>!assigned.has(p.productCode)):all).filter(p=>p.productCode.includes(s.search));
document.getElementById('manager').innerHTML='<div>Quản lý hotspot</div><button aria-label="Chờ gắn" data-tab="pending">Chờ gắn</button><button aria-label="Đã gắn" data-tab="assigned">Đã gắn</button><input placeholder="Tìm tên..." value="'+s.search+'">'+(s.drafts.length?'<div>Bộ nhớ phiên: '+s.drafts.length+' thay đổi chưa lưu</div><button id="discard">Hủy nháp</button><button id="save">Lưu toàn bộ ('+s.drafts.length+')</button>':'')+(s.armed?'<p>Đang gắn «'+s.armed+'» — click để đặt. <button id="cancel">Hủy</button></p>':'')+rows.map(p=>'<div class="row"><div><div>'+p.productCode+'</div><small>Còn hàng</small>'+(s.drafts.includes(p)?'<p>Mới gắn · Chưa lưu</p>':'')+'</div>'+(s.tab==='pending'?'<button data-add="'+p.productCode+'">Gắn</button>':'<button>Di chuyển</button>')+'</div>').join('');
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{s.tab=b.dataset.tab;render()});document.querySelector('input').oninput=e=>{s.search=e.target.value;render()};document.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>{s.armed=b.dataset.add;render()});
if(document.getElementById('cancel'))document.getElementById('cancel').onclick=()=>{s.armed=null;render()};
if(document.getElementById('discard'))document.getElementById('discard').onclick=()=>{s.drafts=[];render()};
if(document.getElementById('save'))document.getElementById('save').onclick=async()=>{s.posts++;await fetch('https://api.vhub.com.vn/tours/vinhomes-sai-gon-park/hotspots/batch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({codes:s.drafts.map(p=>p.productCode)})});s.hotspots.push(...s.drafts);s.drafts=[];render()};
document.getElementById('pins').innerHTML=s.drafts.concat(s.hotspots).map(p=>'<button class="pin" aria-label="'+p.productCode+'">6,1</button>').join('');}
document.querySelector('canvas').onclick=()=>{const s=window.fixture;if(!s.armed)return;s.drafts.push({id:s.armed,productCode:s.armed,sceneName:'scene_mb_quy_can',ath:vars['view.hlookat'],atv:vars['view.vlookat']});s.armed=null;render()};render();
</script></body></html>`;

test('đặt hai nháp, lưu một lần và xác minh đọc lại; chặn vị trí cũ và nháp lạ', { timeout: 45000 }, async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    await context.route('**/*', async route => {
      const request = route.request(), u = new URL(request.url());
      if (request.isNavigationRequest() && u.origin === 'https://vhub.com.vn') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture });
      if (u.pathname.endsWith('/hotspots/batch')) return route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ success: true, data: {} }) });
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST' } });
      return route.abort();
    });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('https://vhub.com.vn/du-an/vinhomes-sai-gon-park/mat-bang-quy-can');
    const driver = new VhubDriver('unused'); driver.browser = browser; driver.page = page;
    assert.deepEqual(errors, []);
    assert.equal(await driver.panel().isVisible(), true, await page.locator('body').innerText());
    driver.context = { request: { get: async () => ({ ok: () => true, body: async () => Buffer.from('overview') }) } };
    driver.readApi = async path => {
      const f = await page.evaluate(() => window.fixture);
      const data = path.includes('/products/published') ? f.products : f.hotspots;
      return { data, meta: { total: data.length, hasNextPage: false } };
    };
    const descriptor = await driver.descriptor();
    driver.map = { ...descriptor, id: fingerprint({ tour: driver.tour, scene: driver.scene, ...descriptor }, Buffer.from('overview')) };
    const position = code => ({ code, x: 1600, y: 1100, mapId: driver.map.id, source: 'user-reviewed' });
    await assert.rejects(driver.stage([{ ...position('AS76-09'), mapId: 'old-map' }]), /chưa được duyệt/);
    await page.evaluate(() => { window.fixture.drafts.push({ productCode: 'AS76-01' }); render(); });
    await assert.rejects(driver.stage([position('AS76-09')]), /Bản nháp/);
    await page.evaluate(() => { window.fixture.drafts = []; render(); });
    const staged = await driver.stage([position('AS76-09'), position('AS76-11')]);
    assert.deepEqual(staged.draftCodes, ['AS76-09', 'AS76-11']);
    assert.equal(await page.evaluate(() => window.fixture.posts), 0);
    await page.evaluate(() => { window.fixture.offset = .01; });
    await assert.rejects(driver.commit(), /bị di chuyển/);
    assert.equal(await page.evaluate(() => window.fixture.posts), 0);
    await page.evaluate(() => { window.fixture.offset = 0; window.fixture.drafts[0].productCode = 'AS76-99'; render(); });
    await assert.rejects(driver.commit(), /Không còn đúng bản nháp/);
    assert.equal(await page.evaluate(() => window.fixture.posts), 0);
    await page.evaluate(() => { window.fixture.drafts[0].productCode = 'AS76-09'; render(); });
    const saved = await driver.commit();
    assert.deepEqual(saved.saved, ['AS76-09', 'AS76-11']);
    assert.equal(await page.evaluate(() => window.fixture.posts), 1);
    assert.equal(driver.ownDrafts.size, 0);
    assert.equal(driver.pending.length, 0);
    assert.equal(driver.hotspots.length, 2);
    await assert.rejects(driver.stage([position('AS76-09')]), /đã gắn/);
  } finally { await browser.close(); }
});

test('đưa điểm cần gắn ra khỏi bảng quản lý trên cửa sổ hẹp', { timeout: 15000 }, async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 900, height: 900 } });
    await context.route('**/*', route => route.request().isNavigationRequest()
      ? route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture }) : route.abort());
    const page = await context.newPage();
    await page.goto('https://vhub.com.vn/du-an/vinhomes-sai-gon-park/mat-bang-quy-can');
    await page.addStyleTag({ content: 'aside{left:250px;width:600px;height:650px}' });
    await page.evaluate(() => {
      const k = document.getElementById('krpanoSWFObject');
      k.spheretoscreen = (h, v) => ({ x: 450 + (h - k.get('view.hlookat')) * 50000, y: 350 + (v - k.get('view.vlookat')) * 50000 });
      k.screentosphere = (x, y) => ({ x: k.get('view.hlookat') + (x - 450) / 50000, y: k.get('view.vlookat') + (y - 350) / 50000 });
    });
    const driver = new VhubDriver('unused'); driver.browser = browser; driver.page = page; driver.context = context;
    driver.map = { ...await driver.descriptor(), id: 'fixture' };
    const world = await driver.zoom({ x: 1600, y: 1100 });
    const actual = await page.evaluate(w => {
      const p = document.getElementById('krpanoSWFObject').spheretoscreen(w.ath, w.atv);
      const el = document.elementFromPoint(p.x, p.y);
      return { x: p.x, visible: !!el.closest('#lockcan-pano') && !el.closest('aside') };
    }, world);
    assert.equal(actual.visible, true); assert.ok(actual.x < 250);
  } finally { await browser.close(); }
});
