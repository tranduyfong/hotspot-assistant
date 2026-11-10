const key = document.querySelector('meta[name=tool-key]').content;
const $ = (id) => document.getElementById(id);
const checked = new Set();
let state = { pending: [], approvals: [], draftCodes: [] },
  selected = null,
  scan = null,
  point = null,
  image = null;
let seenJob = null,
  lastListKey = '',
  previewUrl = null,
  busyPost = false,
  polling = false;

/* ── Toast notification system ── */
function toast(message, type = 'info') {
  const icons = { success: '✓', warn: '⚠', info: 'ℹ' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-icon">${icons[type] || icons.info}</span>${message.replace(/[<>&"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])}`;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 3600);
}
const time = (value) =>
  value
    ? new Intl.DateTimeFormat('vi-VN', {
        timeZone: 'Asia/Bangkok',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).format(new Date(value))
    : '';
const escape = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
async function api(path, body) {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'X-Tool-Key': key,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Không thực hiện được thao tác.');
  return data;
}
function error(message) {
  $('error').textContent = message;
  $('error').hidden = !message;
}
async function action(path, body = {}) {
  if (busyPost) return;
  busyPost = true;
  error('');
  renderControls();
  try {
    const result = await api(path, body);
    await poll();
    return result;
  } catch (e) {
    error(e.message);
  } finally {
    busyPost = false;
    renderControls();
  }
}
function approved(code = selected) {
  return state.approvals.find((p) => p.code === code);
}
function anchors(code) {
  // The backend remains authoritative. This list is supplied through a read-only suggestion request below.
  return state.anchorOptions?.[code] || [];
}
function renderList() {
  const filter = $('filter').value.trim().toUpperCase();
  const signature = JSON.stringify([
    state.pending,
    state.approvals,
    state.recognizedCodes,
    [...checked],
    selected,
    filter,
  ]);
  if (signature === lastListKey) return;
  lastListKey = signature;
  const list = state.pending.filter(
    (p) => p.code.includes(filter) || (p.subdivision || '').toUpperCase().includes(filter),
  );
  $('list-count').textContent = list.length;
  $('pending-list').innerHTML = list.length
    ? list
        .map(
          (p) =>
            `<div class="lot-row ${p.code === selected ? 'active' : ''}"><input type="checkbox" aria-label="Chọn ${escape(p.code)}" data-check="${escape(p.code)}" ${checked.has(p.code) ? 'checked' : ''}><button data-code="${escape(p.code)}"><strong>${escape(p.code)}</strong><small>${p.area ? escape(p.area) + ' m² · ' : ''}${escape(p.subdivision || p.status)}</small><span class="row-status ${approved(p.code) ? 'verified' : ''}">${approved(p.code) ? '✓ Đã xác nhận vị trí' : state.recognizedCodes?.includes(p.code) ? '⌖ Đã đọc được mã · chờ duyệt' : 'Chưa có vị trí'}</span></button></div>`,
        )
        .join('')
    : '<div class="empty"><span>✓</span><p>Không có căn phù hợp.</p></div>';
  $('selected-count').textContent = checked.size ? `Đã chọn ${checked.size} căn` : 'Chưa chọn căn';
  /* Auto-scroll active item into view */
  const activeRow = $('pending-list').querySelector('.lot-row.active');
  if (activeRow) activeRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
function renderControls() {
  const busy = busyPost || state.job?.status === 'running';
  const hasTarget = Boolean(selected && state.pending.some((p) => p.code === selected));
  const known = Boolean(approved());
  $('connect').disabled = busy;
  for (const item of $('pending-list').querySelectorAll('button, input')) item.disabled = busy;
  $('select-approved').disabled = busy;
  $('clear-selected').disabled = busy;
  $('connect').textContent = state.syncedAt ? '↻ Đồng bộ lại' : 'Kết nối & đồng bộ';
  for (const id of ['scan', 'image-only', 'current-view', 'zoom-vhub'])
    $(id).disabled = busy || !hasTarget;
  $('approve').disabled =
    busy ||
    !point ||
    !scan ||
    scan.code !== selected ||
    $('confirm-code').value.trim().toUpperCase() !== selected;
  $('stage-one').disabled = busy || !hasTarget || !known || state.draftCodes.includes(selected);
  $('stage-batch').disabled =
    busy || !checked.size || [...checked].some((c) => !approved(c) || state.draftCodes.includes(c));
  $('scan-batch').disabled = busy || !checked.size || checked.size > 10;
  $('save').disabled = busy || !state.draftCodes.length;
  $('discard').disabled = busy || !state.draftCodes.length;
  $('cancel').hidden = !state.job?.cancellable || state.job.status !== 'running';
  $('target-status').textContent = known ? '✓ Vị trí đã xác nhận' : 'Chờ xác nhận';
  $('target-status').classList.toggle('approved', known);
  $('approval-note').textContent = known
    ? `Đã ghi nhớ lúc ${time(approved().verifiedAt)}. Có thể đặt nháp hoặc chọn cùng các căn khác.`
    : 'Vị trí lưu trên máy, gắn với phiên bản mặt bằng hiện tại.';
  $('draft-title').textContent = state.draftCodes.length
    ? `${state.draftCodes.length} căn đang có bản nháp`
    : 'Chưa có bản nháp do tool tạo';
  $('draft-note').textContent = state.draftCodes.length
    ? state.draftCodes.join(' · ')
    : 'Các căn đã xác nhận vị trí có thể chọn để đặt nháp cùng một lượt.';
}
function renderState() {
  $('pending-count').textContent = state.syncedAt ? state.pending.length : '—';
  $('assigned-count').textContent = state.syncedAt ? state.assignedCount : '—';
  $('approved-count').textContent = state.approvals.filter((p) =>
    state.pending.some((x) => x.code === p.code),
  ).length;
  $('ocr-status').textContent = state.ocrReady ? 'Sẵn sàng' : 'Chưa cài OCR';
  $('connection').textContent = state.connected ? '● Edge đã kết nối' : 'Chưa kết nối';
  $('sync-time').textContent = state.syncedAt
    ? `Đồng bộ lúc ${time(state.syncedAt)}`
    : 'Chưa đồng bộ';
  const job = state.job;
  $('job-box').className = `job ${job?.status || ''}`;
  if (job) {
    $('job-symbol').textContent =
      job.status === 'running' ? '◌' : job.status === 'completed' ? '✓' : '!';
    const names = {
      sync: 'Đồng bộ dữ liệu VHUB',
      scan: 'Dò vị trí mã căn',
      'scan-batch': 'Dò danh sách căn',
      stage: 'Đặt nháp trên VHUB',
      save: 'Lưu và kiểm tra trên máy chủ',
      zoom: 'Mở vị trí trên VHUB',
      discard: 'Hủy bản nháp',
    };
    $('job-title').textContent = names[job.action] || 'Xử lý công việc';
    $('job-message').textContent = job.message;
  }
  const names = {
    sync: 'Đồng bộ',
    approve: 'Xác nhận vị trí',
    stage: 'Đặt nháp',
    save: 'Đã lưu VHUB',
    discard: 'Hủy nháp',
  };
  if (state.history?.length)
    $('history').innerHTML = state.history
      .slice(0, 8)
      .map(
        (h) =>
          `<div class="history-item"><time>${time(h.at)}</time>${escape(names[h.action] || h.action)} ${h.codes ? '· ' + escape(h.codes.join(', ')) : '· ' + escape(h.pending) + ' căn chờ'}</div>`,
      )
      .join('');
  renderList();
  renderControls();
}
function choose(code) {
  selected = code;
  scan = null;
  point = null;
  image = null;
  $('target-title').textContent = code;
  $('confirm-code').value = '';
  $('candidates').innerHTML = '<p class="muted">Bấm Dò mã để tìm trên ảnh mặt bằng.</p>';
  $('map-canvas').hidden = true;
  $('image-empty').hidden = false;
  $('point-label').textContent = 'Chưa chọn điểm trên ảnh';
  const options = anchors(code);
  $('anchor').innerHTML = options.length
    ? options
        .map(
          (a) =>
            `<option value="${escape(a.code)}">${escape(a.code)}${a.sameParity ? ' · cùng chẵn/lẻ' : ''}</option>`,
        )
        .join('')
    : '<option value="">Chưa có mốc cùng dãy</option>';
  renderList();
  renderControls();
}
async function showScan(value) {
  if (selected !== value.code) choose(value.code);
  scan = value;
  const response = await fetch(`/api/preview/${scan.id}`, { headers: { 'X-Tool-Key': key } });
  if (!response.ok) throw new Error('Không tải được vùng ảnh.');
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(await response.blob());
  const loaded = new Image();
  loaded.src = previewUrl;
  await loaded.decode();
  image = loaded;
  const canvas = $('map-canvas');
  canvas.width = scan.width;
  canvas.height = scan.height;
  canvas.hidden = false;
  $('image-empty').hidden = true;
  const matches = scan.candidates.filter((c) => c.code === selected);
  point = matches.length === 1 ? { x: matches[0].x, y: matches[0].y } : null;
  // Always initialize from the fresh scan. A previous approval may belong to
  // a neighbouring lot and must never silently replace this scan's result.
  $('preview-note').textContent =
    `${scan.anchorCode ? 'Mốc ' + scan.anchorCode : 'Vùng đang xem'} · ảnh mặt bằng gốc`;
  $('candidates').innerHTML = matches.length
    ? matches
        .map(
          (c, i) =>
            `<button class="candidate" data-candidate="${i}"><span>${escape(c.code)}</span><small>OCR ${(c.confidence * 100).toFixed(0)}% · ${c.polygon ? 'có ô đất' : 'điểm chữ'}</small></button>`,
        )
        .join('')
    : '<p class="help">Chưa đọc được đúng mã trong vùng này. Đổi mốc hoặc mở rộng vùng ảnh. Bạn có thể đọc và chọn đúng ô trên ảnh.</p>';
  if (scan.warning) error(scan.warning);
  draw();
  resizeImage(true);
  renderControls();
}
function resizeImage(center = false) {
  const canvas = $('map-canvas'),
    zoom = Number($('image-zoom').value) / 100;
  canvas.style.width = `${canvas.width * zoom}px`;
  canvas.style.height = `${canvas.height * zoom}px`;
  $('zoom-value').textContent = `${Math.round(zoom * 100)}%`;
  if (center && image)
    requestAnimationFrame(() => {
      const viewport = $('image-viewport');
      viewport.scrollLeft = (point?.x ?? scan.width / 2) * zoom - viewport.clientWidth / 2;
      viewport.scrollTop = (point?.y ?? scan.height / 2) * zoom - viewport.clientHeight / 2;
    });
}
function draw() {
  if (!image || !scan) return;
  const canvas = $('map-canvas'),
    ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  for (const c of scan.candidates.filter((c) => c.code === selected)) {
    if (c.polygon) {
      ctx.beginPath();
      c.polygon.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.strokeStyle = '#14957a';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }
  if (point) {
    ctx.strokeStyle = '#d93d2c';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 14, 0, Math.PI * 2);
    ctx.moveTo(point.x - 23, point.y);
    ctx.lineTo(point.x + 23, point.y);
    ctx.moveTo(point.x, point.y - 23);
    ctx.lineTo(point.x, point.y + 23);
    ctx.stroke();
    $('point-label').textContent =
      `Đã chọn vị trí cho ${selected} · bấm ảnh để chỉnh`;
  }
}
async function poll() {
  if (polling) return;
  polling = true;
  try {
    state = await api('/api/state');
    const pending = new Set(state.pending.map((p) => p.code));
    for (const c of checked) if (!pending.has(c)) checked.delete(c);
    if (selected && !pending.has(selected) && state.syncedAt) {
      selected = null;
      scan = null;
      point = null;
      image = null;
      $('target-title').textContent = 'Chọn một căn để bắt đầu';
      $('map-canvas').hidden = true;
      $('image-empty').hidden = false;
    }
    renderState();
    const job = state.job;
    if (job && job.status === 'completed' && job.id !== seenJob) {
      seenJob = job.id;
      if (job.action === 'scan' && job.result?.id) await showScan(job.result);
      if (job.action === 'sync' && !selected && state.pending.length) choose(state.pending[0].code);
    }
  } catch (e) {
    error(`Không kết nối được tool: ${e.message}`);
  } finally {
    polling = false;
  }
}
$('connect').onclick = () => action('/api/connect');
$('cancel').onclick = () => action('/api/cancel');
$('filter').oninput = renderList;
$('pending-list').onclick = (e) => {
  const button = e.target.closest('button[data-code]');
  if (button && state.job?.status !== 'running') choose(button.dataset.code);
};
$('pending-list').onchange = (e) => {
  const code = e.target.dataset.check;
  if (code) {
    e.target.checked ? checked.add(code) : checked.delete(code);
    renderList();
    renderControls();
  }
};
$('select-approved').onclick = () => {
  checked.clear();
  state.pending
    .filter((p) => approved(p.code))
    .slice(0, 20)
    .forEach((p) => checked.add(p.code));
  renderList();
  renderControls();
};
$('clear-selected').onclick = () => {
  checked.clear();
  renderList();
  renderControls();
};
function scanBody(extra = {}) {
  return {
    code: selected,
    anchorCode: $('anchor').value || undefined,
    radius: Number($('radius').value),
    ...extra,
  };
}
$('scan').onclick = () => action('/api/scan', scanBody());
$('image-only').onclick = () => action('/api/scan', scanBody({ ocr: false, force: true }));
$('current-view').onclick = () =>
  action('/api/scan', scanBody({ currentView: true, ocr: false, force: true }));
$('scan-batch').onclick = () =>
  action('/api/scan-batch', { codes: [...checked], radius: Number($('radius').value) });
$('stage-batch').onclick = () => action('/api/stage', { codes: [...checked] });
$('stage-one').onclick = () => action('/api/stage', { codes: [selected] });
$('zoom-vhub').onclick = () =>
  action('/api/zoom', { code: selected, anchorCode: $('anchor').value || undefined });
$('save').onclick = () => action('/api/save');
$('discard').onclick = () => action('/api/discard');
$('confirm-code').oninput = renderControls;
$('approve').onclick = () =>
  action('/api/approve', {
    code: selected,
    typedCode: $('confirm-code').value,
    scanId: scan.id,
    point,
  });
$('image-zoom').oninput = () => resizeImage(true);
window.addEventListener('resize', () => resizeImage(true));
$('map-canvas').onclick = (e) => {
  if (!scan) return;
  const r = e.target.getBoundingClientRect();
  point = {
    x: ((e.clientX - r.left) * scan.width) / r.width,
    y: ((e.clientY - r.top) * scan.height) / r.height,
  };
  draw();
  renderControls();
};
$('map-canvas').onkeydown = (e) => {
  if (!point || !scan || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key))
    return;
  e.preventDefault();
  const step = e.shiftKey ? 20 : 2;
  point.x = Math.max(
    0,
    Math.min(
      scan.width - 1,
      point.x + (e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0),
    ),
  );
  point.y = Math.max(
    0,
    Math.min(
      scan.height - 1,
      point.y + (e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0),
    ),
  );
  draw();
  renderControls();
};
$('candidates').onclick = (e) => {
  const button = e.target.closest('[data-candidate]');
  if (!button || !scan) return;
  const c = scan.candidates.filter((c) => c.code === selected)[Number(button.dataset.candidate)];
  point = { x: c.x, y: c.y };
  draw();
  resizeImage(true);
  renderControls();
};
$('export').onclick = async () => {
  try {
    const data = await api('/api/export');
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'vhub-positions.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    error(e.message);
  }
};
await poll();
setInterval(poll, 900);
