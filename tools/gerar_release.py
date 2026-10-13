#!/usr/bin/env python3
"""Gera o ZIP incremental e seu checksum para publicação no GitHub Releases.

Execute dentro da raiz da instalação/repositório:
    python tools/gerar_release.py

Não empacota Books, Dados, .venv, Bases QField ou o índice/tiles grandes.
"""
import hashlib
import json
import sys
import zipfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
VERSION=json.loads((ROOT/'version.json').read_text(encoding='utf-8'))['version']
FILES=[
 'server.py','book_engine.py','qfield_search.py','github_updates.py',
 'update_worker.py','version.json','requirements.txt','README.txt',
 'INSTALAR_E_INICIAR.bat','INICIAR_LOCALHOST.bat',
 'web/index.html','web/app.js','web/style.css','web/map_v11.js','web/map_v11.html',
]
# Outros recursos visuais podem ser atualizados se necessário.
for f in sorted((ROOT/'web').glob('*')):
 if f.is_file() and f.suffix.lower() in ('.png','.svg','.ico','.webp'):
  FILES.append('web/'+f.name)
FILES=[f for f in FILES if (ROOT/f).is_file()]
if not all(f in FILES for f in ('version.json','server.py','update_worker.py')):
 sys.exit('Não foi possível encontrar os arquivos essenciais.')
DIST=ROOT/'dist'
DIST.mkdir(exist_ok=True)
archive=DIST/'book-poda-update.zip'
manifest={'version':VERSION,'files':{}}
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=7) as z:
 for f in FILES:
  data=(ROOT/f).read_bytes()
  manifest['files'][f]=hashlib.sha256(data).hexdigest()
  z.writestr(f,data)
 z.writestr('update_manifest.json',json.dumps(manifest,indent=2,ensure_ascii=False).encode('utf-8'))
sha=hashlib.sha256(archive.read_bytes()).hexdigest()
(DIST/'book-poda-update.zip.sha256').write_text(sha+'  book-poda-update.zip\n',encoding='utf-8')
print('Versão:',VERSION,'Arquivos:',len(FILES),'Pacote:',archive,'SHA-256:',sha)
