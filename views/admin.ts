import { config } from '../config.ts';
import type { Program, User } from '../db.ts';
import { escapeHtml, formatBytes } from '../http.ts';
import { layout } from './layout.ts';

const nav = (user: User): string => `
  <a href="/">каталог</a>
  <a href="/admin/new">+ программа</a>
  <a href="/admin/password">${escapeHtml(user.username)}</a>
  <form class="inline" method="post" action="/admin/logout"><button class="linkish" type="submit">выйти</button></form>`;

export function loginPage(error = '', username = ''): string {
  return layout({ title: 'Вход' }, `
<section class="panel narrow">
  <h1>Вход в админку</h1>
  ${error ? `<p class="alert">${escapeHtml(error)}</p>` : ''}
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
  ${message ? `<p class="notice">${escapeHtml(message)}</p>` : ''}
  ${error ? `<p class="alert">${escapeHtml(error)}</p>` : ''}
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
  rows: Program[],
  total: number,
  page: number,
  pages: number,
  q: string,
  stats: { total: number; published: number; withFile: number; downloads: number; runs: number },
): string {
  const body = `
<section class="admin-head">
  <h1>Каталог</h1>
  <ul class="stats">
    <li><b>${stats.total}</b> записей</li>
    <li><b>${stats.published}</b> опубликовано</li>
    <li><b>${stats.withFile}</b> со своим файлом</li>
    <li><b>${stats.downloads}</b> скачиваний</li>
    <li><b>${stats.runs}</b> запусков</li>
  </ul>
  <form class="filters" method="get" action="/admin">
    <input class="search" type="search" name="q" value="${escapeHtml(q)}" placeholder="Поиск по каталогу">
    <button type="submit">Найти</button>
    <a class="button primary" href="/admin/new">Добавить программу</a>
  </form>
</section>
<table class="admin-table">
  <thead><tr><th></th><th>Название</th><th>Платформа</th><th>Год</th><th>Файл</th><th>Статус</th><th></th></tr></thead>
  <tbody>
    ${rows.map((p) => `<tr>
      <td class="thumb">${p.screenshot ? `<img src="/screenshots/${escapeHtml(p.screenshot)}" alt="" loading="lazy">` : '<span class="thumb-empty"></span>'}</td>
      <td><a href="/admin/edit/${p.id}">${escapeHtml(p.title)}</a><br><small class="mono">${escapeHtml(p.slug)}</small></td>
      <td>${escapeHtml(p.platform)}</td>
      <td>${p.year ?? ''}</td>
      <td>${p.file_name ? `<span title="${escapeHtml(p.file_name)}">${escapeHtml(formatBytes(p.file_size) || 'есть')}</span>` : p.download_url ? '<span class="muted">ссылка</span>' : '<span class="muted">—</span>'}</td>
      <td>${p.published ? '<span class="badge ok">виден</span>' : '<span class="badge">скрыт</span>'}</td>
      <td class="row-actions"><a href="/p/${escapeHtml(p.slug)}">открыть</a></td>
    </tr>`).join('')}
  </tbody>
</table>
${rows.length === 0 ? '<p class="empty">Пока ничего нет. <a href="/admin/new">Добавьте первую программу</a>.</p>' : ''}
${pages > 1 ? `<nav class="pager">
  ${page > 1 ? `<a href="/admin?page=${page - 1}${q ? `&q=${encodeURIComponent(q)}` : ''}">← назад</a>` : '<span></span>'}
  <span class="pager-pos">страница ${page} из ${pages} (${total})</span>
  ${page < pages ? `<a href="/admin?page=${page + 1}${q ? `&q=${encodeURIComponent(q)}` : ''}">вперёд →</a>` : '<span></span>'}
</nav>` : ''}`;

  return layout({ title: 'Админка', nav: nav(user), bodyClass: 'admin', adminScript: true }, body);
}

function datalist(id: string, values: string[]): string {
  return `<datalist id="${id}">${values.map((v) => `<option value="${escapeHtml(v)}"></option>`).join('')}</datalist>`;
}

export function editPage(user: User, p: Program | null, error = ''): string {
  const v = <K extends keyof Program>(key: K): string => escapeHtml(p ? (p[key] ?? '') : '');
  const isNew = p === null;

  const body = `
<form class="editor" method="post" action="/admin/save" data-editor>
  <input type="hidden" name="id" value="${p ? p.id : ''}">
  <header class="editor-head">
    <h1>${isNew ? 'Новая программа' : escapeHtml(p.title)}</h1>
    <div class="editor-actions">
      ${p ? `<a class="button" href="/p/${escapeHtml(p.slug)}" target="_blank" rel="noopener">Посмотреть</a>` : ''}
      <a class="button" href="/admin">К списку</a>
      <button class="button primary" type="submit">Сохранить</button>
    </div>
  </header>
  ${error ? `<p class="alert">${escapeHtml(error)}</p>` : ''}
  <p class="save-status" data-status></p>

  <div class="editor-grid">
    <section class="panel">
      <h2>Описание</h2>
      <label>Название *<input type="text" name="title" value="${v('title')}" required maxlength="200"></label>
      <label>Адрес страницы (slug)
        <input type="text" name="slug" value="${v('slug')}" maxlength="80" placeholder="сгенерируется из названия" pattern="[a-z0-9-]*">
      </label>
      <div class="two">
        <label>Платформа<input type="text" name="platform" value="${v('platform')}" list="platforms" maxlength="60">${datalist('platforms', config.platforms)}</label>
        <label>Категория<input type="text" name="category" value="${v('category')}" list="categories" maxlength="60">${datalist('categories', config.categories)}</label>
      </div>
      <div class="two">
        <label>Год<input type="number" name="year" value="${p?.year ?? ''}" min="1950" max="2100"></label>
        <label>Автор<input type="text" name="author" value="${v('author')}" maxlength="120"></label>
      </div>
      <div class="two">
        <label>Издатель<input type="text" name="publisher" value="${v('publisher')}" maxlength="120"></label>
        <label>Теги (через запятую)<input type="text" name="tags" value="${v('tags')}" maxlength="200"></label>
      </div>
      <label>Описание<textarea name="description" rows="8">${v('description')}</textarea></label>
      <label class="check"><input type="checkbox" name="published" value="1"${!p || p.published ? ' checked' : ''}> Показывать в каталоге</label>
    </section>

    <section class="panel">
      <h2>Файлы</h2>
      <div class="upload">
        <p class="upload-label">Скриншот</p>
        ${p?.screenshot ? `<img class="preview" src="/screenshots/${escapeHtml(p.screenshot)}" alt="">` : '<div class="preview preview-empty"></div>'}
        <input type="file" name="screenshotFile" accept="image/png,image/jpeg,image/gif,image/webp" data-upload="screenshot"${isNew ? '' : ` data-id="${p.id}"`}>
        <small>PNG, JPEG, GIF или WebP, до ${Math.round(config.maxScreenshotBytes / 1024)} КБ.</small>
        ${p?.screenshot ? `<button class="linkish danger" type="button" data-clear="screenshot" data-id="${p.id}">удалить скриншот</button>` : ''}
      </div>
      <hr>
      <div class="upload">
        <p class="upload-label">Файл программы</p>
        ${p?.file_name
          ? `<p class="mono current-file">${escapeHtml(p.file_name)} <span class="muted">${escapeHtml(formatBytes(p.file_size))}</span></p>`
          : '<p class="muted">не загружен</p>'}
        <input type="file" name="programFile" data-upload="file"${isNew ? '' : ` data-id="${p.id}"`}>
        <small>Образ диска, лента, архив — до ${Math.round(config.maxFileBytes / 1024 / 1024)} МБ.</small>
        ${p?.file_name ? `<button class="linkish danger" type="button" data-clear="file" data-id="${p.id}">удалить файл</button>` : ''}
      </div>
      <hr>
      <label>Внешняя ссылка на скачивание
        <input type="url" name="download_url" value="${v('download_url')}" placeholder="https://archive.org/…" maxlength="500">
      </label>
      <small class="hint">Если загружен свой файл, он имеет приоритет над внешней ссылкой.</small>
    </section>

    <section class="panel">
      <h2>Запуск в эмуляторе</h2>
      <p class="hint">Эмулятор открывается по адресу <code class="mono">${escapeHtml(config.emulator.baseUrl)}</code> и сам скачивает пакет по ссылке в параметре <code class="mono">${escapeHtml(config.emulator.param)}</code>.</p>
      <label class="check"><input type="checkbox" name="run_enabled" value="1"${!p || p.run_enabled ? ' checked' : ''}> Показывать кнопку «Запустить»</label>
      <label>Ссылка на пакет (если не файл из каталога)
        <input type="url" name="run_url" value="${v('run_url')}" placeholder="оставьте пустым — возьмём файл программы" maxlength="500">
      </label>
      <label>Доп. параметры эмулятора
        <input type="text" name="run_params" value="${v('run_params')}" placeholder="machine=agat9&amp;ram=128" maxlength="300">
      </label>
    </section>
  </div>

  ${p ? `</form>
<form class="danger-zone" method="post" action="/admin/delete/${p.id}" data-confirm="Удалить «${escapeHtml(p.title)}» вместе с файлами?">
  <button class="button danger" type="submit">Удалить программу</button>
</form>` : '</form>'}`;

  return layout({ title: isNew ? 'Новая программа' : 'Правка', nav: nav(user), bodyClass: 'admin', adminScript: true }, body);
}
