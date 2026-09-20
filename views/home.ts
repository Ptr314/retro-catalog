/** Home page: the families, as tiles or as a table. */
import { config } from '../config.ts';
import type { Family } from '../db.ts';
import { escapeHtml } from '../http.ts';
import { markdownExcerpt } from '../markdown.ts';
import { layout } from './layout.ts';
import { imageTag, plural, viewToggle } from './parts.ts';
import type { ViewMode } from './catalog.ts';

export type FamilyCard = Family & { programs: number; models: number };

function meta(f: FamilyCard): string {
  return [
    f.models ? `${f.models} ${plural(f.models, 'модель', 'модели', 'моделей')}` : '',
    `${f.programs} ${plural(f.programs, 'программа', 'программы', 'программ')}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

function tile(f: FamilyCard): string {
  return `<article class="card family-card">
  <a class="card-shot" href="/${escapeHtml(f.slug)}">${imageTag(f.image, f.name, 'shot', f.name)}</a>
  <div class="card-body">
    <h3><a href="/${escapeHtml(f.slug)}">${escapeHtml(f.name)}</a></h3>
    <p class="card-meta">${escapeHtml(meta(f))}</p>
  </div>
</article>`;
}

function row(f: FamilyCard): string {
  return `<article class="family-row">
  <a class="family-row-shot" href="/${escapeHtml(f.slug)}">${imageTag(f.image, f.name, 'shot-small', f.name)}</a>
  <div class="family-row-body">
    <h3><a href="/${escapeHtml(f.slug)}">${escapeHtml(f.name)}</a></h3>
    <p class="card-meta">${escapeHtml(meta(f))}</p>
    ${f.description ? `<p class="family-row-desc">${escapeHtml(markdownExcerpt(f.description, 260))}</p>` : ''}
  </div>
</article>`;
}

export function homePage(families: FamilyCard[], view: ViewMode): string {
  const body = families.length === 0
    ? '<p class="empty">Каталог пока пуст. Семейства заводятся в <a href="/admin">админке</a>.</p>'
    : view === 'table'
      ? `<div class="family-rows">${families.map(row).join('')}</div>`
      : `<div class="grid">${families.map(tile).join('\n')}</div>`;

  return layout(
    { description: config.siteTagline },
    `<section class="toolbar">
  <div>
    <h1 class="home-title">Выберите компьютер</h1>
    <p class="count">${escapeHtml(config.siteTagline)}</p>
  </div>
  <div class="toolbar-right">
    <p class="count"><a href="/catalog">все программы</a></p>
    ${viewToggle(view, (mode) => `/?view=${mode}`)}
  </div>
</section>
${body}`,
  );
}
