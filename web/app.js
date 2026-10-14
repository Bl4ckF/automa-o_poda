'use strict';
const $=id=>document.getElementById(id);
const state={os:'',date:'',qtd:'',bookType:'poda',unit:'m2',records:[],settings:{},photo:{antes:'',depois:''},activeSide:'antes',mapSelected:null,editing:-1,loading:false};
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
const serviceNames={poda:'Poda',limpeza_faixa:'Limpeza de Faixa'};
const serviceTeams={poda:'ENG PDCG02',limpeza_faixa:'ENG LFCG02'};
const unitSymbols={m2:'m²',km:'km'};
function getForm(){return {book_type:state.bookType,unit:state.bookType==='limpeza_faixa'?state.unit:'un',os:$('book-os').value.trim(),date:$('book-date').value.trim(),qtd:$('book-qtd').value,records:state.records};}
function decimalNumber(text){
 let t=String(text||'').trim().replace(/\s/g,'');
 if(t.includes(',')&&t.includes('.'))t=t.lastIndexOf(',')>t.lastIndexOf('.')?t.replace(/\./g,'').replace(',','.'):t.replace(/,/g,'');
 else t=t.replace(',','.');
 return /^\d+(\.\d{1,4})?$/.test(t)?Number(t):NaN;
}
function measureText(v){const n=decimalNumber(v);return Number.isFinite(n)?n.toLocaleString('pt-BR',{maximumFractionDigits:4}):String(v||'')}
function updateBookTypeUI(){
 const faixa=state.bookType==='limpeza_faixa';
 $('book-type').value=state.bookType;
 $('book-os-prefix').textContent=state.bookType==='limpeza_faixa'?((state.settings&&state.settings.os_prefix_faixa)||'OS'):((state.settings&&state.settings.os_prefix)||'ENG-PDBT02.CMAD');
 $('book-unit').classList.toggle('hidden',!faixa);$('book-unit').value=state.unit;
 $('book-team').textContent=serviceTeams[state.bookType];
 $('service-header').textContent='ENGELMIG ENERGIA / '+(faixa?'LIMPEZA DE FAIXA':'PODA');
 $('book-intro').textContent=faixa?'Registre a OS, a medição em m² ou km e as fotos antes e depois de cada trecho.':'Preencha a OS, a data e inclua as evidências de cada poda.';
 $('type-hint').textContent=faixa?'Medição total em m² ou km. Equipe ENG LFCG02.':'Quantidade contabilizada por poda.';
 $('book-qtd-label').textContent=faixa?'Medição total':'Quantidade de podas';
 $('book-qtd').type=faixa?'text':'number';$('book-qtd').inputMode=faixa?'decimal':'numeric';
 $('book-qtd').placeholder=faixa?'Ex.: 1.250,5':'Auto';
 $('book-qtd-hint').textContent=faixa?'Informe o total ou preencha a medição de cada trecho.':'Quantidade total de podas.';
 $('rec-measure-wrap').classList.toggle('hidden',!faixa);
 $('rec-measure-label').textContent='Medição deste trecho ('+unitSymbols[state.unit]+')';
 $('rec-measure').placeholder=state.unit==='km'?'Ex.: 1,25':'Ex.: 250,5';
 $('add-record').textContent=(state.editing>=0?'Salvar alterações':'＋ Adicionar '+(faixa?'trecho':'poda')+' ao Book');
 $('records-heading').textContent=faixa?'Trechos deste Book':'Podas deste Book';
 $('records-caption').textContent=faixa?'Cada trecho com fotos antes/depois pode ter sua própria medição; o total será somado quando todos estiverem preenchidos.':'As podas deste Book não interferem no histórico de PDFs gerados.';
 $('page-title').textContent=faixa?'Novo Book de Limpeza de Faixa':'Novo Book fotográfico';
 updateRecords();updateDestination();
}
function changeBookType(next){
 if(next===state.bookType)return;
 if((state.records.length||$('book-os').value.trim())&&!confirm('Trocar o tipo de serviço descarta o Book em edição. Os Books já gerados permanecem no histórico. Continuar?')){
   $('book-type').value=state.bookType;return;
 }
 state.bookType=next;state.records=[];$('book-os').value='';$('book-qtd').value='';
 clearRecordFields();updateBookTypeUI();scheduleDraft();
}
function syncFaixaTotal(){
 if(state.bookType!=='limpeza_faixa')return;
 if(state.records.length&&state.records.every(r=>String(r.measure||'').trim()&&Number.isFinite(decimalNumber(r.measure)))){
   let total=state.records.reduce((sum,r)=>sum+decimalNumber(r.measure),0);
   $('book-qtd').value=Number(total.toFixed(4)).toString().replace('.',',');
 }
}
function scheduleDraft(){clearTimeout(draftTimer);draftTimer=setTimeout(()=>api('/api/draft',{method:'POST',body:JSON.stringify(getForm())}).catch(e=>console.warn('Rascunho',e)),550)}
function applyDraft(d){
  state.bookType=d.book_type==='limpeza_faixa'?'limpeza_faixa':'poda';state.unit=d.unit==='km'?'km':'m2';
  $('book-os').value=d.os||'';$('book-date').value=d.date||today();$('book-qtd').value=d.qtd||'';
  state.records=Array.isArray(d.records)?d.records:[];
  updateBookTypeUI();
}
function clearRecordFields(){
  for(const field of ['coord','td','rd','bairro','rua','measure'])$('rec-'+field).value='';
  state.photo={antes:'',depois:''};state.editing=-1;renderPhotos();setActivePhoto('antes');
  updateBookTypeUI();
}
function clearBook(force=false){
  if(!force&&(state.records.length||$('book-os').value.trim())&&!confirm('Iniciar um novo Book? Os dados ainda não gerados serão descartados. Os PDFs já salvos permanecerão no histórico.'))return;
  clearTimeout(draftTimer);
  applyDraft({book_type:state.bookType,unit:state.unit,date:today(),records:[]});clearRecordFields();
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
function collectRecord(){return {coord:$('rec-coord').value.trim(),td:$('rec-td').value.trim(),rd:$('rec-rd').value.trim(),bairro:$('rec-bairro').value.trim(),rua:$('rec-rua').value.trim(),measure:state.bookType==='limpeza_faixa'?$('rec-measure').value.trim():'',antes:state.photo.antes,depois:state.photo.depois}}
async function addRecord(){
  const d=collectRecord();if(!d.coord)return toast('Informe as coordenadas do serviço.',true);
  if(state.bookType==='limpeza_faixa'&&d.measure&&(!Number.isFinite(decimalNumber(d.measure))||decimalNumber(d.measure)<=0))return toast('Medição do trecho inválida. Use, por exemplo, 125,5.',true);
  if(!d.antes||!d.depois)return toast('Adicione as fotos ANTES e DEPOIS.',true);
  try{const result=await api('/api/search?q='+encodeURIComponent(d.coord));if(result.type!=='coord')throw Error('Digite uma coordenada válida.')}
  catch(e){return toast(e.message,true)}
  if(state.editing>=0){state.records[state.editing]=d}
  else state.records.push(d);
  clearRecordFields();
  if(state.bookType==='poda'&&(!$('book-qtd').value||+$('book-qtd').value===state.records.length-1))$('book-qtd').value=state.records.length;
  syncFaixaTotal();updateRecords();scheduleDraft();toast((state.bookType==='limpeza_faixa'?'Trecho':'Poda')+' adicionado ao Book.');
}
function updateRecords(){
  $('records-count').textContent=state.records.length;
  const el=$('record-list'),faixa=state.bookType==='limpeza_faixa';
  if(!state.records.length){el.innerHTML='<div class="empty">Ainda não há '+(faixa?'trechos':'podas')+' neste Book.</div>';return}
  el.innerHTML=state.records.map((r,i)=>`<div class="record-row"><div class="row-number">${i+1}</div><div><b>${esc(r.td||'Sem TD')}</b><small>${esc(r.coord)}</small></div><div><b>${esc(r.rd||'Sem religador')}</b><small>${esc(r.bairro||'Bairro não informado')}</small></div><div><b>${esc(r.rua||'Rua não informada')}</b><small>${faixa&&r.measure?'Trecho: '+esc(measureText(r.measure))+' '+unitSymbols[state.unit]:'Fotos: antes / depois'}</small></div><div class="row-actions"><button class="button ghost edit-row" data-i="${i}">Editar</button><button class="button minimal delete-row" data-i="${i}">Excluir</button></div></div>`).join('');
  el.querySelectorAll('.delete-row').forEach(b=>b.onclick=()=>{
    const i=+b.dataset.i,oldCount=state.records.length;state.records.splice(i,1);
    if(!faixa&&+$('book-qtd').value===oldCount)$('book-qtd').value=state.records.length||'';
    if(faixa){if(state.records.length)syncFaixaTotal();else $('book-qtd').value=''}
    updateRecords();scheduleDraft();
  });
  el.querySelectorAll('.edit-row').forEach(b=>b.onclick=()=>{
    const r=state.records[+b.dataset.i];state.editing=+b.dataset.i;
    ['coord','td','rd','bairro','rua','measure'].forEach(k=>$('rec-'+k).value=r[k]||'');
    state.photo={antes:r.antes,depois:r.depois};renderPhotos();setActivePhoto('antes');
    $('add-record').textContent='Salvar alterações do '+(faixa?'trecho':'poda');window.scrollTo({top:240,behavior:'smooth'});
  });
}
async function generate(){
  if(!state.records.length)return toast('Adicione pelo menos uma evidência para gerar o PDF.',true);
  if(state.bookType==='limpeza_faixa'&&(!Number.isFinite(decimalNumber($('book-qtd').value))||decimalNumber($('book-qtd').value)<=0))return toast('Informe a medição total em m² ou km.',true);
  const data=getForm();let btn=$('generate-pdf');btn.disabled=true;btn.textContent='Gerando PDF...';
  try{
    clearTimeout(draftTimer);
    const result=await api('/api/books/generate',{method:'POST',body:JSON.stringify(data)});
    // O backend grava o histórico antes de apagar o rascunho.
    applyDraft({book_type:state.bookType,unit:state.unit,date:today(),records:[]});clearRecordFields();
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
    body.innerHTML=result.rows.length?result.rows.map(r=>`<tr><td><b>${r.tipo==='limpeza_faixa'?'Limpeza de Faixa':'Poda'}</b><small class="history-team">${r.tipo==='limpeza_faixa'?'ENG LFCG02':'ENG PDCG02'}</small></td><td><b>${esc(r.os)}</b></td><td>${esc(r.data)}</td><td>${r.tipo==='limpeza_faixa'?esc(Number(r.qtd).toLocaleString('pt-BR',{maximumFractionDigits:4}))+' '+(r.unidade==='km'?'km':'m²'):esc(Number(r.qtd))+' podas'}</td><td class="file-cell">${esc(r.filename)}</td><td>${esc(r.created)}</td><td><div class="actions-cell"><a href="/api/books/${r.id}/pdf" target="_blank" class="button soft">Abrir PDF</a><button class="button ghost folder" data-id="${r.id}">Abrir pasta</button></div></td></tr>`).join(''):'<tr><td colspan="7" class="empty">Nenhum registro encontrado.</td></tr>';
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
      if(state.bookType==='limpeza_faixa'){
        if(state.records.length&&!confirm('As OS da planilha são de Poda. Trocar para Poda e descartar os trechos em edição?'))return;
        state.bookType='poda';state.records=[];clearRecordFields();updateBookTypeUI();
      }
      if(state.records.length&&!confirm('Substituir a OS e a quantidade atual sem excluir as podas já adicionadas?'))return;
      $('book-os').value=String(r.os).split('/')[0].trim();$('book-qtd').value=r.total;tab('book');scheduleDraft();toast(`OS ${r.os} selecionada. Quantidade: ${r.total}.`);
    });
  }catch(e){$('os-state').textContent=e.message;toast(e.message,true)}
}
async function showSettings(){
  try{state.settings=await api('/api/settings');$('setting-dir').value=state.settings.output_dir;$('setting-prestador').value=state.settings.prestador;$('setting-prefix').value=state.settings.os_prefix;$('setting-prefix-faixa').value=state.settings.os_prefix_faixa||'';
    $('sidebar-path').textContent=state.settings.output_dir;$('book-os-prefix').textContent=state.bookType==='limpeza_faixa'?(state.settings.os_prefix_faixa||'OS'):state.settings.os_prefix;
    $('setting-github').value=state.settings.github_repo||'';loadUpdateStatus();
  }catch(e){toast(e.message,true)}
}
async function saveSettings(){
  try{const result=await api('/api/settings',{method:'POST',body:JSON.stringify({output_dir:$('setting-dir').value,prestador:$('setting-prestador').value,os_prefix:$('setting-prefix').value,os_prefix_faixa:$('setting-prefix-faixa').value})});
    state.settings=result;$('sidebar-path').textContent=result.output_dir;$('book-os-prefix').textContent=state.bookType==='limpeza_faixa'?(result.os_prefix_faixa||'OS'):result.os_prefix;
    toast('Configurações salvas. Novos PDFs serão enviados para a pasta configurada.');
  }catch(e){toast(e.message,true)}
}
// ---------- Atualizações pelo GitHub Releases ----------
let latestUpdate=null,repositoryRevision=0,checkingGithub=false;
const updateHeader={'X-BookPoda-Update':'1'};
async function updatePost(path,body={}){
  return api(path,{method:'POST',headers:updateHeader,body:JSON.stringify(body)});
}
function showUpdateMessage(message,isError=false){
  const el=$('update-message');el.textContent=message;el.classList.toggle('update-error',isError);
}
function showRepoHealth(status,message,url=''){
  const indicator=$('update-indicator');
  indicator.className='update-indicator '+status;
  indicator.textContent=message;
  const link=$('update-repo-link');
  if(url&&/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(url)){
    link.href=url;link.classList.remove('hidden');
  }else{link.href='#';link.classList.add('hidden')}
}
function disableUpdateInstallation(){latestUpdate=null;$('update-install').disabled=true;$('update-release').classList.add('hidden')}
function setUpdateButtonBusy(button,busy,text){
  button.disabled=busy;
  button.textContent=busy?text:button.dataset.defaultLabel||button.textContent;
}
async function loadUpdateStatus(){
  const revision=repositoryRevision;
  try{
    const st=await api('/api/update/status');
    $('update-current').textContent='Versão '+st.version;
    // Não sobrescreva o texto que a pessoa está digitando.
    if(revision===repositoryRevision&&document.activeElement!==$('setting-github'))$('setting-github').value=st.repo||'';
    if(st.last?.state==='failed')showUpdateMessage(st.last.message||'Falha na última atualização.',true);
    else if(st.last?.state==='success')showUpdateMessage(st.last.message||'Atualização anterior instalada.');
    else if(['prepared','waiting','installing'].includes(st.last?.state))showUpdateMessage(st.last.message||'Atualização em andamento...');
    else if(st.repo)showUpdateMessage((st.repository_saved?'Repositório salvo: ':'Endereço sugerido (ainda não salvo): ')+st.repo+'. Clique em Testar repositório.');
    else showUpdateMessage('Informe um repositório e clique em Testar repositório.');
    showRepoHealth('','● Ainda não verificado');
  }catch(e){showRepoHealth('error','● Servidor local indisponível');showUpdateMessage('Não foi possível consultar o servidor local: '+e.message,true)}
}
async function saveGithubRepo(){
  const repo=$('setting-github').value.trim();
  repositoryRevision++;
  showUpdateMessage('Salvando repositório...');
  const r=await updatePost('/api/update/repository',{repo});
  const st=await api('/api/update/status');
  if(!r.ok||st.repo!==r.repo||!st.repository_saved)throw Error('O servidor não confirmou o salvamento. Confira se a pasta Dados permite gravação.');
  $('setting-github').value=r.repo;
  disableUpdateInstallation();
  showRepoHealth('','● Salvo, ainda não verificado');
  showUpdateMessage('Salvo no computador: '+r.repo+'. Agora clique em Testar repositório para confirmar o acesso ao GitHub.');
  return r.repo;
}
function renderRepositoryTest(r){
  if(r.ok){
    showRepoHealth('ok','✓ REPOSITÓRIO OK',r.url);
    showUpdateMessage(r.message+(r.archived?' Atenção: repositório arquivado.':''));
  }else{
    const unknown=['connection_error','rate_limited','github_error'].includes(r.status);
    showRepoHealth(unknown?'warn':'error',unknown?'! Não foi possível confirmar':'✕ Repositório não disponível');
    showUpdateMessage(r.message,!unknown);
  }
}
async function testGithubRepository(){
  const btn=$('update-test');setUpdateButtonBusy(btn,true,'Testando...');
  showRepoHealth('pending','◌ Consultando GitHub...');
  showUpdateMessage('Verificando se o repositório existe e está público. Aguarde...');
  disableUpdateInstallation();
  try{
    const typed=$('setting-github').value.trim();
    if(!typed)throw Error('Informe o endereço do repositório GitHub.');
    const r=await updatePost('/api/update/test',{repo:typed});
    renderRepositoryTest(r);
  }catch(e){showRepoHealth('error','✕ Falha no teste');showUpdateMessage('Não foi possível testar: '+e.message,true)}
  finally{setUpdateButtonBusy(btn,false)}
}
async function checkGithubUpdate(){
  if(checkingGithub)return;
  checkingGithub=true;
  const btn=$('update-check');setUpdateButtonBusy(btn,true,'Verificando...');
  $('update-test').disabled=true;
  disableUpdateInstallation();
  showRepoHealth('pending','◌ Verificando GitHub...');
  showUpdateMessage('Consultando o repositório e a última Release. Pode levar até 40 segundos...');
  try{
    // Verifica exatamente o repositório digitado; não depende de um estado salvo desatualizado.
    const typed=$('setting-github').value.trim();
    if(!typed)throw Error('Informe o repositório GitHub antes de verificar.');
    const r=await updatePost('/api/update/check',{repo:typed});
    $('update-current').textContent='Versão '+r.current;
    if(!r.repository?.ok){
      renderRepositoryTest(r.repository||{ok:false,message:r.message,status:r.status});return;
    }
    showRepoHealth('ok','✓ REPOSITÓRIO OK',r.repository.url);
    if(r.release_url){
      $('update-release').classList.remove('hidden');
      $('update-release-details').textContent=`Publicada: ${r.latest} • Instalada: ${r.current}${r.published_at?' • '+r.published_at.slice(0,10):''}`;
      $('update-release-link').href=r.release_url;
    }
    latestUpdate=r;
    $('update-install').disabled=!(r.status==='update_available'&&r.asset_valid);
    if(r.status==='no_release')showUpdateMessage('✓ Repositório encontrado e público. Ainda não existe uma Release publicada. Publique uma tag e aguarde o GitHub Actions.');
    else if(r.status==='up_to_date')showUpdateMessage('✓ Repositório OK. '+r.message);
    else if(r.status==='update_available')showUpdateMessage('✓ Repositório OK. '+r.message);
    else showUpdateMessage('✓ Repositório OK. '+r.message, ['missing_asset','missing_checksum','invalid_version'].includes(r.status));
  }catch(e){showRepoHealth('error','✕ Falha na verificação');showUpdateMessage('Não foi possível verificar: '+e.message,true)}
  finally{checkingGithub=false;setUpdateButtonBusy(btn,false);$('update-test').disabled=false}
}
async function installGithubUpdate(){
  if(!latestUpdate?.available||!latestUpdate?.asset_valid)return;
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
  $('book-type').onchange=e=>changeBookType(e.target.value);
  $('book-unit').onchange=e=>{
    const next=e.target.value;if(next===state.unit)return;
    if(($('book-qtd').value.trim()||state.records.some(r=>r.measure))&&!confirm('Trocar a unidade NÃO converte os valores. Limpar todas as medições e continuar?')){
      e.target.value=state.unit;return;
    }
    state.unit=next;$('book-qtd').value='';state.records.forEach(r=>r.measure='');$('rec-measure').value='';updateBookTypeUI();scheduleDraft();
  };
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
  for(const id of ['update-save-repo','update-test','update-check'])$(id).dataset.defaultLabel=$(id).textContent;
  $('setting-github').addEventListener('input',()=>{repositoryRevision++;disableUpdateInstallation();showRepoHealth('','● Não verificado');});
  $('update-save-repo').onclick=async()=>{const b=$('update-save-repo');setUpdateButtonBusy(b,true,'Salvando...');try{await saveGithubRepo()}catch(e){showRepoHealth('error','✕ Não foi salvo');showUpdateMessage(e.message,true)}finally{setUpdateButtonBusy(b,false)}};
  $('update-test').onclick=testGithubRepository;
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
