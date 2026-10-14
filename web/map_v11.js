/* Book Poda v12.1 • agrupamento espacial justo para exibir todas as regiões QField.
 * Sem descarte de áreas carregadas, sem impor corte por ordem dos tiles. */
(function () {
'use strict';
const root=document.getElementById('map'),raster=document.getElementById('raster');
const cv=document.getElementById('features'),cx=cv.getContext('2d',{alpha:true});
const tip=document.getElementById('tooltip'),pin=document.getElementById('search-pin');
const btnClear=document.getElementById('clear-marker'),status=document.getElementById('map-status');
const manifest=window.QFIELD_TILE_MANIFEST||{},STEP=window.QFIELD_TILE_STEP||.02;
const PIX=256,MINZOOM=5,MAXZOOM=20,MAX_RASTER_ZOOM=18;
let width=1,height=1,dpr=1,zoom=15,center={lat:-20.47,lon:-54.62};
let base='Satélite',showTD=true,showRD=true,showPost=false;
let selectedPin=null,focusEquipment=null,evidences=[],bridge=null;
let moving=false,pointerLast=null,frame=0,queueTimer=0,tileVersion=0;
let panX=0,panY=0,rasterFrame=0;
// Regiões QField nunca são apagadas durante a sessão. Só os desenhos fora de vista deixam de ser renderizados.
const geoCache=new Map(),pending=new Set(),failed=new Set();let loadQueue=[],loading=0;
const MAX_LOADS=2;
// Imagens-base têm cache limitado; as imagens já visitadas continuam no cache HTTP do Chromium.
const rasterCache=new Map(),rasterActive=new Set();const RASTER_CACHE_LIMIT=180;
let hitPoints=[];
let measureMode="",measurePoints=[],measureClosed=false;
const rad=Math.PI/180;
function mercator(lat,lon,z){
  const s=PIX*Math.pow(2,z),sin=Math.max(-.999999,Math.min(.999999,Math.sin(lat*rad)));
  return {x:(lon+180)*s/360,y:(.5-Math.log((1+sin)/(1-sin))/(4*Math.PI))*s};
}
function inverse(x,y,z){
  const s=PIX*Math.pow(2,z),n=Math.PI-2*Math.PI*y/s;
  return {lat:Math.atan(Math.sinh(n))/rad,lon:x/s*360-180};
}
function position(lat,lon){
  const c=mercator(center.lat,center.lon,zoom),p=mercator(lat,lon,zoom);
  return {x:width/2+p.x-c.x,y:height/2+p.y-c.y};
}
function atPixel(x,y){
  const c=mercator(center.lat,center.lon,zoom);
  return inverse(c.x+x-width/2,c.y+y-height/2,zoom);
}
function viewportCells(){
  if(zoom<12)return [];
  const nw=atPixel(0,0),se=atPixel(width,height);
  let x0=Math.floor(nw.lon/STEP),x1=Math.floor(se.lon/STEP);
  let y0=Math.floor(se.lat/STEP),y1=Math.floor(nw.lat/STEP);
  // Limite explícito impede carregar centenas de tiles ao afastar o zoom.
  if((x1-x0+1)*(y1-y0+1)>105)return [];
  const cells=[];
  for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++){
    const key=x+'_'+y;if(manifest[key])cells.push(key);
  }
  return cells;
}
function redrawSoon(){if(frame)return;frame=requestAnimationFrame(()=>{frame=0;draw()});}
function rasterSoon(){if(rasterFrame)return;rasterFrame=requestAnimationFrame(()=>{rasterFrame=0;updateRaster()})}

function scheduleGeo(){
  clearTimeout(queueTimer);queueTimer=setTimeout(updateQueue,110);
}
function updateQueue(){
  const keys=viewportCells(),cX=Math.floor(center.lon/STEP),cY=Math.floor(center.lat/STEP);
  // Prioridade ao centro da tela e descarta somente solicitações ainda não iniciadas.
  loadQueue=keys.filter(k=>!geoCache.has(k)&&!pending.has(k)&&!failed.has(k));
  loadQueue.sort((a,b)=>{const [ax,ay]=a.split('_').map(Number),[bx,by]=b.split('_').map(Number);
    return (ax-cX)**2+(ay-cY)**2-((bx-cX)**2+(by-cY)**2);
  });
  pump();redrawSoon();
}
function pump(){
  while(loading<MAX_LOADS&&loadQueue.length){
    const k=loadQueue.shift();if(geoCache.has(k)||pending.has(k))continue;
    const el=document.createElement('script');el.async=true;el.src='qfield_tiles/'+manifest[k];
    pending.add(k);loading++;
    const finish=()=>{loading--;pending.delete(k);el.remove();redrawSoon();setTimeout(pump,10)};
    el.onload=finish;
    el.onerror=()=>{failed.add(k);finish();};
    document.head.appendChild(el);
  }
}
window.__QFIELD_TILE__=(k,data)=>{
  // Não expurgar uma região só porque outra foi aberta.
  if(!geoCache.has(k))geoCache.set(k,data);
  redrawSoon();
};
function service(){
  if(base==='Mapa')return 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/';
  return 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/';
}
function getRaster(key,z,x,y){
  let obj=rasterCache.get(key);
  if(obj){obj.last=Date.now();return obj}
  const el=document.createElement('img');el.className='raster-tile';el.draggable=false;el.alt='';
  obj={el,last:Date.now(),ok:false};rasterCache.set(key,obj);
  el.onload=()=>{obj.ok=true};
  el.onerror=()=>{obj.ok=false;el.style.background='#e3e8ed'};
  el.src=service()+z+'/'+y+'/'+x;
  return obj;
}
function updateRaster(){
  if(base==='Sem fundo'){
    for(const k of rasterActive){const o=rasterCache.get(k);if(o)o.el.remove()}
    rasterActive.clear();return;
  }
  const z=Math.min(zoom,MAX_RASTER_ZOOM),sc=Math.pow(2,zoom-z),size=PIX*sc;
  const cp=mercator(center.lat,center.lon,z);
  const left=cp.x-width/2/sc,top=cp.y-height/2/sc;
  const x0=Math.floor(left/PIX)-1,x1=Math.floor((left+width/sc)/PIX)+1;
  const y0=Math.floor(top/PIX)-1,y1=Math.floor((top+height/sc)/PIX)+1;
  const next=new Set(),world=Math.pow(2,z);
  for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++){
    if(y<0||y>=world)continue;
    const canonicalX=((x%world)+world)%world;
    const key=(base==='Mapa'?'map':'sat')+'/'+z+'/'+canonicalX+'/'+y;
    const o=getRaster(key,z,canonicalX,y);
    // Imagens com a mesma chave nunca aparecem duplicadas no viewport local.
    o.el.style.left=(width/2+(x*PIX-cp.x)*sc)+'px';
    o.el.style.top=(height/2+(y*PIX-cp.y)*sc)+'px';
    o.el.style.width=(size+0.5)+'px';o.el.style.height=(size+0.5)+'px';
    if(!o.el.isConnected)raster.appendChild(o.el);
    next.add(key);
  }
  for(const k of rasterActive)if(!next.has(k)){
    const o=rasterCache.get(k);if(o)o.el.remove();
  }
  rasterActive.clear();for(const k of next)rasterActive.add(k);
  if(rasterCache.size>RASTER_CACHE_LIMIT){
    const old=[...rasterCache.entries()].filter(([k])=>!rasterActive.has(k))
      .sort((a,b)=>a[1].last-b[1].last);
    for(const [k,o] of old.slice(0,rasterCache.size-RASTER_CACHE_LIMIT)){
      o.el.remove();rasterCache.delete(k);
    }
  }
}
function paintDot(x,y,kind,row){
  const r=kind==='TD'?5:kind==='RD'?6:2.5;
  cx.beginPath();cx.arc(x,y,r,0,2*Math.PI);
  cx.fillStyle=kind==='TD'?'#ffb12a':kind==='RD'?'#dc3545':'#64748b';cx.fill();
  cx.lineWidth=1;cx.strokeStyle=kind==='TD'?'#ea8200':kind==='RD'?'#8f1020':'#f8fafc';cx.stroke();
  hitPoints.push({x,y,r:Math.max(7,r),kind,row});
}
function paintCluster(group,kind){
  const x=group.sx/group.count,y=group.sy/group.count;
  if(group.count===1){paintDot(x,y,kind,group.example);return}
  const r=10+Math.min(8,Math.log2(group.count)*1.5);
  cx.beginPath();cx.arc(x,y,r,0,Math.PI*2);
  cx.fillStyle=kind==='TD'?'#f6a318':kind==='RD'?'#cf344a':'#536578';cx.fill();
  cx.strokeStyle='#ffffff';cx.lineWidth=2;cx.stroke();
  // Rótulos são dispensáveis durante deslocamento (a camada já é movida em GPU).
  cx.fillStyle=kind==='TD'?'#1e293b':'#ffffff';
  cx.font='bold 11px Segoe UI,Arial,sans-serif';cx.textAlign='center';cx.textBaseline='middle';
  cx.fillText(String(group.count),x,y);
  hitPoints.push({x,y,r,kind:'Grupo '+kind,row:group.example,count:group.count});
}
function drawEquipment(){
  const cells=viewportCells(),stats={TD:{total:0,rendered:0},RD:{total:0,rendered:0},Poste:{total:0,rendered:0}};
  const records={TD:[],RD:[],Poste:[]};
  for(const key of cells){
    const d=geoCache.get(key);if(!d)continue;
    for(const [kind,enabled,minzoom,field] of [
      ['TD',showTD,13,'td'],['RD',showRD,12,'rd'],['Poste',showPost,15,'postes']]){
      if(!enabled||zoom<minzoom)continue;
      for(const row of d[field]||[]){
        const lon=Number(row[0]),lat=Number(row[1]);
        if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;
        const p=position(lat,lon);
        if(p.x<-12||p.y<-12||p.x>width+12||p.y>height+12)continue;
        records[kind].push({x:p.x,y:p.y,row});
      }
    }
  }
  // Cada célula recebe um símbolo, evitando que as primeiras regiões
  // monopolizem um limite global e apaguem equipamentos de outras regiões.
  // Quanto mais perto, menores os grupos, até exibir pontos individuais.
  for(const kind of ['Poste','TD','RD']){
    const points=records[kind],st=stats[kind];st.total=points.length;
    if(!points.length)continue;
    const needsGrouping=(kind==='Poste'&&zoom<18)||points.length>(kind==='Poste'?950:1100);
    if(!needsGrouping){for(const p of points)paintDot(p.x,p.y,kind,p.row);st.rendered=points.length;continue}
    const size=kind==='Poste'?(zoom<16?46:zoom<17?36:zoom<18?28:20):(zoom<15?48:zoom<16?40:zoom<17?30:20);
    const groups=new Map();
    for(const p of points){
      const key=Math.floor(p.x/size)+':'+Math.floor(p.y/size);
      let g=groups.get(key);
      if(!g){g={sx:0,sy:0,count:0,example:p.row};groups.set(key,g)}
      g.sx+=p.x;g.sy+=p.y;g.count++;
    }
    // O agrupamento é calculado sobre TODOS os dados visíveis, não apenas
    // os primeiros registros de cada tile.
    for(const g of groups.values())paintCluster(g,kind);
    st.rendered=groups.size;
  }
  return stats;
}
function drawSpecial(){
  if(focusEquipment){const p=position(focusEquipment.lat,focusEquipment.lon);
    cx.beginPath();cx.arc(p.x,p.y,13,0,2*Math.PI);cx.lineWidth=3;cx.strokeStyle='#1677ff';cx.stroke();
  }
  for(const ev of evidences){
    const p=position(Number(ev.lat),Number(ev.lon));if(p.x<0||p.x>width||p.y<0||p.y>height)continue;
    cx.beginPath();cx.rect(p.x-6,p.y-6,12,12);cx.fillStyle=ev.complete?'#16803c':'#8a51d3';cx.fill();
    cx.lineWidth=2;cx.strokeStyle='#fff';cx.stroke();
    hitPoints.push({x:p.x,y:p.y,r:10,kind:'Evidência',row:ev});
  }
  if(selectedPin){const p=position(selectedPin.lat,selectedPin.lon);
    pin.style.left=p.x+'px';pin.style.top=p.y+'px';
    pin.style.display=(p.x>=-20&&p.x<=width+20&&p.y>=-20&&p.y<=height+20)?'block':'none';
  }else pin.style.display='none';
}

