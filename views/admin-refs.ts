/** Generic list and edit pages for the reference tables, driven by REF_SPECS. */
import type { Family, RefRow } from '../db.ts';
import type { RefField, RefSpec } from '../refs.ts';
import type { User } from '../db.ts';
import { escapeHtml } from '../http.ts';
import { layout } from './layout.ts';
import { alerts, imageUrl, mdEditor, plural } from './parts.ts';
import { nav } from './admin.ts';

const str = (row: RefRow | null, name: string): string => escapeHtml(row ? (row[name] ?? '') : '');

function cell(spec: RefSpec, row: RefRow, name: string, families: Family[]): string {
  if (name === 'image') {
    const image = String(row.image ?? '');
    return image
      ? `<img src="${escapeHtml(imageUrl(image))}" alt="" loading="lazy">`
      : '<span class="thumb-empty"></span>';
  }
  if (name === 'family_id') {
    const family = families.find((f) => f.id === Number(row.family_id));
    return escapeHtml(family?.name ?? '');
  }
  if (name === 'name') {
    return `<a href="/admin/ref/${spec.table}/${row.id}">${escapeHtml(row.name ?? '')}</a>`;
  }
  if (name === 'slug') return `<small class="mono">${escapeHtml(row[name] ?? '')}</small>`;
  return escapeHtml(row[name] ?? '');
}

const HEADERS: Record<string, string> = {
  image: '',
  name: 'Название',
  slug: 'Адрес',
  years: 'Годы',
  url_template: 'URL запуска',
  family_id: 'Семейство',
};

export function refListPage(
  user: User,
  spec: RefSpec,
  rows: RefRow[],
  families: Family[],
  counts: Map<number, number>,
  notice = '',
  error = '',
): string {
  const columns = spec.table === 'models' ? ['family_id', ...spec.listFields] : spec.listFields;

  const body = `
<section class="admin-head">
  <h1>${escapeHtml(spec.title)}</h1>
  <form class="filters" method="get" action="/admin/ref/${spec.table}">
    <a class="button primary" href="/admin/ref/${spec.table}/new">Добавить</a>
  </form>
</section>
${alerts(error, notice)}
${spec.reorderable && rows.length > 1 ? '<p class="hint">Порядок строк — порядок показа на сайте. Перетащите строку или воспользуйтесь стрелками.</p>' : ''}
<p class="save-status" data-status></p>
<table class="admin-table"${spec.reorderable ? ` data-reorder="${spec.table}"` : ''}>
  <thead><tr>
    ${spec.reorderable ? '<th class="reorder-col"></th>' : ''}
    ${columns.map((c) => `<th>${escapeHtml(HEADERS[c] ?? c)}</th>`).join('')}
    <th>Программ</th>
  </tr></thead>
  <tbody>
    ${rows
      .map(
        (row) => `<tr${spec.reorderable ? ` draggable="true" data-id="${row.id}"` : ''}>
      ${spec.reorderable ? `<td class="reorder-col">
        <span class="reorder-handle" title="Перетащите строку">⠿</span>
        <button class="linkish" type="button" data-move="up" title="Выше">↑</button>
        <button class="linkish" type="button" data-move="down" title="Ниже">↓</button>
      </td>` : ''}
      ${columns.map((c) => `<td${c === 'image' ? ' class="thumb"' : ''}>${cell(spec, row, c, families)}</td>`).join('')}
      <td>${counts.get(Number(row.id)) ?? 0}</td>
    </tr>`,
      )
      .join('')}
  </tbody>
</table>
${rows.length === 0 ? `<p class="empty">Пока пусто. <a href="/admin/ref/${spec.table}/new">Добавьте первую запись</a>.</p>` : ''}`;

  return layout(
    { title: spec.title, nav: nav(user), bodyClass: 'admin', scripts: ['admin.js'] },
    body,
  );
}

/** The upload routes speak singular entity names: families -> family, models -> model. */
const uploadEntity = (spec: RefSpec): string => (spec.table === 'families' ? 'family' : 'model');

function fieldInput(
  field: RefField,
  row: RefRow | null,
  families: Family[],
  familyId: number,
  entity = '',
): string {
  const common = `name="${field.name}"${field.maxLength ? ` maxlength="${field.maxLength}"` : ''}${
    field.required ? ' required' : ''
  }${field.placeholder ? ` placeholder="${escapeHtml(field.placeholder)}"` : ''}`;
  const hint = field.hint ? `<small class="hint">${escapeHtml(field.hint)}</small>` : '';

  switch (field.type) {
    case 'family': {
      const selected = row ? Number(row.family_id) : familyId;
      return `<label>${escapeHtml(field.label)}${field.required ? ' *' : ''}
        <select ${common}>${families
          .map((f) => `<option value="${f.id}"${f.id === selected ? ' selected' : ''}>${escapeHtml(f.name)}</option>`)
          .join('')}</select>
      </label>${hint}`;
    }
    case 'markdown':
      return mdEditor(field.name, field.label, row ? String(row[field.name] ?? '') : '', 8) + hint;
    case 'image': {
      const image = row ? String(row.image ?? '') : '';
      return `<div class="upload">
        <p class="upload-label">${escapeHtml(field.label)}</p>
        ${image ? `<img class="preview" src="${escapeHtml(imageUrl(image))}" alt="">` : '<div class="preview preview-empty"></div>'}
        ${row
          ? `<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" data-upload="image">
             ${image ? `<button class="linkish danger" type="button" data-clear="${entity}/${escapeHtml(String(row.id))}/image">удалить картинку</button>` : ''}`
          : '<small>Сохраните запись, чтобы загрузить картинку.</small>'}
      </div>`;
    }
    case 'slug':
      return `<label>${escapeHtml(field.label)}
        <input type="text" ${common} value="${str(row, field.name)}" pattern="[a-z0-9-]*">
      </label>${hint}`;
    default:
      return `<label>${escapeHtml(field.label)}${field.required ? ' *' : ''}
        <input type="text" ${common} value="${str(row, field.name)}">
      </label>${hint}`;
  }
}

