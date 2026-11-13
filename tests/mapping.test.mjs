import test from 'node:test';
import assert from 'node:assert/strict';
import { VhubDriver } from '../lib/driver.mjs';
import { defaults, sphere, ray, fitMapping, mapPoint, angularError, diagnostics, mapPolygons, validatePolygon, imageProjection, projectToImage } from '../public/mapping-core.mjs';

function truth({x,y}){const a=(x-7000)/1000,b=(y-7000)/1000;return sphere([.3*a+.04*b, .7+.04*a+.25*b, .8-.06*a+.02*b]);}
const locations=[[6000,6000],[8000,6000],[8000,8000],[6000,8000],[7000,6200],[7800,7000],[6900,7700],[6200,6900],[7100,7100]];
const controls=locations.map(([x,y],i)=>({id:String(i),x,y,...truth({x,y}),role:'fit'}));

test('local camera projection recovers independent screen pixels with roll and seam crossing',()=>{
  const direction=({x,y})=>sphere([-(x-600)/800,-(y-400)/800,-1]);
  const samples=[[100,100],[1100,100],[1100,700],[100,700]].map(([x,y],i)=>({id:String(i),role:'fit',x,y,...direction({x,y})}));
  const camera=imageProjection(samples);
  for(const p of [{x:600,y:400},{x:217,y:327},{x:879,y:552}]){const q=projectToImage(direction(p),camera);assert.ok(Math.hypot(q.x-p.x,q.y-p.y)<1e-7);}
  assert.equal(projectToImage({ath:0,atv:0},camera),null);
});
test('planar-to-sphere recovers independent vertices from distributed controls',()=>{
  const m=fitMapping(controls);
  for(const [x,y]of[[6513,6725],[7811,7350],[7023,6490]])assert.ok(angularError(mapPoint({x,y},m),truth({x,y}))<1e-6);
});
test('RANSAC excludes a wrong correspondence without moving the other parcels',()=>{
  const c=[...controls,{id:'wrong',x:6700,y:7300,ath:80,atv:-20,role:'fit'}];
  const m=fitMapping(c,.2);assert.equal(m.inlierIds.includes('wrong'),false);
  assert.ok(angularError(mapPoint({x:6817,y:7119},m),truth({x:6817,y:7119}))<1e-6);
});
test('held-out controls never enter the fit and report true independent error',()=>{
  const checks=[{id:'check',x:6800,y:7200,...truth({x:6800,y:7200}),role:'check'}];checks[0].ath+=2;
  const m=fitMapping([...controls,...checks]);assert.equal(m.inlierIds.includes('check'),false);
  const d=diagnostics([...controls,...checks],m,defaults());assert.equal(d.check.count,1);assert.ok(d.check.rms>1);assert.ok(d.fit.rms<1e-6);
});
test('seam at ±180 degrees is continuous in 3D',()=>{
  const f=({x,y})=>sphere([(x-7000)/1500,.4+(y-7000)/4000,-2]);
  const c=controls.map(p=>({...p,...f(p)})),m=fitMapping(c);
  for(const p of[{x:6900,y:7100},{x:7100,y:7100}])assert.ok(angularError(mapPoint(p,m),f(p))<1e-6);
  assert.ok(angularError({ath:179.99,atv:20},{ath:-179.99,atv:20})<.02);
});
test('degenerate collinear controls fail instead of producing a plausible wrong map',()=>{
  const c=[0,1,2,3,4,5].map(i=>({id:String(i),x:6000+i*100,y:7000,...truth({x:6000+i*100,y:7000})}));assert.throws(()=>fitMapping(c));
});
test('offset is in source pixels and reset reproduces the original mapping',()=>{
  const m=fitMapping(controls),p={x:6700,y:7100};
  assert.ok(angularError(mapPoint(p,m,{...defaults(),offsetX:120,offsetY:-50}),truth({x:6820,y:7050}))<1e-6);
  assert.deepEqual(mapPoint(p,m,defaults()),mapPoint(p,m));
  assert.ok(angularError(mapPoint(p,m,{...defaults(),yaw:2}),mapPoint(p,m))>1);
});
test('rotation and scale act about the calibration origin and preserve shared vertices',()=>{
  const m=fitMapping(controls),fine={...defaults(),rotation:12,scale:1.03,yaw:.2,pitch:-.3,roll:.5};
  const polygons=[{id:'1',code:'A-01',points:[{x:6800,y:6800},{x:7000,y:6800},{x:7000,y:7000},{x:6800,y:7000}]},
    {id:'2',code:'A-02',points:[{x:7000,y:6800},{x:7200,y:6800},{x:7200,y:7000},{x:7000,y:7000}]}];
  const r=mapPolygons(polygons,m,fine);assert.deepEqual(r[0].points[1],r[1].points[0]);assert.deepEqual(r[0].points[2],r[1].points[3]);
  assert.ok(r.every(p=>!p.extrapolated));
});
test('invalid, crossing and duplicate polygons are rejected; extrapolation is flagged',()=>{
  assert.throws(()=>validatePolygon([{x:0,y:0},{x:2,y:2},{x:0,y:2},{x:2,y:0}]));
  assert.throws(()=>validatePolygon([{x:0,y:0},{x:2,y:0},{x:2,y:0},{x:0,y:2}]));
  assert.throws(()=>validatePolygon([{x:0,y:0},{x:1,y:1},{x:2,y:2}]));
  const r=mapPolygons([{id:'1',code:'A-01',points:[{x:5900,y:6500},{x:6100,y:6500},{x:6100,y:6700}]}],fitMapping(controls));assert.equal(r[0].extrapolated,true);
});
test('spherical conversion round trips near poles and rejects invalid fine controls',()=>{
  for(const p of[{ath:179.99,atv:89.99},{ath:-170,atv:-89.9},{ath:0,atv:0}])assert.ok(angularError(p,sphere(ray(p)))<1e-8);
  assert.throws(()=>mapPoint({x:7000,y:7000},fitMapping(controls),{...defaults(),scale:0}));
});
test('fine translation beyond the control hull is flagged even when original vertices were inside',()=>{
  const p={id:'1',code:'A-01',points:[{x:7400,y:6800},{x:7600,y:6800},{x:7600,y:7000}]};
  assert.equal(mapPolygons([p],fitMapping(controls),{...defaults(),offsetX:900})[0].extrapolated,true);
});

