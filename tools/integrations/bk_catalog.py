"""
Import from BK Catalog (https://kalininskiy.github.io/bk-catalog/), integration "bk-catalog".

    py tools/integrations/bk_catalog.py [--file PATH] [--limit N] [--test]
                                        [--only games,software,demoscene] [--quiet] [--allow-mass-unpublish]

  --file     read the catalog from a local copy instead of the network: a zip with
             games.json / software.json / demoscene.json, or a directory holding them.
             Without it the three files are fetched from the catalog's site —
             integrations["bk-catalog"].source in config.json, by default
             https://kalininskiy.github.io/bk-catalog/content/ (a base URL the files
             hang off; the URL of a zip works too).
  --limit    stop after N records (games first, then software, then demoscene).
  --test     walk the data and print what would happen; no program file or screenshot
             is downloaded and the database is opened read-only. (The catalog itself,
             three JSON files, is still fetched unless --file is given.)
  --only     process only these sections.
  --quiet    no line per record: only the summary at the end (what was created, what
             went wrong, what to look at). Meant for a full --test pass.

A record is matched by its ID (programs.integration + external_id). A new one is created
with its file and screenshots copied to us; an existing one is touched only when the
source record changed since the last import (programs.source_hash), so edits made in the
admin survive. slug, promoted and the counters are never changed. A program that
vanished from the source is unpublished and marked (programs.missing_since) — once;
the admin decides what to do next.

Families, models and emulators are never created: config.json names existing ones by
slug (the emulator by name). Categories and subcategories (genres) are created on demand.
"""
import argparse
import hashlib
import io
import json
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from catalog_db import (  # noqa: E402
    ROOT, SLUG_MAX, Catalog, CatalogError, detect_image, format_metadata, now_iso, parse_metadata, slugify,
)

INTEGRATION = 'bk-catalog'

# Part of every record's hash: bump it when the mapping below changes, and the next run
# rewrites every imported program instead of skipping the "unchanged" ones.
MAPPING_VERSION = 1

# The section files, in processing order.
SECTIONS = ['games', 'software', 'demoscene']

# Section -> where its programs go (integrations["bk-catalog"].categories in config.json
# replaces these per section). A rule is either one category name for the whole section,
# or a table genre -> target with "*" for every genre it does not list. A target is:
#     "Категория"          the genre becomes a subcategory of it, created on demand
#     "Категория/"         straight into the category, no subcategory
#     "Категория/Название" a subcategory under another name than the source's genre
# Categories and subcategories are found by name, case-insensitively.
DEFAULT_CATEGORIES = {
    'games': 'Игра',
    'demoscene': 'Демо',
    'software': {
        'Операционная система': 'ОС/',
        'Ассемблер': 'Программирование',
        'Дизассемблер': 'Программирование',
        'Отладчик': 'Программирование',
        'Язык программирования': 'Программирование',
        '*': 'Прикладное ПО',
    },
}

DEFAULTS = {
    'source': 'https://kalininskiy.github.io/bk-catalog/content/',
    'family': 'bk',
    'emulator': 'BK (bk-catalog)',
    'categories': DEFAULT_CATEGORIES,
    # «Платформа» -> slugs of models of that family. A platform that is absent here
    # (Windows, MS-DOS, AZБК) leaves the program without a model.
    'models': {
        'БК0010': ['bk-0010'],
        'БК0010 ФОКАЛ': ['bk-0010'],
        'БК0010-01': ['bk-0010-01'],
        'БК0010-01 БЕЙСИК': ['bk-0010-01'],
        'БК0010 (11М)': ['bk-0010', 'bk-0011m'],
        'БК0011 БЕЙСИК': ['bk-0011'],
        'БК0011 ФОКАЛ': ['bk-0011'],
        'БК0011М': ['bk-0011m'],
        'БК0011М + СМК512': ['bk-0011m'],
    },
}

# What the bk-catalog emulator can load by URL. It unpacks zip itself; 7z and rar it cannot.
RUNNABLE_EXTENSIONS = ('.zip', '.bin', '.img', '.bkd')
# Software for the PC that merely deals with BK files: nothing to launch in a BK emulator.
NOT_BK_PLATFORMS = ('Windows', 'MS-DOS')

