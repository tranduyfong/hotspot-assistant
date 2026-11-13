// Pure geometry shared by browser, server and tests. Angles follow krpano:
// ath grows to the right, atv grows down; internal XYZ is right/down/forward.
export const VERSION = 1;
const rad = x => x * Math.PI / 180, deg = x => x * 180 / Math.PI;
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const norm = a => { const n = Math.hypot(...a); if (n < 1e-12) throw new Error('Các hướng mốc triệt tiêu nhau. Hãy chia vùng nhỏ hơn.'); return a.map(x => x / n); };
export const defaults = () => ({ offsetX: 0, offsetY: 0, rotation: 0, scale: 1, yaw: 0, pitch: 0, roll: 0 });
// Invert the viewer's screen-to-sphere calibration, including camera roll and
// the actual krpano FOV convention, without moving the browser or camera.
export function imageProjection(controls) {
  const model=fitMapping(controls),h=model.h;
  const inverse=[h[4]*h[8]-h[5]*h[7],h[2]*h[7]-h[1]*h[8],h[1]*h[5]-h[2]*h[4],h[5]*h[6]-h[3]*h[8],h[0]*h[8]-h[2]*h[6],h[2]*h[3]-h[0]*h[5],h[3]*h[7]-h[4]*h[6],h[1]*h[6]-h[0]*h[7],h[0]*h[4]-h[1]*h[3]];
  return {...model,inverse};
}
export function projectToImage(point,camera) {
  const r=ray(point),z=dot(r,camera.frame[2]);if(z<=1e-7)return null;
  const u=dot(r,camera.frame[0])/z,v=dot(r,camera.frame[1])/z,h=camera.inverse,d=h[6]*u+h[7]*v+h[8];
  if(Math.abs(d)<1e-10)return null;
  const x=((h[0]*u+h[1]*v+h[2])/d)*camera.unit+camera.origin[0],y=((h[3]*u+h[4]*v+h[5])/d)*camera.unit+camera.origin[1];
  return Number.isFinite(x)&&Number.isFinite(y)?{x,y}:null;
}
export function ray(p) {
  const h = rad(p.ath), v = rad(p.atv);
  return [Math.sin(h)*Math.cos(v), Math.sin(v), Math.cos(h)*Math.cos(v)];
}
export function sphere(v) {
  const a = norm(v);
  return { ath: deg(Math.atan2(a[0], a[2])), atv: deg(Math.atan2(a[1], Math.hypot(a[0], a[2]))) };
}
export function angularError(a, b) {
  const u = ray(a), v = ray(b);
  return deg(Math.atan2(Math.hypot(...cross(u, v)), dot(u, v)));
}
function solve(a, b) {
  const m = a.map((r, i) => [...r, b[i]]), n = b.length;
  for (let i = 0; i < n; i++) {
    let k = i;
    for (let j = i + 1; j < n; j++) if (Math.abs(m[j][i]) > Math.abs(m[k][i])) k = j;
    if (Math.abs(m[k][i]) < 1e-10) throw new Error('Mốc thẳng hàng hoặc quá gần nhau. Chọn mốc trải đều quanh vùng.');
    [m[i], m[k]] = [m[k], m[i]];
    const d = m[i][i]; for (let j = i; j <= n; j++) m[i][j] /= d;
    for (let k = 0; k < n; k++) if (k !== i) { const s = m[k][i]; for (let j = i; j <= n; j++) m[k][j] -= s * m[i][j]; }
  }
  return m.map(r => r[n]);
}
function homography(points) {
  const a = Array.from({ length: 8 }, () => Array(8).fill(0)), b = Array(8).fill(0);
  for (const { x, y, u, v } of points) {
    for (const [r, target] of [[[x,y,1,0,0,0,-u*x,-u*y],u], [[0,0,0,x,y,1,-v*x,-v*y],v]]) {
      for (let i = 0; i < 8; i++) { b[i] += r[i] * target; for (let j = 0; j < 8; j++) a[i][j] += r[i] * r[j]; }
    }
  }
  return [...solve(a, b), 1];
}
function hull(points) {
  const p = points.map(p => [p.x,p.y]).sort((a,b) => a[0]-b[0] || a[1]-b[1]);
  const turn = (a,b,c) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const half = seq => { const out=[]; for (const a of seq) { while(out.length>1 && turn(out.at(-2),out.at(-1),a)<=0)out.pop(); out.push(a); } return out; };
  return [...half(p).slice(0,-1), ...half([...p].reverse()).slice(0,-1)];
}
export function inHull(p, h) {
  if (h.length < 3) return false;
  return h.every((a,i) => { const b=h[(i+1)%h.length]; return (b[0]-a[0])*(p.y-a[1])-(b[1]-a[1])*(p.x-a[0]) >= -1e-6; });
}
export function validateFine(value = {}) {
  const f = { ...defaults(), ...value };
  for (const k of Object.keys(defaults())) if (!Number.isFinite(f[k])) throw new Error(`Giá trị ${k} không hợp lệ.`);
  if (f.scale < .1 || f.scale > 10 || Math.abs(f.offsetX)>100000 || Math.abs(f.offsetY)>100000 ||
      ['rotation','yaw','pitch','roll'].some(k => Math.abs(f[k])>180)) throw new Error('Thông số căn chỉnh vượt giới hạn.');
  return Object.fromEntries(Object.keys(defaults()).map(k => [k, f[k]]));
}
export function adjustedSource(p, model, fine = defaults()) {
  const f = validateFine(fine), t = rad(f.rotation), [cx,cy] = model.origin;
  const dx=(p.x-cx)*f.scale, dy=(p.y-cy)*f.scale;
  return {x:cx+dx*Math.cos(t)-dy*Math.sin(t)+f.offsetX,y:cy+dx*Math.sin(t)+dy*Math.cos(t)+f.offsetY};
}
export function mapPoint(p, model, fine = defaults()) {
  const f=validateFine(fine),point=adjustedSource(p,model,f);
  const x=(point.x-model.origin[0])/model.unit,y=(point.y-model.origin[1])/model.unit;
  const h=model.h, z=h[6]*x+h[7]*y+h[8];
  if (z <= 1e-7) throw new Error('Polygon vượt mặt phẳng chiếu hợp lệ. Thu nhỏ vùng hoặc thêm profile.');
  let [a,b,c] = norm([(h[0]*x+h[1]*y+h[2])/z, (h[3]*x+h[4]*y+h[5])/z, 1]);
  // Fixed calibration-local axes: roll around forward, pitch around right,
  // yaw around down. These rotations move geometry, never the viewer camera.
  let q=rad(f.roll); [a,b]=[a*Math.cos(q)-b*Math.sin(q), a*Math.sin(q)+b*Math.cos(q)];
  q=rad(f.pitch); [b,c]=[b*Math.cos(q)+c*Math.sin(q), -b*Math.sin(q)+c*Math.cos(q)];
  q=rad(f.yaw); [a,c]=[a*Math.cos(q)+c*Math.sin(q), -a*Math.sin(q)+c*Math.cos(q)];
  return sphere(model.frame[0].map((_,i) => a*model.frame[0][i]+b*model.frame[1][i]+c*model.frame[2][i]));
}
export function fitMapping(controls, threshold = .3) {
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 3) throw new Error('Ngưỡng RANSAC phải lớn hơn 0 và không quá 3 độ.');
  const used = controls.filter(p => p.enabled !== false && p.role !== 'check');
  if (used.length < 4) throw new Error('Cần ít nhất 4 cặp mốc để tính. Nên dùng 8–12 mốc và thêm mốc kiểm tra.');
  for (const p of controls) if (![p.x,p.y,p.ath,p.atv].every(Number.isFinite) || Math.abs(p.atv)>90 || Math.abs(p.ath)>180) throw new Error('Tọa độ mốc không hợp lệ.');
  const origin=[0,1].map(i => used.reduce((s,p) => s+(i?p.y:p.x),0)/used.length);
  const unit=Math.sqrt(used.reduce((s,p) => s+(p.x-origin[0])**2+(p.y-origin[1])**2,0)/used.length);
  if (unit<1) throw new Error('Các mốc quá gần nhau.');
  const forward=norm(used.reduce((s,p) => ray(p).map((v,i)=>v+s[i]), [0,0,0]));
  const right=norm(cross(Math.abs(forward[1])>.95?[0,0,1]:[0,1,0],forward));
  const frame=[right,cross(forward,right),forward];
  const normalized=used.map(p => {
    const r=ray(p), z=dot(r,forward);
    if (z<.12) return null; // A grossly wrong correspondence must not poison all good anchors.
    return {x:(p.x-origin[0])/unit,y:(p.y-origin[1])/unit,u:dot(r,frame[0])/z,v:dot(r,frame[1])/z};
  });
  const pool=normalized.flatMap((p,i)=>p?[i]:[]);
  if(pool.length<4||pool.length<used.length*.6)throw new Error('Vùng phủ góc quá rộng. Chia thành các profile nhỏ hơn.');
  let best=[], bestLoss=Infinity, seed=12479;
  const random=() => { seed=(Math.imul(seed,1664525)+1013904223)>>>0; return seed/4294967296; };
  for(let iteration=0;iteration<(used.length===4?1:400);iteration++) {
    const indices=new Set(); while(indices.size<4)indices.add(pool[Math.floor(random()*pool.length)]);
    try {
      const model={h:homography([...indices].map(i=>normalized[i])),origin,unit,frame};
      const errors=used.map(p=> {try{return angularError(mapPoint(p,model),p);}catch{return Infinity;}});
      const inliers=errors.flatMap((e,i)=>e<=threshold?[i]:[]), loss=inliers.reduce((s,i)=>s+errors[i]**2,0);
      if(inliers.length>best.length || inliers.length===best.length && loss<bestLoss){best=inliers;bestLoss=loss;}
    } catch { /* Degenerate RANSAC samples are skipped. */ }
  }
  if(best.length<4 || best.length<used.length*.6)throw new Error('Chưa đủ mốc nhất quán (cần ít nhất 60%). Kiểm tra cặp mốc và mặt phẳng đất/mái.');
  let model={version:VERSION,origin,unit,frame,h:homography(best.map(i=>normalized[i])),threshold};
  // Reclassify after the final fit; report the actual final inlier set.
  best=used.flatMap((p,i)=> {try{return angularError(mapPoint(p,model),p)<=threshold?[i]:[];}catch{return [];}});
  if(best.length<4 || best.length<used.length*.6)throw new Error('Mốc không ổn định sau khi khớp. Hãy sửa mốc sai.');
  model.h=homography(best.map(i=>normalized[i]));
  model.inlierIds=best.map(i=>used[i].id);
  model.hull=hull(best.map(i=>used[i]));
  return model;
}
export function diagnostics(controls, model, fine) {
  const rows=controls.map(p=> {
    let error=null; try { error=angularError(mapPoint(p,model,fine),p); } catch { /* Invalid projection. */ }
    return {id:p.id,role:p.role||'fit',enabled:p.enabled!==false,inlier:model.inlierIds.includes(p.id),error};
  });
  const stats=list=> { const a=list.map(p=>p.error).filter(Number.isFinite).sort((a,b)=>a-b); return {count:a.length,invalid:list.length-a.length,rms:a.length?Math.sqrt(a.reduce((s,e)=>s+e*e,0)/a.length):null,max:a.length?a.at(-1):null,p95:a.length?a[Math.ceil(a.length*.95)-1]:null}; };
  return {rows,fit:stats(rows.filter(p=>p.enabled&&p.role==='fit'&&p.inlier)),check:stats(rows.filter(p=>p.enabled&&p.role==='check'))};
}
export function validatePolygon(points) {
  if(!Array.isArray(points)||points.length<3||points.length>300||points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))throw new Error('Polygon cần 3–300 đỉnh hợp lệ.');
  const orient=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const on=(a,b,c)=>Math.abs(orient(a,b,c))<1e-7 && c.x>=Math.min(a.x,b.x)-1e-7&&c.x<=Math.max(a.x,b.x)+1e-7&&c.y>=Math.min(a.y,b.y)-1e-7&&c.y<=Math.max(a.y,b.y)+1e-7;
  for(let i=0;i<points.length;i++) {
    const a=points[i],b=points[(i+1)%points.length];
    if(Math.hypot(a.x-b.x,a.y-b.y)<.01)throw new Error('Polygon có đỉnh trùng nhau.');
    for(let j=i+1;j<points.length;j++) {
      if(j===i+1||i===0&&j===points.length-1)continue;
      const c=points[j],d=points[(j+1)%points.length];
      if(orient(a,b,c)*orient(a,b,d)<0&&orient(c,d,a)*orient(c,d,b)<0||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b))throw new Error('Polygon tự cắt hoặc có cạnh chồng nhau.');
    }
  }
  const area=Math.abs(points.reduce((s,p,i)=>{const q=points[(i+1)%points.length];return s+p.x*q.y-p.y*q.x;},0))/2;
  if(area<1)throw new Error('Polygon quá nhỏ hoặc thẳng hàng.');
}
export function mapPolygons(polygons,model,fine) {
  return polygons.map(p=> {
    validatePolygon(p.points);
    return {id:p.id,code:p.code,extrapolated:p.points.some(v=>!inHull(adjustedSource(v,model,fine),model.hull)),points:p.points.map(v=>mapPoint(v,model,fine))};
  });
}
