/** /admin/stats: the catalog in numbers — rows, files, sizes, and where the two disagree. */
import { config } from '../config.ts';
import type { Report, User } from '../db.ts';
import type { DirReport, DiskReport, FileEntry } from '../diskstats.ts';
import { escapeHtml, formatBytes } from '../http.ts';
import { layout } from './layout.ts';
import { nav } from './admin.ts';
import { plural } from './parts.ts';

export type ServerInfo = {
  nodeVersion: string;
  platform: string;
  uptimeSeconds: number;
  memoryBytes: number;
  generatedMs: number;
};

const TABLE_LABELS: Record<string, string> = {
  families: 'Семейства',
  models: 'Модели',
  emulators: 'Эмуляторы',
  categories: 'Категории и подкатегории',
  programs: 'Программы',
  program_models: 'Связи «программа — модель»',
  program_emulator_files: 'Слоты запуска (файл или ссылка для эмулятора)',
  program_screenshots: 'Скриншоты программ',
  users: 'Администраторы',
};

/** formatBytes() answers '' for zero, which reads as a hole in a table. */
const bytes = (value: number): string => formatBytes(value) || '0 Б';

const num = (value: number): string => value.toLocaleString('ru-RU');

const day = (iso: string): string => (iso ? iso.slice(0, 10) : '—');

const share = (part: number, whole: number): string =>
  whole > 0 ? `${Math.round((part / whole) * 100)} %` : '—';

function uptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days} д ${hours} ч`;
  if (hours > 0) return `${hours} ч ${minutes} мин`;
  return `${minutes} мин`;
}

/** A panel with a heading; body is already-built HTML. */
function panel(title: string, body: string, note = ''): string {
  return `<section class="panel stats-panel">
  <h2>${escapeHtml(title)}</h2>
  ${note ? `<p class="hint">${escapeHtml(note)}</p>` : ''}
  ${body}
</section>`;
}

/**
 * A table of plain values. Cells are escaped here; a cell that is already HTML (a link)
 * is passed as { html }. Columns listed in `right` hold numbers and are right-aligned.
 */
type Cell = string | number | { html: string };

function table(head: string[], rows: Cell[][], right: number[] = [], empty = 'Пусто.'): string {
  if (rows.length === 0) return `<p class="muted">${escapeHtml(empty)}</p>`;
  const cls = (i: number): string => (right.includes(i) ? ' class="num"' : '');
  const cell = (value: Cell): string =>
    typeof value === 'object' ? value.html : escapeHtml(typeof value === 'number' ? num(value) : value);
  return `<table class="admin-table stats-table">
  <thead><tr>${head.map((h, i) => `<th${cls(i)}>${escapeHtml(h)}</th>`).join('')}</tr></thead>
  <tbody>
    ${rows.map((row) => `<tr>${row.map((value, i) => `<td${cls(i)}>${cell(value)}</td>`).join('')}</tr>`).join('')}
  </tbody>
</table>`;
}

/** Label/value pairs, for facts that are not a table. */
function facts(rows: [string, string][]): string {
  return `<dl class="meta stats-facts">${rows
    .map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`)
    .join('')}</dl>`;
}

const programLink = (p: { title: string; slug: string; family_slug: string }): Cell => ({
  html: `<a href="/${escapeHtml(encodeURIComponent(p.family_slug))}/${escapeHtml(encodeURIComponent(p.slug))}">${escapeHtml(p.title)}</a>`,
});

function fileList(entries: FileEntry[], limit = 15): string {
  const shown = entries.slice(0, limit);
  return `<ul class="stats-files">${shown
    .map((entry) => `<li><span class="mono">${escapeHtml(entry.name)}</span> <span class="muted">${escapeHtml(bytes(entry.bytes))}</span></li>`)
    .join('')}${entries.length > limit ? `<li class="muted">… и ещё ${entries.length - limit}</li>` : ''}</ul>`;
}

/** The two ways a directory and the database can disagree. Quiet when they agree. */
function mismatches(dir: DirReport, what: string): string {
  const parts: string[] = [];
  if (dir.missing.length) {
    parts.push(`<p><span class="badge lost">нет на диске: ${dir.missing.length}</span></p>
    <p class="hint">База ссылается на эти ${escapeHtml(what)}, а файлов нет — скачивание, запуск или картинка не сработают.</p>
    ${fileList(dir.missing.map((name) => ({ name, bytes: 0 })))}`);
  }
  if (dir.orphans.length) {
    const total = dir.orphans.reduce((sum, entry) => sum + entry.bytes, 0);
    parts.push(`<p><span class="badge">лишние на диске: ${dir.orphans.length}, ${escapeHtml(bytes(total))}</span></p>
    <p class="hint">Лежат в каталоге, но ни одна запись на них не ссылается. Страница их только показывает.</p>
    ${fileList(dir.orphans)}`);
  }
  return parts.length ? parts.join('') : '<p><span class="badge ok">диск и база сходятся</span></p>';
}

