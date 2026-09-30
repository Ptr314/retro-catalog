"""
Shared plumbing for importers that write straight into the catalog's SQLite database
and its data/files, data/screenshots directories. Standard library only.

The server (TypeScript) owns the schema and the naming rules; this module repeats a few
of them, because an importer runs without the server. Each copy names its original —
when one side changes, change the other:

    slugify, safe_file_name, is_safe_name, detect_image   <- http.ts
    parse_metadata, metadata_search_text                  <- metadata.ts
    haystack / rebuild_search_text                        <- db.ts
    slug_taken, sync_cover                                <- db.ts
    stored names ({id}-name, {id}-e{emu}-name, p{id}-hex) <- server.ts

Writes are grouped with begin() / commit() / rollback(). Files written inside a unit
are removed again on rollback; files it replaces are unlinked only after the commit,
so a failed record leaves both the database and the disk as they were.
"""
import json
import os
import re
import secrets
import sqlite3
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# The schema version this module was written against (PRAGMA user_version, see db.ts).
REQUIRED_VERSION = 7

TRANSLIT = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e', 'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y',
    'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f',
    'х': 'h', 'ц': 'c', 'ч': 'ch', 'ш': 'sh', 'щ': 'sch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
}

SLUG_MAX = 80


class CatalogError(Exception):
    """Something the operator has to fix; the message is shown as is."""


# ------------------------------------------------------------------ configuration


def load_config():
    """config.json next to the sources, or {} — the same file the server reads."""
    path = ROOT / 'config.json'
    if not path.exists():
        return {}
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def data_dir(config):
    """DATA_DIR, else config.json's dataDir, else <repo>/data — as config.ts resolves it."""
    value = os.environ.get('DATA_DIR') or config.get('dataDir') or 'data'
    path = Path(value)
    return path if path.is_absolute() else (ROOT / path).resolve()


