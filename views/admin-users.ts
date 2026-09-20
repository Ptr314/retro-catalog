/** Administrator accounts. Passwords are only ever set here, never displayed. */
import type { User } from '../db.ts';
import { escapeHtml } from '../http.ts';
import { layout } from './layout.ts';
import { alerts } from './parts.ts';
import { adminName, nav } from './admin.ts';

export function userListPage(user: User, users: User[], notice = '', error = ''): string {
  const body = `
<section class="admin-head">
  <h1>Администраторы</h1>
  <form class="filters" method="get" action="/admin/users">
    <a class="button primary" href="/admin/users/new">Добавить администратора</a>
  </form>
</section>
${alerts(error, notice)}
<table class="admin-table">
  <thead><tr><th>Имя</th><th>Логин</th><th>Создан</th><th></th></tr></thead>
  <tbody>
    ${users
      .map((u) => {
        const self = u.id === user.id;
        return `<tr>
      <td><a href="/admin/users/${u.id}">${escapeHtml(u.display_name || '—')}</a></td>
      <td><span class="mono">${escapeHtml(u.username)}</span>${self ? ' <span class="badge ok">это вы</span>' : ''}</td>
      <td>${escapeHtml(u.created_at.slice(0, 10))}</td>
      <td class="row-actions">${
        self
          ? '<span class="muted" title="Нельзя удалить собственную учётную запись">удалить</span>'
          : `<form class="inline" method="post" action="/admin/users/delete/${u.id}" data-confirm="Удалить администратора «${escapeHtml(
              u.display_name || u.username,
            )}»?"><button class="linkish danger" type="submit">удалить</button></form>`
      }</td>
    </tr>`;
      })
      .join('')}
  </tbody>
</table>`;

  return layout({ title: 'Администраторы', nav: nav(user), bodyClass: 'admin', scripts: ['admin.js'] }, body);
}

export function userEditPage(user: User, row: User | null, error = ''): string {
  const isNew = row === null;
  const title = isNew ? 'Новый администратор' : adminName(row);

  const body = `
<form class="editor" method="post" action="/admin/users/save">
  <input type="hidden" name="id" value="${row ? row.id : ''}">
  <header class="editor-head">
    <h1>${escapeHtml(title)}</h1>
    <div class="editor-actions">
      <a class="button" href="/admin/users">К списку</a>
      <button class="button primary" type="submit">Сохранить</button>
    </div>
  </header>
  ${alerts(error)}
  <div class="editor-grid">
    <section class="panel">
      <h2>Учётная запись</h2>
      <label>Имя<input type="text" name="display_name" value="${escapeHtml(row?.display_name ?? '')}" maxlength="120"></label>
      <label>Логин *
        <input type="text" name="username" value="${escapeHtml(row?.username ?? '')}" required maxlength="60" autocomplete="username">
      </label>
      <label>${isNew ? 'Пароль *' : 'Новый пароль'}
        <input type="password" name="password" ${isNew ? 'required ' : ''}minlength="8" autocomplete="new-password">
      </label>
      <small class="hint">${
        isNew
          ? 'Не короче 8 символов.'
          : 'Оставьте пустым, чтобы не менять пароль. Свой собственный пароль меняется на странице «Пароль» — там спросят текущий.'
      }</small>
    </section>
  </div>
</form>`;

  return layout({ title, nav: nav(user), bodyClass: 'admin', scripts: ['admin.js'] }, body);
}
