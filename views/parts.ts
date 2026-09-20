/** Small pieces shared by the public pages and the admin. */
import { escapeHtml } from '../http.ts';

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
