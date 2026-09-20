/** A single program: /p/<slug>. */
import type { EmulatorFile, Family, Model, ProgramRow } from '../db.ts';
import { escapeHtml, formatBytes } from '../http.ts';
import { markdownExcerpt } from '../markdown.ts';
import { layout } from './layout.ts';
import { imageTag, mdBlock } from './parts.ts';

export function programPage(
  p: ProgramRow,
  family: Family | null,
  models: Model[],
  slots: EmulatorFile[],
): string {
  const familyLink = family
    ? `<a href="/${escapeHtml(family.slug)}">${escapeHtml(p.family_name)}</a>`
    : escapeHtml(p.family_name);

  const modelLinks = family
    ? models.map((m) => `<a href="/${escapeHtml(family.slug)}/${escapeHtml(m.slug)}">${escapeHtml(m.name)}</a>`).join(', ')
    : models.map((m) => escapeHtml(m.name)).join(', ');

  // Values are escaped where they are built; this table mixes links and plain text.
  const rows: [string, string][] = [
    ['Семейство', familyLink],
    ['Модели', modelLinks],
    ['Категория', escapeHtml(p.category_name ?? '')],
    ['Год', p.year ? String(p.year) : ''],
    ['Автор', p.author_wanted ? '<span class="badge wanted">разыскивается</span>' : escapeHtml(p.author)],
    ['Размер', escapeHtml(formatBytes(p.file_size))],
  ].filter((row) => row[1] !== '') as [string, string][];

  const actions = [
    ...slots.map(
      (slot) =>
        `<a class="button primary" href="/run/${escapeHtml(p.slug)}/${slot.emulator_id}" target="_blank" rel="noopener">▶ Запустить в ${escapeHtml(
          slot.emulator_name,
        )}</a>`,
    ),
    p.file_name ? `<a class="button" href="/dl/${escapeHtml(p.slug)}">↓ Скачать</a>` : '',
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
      ${rows.map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${v}</dd></div>`).join('')}
    </dl>
    <div class="actions">${actions || '<p class="empty">Файл пока не добавлен.</p>'}</div>
    ${mdBlock(p.description, 'description md-body')}
    <p class="counters">скачиваний: ${p.downloads} · запусков: ${p.runs}</p>
  </div>
</article>
<p class="back"><a href="${family ? `/${escapeHtml(family.slug)}` : '/catalog'}">← ко всем программам${
      family ? ` ${escapeHtml(family.name)}` : ''
    }</a></p>`,
  );
}
