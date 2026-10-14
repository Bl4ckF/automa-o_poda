"""Book Poda: regra de negócio do servidor localhost, sem dependências Qt."""
from __future__ import annotations
import csv
import datetime as dt
import io
import json
import math
import re
import shutil
import sqlite3
import threading
import urllib.request
import uuid
from pathlib import Path
from decimal import Decimal, InvalidOperation
from PIL import Image, ImageOps
from pyproj import CRS, Transformer
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase.pdfmetrics import stringWidth
from qfield_search import EquipmentSearch

BASE=Path(__file__).resolve().parent
DATA=BASE/'Dados'
UPLOADS=DATA/'uploads'
BOOKS_DB=DATA/'books.sqlite3'
CONFIG=DATA/'config.json'
DRAFT=DATA/'rascunho.json'
OS_CACHE=DATA/'os_cache.json'
SHEET_ID='1sQ5ciyk_GMzYrcug6EHDWQR9v_RZgXVPIGaO1X0L5Zw'
MONTHS=('Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro')
LOCK=threading.RLock()
EQUIPMENT=None
BOOK_TYPES={'poda':{'name':'Poda','team':'ENG PDCG02','filename_team':'ENG-PDCG02'},
            'limpeza_faixa':{'name':'Limpeza de Faixa','team':'ENG LFCG02','filename_team':'ENG-LFCG02'}}
MEASURE_UNITS={'m2':'m²','km':'km'}

def setup():
    DATA.mkdir(parents=True, exist_ok=True); UPLOADS.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(BOOKS_DB) as db:
        db.execute('CREATE TABLE IF NOT EXISTS books (id INTEGER PRIMARY KEY AUTOINCREMENT, os TEXT NOT NULL, data TEXT NOT NULL, qtd INTEGER NOT NULL, filename TEXT NOT NULL, path TEXT NOT NULL, created TEXT NOT NULL, payload TEXT NOT NULL)')
        # Migração não destrutiva: os Books antigos continuam identificados como Poda.
        cols={r[1] for r in db.execute('PRAGMA table_info(books)').fetchall()}
        if 'tipo' not in cols: db.execute("ALTER TABLE books ADD COLUMN tipo TEXT NOT NULL DEFAULT 'poda'")
        if 'unidade' not in cols: db.execute("ALTER TABLE books ADD COLUMN unidade TEXT NOT NULL DEFAULT 'un'")
        db.execute('CREATE INDEX IF NOT EXISTS idx_os ON books(os)')
        db.execute('CREATE INDEX IF NOT EXISTS idx_tipo ON books(tipo)')
        if db.execute('SELECT COUNT(*) FROM books').fetchone()[0]==0:
            old=Path.home()/'BookPodaRegistros.json'
            if old.exists():
                try:
                    for item in json.loads(old.read_text(encoding='utf-8')):
                        p=Path(str(item.get('arquivo','')))
                        db.execute('INSERT INTO books(os,data,qtd,filename,path,created,payload) VALUES(?,?,?,?,?,?,?)', (
                            str(item.get('os','')),str(item.get('data','')),int(item.get('qtd',0)),p.name,str(p),str(item.get('gerado','')),json.dumps({'legacy':True})))
                except (ValueError,OSError,TypeError): pass

def get_settings():
    default={'output_dir':str(BASE/'Books'),'prestador':'ENGELMIG ELÉTRICA LTDA','os_prefix':'ENG-PDBT02.CMAD','os_prefix_faixa':'','github_repo':''}
    try: default.update(json.loads(CONFIG.read_text(encoding='utf-8')))
    except (OSError,ValueError): pass
    return default

def set_settings(settings):
    prev=get_settings()
    output=str(settings.get('output_dir','')).strip()
    if not output: raise ValueError('Informe a pasta para salvar os Books.')
    root=Path(output).expanduser().resolve()
    root.mkdir(parents=True,exist_ok=True)
    if not root.is_dir():raise ValueError('A pasta configurada é inválida.')
    prev['output_dir']=str(root)
    for k in ('prestador','os_prefix'):
        if k in settings:
            t=str(settings[k]).strip()
            if not t or len(t)>80:raise ValueError(f'Valor inválido para {k}.')
            prev[k]=t
    if 'os_prefix_faixa' in settings:
        t=str(settings['os_prefix_faixa']).strip()
        if len(t)>80:raise ValueError('Prefixo da OS de Limpeza de Faixa muito longo.')
        prev['os_prefix_faixa']=t
    CONFIG.write_text(json.dumps(prev,indent=2,ensure_ascii=False),encoding='utf-8')
    return prev

