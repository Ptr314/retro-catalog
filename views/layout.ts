import { config } from '../config.ts';
import { escapeHtml } from '../http.ts';

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
<link rel="stylesheet" href="/static/style.css">
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
  <nav class="site-nav">${opts.nav ?? ''}</nav>
</header>
<main class="site-main">
${body}
</main>
<footer class="site-footer">
  <span>${escapeHtml(config.siteName)}</span>
  <a href="/admin">админка</a>
</footer>
${(opts.scripts ?? []).map((name) => `<script src="/static/${escapeHtml(name)}" defer></script>`).join('\n')}
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