MAX_FILES = 5
MAX_SCREENSHOTS = 12
USER_AGENT = 'retro-catalog-import/1 (+bk-catalog integration)'


def log(message):
    print(message, flush=True)


# ------------------------------------------------------------------------ fetching


def fetch(url, limit, attempts=3):
    """The body of url, or raises. Spaces and Cyrillic in the path are escaped first."""
    quoted = urllib.parse.quote(url, safe=":/?&=%+,;@()!~*'#[]")
    request = urllib.request.Request(quoted, headers={'User-Agent': USER_AGENT})
    last = None
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                data = response.read(limit + 1)
            if len(data) > limit:
                raise CatalogError('больше %d байт: %s' % (limit, url))
            return data
        except urllib.error.HTTPError as err:
            if err.code in (403, 404, 410):
                raise CatalogError('HTTP %d: %s' % (err.code, url))
            last = err
        except (urllib.error.URLError, TimeoutError, ConnectionError) as err:
            last = err
        time.sleep(1 + attempt * 2)
    raise CatalogError('не скачалось (%s): %s' % (last, url))


def load_source(source, only):
    """{section: [records]} from a zip, a directory, a zip URL or a base URL."""
    names = [name for name in SECTIONS if name in only]
    is_url = bool(re.match(r'https?://', source, re.I))

    def from_zip(data):
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            by_base = {entry.rsplit('/', 1)[-1]: entry for entry in archive.namelist()}
            out = {}
            for name in names:
                entry = by_base.get(name + '.json')
                if entry is None:
                    raise CatalogError('В архиве нет %s.json' % name)
                out[name] = json.loads(archive.read(entry).decode('utf-8-sig'))
            return out

    if is_url:
        if urllib.parse.urlparse(source).path.lower().endswith('.zip'):
            return from_zip(fetch(source, 256 * 1024 * 1024))
        base = source.rstrip('/')
        return {name: json.loads(fetch('%s/%s.json' % (base, name), 256 * 1024 * 1024).decode('utf-8-sig'))
                for name in names}

    path = Path(source)
    if not path.is_absolute():
        path = ROOT / path
    if path.is_dir():
        out = {}
        for name in names:
            file = path / (name + '.json')
            if not file.exists():
                raise CatalogError('Нет файла %s' % file)
            out[name] = json.loads(file.read_text(encoding='utf-8-sig'))
        return out
    if not path.exists():
        raise CatalogError('Источник не найден: %s' % path)
    return from_zip(path.read_bytes())


# ------------------------------------------------------------------------- mapping


def text(value):
    return value.strip() if isinstance(value, str) else ('' if value is None else str(value).strip())


def http_url(value):
    value = text(value)
    return value[:500] if re.match(r'https?://', value, re.I) else ''


def url_file_name(url):
    return urllib.parse.unquote(urllib.parse.urlparse(url).path.rsplit('/', 1)[-1]) or 'file'


def map_record(record, section):
    """Everything a program takes from one source record. No database, no network."""
    files = []
    for i in range(1, MAX_FILES + 1):
        url = http_url(record.get('Имя файла %d' % i))
        if url:
            files.append((i, url, text(record.get('Описание файла %d' % i))))

    screenshots = []
    for i in range(1, MAX_SCREENSHOTS + 1):
        url = http_url(record.get('Скриншот %d' % i))
        if url and url not in screenshots:
            screenshots.append(url)

    platform = text(record.get('Платформа'))
    genres = [g.strip() for g in text(record.get('Жанр')).split(',') if g.strip()]
    year = record.get('Год выпуска')

    metadata = [
        ('platform', platform),
        ('section', section),
        ('publisher', record.get('Издатель')),
        ('genres', ', '.join(genres)),
        ('language', record.get('Язык интерфейса')),
        ('released', record.get('Дата выхода')),
        ('added', record.get('Дата добавления')),
        ('party', record.get('Демопати')),
        ('compo', record.get('Компо')),
        ('place', record.get('Место')),
        ('video', record.get('Видео')),
        ('sources', record.get('Исходники')),
        ('github', record.get('ГитХаб')),
    ]
    for i, url, note in files:
        metadata.append(('file%d' % i, url))
        metadata.append(('file%d_note' % i, note))

    return {
        'external_id': str(record.get('ID')),
        'title': text(record.get('Название'))[:200],
        'author': text(record.get('Авторы'))[:120],
        'year': year if isinstance(year, int) and 1900 < year < 2200 else None,
        'description': text(record.get('Описание'))[:20000],
        'graphics': text(record.get('Графика'))[:200],
        'music': text(record.get('Музыка'))[:200],
        'source_url': http_url(record.get('Ссылка на страницу')) or http_url(record.get('ГитХаб')),
        'platform': platform,
        'genre': genres[0] if genres else '',
        'file_url': files[0][1] if files else '',
        'screenshots': screenshots,
        'metadata': format_metadata(metadata),
    }


