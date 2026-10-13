"""Aplica um ZIP oficial de atualização fora do processo do servidor.

Não lê credenciais; não modifica Dados, Books, Bases QField ou .venv.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import shutil
import socket
import stat
import subprocess
import sys
import time
import zipfile
from datetime import datetime
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parent
SAFE_ROOT_FILES = {
    'server.py', 'book_engine.py', 'qfield_search.py', 'github_updates.py',
    'update_worker.py', 'version.json', 'requirements.txt', 'README.txt',
    'INSTALAR_E_INICIAR.bat', 'INICIAR_LOCALHOST.bat', 'qfield_equipment_index.json',
}
MAX_FILES = 6500
MAX_UNPACKED = 450 * 1024 * 1024

def status_file(root=ROOT):
    return root/'Dados'/'atualizacoes'/'status.json'

def write_status(root, state, **data):
    out=status_file(root)
    out.parent.mkdir(parents=True,exist_ok=True)
    obj={'state':state, 'updated_at': datetime.now().astimezone().isoformat(timespec='seconds'), **data}
    tmp=out.with_suffix('.tmp')
    tmp.write_text(json.dumps(obj,ensure_ascii=False,indent=2),encoding='utf-8')
    os.replace(tmp,out)

def is_safe_path(name):
    if '\\' in name or name.startswith('/') or '\x00' in name or ':' in name:
        return False
    p=PurePosixPath(name)
    parts=p.parts
    if any(x in ('', '.', '..') for x in parts) or not parts:
        return False
    if len(parts)==1:
        return name in SAFE_ROOT_FILES
    if parts[0]!='web':
        return False
    if any(x.startswith('.') or x=='__pycache__' for x in parts):
        return False
    # Web resources only. Executable server logic is restricted to SAFE_ROOT_FILES.
    return p.suffix.lower() in ('.js','.html','.css','.png','.jpg','.jpeg','.svg','.webp','.ico','.json')

def inspect_zip(archive: Path, version: str):
    import github_updates
    expected=github_updates.version_tuple(version)
    if not zipfile.is_zipfile(archive):
        raise ValueError('Atualização não contém um ZIP válido.')
    with zipfile.ZipFile(archive) as z:
        names=z.namelist()
        files=[info for info in z.infolist() if not info.is_dir()]
        if len(files)>MAX_FILES:raise ValueError('Atualização excede o número máximo de arquivos.')
        if len(names)!=len(set(n.lower() for n in names)):
            raise ValueError('ZIP contém nomes repetidos.')
        if sum(i.file_size for i in files)>MAX_UNPACKED:
            raise ValueError('Atualização tem tamanho descompactado excessivo.')
        nameset={i.filename for i in files}
        if 'update_manifest.json' not in nameset or 'version.json' not in nameset:
            raise ValueError('ZIP sem update_manifest.json ou version.json.')
        man=json.loads(z.read('update_manifest.json'))
        checksums=man.get('files')
        if not isinstance(checksums,dict) or set(checksums)!=nameset-{'update_manifest.json'}:
            raise ValueError('Manifesto não corresponde aos arquivos da atualização.')
        payload=json.loads(z.read('version.json'))
        if github_updates.version_tuple(payload.get('version',''))!=expected:
            raise ValueError('A versão interna difere da versão publicada no GitHub.')
        for info in files:
            name=info.filename
            if name=='update_manifest.json':continue
            if not is_safe_path(name):
                raise ValueError('Atualização tenta modificar um caminho protegido: '+name)
            mode=info.external_attr >> 16
            if stat.S_IFMT(mode)==stat.S_IFLNK:
                raise ValueError('Atualização contém link simbólico.')
            if info.file_size>120*1024*1024:
                raise ValueError('Arquivo excessivamente grande: '+name)
            expected_sha=checksums[name]
            if not isinstance(expected_sha,str) or len(expected_sha)!=64:
                raise ValueError('Checksum inválido: '+name)
            sha=hashlib.sha256()
            with z.open(info) as source:
                for block in iter(lambda:source.read(1024*512),b''):
                    sha.update(block)
            if sha.hexdigest().lower()!=expected_sha.lower():
                raise ValueError('Arquivo alterado ou corrompido: '+name)
        return sorted(n for n in nameset if n!='update_manifest.json')

def apply_archive(root: Path, archive: Path, version: str):
    """Aplica mudança com backup e rollback. Retorna quantidade de arquivos."""
    names=inspect_zip(archive,version)
    backup=root/'Dados'/'atualizacoes'/'backups'/('antes-v'+version+'-'+datetime.now().strftime('%Y%m%d-%H%M%S'))
    created=[]; existing=[]
    # version.json por último; a versão publicada só muda após todos os arquivos.
    names.sort(key=lambda name:name=='version.json')
    try:
        with zipfile.ZipFile(archive) as z:
            for name in names:
                target=root/name
                if target.exists():
                    old=backup/name;old.parent.mkdir(parents=True,exist_ok=True)
                    shutil.copy2(target,old)
                    existing.append((target,old))
                else:
                    created.append(target)
                target.parent.mkdir(parents=True,exist_ok=True)
                temp=target.with_name(target.name+'.updating')
                try:
                    with z.open(name) as src, temp.open('wb') as dst:
                        shutil.copyfileobj(src,dst,1024*512)
                    os.replace(temp,target)
                finally:
                    temp.unlink(missing_ok=True)
        if ('requirements.txt' in names and
                (not (backup/'requirements.txt').exists() or
                (backup/'requirements.txt').read_bytes() != (root/'requirements.txt').read_bytes())):
            # Só instala dependências se requirements.txt realmente mudou.
            pip=subprocess.run([sys.executable,'-m','pip','install','-r',str(root/'requirements.txt')],
                cwd=root,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=240)
            if pip.returncode:
                raise RuntimeError('Não foi possível instalar as dependências: '+pip.stdout[-700:])
        return len(names)
    except Exception:
        for target,old in reversed(existing):
            if old.exists():
                shutil.copy2(old,target)
        for target in created:
            target.unlink(missing_ok=True)
        raise

def wait_server_down(port:int, timeout=35):
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        with socket.socket() as sock:
            sock.settimeout(.35)
            if sock.connect_ex(('127.0.0.1',port))!=0:
                time.sleep(.8)
                return True
        time.sleep(.35)
    return False

def restart_server(root:Path):
    args=[sys.executable,str(root/'server.py')]
    flags=getattr(subprocess,'CREATE_NEW_CONSOLE',0) if os.name=='nt' else 0
    kwargs={'cwd':str(root),'creationflags':flags} if os.name=='nt' else {'cwd':str(root),'start_new_session':True}
    if os.name!='nt':
        log=(root/'Dados'/'atualizacoes'/'reinicio.log').open('ab')
        kwargs.update({'stdin':subprocess.DEVNULL,'stdout':log,'stderr':subprocess.STDOUT})
    subprocess.Popen(args,**kwargs)

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--archive',required=True)
    parser.add_argument('--version',required=True)
    parser.add_argument('--port',type=int,default=8765)
    args=parser.parse_args()
    root=ROOT
    write_status(root,'waiting',message='Aguardando encerramento do servidor...',target=args.version)
    ok=wait_server_down(args.port)
    if not ok:
        write_status(root,'failed',message='O servidor não encerrou; atualização cancelada.',target=args.version)
        return 1
    try:
        write_status(root,'installing',message='Instalando atualização...',target=args.version)
        count=apply_archive(root,Path(args.archive),args.version)
        write_status(root,'success',message=f'Atualização instalada com sucesso ({count} arquivos).',target=args.version)
    except Exception as e:
        write_status(root,'failed',message='Falha na atualização: '+str(e),target=args.version)
    finally:
        try:restart_server(root)
        except Exception as e:
            write_status(root,'failed',message='Não foi possível reiniciar automaticamente: '+str(e),target=args.version)
    return 0

if __name__=='__main__':sys.exit(main())
