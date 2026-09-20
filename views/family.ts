/** Headers for /<family> and /<family>/<model>; the catalog body follows below them. */
import type { Family, Model } from '../db.ts';
import { escapeHtml } from '../http.ts';
import { imageTag, mdBlock } from './parts.ts';

export function familyHeader(family: Family, models: Model[], currentModel: Model | null): string {
  const chips = models
    .map((m) => {
      const href = `/${escapeHtml(family.slug)}/${escapeHtml(m.slug)}`;
      const active = currentModel && currentModel.id === m.id;
      return active
        ? `<span class="chip active">${escapeHtml(m.name)}</span>`
        : `<a class="chip" href="${href}">${escapeHtml(m.name)}</a>`;
    })
    .join('');

  const subject = currentModel ?? family;
  const years = currentModel?.years ? `<p class="card-meta">${escapeHtml(currentModel.years)}</p>` : '';

  return `<nav class="crumbs">
  <a href="/">все семейства</a>
  ${currentModel ? `<span>/</span><a href="/${escapeHtml(family.slug)}">${escapeHtml(family.name)}</a>` : ''}
</nav>
<header class="family-head">
  <div class="family-head-shot">${imageTag(subject.image, subject.name, 'shot-big', subject.name)}</div>
  <div class="family-head-body">
    <h1>${escapeHtml(currentModel ? `${family.name} · ${currentModel.name}` : family.name)}</h1>
    ${years}
    ${mdBlock(subject.description)}
    ${models.length ? `<div class="chips">${chips}</div>` : ''}
  </div>
</header>`;
}
