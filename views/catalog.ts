import { config } from '../config.ts';
import type { EmulatorFile, Facets, Family, Model, ProgramRow } from '../db.ts';
import { escapeHtml, formatBytes } from '../http.ts';
import { layout } from './layout.ts';
import { markdownExcerpt } from '../markdown.ts';
import { imageTag, mdBlock, pager, plural } from './parts.ts';

export type ListQuery = {
  q: string;
  familyId: number | null;
  modelId: number | null;
  categoryId: number | null;
  year: number | null;
  sort: string;
};

function card(p: ProgramRow): string {
  const meta = [p.family_name, p.year ? String(p.year) : ''].filter(Boolean).join(' · ');
  return `<article class="card">
  <a class="card-shot" href="/p/${escapeHtml(p.slug)}">${imageTag(p.screenshot, `Скриншот: ${p.title}`, 'shot', p.family_name)}</a>
  <div class="card-body">
    <h3><a href="/p/${escapeHtml(p.slug)}">${escapeHtml(p.title)}</a></h3>
    <p class="card-meta">${escapeHtml(meta)}</p>
    ${p.author ? `<p class="card-author">${escapeHtml(p.author)}</p>` : ''}
    ${p.author_wanted ? '<p class="card-author"><span class="badge wanted">разыскивается автор</span></p>' : ''}
  </div>
</article>`;
}

export function queryString(q: ListQuery, overrides: Record<string, string | number | null>): string {
  const params = new URLSearchParams();
  const merged: Record<string, string | number | null> = {
    q: q.q,
    family: q.familyId,
    model: q.modelId,
    category: q.categoryId,
    year: q.year,
    sort: q.sort,
    ...overrides,
  };
  for (const [key, value] of Object.entries(merged)) {
    if (value !== null && value !== '' && value !== undefined) params.set(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : '/';
}

function idOptions(values: { id: number; name: string; n?: number }[], selected: number | null, anyLabel: string): string {
  return (
    `<option value="">${escapeHtml(anyLabel)}</option>` +
    values
      .map(
        (v) =>
          `<option value="${v.id}"${v.id === selected ? ' selected' : ''}>${escapeHtml(v.name)}${
            v.n === undefined ? '' : ` (${v.n})`
          }</option>`,
      )
      .join('')
  );
}

export function listPage(
  rows: ProgramRow[],
  total: number,
  page: number,
  pages: number,
  q: ListQuery,
  facets: Facets,
  families: Family[],
): string {
  const filters = `<form class="filters" method="get" action="/">
  <input class="search" type="search" name="q" value="${escapeHtml(q.q)}" placeholder="Название, автор…" aria-label="Поиск">
  <select name="family" aria-label="Семейство">${idOptions(families, q.familyId, 'Все семейства')}</select>
  <select name="model" aria-label="Модель">${idOptions(facets.models, q.modelId, 'Все модели')}</select>
  <select name="category" aria-label="Категория">${idOptions(facets.categories, q.categoryId, 'Все категории')}</select>
  <select name="year" aria-label="Год">
    <option value="">Все годы</option>
    ${facets.years.map((y) => `<option value="${y}"${q.year === y ? ' selected' : ''}>${y}</option>`).join('')}
  </select>
  <select name="sort" aria-label="Сортировка">
    ${[['new', 'Сначала новые'], ['title', 'По названию'], ['year', 'По году'], ['popular', 'По популярности']]
      .map(([v, label]) => `<option value="${v}"${q.sort === v ? ' selected' : ''}>${label}</option>`)
      .join('')}
  </select>
  <button type="submit">Показать</button>
  ${q.q || q.familyId || q.modelId || q.categoryId || q.year ? '<a class="reset" href="/">сбросить</a>' : ''}
</form>`;

  const grid = rows.length
    ? `<div class="grid">${rows.map(card).join('\n')}</div>`
    : '<p class="empty">Ничего не нашлось. Попробуйте изменить фильтры.</p>';

  return layout(
    { description: config.siteTagline },
    `<section class="toolbar">
  ${filters}
  <p class="count">${total} ${plural(total, 'программа', 'программы', 'программ')}</p>
</section>
${grid}
${pager(page, pages, (n) => queryString(q, { page: n }))}`,
  );
}

export function programPage(
  p: ProgramRow,
  models: Model[],
  links: { download: string; emulators: EmulatorFile[] },
): string {
  const rows: [string, string][] = [
    ['Семейство', p.family_name],
    ['Модели', models.map((m) => m.name).join(', ')],
    ['Категория', p.category_name ?? ''],
    ['Год', p.year ? String(p.year) : ''],
    ['Автор', p.author_wanted ? 'разыскивается' : p.author],
    ['Размер', formatBytes(p.file_size)],
  ].filter((row) => row[1] !== '') as [string, string][];

  const actions = [
    ...links.emulators.map(
      (slot) =>
        `<a class="button primary" href="/run/${escapeHtml(p.slug)}/${slot.emulator_id}" target="_blank" rel="noopener">▶ Запустить в ${escapeHtml(
          slot.emulator_name,
        )}</a>`,
    ),
    links.download ? `<a class="button" href="${escapeHtml(links.download)}">↓ Скачать</a>` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return layout(
    { title: p.title, description: markdownExcerpt(p.description, 200) },
    `<article class="program">
  <div class="program-shot">${imageTag(p.screenshot, `Скриншот: ${p.title}`, 'shot-big', p.family_name)}</div>
  <div class="program-info">
    <h1>${escapeHtml(p.title)}</h1>
    <dl class="meta">
      ${rows.map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}
    </dl>
    <div class="actions">${actions || '<p class="empty">Файл пока не добавлен.</p>'}</div>
    ${mdBlock(p.description, 'description md-body')}
    <p class="counters">скачиваний: ${p.downloads} · запусков: ${p.runs}</p>
  </div>
</article>
<p class="back"><a href="/">← ко всему каталогу</a></p>`,
  );
}

