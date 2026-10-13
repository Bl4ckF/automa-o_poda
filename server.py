"""Book Poda Localhost • abra http://localhost:8765/ no navegador."""
from __future__ import annotations
import json
import logging
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import threading
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse,parse_qs,unquote
import book_engine as core
import github_updates as updates
from update_worker import inspect_zip, write_status, status_file

ROOT=Path(__file__).resolve().parent
STATIC=ROOT/'web'
PORT=int(os.environ.get('BOOK_PODA_PORT','8765'))
HOST='127.0.0.1'
LOG=core.DATA/'servidor.log'
UPDATE_LOCK=threading.Lock()

class Handler(BaseHTTPRequestHandler):
    server_version='BookPodaLocal/12.3'
    def log_message(self,fmt,*args):
        logging.info('%s '+fmt,self.client_address[0],*args)

    def _json(self,obj,status=200):
        data=json.dumps(obj,ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Content-Length',str(len(data)))
        self.end_headers();self.wfile.write(data)

    def _file(self,path,cache=False):
        path=Path(path)
        if not path.is_file():return self._json({'error':'Arquivo não encontrado.'},404)
        ctype=mimetypes.guess_type(str(path))[0] or 'application/octet-stream'
        if path.suffix=='.js':ctype='text/javascript'
        if path.suffix=='.pdf':ctype='application/pdf'
        self.send_response(200)
        self.send_header('Content-Type',ctype+('; charset=utf-8' if ctype.startswith(('text/','application/javascript')) else ''))
        self.send_header('Cache-Control','public, max-age=86400' if cache and 'qfield_tiles' in path.parts else 'no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Content-Length',str(path.stat().st_size))
        self.end_headers()
        with path.open('rb') as f:shutil.copyfileobj(f,self.wfile,128*1024)

    def _payload(self,maxbytes=700000):
        n=int(self.headers.get('Content-Length','0'))
        if n<1 or n>maxbytes:raise ValueError('Tamanho da solicitação inválido.')
        try:return json.loads(self.rfile.read(n))
        except (ValueError,UnicodeError) as e:raise ValueError('JSON inválido.') from e

    def do_GET(self):
        try:self.route_get()
        except (ValueError,KeyError) as e:self._json({'error':str(e)},400)
        except Exception as e:
            logging.exception('GET %s',self.path)
            self._json({'error':'Falha no servidor: '+str(e)},500)

    def route_get(self):
        url=urlparse(self.path);p=unquote(url.path);query=parse_qs(url.query)
        if p=='/api/health':return self._json({'ok':True,'server':'Book Poda Localhost','version':updates.version_string(),'equipment':len(core.equipment().rows)})
        if p=='/api/update/status':
            repo=core.get_settings().get('github_repo','')
            f=status_file()
            try: last=json.loads(f.read_text(encoding='utf-8'))
            except (OSError,ValueError):last={'state':'idle'}
            return self._json({'version':updates.version_string(),'repo':repo,'last':last})
        if p=='/api/settings':return self._json(core.get_settings())
        if p=='/api/draft':return self._json(core.load_draft())
        if p=='/api/search':return self._json(core.search_location(query.get('q',[''])[0]))
        if p=='/api/lookup':return self._json(core.lookup_coord(query.get('coord',[''])[0]))
        if p=='/api/books':return self._json({'rows':core.list_books(query.get('q',[''])[0])})
        if p=='/api/os':return self._json(core.sheet_os(query.get('refresh',['0'])[0]=='1'))
        if re.fullmatch(r'/api/books/\d+/pdf',p):
            ident=int(p.split('/')[3]);row=core.get_book(ident)
            if not row:return self._json({'error':'Book não encontrado.'},404)
            return self._file(Path(row['path']))
        if re.fullmatch(r'/api/books/\d+',p):
            row=core.get_book(int(p.split('/')[-1]))
            if not row:return self._json({'error':'Book não encontrado.'},404)
            return self._json(row)
        if p.startswith('/media/'):
            local=core.local_media(p)
            if local:return self._file(local,True)
            # fotos persistidas (da geração anterior) só pelo endpoint de registro
            return self._json({'error':'Imagem não encontrada.'},404)
        if re.fullmatch(r'/api/books/\d+/photo/\d+/(antes|depois)',p):
            split=p.split('/');row=core.get_book(int(split[3]))
            try:photo=Path(row['payload']['records'][int(split[5])][split[6]])
            except (KeyError,IndexError,TypeError):return self._json({'error':'Imagem não encontrada.'},404)
            settings=core.get_settings()
            # Importações legadas não expõem caminhos arbitrários.
            if not str(photo.resolve()).startswith(str(Path(settings['output_dir']).resolve())+os.sep):return self._json({'error':'Imagem indisponível.'},404)
            return self._file(photo)
        if p=='/':return self._file(STATIC/'index.html')
        if p=='/map/':return self._file(STATIC/'map_v11.html')
        if p.startswith('/map/'):
            local=(STATIC/p.removeprefix('/map/')).resolve()
            if not local.is_relative_to(STATIC.resolve()):return self._json({'error':'Caminho inválido.'},403)
            return self._file(local,True)
        if p.startswith('/assets/'):
            local=(STATIC/p.removeprefix('/assets/')).resolve()
            if not local.is_relative_to(STATIC.resolve()):return self._json({'error':'Caminho inválido.'},403)
            return self._file(local,True)
        return self._json({'error':'Rota não encontrada.'},404)

    def do_POST(self):
        try:self.route_post()
        except FileExistsError as e:self._json({'error':str(e)},409)
        except (ValueError,KeyError) as e:self._json({'error':str(e)},400)
        except Exception as e:
            logging.exception('POST %s',self.path)
            self._json({'error':'Falha no servidor: '+str(e)},500)

    def route_post(self):
        p=urlparse(self.path).path
        if p.startswith('/api/update/'):
            # Proteção CSRF: páginas externas não podem mandar este cabeçalho
            # sem preflight CORS, que nosso servidor não permite.
            if self.headers.get('X-BookPoda-Update')!='1':
                return self._json({'error':'Requisição de atualização não autorizada.'},403)
            origin=self.headers.get('Origin','')
            if origin and origin not in (f'http://localhost:{PORT}',f'http://127.0.0.1:{PORT}'):
                return self._json({'error':'Origem não autorizada.'},403)
            if self.headers.get('Content-Type','').split(';')[0].strip().lower()!='application/json':
                return self._json({'error':'Envie JSON para a API de atualização.'},415)
            if p=='/api/update/repository':
                payload=self._payload(4096)
                repo=updates.parse_repo(payload.get('repo',''))
                cfg=core.get_settings();cfg['github_repo']=repo
                core.CONFIG.parent.mkdir(parents=True,exist_ok=True)
                core.CONFIG.write_text(json.dumps(cfg,ensure_ascii=False,indent=2),encoding='utf-8')
                return self._json({'ok':True,'repo':repo})
            if p=='/api/update/check':
                self._payload(4096)
                repo=core.get_settings().get('github_repo','')
                if not repo:raise ValueError('Configure primeiro o endereço do repositório GitHub.')
                return self._json(updates.public_release(updates.latest_release(repo)))
            if p=='/api/update/install':
                self._payload(4096)
                if not UPDATE_LOCK.acquire(blocking=False):
                    return self._json({'error':'Outra atualização já está sendo preparada.'},409)
                try:
                    repo=core.get_settings().get('github_repo','')
                    if not repo:raise ValueError('Configure o repositório GitHub antes de atualizar.')
                    release=updates.latest_release(repo)
                    if not release['available']:
                        raise ValueError('Esta instalação já está na versão mais recente.')
                    version=release['latest']
                    folder=core.DATA/'atualizacoes'/'staging'
                    archive=folder/('book-poda-'+version+'.zip')
                    updates.download_release(release,archive)
                    inspect_zip(archive,version)
                    write_status(ROOT,'prepared',message='Download conferido. Reiniciando para instalar...',target=version)
                    flags=(getattr(subprocess,'CREATE_NEW_PROCESS_GROUP',0)|getattr(subprocess,'CREATE_NO_WINDOW',0)) if os.name=='nt' else 0
                    options={'cwd':str(ROOT),'creationflags':flags} if os.name=='nt' else {'cwd':str(ROOT),'start_new_session':True,'stdout':subprocess.DEVNULL,'stderr':subprocess.DEVNULL}
                    subprocess.Popen([sys.executable,str(ROOT/'update_worker.py'),'--archive',str(archive),'--version',version,'--port',str(PORT)],**options)
                    self._json({'ok':True,'restarting':True,'version':version,'message':'Atualização baixada e verificada. O servidor será reiniciado.'},202)
                    threading.Timer(0.5,self.server.shutdown).start()
                    return
                finally:
                    UPDATE_LOCK.release()
            return self._json({'error':'Rota de atualização não encontrada.'},404)
        if p=='/api/upload':
            n=int(self.headers.get('Content-Length','0'))
            if not(0<n<=18*1024*1024):raise ValueError('Imagem acima de 18 MB ou vazia.')
            ctype=self.headers.get('Content-Type','').split(';')[0].lower()
            suffix={'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp','image/bmp':'.bmp'}.get(ctype)
            if not suffix:raise ValueError('Envie uma imagem PNG, JPEG, WEBP ou BMP.')
            import io
            from PIL import Image
            content=self.rfile.read(n)
            try:
                with Image.open(io.BytesIO(content)) as img:img.verify()
            except Exception:raise ValueError('O arquivo não contém uma imagem válida.')
            filename=uuid.uuid4().hex+suffix
            path=core.UPLOADS/filename
            path.write_bytes(content)
            return self._json({'url':'/media/'+filename})
        if p=='/api/books/generate':return self._json(core.create_book(self._payload()))
        if p=='/api/settings':return self._json(core.set_settings(self._payload()))
        if p=='/api/draft':return self._json(core.save_draft(self._payload()))
        if p=='/api/draft/clear':return self._json(core.save_draft({}))
        if re.fullmatch(r'/api/books/\d+/open_folder',p):
            row=core.get_book(int(p.split('/')[3]))
            if not row:return self._json({'error':'Book não encontrado.'},404)
            folder=Path(row['path']).parent
            if not folder.exists():return self._json({'error':'Pasta não encontrada.'},404)
            if sys.platform=='win32':os.startfile(str(folder))
            elif sys.platform=='darwin':
                import subprocess;subprocess.Popen(['open',str(folder)])
            else:
                # Ambiente sem gestor de arquivos: retornar caminho sem tentar abrir.
                return self._json({'ok':True,'folder':str(folder),'message':'Abra a pasta no gerenciador de arquivos.'})
            return self._json({'ok':True,'folder':str(folder)})
        return self._json({'error':'Rota não encontrada.'},404)

def run(port=PORT,open_browser=True):
    core.setup()
    core.equipment()
    logging.basicConfig(filename=LOG,level=logging.INFO,format='%(asctime)s %(levelname)s %(message)s',encoding='utf-8')
    httpd=ThreadingHTTPServer((HOST,port),Handler)
    httpd.daemon_threads=True
    uri=f'http://localhost:{port}/'
    print('\n'+'='*58+'\nBOOK PODA • LOCALHOST\n'+uri+'\nPara fechar, pressione Ctrl+C nesta janela.\n'+'='*58,flush=True)
    if open_browser:threading.Timer(1.0,lambda:webbrowser.open(uri)).start()
    try:httpd.serve_forever(poll_interval=.2)
    except KeyboardInterrupt:pass
    finally:httpd.server_close()

if __name__=='__main__':run()
