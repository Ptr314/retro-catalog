/** A single program: /<family>/<slug>. */
import type { EmulatorFile, Family, Model, ProgramRow, Screenshot } from '../db.ts';
import { escapeHtml, formatBytes } from '../http.ts';
import { markdownExcerpt } from '../markdown.ts';
import { layout } from './layout.ts';
import { categoryLabel, imageTag, mdBlock, wantedBadge } from './parts.ts';

/**
 * «Автор/Источник»: the link without its scheme, shortened. The scheme is re-checked
 * here as well — the save handler validates it, but rows can also arrive through the
 * import tools, and this value goes straight into an href.
 */
function sourceLink(url: string): string {
  if (!/^https?:\/\//i.test(url)) return '';
  const shown = url.replace(/^https?:\/\//i, '').replace(/\/$/, '');
  const label = shown.length > 48 ? `${shown.slice(0, 47)}…` : shown;
  return `<a href="${escapeHtml(url)}" target="_blank" rel="nofollow noopener">${escapeHtml(label)}</a>`;
}

/**
 * The tube. One screenshot (or none) is a plain picture. Several become a strip that
 * scrolls sideways one frame at a time: it works by swipe or scrollbar without any
 * script, and shots.js reveals the two arrow keys — each only while there is somewhere
 * to go in its direction, which is why both start out hidden.
 */
function shotBlock(p: ProgramRow, shots: Screenshot[]): string {
  if (shots.length < 2) {
    return imageTag(shots[0]?.file_name ?? p.screenshot, `Скриншот: ${p.title}`, 'shot-big', p.family_name);
  }
  const frames = shots
    .map((shot, i) => imageTag(shot.file_name, `Скриншот ${i + 1} из ${shots.length}: ${p.title}`, 'shot-big'))
    .join('');
  return `<div class="shots" data-shots tabindex="0" aria-label="Скриншоты: ${shots.length}">${frames}</div>
    <button class="shots-nav shots-prev" type="button" data-shots-prev aria-label="Предыдущий скриншот" hidden>‹</button>
    <button class="shots-nav shots-next" type="button" data-shots-next aria-label="Следующий скриншот" hidden>›</button>`;
}

export function programPage(
  p: ProgramRow,
  family: Family | null,
  models: Model[],
  slots: EmulatorFile[],
  shots: Screenshot[],
  canEdit = false,
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
    ['Категория', escapeHtml(categoryLabel(p))],
    ['Год', p.year ? String(p.year) : ''],
    ['Автор', p.author_wanted ? wantedBadge('разыскивается', p.family_wanted_note) : escapeHtml(p.author)],
    ['Графика', escapeHtml(p.graphics)],
    ['Музыка', escapeHtml(p.music)],
    ['Автор/Источник', sourceLink(p.source_url ?? '')],
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
    {
      title: p.title,
      description: markdownExcerpt(p.description, 200),
      scripts: shots.length > 1 ? ['shots.js'] : [],
    },
    `<article class="program">
  <div class="program-shot">${shotBlock(p, shots)}</div>
  <div class="program-info">
    ${canEdit
      ? `<div class="title-row">
      <h1>${escapeHtml(p.title)}</h1>
      <a class="button small" href="/admin/edit/${p.id}">Редактировать</a>
    </div>`
      : `<h1>${escapeHtml(p.title)}</h1>`}
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