export function refEditPage(
  user: User,
  spec: RefSpec,
  row: RefRow | null,
  families: Family[],
  options: { familyId?: number; error?: string; childModels?: RefRow[]; programCount?: number } = {},
): string {
  const isNew = row === null;
  const id = row ? Number(row.id) : 0;
  const title = isNew ? `${spec.titleOne}: новая запись` : String(row.name ?? spec.titleOne);

  if (spec.scopedToFamily && families.length === 0) {
    return layout({ title: spec.titleOne, nav: nav(user), bodyClass: 'admin' }, `
<section class="panel narrow">
  <h1>Сначала нужно семейство</h1>
  <p>Модель принадлежит семейству, а их пока нет.</p>
  <p><a class="button primary" href="/admin/ref/families/new">Создать семейство</a></p>
</section>`);
  }

  const childTable = options.childModels
    ? `<section class="panel">
  <h2>Модели семейства</h2>
  ${options.childModels.length
    ? `<table class="admin-table" data-reorder="models">
    <thead><tr><th class="reorder-col"></th><th></th><th>Название</th><th>Годы</th><th>Адрес</th></tr></thead>
    <tbody>
      ${options.childModels
        .map(
          (m) => `<tr draggable="true" data-id="${m.id}">
        <td class="reorder-col">
          <span class="reorder-handle" title="Перетащите строку">⠿</span>
          <button class="linkish" type="button" data-move="up" title="Выше">↑</button>
          <button class="linkish" type="button" data-move="down" title="Ниже">↓</button>
        </td>
        <td class="thumb">${m.image ? `<img src="${escapeHtml(imageUrl(String(m.image)))}" alt="" loading="lazy">` : '<span class="thumb-empty"></span>'}</td>
        <td><a href="/admin/ref/models/${m.id}">${escapeHtml(m.name ?? '')}</a></td>
        <td>${escapeHtml(m.years ?? '')}</td>
        <td><small class="mono">${escapeHtml(m.slug ?? '')}</small></td>
      </tr>`,
        )
        .join('')}
    </tbody>
  </table>`
    : '<p class="muted">Моделей пока нет.</p>'}
  <p><a class="button" href="/admin/ref/models/new?family_id=${id}">+ модель</a></p>
</section>`
    : '';

  const body = `
<form class="editor" method="post" action="/admin/ref/${spec.table}/save" data-entity="${uploadEntity(spec)}"${row ? ` data-id="${id}"` : ''}>
  <input type="hidden" name="id" value="${row ? id : ''}">
  <header class="editor-head">
    <h1>${escapeHtml(title)}</h1>
    <div class="editor-actions">
      <a class="button" href="/admin/ref/${spec.table}">К списку</a>
      <button class="button primary" type="submit">Сохранить</button>
    </div>
  </header>
  ${alerts(options.error ?? '')}
  <p class="save-status" data-status></p>
  <div class="editor-grid">
    <section class="panel">
      <h2>${escapeHtml(spec.titleOne)}</h2>
      ${spec.fields
        .filter((f) => f.type !== 'image')
        .map((f) => fieldInput(f, row, families, options.familyId ?? 0))
        .join('\n')}
    </section>
    ${spec.fields.some((f) => f.type === 'image')
      ? `<section class="panel">
      <h2>Картинка</h2>
      ${spec.fields
        .filter((f) => f.type === 'image')
        .map((f) => fieldInput(f, row, families, 0, uploadEntity(spec)))
        .join('')}
    </section>`
      : ''}
    ${childTable}
  </div>
  </form>
${row
    ? `<form class="danger-zone" method="post" action="/admin/ref/${spec.table}/delete/${id}" data-confirm="${escapeHtml(deleteConfirm(spec, row, options.programCount ?? 0))}">
  <button class="button danger" type="submit">Удалить</button>
</form>`
    : ''}`;

  return layout(
    { title, nav: nav(user), bodyClass: 'admin', scripts: ['admin.js'] },
    body,
  );
}

function deleteConfirm(spec: RefSpec, row: RefRow, programCount: number): string {
  const name = String(row.name ?? '');
  if (spec.table === 'models' && programCount > 0) {
    return `Удалить «${name}»? Модель указана у ${programCount} ${plural(programCount, 'программы', 'программ', 'программ')} — связь будет снята.`;
  }
  if (spec.table === 'emulators' && programCount > 0) {
    return `Удалить «${name}»? Кнопка запуска исчезнет у ${programCount} ${plural(
      programCount,
      'программы',
      'программ',
      'программ',
    )}, загруженные для него файлы будут удалены.`;
  }
  if (spec.table === 'families') {
    return `Удалить «${name}» вместе с его моделями?`;
  }
  return `Удалить «${name}»?`;
}

