import { chromium } from 'playwright';
import { join } from 'node:path';
import { fingerprint, tileUrl, normalizeProducts, normalizeHotspots, pendingProducts,
  codeOf, pixelToWorld, sameWorldPoint, assertDraftOwnership } from './domain.mjs';

export const PROJECTS = Object.freeze({
  'vinhomes-sai-gon-park': { id: 'vinhomes-sai-gon-park', name: 'Vinhomes Sài Gòn Park' },
  'vinhomes-golden-city': { id: 'vinhomes-golden-city', name: 'Vinhomes Golden City' },
});

export class VhubDriver {
  constructor(root, notify = () => {}) {
    this.root = root; this.notify = notify;
    this.setProject('vinhomes-sai-gon-park');
  }
  setProject(projectId) {
    const project = PROJECTS[projectId];
    if (!project) throw new Error('Dự án VHUB chưa được hỗ trợ.');
    if (this.tour === project.id) return false;
    this.projectId = project.id;
    this.projectName = project.name;
    this.tour = project.id;
    this.url = `https://vhub.com.vn/du-an/${this.tour}/mat-bang-quy-can`;
    this.scene = 'scene_mb_quy_can'; this.auth = {}; this.ownDrafts = new Set(); this.ownPositions = new Map();
    this.products = []; this.hotspots = []; this.pending = []; this.connected = false;
    this.syncedAt = null; this.map = null;
    this.writeMode = null; this.lastSaved = [];
    return true;
  }
  async connect() {
    if (!this.browser?.isConnected()) {
      try { this.browser = await chromium.connectOverCDP('http://127.0.0.1:9228', { timeout: 4000 }); }
      catch {
        this.context = await chromium.launchPersistentContext(join(this.root, 'browser-profile'), {
          channel: 'msedge', headless: false, viewport: null,
          args: ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9228'],
        });
        this.browser = this.context.browser();
      }
      this.context ||= this.browser.contexts()[0];
    }
    // The user can navigate this tab to Quỹ căn 360. Point operations must
    // reconnect to a flat-map tab, never reuse spherical scene coordinates.
    if (this.page && !this.page.isClosed() && !this.page.url().startsWith(this.url)) this.page = null;
    if (!this.page || this.page.isClosed()) {
      this.page = this.context.pages().find(p => p.url().startsWith(this.url)) || await this.context.newPage();
      this.page.on('request', async req => {
        try {
          const u = new URL(req.url());
          if (u.origin === 'https://api.vhub.com.vn' && u.pathname.includes(`/tours/${this.tour}/hotspots`)) {
            const h = await req.allHeaders();
            this.auth = h.authorization ? { authorization: h.authorization } : {};
          }
        } catch { /* A closed page is reported by the next operation. */ }
      });
      if (!this.page.url().startsWith(this.url)) await this.page.goto(this.url, { waitUntil: 'domcontentloaded' });
    }
    this.page.setDefaultTimeout(10000);
    this.connected = true;
    return this.page;
  }
  panel() { return this.page.locator('aside').filter({ has: this.page.getByText('Quản lý hotspot', { exact: true }) }); }
  async ensureManager() {
    await this.connect();
    // Bring VHUB forward so an unauthenticated user can sign in in Edge.
    await this.page.bringToFront();
    // Activating a tab does not restore its window if Windows minimized it.
    try {
      const session = await this.context.newCDPSession(this.page);
      try {
        const { windowId } = await session.send('Browser.getWindowForTarget');
        const { bounds } = await session.send('Browser.getWindowBounds', { windowId });
        if (bounds.windowState === 'minimized')
          await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
      } finally {
        await session.detach();
      }
    } catch { /* Some attached browser contexts do not expose window controls. */ }
    const offline = this.page.getByText('Không thể kết nối đến hệ thống!', { exact: true });
    if (await offline.isVisible().catch(() => false))
      throw new Error('VHUB đang báo không thể kết nối đến hệ thống. Kiểm tra Internet trong Edge rồi bấm Kết nối & Đồng bộ lại.');
    const filter = this.page.locator('aside').filter({ has: this.page.getByRole('heading', { name: 'Bộ lọc sản phẩm', exact: true }) });
    if (await filter.isVisible()) await filter.getByRole('button', { name: 'Đóng', exact: true }).click();
    const detail = this.page.getByRole('button', { name: 'Đóng', exact: true }).and(this.page.locator('.border-red-600'));
    if (await detail.isVisible()) await detail.click();
    const clear = this.page.getByRole('button', { name: /^Bỏ chọn căn / });
    if (await clear.isVisible()) await clear.click();
    if (!(await this.panel().isVisible())) {
      const open = this.page.getByRole('button', { name: 'Quản lý Hotspot', exact: true });
      try { await open.waitFor({ state: 'visible', timeout: 18000 }); }
      catch { throw new Error('Hãy đăng nhập VHUB trong cửa sổ Edge bằng tài khoản có quyền Quản lý hotspot, rồi bấm Kết nối lại.'); }
      await open.click();
    }
    await this.panel().waitFor({ state: 'visible' });
  }
  async nativeDraftCount() {
    const text = await this.panel().innerText();
    return Number(text.match(/Bộ nhớ phiên:\s*(\d+)\s*thay đổi/)?.[1] || 0);
  }
  async nativeWriteMode() {
    // The live manager's footer says "save immediately" even in draft mode.
    // Use an actual draft or a write response to determine persistence.
    return await this.nativeDraftCount() ? 'batch' : (this.writeMode || 'auto');
  }
  async readApi(path) {
    const u = new URL(path, 'https://api.vhub.com.vn');
    if (u.origin !== 'https://api.vhub.com.vn' || ![ `/tours/${this.tour}/hotspots`, '/products/published' ].includes(u.pathname))
      throw new Error('Đường dẫn đọc dữ liệu không được hỗ trợ.');
    const r = await this.context.request.get(u.href, { headers: this.auth, timeout: 30000 });
    if (!r.ok()) throw new Error(`VHUB trả mã ${r.status()} khi đọc dữ liệu. Hãy kiểm tra đăng nhập và đồng bộ lại.`);
    const body = await r.json();
    if (body.success === false || !Array.isArray(body.data)) throw new Error('Cấu trúc dữ liệu VHUB đã thay đổi.');
    return body;
  }
  async readPages(path) {
    const u = new URL(path, 'https://api.vhub.com.vn');
    const result = []; let total;
    for (let page = 1; page <= 100; page++) {
      u.searchParams.set('page', page); u.searchParams.set('limit', 200);
      const body = await this.readApi(u.href);
      total ??= body.meta?.total;
      if (body.meta?.total !== total) throw new Error('Danh sách đang thay đổi trong lúc đọc. Bấm Đồng bộ lại để lấy đủ dữ liệu.');
      result.push(...body.data);
      if (!body.meta?.hasNextPage) {
        if (Number.isFinite(total) && result.length !== total) throw new Error('Chưa đọc đủ các trang dữ liệu VHUB.');
        return result;
      }
    }
    throw new Error('Danh sách vượt giới hạn số trang.');
  }
  async refreshData() {
    const hs = await this.readPages(`/tours/${this.tour}/hotspots?sceneName=${encodeURIComponent(this.scene)}`);
    const ps = await this.readPages(`/products/published?projectId=${this.tour}`);
    this.hotspots = normalizeHotspots(hs, this.scene);
    this.products = normalizeProducts(ps);
    this.pending = pendingProducts(this.products, this.hotspots);
    this.syncedAt = new Date().toISOString();
  }
  async descriptor() {
    await this.page.waitForFunction(scene => {
      const k = document.getElementById('krpanoSWFObject');
      return k && typeof k.get === 'function' && String(k.get('xml.scene')).toLowerCase() === scene && k.get('image.loadstate') === 3;
    }, this.scene, { timeout: 45000 });
    return this.page.evaluate(() => {
      const k = document.getElementById('krpanoSWFObject');
      if (k.get('image.type') !== 'flat' || k.get('image.voffset') !== 0 || k.get('image.prealign') !== '0|0|0')
        throw new Error('Tool hiện hỗ trợ mặt bằng phẳng, không xoay ảnh gốc.');
      const levels = Array.from({ length: Number(k.get('image.level.count')) }, (_, i) => ({
        width: Number(k.get(`image.level[${i}].tiledimagewidth`)), height: Number(k.get(`image.level[${i}].tiledimageheight`)),
        tileSize: Number(k.get(`image.level[${i}].tilesize`)), url: k.get(`image.level[${i}].flat.url`),
      }));
      const full = levels.at(-1);
      return { width: full.width, height: full.height, hfov: Number(k.get('image.hfov')), baseIndex: Number(k.get('image.baseindex')), levels };
    });
  }
  async sync({ requireManager = true } = {}) {
    if (requireManager) await this.ensureManager();
    else await this.connect();
    if (requireManager && await this.nativeDraftCount()) throw new Error('Đang có bản nháp trên VHUB. Lưu hoặc hủy bản nháp trước khi đồng bộ.');
    // A previous save can succeed even if its response/verification was interrupted.
    // Read the server again instead of submitting the same changes twice.
    if (requireManager) { this.ownDrafts.clear(); this.ownPositions.clear(); }
    this.notify('Đọc phiên đăng nhập và scene mặt bằng');
    const bootstrap = this.page.waitForResponse(r => new URL(r.url()).pathname === `/tours/${this.tour}/hotspots/bootstrap` && r.request().method() === 'GET', { timeout: 25000 });
    bootstrap.catch(() => {});
    await this.page.reload({ waitUntil: 'domcontentloaded' });
    const response = await bootstrap;
    const h = await response.request().allHeaders();
    this.auth = h.authorization ? { authorization: h.authorization } : {};
    const boot = await response.json();
    this.scene = String(boot.data?.sceneName || this.scene).toLowerCase();
    this.notify('Đọc đủ các trang sản phẩm và hotspot');
    await this.refreshData();
    const descriptor = await this.descriptor();
    const overview = await this.context.request.get(tileUrl(descriptor.levels[0].url, descriptor.baseIndex, descriptor.baseIndex));
    if (!overview.ok()) throw new Error('Không đọc được ảnh mặt bằng gốc.');
    this.map = { ...descriptor, id: fingerprint({ tour: this.tour, scene: this.scene, ...descriptor }, await overview.body()) };
    if (requireManager) { await this.ensureManager(); this.writeMode = await this.nativeWriteMode(); }
    return this.summary();
  }
  summary() {
    return { connected: this.connected, tour: this.tour, projectId: this.projectId, projectName: this.projectName,
      scene: this.scene, syncedAt: this.syncedAt,
      map: this.map, pending: this.pending, assignedCount: this.hotspots.length,
      duplicateCodes: [...new Set(this.hotspots.filter(h => h.duplicate).map(h => h.code))],
      draftCodes: [...this.ownDrafts], writeMode: this.writeMode };
  }
  async zoom(point) {
    if (!this.map) throw new Error('Cần đồng bộ dữ liệu trước.');
    await this.ensureManager();
    await this.page.bringToFront();
    // Edge can defer viewport/layout updates while this tab is in the background.
    await this.page.waitForTimeout(200);
    const currentScene = await this.page.evaluate(() => document.getElementById('krpanoSWFObject')?.get('xml.scene'));
    if (String(currentScene).toLowerCase() !== this.scene) throw new Error('Scene đang mở khác với mặt bằng đã đồng bộ. Mở lại Mặt bằng quỹ căn rồi đồng bộ.');
    const world = Number.isFinite(point.ath) && Number.isFinite(point.atv)
      ? { ath: point.ath, atv: point.atv } : pixelToWorld(point, this.map);
    await this.page.evaluate(({ ath, atv, fov }) => {
      const k = document.getElementById('krpanoSWFObject');
      k.set('view.hlookat', ath); k.set('view.vlookat', atv); k.set('view.fov', fov);
    }, { ...world, fov: 0.025 });
    await this.page.waitForFunction(w => {
      const k = document.getElementById('krpanoSWFObject');
      if (!k || typeof k.get !== 'function') return true;
      return Math.abs(k.get('view.hlookat') - w.ath) < 0.001 && Math.abs(k.get('view.vlookat') - w.atv) < 0.001;
    }, world, { timeout: 3000 }).catch(() => {});
    await this.page.waitForTimeout(200);
    await this.page.evaluate(async world => {
      const k = document.getElementById('krpanoSWFObject');
      const kRect = (k && typeof k.getBoundingClientRect === 'function') ? k.getBoundingClientRect() : null;
      const viewer = (kRect && kRect.width > 0 && kRect.height > 0) ? kRect : document.getElementById('lockcan-pano').getBoundingClientRect();
      const isMap = (x, y) => {
        if (x < 15 || y < 100 || x > innerWidth - 15 || y > innerHeight - 120) return false;
        const el = document.elementFromPoint(x, y);
        return !!el && (!!el.closest('#lockcan-pano') || !!el.closest('.lc-fund-pin')) && !el.closest('aside');
      };
      const projected = k.spheretoscreen(world.ath, world.atv);
      if (isMap(projected.x + viewer.left, projected.y + viewer.top)) return;
      const candidates = [.15, .25, .75, .85].flatMap(x => [.5, .35, .65].map(y => ({
        x: viewer.left + viewer.width * x, y: viewer.top + viewer.height * y,
      })));
      const target = candidates.find(p => isMap(p.x, p.y));
      if (!target) throw new Error('Không có vùng bản đồ trống để hiển thị điểm. Mở rộng cửa sổ Edge rồi thử lại.');
      for (let i = 0; i < 5; i++) {
        const under = k.screentosphere(target.x - viewer.left, target.y - viewer.top);
        k.set('view.hlookat', k.get('view.hlookat') + world.ath - under.x);
        k.set('view.vlookat', k.get('view.vlookat') + world.atv - under.y);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const p = k.spheretoscreen(world.ath, world.atv);
        if (Math.hypot(p.x + viewer.left - target.x, p.y + viewer.top - target.y) < 2) return;
      }
      throw new Error('Không đưa được điểm ra khỏi bảng che. Mở rộng cửa sổ Edge rồi thử lại.');
    }, world);
    return world;
  }
  async prepare(code) {
    code = codeOf(code);
    await this.ensureManager();
    const panel = this.panel();
    const tab = panel.getByRole('button', { name: /Chờ gắn/ });
    if (await tab.isVisible()) await tab.click();
    const searchInput = panel.locator('input[placeholder*="Tìm"], input[type="text"]').first();
    if (await searchInput.isVisible()) {
      await searchInput.click();
      await searchInput.press('Control+A');
      await searchInput.press('Backspace');
      await searchInput.type(code, { delay: 40 });
      await searchInput.press('Enter');
    }
    // The native search is debounced; stale results can remain visible briefly.
    await this.page.waitForTimeout(1200);
    const loading = panel.getByText('Đang cập nhật danh sách…', { exact: true });
    if (await loading.isVisible()) await loading.waitFor({ state: 'hidden', timeout: 15000 });
    
    const name = panel.getByText(code, { exact: true });
    await name.waitFor({ state: 'visible', timeout: 15000 });
    return name.locator('xpath=ancestor::*[.//button][1]').getByRole('button', { name: 'Gắn', exact: true });
  }
  async stage(positions) {
    this.lastSaved = [];
    if (!positions.length || positions.length > 50) throw new Error('Mỗi lượt chọn từ 1 tới 50 căn đã duyệt.');
    await this.ensureManager();
    this.writeMode = await this.nativeWriteMode();
    assertDraftOwnership(await this.nativeDraftCount(), [...this.ownDrafts]);
    await this.assertMapCurrent();
    await this.refreshData();
    for (const p of positions) {
      if (p.mapId !== this.map.id || p.source !== 'user-reviewed') throw new Error('Vị trí chưa được duyệt cho mặt bằng hiện tại.');
      if (!this.pending.some(x => x.code === p.code)) throw new Error(`${p.code} đã gắn hoặc không còn hàng. Đồng bộ lại.`);
      if (this.ownDrafts.has(p.code)) throw new Error(`${p.code} đã có bản nháp.`);
    }
    for (const p of positions) {
      assertDraftOwnership(await this.nativeDraftCount(), [...this.ownDrafts]);
      this.notify(`${this.writeMode === 'immediate' ? 'Gắn và lưu' : 'Đặt nháp'} ${p.code}`);
      const world = await this.zoom(p);
      const add = await this.prepare(p.code);
      const screen = await this.page.evaluate(w => {
        const k = document.getElementById('krpanoSWFObject'); const p = k.spheretoscreen(w.ath, w.atv);
        const kRect = (k && typeof k.getBoundingClientRect === 'function') ? k.getBoundingClientRect() : null;
        const rect = (kRect && kRect.width > 0 && kRect.height > 0) ? kRect : document.getElementById('lockcan-pano').getBoundingClientRect();
        return { x: p.x + rect.left, y: p.y + rect.top };
      }, world);
      const clear = await this.page.evaluate(p => {
        const el = document.elementFromPoint(p.x, p.y);
        return !!el && !!el.closest('#lockcan-pano') && !el.closest('button,a,aside,input');
      }, screen);
      if (!clear) throw new Error(`Vị trí ${p.code} đang bị bảng hoặc tag khác che. Chỉnh góc nhìn trên VHUB rồi thử lại.`);
      await add.click();
      try {
        await this.panel().getByText(/Đang gắn|Gắn/i).waitFor({ state: 'visible', timeout: 3000 });
      } catch {
        // Proceed even if status text differs or renders differently on live VHub
      }
      try {
        const actual = await this.page.evaluate(p => {
          const k = document.getElementById('krpanoSWFObject');
          const kRect = (k && typeof k.getBoundingClientRect === 'function') ? k.getBoundingClientRect() : null;
          const rect = (kRect && kRect.width > 0 && kRect.height > 0) ? kRect : document.getElementById('lockcan-pano').getBoundingClientRect();
          return k.screentosphere(p.x - rect.left, p.y - rect.top);
        }, screen);
        if (Math.abs(actual.x - world.ath) > .000001 || Math.abs(actual.y - world.atv) > .000001)
          throw new Error('Góc nhìn đã thay đổi trước khi đặt điểm.');
        let savedResponse;
        const onResponse = r => {
          const u = new URL(r.url());
          if (u.origin === 'https://api.vhub.com.vn' &&
              u.pathname.startsWith(`/tours/${this.tour}/hotspots`) && r.request().method() === 'POST') savedResponse = r;
        };
        this.page.on('response', onResponse);
        try {
          await this.page.mouse.click(screen.x, screen.y);
          const deadline = Date.now() + 30000;
          while (!savedResponse && await this.nativeDraftCount() !== this.ownDrafts.size + 1) {
            if (Date.now() >= deadline) throw new Error('VHUB chưa xác nhận tạo nháp hoặc lưu điểm. Đồng bộ lại trước khi thử tiếp.');
            await this.page.waitForTimeout(150);
          }
        } finally { this.page.off('response', onResponse); }
        if (savedResponse) {
          this.writeMode = 'immediate';
          const response = savedResponse;
          const result = await response.json();
          if (!response.ok() || result.success === false)
            throw new Error('VHUB chưa xác nhận lưu. Đồng bộ lại trước khi thử tiếp.');
          await this.refreshData();
          const matches = this.hotspots.filter(h => h.code === p.code);
          if (matches.length !== 1 || !sameWorldPoint(matches[0], world, this.map))
            throw new Error('Đã gửi lưu nhưng chưa xác minh được đúng mã và tọa độ. Đồng bộ lại; không gắn lặp lại.');
          this.lastSaved.push(p.code);
          this.notify(`Đã lưu và kiểm tra ${p.code}`);
          continue;
        }
        this.writeMode = 'batch';
        try {
          await this.page.getByRole('button', { name: p.code, exact: true }).waitFor({ state: 'visible', timeout: 3000 });
        } catch {
          // Fallback check via nativeDraftCount below
        }
        if (await this.nativeDraftCount() !== this.ownDrafts.size + 1) throw new Error('Số lượng nháp không khớp sau khi đặt.');
        this.ownDrafts.add(p.code);
        this.ownPositions.set(p.code, world);
      } catch (e) {
        const cancel = this.panel().getByRole('button', { name: 'Hủy', exact: true });
        if (await cancel.isVisible()) await cancel.click();
        throw new Error(`${e.message} ${this.writeMode === 'immediate'
          ? 'Kiểm tra dữ liệu trên VHUB rồi đồng bộ lại trước khi gắn tiếp.'
          : 'Kiểm tra bản nháp trực tiếp trên VHUB trước khi tiếp tục.'}`);
      }
    }
    await this.page.bringToFront();
    return { draftCodes: [...this.ownDrafts], ...(this.writeMode === 'immediate' ? { saved: [...this.lastSaved] } : {}) };
  }
  async commit() {
    await this.ensureManager();
    const codes = [...this.ownDrafts];
    if (!codes.length) throw new Error('Chưa có bản nháp do tool tạo.');
    await this.verifyOwnedDrafts();
    const saved = this.page.waitForResponse(r => new URL(r.url()).pathname === `/tours/${this.tour}/hotspots/batch` && r.request().method() === 'POST', { timeout: 30000 });
    saved.catch(() => {});
    await this.panel().getByRole('button', { name: `Lưu toàn bộ (${codes.length})`, exact: true }).click();
    const response = await saved; const result = await response.json();
    if (!response.ok() || result.success === false) throw new Error('VHUB chưa xác nhận lưu thành công. Kiểm tra trước khi thử lại.');
    await this.panel().getByText(/Bộ nhớ phiên:/).waitFor({ state: 'hidden', timeout: 20000 });
    await this.refreshData();
    if (!codes.every(code => this.hotspots.some(h => h.code === code && sameWorldPoint(h, this.ownPositions.get(code), this.map))))
      throw new Error('Đã gửi lưu nhưng chưa xác minh được đúng tọa độ. Kiểm tra trên VHUB, sau đó Đồng bộ lại; không bấm lưu lặp lại.');
    this.ownDrafts.clear(); this.ownPositions.clear();
    return { saved: codes, ...this.summary() };
  }
  async discard() {
    await this.ensureManager();
    await this.verifyOwnedDrafts();
    if (!this.ownDrafts.size) return;
    await this.panel().getByRole('button', { name: 'Hủy nháp', exact: true }).click();
    await this.panel().getByText(/Bộ nhớ phiên:/).waitFor({ state: 'hidden' });
    this.ownDrafts.clear(); this.ownPositions.clear();
  }
  async verifyOwnedDrafts() {
    const codes = [...this.ownDrafts];
    assertDraftOwnership(await this.nativeDraftCount(), codes);
    if (codes.length) await this.assertMapCurrent();
    for (const [i, code] of codes.entries()) {
      this.notify(`Kiểm tra bản nháp ${i + 1}/${codes.length}: ${code}`);
      const expected = this.ownPositions.get(code);
      if (!expected) throw new Error('Không còn đủ dữ liệu kiểm tra bản nháp. Hãy xử lý trực tiếp trên VHUB.');
      await this.zoom(expected);
      const panel = this.panel();
      await panel.getByRole('button', { name: /^Đã gắn(?:\s*\(\d+\))?$/ }).click();
      await panel.getByPlaceholder('Tìm tên...', { exact: true }).fill(code);
      await this.page.waitForTimeout(800);
      await panel.getByText('Đang cập nhật danh sách…', { exact: true }).waitFor({ state: 'hidden', timeout: 15000 });
      const name = panel.getByText(code, { exact: true });
      try { await name.waitFor({ state: 'visible' }); }
      catch { throw new Error(`Không còn đúng bản nháp ${code} trong danh sách. Kiểm tra trên VHUB.`); }
      const newDraft = await name.evaluate(n => {
        let p = n;
        for (let i = 0; p && i < 4; i++, p = p.parentElement) {
          if (p.innerText.includes('Mới gắn · Chưa lưu')) return true;
        }
        return false;
      });
      if (!newDraft) throw new Error(`Bản nháp ${code} đã thay đổi ngoài tool. Kiểm tra trực tiếp trên VHUB.`);
      const marker = this.page.getByRole('button', { name: code, exact: true });
      const actual = await marker.evaluate(n => {
        const r = n.getBoundingClientRect();
        const k = document.getElementById('krpanoSWFObject');
        const kRect = (k && typeof k.getBoundingClientRect === 'function') ? k.getBoundingClientRect() : null;
        const viewer = (kRect && kRect.width > 0 && kRect.height > 0) ? kRect : document.getElementById('lockcan-pano').getBoundingClientRect();
        return k.screentosphere(r.x + r.width / 2 - viewer.left, r.y + r.height - viewer.top);
      });
      if (!sameWorldPoint({ ath: actual.x, atv: actual.y }, expected, this.map))
        throw new Error(`Vị trí nháp ${code} đã bị di chuyển. Kiểm tra trên VHUB trước khi lưu.`);
    }
  }
  async assertMapCurrent() {
    if (!this.map) throw new Error('Cần đồng bộ mặt bằng trước.');
    const descriptor = await this.descriptor();
    const overview = await this.context.request.get(tileUrl(descriptor.levels[0].url, descriptor.baseIndex, descriptor.baseIndex));
    if (!overview.ok() || fingerprint({ tour: this.tour, scene: this.scene, ...descriptor }, await overview.body()) !== this.map.id)
      throw new Error('Ảnh mặt bằng đã đổi. Đồng bộ và xác nhận lại vị trí trước khi gắn.');
  }
}