test('invalid held-out projection is reported instead of silently passing quality checks',()=>{
  const checks=[{id:'outside',x:17000,y:0,...truth({x:17000,y:0}),role:'check'}];
  const d=diagnostics([...controls,...checks],fitMapping(controls),defaults());
  assert.equal(d.check.invalid,1);assert.equal(d.check.count,0);assert.equal(d.rows.at(-1).error,null);
});

test('read-only map sync works without manager access and preserves outstanding drafts',async()=>{
  const d=new VhubDriver('unused');d.setProject('vinhomes-golden-city');
  d.ensureManager=async()=>{throw new Error('manager required');};
  d.nativeDraftCount=async()=>{throw new Error('must not open manager');};
  d.connect=async()=>{};
  d.page={reload:async()=>{},waitForResponse:async()=>({request:()=>({allHeaders:async()=>({})}),json:async()=>({data:{sceneName:'scene_mb_quy_can'}})})};
  d.refreshData=async()=>{};
  d.descriptor=async()=>({width:1000,height:1000,baseIndex:1,levels:[{url:'https://vhub.com.vn/tours/fixture/%v/%h.jpg'}]});
  d.context={request:{get:async()=>({ok:()=>true,body:async()=>Buffer.from('map fixture')})}};
  d.ownDrafts.add('TH8A-170');d.ownPositions.set('TH8A-170',{ath:0,atv:0});
  const s=await d.sync({requireManager:false});
  assert.equal(s.map.width,1000);assert.equal(s.projectId,'vinhomes-golden-city');assert.equal(d.ownDrafts.size,1);assert.equal(d.ownPositions.size,1);
  await assert.rejects(d.sync(),/manager required/);
});