def parse_coord(text):
    """Converte UTM, graus decimais com hemisfério, DMS e graus decimais em WGS84."""
    s = str(text).strip().upper().replace('−', '-').replace('–', '-').replace('˚', '°')
    utm = re.search(r'(?:ZONA\s*)?(\d{1,2})\s*([C-HJ-NP-X])?\D{0,8}(\d{5,7}(?:[.,]\d+)?)\D+(\d{6,8}(?:[.,]\d+)?)', s)
    if utm:
        zone = int(utm.group(1))
        band = utm.group(2) or ''
        east = float(utm.group(3).replace(',', '.'))
        north = float(utm.group(4).replace(',', '.'))
        if not (1 <= zone <= 60 and 100000 <= east <= 900000 and 0 <= north <= 10000000):
            raise ValueError('UTM fora do intervalo válido.')
        crs = CRS.from_dict({'proj': 'utm', 'zone': zone, 'south': not band or band < 'N', 'datum': 'WGS84', 'units': 'm'})
        lon, lat = Transformer.from_crs(crs, 'EPSG:4326', always_xy=True).transform(east, north)
        return validate_coord(lat, lon)

    # IMPORTANTE: graus decimais direcionais são detectados ANTES do formato DMS.
    # Ex.: 20.554185°S 54.578959°W -> -20.554185, -54.578959.
    # A versão 12.1 confundia os últimos 3 dígitos decimais com graus inteiros.
    directional_decimal = re.findall(
        r'(?<![\d.,])([+-]?\d{1,3}(?:[.,]\d+)?)\s*[°º]?\s*([NSEWO])\b', s
    )
    if len(directional_decimal) >= 2:
        lat = lon = None
        for value, direction in directional_decimal:
            v = abs(float(value.replace(',', '.')))
            signed = -v if direction in ('S', 'W', 'O') else v
            if direction in ('N', 'S'):
                lat = signed
            else:
                lon = signed
        if lat is not None and lon is not None:
            return validate_coord(lat, lon)

    # Graus, minutos e segundos: 20°33'15.066"S 54°34'44.252"W.
    dms = re.findall(
        r'(?<![\d.,])(\d{1,3})\s*[°º]\s*(\d{1,2})?\s*[\'’′]?\s*([\d.,]+)?\s*["”″]?\s*([NSEWO])\b', s
    )
    if len(dms) >= 2:
        lat = lon = None
        for degrees, minutes, seconds, direction in dms:
            minute = float(minutes or 0)
            second = float((seconds or '0').replace(',', '.'))
            if not (0 <= minute < 60 and 0 <= second < 60):
                raise ValueError('Minutos ou segundos fora do intervalo válido.')
            value = float(degrees) + minute / 60 + second / 3600
            signed = -value if direction in ('S', 'W', 'O') else value
            if direction in ('N', 'S'):
                lat = signed
            else:
                lon = signed
        if lat is not None and lon is not None:
            return validate_coord(lat, lon)

    # Latitude e longitude decimais com sinal, separados por vírgula ou espaço.
    nums = re.findall(r'[+-]?\d{1,3}(?:[.,]\d+)?', s)
    vals = [float(x.replace(',', '.')) for x in nums]
    for a, b in zip(vals, vals[1:]):
        if -90 <= a <= 90 and -180 <= b <= 180 and (abs(a) > 1 or abs(b) > 1):
            return validate_coord(a, b)
    raise ValueError('Coordenada inválida. Exemplos: 20.554185°S 54.578959°W, -20.554185, -54.578959 ou 21K 753302 7725693.')

def validate_coord(lat,lon):
    lat,lon=float(lat),float(lon)
    if not(-90<=lat<=90 and -180<=lon<=180):raise ValueError('Latitude/longitude fora do intervalo.')
    return lat,lon

def equipment():
    global EQUIPMENT
    if EQUIPMENT is None:
        with LOCK:
            if EQUIPMENT is None:EQUIPMENT=EquipmentSearch(use_bundle=True)
    return EQUIPMENT