function dirPanel(title: string, dir: DirReport, what: string): string {
  return panel(
    title,
    `${facts([
      ['Файлов', num(dir.count)],
      ['Объём', bytes(dir.bytes)],
      ['Средний размер', dir.count ? bytes(Math.round(dir.bytes / dir.count)) : '—'],
    ])}
    ${mismatches(dir, what)}
    <h3>По типам</h3>
    ${table(['Тип', 'Файлов', 'Объём'], dir.byType.map((t) => [t.ext, t.count, bytes(t.bytes)]), [1, 2])}
    <h3>Самые большие</h3>
    ${table(['Файл', 'Размер'], dir.largest.map((f) => [{ html: `<span class="mono">${escapeHtml(f.name)}</span>` }, bytes(f.bytes)]), [1])}`,
  );
}

export function statsPage(user: User, r: Report, disk: DiskReport, server: ServerInfo): string {
  const p = r.programs;
  const dataBytes =
    disk.files.bytes + disk.screenshots.bytes + disk.database.bytes + disk.database.walBytes +
    disk.backups.bytes + disk.otherBytes;
  const dbFree = r.engine.freePages * r.engine.pageSize;

  const headline = `<ul class="stats">
    <li><b>${num(p.total)}</b> ${plural(p.total, 'программа', 'программы', 'программ')}</li>
    <li><b>${num(p.published)}</b> опубликовано</li>
    <li><b>${num(disk.files.count)}</b> ${plural(disk.files.count, 'файл', 'файла', 'файлов')} программ</li>
    <li><b>${num(disk.screenshots.count)}</b> ${plural(disk.screenshots.count, 'картинка', 'картинки', 'картинок')}</li>
    <li><b>${escapeHtml(bytes(dataBytes))}</b> всего в data/</li>
    <li><b>${num(p.downloads)}</b> скачиваний</li>
    <li><b>${num(p.runs)}</b> запусков</li>
  </ul>`;

  const programs = panel(
    'Программы',
    table(
      ['Показатель', 'Программ', 'Доля'],
      ([
        ['Всего', p.total],
        ['Опубликовано', p.published],
        ['Скрыто', p.total - p.published],
        ['Продвигаются', p.promoted],
        ['Разыскивается автор', p.authorWanted],
        ['Нет в источнике (отметка импорта)', p.missing],
        ['С файлом для скачивания', p.withFile],
        ['С кнопкой запуска', p.withLaunch],
        ['Со скриншотом', p.withScreenshot],
        ['Без скриншота', p.total - p.withScreenshot],
        ['Без категории', p.withoutCategory],
        ['Без модели', p.withoutModels],
        ['Без описания', p.withoutDescription],
        ['Без автора', p.withoutAuthor],
        ['Без года', p.withoutYear],
      ] as [string, number][]).map(([label, n]) => [label, n, share(n, p.total)]),
      [1, 2],
    ) +
      facts([
        ['Годы выпуска', p.yearFrom === null ? '—' : `${p.yearFrom}–${p.yearTo}`],
        ['Первая запись добавлена', day(p.firstCreated)],
        ['Последняя добавлена', day(p.lastCreated)],
        ['Последнее изменение', day(p.lastUpdated)],
      ]),
  );

  const families = panel(
    'По семействам',
    table(
      ['Семейство', 'Моделей', 'Программ', 'Опубликовано', 'Файлы', 'Скачиваний', 'Запусков'],
      r.byFamily.map((f) => [
        { html: `<a href="/${escapeHtml(encodeURIComponent(f.slug))}">${escapeHtml(f.name)}</a>` },
        f.models, f.programs, f.published, bytes(f.bytes), f.downloads, f.runs,
      ]),
      [1, 2, 3, 4, 5, 6],
    ),
    '«Файлы» — объём основных файлов для скачивания, без копий для эмуляторов.',
  );

  const categories = panel(
    'По категориям',
    table(
      ['Категория', 'Подкатегорий', 'Программ', 'Доля'],
      r.byCategory.map((c) => [c.id ? c.name : '— без категории —', c.subcategories, c.programs, share(c.programs, p.total)]),
      [1, 2, 3],
    ),
    `Категорий верхнего уровня: ${r.categories.top}, подкатегорий: ${r.categories.sub}. Программы подкатегорий входят в счёт своей категории.`,
  );

  const integrations = panel(
    'По происхождению',
    table(
      ['Источник', 'Программ', 'Опубликовано', 'Нет в источнике', 'Изменялись'],
      r.byIntegration.map((i) => [i.integration || 'добавлены вручную', i.programs, i.published, i.missing, day(i.lastUpdated)]),
      [1, 2, 3],
    ),
  );

  const decades = panel(
    'По годам выпуска',
    table(
      ['Десятилетие', 'Программ', 'Доля'],
      r.byDecade.map((d) => [d.decade ? `${d.decade}-е` : 'год не указан', d.programs, share(d.programs, p.total)]),
      [1, 2],
    ),
  );

  const emulators = panel(
    'Эмуляторы',
    table(
      ['Эмулятор', 'Программ', 'С файлом', 'Только ссылка', 'Объём файлов', 'Запусков'],
      r.byEmulator.map((e) => [e.name, e.slots, e.files, e.links, bytes(e.bytes), e.runs]),
      [1, 2, 3, 4, 5],
      'Эмуляторов нет.',
    ),
  );

  const screenshots = panel(
    'Скриншоты программ',
    facts([
      ['Всего скриншотов', num(r.screenshots.total)],
      ['Из них импортировано', num(r.screenshots.imported)],
      ['Загружено вручную', num(r.screenshots.total - r.screenshots.imported)],
      ['Программ с несколькими', num(r.screenshots.programsWithSeveral)],
      ['Больше всего у одной программы', num(r.screenshots.most)],
      ['В среднем на программу со скриншотом', p.withScreenshot ? (r.screenshots.total / p.withScreenshot).toFixed(1) : '—'],
    ]),
  );

  const popular = panel(
    'Самые востребованные',
    table(
      ['Программа', 'Скачиваний', 'Запусков'],
      r.popular.map((row) => [programLink(row), row.downloads, row.runs]),
      [1, 2],
      'Скачиваний и запусков пока не было.',
    ),
    'Собственные скачивания и запуски администраторов не считаются.',
  );

  const recent = panel(
    'Последние добавленные',
    table(
      ['Программа', 'Добавлена', 'Источник'],
      r.recent.map((row) => [programLink(row), day(row.created_at), row.integration || 'вручную']),
    ),
  );

  const storage = panel(
    'Место на диске',
    table(
      ['Что', 'Файлов', 'Объём', 'Доля'],
      ([
        ['Файлы программ (data/files)', disk.files.count, disk.files.bytes],
        ['Картинки (data/screenshots)', disk.screenshots.count, disk.screenshots.bytes],
        ['База данных (catalog.db)', 1, disk.database.bytes],
        ['Журнал базы (-wal, -shm)', '', disk.database.walBytes],
        ['Резервные копии (data/backups)', disk.backups.count, disk.backups.bytes],
        ['Прочее в data/', '', disk.otherBytes],
      ] as [string, number | string, number][]).map(([what, count, size]) => [what, count, bytes(size), share(size, dataBytes)]),
      [1, 2, 3],
    ) +
      facts([
        ['Всего в data/', bytes(dataBytes)],
        ...(disk.volume
          ? ([
              ['Свободно на томе', `${bytes(disk.volume.freeBytes)} из ${bytes(disk.volume.totalBytes)}`],
            ] as [string, string][])
          : []),
        ['Последняя резервная копия', disk.backups.newest || 'копий нет'],
        ['Каталог данных', config.dataDir],
      ]),
  );

  const database = panel(
    'База данных',
    table(['Таблица', 'Записей'], r.tables.map((t) => [TABLE_LABELS[t.name] ?? t.name, t.rows]), [1]) +
      facts([
        ['Размер файла', bytes(disk.database.bytes)],
        ['Страниц', `${num(r.engine.pageCount)} по ${bytes(r.engine.pageSize)}`],
        ['Свободно внутри файла', `${bytes(dbFree)} (${share(r.engine.freePages, r.engine.pageCount)})`],
        ['Версия схемы', String(r.engine.schemaVersion)],
        ['Режим журнала', r.engine.journalMode],
        ['SQLite', r.engine.sqliteVersion],
      ]),
  );

  const serverPanel = panel(
    'Сервер',
    facts([
      ['Node.js', server.nodeVersion],
      ['Платформа', server.platform],
      ['Работает', uptime(server.uptimeSeconds)],
      ['Память процесса', bytes(server.memoryBytes)],
      ['Адрес сайта', config.siteUrl],
      ['Предел файла программы', bytes(config.maxFileBytes)],
      ['Предел картинки', bytes(config.maxScreenshotBytes)],
      ['Страница собрана за', `${server.generatedMs} мс`],
    ]),
  );

  const body = `
<section class="admin-head">
  <h1>Статистика</h1>
  ${headline}
</section>
<div class="stats-grid">
  ${programs}
  ${storage}
  ${families}
  ${categories}
  ${integrations}
  ${decades}
  ${emulators}
  ${screenshots}
  ${popular}
  ${recent}
  ${dirPanel('Файлы программ', disk.files, 'файлы')}
  ${dirPanel('Картинки', disk.screenshots, 'картинки')}
  ${database}
  ${serverPanel}
</div>`;

  return layout({ title: 'Статистика', nav: nav(user), bodyClass: 'admin' }, body);
}
