'use strict';
const $=id=>document.getElementById(id);
const state={os:'',date:'',qtd:'',records:[],settings:{},photo:{antes:'',depois:''},activeSide:'antes',mapSelected:null,editing:-1,loading:false};
let draftTimer=null,noticeTimer=null,mapReady=false,osRows=[];
const pageTitles={book:'Novo Book fotográfico',map:'Mapa QField',history:'Registros de Books',os:'Ordens de Serviço',settings:'Configurações'};
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
async function api(url,options={}){
  const response=await fetch(url,{...options,headers:{...(options.body instanceof Blob?{'Content-Type':options.body.type}:options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}});
  let result;
  try{result=await response.json()}catch{throw Error('Servidor respondeu com dados inesperados.')}
  if(!response.ok)throw Error(result.error||'Falha na operação.');
  return result;
}
function toast(message,error=false){const a=$('alert');a.textContent=message;a.className='alert'+(error?' error':'');clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>a.classList.add('hidden'),7500)}
function tab(id){
  document.querySelectorAll('.page').forEach(x=>x.classList.toggle('active',x.id==='page-'+id));
  document.querySelectorAll('.nav-btn').forEach(x=>x.classList.toggle('selected',x.dataset.tab===id));
  $('page-title').textContent=pageTitles[id];
  if(id==='history')loadHistory();if(id==='os')loadOS(false);if(id==='settings')showSettings();
  if(id==='map')setTimeout(()=>callMap('requestViewport'),60);
  history.replaceState(null,'','#'+id);
}
function today(){const d=new Date();return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;}
function dateFormatting(text){let digits=String(text).replace(/\D/g,'').slice(0,8);return [digits.slice(0,2),digits.slice(2,4),digits.slice(4)].filter(Boolean).join('/');}
function getForm(){return {os:$('book-os').value.trim(),date:$('book-date').value.trim(),qtd:$('book-qtd').value,records:state.records};}
function scheduleDraft(){clearTimeout(draftTimer);draftTimer=setTimeout(()=>api('/api/draft',{method:'POST',body:JSON.stringify(getForm())}).catch(e=>console.warn('Rascunho',e)),550)}
function applyDraft(d){
  $('book-os').value=d.os||'';$('book-date').value=d.date||today();$('book-qtd').value=d.qtd||'';
  state.records=Array.isArray(d.records)?d.records:[];
  updateRecords();updateDestination();
}
function clearRecordFields(){
  for(const field of ['coord','td','rd','bairro','rua'])$('rec-'+field).value='';
  state.photo={antes:'',depois:''};state.editing=-1;renderPhotos();setActivePhoto('antes');
  $('add-record').textContent='＋ Adicionar poda ao Book';
}
function clearBook(force=false){
  if(!force&&(state.records.length||$('book-os').value.trim())&&!confirm('Iniciar um novo Book? Os dados ainda não gerados serão descartados. Os PDFs já salvos permanecerão no histórico.'))return;
  clearTimeout(draftTimer);
  applyDraft({date:today(),records:[]});clearRecordFields();
  api('/api/draft/clear',{method:'POST',body:'{}'}).catch(e=>toast(e.message,true));
  updateDestination();toast('Novo Book iniciado. O histórico foi preservado.');
}
function updateDestination(){
  const m=$('book-date').value.match(/^\d{2}\/([01]\d)\/(\d{4})$/);
  const names=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  $('book-dest').textContent=m&&+m[1]>=1&&+m[1]<=12?`Books / ${m[2]} / ${m[1]} - ${names[+m[1]-1]}`:'Books / Ano / Mês';
}
function setActivePhoto(side){state.activeSide=side;document.querySelectorAll('.photo-box').forEach(el=>el.classList.toggle('active',el.dataset.side===side))}
function renderPhotos(){
  for(const side of ['antes','depois']){
    const url=state.photo[side],el=$('photo-'+side),img=el.querySelector('img');
    el.classList.toggle('has-photo',!!url);img.classList.toggle('hidden',!url);
    if(url)img.src=url;else img.removeAttribute('src');
  }
}
async function upload(blob,side){
  if(!blob || !blob.type.startsWith('image/'))throw Error('Escolha uma imagem válida.');
  if(blob.size>18*1024*1024)throw Error('O limite por foto é de 18 MB.');
  const result=await api('/api/upload',{method:'POST',body:blob});
  state.photo[side]=result.url;renderPhotos();
  setActivePhoto(side==='antes'?'depois':'antes');
  toast('Foto carregada.');
}
function collectRecord(){return {coord:$('rec-coord').value.trim(),td:$('rec-td').value.trim(),rd:$('rec-rd').value.trim(),bairro:$('rec-bairro').value.trim(),rua:$('rec-rua').value.trim(),antes:state.photo.antes,depois:state.photo.depois}}
async function addRecord(){
  const d=collectRecord();if(!d.coord)return toast('Informe as coordenadas da poda.',true);
  if(!d.antes||!d.depois)return toast('Adicione as fotos ANTES e DEPOIS.',true);
  try{const result=await api('/api/search?q='+encodeURIComponent(d.coord));if(result.type!=='coord')throw Error('Digite uma coordenada válida.')}
  catch(e){return toast(e.message,true)}
  if(state.editing>=0){state.records[state.editing]=d}
  else state.records.push(d);
  clearRecordFields();
  if(!$('book-qtd').value||+$('book-qtd').value===state.records.length-1)$('book-qtd').value=state.records.length;
  updateRecords();scheduleDraft();toast('Poda adicionada ao Book.');
}
function updateRecords(){
  $('records-count').textContent=state.records.length;
  const el=$('record-list');
  if(!state.records.length){el.innerHTML='<div class="empty">Ainda não há podas neste Book.</div>';return}
  el.innerHTML=state.records.map((r,i)=>`<div class="record-row"><div class="row-number">${i+1}</div><div><b>${esc(r.td||'Sem TD')}</b><small>${esc(r.coord)}</small></div><div><b>${esc(r.rd||'Sem religador')}</b><small>${esc(r.bairro||'Bairro não informado')}</small></div><div><b>${esc(r.rua||'Rua não informada')}</b><small>Fotos: antes / depois</small></div><div class="row-actions"><button class="button ghost edit-row" data-i="${i}">Editar</button><button class="button minimal delete-row" data-i="${i}">Excluir</button></div></div>`).join('');
  el.querySelectorAll('.delete-row').forEach(b=>b.onclick=()=>{const i=+b.dataset.i;const oldCount=state.records.length;state.records.splice(i,1);if(+$('book-qtd').value===oldCount)$('book-qtd').value=state.records.length||'';updateRecords();scheduleDraft()});
  el.querySelectorAll('.edit-row').forEach(b=>b.onclick=()=>{const r=state.records[+b.dataset.i];state.editing=+b.dataset.i;
    ['coord','td','rd','bairro','rua'].forEach(k=>$('rec-'+k).value=r[k]||'');
    state.photo={antes:r.antes,depois:r.depois};renderPhotos();setActivePhoto('antes');
    $('add-record').textContent='Salvar alterações da poda';window.scrollTo({top:240,behavior:'smooth'});
  });
}
async function generate(){
  if(!state.records.length)return toast('Adicione pelo menos uma poda para gerar o PDF.',true);
  const data=getForm();let btn=$('generate-pdf');btn.disabled=true;btn.textContent='Gerando PDF...';
  try{
    clearTimeout(draftTimer);
    const result=await api('/api/books/generate',{method:'POST',body:JSON.stringify(data)});
    // O backend grava o histórico antes de apagar o rascunho.
    applyDraft({date:today(),records:[]});clearRecordFields();
    toast(`PDF gerado e salvo!\n${result.folder}\n${result.filename}\nO novo Book está vazio e os anteriores continuam no histórico.`);
    const win=window.open(result.pdf_url,'_blank');if(!win)console.info('PDF salvo:',result.pdf_url);
  }catch(e){toast(e.message,true);scheduleDraft()}
  finally{btn.disabled=false;btn.textContent='Gerar PDF e salvar Book'}
}
async function lookup(){
  const q=$('rec-coord').value.trim();if(!q)return toast('Digite uma coordenada.',true);
  const b=$('lookup-btn');b.disabled=true;b.textContent='Consultando...';
  try{const data=await api('/api/lookup?coord='+encodeURIComponent(q));
    $('rec-coord').value=data.coord;
    for(const key of ['td','rd','bairro','rua'])if(data[key])$('rec-'+key).value=data[key];
    toast('Coordenada localizada. Confira os dados antes de adicionar.');
  }catch(e){toast(e.message,true)}finally{b.disabled=false;b.textContent='Localizar TD / Rua'}
}
async function loadHistory(){
  const q=$('history-filter').value.trim();let body=$('history-body');
  try{const result=await api('/api/books?q='+encodeURIComponent(q));
    body.innerHTML=result.rows.length?result.rows.map(r=>`<tr><td><b>${esc(r.os)}</b></td><td>${esc(r.data)}</td><td>${r.qtd}</td><td class="file-cell">${esc(r.filename)}</td><td>${esc(r.created)}</td><td><div class="actions-cell"><a href="/api/books/${r.id}/pdf" target="_blank" class="button soft">Abrir PDF</a><button class="button ghost folder" data-id="${r.id}">Abrir pasta</button></div></td></tr>`).join(''):'<tr><td colspan="6" class="empty">Nenhum registro encontrado.</td></tr>';
    body.querySelectorAll('.folder').forEach(b=>b.onclick=async()=>{try{const data=await api(`/api/books/${b.dataset.id}/open_folder`,{method:'POST',body:'{}'});if(data.message)toast(data.message+'\n'+data.folder)}catch(e){toast(e.message,true)}});
  }catch(e){toast(e.message,true)}
}
async function loadOS(force){
  $('os-state').textContent='Consultando Google Sheets...';
  try{
    const resp=await api('/api/os'+(force?'?refresh=1':''));osRows=resp.rows||[];
    const stateText=resp.cached?'Dados recuperados do cache local (consulta online indisponível).':'Planilha sincronizada.';
    $('os-state').textContent=`${stateText} ${osRows.length} OS encontradas. ${resp.warning||''}`;
    $('os-body').innerHTML=osRows.length?osRows.map((r,i)=>`<tr><td><b>${esc(r.os)}</b></td><td>${r['21307']}</td><td>${r['21308']}</td><td><b>${r.total}</b></td><td><button class="button soft select-os" data-index="${i}">Usar no Book</button></td></tr>`).join(''):'<tr><td colspan="5" class="empty">Nenhuma OS com códigos 21307 e 21308.</td></tr>';
    document.querySelectorAll('.select-os').forEach(b=>b.onclick=()=>{
      const r=osRows[+b.dataset.index];
      if(state.records.length&&!confirm('Substituir a OS e a quantidade atual sem excluir as podas já adicionadas?'))return;
      $('book-os').value=String(r.os).split('/')[0].trim();$('book-qtd').value=r.total;tab('book');scheduleDraft();toast(`OS ${r.os} selecionada. Quantidade: ${r.total}.`);
    });
  }catch(e){$('os-state').textContent=e.message;toast(e.message,true)}
}
async function showSettings(){
  try{state.settings=await api('/api/settings');$('setting-dir').value=state.settings.output_dir;$('setting-prestador').value=state.settings.prestador;$('setting-prefix').value=state.settings.os_prefix;
    $('sidebar-path').textContent=state.settings.output_dir;
    $('setting-github').value=state.settings.github_repo||'';loadUpdateStatus();
  }catch(e){toast(e.message,true)}
}
async function saveSettings(){
  try{const result=await api('/api/settings',{method:'POST',body:JSON.stringify({output_dir:$('setting-dir').value,prestador:$('setting-prestador').value,os_prefix:$('setting-prefix').value})});
    state.settings=result;$('sidebar-path').textContent=result.output_dir;
    toast('Configurações salvas. Novos PDFs serão enviados para a pasta configurada.');
  }catch(e){toast(e.message,true)}
}
// ---------- Atualizações pelo GitHub Releases ----------
let latestUpdate=null;
const updateHeader={'X-BookPoda-Update':'1'};
async function updatePost(path,body={}){
  return api(path,{method:'POST',headers:updateHeader,body:JSON.stringify(body)});
}
function showUpdateMessage(message,isError=false){
  const el=$('update-message');el.textContent=message;el.classList.toggle('update-error',isError);
}
async function loadUpdateStatus(){
  try{
    const st=await api('/api/update/status');
    $('update-current').textContent='Versão '+st.version;
    if(!document.activeElement||document.activeElement!==$('setting-github'))$('setting-github').value=st.repo||'';
    if(st.last?.state==='failed')showUpdateMessage(st.last.message||'Falha na última atualização.',true);
    else if(st.last?.state==='success')showUpdateMessage(st.last.message||'Atualização anterior instalada.');
    else if(['prepared','waiting','installing'].includes(st.last?.state))showUpdateMessage(st.last.message||'Atualização em andamento...');
  }catch(e){showUpdateMessage(e.message,true)}
}
async function saveGithubRepo(){
  const repo=$('setting-github').value.trim();
  const r=await updatePost('/api/update/repository',{repo});
  $('setting-github').value=r.repo;latestUpdate=null;
  $('update-install').disabled=true;
  $('update-release').classList.add('hidden');
  showUpdateMessage('Repositório salvo: '+r.repo);
  return r.repo;
}
async function checkGithubUpdate(){
  const btn=$('update-check');btn.disabled=true;btn.textContent='Verificando...';
  try{
    await saveGithubRepo();
    const r=await updatePost('/api/update/check');latestUpdate=r;
    $('update-current').textContent='Versão '+r.current;
    $('update-release').classList.remove('hidden');
    $('update-release-details').textContent=`Publicada: ${r.latest} • Instalada: ${r.current}${r.published_at?' • '+r.published_at.slice(0,10):''}`;
    $('update-release-link').href=r.release_url;
    $('update-install').disabled=!r.available||!r.asset_found;
    if(!r.available)showUpdateMessage('O Book Poda está atualizado.');
    else if(!r.asset_found)showUpdateMessage(`Versão ${r.latest} encontrada, mas o pacote book-poda-update.zip não foi publicado.`,true);
    else showUpdateMessage(`Nova versão ${r.latest} disponível! Clique em Instalar atualização.`);
  }catch(e){showUpdateMessage(e.message,true)}
  finally{btn.disabled=false;btn.textContent='↻ Verificar atualizações'}
}
async function installGithubUpdate(){
  if(!latestUpdate?.available)return;
  if(!confirm(`Instalar Book Poda ${latestUpdate.latest}? O servidor localhost será reiniciado. Salve seu Book em edição antes de continuar.`))return;
  const b=$('update-install');b.disabled=true;b.textContent='Baixando...';
  showUpdateMessage('Baixando e conferindo o arquivo do GitHub. Aguarde...');
  try{
    const old=latestUpdate.current;
    await updatePost('/api/update/install');
    showUpdateMessage('Arquivo validado. Servidor reiniciando para instalar a atualização...');
    let count=0;
    const poll=setInterval(async()=>{
      if(++count>100){clearInterval(poll);showUpdateMessage('Tempo excedido. Execute INICIAR_LOCALHOST.bat para consultar o estado da atualização.',true);return}
      try{
        const st=await api('/api/update/status');
        if(st.last?.state==='failed'){
          clearInterval(poll);showUpdateMessage(st.last.message||'Falha na atualização.',true);
          b.textContent='Instalar atualização';b.disabled=false;
        }else if(st.version!==old&&st.last?.state==='success'){
          clearInterval(poll);showUpdateMessage('Atualizado para '+st.version+'! Recarregando...');
          setTimeout(()=>location.reload(),800);
        }else if(st.last?.message)showUpdateMessage(st.last.message);
      }catch(e){/* servidor reiniciando; continue aguardando */}
    },2000);
  }catch(e){showUpdateMessage(e.message,true);b.disabled=false;b.textContent='Instalar atualização'}
}
function callMap(name,...args){
  try{const w=$('qfield-map').contentWindow;if(!w||typeof w[name]!=='function')return false;w[name](...args);return true}catch(e){console.warn('Mapa não disponível:',e);return false}
}
function mapLayers(){callMap('setLayerVisibility',$('layer-td').checked,$('layer-rd').checked,$('layer-post').checked)}
function selectEquipment(item){
  state.mapSelected={lat:item.lat,lon:item.lon};$('map-use').disabled=false;
  callMap('flyToEquipment',item.lat,item.lon,item.kind,item.code,17);
  $('map-result').innerHTML=`<b>${item.kind==='TD'?'Transformador':'Religador'} ${esc(item.code)}</b><br>Circuito: ${esc(item.circuit||'não informado')}<br>Latitude: ${item.lat.toFixed(7)}<br>Longitude: ${item.lon.toFixed(7)}`;
}
async function findMap(){
  const q=$('map-search').value.trim();if(!q)return toast('Digite uma coordenada ou número de equipamento.',true);
  const btn=$('map-find');btn.disabled=true;btn.textContent='Pesquisando...';
  try{
    const r=await api('/api/search?q='+encodeURIComponent(q));
    if(r.type==='coord'){
      state.mapSelected={lat:r.lat,lon:r.lon};$('map-use').disabled=false;
      callMap('showSearchMarker',r.lat,r.lon,17);
      const td=r.nearest.td,rd=r.nearest.rd;
      $('map-result').innerHTML=`<b>Coordenada localizada</b><br>${r.lat.toFixed(8)}, ${r.lon.toFixed(8)}<br>${td?'TD próximo: '+esc(td.code)+' ('+td.distance_m+' m)':'TD não identificado na proximidade'}<br>${rd?'Religador próximo: '+esc(rd.code)+' ('+rd.distance_m+' m)':'Religador não identificado na proximidade'}<br><small>Pressione Del para remover o marcador azul.</small>`;
    }else if(r.results.length===1){selectEquipment(r.results[0])}
    else{
      $('modal-choices').innerHTML=r.results.map((row,i)=>`<button class="choice" data-i="${i}"><strong>${esc(row.code)}</strong> <span>• ${esc(row.circuit||'Sem circuito')}</span><small>${row.lat.toFixed(6)}, ${row.lon.toFixed(6)}</small></button>`).join('');
      $('result-modal').classList.remove('hidden');
      $('modal-choices').querySelectorAll('.choice').forEach(b=>b.onclick=()=>{selectEquipment(r.results[+b.dataset.i]);$('result-modal').classList.add('hidden')});
    }
  }catch(e){toast(e.message,true);$('map-result').textContent=e.message}
  finally{btn.disabled=false;btn.textContent='⌕ Pesquisar'}
}
function clearMap(){callMap('clearSearchMarker');state.mapSelected=null;$('map-use').disabled=true;$('map-result').textContent='Marcação removida. Pesquise novamente quando precisar.';}
async function useMap(){if(!state.mapSelected)return;
  const {lat,lon}=state.mapSelected;
  $('rec-coord').value=`${lat.toFixed(8)}, ${lon.toFixed(8)}`;tab('book');await lookup();
}
function wire(){
  document.querySelectorAll('.nav-btn').forEach(b=>b.onclick=()=>tab(b.dataset.tab));
  $('book-date').addEventListener('input',e=>{e.target.value=dateFormatting(e.target.value);updateDestination();scheduleDraft()});
  ['book-os','book-qtd'].forEach(id=>$(id).addEventListener('input',scheduleDraft));
  $('new-book').onclick=()=>clearBook();$('add-record').onclick=addRecord;$('generate-pdf').onclick=generate;$('lookup-btn').onclick=lookup;
  for(const side of ['antes','depois']){
    const box=$('photo-'+side);box.addEventListener('click',e=>{if(!e.target.closest('button'))setActivePhoto(side)});
    box.addEventListener('dblclick',e=>{if(!e.target.closest('button')){$('photo-input').dataset.side=side;$('photo-input').click()}});
    box.addEventListener('dragenter',e=>{e.preventDefault();box.classList.add('dragover')});
    box.addEventListener('dragover',e=>{e.preventDefault()});
    box.addEventListener('dragleave',()=>box.classList.remove('dragover'));
    box.addEventListener('drop',async e=>{e.preventDefault();box.classList.remove('dragover');setActivePhoto(side);
      try{const file=[...e.dataTransfer.files].find(f=>f.type.startsWith('image/'));if(file)await upload(file,side)}catch(err){toast(err.message,true)}
    });
  }
  document.querySelectorAll('.choose-photo').forEach(b=>b.onclick=e=>{e.stopPropagation();const side=b.dataset.side;setActivePhoto(side);$('photo-input').dataset.side=side;$('photo-input').click()});
  document.querySelectorAll('.clear-photo').forEach(b=>b.onclick=e=>{e.stopPropagation();state.photo[b.dataset.side]='';renderPhotos()});
  $('photo-input').onchange=async e=>{try{if(e.target.files[0])await upload(e.target.files[0],e.target.dataset.side||state.activeSide)}catch(err){toast(err.message,true)}e.target.value=''};
  document.addEventListener('paste',async e=>{
    if(!document.getElementById('page-book').classList.contains('active'))return;
    const item=[...(e.clipboardData?.items||[])].find(v=>v.type.startsWith('image/'));
    if(!item)return;e.preventDefault();try{await upload(item.getAsFile(),state.activeSide)}catch(err){toast(err.message,true)}
  });
  $('map-find').onclick=findMap;$('map-search').onkeydown=e=>{if(e.key==='Enter')findMap()};$('map-use').onclick=useMap;$('map-clear').onclick=clearMap;
  $('map-base').onchange=e=>callMap('setBaseMap',e.target.value);
  ['layer-td','layer-rd','layer-post'].forEach(id=>$(id).onchange=mapLayers);
  $('qfield-map').addEventListener('load',()=>{mapReady=true;mapLayers();callMap('setBaseMap',$('map-base').value)});
  document.addEventListener('keydown',e=>{
    if(e.key==='Delete'&&$('page-map').classList.contains('active')&&!['INPUT','TEXTAREA'].includes(document.activeElement.tagName))clearMap();
  });
  window.addEventListener('message',e=>{if(e.origin===location.origin&&e.source===$('qfield-map').contentWindow&&e.data?.type==='bookpoda-marker-cleared'){state.mapSelected=null;$('map-use').disabled=true;$('map-result').textContent='Marcação removida. Pesquise novamente quando precisar.'}});
  $('history-refresh').onclick=loadHistory;$('history-filter').addEventListener('input',()=>{clearTimeout(draftTimer);draftTimer=setTimeout(loadHistory,300)});
  $('os-refresh').onclick=()=>loadOS(true);$('settings-save').onclick=saveSettings;
  $('update-save-repo').onclick=async()=>{try{await saveGithubRepo()}catch(e){showUpdateMessage(e.message,true)}};
  $('update-check').onclick=checkGithubUpdate; $('update-install').onclick=installGithubUpdate;
  $('modal-close').onclick=()=>$('result-modal').classList.add('hidden');
  $('result-modal').onclick=e=>{if(e.target.id==='result-modal')$('result-modal').classList.add('hidden')};
}
async function start(){
  wire();$('clock').textContent=new Date().toLocaleDateString('pt-BR',{day:'2-digit',month:'short',year:'numeric'});
  setActivePhoto('antes');
  try{
    const h=await api('/api/health');$('backend-status').textContent=`online · ${h.equipment.toLocaleString('pt-BR')} equipamentos`;
    const draft=await api('/api/draft');applyDraft(draft||{});await showSettings();
  }catch(e){$('backend-status').textContent='erro';toast('Servidor local: '+e.message,true)}
  const tabid=location.hash.slice(1);if(pageTitles[tabid])tab(tabid);
}
start();
