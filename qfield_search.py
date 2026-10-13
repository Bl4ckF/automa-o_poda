"""Pesquisa offline de equipamentos (TD/RD) nas bases locais do Book Poda."""
import json
import re
import sqlite3
from pathlib import Path


def _normalize(value):
    return re.sub(r'[^A-Z0-9]', '', str(value or '').upper())


class EquipmentSearch:
    def __init__(self, files=None, use_bundle=True):
        index = Path(__file__).resolve().parent / 'qfield_equipment_index.json'
        if use_bundle and index.exists():
            rows = json.loads(index.read_text(encoding='utf-8'))
        else:
            rows = self.read_geopackages(files or [])
        self.rows = rows
        self.by_code = {}
        self.by_number = {}
        for item in rows:
            kind, code, *_ = item
            c = _normalize(code)
            num = c[2:] if c.startswith(('TD','RD')) else c
            self.by_code.setdefault(c, []).append(item)
            self.by_number.setdefault(num, []).append(item)

    @staticmethod
    def read_geopackages(files):
        out, seen = [], set()
        for path in files:
            try:
                con = sqlite3.connect(f'file:{Path(path).resolve()}?mode=ro', uri=True)
                try:
                    for table, kind in (('transformador', 'TD'), ('religador', 'RD')):
                        for code, lon, lat, circ in con.execute(
                            f'SELECT numero_operativo,longitude,latitude,circuito FROM "{table}" '
                            'WHERE numero_operativo IS NOT NULL AND longitude IS NOT NULL AND latitude IS NOT NULL'
                        ):
                            try:
                                x, y = float(lon), float(lat)
                                if not (-180<=x<=180 and -90<=y<=90): continue
                                code = str(code).strip()
                                ident = (kind, _normalize(code), round(y, 6), round(x, 6))
                                if not code or ident in seen: continue
                                seen.add(ident)
                                out.append([kind, code, y, x, str(circ or '')])
                            except (ValueError, TypeError):
                                continue
                finally:
                    con.close()
            except (sqlite3.Error, OSError):
                continue
        return out

    def find(self, text, limit=30):
        raw = _normalize(text)
        if not raw: return []
        kind = None
        if raw.startswith('TRAFO'):
            kind='TD';raw=raw[5:]
        elif raw.startswith('TRANSFORMADOR'):
            kind='TD';raw=raw[13:]
        elif raw.startswith('RELIGADOR'):
            kind='RD';raw=raw[9:]
        elif raw.startswith(('TD','RD')):
            kind=raw[:2];raw=raw[2:]
        if not raw:return []
        hits = self.by_number.get(raw, [])
        if not hits and len(raw)>=3:
            # Apenas prefixos do número. Limite protege contra buscas amplas.
            hits=[]
            for code, rows in self.by_number.items():
                if code.startswith(raw):
                    hits.extend(rows)
                    if len(hits)>=limit:break
        if kind: hits=[r for r in hits if r[0]==kind]
        return hits[:limit]