def resolve_category(rule, genre):
    """(top-level category, subcategory or '') for one record, by its section's rule."""
    if isinstance(rule, dict):
        by_genre = {key.lower(): value for key, value in rule.items()}
        target = by_genre.get(genre.lower()) or by_genre.get('*')
        if not target:
            raise CatalogError('в настройке categories нет ни жанра «%s», ни правила "*"' % genre)
    else:
        target = rule
    top, slash, sub = target.partition('/')
    top, sub = top.strip(), sub.strip()
    if not top:
        raise CatalogError('пустое название категории в настройке categories: «%s»' % target)
    return top, (sub if slash else genre)


def runnable(mapped):
    """Can the bk-catalog emulator launch this program's first file?"""
    if not mapped['file_url'] or mapped['platform'] in NOT_BK_PLATFORMS:
        return False
    return url_file_name(mapped['file_url']).lower().endswith(RUNNABLE_EXTENSIONS)


def slug_candidates(mapped):
    """The title; then the title told apart by its first author, by its year; then by a number."""
    base = slugify(mapped['title']) or 'program-%s' % mapped['external_id']
    yield base
    author = re.sub(r'\(.*?\)', ' ', mapped['author'].split(',')[0])
    for extra in (author, str(mapped['year'] or '')):
        suffix = slugify(extra)
        if suffix:
            yield with_suffix(base, suffix)
    n = 2
    while True:
        yield with_suffix(base, str(n))
        n += 1


