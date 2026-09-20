/**
 * The program catalog. One body renderer serves /catalog, /<family> and
 * /<family>/<model> — only the header above the filters and the fixed filter differ.
 */
import type { EmulatorFile, Facets, Family, Model, ProgramRow } from '../db.ts';
import { escapeHtml, formatBytes } from '../http.ts';
import { layout } from './layout.ts';
import { imageTag, mdDetails, pager, plural, viewToggle, wantedBadge } from './parts.ts';

export type ListQuery = {
  q: string;
  familyId: number | null;
  modelId: number | null;
  categoryId: number | null;
  year: number | null;
  sort: string;
};

export type ViewMode = 'tiles' | 'table';

export type CatalogContext = {
  /** Where the filter form submits: /catalog, /agat, /agat/agat-9. */
  basePath: string;
  title: string;
  description: string;
  /** Fixed by the URL — the matching filter control disappears. */
  family: Family | null;
  model: Model | null;
  /** Rendered above the filters. */
  header: string;
};

export type CatalogView = {
  rows: ProgramRow[];
  total: number;
  page: number;
  pages: number;
  q: ListQuery;
  facets: Facets;
  families: Family[];
  /** Emulator slots by program id — one query per page instead of N. */
  slots: Map<number, EmulatorFile[]>;
  ctx: CatalogContext;
  view: ViewMode;
};

export function queryString(
  basePath: string,
  q: ListQuery,
  overrides: Record<string, string | number | null>,
): string {
  const params = new URLSearchParams();
  const merged: Record<string, string | number | null> = {
    q: q.q,
    family: q.familyId,
    model: q.modelId,
    category: q.categoryId,
    year: q.year,
    sort: q.sort === 'new' ? null : q.sort,
    ...overrides,
  };
  for (const [key, value] of Object.entries(merged)) {
    if (value !== null && value !== '' && value !== undefined) params.set(key, String(value));
  }
  const s = params.toString();
  return s ? `${basePath}?${s}` : basePath;
}

function idOptions(
  values: { id: number; name: string; n?: number }[],
  selected: number | null,
  anyLabel: string,
): string {
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

/** Download, plus one launch button per emulator that has a file for this program. */
function actions(p: ProgramRow, slots: EmulatorFile[], compact = false): string {
  const cls = compact ? 'button small' : 'button';
  return [
    ...slots.map(
      (slot) =>
        `<a class="${cls} primary" href="/run/${escapeHtml(p.slug)}/${slot.emulator_id}" target="_blank" rel="noopener">▶ ${escapeHtml(
          compact ? slot.emulator_name : `Запустить в ${slot.emulator_name}`,
        )}</a>`,
    ),
    p.file_name ? `<a class="${cls}" href="/dl/${escapeHtml(p.slug)}">↓ Скачать</a>` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function tile(p: ProgramRow, slots: EmulatorFile[]): string {
  const meta = [p.family_name, p.category_name ?? '', p.year ? String(p.year) : ''].filter(Boolean).join(' · ');
  return `<article class="card">
  <a class="card-shot" href="/p/${escapeHtml(p.slug)}">${imageTag(p.screenshot, `Скриншот: ${p.title}`, 'shot', p.family_name)}</a>
  <div class="card-body">
    <h3><a href="/p/${escapeHtml(p.slug)}">${escapeHtml(p.title)}</a></h3>
    <p class="card-meta">${escapeHtml(meta)}</p>
    ${p.author ? `<p class="card-author">${escapeHtml(p.author)}</p>` : ''}
    ${p.author_wanted ? wantedBadge('разыскивается автор', p.family_wanted_note) : ''}
    <p class="card-actions">${actions(p, slots, true)}</p>
  </div>
</article>`;
}

function tableRow(p: ProgramRow, slots: EmulatorFile[]): string {
  const meta = [p.family_name, p.category_name ?? ''].filter(Boolean).join(' · ');
  return `<tr>
  <td class="thumb"><a href="/p/${escapeHtml(p.slug)}">${imageTag(p.screenshot, `Скриншот: ${p.title}`, 'shot-small', p.family_name)}</a></td>
  <td>
    <a class="row-title" href="/p/${escapeHtml(p.slug)}">${escapeHtml(p.title)}</a>
    <p class="card-meta">${escapeHtml(meta)}</p>
    ${p.author_wanted ? wantedBadge('разыскивается автор', p.family_wanted_note) : ''}
  </td>
  <td>${p.year ?? ''}</td>
  <td>${escapeHtml(p.author)}</td>
  <td class="row-desc">${mdDetails(p.description, 180)}</td>
  <td class="row-actions">${actions(p, slots, true)}${
    p.file_size ? `<br><small class="muted">${escapeHtml(formatBytes(p.file_size))}</small>` : ''
  }</td>
</tr>`;
}

export function catalogBody(v: CatalogView): string {
  const { q, ctx, view, facets } = v;

  const filters = `<form class="filters" method="get" action="${escapeHtml(ctx.basePath)}">
  <input class="search" type="search" name="q" value="${escapeHtml(q.q)}" placeholder="Название, автор…" aria-label="Поиск">
  ${ctx.family ? '' : `<select name="family" aria-label="Семейство">${idOptions(v.families, q.familyId, 'Все семейства')}</select>`}
  ${ctx.model ? '' : `<select name="model" aria-label="Модель">${idOptions(facets.models, q.modelId, 'Все модели')}</select>`}
  <select name="category" aria-label="Категория">${idOptions(facets.categories, q.categoryId, 'Все категории')}</select>
  <select name="year" aria-label="Год">
    <option value="">Все годы</option>
    ${facets.years.map((y) => `<option value="${y}"${q.year === y ? ' selected' : ''}>${y}</option>`).join('')}
  </select>
  <select name="sort" aria-label="Порядок">
    ${[['new', 'Сначала новые'], ['year', 'По годам'], ['popular', 'По популярности'], ['title', 'По названию']]
      .map(([value, label]) => `<option value="${value}"${q.sort === value ? ' selected' : ''}>${label}</option>`)
      .join('')}
  </select>
  ${view === 'table' ? '<input type="hidden" name="view" value="table">' : ''}
  <button type="submit">Показать</button>
  ${q.q || q.categoryId || q.year || (!ctx.family && q.familyId) || (!ctx.model && q.modelId)
    ? `<a class="reset" href="${escapeHtml(ctx.basePath)}">сбросить</a>`
    : ''}
</form>`;

  const body = v.rows.length === 0
    ? '<p class="empty">Ничего не нашлось. Попробуйте изменить фильтры.</p>'
    : view === 'table'
      ? `<table class="catalog-table">
  <thead><tr><th></th><th>Название</th><th>Год</th><th>Автор</th><th>Описание</th><th></th></tr></thead>
  <tbody>${v.rows.map((p) => tableRow(p, v.slots.get(p.id) ?? [])).join('')}</tbody>
</table>`
      : `<div class="grid">${v.rows.map((p) => tile(p, v.slots.get(p.id) ?? [])).join('\n')}</div>`;

  return `${ctx.header}
<section class="toolbar">
  ${filters}
  <div class="toolbar-right">
    <p class="count">${v.total} ${plural(v.total, 'программа', 'программы', 'программ')}</p>
    ${viewToggle(view, (mode) => queryString(ctx.basePath, q, { view: mode }))}
  </div>
</section>
${body}
${pager(v.page, v.pages, (n) => queryString(ctx.basePath, q, { page: n, view: view === 'table' ? 'table' : null }))}`;
}

export function catalogPage(v: CatalogView): string {
  return layout({ title: v.ctx.title, description: v.ctx.description }, catalogBody(v));
}
