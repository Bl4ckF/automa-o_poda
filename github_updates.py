"""Verificação/obtenção de atualizações oficiais por GitHub Releases.

Não depende de requests, git, Node ou login GitHub (repositórios públicos).
"""
from __future__ import annotations
import hashlib
import json
import re
import tempfile
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
VERSION_FILE = ROOT / 'version.json'
ASSET_NAME = 'book-poda-update.zip'
MAX_DOWNLOAD = 180 * 1024 * 1024
MAX_FILES = 6500
MAX_UNPACKED = 450 * 1024 * 1024
REPO_RE = re.compile(r'^[A-Za-z0-9][\w.-]{0,99}/[A-Za-z0-9][\w.-]{0,99}$')
VERSION_RE = re.compile(r'^v?(\d+)\.(\d+)(?:\.(\d+))?$', re.I)

class UpdateError(ValueError):
    pass

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
            raise UpdateError('Repositório público ou Release publicada não encontrada no GitHub.') from e
        if e.code in (403, 429):
            raise UpdateError('Limite de consultas do GitHub. Aguarde e tente novamente.') from e
        raise UpdateError('GitHub respondeu HTTP ' + str(e.code)) from e
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise UpdateError('Não foi possível conectar ao GitHub. Verifique a internet.') from e

def latest_release(repo: str):
    repo = parse_repo(repo)
    obj = _request_json('https://api.github.com/repos/' + repo + '/releases/latest')
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
