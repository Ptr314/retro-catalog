import { config } from '../config.ts';
import type { Category, Emulator, EmulatorFile, Family, Model, ProgramRow, Screenshot, Stats, User } from '../db.ts';
import { escapeHtml, formatBytes } from '../http.ts';
import { layout } from './layout.ts';
import { alerts, categoryLabel, imageUrl, mdEditor, pager, plural, programUrl } from './parts.ts';

export const adminName = (user: User): string => user.display_name || user.username;

export function nav(user: User): string {
  return `
  <a href="/">каталог</a>
  <a href="/admin">программы</a>
  <a href="/admin/ref/families">семейства</a>
  <a href="/admin/ref/models">модели</a>
  <a href="/admin/ref/emulators">эмуляторы</a>
  <a href="/admin/ref/categories">категории</a>
  <a href="/admin/users">админы</a>
  <a href="/admin/password">${escapeHtml(adminName(user))}</a>
  <form class="inline" method="post" action="/admin/logout"><button class="linkish" type="submit">выйти</button></form>`;
}

export function loginPage(error = '', username = ''): string {
  return layout({ title: 'Вход' }, `
<section class="panel narrow">
  <h1>Вход в админку</h1>
  ${alerts(error)}
  <form method="post" action="/admin/login" class="stack">
    <label>Логин
      <input type="text" name="username" value="${escapeHtml(username)}" autocomplete="username" required autofocus>
    </label>
    <label>Пароль
      <input type="password" name="password" autocomplete="current-password" required>
    </label>
    <button class="button primary" type="submit">Войти</button>
  </form>
</section>`);
}

export function passwordPage(user: User, message = '', error = ''): string {
  return layout({ title: 'Пароль', nav: nav(user) }, `
<section class="panel narrow">
  <h1>Смена пароля</h1>
  ${alerts(error, message)}
  <form method="post" action="/admin/password" class="stack">
    <label>Текущий пароль<input type="password" name="current" autocomplete="current-password" required></label>
    <label>Новый пароль<input type="password" name="next" autocomplete="new-password" minlength="8" required></label>
    <label>Ещё раз<input type="password" name="repeat" autocomplete="new-password" minlength="8" required></label>
    <button class="button primary" type="submit">Сменить</button>
  </form>
</section>`);
}