def now_iso():
    """The shape of JavaScript's Date.toISOString(), which the server writes everywhere."""
    now = datetime.now(timezone.utc)
    return now.strftime('%Y-%m-%dT%H:%M:%S.') + '%03dZ' % (now.microsecond // 1000)


# ------------------------------------------------------- names: ports from http.ts


def slugify(value):
    text = ''.join(TRANSLIT.get(ch, ch) for ch in value.lower())
    return re.sub(r'[^a-z0-9]+', '-', text).strip('-')[:SLUG_MAX]


def safe_file_name(original, max_length=100):
    """The file's own name made safe for a path and a URL; case and every dot survive."""
    base = original.replace('\\', '/').split('/')[-1]
    out = []
    for ch in unicodedata.normalize('NFC', base):
        latin = TRANSLIT.get(ch.lower())
        if latin is None:
            out.append(ch)
        elif ch == ch.lower():
            out.append(latin)
        else:
            out.append(latin[:1].upper() + latin[1:])
    name = ''.join(out)
    name = re.sub(r'[^A-Za-z0-9._-]+', '-', name)
    name = re.sub(r'-{2,}', '-', name)
    name = re.sub(r'-*\.-*', '.', name)
    name = re.sub(r'\.{2,}', '.', name)
    name = re.sub(r'^[.-]+|[.-]+$', '', name)
    if len(name) > max_length:
        dot = name.find('.')
        extensions = name[dot:] if dot > 0 and len(name) - dot <= 30 else ''
        name = re.sub(r'[.-]+$', '', name[:max_length - len(extensions)]) + extensions
    return name or 'file'


def is_safe_name(name):
    return bool(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,120}', name)) and '..' not in name


def detect_image(data):
    """The extension by the file's magic bytes, or None when it is not a picture we serve."""
    if len(data) < 12:
        return None
    if data[:4] == b'\x89PNG':
        return '.png'
    if data[:3] == b'\xff\xd8\xff':
        return '.jpg'
    if data[:4] == b'GIF8':
        return '.gif'
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        return '.webp'
    return None


# ---------------------------------------------------- metadata: ports from metadata.ts


def parse_metadata(text):
    out = {}
    for line in (text or '').splitlines():
        key, colon, value = line.partition(':')
        key, value = key.strip().lower(), value.strip()
        if colon and key and value:
            out[key] = value
    return out


def format_metadata(pairs):
    """[(key, value)] -> "key:value" lines; empty values are left out, newlines flattened."""
    lines = []
    for key, value in pairs:
        if value is None:
            continue
        value = re.sub(r'\s+', ' ', str(value)).strip()
        if value:
            lines.append('%s:%s' % (key, value))
    return '\n'.join(lines)


def metadata_search_text(text):
    return ' '.join(v for v in parse_metadata(text).values() if not re.match(r'https?://', v, re.I))


# --------------------------------------------------------------------- the catalog


class Catalog:
    def __init__(self, read_only=False):
        self.config = load_config()
        self.data_dir = data_dir(self.config)
        self.files_dir = self.data_dir / 'files'
        self.screenshots_dir = self.data_dir / 'screenshots'
        self.read_only = read_only
        self.max_file_bytes = int(self.config.get('maxFileBytes', 64 * 1024 * 1024))
        self.max_screenshot_bytes = int(self.config.get('maxScreenshotBytes', 2 * 1024 * 1024))

        db_path = self.data_dir / 'catalog.db'
        if not db_path.exists():
            raise CatalogError('База %s не найдена. Запустите сервер один раз: он её создаст.' % db_path)
        uri = db_path.as_uri() + ('?mode=ro' if read_only else '')
        # isolation_level=None: transactions are opened and closed by hand, as in db.ts.
        self.db = sqlite3.connect(uri, uri=True, isolation_level=None, timeout=5)
        self.db.row_factory = sqlite3.Row
        self.db.execute('PRAGMA busy_timeout = 5000')
        self.db.execute('PRAGMA foreign_keys = ON')  # off by default in sqlite3, on in the server

        version = self.db.execute('PRAGMA user_version').fetchone()[0]
        if version < REQUIRED_VERSION:
            raise CatalogError(
                'Схема базы версии %d, нужна %d. Перезапустите сервер — он применит миграции.'
                % (version, REQUIRED_VERSION))

        if not read_only:
            self.files_dir.mkdir(parents=True, exist_ok=True)
            self.screenshots_dir.mkdir(parents=True, exist_ok=True)
        self._written = []   # paths created inside the open unit
        self._doomed = []    # paths to unlink once it commits

    def close(self):
        self.db.close()

    # ----------------------------------------------------------- units of work

    def begin(self):
        self._written, self._doomed = [], []
        self.db.execute('BEGIN IMMEDIATE')

    def commit(self):
        self.db.execute('COMMIT')
        for path in self._doomed:
            # On a case-insensitive disk the "old" name may be the file just written.
            if any(_same_file(path, new) for new in self._written):
                continue
            _unlink(path)
        self._written, self._doomed = [], []

    def rollback(self):
        if self.db.in_transaction:
            self.db.execute('ROLLBACK')
        for path in self._written:
            _unlink(path)
        self._written, self._doomed = [], []

    def _write(self, path, data):
        path.write_bytes(data)
        self._written.append(path)

    def _doom(self, path):
        self._doomed.append(path)

    # --------------------------------------------------------- reference tables

    def family_by_slug(self, slug):
        return self.db.execute('SELECT * FROM families WHERE slug = ?', (slug,)).fetchone()

    def models_by_slug(self, family_id):
        rows = self.db.execute('SELECT id, slug FROM models WHERE family_id = ?', (family_id,)).fetchall()
        return {row['slug']: row['id'] for row in rows}

    def emulator_by_name(self, name):
        rows = self.db.execute('SELECT * FROM emulators ORDER BY sort_order, id').fetchall()
        return next((row for row in rows if row['name'].lower() == name.lower()), None)

    def find_category(self, name, parent_id=None):
        """Case-insensitive, inside one parent. Compared here: SQLite's lower() is ASCII-only."""
        rows = self.db.execute('SELECT id, name, parent_id FROM categories').fetchall()
        for row in rows:
            if (row['parent_id'] or None) == parent_id and row['name'].lower() == name.lower():
                return row['id']
        return None

    def create_category(self, name, parent_id=None):
        ts = now_iso()
        cur = self.db.execute(
            'INSERT INTO categories (parent_id, name, sort_order, created_at, updated_at) '
            'VALUES (?, ?, COALESCE((SELECT MAX(sort_order) FROM categories), 0) + 10, ?, ?)',
            (parent_id, name[:120], ts, ts))
        return cur.lastrowid

    # ----------------------------------------------------------------- programs

    def find_program(self, integration, external_id):
        return self.db.execute(
            'SELECT * FROM programs WHERE integration = ? AND external_id = ?',
            (integration, external_id)).fetchone()

    def integration_programs(self, integration):
        return self.db.execute(
            'SELECT id, slug, title, external_id, metadata, published, missing_since '
            'FROM programs WHERE integration = ?', (integration,)).fetchall()

    def slug_taken(self, slug, except_id=0):
        """By a program or by any model: both answer at /<family>/<slug> (db.ts#slugTaken)."""
        if self.db.execute('SELECT 1 FROM programs WHERE slug = ? AND id <> ?', (slug, except_id)).fetchone():
            return True
        return self.db.execute('SELECT 1 FROM models WHERE slug = ?', (slug,)).fetchone() is not None

    def insert_program(self, fields):
        ts = now_iso()
        row = dict(fields, created_at=ts, updated_at=ts)
        columns = list(row)
        cur = self.db.execute(
            'INSERT INTO programs (%s) VALUES (%s)' % (', '.join(columns), ', '.join('?' for _ in columns)),
            [row[c] for c in columns])
        return cur.lastrowid

    def update_program(self, program_id, fields):
        row = dict(fields, updated_at=now_iso())
        columns = list(row)
        self.db.execute(
            'UPDATE programs SET %s WHERE id = ?' % ', '.join('%s = ?' % c for c in columns),
            [row[c] for c in columns] + [program_id])

    def set_models(self, program_id, model_ids):
        self.db.execute('DELETE FROM program_models WHERE program_id = ?', (program_id,))
        for model_id in model_ids:
            self.db.execute(
                'INSERT OR IGNORE INTO program_models (program_id, model_id) VALUES (?, ?)', (program_id, model_id))

    # -------------------------------------------------------------------- files

    def stored_name(self, prefix, original):
        name = '%s-%s' % (prefix, safe_file_name(original))
        return name if is_safe_name(name) else '%s-file' % prefix

    def set_main_file(self, program_id, original, data):
        """The download behind /dl/<slug>. Returns the stored name."""
        previous = self.db.execute('SELECT file_name FROM programs WHERE id = ?', (program_id,)).fetchone()[0]
        name = self.stored_name(str(program_id), original)
        if previous.lower() == name.lower():
            name = previous  # same file on a case-insensitive disk: overwrite it under its own name
        self._write(self.files_dir / name, data)
        if previous and previous != name:
            self._doom(self.files_dir / previous)
        self.db.execute(
            'UPDATE programs SET file_name = ?, file_size = ? WHERE id = ?', (name, len(data), program_id))
        return name

    def emulator_slot(self, program_id, emulator_id):
        return self.db.execute(
            'SELECT * FROM program_emulator_files WHERE program_id = ? AND emulator_id = ?',
            (program_id, emulator_id)).fetchone()

    def set_emulator_file(self, program_id, emulator_id, original, data):
        """The package one emulator launches. A typed launch address and the run counter are kept."""
        slot = self.emulator_slot(program_id, emulator_id)
        previous = slot['file_name'] if slot else ''
        name = self.stored_name('%d-e%d' % (program_id, emulator_id), original)
        if previous.lower() == name.lower():
            name = previous
        self._write(self.files_dir / name, data)
        if previous and previous != name:
            self._doom(self.files_dir / previous)
        self.db.execute(
            'INSERT INTO program_emulator_files (program_id, emulator_id, file_name, file_size, updated_at) '
            'VALUES (?, ?, ?, ?, ?) '
            'ON CONFLICT (program_id, emulator_id) DO UPDATE SET '
            'file_name = excluded.file_name, file_size = excluded.file_size, updated_at = excluded.updated_at',
            (program_id, emulator_id, name, len(data), now_iso()))
        return name

    def clear_emulator_file(self, program_id, emulator_id):
        slot = self.emulator_slot(program_id, emulator_id)
        if not slot or not slot['file_name']:
            return
        self._doom(self.files_dir / slot['file_name'])
        self.db.execute(
            "UPDATE program_emulator_files SET file_name = '', file_size = NULL, updated_at = ? "
            'WHERE program_id = ? AND emulator_id = ?', (now_iso(), program_id, emulator_id))
        # A row with neither a file nor an address would still draw a launch button.
        self.db.execute(
            "DELETE FROM program_emulator_files WHERE program_id = ? AND emulator_id = ? "
            "AND file_name = '' AND file_url = ''", (program_id, emulator_id))

    # -------------------------------------------------------------- screenshots

    def screenshots(self, program_id):
        return self.db.execute(
            'SELECT * FROM program_screenshots WHERE program_id = ? ORDER BY sort_order, id',
            (program_id,)).fetchall()

    def add_screenshot(self, program_id, data, ext, source_url, sort_order):
        name = 'p%d-%s%s' % (program_id, secrets.token_hex(4), ext)
        self._write(self.screenshots_dir / name, data)
        self.db.execute(
            'INSERT INTO program_screenshots (program_id, file_name, sort_order, source_url, created_at) '
            'VALUES (?, ?, ?, ?, ?)', (program_id, name, sort_order, source_url, now_iso()))
        return name

    def delete_screenshot(self, row):
        self._doom(self.screenshots_dir / row['file_name'])
        self.db.execute('DELETE FROM program_screenshots WHERE id = ?', (row['id'],))

    def set_screenshot_order(self, screenshot_id, sort_order):
        self.db.execute('UPDATE program_screenshots SET sort_order = ? WHERE id = ?', (sort_order, screenshot_id))

    def sync_cover(self, program_id):
        """programs.screenshot mirrors the first screenshot (db.ts#syncCover)."""
        self.db.execute(
            "UPDATE programs SET screenshot = COALESCE((SELECT file_name FROM program_screenshots "
            "WHERE program_id = ? ORDER BY sort_order, id LIMIT 1), '') WHERE id = ?", (program_id, program_id))

    # -------------------------------------------------------------- search text

    def rebuild_search_text(self, program_id):
        """
        The LIKE haystack (db.ts#haystack: same parts, same order). Lowercased here and not
        in SQL for the server's reason: SQLite's lower() leaves Cyrillic as it is.
        """
        row = self.db.execute(
            'SELECT p.title, p.author, p.year, p.description, p.author_wanted, p.graphics, p.music, p.metadata, '
            '       f.name AS family_name, c.name AS category_name, pc.name AS category_parent_name, '
            "       (SELECT group_concat(m.name, ' ') FROM program_models pm JOIN models m ON m.id = pm.model_id "
            '         WHERE pm.program_id = p.id) AS model_names '
            '  FROM programs p '
            '  JOIN families f ON f.id = p.family_id '
            '  LEFT JOIN categories c ON c.id = p.category_id '
            '  LEFT JOIN categories pc ON pc.id = c.parent_id '
            ' WHERE p.id = ?', (program_id,)).fetchone()
        parts = [
            row['title'],
            row['author'],
            str(row['year']) if row['year'] else '',
            row['family_name'],
            row['category_parent_name'] or '',
            row['category_name'] or '',
            row['model_names'] or '',
            row['description'],
            'разыскивается автор' if row['author_wanted'] else '',
            row['graphics'],
            row['music'],
            metadata_search_text(row['metadata']),
        ]
        self.db.execute('UPDATE programs SET search_text = ? WHERE id = ?', (' '.join(parts).lower(), program_id))


def _unlink(path):
    try:
        os.unlink(path)
    except OSError:
        pass


def _same_file(a, b):
    return str(a).lower() == str(b).lower()
