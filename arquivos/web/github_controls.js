/* Book Poda 12.4.1: módulo de atualização isolado.
   Não depende do restante de app.js e captura falhas reais da API. */
(()=>{
'use strict';
const byId=id=>document.getElementById(id);
const apiBase='/api/update';
const defaults={repo:'Bl4ckF/automa-o_poda'};
let busy=false, latest=null, lastRepo='',statusCounter=0;
const githubUrl=/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/i;
const validRepo=/^[A-Za-z0-9][\w.-]{0,99}\/[A-Za-z0-9][\w.-]{0,99}$/;

function repository(){
 const input=byId('setting-github');
 let raw=String(input?.value||'').trim().replace(/\/$/,'');
 if(/^https?:\/\//i.test(raw)){
  try{const u=new URL(raw);
   if(u.protocol!=='https:'||u.hostname.toLowerCase()!=='github.com'||u.search||u.hash||u.username||u.password)throw Error();
   raw=u.pathname.replace(/^\/+|\/+$/g,'');
  }catch{throw new Error('Endereço inválido. Use https://github.com/USUARIO/REPOSITORIO ou USUARIO/REPOSITORIO.')}
 }
 raw=raw.replace(/\.git$/i,'');
 if(!validRepo.test(raw))throw new Error('Informe o repositório no formato USUARIO/REPOSITORIO.');
 return raw;
}
function message(text,type='normal'){
 const e=byId('update-message');if(!e)return;
 e.textContent=text||'';
 e.classList.toggle('update-error',type==='error');
 e.dataset.status=type;
}
function indicator(status,text,url){
 const e=byId('update-indicator');if(e){e.className='update-indicator '+(status||'');e.textContent=text;}
 const l=byId('update-repo-link');if(l){
  if(url&&githubUrl.test(url)){l.href=url;l.classList.remove('hidden');}
  else{l.removeAttribute('href');l.classList.add('hidden');}
 }
}
function setBusy(name,isBusy){
 busy=isBusy;
 for(const id of ['update-save-repo','update-test','update-check']){
  const b=byId(id);if(!b)continue;
  b.disabled=isBusy;
  b.textContent=isBusy&&id===name?({ 'update-save-repo':'Salvando...', 'update-test':'Testando...', 'update-check':'Verificando...' }[id]):{
   'update-save-repo':'Salvar repositório','update-test':'Testar repositório','update-check':'↻ Verificar atualizações'
  }[id];
 }
 if(isBusy&&byId('update-install'))byId('update-install').disabled=true;
}
function hideRelease(){latest=null;const btn=byId('update-install');if(btn)btn.disabled=true;
 const el=byId('update-release');if(el)el.classList.add('hidden');}
async function request(path,body,timeout=25000){
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeout);
 try{
  const init={method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:{'Accept':'application/json'}};
  if(body!==undefined){init.headers['Content-Type']='application/json';init.headers['X-BookPoda-Update']='1';init.body=JSON.stringify(body)}
  const response=await fetch(path,init);
  const raw=await response.text();let data;
  try{data=JSON.parse(raw)}catch{throw new Error('O servidor respondeu com conteúdo inválido (HTTP '+response.status+'). Abra o Book Poda pelo localhost.')}
  if(!response.ok){
   if(response.status===404)throw new Error('Esta versão do servidor não possui a rota de atualização. Reinicie o Book Poda usando INICIAR_LOCALHOST.bat.');
   throw new Error(data.error||data.message||'Erro HTTP '+response.status);
  }
  return data;
 }catch(e){
  if(e.name==='AbortError')throw new Error('Tempo limite excedido. O GitHub pode estar lento ou sem conexão.');
  if(e instanceof TypeError)throw new Error('Não foi possível conectar ao servidor localhost. Confirme que INICIAR_LOCALHOST.bat continua aberto.');
  throw e;
 }finally{clearTimeout(timer)}
}
async function act(name,callback){
 if(busy)return;
 setBusy(name,true);
 try{await callback()}catch(e){indicator('error','✕ Falha na operação');message(e.message||String(e),'error')}
 finally{setBusy(name,false)}
}
async function saveRepo(){
 await act('update-save-repo',async()=>{
  const repo=repository();
  indicator('pending','◌ Salvando repositório...');message('Gravando endereço no computador...');
  const result=await request(apiBase+'/repository',{repo},13000);
  const status=await request(apiBase+'/status',undefined,13000);
  if(!result.ok||!status.repository_saved||status.repo!==result.repo)throw Error('O servidor não confirmou o salvamento em Dados/github_repo.json.');
  byId('setting-github').value=status.repo;lastRepo=status.repo;hideRelease();
  indicator('ok','✓ REPOSITÓRIO SALVO');
  message('Repositório salvo permanentemente: '+status.repo+'. Clique em Testar repositório.');
 });
}
async function testRepo(){
 await act('update-test',async()=>{
  const repo=repository();indicator('pending','◌ Consultando GitHub...');
  message('Testando acesso a '+repo+' (repositório público)...');
  const result=await request(apiBase+'/test',{repo},45000);
  if(result.ok){indicator('ok','✓ REPOSITÓRIO OK',result.url);
   message('✓ REPOSITÓRIO OK — '+(result.message||'Repositório público acessível.')+' '+(result.archived?'Atenção: repositório arquivado.':''));}
  else{
   const uncertain=['connection_error','rate_limited','github_error'].includes(result.status);
   indicator(uncertain?'warn':'error',uncertain?'! Conexão não confirmada':'✕ REPOSITÓRIO NÃO DISPONÍVEL');
   message(result.message||'Falha ao consultar o repositório.',uncertain?'normal':'error');
  }
 });
}
async function checkRepo(){
 await act('update-check',async()=>{
  const repo=repository();hideRelease();indicator('pending','◌ Verificando versões...');
  message('Verificando repositório e GitHub Releases. Aguarde até 45 segundos...');
  const result=await request(apiBase+'/check',{repo},60000);
  if(result.current&&byId('update-current'))byId('update-current').textContent='Versão '+result.current;
  if(!result.repository?.ok){
   const p=result.repository||result;
   indicator(['connection_error','rate_limited'].includes(p.status)?'warn':'error','✕ GitHub não confirmado');
   message(p.message||result.message||'Não foi possível verificar.', 'error');return;
  }
  indicator('ok','✓ REPOSITÓRIO OK',result.repository.url);
  if(result.release_url&&githubUrl.test('https://github.com/'+repo)){
   byId('update-release').classList.remove('hidden');
   byId('update-release-details').textContent='Versão publicada: '+(result.latest||'?')+' · Instalada: '+(result.current||'?');
   byId('update-release-link').href=result.release_url;
  }
  latest=result;
  byId('update-install').disabled=!(result.status==='update_available'&&result.asset_valid);
  const messages={
   'no_release':'✓ Repositório OK, mas ainda não há nenhuma GitHub Release publicada.',
   'up_to_date':'✓ Repositório OK. O Book Poda já está atualizado.',
   'missing_asset':'✓ Repositório OK. A Release não tem o arquivo book-poda-update.zip.',
   'missing_checksum':'✓ Repositório OK. Falta o checksum SHA-256 exigido para instalar a atualização.',
   'invalid_version':'✓ Repositório OK. A tag da Release possui uma versão inválida.',
   'update_available':'✓ Nova versão '+result.latest+' disponível. Clique em Instalar atualização.'
  };
  message(messages[result.status]||result.message||'Consulta concluída.', ['missing_asset','missing_checksum','invalid_version','release_error'].includes(result.status)?'error':'normal');
 });
}
async function install(){
 if(!latest?.available||!latest?.asset_valid||busy)return;
 if(!confirm('Instalar Book Poda '+latest.latest+'? Salve o Book em edição. O servidor será reiniciado.'))return;
 await act('update-install',async()=>{
  indicator('pending','◌ Instalando atualização...');
  message('Baixando e conferindo SHA-256. O servidor pode demorar para responder...');
  const result=await request(apiBase+'/install',{},180000);
  if(!result.ok)throw Error(result.message||'Não foi possível preparar a atualização.');
  message('Atualização preparada. O servidor está reiniciando. Aguarde e recarregue a página em instantes.');
 });
}
async function loadStatus(){
 const seq=++statusCounter;
 try{
  const st=await request(apiBase+'/status',undefined,13000);
  if(seq!==statusCounter)return;
  if(st.version&&byId('update-current'))byId('update-current').textContent='Versão '+st.version;
  const input=byId('setting-github');
  if(input&&document.activeElement!==input&&!input.value.trim())input.value=st.repo||defaults.repo;
  lastRepo=st.repo||'';
  if(st.repository_saved){indicator('','● Configurado (aguardando teste)');message('Repositório salvo: '+st.repo+'. Clique em Testar repositório.');}
  else if(!byId('update-message')?.dataset.status||byId('update-message').dataset.status==='normal'){
   indicator('','● Endereço sugerido');message('Endereço sugerido: '+(st.repo||defaults.repo)+'. Salve o repositório e clique em Testar.');
  }
 }catch(e){indicator('error','✕ Servidor indisponível');message(e.message,'error')}
}
function boot(){
 const required=['setting-github','update-message','update-save-repo','update-test','update-check','update-install'];
 if(required.some(id=>!byId(id)))return;
 const clicks=[['update-save-repo',saveRepo],['update-test',testRepo],['update-check',checkRepo],['update-install',install]];
 for(const [id,fn] of clicks){const b=byId(id);b.onclick=null;b.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();fn()},{capture:true});}
 byId('setting-github').addEventListener('input',()=>{statusCounter++;hideRelease();indicator('','● Endereço alterado (não verificado)')});
 document.querySelectorAll('[data-tab="settings"]').forEach(e=>e.addEventListener('click',()=>setTimeout(loadStatus,350)));
 // O módulo funciona mesmo se app.js falhar antes de conectar os botões.
 loadStatus();
 window.BookPodaGithubControls={reload:loadStatus};
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