function haversine(a,b){
 const dy=(b.lat-a.lat)*rad,dx=(b.lon-a.lon)*rad;
 const h=Math.sin(dy/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dx/2)**2;
 return 12742000*Math.asin(Math.min(1,Math.sqrt(h)));
}
function measureStats(){
 const n=measurePoints.length,pts=measurePoints;
 let length=0;
 for(let i=1;i<n;i++)length+=haversine(pts[i-1],pts[i]);
 if(measureClosed&&n>=3)length+=haversine(pts[n-1],pts[0]);
 let area=0;
 if(n>=3){
  const lat0=pts.reduce((a,v)=>a+v.lat,0)/n*rad;
  const kx=111320*Math.cos(lat0),ky=111132;
  for(let i=0;i<n;i++){
    const a=pts[i],b=pts[(i+1)%n];area+=((a.lon*kx)*(b.lat*ky)-(b.lon*kx)*(a.lat*ky));
  }
  area=Math.abs(area)/2;
 }
 return {vertices:n,meters:length,km:length/1000,squareMeters:area,mode:measureMode,closed:measureClosed};
}
function reportMeasure(){
 const data=measureStats();
 try{window.parent.postMessage({type:'bookpoda-measure-result',data},location.origin)}catch(e){}
}
function drawMeasure(){
 if(!measurePoints.length)return;
 const pts=measurePoints.map(p=>position(p.lat,p.lon));
 cx.save();cx.beginPath();pts.forEach((p,i)=>i?cx.lineTo(p.x,p.y):cx.moveTo(p.x,p.y));
 if(measureClosed&&pts.length>=3)cx.closePath();
 cx.setLineDash([8,4]);cx.lineWidth=3;cx.strokeStyle='#fdfd5a';cx.shadowBlur=6;cx.shadowColor='#0a2d43';cx.stroke();
 if(measureClosed){cx.fillStyle='#f3ff4f3c';cx.fill()}
 cx.setLineDash([]);cx.shadowBlur=0;
 for(const p of pts){cx.beginPath();cx.arc(p.x,p.y,5,0,Math.PI*2);cx.fillStyle='#fafa43';cx.fill();cx.strokeStyle='#102a43';cx.lineWidth=2;cx.stroke()}
 cx.restore();
}
function draw(){
  updateRaster();
  if(moving)return;
  cx.clearRect(0,0,width,height);hitPoints=[];
  const st=drawEquipment();drawSpecial();drawMeasure();
  const areas=viewportCells(),loaded=areas.filter(k=>geoCache.has(k)).length;
  const fmt=n=>Number(n).toLocaleString('pt-BR');
  const count=k=>st[k].total?fmt(st[k].total)+(st[k].rendered<st[k].total?' ('+fmt(st[k].rendered)+' símbolos)':''):'0';
  let msg=zoom<12?'Aproxime para consultar equipamentos':
    `QField: ${loaded}/${areas.length} regiões · ${count('TD')} TD · ${count('RD')} RD · ${showPost?(zoom>=15?count('Poste')+' postes':'aproxime para postes'):'postes ocultos'}`;
  if(areas.length&&loaded<areas.length)msg+=' · Carregando regiões…';
  msg+=` · Cache: ${geoCache.size} regiões`;
  status.textContent=msg;
}
function resize(){
  const bounds=root.getBoundingClientRect();width=Math.max(1,bounds.width);height=Math.max(1,bounds.height);
  dpr=Math.min(devicePixelRatio||1,2);cv.width=Math.round(width*dpr);cv.height=Math.round(height*dpr);
  cx.setTransform(dpr,0,0,dpr,0,0);redrawSoon();scheduleGeo();
}
function seek(lat,lon,z){
  lat=Number(lat);lon=Number(lon);
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>85||Math.abs(lon)>180)return false;
  center={lat,lon};if(Number.isFinite(Number(z)))zoom=Math.max(MINZOOM,Math.min(MAXZOOM,Math.round(Number(z))));
  tip.style.display='none';redrawSoon();scheduleGeo();return true;
}
function zoomAt(x,y,amount){
  const before=atPixel(x,y),newZ=Math.max(MINZOOM,Math.min(MAXZOOM,zoom+amount));
  if(newZ===zoom)return;
  zoom=newZ;
  const p=mercator(before.lat,before.lon,zoom);
  center=inverse(p.x-(x-width/2),p.y-(y-height/2),zoom);
  redrawSoon();scheduleGeo();
}
function tooltipFor(hit){
  const a=hit.row;
  if(hit.kind.startsWith('Grupo ')){
    const what=hit.kind.slice(6),plural=what==='TD'?'transformadores':what==='RD'?'religadores':'postes';
    return hit.count+' '+plural+' próximos\nAproxime o mapa ou clique no grupo para individualizar.';
  }
  if(hit.kind==='Evidência')return 'Evidência: '+(a.title||'Poda')+'\n'+Number(a.lat).toFixed(6)+', '+Number(a.lon).toFixed(6);
  const name=hit.kind==='TD'?'Transformador':hit.kind==='RD'?'Religador':'Poste';
  return name+'\n'+(a[2]||'Sem número operativo')+(a[3]?'\nCircuito: '+a[3]:'')+
    '\n'+Number(a[1]).toFixed(6)+', '+Number(a[0]).toFixed(6);
}
function hitTest(x,y){
  let hit=null,best=1000;
  for(let i=hitPoints.length-1;i>=0;i--){const p=hitPoints[i],d=Math.hypot(x-p.x,y-p.y);
    if(d<=p.r+4&&d<best){best=d;hit=p}
  }
  return hit;
}
function showTip(ev,x,y){
  const hit=hitTest(x,y);
  if(!hit){tip.style.display='none';return}
  tip.textContent=tooltipFor(hit);tip.style.display='block';
  tip.style.left=Math.max(0,Math.min(width-260,x+15))+'px';
  tip.style.top=Math.max(0,Math.min(height-120,y+15))+'px';
}
function localPos(e){const b=root.getBoundingClientRect();return {x:e.clientX-b.left,y:e.clientY-b.top}}
root.addEventListener('pointerdown',e=>{
  if(e.button!==0||e.target.closest('button'))return;
  pointerLast={x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY};moving=true;
  panX=0;panY=0;
  root.classList.add('is-dragging');root.setPointerCapture(e.pointerId);root.focus({preventScroll:true});
  tip.style.display='none';e.preventDefault();
});
root.addEventListener('pointermove',e=>{
  if(moving&&pointerLast){
    const dx=e.clientX-pointerLast.x,dy=e.clientY-pointerLast.y;
    pointerLast.x=e.clientX;pointerLast.y=e.clientY;
    const c=mercator(center.lat,center.lon,zoom);
    center=inverse(c.x-dx,c.y-dy,zoom);
    panX+=dx;panY+=dy;
    cv.style.transform=`translate3d(${panX}px,${panY}px,0)`;
    rasterSoon();
  }else{const p=localPos(e);showTip(e,p.x,p.y)}
});
root.addEventListener('pointerup',e=>{
  if(!moving)return;
  const last=pointerLast,moved=last&&Math.hypot(e.clientX-last.startX,e.clientY-last.startY)>5;
  moving=false;pointerLast=null;root.classList.remove('is-dragging');
  cv.style.transform='';panX=panY=0;
  redrawSoon();scheduleGeo();
  if(!moved){const p=localPos(e);
    if(measureMode){measurePoints.push(atPixel(p.x,p.y));measureClosed=false;redrawSoon();reportMeasure();return}
    const hit=hitTest(p.x,p.y);
    if(hit&&hit.kind.startsWith('Grupo ')){
      zoomAt(p.x,p.y,Math.min(2,MAXZOOM-zoom));return;
    }
    if(hit&&bridge){
      if(hit.kind==='Evidência'&&bridge.evidenceSelected)bridge.evidenceSelected(String(hit.row.id));
      else if(hit.kind!=='Poste'&&bridge.featureSelected){
        const a=hit.row;bridge.featureSelected(hit.kind,String(a[2]||''),Number(a[1]),Number(a[0]));
      }
    }
  }
});
root.addEventListener('pointercancel',()=>{moving=false;pointerLast=null;cv.style.transform='';panX=panY=0;root.classList.remove('is-dragging');redrawSoon();scheduleGeo()});
root.addEventListener('pointerleave',()=>tip.style.display='none');
root.addEventListener('dblclick',e=>{if(e.target.closest('button'))return;
  if(measureMode){if(measurePoints.length>1){
    const n=measurePoints.length,a=measurePoints[n-1],b=measurePoints[n-2];
    if(haversine(a,b)<3)measurePoints.pop();
    measureClosed=measureMode==='area';reportMeasure();redrawSoon();
  }e.preventDefault();return}
  const p=localPos(e);zoomAt(p.x,p.y,1);e.preventDefault();});