def search_location(term):
    text=str(term).strip()
    if not text:raise ValueError('Digite uma coordenada ou número de TD/religador.')
    looks_eq=bool(re.match(r'^(TD|RD|TRAFO|TRANSFORMADOR|RELIGADOR)',text,re.I) or re.fullmatch(r'\d{1,12}',text))
    if not looks_eq:
        try:
            lat,lon=parse_coord(text)
            return {'type':'coord','lat':lat,'lon':lon,'nearest':nearest(lat,lon)}
        except ValueError:pass
    found=equipment().find(text,limit=40)
    if found:return {'type':'equipment','results':[dict(kind=r[0],code=r[1],lat=r[2],lon=r[3],circuit=r[4]) for r in found]}
    raise ValueError('Nenhum equipamento encontrado. Verifique o número ou as coordenadas.')

def _hav(a,b,c,d):
    p1,p2=math.radians(a),math.radians(c);dp=math.radians(c-a);dl=math.radians(d-b)
    h=math.sin(dp/2)**2+math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 12742000*math.atan2(math.sqrt(h),math.sqrt(1-h))

def nearest(lat,lon,limit_m=1200):
    # Busca geográfica em memória: restringe caixa antes da haversine.
    tds=rds=None
    delta=limit_m/85000
    for row in equipment().rows:
        kind,code,ylat,xlon,circ=row
        if abs(ylat-lat)>delta or abs(xlon-lon)>delta*1.2:continue
        d=_hav(lat,lon,ylat,xlon)
        if d>limit_m:continue
        item={'kind':kind,'code':code,'distance_m':round(d),'circuit':circ}
        if kind=='TD' and (tds is None or d<tds['distance_m']):tds=item
        if kind=='RD' and (rds is None or d<rds['distance_m']):rds=item
    return {'td':tds,'rd':rds}

def lookup_coord(value):
    lat,lon=parse_coord(value)
    n=nearest(lat,lon)
    street=neighborhood=''
    try:
        u=f'https://nominatim.openstreetmap.org/reverse?lat={lat:.7f}&lon={lon:.7f}&format=json&addressdetails=1&zoom=18'
        req=urllib.request.Request(u,headers={'User-Agent':'BookPodaLocal/12 (uso interno)'})
        with urllib.request.urlopen(req,timeout=5) as r:
            a=json.load(r).get('address',{})
            street=a.get('road') or a.get('pedestrian') or a.get('residential') or ''
            neighborhood=a.get('suburb') or a.get('neighbourhood') or a.get('city_district') or ''
    except Exception:pass
    return {'lat':lat,'lon':lon,'coord':f'{lat:.8f}, {lon:.8f}', 'rua':street,'bairro':neighborhood,'td':n['td']['code'] if n['td'] else '', 'rd':n['rd']['code'] if n['rd'] else '', 'nearest':n}

def date_parse(value):
    s=str(value).strip()
    if re.fullmatch(r'\d{8}',s):s=f'{s[:2]}/{s[2:4]}/{s[4:]}'
    if re.fullmatch(r'\d{4}-\d{2}-\d{2}',s):return dt.date.fromisoformat(s)
    try:return dt.datetime.strptime(s,'%d/%m/%Y').date()
    except ValueError:raise ValueError('Data inválida. Use DD/MM/AAAA.')

def normalize_os(raw):
    raw=str(raw).strip()
    if '/' in raw:raw=raw.split('/')[0].strip()
    if not re.fullmatch(r'[0-9A-Za-z_-]{1,30}',raw):raise ValueError('OS inválida. Digite somente o número (preservando zeros).')
    return raw

def _text(c,x,y,s,size=9,bold=False,center=False,maxwidth=None):
    s=str(s or '').replace('\n',' ').strip()
    font='Helvetica-Bold' if bold else 'Helvetica'
    if maxwidth:
        while size>5.0 and stringWidth(s,font,size)>maxwidth:size-=.3
        while s and stringWidth(s,font,size)>maxwidth:s=s[:-2]+'…'
    c.setFont(font,size)
    if center:c.drawCentredString(x,y,s)
    else:c.drawString(x,y,s)

def _image_fit(c,path,x,y,w,h):
    if not path or not Path(path).is_file():return
    try:
        with Image.open(path) as img:
            im=ImageOps.exif_transpose(img).convert('RGB')
            iw,ih=im.size;scale=min(w/iw,h/ih)
            from reportlab.lib.utils import ImageReader
            c.drawImage(ImageReader(im),x+(w-iw*scale)/2,y+(h-ih*scale)/2,iw*scale,ih*scale)
    except Exception:pass

