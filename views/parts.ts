/** Small pieces shared by the public pages and the admin. */
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

export function imageTag(name: string, alt: string, cls: string, fallback = ''): string {
  if (name) {
    return `<img class="${cls}" src="${escapeHtml(imageUrl(name))}" alt="${escapeHtml(alt)}" loading="lazy">`;
  }
  return `<div class="${cls} shot-empty"><span>${escapeHtml(fallback || '?')}</span></div>`;
}

export function pager(page: number, pages: number, href: (page: number) => string, total = 0): string {
  if (pages <= 1) return '';
  return `<nav class="pager">
  ${page > 1 ? `<a href="${escapeHtml(href(page - 1))}">← назад</a>` : '<span></span>'}
  <span class="pager-pos">страница ${page} из ${pages}${total ? ` (${total})` : ''}</span>
  ${page < pages ? `<a href="${escapeHtml(href(page + 1))}">вперёд →</a>` : '<span></span>'}
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
