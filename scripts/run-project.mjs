import { chromium } from 'playwright';
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
const base = 'http://127.0.0.1:4318';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9228');
const app = browser.contexts()[0].pages().find(p => p.url().startsWith(base));
if (!app) throw new Error('Tool chưa mở.');
const key = await app.locator('meta[name=tool-key]').getAttribute('content');
const root = '.data/run'; await mkdir(root, { recursive: true });
async function api(path, body) {
  const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'X-Tool-Key': key, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const d = await r.json(); if (!r.ok) throw new Error(d.error || r.status); return d;
}
async function job(path, body = {}) {
  const { jobId } = await api(path, body); let last = '', tick = 0;
  for (;;) {
    const state = await api('/api/state'), j = state.job;
    if (j?.id !== jobId) throw new Error('Công việc đã đổi ngoài lượt chạy.');
    if (j.message !== last || ++tick % 90 === 0) { console.log(j.action, j.status, j.message); last = j.message; }
    if (j.status !== 'running') { if (j.status !== 'completed') throw new Error(j.message); return { result: j.result, state }; }
    await new Promise(resolve => setTimeout(resolve, 400));
  }
}
async function snapshot() { const s = await api('/api/state'); await writeFile(join(root, 'state.json'), JSON.stringify(s, null, 2)); return s; }
async function catalog(state) {
  const scans = await Promise.all((await readdir('.data/scans')).filter(n => n.endsWith('.json')).map(async n => JSON.parse(await readFile(join('.data/scans', n), 'utf8'))));
  const result = [];
  for (const p of state.pending) {
    const observations = scans.filter(s => s.mapId === state.map.id).flatMap(s => s.candidates.filter(c => c.code === p.code).map(c => ({ ...c, scanId: s.id, imageId: s.imageId, left: s.left, top: s.top, width: s.width, height: s.height })));
    const unique = [];
    for (const c of observations.sort((a,b) => Number(!!b.polygon)-Number(!!a.polygon)||b.confidence-a.confidence)) {
      if (!unique.some(u => Math.hypot(u.x+u.left-c.x-c.left,u.y+u.top-c.y-c.top)<45)) unique.push(c);
    }
    result.push({ ...p, observations: unique });
  }
  await writeFile(join(root, 'catalog.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ pending: result.length, found: result.filter(p=>p.observations.length).length,
    ambiguous: result.filter(p=>p.observations.length>1).map(p=>p.code),
    missing: result.filter(p=>!p.observations.length).map(p=>p.code) }));
  return result;
}
async function sheets(state) {
  const items = (await catalog(state)).filter(p => p.observations.length);
  const manifest = [];
  for (let start=0; start<items.length; start+=12) {
    const cells=[];
    for (const [i,p] of items.slice(start,start+12).entries()) {
      const c=p.observations[0];
      const imagePath=join('.data/scans',`${c.imageId}.png`);
      const cw=360,ch=240;
      const left=Math.min(c.width-cw,Math.max(0,Math.round(c.x-cw/2)));
      const top=Math.min(c.height-ch,Math.max(0,Math.round(c.y-ch/2)));
      const image=await sharp(imagePath).extract({left,top,width:cw,height:ch}).toBuffer();
      const label=`${p.code} | OCR ${Math.round(c.confidence*100)}% | ${p.area||'?'} m2`;
      const svg=Buffer.from(`<svg width="360" height="280"><rect width="360" height="40" fill="#152e35"/><text x="10" y="27" font-family="Arial" font-size="19" fill="white">${label}</text><circle cx="${c.x-left}" cy="${c.y-top+40}" r="7" stroke="red" stroke-width="2" fill="none"/></svg>`);
      const card=await sharp({create:{width:cw,height:280,channels:3,background:'white'}}).composite([{input:image,left:0,top:40},{input:svg,left:0,top:0}]).png().toBuffer();
      cells.push({input:card,left:(i%3)*360,top:Math.floor(i/3)*280});
      manifest.push({code:p.code,candidate:c,sheet:Math.floor(start/12)+1,cell:i+1});
    }
    const path=join(root,`review-${Math.floor(start/12)+1}.png`);
    await sharp({create:{width:1080,height:Math.ceil(cells.length/3)*280,channels:3,background:'white'}}).composite(cells).png().toFile(path);
    console.log(path);
  }
  await writeFile(join(root,'review-manifest.json'),JSON.stringify(manifest,null,2));
}
try {
  const command=process.argv[2];
  if(command==='sync') {await job('/api/sync'); const s=await snapshot();console.log(JSON.stringify({pending:s.pending.length,assigned:s.assignedCount,codes:s.pending.map(p=>p.code)}));await catalog(s);}
  else if(command==='catalog') await catalog(await snapshot());
  else if(command==='sheets') await sheets(await snapshot());
  else if(command==='scan') {
    for(const code of process.argv.slice(3)){await job('/api/scan',{code,radius:1200});await snapshot();}
    await catalog(await snapshot());
  } else if(command==='approve') {
    const manifest=JSON.parse(await readFile(join(root,'review-manifest.json'),'utf8'));
    for(const code of process.argv.slice(3)) {
      const item=manifest.find(p=>p.code===code);if(!item)throw new Error(`Chưa có ảnh kiểm tra ${code}`);
      const {result:scan}=await job('/api/scan',{code});
      const c=item.candidate;
      const point={x:c.x+c.left-scan.left,y:c.y+c.top-scan.top};
      await api('/api/approve',{code,typedCode:code,scanId:scan.id,point});
      console.log('APPROVED',code,'sheet',item.sheet,'cell',item.cell);
    }
    await snapshot();
  } else if(command==='stage') {await job('/api/stage',{codes:process.argv.slice(3)});await snapshot();}
  else if(command==='save'){await job('/api/save');const s=await snapshot();console.log(JSON.stringify({pending:s.pending.length,assigned:s.assignedCount}));}
  else if(command==='state'){const s=await snapshot();console.log(JSON.stringify({job:s.job,pending:s.pending.length,assigned:s.assignedCount,drafts:s.draftCodes,approved:s.approvals.map(p=>p.code)}));}
  else throw new Error('Command: sync | catalog | sheets | scan CODES | approve CODES | stage CODES | save | state');
} finally {await browser.close();}