def format_measure(value):
    """Formata medição decimal sem remover casas necessárias (padrão brasileiro)."""
    v=Decimal(str(value))
    compact=format(v.normalize(),'f')
    a,point,dec=compact.partition('.')
    prefix='-' if a.startswith('-') else ''
    a=a.lstrip('-')
    chunks=[]
    while a:
        chunks.append(a[-3:]);a=a[:-3]
    return prefix+'.'.join(reversed(chunks))+(','+dec if point else '')

def parse_measure(value):
    raw=str(value if value is not None else '').strip().replace(' ', '')
    # Aceita 1234,5 ou 1234.5; não confunde separador de milhar.
    if ',' in raw and '.' in raw:
        raw=raw.replace('.','').replace(',','.') if raw.rfind(',')>raw.rfind('.') else raw.replace(',','')
    else: raw=raw.replace(',','.')
    try: v=Decimal(raw)
    except (InvalidOperation,ValueError): raise ValueError('Medição inválida. Exemplos: 1500,5 ou 1.25.')
    if not v.is_finite() or not Decimal('0')<v<=Decimal('1000000000'):
        raise ValueError('A medição deve ser maior que zero.')
    if v.as_tuple().exponent < -4:
        raise ValueError('Use no máximo quatro casas decimais para a medição.')
    return v

def make_pdf(path,osn,date,qtd,recs,prestador,book_type='poda',unit='un'):
    is_faixa=book_type=='limpeza_faixa'
    W,H=A4;L=8;R=W-8;T=H-8;split=L+(R-L)*.605;title=22;rh=22
    c=canvas.Canvas(str(path),pagesize=A4)
    for row in recs:
        c.rect(L,L,R-L,T-L);a=T-title;c.line(L,a,R,a)
        title_string='Book fotográfico - Limpeza de Faixa' if is_faixa else 'Book fotográfico'
        _text(c,(L+R)/2,a+6,title_string,12,True,True)
        b=a-rh;c.line(L,b,R,b)
        _text(c,L+25,b+7,'OS:',9,True)
        _text(c,L+55,b+7,osn,9,True,maxwidth=split-L-55)
        _text(c,R-150,b+7,'DATA:',9,True)
        _text(c,R-105,b+7,date,9,True)
        y=b-rh;c.line(L,y,R,y);c.line(split,b,split,y)
        _text(c,L+15,y+7,f'PRESTADOR: {prestador}',9,True,maxwidth=split-L-25)
        if is_faixa:
            _text(c,split+11,y+7,'MEDIÇÃO:',8,True)
            _text(c,split+87,y+7,format_measure(qtd)+' '+MEASURE_UNITS[unit],9,True,maxwidth=R-split-94)
            ny=y-rh;c.line(L,ny,R,ny);c.line(split,y,split,ny)
            _text(c,L+15,ny+7,'EQUIPE: ENG LFCG02',9,True)
            _text(c,split+11,ny+7,'UNIDADE: '+MEASURE_UNITS[unit],9,True)
            y=ny
        else:
            _text(c,split+12,y+7,'QNT DE PODAS:',9,True)
            _text(c,split+125,y+7,str(qtd),9,True)
        sec=(y-L)/2
        for k,(lab,img) in enumerate((('ANTES:',row['antes']),('DEPOIS:',row['depois']))):
            top=y-k*sec;bot=y-(k+1)*sec;hh=18
            c.line(L,bot,R,bot);c.line(split,top,split,bot);c.line(L,top-hh,R,top-hh)
            _text(c,(L+split)/2,top-hh+5,'EVIDÊNCIA FOTOGRÁFICA',9,True,True)
            _text(c,(split+R)/2,top-hh+5,'OBSERVAÇÃO',9,True,True)
            _image_fit(c,img,L+3,bot+3,split-L-6,top-hh-bot-6)
            cx=(split+R)/2
            labels=[lab,'RELIGADOR:','TD:','BAIRRO:','RUA/AVENIDA:','COORDENADAS:']
            values=['',row.get('rd',''),row.get('td',''),row.get('bairro',''),row.get('rua',''),row.get('coord','')]
            positions=[top-hh-16,top-hh-48,top-hh-92,top-hh-137,top-hh-182,top-hh-227]
            if is_faixa and row.get('measure'):
                labels.append('MEDIÇÃO DO TRECHO:')
                values.append(format_measure(row['measure'])+' '+MEASURE_UNITS[unit])
                positions.append(top-hh-268)
            for yy,lb,v in zip(positions,labels,values):
                _text(c,cx,yy,lb,9,True,True)
                if v:_text(c,cx,yy-13,v,7,False,True,maxwidth=R-split-10)
        c.showPage()
    c.save()

