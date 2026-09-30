/** Small pieces shared by the public pages and the admin. */
import type { ProgramRow } from '../db.ts';
import { escapeHtml } from '../http.ts';
import { markdownExcerpt, renderMarkdown } from '../markdown.ts';

/** Russian plural: 1 программа, 2 программы, 5 программ. */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/** Program screenshots and the pictures of families and models share one directory. */
export function imageUrl(name: string): string {
  return `/screenshots/${encodeURIComponent(name)}`;
}

/**
 * The program's page. The only place that builds this address: it carries the family
 * slug, so it changes when a program moves, and /p/<slug> redirects here.
 */
export function programUrl(p: Pick<ProgramRow, 'slug' | 'family_slug'>): string {
  return `/${encodeURIComponent(p.family_slug)}/${encodeURIComponent(p.slug)}`;
}

/** "Игра · Аркада" for a second-level category, the bare name for a top-level one. Not escaped. */
export function categoryLabel(p: Pick<ProgramRow, 'category_name' | 'category_parent_name'>): string {
  return [p.category_parent_name ?? '', p.category_name ?? ''].filter(Boolean).join(' · ');
}

export function imageTag(name: string, alt: string, cls: string, fallback = ''): string {
  if (name) {
    return `<img class="${cls}" src="${escapeHtml(imageUrl(name))}" alt="${escapeHtml(alt)}" loading="lazy">`;
  }
  return `<div class="${cls} shot-empty"><span>${escapeHtml(fallback || '?')}</span></div>`;
}

/** How many numbers are shown on each side of the current page. */
const PAGER_REACH = 2;

/**
 * Which page numbers to show: the first, the last and the current one with its
 * neighbours; 0 stands for a gap. A gap that would hide a single page shows that page
 * instead — "1 … 3" is no shorter than "1 2 3".
 */
function pagerNumbers(page: number, pages: number): number[] {
  const shown: number[] = [];
  for (let n = 1; n <= pages; n += 1) {
    if (n === 1 || n === pages || Math.abs(n - page) <= PAGER_REACH) shown.push(n);
  }
  const out: number[] = [];
  let previous = 0;
  for (const n of shown) {
    if (n - previous === 2) out.push(n - 1);
    else if (n - previous > 2) out.push(0);
    out.push(n);
    previous = n;
  }
  return out;
}

/** "← назад  1 … 28 29 [30] 31 32 … 57  вперёд →". Plain links: works without JavaScript. */
export function pager(page: number, pages: number, href: (page: number) => string, total = 0): string {
  if (pages <= 1) return '';
  const numbers = pagerNumbers(page, pages)
    .map((n) => {
      if (n === 0) return '<span class="pager-gap">…</span>';
      if (n === page) return `<span class="pager-page active" aria-current="page">${n}</span>`;
      return `<a class="pager-page" href="${escapeHtml(href(n))}" aria-label="Страница ${n}">${n}</a>`;
    })
    .join('');
  return `<nav class="pager" aria-label="Страницы">
  ${page > 1 ? `<a class="pager-step" href="${escapeHtml(href(page - 1))}" rel="prev">← назад</a>` : '<span class="pager-step"></span>'}
  <div class="pager-middle">
    <div class="pager-pages">${numbers}</div>
    <span class="pager-pos">страница ${page} из ${pages}${total ? ` (${total})` : ''}</span>
  </div>
  ${page < pages ? `<a class="pager-step" href="${escapeHtml(href(page + 1))}" rel="next">вперёд →</a>` : '<span class="pager-step"></span>'}
</nav>`;
}

export function alerts(error = '', notice = ''): string {
  return [
    error ? `<p class="alert">${escapeHtml(error)}</p>` : '',
    notice ? `<p class="notice">${escapeHtml(notice)}</p>` : '',
  ].join('');
}

/** Rendered Markdown. renderMarkdown escapes first, so its output goes out as-is. */
export function mdBlock(source: string, cls = 'md-body'): string {
  const html = renderMarkdown(source);
  return html ? `<div class="${cls}">${html}</div>` : '';
}

/** Short opening with the full text one click away. No JavaScript involved. */
export function mdDetails(source: string, limit = 220): string {
  if (!source.trim()) return '';
  const excerpt = markdownExcerpt(source, limit);
  const full = renderMarkdown(source);
  // Nothing was cut off — there is nothing to expand to.
  if (!excerpt.endsWith('…')) return `<div class="md-body">${full}</div>`;
  return `<details class="md-more"><summary>${escapeHtml(excerpt)}</summary><div class="md-body">${full}</div></details>`;
}

/**
 * Textarea plus a preview tab. The preview is rendered by the server through the very
 * same renderMarkdown the public page uses, so the two can never drift apart.
 */
export function mdEditor(name: string, label: string, value: string, rows = 12): string {
  return `<div class="md-editor" data-md>
  <p class="upload-label">${escapeHtml(label)}</p>
  <div class="md-tabs" role="tablist">
    <button class="md-tab active" type="button" data-md-tab="write">Текст</button>
    <button class="md-tab" type="button" data-md-tab="preview">Предпросмотр</button>
  </div>
  <textarea name="${escapeHtml(name)}" rows="${rows}" data-md-source>${escapeHtml(value)}</textarea>
  <div class="md-preview md-body" data-md-preview hidden></div>
  <small class="hint">Markdown: # заголовок, **жирный**, *курсив*, <code class="mono">\`код\`</code>, списки, &gt; цитата, [ссылка](https://…).</small>
</div>`;
}

/** Tiles / table switch. Server-rendered links — no client JavaScript, no CSP surface. */
export function viewToggle(current: 'tiles' | 'table', href: (mode: 'tiles' | 'table') => string): string {
  const item = (mode: 'tiles' | 'table', label: string): string =>
    mode === current
      ? `<span class="view-option active" aria-current="true">${label}</span>`
      : `<a class="view-option" href="${escapeHtml(href(mode))}">${label}</a>`;
  return `<div class="view-toggle" role="group" aria-label="Вид">${item('tiles', '▦ Плитка')}${item('table', '☰ Таблица')}</div>`;
}

/**
 * The "author wanted" line. When the family has a note, the label is underlined, ends
 * with an "i" mark and reveals the rendered note on hover or keyboard focus — CSS only.
 * The wrappers are <div>s on purpose: the note renders to <p>/<ul>, and a block element
 * inside a <p> or <span> ancestor would make the HTML parser close that ancestor early.
 */
export function wantedBadge(label: string, note: string): string {
  if (!note.trim()) return `<div class="wanted"><span class="badge wanted">${escapeHtml(label)}</span></div>`;
  return `<div class="wanted wanted-info" tabindex="0">
  <span class="badge wanted"><span class="wanted-label">${escapeHtml(label)}</span><span class="info-mark" aria-hidden="true">i</span></span>
  <div class="wanted-pop md-body" role="tooltip">${renderMarkdown(note)}</div>
</div>`;
}
