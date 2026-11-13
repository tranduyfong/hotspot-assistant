import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { MappingService } from '../lib/mapping.mjs';
import { defaults, sphere } from '../public/mapping-core.mjs';
import { pixelToWorld } from '../lib/domain.mjs';
const fixture=`<!doctype html><meta charset="utf-8"><style>body{margin:0}#krpanoSWFObject{width:1000px;height:700px;background:#ccd9d1}</style><div id="krpanoSWFObject"></div><script>
const v={'xml.scene':'scene_test','image.type':'cube','scene[scene_test].content':'fixture-pano-v1','stagewidth':1000,'stageheight':700,'view.hlookat':0,'view.vlookat':0,'view.fov':90,'view.camroll':0,'view.fovtype':'HFOV'};
const k=document.getElementById('krpanoSWFObject');k.get=x=>v[x];k.set=(x,y)=>v[x]=y;k.screentosphere=(x,y)=>{const h=v['view.hlookat']*Math.PI/180,t=v['view.vlookat']*Math.PI/180,a=(x-500)/500,b=(y-350)/500,c=b*Math.sin(t),yy=b*Math.cos(t)+Math.sin(t),zz=Math.cos(t)-c,xx=a*Math.cos(h)+zz*Math.sin(h),z=-a*Math.sin(h)+zz*Math.cos(h);return{x:Math.atan2(xx,z)*180/Math.PI,y:Math.atan2(yy,Math.hypot(xx,z))*180/Math.PI};};k.spheretoscreen=(ath,atv)=>{const h=ath*Math.PI/180,t=atv*Math.PI/180,ch=v['view.hlookat']*Math.PI/180,cv=v['view.vlookat']*Math.PI/180,x=Math.sin(h)*Math.cos(t),y=Math.sin(t),z=Math.cos(h)*Math.cos(t),a=x*Math.cos(ch)-z*Math.sin(ch),b=x*Math.sin(ch)+z*Math.cos(ch),yy=y*Math.cos(cv)-b*Math.sin(cv),zz=y*Math.sin(cv)+b*Math.cos(cv);return zz>0?{x:500+a/zz*500,y:350+yy/zz*500}:{x:NaN,y:NaN};};k.call=s=>{const add=s.match(/addhotspot\(([^)]+)\)/),del=s.match(/removehotspot\(([^)]+)\)/);if(add)v['hotspot['+add[1]+']']={};if(del){for(const name of Object.keys(v))if(name.startsWith('hotspot['+del[1]+']'))delete v[name];}};window.vars=v;
</script>`;
const truth=({x,y})=>sphere([.3*(x-7000)/1000,.7+.25*(y-7000)/1000,.8-.05*(x-7000)/1000]);
async function setup(){
  const root=await mkdtemp(join(tmpdir(),'vhub-mapping-')),browser=await chromium.launch({channel:'msedge',headless:true});
  const context=await browser.newContext({viewport:{width:1200,height:800}});
  await context.route('**/*',r=>r.request().isNavigationRequest()?r.fulfill({contentType:'text/html',body:fixture}):r.abort());
  const page=await context.newPage();await page.goto('https://vhub.com.vn/du-an/vinhomes-golden-city/quy-can-360');
  const service=new MappingService(root);await service.init();service.page=page;service.projectId='vinhomes-golden-city';service.map={id:'map-fixture',width:17664,height:9936,hfov:1};
  let rows=[],posts=0;
  service.driver={auth:{},hotspots:[{code:'TH8A-170',...pixelToWorld({x:7000,y:7000},service.map)}],products:[{code:'TH8A-170'}],readPages:async()=>rows,context:{request:{post:async(url,{data})=>{assert.equal(url,'https://api.vhub.com.vn/tours/vinhomes-golden-city/hotspots');rows.push({...structuredClone(data),id:randomUUID()});posts++;return{ok:()=>true};}}}};
  const target=await service.target();
  const controls=[[6000,6000],[8000,6000],[8000,8000],[6000,8000],[7000,6200],[7800,7000],[6900,7700],[6200,6900]].map(([x,y])=>({id:randomUUID(),x,y,...truth({x,y}),role:'fit',enabled:true}));
  controls.push(...[[6600,6800],[7300,6700],[7100,7400]].map(([x,y])=>({id:randomUUID(),x,y,...truth({x,y}),role:'check',enabled:true})));
  const profile={id:randomUUID(),name:'Vùng kiểm thử',projectId:service.projectId,mapId:service.map.id,scene:target.scene,sceneFingerprint:target.fingerprint,controls,
    polygons:[{id:randomUUID(),code:'TH8A-170',points:[{x:6800,y:6800},{x:7000,y:6800},{x:7000,y:7000},{x:6800,y:7000}]}],fine:defaults(),threshold:.3,opacity:.24};
  return{service,profile,page,context,browser,root,getPosts:()=>posts,rows:()=>rows,close:async()=>{await browser.close();await rm(root,{recursive:true,force:true});}};
}
test('captured clicks reject changed view and changed scene; preview never writes remote data',{timeout:30000},async()=>{
  const s=await setup();try{
    const c=await s.service.capture();const pick=await s.service.pick({token:c.token,x:500,y:400});assert.equal(pick.ath,0);assert.ok(Math.abs(pick.atv-Math.atan(.1)*180/Math.PI)<1e-8);
    await s.page.evaluate(()=>document.getElementById('krpanoSWFObject').set('view.hlookat',10));
    await assert.rejects(s.service.pick({token:c.token,x:500,y:400}),/Góc nhìn/);
    const preview=await s.service.preview(s.profile);assert.equal(preview.polygons.length,1);assert.ok(preview.screenErrors.every(e=>e<.0001));assert.equal(s.getPosts(),0);
    assert.equal(await s.page.evaluate(()=>window.__vhubMappingPreviewNames.length),1);
    await s.service.clear();assert.equal(await s.page.evaluate(()=>window.__vhubMappingPreviewNames.length),0);
    await s.page.evaluate(()=>document.getElementById('krpanoSWFObject').set('xml.scene','scene_other'));
    await assert.rejects(s.service.preview(s.profile),/phiên bản|cảnh khác/);
  }finally{await s.close();}
});
test('publish requires reviewed current geometry, independent checks and verifies idempotent readback',{timeout:30000},async()=>{
  const s=await setup();try{
    await assert.rejects(s.service.publish(s.profile),/Xem trước/);
    const noChecks={...s.profile,controls:s.profile.controls.filter(c=>c.role==='fit')};await s.service.preview(noChecks);await assert.rejects(s.service.publish(noChecks),/3 mốc/);
    const invalidCheck={...s.profile,controls:[...s.profile.controls,{id:randomUUID(),x:17000,y:0,...truth({x:17000,y:0}),role:'check'}]};
    await s.service.preview(invalidCheck);await assert.rejects(s.service.publish(invalidCheck),/chiếu được/);assert.equal(s.getPosts(),0);
    await s.service.preview(s.profile);await assert.rejects(s.service.publish({...s.profile,fine:{...defaults(),offsetX:1}}),/Xem trước/);
    const saved=await s.service.publish(s.profile);assert.deepEqual(saved.saved,['TH8A-170']);assert.equal(s.getPosts(),1);
    await s.service.publish(s.profile);assert.equal(s.getPosts(),1);
    s.rows()[0].data.polygonPoints[0].ath+=.1;
    await assert.rejects(s.service.publish(s.profile),/Không ghi đè/);assert.equal(s.getPosts(),1);
  }finally{await s.close();}
});
test('profile validates map identity, polygon topology, bounds and persists on reload',{timeout:30000},async()=>{
  const s=await setup();try{
    await assert.rejects(s.service.validate({...s.profile,mapId:'wrong'}),/bản đồ/);
    await assert.rejects(s.service.validate({...s.profile,polygons:[{...s.profile.polygons[0],points:[{x:0,y:0},{x:2,y:2},{x:0,y:2},{x:2,y:0}]}]}),/tự cắt/);
    await assert.rejects(s.service.validate({...s.profile,controls:s.profile.controls.map((c,i)=>i?c:{...c,x:-1})}),/ngoài/);
    await s.service.handle('save-profile',{profile:s.profile});const other=new MappingService(s.root);await other.init();const {profile}=await other.load(s.profile.id);assert.equal(profile.polygons[0].code,'TH8A-170');assert.equal((await other.profiles()).length,1);
  }finally{await s.close();}
});
test('unit group previews product positions and publishes points without polygon writes',{timeout:30000},async()=>{
  const s=await setup();try{
    const profile={...s.profile,workflow:'units',polygons:[],selection:[{x:6000,y:6000},{x:8000,y:6000},{x:8000,y:8000},{x:6000,y:8000}],units:[{code:'TH8A-170',x:7000,y:7000,enabled:true,source:'VHUB 2D'}]};
    const preview=await s.service.preview(profile);assert.equal(preview.units.length,1);assert.equal(preview.polygons.length,0);assert.equal(s.getPosts(),0);
    const row=await s.page.evaluate(()=>{const v=window.vars,base='hotspot[vhub_mapping_preview_unit_0',tip=base+'_tip]';const hidden=v[tip+'.visible'];v[base+'].onover']();const hovered=v[tip+'.visible'];v[base+'].onout']();return{text:v[base+'].html'],code:v[tip+'.html'],hidden,hovered,after:v[tip+'.visible'],ath:v[base+'].ath']};});assert.equal(row.text,'●');assert.equal(row.code,'TH8A-170');assert.equal(row.hidden,false);assert.equal(row.hovered,true);assert.equal(row.after,false);assert.ok(Number.isFinite(row.ath));
    await s.service.publish(profile);assert.equal(s.getPosts(),1);assert.equal(s.rows()[0].productCode,'TH8A-170');assert.equal(s.rows()[0].data.isPolygon,undefined);
    await s.service.publish(profile);assert.equal(s.getPosts(),1);
    s.rows()[0].ath+=1;const result=await s.service.publish(profile);assert.equal(result.skipped[0].code,'TH8A-170');assert.equal(s.getPosts(),1);
  }finally{await s.close();}
});
test('existing 2D tags can be selected and placed as one group without calibration checkpoints',{timeout:30000},async()=>{
  const s=await setup();try{
    for(const [code,x,y]of[['TH8A-172',7100,7000],['TH8A-174',7100,7100]]){s.service.driver.hotspots.push({code,...pixelToWorld({x,y},s.service.map)});s.service.driver.products.push({code});}
    let p={...s.profile,workflow:'units',selection:[{x:6500,y:6500},{x:7500,y:6500},{x:7500,y:7500},{x:6500,y:7500}],units:[],controls:[],polygons:[]};
    const selected=await s.service.select(p);assert.deepEqual(selected.units.map(u=>u.code),['TH8A-170','TH8A-172','TH8A-174']);assert.equal(selected.units[0].source,'Tag 2D');
    p.units=selected.units;const cap=await s.service.capture();p=(await s.service.placeGroup({profile:p,token:cap.token,x:500,y:350})).profile;
    assert.equal(p.placement,'manual');assert.equal(p.controls.filter(c=>c.role==='check').length,0);
    const mapped=await s.service.preview(p);assert.equal(mapped.units.length,3);assert.equal(mapped.units[0].extrapolated,false);
    assert.ok(mapped.units[1].ath>mapped.units[0].ath);assert.ok(mapped.units[2].atv>mapped.units[1].atv);
    await s.service.publish(p);assert.equal(s.getPosts(),3);assert.ok(s.rows().every(h=>!h.data.isPolygon));
  }finally{await s.close();}
});
test('mapping UI loads profile, renders controls, adjusts geometry, previews and undoes edits',{timeout:60000},async()=>{
  const s=await setup();try{
    const png=await sharp({create:{width:1000,height:700,channels:3,background:'#d4e5dd'}}).png().toBuffer(),imageId=await s.service.image(png,true);
    const patch={imageId,mapId:s.service.map.id,left:6000,top:6000,width:2000,height:2000};
    await writeFile(join(s.service.root,'images',imageId+'.json'),JSON.stringify(patch));s.profile.patch=patch;await s.service.save(await s.service.validate(s.profile));
    const conn={projectId:s.service.projectId,map:s.service.map,target:await s.service.target(),scenes:[{id:'scene_test',title:'Cảnh kiểm thử'}],overview:{imageId},profiles:await s.service.profiles(),codes:['TH8A-170'],tags:s.service.tags()};
    const actions=[];
    // Handle only our synthetic local URLs. The native fixture remains network-isolated.
    await s.context.route('http://127.0.0.1:4318/**',async route=>{
      const u=new URL(route.request().url());
      try{
        if(u.pathname.startsWith('/api/mapping/')){const action=u.pathname.split('/').at(-1),body=route.request().postDataJSON();actions.push(action);const v=action==='connect'?conn:action==='patch'?patch:action==='scene'?await s.service.capture():action==='select-units'?{units:[{code:'TH8A-170',x:7300,y:7300,enabled:true,source:'VHUB 2D'}]}:await s.service.handle(action,body);return route.fulfill({json:v});}
        if(u.pathname.startsWith('/api/mapping-image/'))return route.fulfill({contentType:'image/png',body:await s.service.readImage(u.pathname.split('/').at(-1))});
        const file=u.pathname==='/mapping'?'mapping.html':u.pathname.slice(1);if(!['mapping.html','mapping.js','mapping-core.mjs','mapping.css'].includes(file))return route.abort();
        return route.fulfill({contentType:file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css':'text/javascript; charset=utf-8',body:(await readFile(new URL('../public/'+file,import.meta.url),'utf8')).replace('__TOOL_KEY__','test')});
      }catch(e){return route.fulfill({status:400,json:{error:e.message}});}
    });
    const ui=await s.context.newPage(),errors=[];ui.on('pageerror',e=>errors.push(e.message));await ui.goto('http://127.0.0.1:4318/mapping');
    await ui.locator('#connect').click();await ui.locator('#save').waitFor({state:'visible'});await ui.waitForFunction(()=>!document.getElementById('save').disabled);
    await ui.selectOption('#profiles',s.profile.id);await ui.click('#load');await ui.waitForFunction(()=>!document.getElementById('connect').disabled);assert.equal(await ui.locator('#controls tr').count(),11,await ui.locator('#message').textContent()+' '+errors.join('; '));
    await ui.click('#source-fit');assert.equal(await ui.locator('#source').getAttribute('viewBox'),'0 0 17664 9936');
    assert.equal(await ui.locator('#source image').count(),2);
    await ui.click('#source-expand');assert.equal(await ui.locator('#source-pane').evaluate(el=>el.classList.contains('source-expanded')),true);await ui.keyboard.press('Escape');assert.equal(await ui.locator('#source-pane').evaluate(el=>el.classList.contains('source-expanded')),false);
    await ui.click('#fit');await ui.click('#preview');await ui.waitForFunction(()=>!document.getElementById('connect').disabled);assert.equal(await ui.locator('#publish').isDisabled(),false,await ui.locator('#message').textContent()+' '+errors.join('; '));
    assert.equal(await ui.locator('#source polygon').count(),1);assert.match(await ui.locator('#quality').textContent(),/Kiểm tra|kiểm tra/);
    await ui.uncheck('#live');await ui.locator('#fine-offsetX').fill('5');await ui.locator('#fine-offsetX').dispatchEvent('input');assert.equal(await ui.locator('#publish').isDisabled(),true);
    await ui.click('#undo');assert.equal(await ui.locator('#fine-offsetX').inputValue(),'0');
    await ui.waitForFunction(()=>!document.getElementById('save').disabled);
    assert.equal(await ui.locator('#pano-marks circle').count(),11);
    await ui.selectOption('#mode','polygon');await ui.fill('#code','TH8A-172');
    const clickSource=async(x,y)=>{await ui.locator('#source').scrollIntoViewIfNeeded();const p=await ui.locator('#source').evaluate((el,{x,y})=>{const p=el.createSVGPoint();p.x=x;p.y=y;const q=p.matrixTransform(el.getScreenCTM());return{x:q.x,y:q.y};},{x,y});await ui.mouse.click(p.x,p.y);};
    for(const [x,y]of[[7200,7200],[7400,7200],[7400,7400],[7200,7400]])await clickSource(x,y);
    await ui.click('#finish');assert.equal(await ui.locator('#source polygon').count(),2);
    await ui.selectOption('#mode','control');await ui.selectOption('#new-role','check');await clickSource(6500,6500);await ui.locator('#pano').click({position:{x:250,y:180}});
    await ui.waitForFunction(()=>document.querySelectorAll('#controls tr').length===12);await ui.waitForFunction(()=>!document.getElementById('save').disabled);
    assert.equal(await ui.locator('#pano-marks circle').count(),12);
    assert.equal(await ui.locator('#controls tr').last().locator('select').inputValue(),'check');
    await ui.selectOption('#mode','region');
    for(const [x,y]of[[7200,7200],[7400,7200],[7400,7400],[7200,7400]])await clickSource(x,y);
    await ui.click('#finish');await ui.click('#extract-units');await ui.waitForFunction(()=>document.querySelector('#polygon-count').textContent.includes('1/1'));
    assert.match(await ui.locator('#polygons').textContent(),/TH8A-170/);
    await ui.locator('#pano').click({position:{x:250,y:180}});await ui.waitForFunction(()=>!document.getElementById('connect').disabled);
    assert.match(await ui.locator('#message').textContent(),/1 tag/);
    assert.equal(await ui.locator('#source .unit-dot title').first().textContent(),'TH8A-170');
    assert.equal(await ui.locator('#pano-unit-marks .unit-dot title').first().textContent(),'TH8A-170');
    assert.equal(await ui.locator('#pano-unit-marks text').count(),0);
    await ui.check('#live');
    const imageBefore=await ui.locator('#pano').getAttribute('src'),callsBefore=actions.length;
    const dotBefore=Number(await ui.locator('#pano-unit-marks circle').first().getAttribute('cx'));
    await ui.fill('#fine-offsetX','30');await ui.locator('#fine-offsetX').dispatchEvent('input');
    await ui.waitForFunction(x=>Math.abs(Number(document.querySelector('#pano-unit-marks circle').getAttribute('cx'))-x)>1,dotBefore);
    assert.equal(await ui.locator('#pano').getAttribute('src'),imageBefore);assert.deepEqual(actions.slice(callsBefore),[]);
    assert.equal(await ui.locator('#fine-offsetX').isEnabled(),true);
    // Four real pairs replace the generated manual rectangle and auto-fit the tags.
    await ui.selectOption('#mode','control');await ui.selectOption('#new-role','fit');
    for(const [x,y,sx,sy]of[[7200,7200,180,130],[7400,7200,380,130],[7400,7400,380,280],[7200,7400,180,280]]){
      await clickSource(x,y);await ui.locator('#pano').click({position:{x:sx,y:sy}});await ui.waitForFunction(()=>!document.getElementById('connect').disabled);
    }
    assert.equal(await ui.locator('#controls tr').count(),4);assert.equal(await ui.locator('#source .control').count(),4);assert.equal(await ui.locator('#pano-marks circle').count(),4);
    assert.equal(await ui.locator('#pano-unit-marks circle').count(),1);assert.equal(await ui.locator('#pano').getAttribute('src'),imageBefore);
    const demoStart=actions.length;await ui.click('#preview-native');await ui.waitForFunction(()=>!document.getElementById('connect').disabled);
    assert.ok(actions.slice(demoStart).includes('preview'));assert.ok(actions.slice(demoStart).includes('show-native'));assert.equal(await s.page.evaluate(()=>window.__vhubMappingPreviewNames.includes('vhub_mapping_preview_unit_0')),true);
    assert.equal(s.getPosts(),0);assert.deepEqual(errors,[]);
  }finally{await s.close();}
});