def local_media(ref):
    """Aceita somente caminhos virtuais de arquivos previamente enviados."""
    if not isinstance(ref,str) or not ref.startswith('/media/'):return None
    name=ref.split('/')[-1]
    if not re.fullmatch(r'[a-f0-9]{32}\.(jpg|jpeg|png|webp|bmp)',name,re.I):return None
    p=UPLOADS/name
    return p if p.is_file() else None

def create_book(payload):
    with LOCK:
        book_type=str(payload.get('book_type') or 'poda').strip()
        if book_type not in BOOK_TYPES: raise ValueError('Tipo de Book não reconhecido.')
        is_faixa=book_type=='limpeza_faixa'
        unit=str(payload.get('unit') or ('m2' if is_faixa else 'un')).strip()
        if is_faixa and unit not in MEASURE_UNITS:raise ValueError('Selecione a unidade m² ou km.')
        if not is_faixa:unit='un'
        date=date_parse(payload.get('date',''));day=date.strftime('%d/%m/%Y')
        osn=normalize_os(payload.get('os',''))
        recs=payload.get('records',[])
        if not isinstance(recs,list) or not 1<=len(recs)<=200:
            raise ValueError('Adicione de 1 a 200 evidências fotográficas.')
        if is_faixa:
            measurements=[parse_measure(r.get('measure')) for r in recs if isinstance(r,dict) and str(r.get('measure','')).strip()]
            total_measure=sum(measurements,Decimal(0))
            raw_total=payload.get('qtd')
            if str(raw_total if raw_total is not None else '').strip():
                qtd=parse_measure(raw_total)
                if len(measurements)==len(recs) and qtd!=total_measure:
                    raise ValueError('O total informado é diferente da soma das medições dos trechos.')
            elif len(measurements)==len(recs): qtd=total_measure
            else: raise ValueError('Informe a medição total ou a medição de todos os trechos.')
        else:
            try:qtd=int(payload.get('qtd') or len(recs))
            except (TypeError,ValueError):raise ValueError('Quantidade de podas inválida.')
            if qtd<1:raise ValueError('Informe a quantidade de podas.')
        config=get_settings();year=str(date.year);month=f'{date.month:02d} - {MONTHS[date.month-1]}'
        folder=(Path(config['output_dir']).expanduser().resolve()/year/month)
        folder.mkdir(parents=True,exist_ok=True)
        filename=f'BOOK-{BOOK_TYPES[book_type]["filename_team"]}-{osn}-{year}.pdf'
        target=folder/filename
        if target.exists():raise FileExistsError(f'Já existe um Book {BOOK_TYPES[book_type]["name"]} para a OS {osn} em {year}/{month}. O PDF não foi sobrescrito.')
        media_folder=folder/(f'FOTOS-{osn}-{year}' if not is_faixa else f'FOTOS-LFCG02-{osn}-{year}')
        prepared=[];saved_refs=[]
        try:
            media_folder.mkdir(exist_ok=True)
            for row in recs:
                if not isinstance(row,dict):raise ValueError('Registro inválido.')
                coord=str(row.get('coord','')).strip()
                parse_coord(coord)
                newrow={k:str(row.get(k,'')).strip() for k in ('coord','rua','bairro','td','rd')}
                if is_faixa and str(row.get('measure','')).strip():
                    newrow['measure']=str(parse_measure(row['measure']))
                for side in ('antes','depois'):
                    src=local_media(str(row.get(side,'')))
                    if src is None:raise ValueError('Cada evidência precisa das fotos ANTES e DEPOIS.')
                    dst=media_folder/(uuid.uuid4().hex+src.suffix.lower())
                    shutil.copyfile(src,dst);saved_refs.append(dst)
                    newrow[side]=str(dst)
                prepared.append(newrow)
            prefix=config.get('os_prefix_faixa','') if is_faixa else config['os_prefix']
            os_display=(prefix+' ' if prefix else '')+osn
            make_pdf(target,os_display,day,qtd,prepared,config['prestador'],book_type,unit)
        except Exception:
            if target.exists():target.unlink()
            for p in saved_refs:p.unlink(missing_ok=True)
            try:media_folder.rmdir()
            except OSError:pass
            raise
        now=dt.datetime.now().strftime('%d/%m/%Y %H:%M')
        saved={'os':osn,'date':day,'qtd':str(qtd) if is_faixa else qtd,'book_type':book_type,'unit':unit,'team':BOOK_TYPES[book_type]['team'],'records':prepared}
        with sqlite3.connect(BOOKS_DB) as db:
            cur=db.execute('INSERT INTO books(os,data,qtd,filename,path,created,payload,tipo,unidade) VALUES(?,?,?,?,?,?,?,?,?)',
                           (osn,day,float(qtd) if is_faixa else qtd,filename,str(target),now,json.dumps(saved,ensure_ascii=False),book_type,unit))
            ident=cur.lastrowid
        DRAFT.write_text('{}',encoding='utf-8')
        return {'id':ident,'os':osn,'date':day,'qtd':saved['qtd'],'book_type':book_type,'unit':unit,
                'team':saved['team'],'filename':filename,'folder':str(folder),
                'relative_folder':f'{year}/{month}','pdf_url':f'/api/books/{ident}/pdf'}

