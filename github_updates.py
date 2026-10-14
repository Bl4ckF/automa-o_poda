"""Verificação/obtenção de atualizações oficiais por GitHub Releases.

Não depende de requests, git, Node ou login GitHub (repositórios públicos).
"""
from __future__ import annotations
import hashlib
import os
import json
import re
import tempfile
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
REPO_FILE = ROOT / 'Dados' / 'github_repo.json'
DEFAULT_REPO = 'Bl4ckF/automa-o_poda'
VERSION_FILE = ROOT / 'version.json'
ASSET_NAME = 'book-poda-update.zip'
MAX_DOWNLOAD = 180 * 1024 * 1024
MAX_FILES = 6500
MAX_UNPACKED = 450 * 1024 * 1024
REPO_RE = re.compile(r'^[A-Za-z0-9][\w.-]{0,99}/[A-Za-z0-9][\w.-]{0,99}$')
VERSION_RE = re.compile(r'^v?(\d+)\.(\d+)(?:\.(\d+))?$', re.I)

class UpdateError(ValueError):
    def __init__(self, message, status=None):
        super().__init__(message)
        self.status=status


def read_repository(legacy_repo=''):
    """Retorna repositório persistido independentemente de config.json.

    Instalações antigas podem continuar usando github_repo no config.json.
    """
    try:
        data=json.loads(REPO_FILE.read_text(encoding='utf-8'))
        repo=parse_repo(data['repo'])
        return repo
    except (OSError, ValueError, KeyError, TypeError):
        pass
    try:
        return parse_repo(legacy_repo)
    except UpdateError:
        return DEFAULT_REPO


def save_repository(repo):
    """Salva atomicamente, protegendo contra interrupções/atualizações de config.json."""
    repo=parse_repo(repo)
    REPO_FILE.parent.mkdir(parents=True,exist_ok=True)
    path=REPO_FILE.with_suffix('.json.tmp')
    try:
        path.write_text(json.dumps({'repo':repo},ensure_ascii=False,indent=2),encoding='utf-8')
        os.replace(path,REPO_FILE)
    finally:
        path.unlink(missing_ok=True)
    return read_repository()


def version_string():
    try:
        obj = json.loads(VERSION_FILE.read_text(encoding='utf-8'))
        return str(obj['version'])
    except (OSError, KeyError, ValueError):
        return '12.2.0'

def version_tuple(v: str):
    m = VERSION_RE.fullmatch(str(v).strip())
    if not m:
        raise UpdateError('Versão inválida no GitHub (esperado: v12.4.0).')
    return tuple(int(x or 0) for x in m.groups())

def parse_repo(value: str):
    s = str(value or '').strip().rstrip('/')
    if s.lower().startswith(('http://', 'https://')):
        u = urlparse(s)
        if u.scheme != 'https' or u.hostname != 'github.com' or u.username or u.password or u.port or u.query or u.fragment:
            raise UpdateError('Use um link https://github.com/USUARIO/REPOSITORIO.')
        s = u.path.strip('/')
        if s.lower().endswith('.git'):
            s = s[:-4]
    if s.lower().endswith('.git'):
        s=s[:-4]
    if not REPO_RE.fullmatch(s):
        raise UpdateError('Informe USUARIO/REPOSITORIO ou o endereço do repositório GitHub público.')
    return s

def _request_json(url: str):
    req = urllib.request.Request(url, headers={
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'Book-Poda-Localhost-Updater',
        'X-GitHub-Api-Version': '2022-11-28',
    })
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            return json.load(response)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            raise UpdateError('Repositório ou Release não encontrado (HTTP 404).', status=404) from e
        if e.code in (403, 429):
            raise UpdateError('O GitHub limitou as consultas. Aguarde e tente novamente.',status=e.code) from e
        raise UpdateError('GitHub respondeu HTTP ' + str(e.code),status=e.code) from e
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise UpdateError('Não foi possível conectar ao GitHub. Verifique a internet.') from e