export function adminListPage(
  user: User,
  rows: ProgramRow[],
  total: number,
  page: number,
  pages: number,
  q: string,
  stats: Stats,
  families: Family[],
  familyId: number,
  missingOnly = false,
): string {
  const href = (n: number): string =>
    `/admin?page=${n}${familyId ? `&family=${familyId}` : ''}${missingOnly ? '&missing=1' : ''}${
      q ? `&q=${encodeURIComponent(q)}` : ''
    }`;
  // Rows an importer stopped finding in its source: it unpublishes them and leaves the rest to a person.
  const missingFilter = `<select name="missing" aria-label="Источник">
      <option value="">все записи</option>
      <option value="1"${missingOnly ? ' selected' : ''}>нет в источнике</option>
    </select>`;
  const familyFilter = `<select name="family" aria-label="Семейство">
      <option value="">все семейства</option>
      ${families
        .map((f) => `<option value="${f.id}"${f.id === familyId ? ' selected' : ''}>${escapeHtml(f.name)}</option>`)
        .join('')}
    </select>`;
  const newHref = familyId ? `/admin/new?family_id=${familyId}` : '/admin/new';

  const body = `
<section class="admin-head">
  <h1>Программы</h1>
  <ul class="stats">
    <li><b>${stats.programs}</b> ${plural(stats.programs, 'программа', 'программы', 'программ')}</li>
    <li><b>${stats.published}</b> опубликовано</li>
    <li><b>${stats.withFile}</b> со своим файлом</li>
    <li><b>${stats.families}</b> ${plural(stats.families, 'семейство', 'семейства', 'семейств')}</li>
    <li><b>${stats.emulators}</b> ${plural(stats.emulators, 'эмулятор', 'эмулятора', 'эмуляторов')}</li>
    <li><b>${stats.downloads}</b> скачиваний</li>
    <li><b>${stats.runs}</b> запусков</li>
  </ul>
  <form class="filters" method="get" action="/admin" data-autosubmit>
    ${familyFilter}
    ${missingFilter}
    <input class="search" type="search" name="q" value="${escapeHtml(q)}" placeholder="Поиск по каталогу">
    <button type="submit">Найти</button>
    <a class="button primary" href="${newHref}">Добавить программу</a>
  </form>
</section>
<table class="admin-table">
  <thead><tr><th></th><th>Название</th><th>Семейство</th><th>Категория</th><th>Год</th><th>Файл</th><th>Статус</th><th></th></tr></thead>
  <tbody>
    ${rows.map((p) => `<tr>
      <td class="thumb">${p.screenshot ? `<img src="${escapeHtml(imageUrl(p.screenshot))}" alt="" loading="lazy">` : '<span class="thumb-empty"></span>'}</td>
      <td><a href="/admin/edit/${p.id}">${escapeHtml(p.title)}</a><br><small class="mono">${escapeHtml(p.slug)}</small></td>
      <td>${escapeHtml(p.family_name)}</td>
      <td>${escapeHtml(categoryLabel(p))}</td>
      <td>${p.year ?? ''}</td>
      <td>${p.file_name ? `<span title="${escapeHtml(p.file_name)}">${escapeHtml(formatBytes(p.file_size) || 'есть')}</span>` : '<span class="muted">—</span>'}</td>
      <td>${p.published ? '<span class="badge ok">виден</span>' : '<span class="badge">скрыт</span>'}${p.promoted ? ' <span class="badge">продвигается</span>' : ''}${missingBadge(p)}</td>
      <td class="row-actions"><a href="${escapeHtml(programUrl(p))}">открыть</a></td>
    </tr>`).join('')}
  </tbody>
</table>
${rows.length === 0 ? '<p class="empty">Пока ничего нет. <a href="${newHref}">Добавьте первую программу</a>.</p>' : ''}
${pager(page, pages, href, total)}`;

  return layout({ title: 'Программы', nav: nav(user), bodyClass: 'admin', scripts: ['admin.js', 'filters.js'] }, body);
}

/** The lamp on a row its importer no longer finds in the source. '' for every other row. */
function missingBadge(p: ProgramRow): string {
  if (!p.missing_since) return '';
  return ` <span class="badge lost" title="Импорт «${escapeHtml(p.integration)}» не находит запись с ${escapeHtml(
    p.missing_since.slice(0, 10),
  )}">нет в источнике</span>`;
}

export type EditData = {
  families: Family[];
  /** Both levels; the form splits them by parent_id. */
  categories: Category[];
  screenshots: Screenshot[];
  models: Model[];
  emulators: Emulator[];
  emulatorFiles: EmulatorFile[];
  selectedModels: number[];
  /** The program's family, or the one a new program was started from; 0 = none chosen. */
  familyId: number;
};

/** The address the emulator (or anyone else) fetches the file by. */
function externalUrl(url: string): string {
  return `<p class="external-url"><input class="mono" type="text" value="${escapeHtml(url)}" readonly data-copy-source>
    <button class="linkish" type="button" data-copy>копировать</button></p>`;
}

/**
 * One emulator, two ways to launch: an uploaded file or a ready-made address.
 * The file wins when both are filled in, so the slot says so out loud.
 * `p` is null for a program that has not been saved yet — uploading needs an id,
 * typing an address does not, so only the file control waits for the first save.
 */