def list_books(search=''):
    with sqlite3.connect(BOOKS_DB) as db:
        db.row_factory=sqlite3.Row
        q='SELECT id,os,data,qtd,filename,path,created,tipo,unidade FROM books'
        if search:rows=db.execute(q+' WHERE os LIKE ? ORDER BY id DESC LIMIT 300',(f'%{search}%',)).fetchall()
        else:rows=db.execute(q+' ORDER BY id DESC LIMIT 300').fetchall()
        return [dict(r) for r in rows]

def get_book(ident):
    with sqlite3.connect(BOOKS_DB) as db:
        db.row_factory=sqlite3.Row
        row=db.execute('SELECT * FROM books WHERE id=?',(ident,)).fetchone()
    if not row:return None
    out=dict(row);out['payload']=json.loads(out['payload']);return out

def load_draft():
    try:return json.loads(DRAFT.read_text(encoding='utf-8'))
    except (OSError,ValueError):return {}

def save_draft(payload):
    if not isinstance(payload,dict):raise ValueError('Rascunho inválido.')
    DRAFT.write_text(json.dumps(payload,ensure_ascii=False)[:500000],encoding='utf-8')
    return {'ok':True}

def sheet_os(force=False):
    with LOCK:
        if OS_CACHE.exists() and not force:
            try:
                cache=json.loads(OS_CACHE.read_text(encoding='utf-8'))
                last=dt.datetime.fromisoformat(cache['time'])
                if (dt.datetime.now()-last).total_seconds()<3600:return cache
            except (OSError,ValueError,KeyError):pass
        try:
            url=f'https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq?tqx=out:csv&sheet=Respostas'
            req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0 BookPodaLocal','Accept':'text/csv,*/*'})
            with urllib.request.urlopen(req,timeout=12) as r:raw=r.read(3_000_000).decode('utf-8-sig','replace')
            if '<html' in raw[:500].lower():raise ValueError('Planilha exige autenticação.')
            grouped={}
            for r in list(csv.reader(io.StringIO(raw)))[1:]:
                if len(r)<7:continue
                osn,code,qty=r[2].strip(),r[4].strip(),r[6].strip()
                if not osn or code not in ('21307','21308'):continue
                try:q=int(round(float(qty.replace(' ','').replace(',','.'))))
                except ValueError:continue
                g=grouped.setdefault(osn,{'21307':0,'21308':0})
                g[code]+=q
            rows=[{'os':o,'21307':v['21307'],'21308':v['21308'],'total':v['21307']+v['21308']} for o,v in sorted(grouped.items())]
            result={'rows':rows,'time':dt.datetime.now().isoformat(),'cached':False}
            OS_CACHE.write_text(json.dumps(result,ensure_ascii=False),encoding='utf-8')
            return result
        except Exception as exc:
            try:
                result=json.loads(OS_CACHE.read_text(encoding='utf-8'))
                result['cached']=True;result['warning']=str(exc);return result
            except (OSError,ValueError):raise RuntimeError(f'Não foi possível acessar a planilha: {exc}')
