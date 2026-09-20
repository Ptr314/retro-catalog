import { statSync } from 'node:fs';
import { join } from 'node:path';
import { config, rootDir } from '../config.ts';
import { escapeHtml } from '../http.ts';

/**
 * /static/ is cached for an hour, so an edited stylesheet or script would reach
 * visitors late. The file's mtime in the query string makes every edit a new URL.
 */
function asset(name: string): string {
  let version = '0';
  try {
    version = Math.floor(statSync(join(rootDir, 'public', name)).mtimeMs).toString(36);
  } catch {
    // a missing file is the static route's problem, not the layout's
  }
  return `/static/${escapeHtml(name)}?v=${version}`;
}

export type LayoutOptions = {
  title?: string;
  description?: string;
  /** Rendered in the header's right side. */
  nav?: string;
  bodyClass?: string;
  /** Scripts from /static to pull in, e.g. ['admin.js']. */
  scripts?: string[];
};

export function layout(opts: LayoutOptions, body: string): string {
  const title = opts.title ? `${escapeHtml(opts.title)} — ${escapeHtml(config.siteName)}` : escapeHtml(config.siteName);
  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
${opts.description ? `<meta name="description" content="${escapeHtml(opts.description)}">` : ''}
<link rel="stylesheet" href="${asset('style.css')}">
<link rel="icon" href="/static/favicon.svg" type="image/svg+xml">
</head>
<body${opts.bodyClass ? ` class="${opts.bodyClass}"` : ''}>
<header class="site-header">
  <a class="brand" href="/">
    <span class="brand-mark">▮</span>
    <span class="brand-text">
      <strong>${escapeHtml(config.siteName)}</strong>
      <small>${escapeHtml(config.siteTagline)}</small>
    </span>
  </a>
  <nav class="site-nav">${opts.nav ?? '<a href="/">семейства</a><a href="/catalog">все программы</a>'}</nav>
</header>
<main class="site-main">
${body}
</main>
<footer class="site-footer">
  <span>${escapeHtml(config.siteName)}</span>
  <a href="/admin">админка</a>
</footer>
${(opts.scripts ?? []).map((name) => `<script src="${asset(name)}" defer></script>`).join('\n')}
</body>
</html>`;
}

export function errorPage(status: number, message: string): string {
  return layout({ title: `Ошибка ${status}` }, `
<section class="panel narrow center">
  <p class="error-code">${status}</p>
  <p class="error-text">${escapeHtml(message)}</p>
  <p><a class="button" href="/">На главную</a></p>
</section>`);
}
