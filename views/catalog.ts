import { config } from '../config.ts';
import type { Program } from '../db.ts';
import { escapeHtml, formatBytes } from '../http.ts';
import { layout } from './layout.ts';

export type ListQuery = {
  q: string;
  platform: string;
  category: string;
  year: number | null;
  sort: string;
};

export type Facets = {
  platforms: { value: string; n: number }[];
  categories: { value: string; n: number }[];
  years: number[];
};

function screenshot(p: Program, cls: string): string {
  if (p.screenshot) {
    return `<img class="${cls}" src="/screenshots/${escapeHtml(p.screenshot)}" alt="Скриншот: ${escapeHtml(p.title)}" loading="lazy">`;
  }
  return `<div class="${cls} shot-empty"><span>${escapeHtml(p.platform || '?')}</span></div>`;
}

function card(p: Program): string {
  const meta = [p.platform, p.year ? String(p.year) : ''].filter(Boolean).join(' · ');
  return `<article class="card">
  <a class="card-shot" href="/p/${escapeHtml(p.slug)}">${screenshot(p, 'shot')}</a>
  <div class="card-body">
    <h3><a href="/p/${escapeHtml(p.slug)}">${escapeHtml(p.title)}</a></h3>
    <p class="card-meta">${escapeHtml(meta)}</p>
    ${p.author ? `<p class="card-author">${escapeHtml(p.author)}</p>` : ''}
  </div>
</article>`;
}

function queryString(q: ListQuery, overrides: Record<string, string | number | null>): string {
  const params = new URLSearchParams();
  const merged: Record<string, string | number | null> = {
    q: q.q, platform: q.platform, category: q.category, year: q.year, sort: q.sort, ...overrides,
  };
  for (const [key, value] of Object.entries(merged)) {
    if (value !== null && value !== '' && value !== undefined) params.set(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : '/';
}

function options(values: { value: string; n: number }[], selected: string, anyLabel: string): string {
  const head = `<option value="">${escapeHtml(anyLabel)}</option>`;
  return head + values
    .map((v) => `<option value="${escapeHtml(v.value)}"${v.value === selected ? ' selected' : ''}>${escapeHtml(v.value)} (${v.n})</option>`)
    .join('');
}

export function listPage(
  rows: Program[],
  total: number,
  page: number,
  pages: number,
  q: ListQuery,
  facets: Facets,
): string {
  const filters = `<form class="filters" method="get" action="/">
  <input class="search" type="search" name="q" value="${escapeHtml(q.q)}" placeholder="Название, автор, тег…" aria-label="Поиск">
  <select name="platform" aria-label="Платформа">${options(facets.platforms, q.platform, 'Все платформы')}</select>
  <select name="category" aria-label="Категория">${options(facets.categories, q.category, 'Все категории')}</select>
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
  ${q.q || q.platform || q.category || q.year ? '<a class="reset" href="/">сбросить</a>' : ''}
</form>`;

  const grid = rows.length
    ? `<div class="grid">${rows.map(card).join('\n')}</div>`
    : '<p class="empty">Ничего не нашлось. Попробуйте изменить фильтры.</p>';

  const pager = pages > 1
    ? `<nav class="pager">
      ${page > 1 ? `<a href="${queryString(q, { page: page - 1 })}">← назад</a>` : '<span></span>'}
      <span class="pager-pos">страница ${page} из ${pages}</span>
      ${page < pages ? `<a href="${queryString(q, { page: page + 1 })}">вперёд →</a>` : '<span></span>'}
    </nav>`
    : '';

  return layout(
    { description: config.siteTagline },
    `<section class="toolbar">
  ${filters}
  <p class="count">${total} ${plural(total, 'программа', 'программы', 'программ')}</p>
</section>
${grid}
${pager}`,
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

export function programPage(p: Program, links: { download: string; run: string }): string {
  const rows: [string, string][] = [
    ['Платформа', p.platform],
    ['Категория', p.category],
    ['Год', p.year ? String(p.year) : ''],
    ['Автор', p.author],
    ['Издатель', p.publisher],
    ['Размер', formatBytes(p.file_size)],
  ].filter((row) => row[1] !== '') as [string, string][];

  const tags = p.tags
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  const actions = [
    links.run ? `<a class="button primary" href="${escapeHtml(links.run)}" target="_blank" rel="noopener">▶ Запустить в эмуляторе</a>` : '',
    links.download ? `<a class="button" href="${escapeHtml(links.download)}"${p.download_url && !p.file_name ? ' rel="nofollow noopener"' : ''}>↓ Скачать</a>` : '',
  ].filter(Boolean).join('\n');

  return layout(
    { title: p.title, description: p.description.slice(0, 200) },
    `<article class="program">
  <div class="program-shot">${screenshot(p, 'shot-big')}</div>
  <div class="program-info">
    <h1>${escapeHtml(p.title)}</h1>
    <dl class="meta">
      ${rows.map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}
    </dl>
    <div class="actions">${actions || '<p class="empty">Файл пока не добавлен.</p>'}</div>
    ${p.description ? `<div class="description">${paragraphs(p.description)}</div>` : ''}
    ${tags.length ? `<p class="tags">${tags.map((t) => `<a class="tag" href="/?q=${encodeURIComponent(t)}">${escapeHtml(t)}</a>`).join(' ')}</p>` : ''}
    <p class="counters">скачиваний: ${p.downloads} · запусков: ${p.runs}</p>
  </div>
</article>
<p class="back"><a href="/">← ко всему каталогу</a></p>`,
  );
}

function paragraphs(textValue: string): string {
  return textValue
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block).replaceAll('\n', '<br>')}</p>`)
    .join('');
}