def with_suffix(base, suffix):
    """base-suffix within the slug limit: the base gives way, the suffix never does."""
    suffix = suffix[:SLUG_MAX // 2]
    return '%s-%s' % (base[:SLUG_MAX - len(suffix) - 1].rstrip('-'), suffix)


# ------------------------------------------------------------------------ the run


class Importer:
    def __init__(self, catalog, settings, args):
        self.catalog = catalog
        self.args = args
        self.test = args.test
        self.counts = {'created': 0, 'updated': 0, 'unchanged': 0, 'errors': 0, 'restored': 0, 'missing': 0}
        self.planned_slugs = set()        # --test: slugs "given out" earlier in this run

        # Everything below feeds the summary printed at the end (print_summary).
        self.setup_problems = []          # missing models, missing emulator
        self.errors = []                  # (label, message): the record was not imported
        self.skipped_shots = []           # (label, message): imported, minus a picture
        self.new_categories = {}          # (top, sub or '') -> programs put there in this run
        self.without_models = {}          # platform -> programs
        self.without_launch = {}          # reason -> programs
        self.without_genre = {}           # top category -> programs with no genre in the source
        self.without_shots = 0
        self.renamed_slugs = []           # (label, slug): the title's own slug was taken
        self.gone = []                    # labels marked as missing from the source

        family = catalog.family_by_slug(settings['family'])
        if family is None:
            raise CatalogError(
                'Семейство со slug «%s» не найдено. Создайте его в админке или исправьте '
                'integrations["%s"].family в config.json.' % (settings['family'], INTEGRATION))
        self.family = family

        # Platform -> model ids, resolved once. A slug with no model behind it is reported, not created.
        model_ids = catalog.models_by_slug(family['id'])
        self.platform_models = {}
        for platform, slugs in settings['models'].items():
            known = [model_ids[s] for s in slugs if s in model_ids]
            for s in slugs:
                if s not in model_ids:
                    self.setup_problems.append(
                        'модель «%s» (платформа «%s») не найдена в семействе «%s»' % (s, platform, family['name']))
            self.platform_models[platform] = known

        self.emulator = catalog.emulator_by_name(settings['emulator'])
        if self.emulator is None:
            self.setup_problems.append(
                'эмулятор «%s» не найден — программы импортируются без кнопки запуска' % settings['emulator'])
        for problem in self.setup_problems:
            log('! ' + problem)

        # What a record's hash depends on besides the record itself: when the admin adds
        # the missing model or emulator, "unchanged" programs must be revisited.
        self.context = json.dumps(
            [MAPPING_VERSION, family['id'], self.platform_models, self.emulator['id'] if self.emulator else 0,
             settings['categories']],
            sort_keys=True, ensure_ascii=False)

    def source_hash(self, record):
        body = json.dumps(record, sort_keys=True, ensure_ascii=False) + self.context
        return hashlib.sha256(body.encode('utf-8')).hexdigest()

    # ------------------------------------------------------------ reporting

    def say(self, line):
        """A per-record line; --quiet leaves only the summary."""
        if not self.args.quiet:
            log(line)

    def error(self, label, message):
        self.counts['errors'] += 1
        self.errors.append((label, str(message)))
        self.say('[ошибка] %s: %s' % (label, message))

    def launch_obstacle(self, mapped):
        """Why a program gets no launch button, in the operator's words."""
        if not mapped['file_url']:
            return 'в источнике нет файла'
        if self.emulator is None:
            return 'эмулятор не найден'
        if mapped['platform'] in NOT_BK_PLATFORMS:
            return 'программа для %s' % mapped['platform']
        name = url_file_name(mapped['file_url'])
        return 'формат %s эмулятор не открывает' % (Path(name).suffix.lower() or '(без расширения)')

    def note(self, mapped, label, top_category, source_genre, model_ids, launch, slug):
        """One created or updated program, for the summary."""
        def bump(table, key):
            table[key] = table.get(key, 0) + 1

        for key in ((top_category, ''), (top_category, mapped['genre'])):
            if key in self.new_categories:
                self.new_categories[key] += 1
        if not model_ids:
            bump(self.without_models, mapped['platform'] or '(платформа не указана)')
        if not launch:
            bump(self.without_launch, self.launch_obstacle(mapped))
        if not source_genre:
            bump(self.without_genre, top_category)
        if not mapped['screenshots']:
            self.without_shots += 1
        if slug and slug != (slugify(mapped['title']) or slug):
            self.renamed_slugs.append((label, slug))

    # ----------------------------------------------------------- one record

    def process(self, record, section, rule):
        mapped = map_record(record, section)
        label = '%s «%s»' % (mapped['external_id'], mapped['title'])
        source_genre = mapped['genre']
        try:
            # From here on "genre" is the subcategory's name as it will be on our side.
            top_category, mapped['genre'] = resolve_category(rule, mapped['genre'])
        except CatalogError as err:
            return self.error(label, err)
        if not mapped['title'] or mapped['external_id'] in ('None', ''):
            return self.error(label, 'нет ID или названия')

        digest = self.source_hash(record)
        existing = self.catalog.find_program(INTEGRATION, mapped['external_id'])
        restored = bool(existing and existing['missing_since'])
        if existing and existing['source_hash'] == digest and not restored:
            self.counts['unchanged'] += 1
            if self.args.verbose:
                self.say('[без изменений] %s' % label)
            return

        model_ids = self.platform_models.get(mapped['platform'], [])
        launch = self.emulator is not None and runnable(mapped)

        try:
            if self.test:
                slug = self.report_plan(existing, mapped, label, top_category, model_ids, launch, restored)
            elif existing:
                slug = self.update(existing, mapped, label, top_category, model_ids, launch, digest, restored)
            else:
                slug = self.create(mapped, label, top_category, model_ids, launch, digest)
        except (CatalogError, OSError, ValueError, sqlite3.Error) as err:
            self.catalog.rollback()
            return self.error(label, err)
        # An existing program keeps its slug whatever it is: only new ones are reported as renamed.
        self.note(mapped, label, top_category, source_genre, model_ids, launch, None if existing else slug)
        if restored:
            self.counts['restored'] += 1

    def download_file(self, mapped):
        data = fetch(mapped['file_url'], self.catalog.max_file_bytes)
        if not data:
            raise CatalogError('пустой файл: %s' % mapped['file_url'])
        time.sleep(self.args.delay)
        return data

    def download_screenshots(self, urls, label):
        """[(url, bytes, ext)] — a picture that fails is skipped with a note, the record goes on."""
        out = []
        for url in urls:
            try:
                data = fetch(url, self.catalog.max_screenshot_bytes)
            except CatalogError as err:
                self.skipped_shots.append((label, str(err)))
                self.say('  ! %s: скриншот пропущен: %s' % (label, err))
                continue
            ext = detect_image(data)
            if ext is None:
                self.skipped_shots.append((label, 'не картинка: %s' % url))
                self.say('  ! %s: не картинка, пропущено: %s' % (label, url))
                continue
            out.append((url, data, ext))
            time.sleep(self.args.delay)
        return out

    def category_id(self, top_category, genre):
        """The genre under its section's category, both created on demand. Inside a unit of work."""
        top = self.catalog.find_category(top_category)
        if top is None:
            top = self.catalog.create_category(top_category)
            self.new_categories.setdefault((top_category, ''), 0)
        if not genre:
            return top
        sub = self.catalog.find_category(genre, top)
        if sub is None:
            sub = self.catalog.create_category(genre, top)
            self.new_categories.setdefault((top_category, genre), 0)
        return sub

    def free_slug(self, mapped):
        for slug in slug_candidates(mapped):
            if slug not in self.planned_slugs and not self.catalog.slug_taken(slug):
                return slug

    def fields(self, mapped, category_id):
        return {
            'title': mapped['title'],
            'family_id': self.family['id'],
            'category_id': category_id,
            'year': mapped['year'],
            'author': mapped['author'],
            'description': mapped['description'],
            'graphics': mapped['graphics'],
            'music': mapped['music'],
            'source_url': mapped['source_url'],
            'metadata': mapped['metadata'],
        }

    def create(self, mapped, label, top_category, model_ids, launch, digest):
        # The network first: a transaction holds the write lock the server also needs.
        file_data = self.download_file(mapped) if mapped['file_url'] else None
        shots = self.download_screenshots(mapped['screenshots'], label)

        catalog = self.catalog
        catalog.begin()
        slug = self.free_slug(mapped)
        fields = self.fields(mapped, self.category_id(top_category, mapped['genre']))
        fields.update(slug=slug, integration=INTEGRATION, external_id=mapped['external_id'],
                      source_hash=digest, published=1)
        program_id = catalog.insert_program(fields)
        catalog.set_models(program_id, model_ids)
        if file_data is not None:
            name = url_file_name(mapped['file_url'])
            catalog.set_main_file(program_id, name, file_data)
            if launch:
                catalog.set_emulator_file(program_id, self.emulator['id'], name, file_data)
        for index, (url, data, ext) in enumerate(shots):
            catalog.add_screenshot(program_id, data, ext, url, (index + 1) * 10)
        catalog.sync_cover(program_id)
        catalog.rebuild_search_text(program_id)
        catalog.commit()

        self.counts['created'] += 1
        self.say('[создана] %s -> /%s/%s (%s)' % (
            label, self.family['slug'], slug, self.summary(file_data, launch, len(shots))))
        return slug

    def update(self, existing, mapped, label, top_category, model_ids, launch, digest, restored):
        catalog = self.catalog
        program_id = existing['id']
        name = url_file_name(mapped['file_url']) if mapped['file_url'] else ''

        # The file is fetched again only when its address changed or our copy is gone.
        old_file_url = parse_metadata(existing['metadata']).get('file1', '')
        have_file = bool(existing['file_name']) and (catalog.files_dir / existing['file_name']).exists()
        file_data = None
        if mapped['file_url'] and (mapped['file_url'] != old_file_url or not have_file):
            file_data = self.download_file(mapped)

        # Screenshots are matched by where they came from. Uploaded ones have no source and stay.
        current = catalog.screenshots(program_id)
        imported = {row['source_url']: row for row in current if row['source_url']}
        new_shots = self.download_screenshots([u for u in mapped['screenshots'] if u not in imported], label)

        catalog.begin()
        fields = self.fields(mapped, self.category_id(top_category, mapped['genre']))
        fields['source_hash'] = digest
        if restored:
            # It is back in the source: undo what the "missing" step did.
            fields.update(missing_since='', published=1)
        catalog.update_program(program_id, fields)
        catalog.set_models(program_id, model_ids)

        if file_data is not None:
            catalog.set_main_file(program_id, name, file_data)
        if self.emulator is not None:
            slot = catalog.emulator_slot(program_id, self.emulator['id'])
            slot_ok = bool(slot and slot['file_name'] and (catalog.files_dir / slot['file_name']).exists())
            if not launch:
                catalog.clear_emulator_file(program_id, self.emulator['id'])
            elif file_data is not None:
                catalog.set_emulator_file(program_id, self.emulator['id'], name, file_data)
            elif not slot_ok and have_file:
                # The emulator appeared, or its copy was removed: make it from our own download.
                body = (catalog.files_dir / existing['file_name']).read_bytes()
                catalog.set_emulator_file(program_id, self.emulator['id'], name, body)

        for url, row in imported.items():
            if url not in mapped['screenshots']:
                catalog.delete_screenshot(row)
        added = {url: catalog.add_screenshot(program_id, data, ext, url, 0) for url, data, ext in new_shots}
        # Source order first, by tens; uploaded pictures keep their place after them.
        by_url = {row['source_url']: row['id'] for row in catalog.screenshots(program_id) if row['source_url']}
        order = [by_url[u] for u in mapped['screenshots'] if u in by_url]
        manual = [row['id'] for row in catalog.screenshots(program_id) if not row['source_url']]
        for index, screenshot_id in enumerate(order + manual):
            catalog.set_screenshot_order(screenshot_id, (index + 1) * 10)
        catalog.sync_cover(program_id)
        catalog.rebuild_search_text(program_id)
        catalog.commit()

        self.counts['updated'] += 1
        note = 'вернулась в источник, снова опубликована; ' if restored else ''
        self.say('[обновлена] %s -> /%s/%s (%s%s)' % (
            label, self.family['slug'], existing['slug'], note, self.summary(file_data, launch, len(added))))
        return existing['slug']

    @staticmethod
    def summary(file_data, launch, shots):
        parts = []
        if file_data is not None:
            parts.append('файл %d КБ' % max(1, len(file_data) // 1024))
        parts.append('запуск есть' if launch else 'без запуска')
        parts.append('новых скриншотов: %d' % shots)
        return ', '.join(parts)

    def report_plan(self, existing, mapped, label, top_category, model_ids, launch, restored):
        """--test: the same decisions, read-only, with nothing fetched."""
        catalog = self.catalog
        top = catalog.find_category(top_category)
        created = []
        if top is None and (top_category, '') not in self.new_categories:
            self.new_categories[(top_category, '')] = 0
            created.append('категория «%s»' % top_category)
        genre = mapped['genre']
        if genre and (top is None or catalog.find_category(genre, top) is None):
            if (top_category, genre) not in self.new_categories:
                self.new_categories[(top_category, genre)] = 0
                created.append('подкатегория «%s / %s»' % (top_category, genre))

        details = [
            'файл %s' % url_file_name(mapped['file_url']) if mapped['file_url'] else 'без файла',
            'запуск есть' if launch else 'без запуска',
            'скриншотов: %d' % len(mapped['screenshots']),
            'моделей: %d' % len(model_ids),
        ]
        if created:
            details.append('будет создано: ' + ', '.join(created))

        if existing:
            self.counts['updated'] += 1
            note = ' (вернулась в источник)' if restored else ''
            self.say('[обновить%s] %s -> /%s/%s (%s)' % (
                note, label, self.family['slug'], existing['slug'], ', '.join(details)))
            return existing['slug']
        slug = self.free_slug(mapped)
        self.planned_slugs.add(slug)
        self.counts['created'] += 1
        self.say('[создать] %s -> /%s/%s (%s)' % (label, self.family['slug'], slug, ', '.join(details)))
        return slug

    # ------------------------------------------------- gone from the source

    def mark_missing(self, seen_ids, sections):
        """
        Programs of this integration whose record is no longer in the source: unpublish
        and date them, once. A row already marked is left alone, so a program the admin
        deliberately published again stays published.
        """
        rows = [row for row in self.catalog.integration_programs(INTEGRATION)
                if parse_metadata(row['metadata']).get('section', '') in sections]
        gone = [row for row in rows if row['external_id'] not in seen_ids and not row['missing_since']]
        if not gone:
            return
        # A broken or truncated export must not take the catalog off the air.
        if len(gone) > max(3, len(rows) // 10) and not self.args.allow_mass_unpublish:
            self.error('источник', 'в нём нет %d из %d программ — слишком много для пропажи, ничего не снято. '
                       'Если выгрузка верна, повторите с --allow-mass-unpublish.' % (len(gone), len(rows)))
            return
        for row in gone:
            self.counts['missing'] += 1
            label = '%s «%s»' % (row['external_id'], row['title'])
            self.gone.append(label)
            if self.test:
                self.say('[пометить: нет в источнике] %s' % label)
                continue
            self.catalog.begin()
            self.catalog.update_program(row['id'], {'missing_since': now_iso(), 'published': 0})
            self.catalog.commit()
            self.say('[нет в источнике] %s — снята с публикации' % label)

    # ------------------------------------------------------------- summary

    def print_summary(self, processed, total, notes):
        """
        The whole run on one screen: what changed, what was created on the way, what went
        wrong, and what is worth a look. The "worth a look" tables count only programs
        created or updated in this run — unchanged ones are not re-examined.
        """
        c = self.counts
        will = 'будет ' if self.test else ''
        changed = c['created'] + c['updated']

        def section(title, lines):
            if lines:
                log('')
                log(title)
                for line in lines:
                    log('  ' + line)

        def table(counts):
            return ['%-44s %d' % (key, n) for key, n in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))]

        def capped(lines, limit=40):
            return lines[:limit] + (['… и ещё %d' % (len(lines) - limit)] if len(lines) > limit else [])

        log('')
        log('=' * 72)
        log('ИТОГ%s' % (' ПРОВЕРОЧНОГО ПРОГОНА — в базе и на диске ничего не изменено' if self.test else ''))
        log('=' * 72)
        log('Записей в источнике: %d, обработано: %d' % (total, processed))
        log('  %-28s %d' % (will + 'создано', c['created']))
        log('  %-28s %d' % (will + 'обновлено', c['updated']))
        log('  %-28s %d' % ('без изменений', c['unchanged']))
        log('  %-28s %d' % ('вернулись в источник', c['restored']))
        log('  %-28s %d' % ('пропали из источника', c['missing']))
        log('  %-28s %d' % ('ошибок', c['errors']))
        section('ЗАМЕЧАНИЯ', notes)

        tops = [(top, n) for (top, sub), n in self.new_categories.items() if not sub]
        subs = {}
        for (top, sub), n in self.new_categories.items():
            if sub:
                subs.setdefault(top, []).append('%s (%d)' % (sub, n))
        made = 'БУДУТ СОЗДАНЫ' if self.test else 'СОЗДАНЫ'
        section('%s КАТЕГОРИИ ВЕРХНЕГО УРОВНЯ: %d — проверьте, нет ли такой же под другим названием'
                % (made, len(tops)),
                ['%s — программ: %d' % (top, n) for top, n in tops])
        section('%s ПОДКАТЕГОРИИ: %d' % (made, sum(len(v) for v in subs.values())),
                ['%s: %s' % (top, ', '.join(names)) for top, names in subs.items()])

        section('НАСТРОЙКА: не найдено в справочниках', self.setup_problems)
        section('ОШИБКИ: %d — эти записи не импортированы' % len(self.errors),
                capped(['%s: %s' % pair for pair in self.errors]))
        section('ПРОПУЩЕННЫЕ СКРИНШОТЫ: %d' % len(self.skipped_shots),
                capped(['%s: %s' % pair for pair in self.skipped_shots]))
        section('ПРОПАЛИ ИЗ ИСТОЧНИКА: %d — %s' % (
                    len(self.gone), 'будут сняты с публикации' if self.test else 'сняты с публикации'),
                capped(self.gone))

        if changed:
            section('БЕЗ МОДЕЛИ: %d из %d — по платформам' % (sum(self.without_models.values()), changed),
                    table(self.without_models))
            section('БЕЗ КНОПКИ ЗАПУСКА: %d из %d — по причинам' % (sum(self.without_launch.values()), changed),
                    table(self.without_launch))
            section('БЕЗ ЖАНРА В ИСТОЧНИКЕ: %d — попадают прямо в категорию' % sum(self.without_genre.values()),
                    table(self.without_genre))
            section('БЕЗ СКРИНШОТОВ: %d из %d' % (self.without_shots, changed),
                    ['в каталоге у них будет пустой экран с названием семейства'] if self.without_shots else [])
            section('АДРЕС С УТОЧНЕНИЕМ: %d — одноимённые программы, адрес по названию был занят'
                    % len(self.renamed_slugs),
                    capped(['%s -> /%s/%s' % (label, self.family['slug'], slug)
                            for label, slug in self.renamed_slugs]))
        log('')


def main():
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding='utf-8', errors='replace')

    parser = argparse.ArgumentParser(description='Импорт из BK Catalog.')
    parser.add_argument('--file', metavar='PATH',
                        help='взять каталог из локальной копии (zip или папка с games.json, software.json, '
                             'demoscene.json), а не с сайта')
    parser.add_argument('--limit', type=int, default=0, help='обработать не больше N записей')
    parser.add_argument('--test', action='store_true', help='только протокол: без скачивания и без записи в базу')
    parser.add_argument('--only', default=','.join(SECTIONS), help='разделы через запятую')
    parser.add_argument('--delay', type=float, default=0.05, help='пауза между скачиваниями, секунд')
    parser.add_argument('--verbose', action='store_true', help='показывать и записи без изменений')
    parser.add_argument('--quiet', action='store_true', help='без строки на каждую запись: только итог')
    parser.add_argument('--allow-mass-unpublish', action='store_true',
                        help='разрешить снять с публикации больше 10%% программ интеграции')
    args = parser.parse_args()

    only = [name.strip() for name in args.only.split(',') if name.strip()]
    unknown = [name for name in only if name not in SECTIONS]
    if unknown:
        parser.error('неизвестные разделы: %s' % ', '.join(unknown))

    try:
        catalog = Catalog(read_only=args.test)
        settings = dict(DEFAULTS, **catalog.config.get('integrations', {}).get(INTEGRATION, {}))
        # A partial "categories" overrides only the sections it names.
        settings['categories'] = dict(DEFAULTS['categories'], **settings['categories'])
        # The network is the rule, a local copy the exception — and only when asked for by
        # name: a stale file left in a config must never quietly stand in for the live catalog.
        is_url = re.compile(r'https?://', re.I).match
        if args.file:
            if is_url(args.file):
                raise CatalogError('--file принимает путь к zip или папке; адрес сайта задаётся в config.json (source).')
            source = args.file
        else:
            source = settings['source']
            if not is_url(source):
                raise CatalogError(
                    'integrations["%s"].source в config.json должен быть http(s)-адресом, а там «%s». '
                    'Локальную копию каталога передают ключом --file.' % (INTEGRATION, source))
        log('Источник: %s%s%s' % (
            'локальная копия ' if args.file else '', source,
            '  (проверочный прогон: ничего не меняется)' if args.test else ''))
        data = load_source(source, only)
        importer = Importer(catalog, settings, args)
    except CatalogError as err:
        log('Ошибка: %s' % err)
        return 2

    seen = set()
    total = sum(len(records) for records in data.values())
    processed = 0
    limited = False
    for section in SECTIONS:
        rule = settings['categories'][section]
        for record in data.get(section, []):
            if args.limit and processed >= args.limit:
                limited = True
                break
            seen.add(str(record.get('ID')))
            importer.process(record, section, rule)
            processed += 1

    # "Gone from the source" is only knowable after a complete pass over a non-empty source.
    notes = []
    if limited:
        notes.append('задан --limit %d: пропавшие из источника записи не проверялись' % args.limit)
    elif total == 0:
        importer.error('источник', 'пуст — пропавшие записи не проверялись')
    else:
        importer.mark_missing(seen, set(data))

    catalog.close()
    importer.print_summary(processed, total, notes)
    return 1 if importer.counts['errors'] else 0


if __name__ == '__main__':
    sys.exit(main())
