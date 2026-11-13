import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { codeOf, worldToPixel } from './domain.mjs';
import { validatePolygon } from '../public/mapping-core.mjs';

export function normalizePrefixes(records,codes) {
  const prefix=code=>code.slice(0,code.lastIndexOf('-'));
  const known=new Set(codes.map(prefix)),key=s=>s.replace(/[B8]/g,'8').replace(/[O0]/g,'0');
  return records.map(r=>{
    if(r.priority!==1)return r;
    const raw=prefix(r.code);if(known.has(raw))return r;
    const matches=[...known].filter(p=>key(p)===key(raw));
    if(matches.length!==1)return r;
    return {...r,code:matches[0]+r.code.slice(r.code.lastIndexOf('-')),source:`OCR (${r.code})`};
  });
}

export function containsPoint(point, polygon) {
  let inside=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
    const a=polygon[j],b=polygon[i],cross=(b.x-a.x)*(point.y-a.y)-(b.y-a.y)*(point.x-a.x);
    if(Math.abs(cross)<1e-6&&point.x>=Math.min(a.x,b.x)&&point.x<=Math.max(a.x,b.x)&&point.y>=Math.min(a.y,b.y)&&point.y<=Math.max(a.y,b.y))return true;
    if((a.y>point.y)!==(b.y>point.y)&&point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
  }
  return inside;
}

export function selectUnits(selection, records) {
  validatePolygon(selection);
  const grouped=new Map();
  for(const r of records) {
    if(!Number.isFinite(r.x)||!Number.isFinite(r.y))continue;
    let code;try{code=codeOf(r.code);}catch{continue;}
    if(!grouped.has(code))grouped.set(code,[]);
    grouped.get(code).push({...r,code});
  }
  return [...grouped.values()].map(rows=>{
    rows.sort((a,b)=>b.priority-a.priority||(b.confidence||0)-(a.confidence||0));
    const best=rows[0],conflict=rows.some(r=>r.priority===best.priority&&Math.hypot(r.x-best.x,r.y-best.y)>35);
    return {code:best.code,x:best.x,y:best.y,source:best.source,confidence:best.confidence??null,conflict,enabled:!conflict};
  }).filter(u=>containsPoint(u,selection)).sort((a,b)=>a.code.localeCompare(b.code,undefined,{numeric:true}));
}

export async function sourceUnits(root,driver,map) {
  const records=driver.hotspots.filter(h=>!h.duplicate).map(h=>({...worldToPixel(h,map),code:h.code,source:'VHUB 2D',priority:2}));
  let store;try{store=JSON.parse(await readFile(join(root,'store.json'),'utf8'));}catch{}
  for(const p of Object.values(store?.approvals||{}))if(p.mapId===map.id&&p.ocrVersion===3)records.push({...p,source:'Vị trí đã xác nhận',priority:3});
  for(const name of await readdir(join(root,'scans')).catch(()=>[])) {
    if(!/^[a-f0-9-]+\.json$/.test(name))continue;
    const s=JSON.parse(await readFile(join(root,'scans',name),'utf8'));
    if(s.mapId!==map.id||s.ocrVersion!==3)continue;
    for(const c of s.candidates||[])if(c.confidence>=.55)records.push({code:c.code,x:s.left+c.x,y:s.top+c.y,confidence:c.confidence,source:'OCR',priority:1});
  }
  return records;
}
