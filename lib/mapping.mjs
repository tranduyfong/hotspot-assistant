import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { VhubDriver, PROJECTS } from './driver.mjs';
import { buildPatch } from './tiles.mjs';
import { tileUrl, codeOf, validatePoint, worldToPixel } from './domain.mjs';
import { fitMapping, mapPoint, mapPolygons, diagnostics, validateFine, validatePolygon, angularError, inHull, adjustedSource } from '../public/mapping-core.mjs';
import { selectUnits } from './unit-selection.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const uuid = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
const fail = text => { throw new Error(text); };

export class MappingService {
  constructor(root) { this.root=join(root,'mapping'); this.dataRoot=root; this.images=new Map(); this.busy=false; this.previewHash=null; }
  async init() { await mkdir(join(this.root,'profiles'),{recursive:true}); await mkdir(join(this.root,'images'),{recursive:true}); }
  async handle(action, body={}) {
    if(this.busy)fail('Đang xử lý bản đồ 360. Hãy chờ thao tác hiện tại hoàn tất.');
    this.busy=true;
    try {
      if(action==='connect')return await this.connect(body.projectId);
      if(action==='profiles')return await this.profiles();
      if(action==='load')return await this.load(body.id);
      if(!this.map || !this.page)fail('Kết nối bản đồ 2D và cảnh 360 trước.');
      if(action==='patch')return await this.patch(body);
      if(action==='select-units')return await this.select(body.profile);
      if(action==='place-group')return await this.placeGroup(body);
      if(action==='capture')return await this.capture();
      if(action==='show-native'){await this.target();await this.page.bringToFront();return{ok:true};}
      if(action==='pick')return await this.pick(body);
      if(action==='markers')return await this.markers(body);
      if(action==='view')return await this.view(body);
      if(action==='scene')return await this.scene(body.scene);
      if(action==='clear') { await this.clear();return {ok:true}; }
      if(action==='save-profile') { const p=await this.validate(body.profile);await this.save(p);return {profile:p}; }
      if(action==='preview')return await this.preview(body.profile);
      if(action==='review') {const p=await this.validate(body.profile),output=this.output(p);this.previewHash=this.signature(p);return output;}
      if(action==='export') { const p=await this.validate(body.profile);return this.output(p); }
      if(action==='publish')return await this.publish(body.profile);
      fail('Thao tác mapping không hợp lệ.');
    } finally {this.busy=false;}
  }
  async connect(projectId) {
    if(!PROJECTS[projectId])fail('Dự án không hợp lệ.');
    if(this.page && !this.page.isClosed())await this.clear();
    // A dedicated flat tab prevents the existing point workflow from reading
    // spherical coordinates as flat-map coordinates when the user changes tabs.
    const d=new VhubDriver(this.dataRoot);d.setProject(projectId);await d.connect();
    await d.sync({requireManager:false});this.driver=d;this.map=d.map;this.projectId=projectId;
    const url=`https://vhub.com.vn/du-an/${projectId}/quy-can-360`;
    this.page=d.context.pages().find(p=>p.url().startsWith(url))||await d.context.newPage();
    if(!this.page.url().startsWith(url))await this.page.goto(url,{waitUntil:'domcontentloaded'});
    await this.page.waitForFunction(()=>{const k=document.getElementById('krpanoSWFObject');return !!k?.get?.('xml.scene')&&k.get('image.type')!=='flat';},null,{timeout:25000});
    await this.page.evaluate(()=>document.getElementById('krpanoSWFObject').set('autorotate.enabled',false));
    const overview=await this.overview();
    const target=await this.target();
    const scenes=await this.page.evaluate(()=>{const k=document.getElementById('krpanoSWFObject'),out=[];for(let i=0;i<k.get('scene.count');i++){const s=k.get(`scene[${i}]`);if(s.name!=='scene_mb_quy_can')out.push({id:s.name,title:s.title||s.name});}return out;});
    return {projectId,map:this.map,target,scenes,overview,profiles:await this.profiles(),codes:this.driver.products.map(p=>p.code),tags:this.tags()};
  }
  async target() {
    if(this.page.isClosed()||!this.page.url().startsWith(`https://vhub.com.vn/du-an/${this.projectId}/quy-can-360`))fail('Tab đích đã rời Quỹ căn 360. Kết nối lại.');
    const t=await this.page.evaluate(()=>{const k=document.getElementById('krpanoSWFObject');if(!k||k.get('image.type')==='flat')throw new Error('Cảnh đích phải là panorama 360.');const scene=String(k.get('xml.scene'));return {scene,type:k.get('image.type'),content:k.get(`scene[${scene}].content`),prealign:k.get('image.prealign')||'',view:{ath:Number(k.get('view.hlookat')),atv:Number(k.get('view.vlookat')),fov:Number(k.get('view.fov'))}};});
    if(!t.content)fail('Không đọc được phiên bản ảnh cảnh 360.');
    return {scene:t.scene,fingerprint:hash([this.projectId,t.scene,t.type,t.content,t.prealign]),type:t.type,view:t.view};
  }
  async image(buffer, persistent=false) {
    const id=randomUUID();
    if(persistent)await writeFile(join(this.root,'images',id+'.png'),buffer);
    else {this.images.set(id,buffer);if(this.images.size>5)this.images.delete(this.images.keys().next().value);}
    return id;
  }
  async readImage(id) {
    if(!uuid(id))fail('Ảnh không hợp lệ.');
    return this.images.get(id)||await readFile(join(this.root,'images',id+'.png'));
  }
  async overview() {
    const level=this.map.levels[0],size=level.tileSize,parts=[];
    for(let row=0;row<Math.ceil(level.height/size);row++)for(let col=0;col<Math.ceil(level.width/size);col++) {
      const r=await this.driver.context.request.get(tileUrl(level.url,row+this.map.baseIndex,col+this.map.baseIndex));
      if(!r.ok())fail('Không tải được ảnh tổng quan.');parts.push({input:await r.body(),left:col*size,top:row*size});
    }
    const assembled=await sharp({create:{width:Math.ceil(level.width/size)*size,height:Math.ceil(level.height/size)*size,channels:3,background:'#fff'}}).composite(parts).png().toBuffer();
    return {imageId:await this.image(await sharp(assembled).extract({left:0,top:0,width:level.width,height:level.height}).png().toBuffer()),width:this.map.width,height:this.map.height};
  }
  async patch(body) {
    const center={x:Number(body.x),y:Number(body.y)};validatePoint(center,this.map.width,this.map.height);
    const imageId=randomUUID(),output=join(this.root,'images',imageId+'.png');
    const bounds=await buildPatch({context:this.driver.context,map:this.map,center,radius:body.radius,root:this.dataRoot,output,notify:()=>{}});
    const result={...bounds,imageId,mapId:this.map.id};
    await writeFile(join(this.root,'images',imageId+'.json'),JSON.stringify(result));return result;
  }
  async geometry() {
    return this.page.evaluate(()=>{const k=document.getElementById('krpanoSWFObject'),r=k.getBoundingClientRect();return {scene:k.get('xml.scene'),view:[k.get('view.hlookat'),k.get('view.vlookat'),k.get('view.fov'),k.get('view.camroll'),k.get('view.fovtype')],rect:{x:r.x,y:r.y,width:r.width,height:r.height},stage:[k.get('stagewidth')||r.width,k.get('stageheight')||r.height]};});
  }
  async capture() {
    await this.page.bringToFront();
    const target=await this.target();await this.page.waitForTimeout(220);
    const before=await this.geometry();
    // Keep the local image free of runtime dots so local fine adjustments do not
    // leave the previous green dots baked into the background after a native demo.
    const hidden=await this.page.evaluate(()=>{const k=document.getElementById('krpanoSWFObject');return(window.__vhubMappingPreviewNames||[]).filter(n=>n.startsWith('vhub_mapping_preview_unit_')).map(n=>{const visible=k.get(`hotspot[${n}].visible`)!==false;k.set(`hotspot[${n}].visible`,false);return{n,visible};});});
    let buffer;
    try{buffer=await this.page.screenshot({type:'png',clip:before.rect});}
    finally{await this.page.evaluate(hidden=>{const k=document.getElementById('krpanoSWFObject');hidden.forEach(({n,visible})=>k.set(`hotspot[${n}].visible`,visible));},hidden);}
    const after=await this.geometry();
    if(JSON.stringify(before)!==JSON.stringify(after))fail('Góc nhìn đang di chuyển. Chờ dừng rồi lấy ảnh lại.');
    const imageId=await this.image(buffer),token=randomUUID();
    this.snapshot={token,geometry:after,fingerprint:target.fingerprint};
    const editor=this.page.context().pages().find(p=>/^http:\/\/127\.0\.0\.1:\d+\/mapping$/.test(p.url()));
    if(editor)await editor.bringToFront();
    const cameraControls=await this.page.evaluate(g=>{const k=document.getElementById('krpanoSWFObject');return [[.25,.25],[.75,.25],[.75,.75],[.25,.75]].map(([a,b],i)=>{const x=a*g.rect.width,y=b*g.rect.height,p=k.screentosphere(a*g.stage[0],b*g.stage[1]);return{id:'camera-'+i,x,y,ath:((p.x+180)%360+360)%360-180,atv:p.y,role:'fit'};});},after);
    if(JSON.stringify(await this.geometry())!==JSON.stringify(after))fail('Góc nhìn đang di chuyển. Lấy ảnh lại.');
    return {imageId,token,width:after.rect.width,height:after.rect.height,target,cameraControls};
  }
  async pick({token,x,y}) {
    if(!this.snapshot||token!==this.snapshot.token)fail('Ảnh 360 đã cũ. Lấy ảnh mới rồi chấm lại.');
    const g=await this.geometry();if(JSON.stringify(g)!==JSON.stringify(this.snapshot.geometry)||(await this.target()).fingerprint!==this.snapshot.fingerprint)fail('Góc nhìn hoặc cảnh đã đổi. Lấy ảnh mới rồi chấm lại.');
    validatePoint({x,y},g.rect.width,g.rect.height);
    return this.page.evaluate(({x,y,g})=>{const k=document.getElementById('krpanoSWFObject'),p=k.screentosphere(x*g.stage[0]/g.rect.width,y*g.stage[1]/g.rect.height);return {ath:((p.x+180)%360+360)%360-180,atv:p.y};},{x,y,g});
  }
  async markers({token,points}) {
    if(!this.snapshot||token!==this.snapshot.token||JSON.stringify(await this.geometry())!==JSON.stringify(this.snapshot.geometry)||(await this.target()).fingerprint!==this.snapshot.fingerprint)fail('Ảnh 360 đã đổi. Lấy lại ảnh để hiển thị mốc.');
    if(!Array.isArray(points)||points.length>1000||points.some(p=>![p.ath,p.atv].every(Number.isFinite)||Math.abs(p.ath)>180||Math.abs(p.atv)>90))fail('Danh sách mốc không hợp lệ.');
    const g=this.snapshot.geometry;
    return this.page.evaluate(({points,g})=>{const k=document.getElementById('krpanoSWFObject');return points.map(p=>{const v=k.spheretoscreen(p.ath,p.atv);if(!v||![v.x,v.y].every(Number.isFinite)||v.x<0||v.y<0||v.x>g.stage[0]||v.y>g.stage[1])return null;return{x:v.x/g.stage[0]*g.rect.width,y:v.y/g.stage[1]*g.rect.height};});},{points,g});
  }
  async view({direction}) {
    await this.target();
    await this.page.bringToFront();
    if(!['left','right','up','down','in','out'].includes(direction))fail('Hướng không hợp lệ.');
    await this.page.evaluate(direction=>{const k=document.getElementById('krpanoSWFObject');k.set('autorotate.enabled',false);const f=Number(k.get('view.fov')),step=f*.16;
      if(direction==='in'||direction==='out')k.set('view.fov',Math.min(145,Math.max(5,f*(direction==='in'?.8:1.25))));
      else if(direction==='left'||direction==='right')k.set('view.hlookat',Number(k.get('view.hlookat'))+(direction==='left'?-step:step));
      else k.set('view.vlookat',Math.max(-85,Math.min(85,Number(k.get('view.vlookat'))+(direction==='up'?-step:step))));
    },direction);
    await this.page.waitForTimeout(350);return this.capture();
  }
  async scene(scene) {
    await this.clear();
    await this.page.bringToFront();
    await this.page.evaluate(scene=>{const k=document.getElementById('krpanoSWFObject');if(!/^[a-z0-9_]+$/i.test(scene)||!k.get(`scene[${scene}].name`)||scene==='scene_mb_quy_can')throw new Error('Cảnh không hợp lệ.');k.call(`loadscene(${scene},null,MERGE,BLEND(0.2));`);},scene);
    await this.page.waitForFunction(scene=>{const k=document.getElementById('krpanoSWFObject');return k.get('xml.scene')===scene;},scene,{timeout:15000});
    await this.page.waitForTimeout(1000);return this.capture();
  }
  async validate(value) {
    if(!value||!uuid(value.id)||typeof value.name!=='string'||!value.name.trim()||value.name.length>120)fail('Tên hoặc mã profile không hợp lệ.');
    const target=await this.target();
    if(value.projectId!==this.projectId||value.mapId!==this.map.id||value.scene!==target.scene||value.sceneFingerprint!==target.fingerprint)fail('Profile thuộc bản đồ hoặc cảnh khác. Kết nối và chọn đúng cảnh trước.');
    if(!Array.isArray(value.controls)||value.controls.length>100||!Array.isArray(value.polygons)||value.polygons.length>100)fail('Tối đa 100 mốc và 100 polygon mỗi profile.');
    const ids=new Set(),codes=new Set();
    for(const c of [...value.controls,...value.polygons]){if(!uuid(c.id)||ids.has(c.id))fail('Mã đối tượng trùng hoặc không hợp lệ.');ids.add(c.id);}
    const controls=value.controls.map(c=>{validatePoint(c,this.map.width,this.map.height);if(!Number.isFinite(c.ath)||!Number.isFinite(c.atv)||Math.abs(c.ath)>180||Math.abs(c.atv)>90||!['fit','check'].includes(c.role))fail('Mốc cầu không hợp lệ.');return{id:c.id,x:c.x,y:c.y,ath:c.ath,atv:c.atv,role:c.role,enabled:c.enabled!==false};});
    for(let i=0;i<controls.length;i++)for(let j=i+1;j<controls.length;j++)if(controls[i].enabled&&controls[j].enabled&&Math.hypot(controls[i].x-controls[j].x,controls[i].y-controls[j].y)<1)fail('Hai mốc dùng cùng vị trí 2D. Mốc kiểm tra cần một vị trí độc lập.');
    const polygons=value.polygons.map(p=>{const code=codeOf(p.code);if(codes.has(code))fail('Mã căn bị trùng trong profile.');codes.add(code);validatePolygon(p.points);p.points.forEach(v=>validatePoint(v,this.map.width,this.map.height));return{id:p.id,code,points:p.points.map(v=>({x:v.x,y:v.y}))};});
    let patch=null;
    if(value.patch){if(!uuid(value.patch.imageId))fail('Ảnh nguồn không hợp lệ.');patch=JSON.parse(await readFile(join(this.root,'images',value.patch.imageId+'.json'),'utf8'));if(patch.mapId!==this.map.id)fail('Ảnh nguồn thuộc bản đồ khác.');}
    const threshold=Number(value.threshold??.3);if(!Number.isFinite(threshold)||threshold<=0||threshold>3)fail('Ngưỡng mốc không hợp lệ.');
    const selection=value.selection||[];if(selection.length){validatePolygon(selection);selection.forEach(v=>validatePoint(v,this.map.width,this.map.height));}
    if(!Array.isArray(value.units||[])||(value.units||[]).length>1000)fail('Tối đa 1.000 căn mỗi vùng.');
    const unitCodes=new Set();const units=(value.units||[]).map(u=>{const code=codeOf(u.code);if(unitCodes.has(code))fail('Mã căn trùng trong vùng chọn.');unitCodes.add(code);validatePoint(u,this.map.width,this.map.height);return{code,x:u.x,y:u.y,source:String(u.source||''),enabled:u.enabled!==false,conflict:!!u.conflict};});
    return {version:1,id:value.id,name:value.name.trim(),projectId:this.projectId,mapId:this.map.id,scene:target.scene,sceneFingerprint:target.fingerprint,
      workflow:value.workflow==='units'?'units':'polygons',placement:value.placement==='manual'?'manual':'calibrated',selection,units,patch,controls,polygons,fine:validateFine(value.fine),opacity:Number.isFinite(value.opacity)?Math.min(.7,Math.max(0,value.opacity)):.24,threshold,updatedAt:new Date().toISOString()};
  }
  tags() {return this.driver.hotspots.filter(h=>!h.duplicate).map(h=>({...worldToPixel(h,this.map),code:h.code,source:'Tag 2D',priority:2}));}
  async select(value) {
    const p=await this.validate(value);validatePolygon(p.selection);
    const units=selectUnits(p.selection,this.tags());
    if(units.length>1000)fail('Chon toi da 1.000 tag moi nhom.');
    return{units};
  }
  async placeGroup({profile,token,x,y}) {
    const p=await this.validate(profile);await this.pick({token,x,y});
    const units=p.units.filter(u=>u.enabled);if(!units.length)fail('Chua chon tag nao.');
    const xs=units.map(u=>u.x),ys=units.map(u=>u.y),cx=(Math.min(...xs)+Math.max(...xs))/2,cy=(Math.min(...ys)+Math.max(...ys))/2;
    const w=Math.max(40,Math.max(...xs)-Math.min(...xs))*1.15,h=Math.max(40,Math.max(...ys)-Math.min(...ys))*1.15;
    const g=this.snapshot.geometry,scale=Math.min(g.rect.width*.4/w,g.rect.height*.4/h);
    const center={x:Math.max(w*scale/2,Math.min(g.rect.width-w*scale/2,x)),y:Math.max(h*scale/2,Math.min(g.rect.height-h*scale/2,y))};
    const corners=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([a,b])=>({x:cx+a*w/2,y:cy+b*h/2,sx:center.x+a*w*scale/2,sy:center.y+b*h*scale/2}));
    corners.forEach(c=>validatePoint(c,this.map.width,this.map.height));
    const controls=await this.page.evaluate(({corners,g})=>{const k=document.getElementById('krpanoSWFObject');return corners.map(c=>{const v=k.screentosphere(c.sx*g.stage[0]/g.rect.width,c.sy*g.stage[1]/g.rect.height);return{x:c.x,y:c.y,ath:((v.x+180)%360+360)%360-180,atv:v.y,role:'fit',enabled:true};});},{corners,g});
    controls.forEach(c=>c.id=randomUUID());
    return{profile:{...p,controls,placement:'manual',fine:{offsetX:0,offsetY:0,rotation:0,scale:1,yaw:0,pitch:0,roll:0}}};
  }
  async profiles() {
    const out=[];for(const name of await readdir(join(this.root,'profiles'))){if(!/^[a-f0-9-]{36}\.json$/.test(name))continue;const p=JSON.parse(await readFile(join(this.root,'profiles',name),'utf8'));out.push({id:p.id,name:p.name,projectId:p.projectId,mapId:p.mapId,scene:p.scene,updatedAt:p.updatedAt,polygons:p.polygons.length});}return out;
  }
  async save(p) {const file=join(this.root,'profiles',p.id+'.json');await writeFile(file+'.tmp',JSON.stringify(p,null,2));await rename(file+'.tmp',file);}
  async load(id) {if(!uuid(id))fail('Profile không hợp lệ.');return {profile:JSON.parse(await readFile(join(this.root,'profiles',id+'.json'),'utf8'))};}
  output(p) {const model=fitMapping(p.controls,p.threshold);return {version:1,profile:p,model,diagnostics:diagnostics(p.controls,model,p.fine),polygons:p.workflow==='units'?[]:mapPolygons(p.polygons,model,p.fine),units:(p.units||[]).filter(u=>u.enabled).map(u=>({...u,...mapPoint(u,model,p.fine),extrapolated:p.placement!=='manual'&&!inHull(adjustedSource(u,model,p.fine),model.hull)}))};}
  signature(p){const {updatedAt,...data}=p;return hash(data);}
  async clear() {
    this.previewHash=null;
    if(this.page&&!this.page.isClosed())await this.page.evaluate(()=>{const k=document.getElementById('krpanoSWFObject');for(const n of window.__vhubMappingPreviewNames||[])if(k?.get(`hotspot[${n}]`))k.call(`removehotspot(${n});`);window.__vhubMappingPreviewNames=[];}).catch(()=>{});
  }
  async preview(value) {
    const p=await this.validate(value),output=this.output(p);await this.clear();
    await this.page.evaluate(({polygons,units,opacity})=>{
      const k=document.getElementById('krpanoSWFObject'),names=[];
      try {
        for(const [i,p] of polygons.entries()) {
          const name=`vhub_mapping_preview_${i}`;k.call(`addhotspot(${name});`);names.push(name);
          const set=(a,v)=>k.set(`hotspot[${name}].${a}`,v);
          set('keep',false);set('capture',false);set('enabled',false);set('fillcolor',p.extrapolated?0xf59e0b:0x10b981);set('fillalpha',opacity);set('bordercolor',p.extrapolated?0xf59e0b:0x10b981);set('borderwidth',2);set('borderalpha',1);
          p.points.forEach((v,j)=>{set(`point[${j}].ath`,v.ath);set(`point[${j}].atv`,v.atv);});
        }
        for(const [i,u] of units.entries()) {
          const name=`vhub_mapping_preview_unit_${i}`;k.call(`addhotspot(${name});`);names.push(name);
          const set=(a,v)=>k.set(`hotspot[${name}].${a}`,v);
          const tip=name+'_tip';k.call(`addhotspot(${tip});`);names.push(tip);
          const label=(a,v)=>k.set(`hotspot[${tip}].${a}`,v);
          label('type','text');label('html',u.code);label('ath',u.ath);label('atv',u.atv);label('oy',-25);label('css','font: bold 13px Arial; color: #ffffff;');label('bgcolor',0x193238);label('bgalpha',.95);label('padding',5);label('keep',false);label('enabled',false);label('visible',false);
          set('type','text');set('html','●');set('ath',u.ath);set('atv',u.atv);set('css',`font: 20px Arial; color: ${u.extrapolated?'#b45309':'#047857'}; text-shadow: 0 0 2px white;`);set('bgalpha',0);set('padding',0);set('keep',false);set('enabled',true);
          set('onover',()=>label('visible',true));set('onout',()=>label('visible',false));
        }
      } finally {window.__vhubMappingPreviewNames=names;}
    },{polygons:output.polygons,units:output.units,opacity:p.opacity});
    const capture=await this.capture();
    const screenErrors=await this.page.evaluate(({expected,actual})=>{const k=document.getElementById('krpanoSWFObject');return expected.map((p,i)=>{if(!actual[i])return null;const a=k.spheretoscreen(p.ath,p.atv),b=k.spheretoscreen(actual[i].ath,actual[i].atv);return a&&b&&[a.x,a.y,b.x,b.y].every(Number.isFinite)?Math.hypot(a.x-b.x,a.y-b.y):null;});}, {expected:p.controls,actual:p.controls.map(c=>{try{return mapPoint(c,output.model,p.fine);}catch{return null;}})});
    // Angular diagnostics remain independent of the current viewport.
    this.previewHash=this.signature(p);
    return {...output,capture,screenErrors};
  }
  async publish(value) {
    const p=await this.validate(value),result=this.output(p);
    if(p.workflow==='units')return this.publishUnits(p,result);
    if(this.previewHash!==this.signature(p))fail('Xem trước phiên bản hiện tại trên 360 trước khi lưu lên VHUB.');
    if(!p.polygons.length)fail('Chưa có polygon để lưu.');
    const known=new Set(this.driver.products.map(v=>v.code));
    const unknown=p.polygons.filter(v=>!known.has(v.code));if(unknown.length)fail(`Mã căn chưa có trong danh mục dự án: ${unknown.map(v=>v.code).join(', ')}.`);
    if(result.polygons.some(p=>p.extrapolated))fail('Có polygon ngoài vùng mốc. Bổ sung mốc bao quanh trước khi lưu.');
    if(result.diagnostics.check.count<3||result.diagnostics.check.invalid||result.diagnostics.check.max>p.threshold)fail('Cần ít nhất 3 mốc kiểm tra độc lập; mọi mốc kiểm tra đang bật phải chiếu được và sai số không vượt ngưỡng đã chọn.');
    const drafts=await this.page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('vhub:hotspot-draft-buffer:')).some(k=>{try{const v=JSON.parse(localStorage.getItem(k));return v.sceneName===document.getElementById('krpanoSWFObject').get('xml.scene')&&(Object.keys(v.upserts||{}).length||Object.keys(v.deletes||{}).length);}catch{return true;}}));
    if(drafts)fail('Cảnh đích đang có nháp trong Quản lý hotspot. Xử lý nháp trước khi lưu polygon.');
    await this.save(p);
    const path=`/tours/${this.projectId}/hotspots?sceneName=${encodeURIComponent(p.scene)}`;
    let existing=await this.driver.readPages(path);const saved=[];
    for(const poly of result.polygons) {
      if((await this.target()).fingerprint!==p.sceneFingerprint)fail(`Cảnh đích đã đổi. Dừng sau ${saved.length} polygon đã xác minh.`);
      const productCode=`map_${p.id.replaceAll('-','')}_${poly.id.replaceAll('-','')}`;
      const matches=existing.filter(h=>h.productCode===productCode);
      const verify=h=>{const pts=h?.data?.polygonPoints;return h?.sceneName===p.scene&&h.data?.mappingProfileId===p.id&&h.data?.onclickTarget===poly.code&&Array.isArray(pts)&&pts.length===poly.points.length&&pts.every((v,i)=>angularError(v,poly.points[i])<.00001);};
      if(matches.length) {if(matches.length!==1||!verify(matches[0]))fail(`Polygon ${poly.code} đã có dữ liệu khác trên VHUB. Không ghi đè.`);saved.push(poly.code);continue;}
      const payload={sceneName:p.scene,productCode,ath:poly.points[0].ath,atv:poly.points[0].atv,data:{hotspotCode:productCode,isPolygon:true,title:poly.code,polygonPoints:poly.points,fillColor:'#10B981',fillAlpha:p.opacity,borderColor:'#FFFFFF',borderWidth:2,borderAlpha:1,onclickAction:'product',onclickTarget:poly.code,mappingProfileId:p.id}};
      const requestFile=join(this.root,'last-publish.json');await writeFile(requestFile,JSON.stringify({profileId:p.id,code:poly.code,productCode,saved,startedAt:new Date().toISOString()}));
      const response=await this.driver.context.request.post(`https://api.vhub.com.vn/tours/${this.projectId}/hotspots`,{headers:this.driver.auth,data:payload,timeout:30000});
      if(!response.ok())fail([401,403].includes(response.status())?`Cần đăng nhập VHUB bằng tài khoản có quyền lưu hotspot, rồi kết nối lại và mở profile đã lưu. Đã xác minh ${saved.length} polygon trong lượt này.`:`VHUB trả ${response.status()} khi lưu ${poly.code}; đã lưu ${saved.length} căn. Kiểm tra và thử lại để đọc đối chiếu.`);
      existing=await this.driver.readPages(path);
      const rows=existing.filter(h=>h.productCode===productCode);
      if(rows.length!==1||!verify(rows[0]))fail(`Chưa xác minh được polygon ${poly.code} sau khi lưu. Kiểm tra VHUB trước khi tiếp tục.`);
      saved.push(poly.code);
    }
    await writeFile(join(this.root,`published-${p.id}.json`),JSON.stringify({saved,at:new Date().toISOString(),signature:this.signature(p)},null,2));
    return {saved};
  }
  async publishUnits(p,result) {
    if(this.previewHash!==this.signature(p))fail('Ốp thử cả nhóm lên 360 trước khi đồng bộ.');
    if(!result.units.length)fail('Chưa chọn căn nào.');
    if(p.placement!=='manual'&&(result.diagnostics.check.count<3||result.diagnostics.check.invalid||result.diagnostics.check.max>p.threshold))fail('Cần 3 mốc kiểm tra đạt ngưỡng trước khi đồng bộ thật.');
    if(result.units.some(u=>u.extrapolated||u.conflict))fail('Có căn ngoài vùng mốc hoặc vị trí nguồn chưa rõ. Bỏ chọn căn đó hoặc bổ sung mốc.');
    if(await this.page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('vhub:hotspot-draft-buffer:')).some(k=>{try{const v=JSON.parse(localStorage.getItem(k));return v.sceneName===document.getElementById('krpanoSWFObject').get('xml.scene')&&(Object.keys(v.upserts||{}).length||Object.keys(v.deletes||{}).length);}catch{return true;}})))fail('Xử lý nháp trên VHUB trước khi đồng bộ nhóm căn.');
    const known=new Set(this.driver.products.map(v=>v.code)),saved=[],skipped=[];
    let existing=await this.driver.readPages(`/tours/${this.projectId}/hotspots?sceneName=${encodeURIComponent(p.scene)}`);
    await this.save(p);
    for(const u of result.units) {
      if((await this.target()).fingerprint!==p.sceneFingerprint)fail('Cảnh đã đổi. Dừng đồng bộ.');
      if(!known.has(u.code)){skipped.push({code:u.code,reason:'Không có trong danh mục sản phẩm'});continue;}
      const rows=existing.filter(h=>h.productCode===u.code&&!h.data?.isPolygon);
      if(rows.length){if(rows.length===1&&angularError(rows[0],u)<.00001)saved.push(u.code);else skipped.push({code:u.code,reason:'Đã có vị trí khác trên 360'});continue;}
      await writeFile(join(this.root,'last-publish.json'),JSON.stringify({profileId:p.id,code:u.code,saved,startedAt:new Date().toISOString()}));
      const response=await this.driver.context.request.post(`https://api.vhub.com.vn/tours/${this.projectId}/hotspots`,{headers:this.driver.auth,data:{sceneName:p.scene,productCode:u.code,ath:u.ath,atv:u.atv,data:{title:u.code,hotspotCode:u.code,hotspotType:'product',visibilityScope:'all',mappingProfileId:p.id}},timeout:30000});
      if(!response.ok())fail(`VHUB trả ${response.status()} khi lưu ${u.code}. Đã xác minh ${saved.length} căn; kết nối lại để thử tiếp.`);
      existing=await this.driver.readPages(`/tours/${this.projectId}/hotspots?sceneName=${encodeURIComponent(p.scene)}`);
      const readback=existing.filter(h=>h.productCode===u.code&&!h.data?.isPolygon);
      if(readback.length!==1||angularError(readback[0],u)>.00001)fail(`Chưa xác minh được ${u.code}. Kiểm tra VHUB trước khi thử tiếp.`);
      saved.push(u.code);
    }
    await writeFile(join(this.root,`published-${p.id}.json`),JSON.stringify({saved,skipped,at:new Date().toISOString()},null,2));
    return{saved,skipped};
  }
}