def probe_repository(repo: str):
    """Testa o repositório em si (independente de haver Release).

    `ok` só é True depois de uma resposta válida da API do GitHub.
    Erros de internet e limite da API não são confundidos com repositório inválido.
    """
    repo = parse_repo(repo)
    try:
        info = _request_json('https://api.github.com/repos/' + repo)
        if not isinstance(info, dict) or not info.get('full_name'):
            raise UpdateError('GitHub retornou dados inesperados para o repositório.')
        if bool(info.get('private')):
            return {'ok':False,'status':'private','repo':repo,
                    'message':'O repositório é privado. O atualizador sem login só aceita repositórios públicos.'}
        canonical = str(info.get('full_name'))
        link = str(info.get('html_url') or '')
        if not link.startswith('https://github.com/'):
            link='https://github.com/'+repo
        return {'ok':True,'status':'ok','repo':canonical,'url':link,
                'message':'Repositório público encontrado e acessível no GitHub.',
                'archived':bool(info.get('archived',False))}
    except UpdateError as err:
        status=('not_found' if err.status==404 else
                'rate_limited' if err.status in (403,429) else
                'connection_error' if err.status is None else 'github_error')
        msg=('Repositório não encontrado ou privado no GitHub. Verifique o endereço e a visibilidade.'
             if status=='not_found' else str(err))
        return {'ok':False,'status':status,'repo':repo,'message':msg}


def check_updates(repo: str):
    """Diagnóstico explícito: repo correto, release ausente, asset ausente, etc."""
    repo = parse_repo(repo)
    repo_status = probe_repository(repo)
    result={'ok':repo_status['ok'],'repository':repo_status,
            'repo':repo,'current':version_string(),'latest':None,
            'available':False,'asset_found':False,'asset_valid':False,
            'release_url':None,'published_at':None,'status':repo_status['status'],
            'message':repo_status['message']}
    if not repo_status['ok']:
        return result
    try:
        raw = latest_release(repo)
        data = public_release(raw)
    except UpdateError as err:
        if err.status==404 or 'ainda não tem uma Release' in str(err):
            result.update(status='no_release',message='Repositório OK, mas ainda não há uma Release publicada. Publique uma versão no GitHub Actions.')
            return result
        if 'Versão inválida' in str(err):
            result.update(status='invalid_version',message='Repositório OK, porém a tag da última Release não tem formato vMAIOR.MENOR.PATCH.')
            return result
        status='rate_limited' if err.status in (403,429) else 'release_error'
        result.update(status=status,message='Repositório OK, mas a consulta das Releases falhou: '+str(err))
        return result
    result.update(data)
    # Instalação requer o ZIP e uma forma de validar seu SHA-256.
    asset_valid=bool(data['asset_found'])
    if asset_valid:
        # Não faz o download aqui. A validação criptográfica final acontece na instalação.
        # O teste abaixo também confere se a Release oferece checksum verificável.
        digest=raw.get('_digest','')
        has_checksum=bool(re.fullmatch(r'sha256:[0-9a-fA-F]{64}',digest or '')) or any(
            str(x.get('name','')).lower()==ASSET_NAME+'.sha256' for x in raw.get('_assets',[]))
        asset_valid=asset_valid and has_checksum
    result['asset_valid']=asset_valid
    if not data['asset_found']:
        result.update(status='missing_asset',message='Repositório OK. A Release existe, mas falta book-poda-update.zip.')
    elif not asset_valid:
        result.update(status='missing_checksum',message='Repositório OK. A Release precisa de book-poda-update.zip.sha256 ou digest SHA-256.')
    elif data['available']:
        result.update(status='update_available',message='Repositório OK. Nova versão '+data['latest']+' disponível para instalar.')
    else:
        result.update(status='up_to_date',message='Repositório OK. Você já está na versão mais recente.')
    return result