function emulatorSlot(p: ProgramRow | null, emu: Emulator, files: EmulatorFile[]): string {
  const slot = files.find((f) => f.emulator_id === emu.id);
  const file = slot?.file_name ?? '';
  const url = slot?.file_url ?? '';

  return `<div class="upload emu-slot">
  <p class="upload-label">${escapeHtml(emu.name)}</p>
  ${file
    ? `<p class="mono current-file">${escapeHtml(file)} <span class="muted">${escapeHtml(
        formatBytes(slot!.file_size),
      )}</span></p>
       ${externalUrl(`${config.siteUrl}/files/${file}`)}`
    : '<p class="muted">файл не загружен</p>'}
  ${p
    ? `<input type="file" data-upload-emu="${emu.id}">
       ${file ? `<button class="linkish danger" type="button" data-clear="program/${p.id}/emu/${emu.id}">удалить файл</button>` : ''}`
    : '<small>Файл можно загрузить после сохранения.</small>'}
  <label>Готовая ссылка на запуск
    <input type="url" name="emu_url_${emu.id}" value="${escapeHtml(url)}" maxlength="500" placeholder="https://…">
  </label>
  <small class="hint">${
    file && url
      ? 'Загружен файл — запуск идёт по нему через шаблон эмулятора. Ссылка сработает, если файл удалить.'
      : 'Полный адрес страницы запуска: открывается как есть, шаблон эмулятора к нему не применяется.'
  }</small>
  ${slot ? `<p class="muted">запусков: ${slot.runs}</p>` : ''}
</div>`;
}

/**
 * Screenshots of a saved program: a reorderable table (the first row is the cover shown
 * in tiles) plus a picker that takes several files at once. The picked files are sent
 * after the form is saved, like every other upload in this editor.
 */
function screenshotsBlock(p: ProgramRow | null, shots: Screenshot[]): string {
  const table = p && shots.length
    ? `<table class="admin-table shots-table" data-reorder="shots" data-reorder-url="/admin/reorder-shots/${p.id}">
      <tbody>
        ${shots
          .map(
            (shot) => `<tr draggable="true" data-id="${shot.id}">
          <td class="reorder-col">
            <span class="reorder-handle" title="Перетащите строку">⠿</span>
            <button class="linkish" type="button" data-move="up" title="Выше">↑</button>
            <button class="linkish" type="button" data-move="down" title="Ниже">↓</button>
          </td>
          <td class="thumb"><img src="${escapeHtml(imageUrl(shot.file_name))}" alt="" loading="lazy"></td>
          <td class="row-actions"><button class="linkish danger" type="button" data-clear="program/${p.id}/shot/${shot.id}">удалить</button></td>
        </tr>`,
          )
          .join('')}
      </tbody>
    </table>
    ${shots.length > 1 ? '<small>Первый скриншот — обложка в каталоге. Порядок меняется перетаскиванием или стрелками.</small>' : ''}`
    : '<div class="preview preview-empty"></div>';

  return `<div class="upload">
        <p class="upload-label">Скриншоты</p>
        ${table}
        <input type="file" name="screenshotFile" accept="image/png,image/jpeg,image/gif,image/webp" data-upload="screenshot" multiple>
        <small>PNG, JPEG, GIF или WebP, до ${Math.round(config.maxScreenshotBytes / 1024)} КБ каждый; можно выбрать несколько.</small>
      </div>`;
}