let lastWheel=0;
root.addEventListener('wheel',e=>{
  if(e.target.closest('button'))return;
  e.preventDefault();const now=performance.now();if(now-lastWheel<85)return;lastWheel=now;
  const p=localPos(e);zoomAt(p.x,p.y,e.deltaY<0?1:-1);
},{passive:false});
document.getElementById('zoom-in').addEventListener('click',()=>zoomAt(width/2,height/2,1));
document.getElementById('zoom-out').addEventListener('click',()=>zoomAt(width/2,height/2,-1));
function clearMarker(){selectedPin=null;focusEquipment=null;btnClear.style.display='none';redrawSoon();
  if(window.parent!==window)window.parent.postMessage({type:'bookpoda-marker-cleared'},location.origin);
}
btnClear.addEventListener('click',()=>{clearMarker();root.focus({preventScroll:true})});
document.addEventListener('keydown',e=>{if(e.key==='Delete'||e.key==='Del'){
  if(!['INPUT','TEXTAREA'].includes(document.activeElement.tagName)){clearMarker();e.preventDefault()}
}});
window.clearSearchMarker=clearMarker;
window.showSearchMarker=(lat,lon,z=17)=>{
  if(!seek(lat,lon,z))return false;
  selectedPin={lat:Number(lat),lon:Number(lon)};focusEquipment=null;
  btnClear.style.display='block';redrawSoon();return true;
};
window.flyToEquipment=(lat,lon,kind,id,z=17)=>{
  if(!seek(lat,lon,z))return false;
  selectedPin=null;focusEquipment={lat:Number(lat),lon:Number(lon),kind,id};
  btnClear.style.display='block';redrawSoon();return true;
};
window.flyToPoint=(lat,lon,z)=>seek(lat,lon,z);
window.goTo=window.flyToPoint;
window.setLayerVisibility=(td,rd,post)=>{showTD=!!td;showRD=!!rd;showPost=!!post;redrawSoon();scheduleGeo()};
window.setBaseMap=name=>{base=['Satélite','Híbrido','Mapa','Sem fundo'].includes(name)?name:'Satélite';redrawSoon()};
window.setEvidenceData=data=>{evidences=Array.isArray(data)?data:[];redrawSoon()};
window.setMeasureMode=mode=>{measureMode=['distance','area'].includes(mode)?mode:'';measurePoints=[];measureClosed=false;redrawSoon();reportMeasure();return true};
window.finishMeasure=()=>{measureClosed=measureMode==='area';measureMode='';redrawSoon();reportMeasure();};
window.clearMeasure=()=>{measureMode='';measurePoints=[];measureClosed=false;redrawSoon();reportMeasure();};
window.bookPodaMeasureStats=measureStats;
window.setQFieldData=()=>{};
window.requestViewport=()=>{scheduleGeo();redrawSoon()};
window.bookPodaMapReady=()=>!!(root&&cv&&cx&&window.QFIELD_TILE_MANIFEST);
window.bookPodaDebug=()=>({center,zoom,geoCached:geoCache.size,pending:pending.size,queued:loadQueue.length,base,marker:selectedPin});
if(typeof qt!=='undefined'&&qt.webChannelTransport&&typeof QWebChannel==='function'){
  new QWebChannel(qt.webChannelTransport,ch=>{bridge=ch.objects.bridge||null});
}
if(typeof ResizeObserver==='function')new ResizeObserver(resize).observe(root);
window.addEventListener('resize',resize);resize();
})();