def latest_release(repo: str):
    repo = parse_repo(repo)
    try:
        obj = _request_json('https://api.github.com/repos/' + repo + '/releases/latest')
    except UpdateError as e:
        if e.status != 404:
            raise
        # Um 404 em /releases/latest pode significar repositório sem releases
        # ou repositório inexistente/privado. Explicar com clareza ao usuário.
        try:
            _request_json('https://api.github.com/repos/' + repo)
        except UpdateError as repo_error:
            if repo_error.status==404:
                raise UpdateError('Repositório não encontrado ou privado: '+repo+'. Confira se está público no GitHub.') from repo_error
            raise
        raise UpdateError('O repositório '+repo+' está acessível, mas ainda não tem uma Release publicada. Publique uma tag v12.3.1 (ou superior) e aguarde o GitHub Actions concluir.') from e
    tag = str(obj.get('tag_name', ''))
    latest = version_tuple(tag)
    version = version_tuple(version_string())
    assets = obj.get('assets', [])
    asset = next((x for x in assets if x.get('name', '').lower() == ASSET_NAME), None)
    digest = str(asset.get('digest') or '') if asset else ''
    page = str(obj.get('html_url') or '')
    if not page.startswith('https://github.com/' + repo + '/releases/'):
        page = 'https://github.com/' + repo + '/releases/latest'
    return {
        'repo': repo,
        'current': version_string(),
        'latest': tag.lstrip('vV'),
        'available': latest > version,
        'release_url': page,
        'notes': str(obj.get('body') or '')[:1200],
        'published_at': obj.get('published_at'),
        'asset_found': bool(asset),
        'asset_size': int(asset.get('size') or 0) if asset else 0,
        '_asset': asset,
        '_digest': digest,
        '_assets': assets,
    }

def public_release(data):
    return {k:v for k,v in data.items() if not k.startswith('_')}

def _allowed_redirect(url):
    u = urlparse(url)
    host = (u.hostname or '').lower()
    return (u.scheme == 'https' and not u.username and not u.password and host in {
        'github.com', 'api.github.com', 'objects.githubusercontent.com',
        'release-assets.githubusercontent.com', 'github-releases.githubusercontent.com',
    })

class SafeRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not _allowed_redirect(newurl):
            raise UpdateError('Redirecionamento do download não reconhecido.')
        return super().redirect_request(req, fp, code, msg, headers, newurl)

def download_release(data: dict, destination: Path):
    asset = data.get('_asset')
    if not asset:
        raise UpdateError('A Release não possui o arquivo book-poda-update.zip.')
    url = str(asset.get('browser_download_url') or '')
    if not url.startswith('https://github.com/' + data['repo'] + '/releases/download/') or not _allowed_redirect(url):
        raise UpdateError('URL de atualização não é válida.')
    expected = data.get('_digest')
    if not re.fullmatch(r'sha256:[0-9a-fA-F]{64}', expected or ''):
        # Suporte a arquivo de checksum anexado à mesma Release.
        sidecar = next((x for x in data['_assets'] if x.get('name', '').lower()== ASSET_NAME + '.sha256'), None)
        if not sidecar:
            raise UpdateError('A Release precisa informar digest SHA-256 ou anexar book-poda-update.zip.sha256.')
        checksum_url = str(sidecar.get('browser_download_url', ''))
        if not checksum_url.startswith('https://github.com/' + data['repo'] + '/releases/download/'):
            raise UpdateError('Arquivo de checksum inválido.')
        opener = urllib.request.build_opener(SafeRedirectHandler())
        with opener.open(urllib.request.Request(checksum_url, headers={'User-Agent':'Book-Poda-Localhost-Updater'}), timeout=30) as r:
            checksum_text = r.read(500).decode('utf-8', 'replace')
        match = re.match(r'^\s*([0-9a-fA-F]{64})(?:\s+\*?book-poda-update\.zip)?\s*$', checksum_text)
        if not match:
            raise UpdateError('Formato SHA-256 inválido na Release.')
        expected = 'sha256:' + match.group(1)
    destination.parent.mkdir(parents=True, exist_ok=True)
    opener = urllib.request.build_opener(SafeRedirectHandler())
    req = urllib.request.Request(url, headers={'User-Agent':'Book-Poda-Localhost-Updater'})
    sha = hashlib.sha256(); total = 0
    try:
        with opener.open(req, timeout=50) as response, destination.open('wb') as out:
            while True:
                chunk = response.read(512 * 1024)
                if not chunk: break
                total += len(chunk)
                if total > MAX_DOWNLOAD:
                    raise UpdateError('Arquivo de atualização ultrapassou 180 MB.')
                sha.update(chunk);out.write(chunk)
        if sha.hexdigest().lower() != expected.split(':',1)[1].lower():
            raise UpdateError('SHA-256 não confere. Atualização interrompida.')
        return sha.hexdigest(), total
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        destination.unlink(missing_ok=True)
        raise UpdateError('Falha ao baixar a atualização do GitHub.') from e
    except Exception:
        destination.unlink(missing_ok=True)
        raise