export function editPage(user: User, p: ProgramRow | null, data: EditData, error = ''): string {
  const v = (value: string | null | undefined): string => escapeHtml(value ?? '');
  const isNew = p === null;

  if (data.families.length === 0) {
    return layout({ title: 'Новая программа', nav: nav(user), bodyClass: 'admin' }, `
<section class="panel narrow">
  <h1>Сначала нужно семейство</h1>
  <p>Программа обязательно принадлежит семейству компьютеров, а их пока нет.</p>
  <p><a class="button primary" href="/admin/ref/families/new">Создать семейство</a></p>
</section>`);
  }

  const familyOptions = data.families
    .map((f) => `<option value="${f.id}"${f.id === data.familyId ? ' selected' : ''}>${escapeHtml(f.name)}</option>`)
    .join('');

  // programs.category_id points at a subcategory or, failing that, at a top-level category.
  const topCategoryId = p ? (p.category_parent_id ?? p.category_id ?? 0) : 0;
  const subcategoryId = p && p.category_parent_id ? (p.category_id ?? 0) : 0;
  const topCategories = data.categories.filter((c) => !c.parent_id);

  const categoryOptions = [`<option value="">— без категории —</option>`]
    .concat(
      topCategories.map(
        (c) => `<option value="${c.id}"${topCategoryId === c.id ? ' selected' : ''}>${escapeHtml(c.name)}</option>`,
      ),
    )
    .join('');

  // Every subcategory, grouped by parent: admin.js leaves only the chosen category's group
  // and disables the list when there is none. Without JS the groups are all there, labelled.
  const subcategoryOptions = [`<option value="">— нет —</option>`]
    .concat(
      topCategories.map((top) => {
        const children = data.categories.filter((c) => c.parent_id === top.id);
        if (children.length === 0) return '';
        return `<optgroup label="${escapeHtml(top.name)}" data-parent="${top.id}">${children
          .map((c) => `<option value="${c.id}"${subcategoryId === c.id ? ' selected' : ''}>${escapeHtml(c.name)}</option>`)
          .join('')}</optgroup>`;
      }),
    )
    .join('');

  const integration = p?.integration
    ? `<div class="integration">
        <p class="muted">Импортировано: <span class="mono">${escapeHtml(p.integration)} / ${escapeHtml(p.external_id)}</span></p>
        ${p.missing_since
          ? `<p><span class="badge lost">нет в источнике с ${escapeHtml(p.missing_since.slice(0, 10))}</span></p>
        <label class="check"><input type="checkbox" name="clear_missing" value="1"> Снять отметку «нет в источнике»</label>
        <small class="hint">С отметкой импорт программу больше не трогает: её можно снова показать в каталоге. Без отметки следующий импорт, не найдя запись, скроет программу опять.</small>`
          : ''}
      </div>`
    : '';

  // Grouped by family so admin.js can hide the groups that do not match the chosen family.
  const modelGroups = data.families
    .map((f) => {
      const owned = data.models.filter((m) => m.family_id === f.id);
      if (owned.length === 0) return '';
      return `<fieldset class="model-group" data-family="${f.id}">
      <legend>Модели: ${escapeHtml(f.name)}</legend>
      ${owned
        .map(
          (m) => `<label class="check"><input type="checkbox" name="models" value="${m.id}"${
            data.selectedModels.includes(m.id) ? ' checked' : ''
          }> ${escapeHtml(m.name)}</label>`,
        )
        .join('')}
    </fieldset>`;
    })
    .join('');

  const body = `
<form class="editor" method="post" action="/admin/save" data-editor data-entity="program"${p ? ` data-id="${p.id}"` : ''}>
  <input type="hidden" name="id" value="${p ? p.id : ''}">
  <header class="editor-head">
    <h1>${isNew ? 'Новая программа' : escapeHtml(p.title)}</h1>
    <div class="editor-actions">
      ${p ? `<a class="button" href="${escapeHtml(programUrl(p))}" target="_blank" rel="noopener">Посмотреть</a>` : ''}
      <a class="button" href="${data.familyId ? `/admin?family=${data.familyId}` : '/admin'}">К списку</a>
      <button class="button primary" type="submit">Сохранить</button>
    </div>
  </header>
  ${alerts(error)}
  <p class="save-status" data-status></p>

  <div class="editor-grid">
    <section class="panel">
      <h2>Описание</h2>
      <label>Название *<input type="text" name="title" value="${v(p?.title)}" required maxlength="200"></label>
      <label>Адрес страницы (slug)
        <input type="text" name="slug" value="${v(p?.slug)}" maxlength="80" placeholder="сгенерируется из названия" pattern="[a-z0-9-]*">
      </label>
      <div class="two">
        <label>Семейство *<select name="family_id" required data-family-select>${familyOptions}</select></label>
        <label>Год<input type="number" name="year" value="${p?.year ?? ''}" min="1950" max="2100"></label>
      </div>
      <div class="two">
        <label>Категория<select name="category_id" data-category-select>${categoryOptions}</select></label>
        <label>Подкатегория<select name="subcategory_id" data-subcategory-select>${subcategoryOptions}</select></label>
      </div>
      <label>Автор<input type="text" name="author" value="${v(p?.author)}" maxlength="120"></label>
      <label class="check"><input type="checkbox" name="author_wanted" value="1"${p?.author_wanted ? ' checked' : ''}> Разыскивается автор</label>
      <div class="two">
        <label>Графика<input type="text" name="graphics" value="${v(p?.graphics)}" maxlength="200"></label>
        <label>Музыка<input type="text" name="music" value="${v(p?.music)}" maxlength="200"></label>
      </div>
      <label>URL (автор/источник)
        <input type="url" name="source_url" value="${v(p?.source_url)}" maxlength="500" placeholder="https://…">
      </label>
      ${mdEditor('description', 'Описание', p?.description ?? '')}
      <label>Метаданные
        <textarea class="mono" name="metadata" rows="5" maxlength="20000" placeholder="ключ:значение">${v(p?.metadata)}</textarea>
      </label>
      <small class="hint">По строке «ключ:значение». Заполняются импортом; значения доступны шаблону эмулятора как {meta:ключ}.</small>
      ${integration}
      <label class="check"><input type="checkbox" name="published" value="1"${!p || p.published ? ' checked' : ''}> Показывать в каталоге</label>
      <label class="check"><input type="checkbox" name="promoted" value="1"${p?.promoted ? ' checked' : ''}> Продвигать — первой в «Сначала новые»</label>
      ${modelGroups
        ? `<div data-model-groups>${modelGroups}</div>`
        : '<small class="hint">Моделей пока нет. <a href="/admin/ref/models/new">Добавить модель</a>.</small>'}
    </section>

    <section class="panel">
      <h2>Файлы для эмуляторов</h2>
      ${data.emulators.length === 0
        ? '<p class="muted">Эмуляторов пока нет. <a href="/admin/ref/emulators/new">Добавьте эмулятор</a>.</p>'
        : data.emulators.map((emu) => emulatorSlot(p, emu, data.emulatorFiles)).join('')}
    </section>

    <section class="panel">
      <h2>Файлы</h2>
      ${screenshotsBlock(p, data.screenshots)}
      <hr>
      <div class="upload">
        <p class="upload-label">Файл для скачивания</p>
        ${p?.file_name
          ? `<p class="mono current-file">${escapeHtml(p.file_name)} <span class="muted">${escapeHtml(formatBytes(p.file_size))}</span></p>`
          : '<p class="muted">не загружен</p>'}
        <input type="file" name="programFile" data-upload="file">
        <small>Образ диска, лента, архив — до ${Math.round(config.maxFileBytes / 1024 / 1024)} МБ.</small>
        ${p?.file_name ? `<button class="linkish danger" type="button" data-clear="program/${p.id}/file">удалить файл</button>` : ''}
        ${p?.file_name ? externalUrl(`${config.siteUrl}/files/${p.file_name}`) : ''}
      </div>
    </section>

  </div>

  ${p ? `</form>
<form class="danger-zone" method="post" action="/admin/delete/${p.id}" data-confirm="Удалить «${escapeHtml(p.title)}» вместе с файлами?">
  <button class="button danger" type="submit">Удалить программу</button>
</form>` : '</form>'}`;

  return layout(
    { title: isNew ? 'Новая программа' : 'Правка', nav: nav(user), bodyClass: 'admin', scripts: ['admin.js'] },
    body,
  );
}
