/**
 * Retro software catalog — a single Node process, no npm dependencies.
 *   node --disable-warning=ExperimentalWarning server.ts
 */
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { config, filesDir, rootDir, screenshotsDir } from './config.ts';
import * as db from './db.ts';
import type { ProgramInput, ProgramRow, RefTable, User } from './db.ts';
import {
  BodyTooLarge, clientIp, detectImage, formatBytes, html, isSafeName,
  json, readBody, readForm, redirect, sendFile, slugify, text,
} from './http.ts';
import {
  authenticate, currentUser, endSession, hashPassword, loginBlockedFor, noteLoginFailure,
  noteLoginSuccess, sameOrigin, startSession, verifyPassword,
} from './auth.ts';
import { renderMarkdown } from './markdown.ts';
import { refSpec } from './refs.ts';
import { errorPage } from './views/layout.ts';
import { listPage, programPage } from './views/catalog.ts';
import type { ListQuery } from './views/catalog.ts';
import { adminListPage, editPage, loginPage, passwordPage } from './views/admin.ts';
import { refEditPage, refListPage } from './views/admin-refs.ts';
import { userEditPage, userListPage } from './views/admin-users.ts';

const publicDir = join(rootDir, 'public');

type Ctx = {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  user: User | null;
};

type Handler = (ctx: Ctx) => Promise<void> | void;
type Route = { method: string; pattern: RegExp; keys: string[]; handler: Handler; auth: boolean };

const routes: Route[] = [];

function route(method: string, path: string, handler: Handler, auth = false): void {
  const keys: string[] = [];
  // Escape regex specials (dots in /favicon.ico) before turning :params into groups.
  const pattern = new RegExp(
    `^${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:[A-Za-z_]+/g, (m) => {
      keys.push(m.slice(1));
      return '([^/]+)';
    })}$`,
  );
  routes.push({ method, pattern, keys, handler, auth });
}

// ----------------------------------------------------------------- public

route('GET', '/', (ctx) => {
  const p = ctx.url.searchParams;
  const query: ListQuery = {
    q: (p.get('q') ?? '').trim().slice(0, 100),
    familyId: Number(p.get('family')) || null,
    modelId: Number(p.get('model')) || null,
    categoryId: Number(p.get('category')) || null,
    year: Number(p.get('year')) || null,
    sort: p.get('sort') ?? 'new',
  };
  const page = Number(p.get('page')) || 1;
  const result = db.listPrograms({ ...query, page, perPage: 24 });
  html(
    ctx.res,
    200,
    listPage(result.rows, result.total, result.page, result.pages, query, db.facets(query.familyId), db.listFamilies()),
  );
});

route('GET', '/p/:slug', (ctx) => {
  const program = db.getProgramBySlug(ctx.params.slug);
  if (!program || (!program.published && !ctx.user)) return notFound(ctx);
  html(ctx.res, 200, programPage(program, db.modelsForProgram(program.id), {
    download: program.file_name ? `/dl/${program.slug}` : '',
    emulators: db.emulatorFilesFor([program.id]).get(program.id) ?? [],
  }));
});

route('GET', '/dl/:slug', async (ctx) => {
  const program = db.getProgramBySlug(ctx.params.slug);
  if (!program || (!program.published && !ctx.user)) return notFound(ctx);
  if (!program.file_name) return notFound(ctx);
  db.bumpDownloads(program.id);
  await sendFile(ctx.req, ctx.res, join(filesDir, program.file_name), {
    downloadAs: program.file_name,
    contentType: 'application/octet-stream',
    cors: true,
    cacheSeconds: 86400,
  });
});

route('GET', '/run/:slug/:emu', (ctx) => {
  const program = db.getProgramBySlug(ctx.params.slug);
  if (!program || (!program.published && !ctx.user)) return notFound(ctx);
  const slot = db.getEmulatorFile(program.id, Number(ctx.params.emu));
  if (!slot) return notFound(ctx);
  db.bumpRuns(program.id, slot.emulator_id);
  // 302, never 301: a cached permanent redirect would freeze the counter.
  redirect(ctx.res, emulatorLaunchUrl(slot.url_template, `${config.siteUrl}/files/${slot.file_name}`), 302);
});

route('GET', '/static/:name', async (ctx) => {
  if (!isSafeName(ctx.params.name)) return notFound(ctx);
  await sendFile(ctx.req, ctx.res, join(publicDir, ctx.params.name), { cacheSeconds: 3600 });
});

route('GET', '/screenshots/:name', async (ctx) => {
  if (!isSafeName(ctx.params.name)) return notFound(ctx);
  await sendFile(ctx.req, ctx.res, join(screenshotsDir, ctx.params.name), { cors: true, cacheSeconds: 604800 });
});

// The emulator fetches this cross-origin and needs Range + CORS.
route('GET', '/files/:name', async (ctx) => {
  if (!isSafeName(ctx.params.name)) return notFound(ctx);
  await sendFile(ctx.req, ctx.res, join(filesDir, ctx.params.name), {
    contentType: 'application/octet-stream',
    cors: true,
    cacheSeconds: 604800,
  });
});

route('OPTIONS', '/files/:name', (ctx) => {
  ctx.res.writeHead(204, {
    'Access-Control-Allow-Origin': config.corsOrigins.includes('*') ? '*' : (ctx.req.headers.origin ?? ''),
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range',
    'Access-Control-Max-Age': '86400',
  });
  ctx.res.end();
});

route('GET', '/health', (ctx) => text(ctx.res, 200, 'ok'));

// Explicit, because /:family (registered last) would otherwise swallow it.
route('GET', '/favicon.ico', (ctx) => redirect(ctx.res, '/static/favicon.svg', 301));

// ------------------------------------------------------------------ admin

route('GET', '/admin/login', (ctx) => {
  if (ctx.user) return redirect(ctx.res, '/admin');
  html(ctx.res, 200, loginPage());
});

route('POST', '/admin/login', async (ctx) => {
  const ip = clientIp(ctx.req);
  const blocked = loginBlockedFor(ip);
  if (blocked > 0) {
    html(ctx.res, 429, loginPage(`Слишком много попыток. Подождите ${Math.ceil(blocked / 1000)} с.`));
    return;
  }
  const form = await readForm(ctx.req);
  const username = (form.get('username') ?? '').trim();
  const user = authenticate(username, form.get('password') ?? '');
  if (!user) {
    noteLoginFailure(ip);
    html(ctx.res, 401, loginPage('Неверный логин или пароль.', username));
    return;
  }
  noteLoginSuccess(ip);
  startSession(ctx.res, user.id);
  redirect(ctx.res, '/admin');
});

route('POST', '/admin/logout', (ctx) => {
  endSession(ctx.res);
  redirect(ctx.res, '/');
});

route('GET', '/admin', (ctx) => {
  const q = (ctx.url.searchParams.get('q') ?? '').trim().slice(0, 100);
  const page = Number(ctx.url.searchParams.get('page')) || 1;
  const result = db.listPrograms({ q, page, perPage: 50, includeHidden: true, sort: 'new' });
  html(ctx.res, 200, adminListPage(ctx.user!, result.rows, result.total, result.page, result.pages, q, db.stats()));
}, true);

route('GET', '/admin/new', (ctx) => html(ctx.res, 200, editPage(ctx.user!, null, editData(null))), true);

route('GET', '/admin/edit/:id', (ctx) => {
  const program = db.getProgramById(Number(ctx.params.id));
  if (!program) return notFound(ctx);
  html(ctx.res, 200, editPage(ctx.user!, program, editData(program)));
}, true);

route('POST', '/admin/save', async (ctx) => {
  const form = await readForm(ctx.req);
  const id = Number(form.get('id')) || 0;
  const title = (form.get('title') ?? '').trim();
  const wantsJson = (ctx.req.headers.accept ?? '').includes('application/json');
  const existing = id ? db.getProgramById(id) : null;

  const fail = (message: string): void => {
    if (wantsJson) return json(ctx.res, 400, { error: message });
    html(ctx.res, 400, editPage(ctx.user!, existing, editData(existing), message));
  };

  if (!title) return fail('Название обязательно.');

  const familyId = Number(form.get('family_id')) || 0;
  if (!familyId || !db.getRef('families', familyId)) return fail('Выберите семейство.');

  const categoryId = Number(form.get('category_id')) || 0;
  // Only models of the chosen family may be attached.
  const familyModels = new Set(db.listModels(familyId).map((m) => m.id));
  const modelIds = form
    .getAll('models')
    .map((value) => Number(value))
    .filter((modelId) => familyModels.has(modelId));

  const input: ProgramInput = {
    slug: uniqueSlug((form.get('slug') ?? '').trim() || slugify(title) || `program-${Date.now()}`, id),
    title: title.slice(0, 200),
    family_id: familyId,
    category_id: categoryId && db.getRef('categories', categoryId) ? categoryId : null,
    year: Number(form.get('year')) || null,
    author: (form.get('author') ?? '').trim().slice(0, 120),
    author_wanted: form.get('author_wanted') ? 1 : 0,
    description: (form.get('description') ?? '').trim().slice(0, 20000),
    published: form.get('published') ? 1 : 0,
  };

  let savedId = id;
  if (existing) {
    db.updateProgram(id, input, modelIds);
  } else {
    savedId = db.createProgram(input, modelIds);
  }

  if (wantsJson) return json(ctx.res, 200, { id: savedId, slug: input.slug });
  redirect(ctx.res, `/admin/edit/${savedId}`);
}, true);

route('POST', '/admin/delete/:id', async (ctx) => {
  const program = db.getProgramById(Number(ctx.params.id));
  if (!program) return notFound(ctx);
  if (program.screenshot) await unlink(join(screenshotsDir, program.screenshot)).catch(() => {});
  if (program.file_name) await unlink(join(filesDir, program.file_name)).catch(() => {});
  // SQLite drops the rows; the files behind them are ours to remove.
  for (const name of db.programFileNames(program.id)) {
    await unlink(join(filesDir, name)).catch(() => {});
  }
  db.deleteProgram(program.id);
  redirect(ctx.res, '/admin');
}, true);

/** The editor's preview tab renders through the same function the public page uses. */
route('POST', '/admin/preview', async (ctx) => {
  const form = await readForm(ctx.req, 128 * 1024);
  json(ctx.res, 200, { html: renderMarkdown(form.get('text') ?? '') });
}, true);

// ------------------------------------------------------------ admin: uploads

/** One file per emulator per program; the emulator downloads it by its own URL. */
route('PUT', '/admin/upload/program/:id/emu/:emu', async (ctx) => {
  const id = Number(ctx.params.id);
  const emulatorId = Number(ctx.params.emu);
  const program = db.getProgramById(id);
  const emulator = db.getRef('emulators', emulatorId);
  if (!program || !emulator) return json(ctx.res, 404, { error: 'Не найдено' });

  const original = ctx.url.searchParams.get('name') ?? 'file.bin';
  const name = storedFileName(`${id}-e${emulatorId}`, original);
  const body = await readBody(ctx.req, config.maxFileBytes);
  if (body.length === 0) return json(ctx.res, 400, { error: 'Пустой файл' });

  const previous = db.getEmulatorFile(id, emulatorId);
  await writeFile(join(filesDir, name), body);
  if (previous && previous.file_name !== name) {
    await unlink(join(filesDir, previous.file_name)).catch(() => {});
  }
  db.setEmulatorFile(id, emulatorId, name, body.length);
  json(ctx.res, 200, {
    name,
    size: body.length,
    human: formatBytes(body.length),
    url: `${config.siteUrl}/files/${name}`,
  });
}, true);

route('POST', '/admin/clear/program/:id/emu/:emu', async (ctx) => {
  const id = Number(ctx.params.id);
  const emulatorId = Number(ctx.params.emu);
  const slot = db.getEmulatorFile(id, emulatorId);
  if (!slot) return json(ctx.res, 404, { error: 'Не найдено' });
  await unlink(join(filesDir, slot.file_name)).catch(() => {});
  db.clearEmulatorFile(id, emulatorId);
  json(ctx.res, 200, { ok: true });
}, true);

/** entity/kind pairs the uploader accepts. The body is the raw file. */
route('PUT', '/admin/upload/:entity/:id/:kind', async (ctx) => {
  const { entity, kind } = ctx.params;
  const id = Number(ctx.params.id);

  if (entity === 'program' && kind === 'screenshot') {
    const program = db.getProgramById(id);
    if (!program) return json(ctx.res, 404, { error: 'Не найдено' });
    const saved = await saveImage(ctx, `p${id}`, program.screenshot);
    if (!saved) return;
    db.setScreenshot(id, saved);
    return json(ctx.res, 200, { name: saved, url: `/screenshots/${saved}` });
  }

  if (entity === 'program' && kind === 'file') {
    const program = db.getProgramById(id);
    if (!program) return json(ctx.res, 404, { error: 'Не найдено' });
    const original = ctx.url.searchParams.get('name') ?? 'file.bin';
    const name = storedFileName(`${id}`, original);
    const body = await readBody(ctx.req, config.maxFileBytes);
    if (body.length === 0) return json(ctx.res, 400, { error: 'Пустой файл' });
    await writeFile(join(filesDir, name), body);
    if (program.file_name && program.file_name !== name) {
      await unlink(join(filesDir, program.file_name)).catch(() => {});
    }
    db.setFile(id, name, body.length);
    return json(ctx.res, 200, {
      name,
      size: body.length,
      human: formatBytes(body.length),
      url: `${config.siteUrl}/files/${name}`,
    });
  }

  if ((entity === 'family' || entity === 'model') && kind === 'image') {
    const table: 'families' | 'models' = entity === 'family' ? 'families' : 'models';
    const row = db.getRef(table, id);
    if (!row) return json(ctx.res, 404, { error: 'Не найдено' });
    const saved = await saveImage(ctx, `${entity === 'family' ? 'f' : 'm'}${id}`, String(row.image ?? ''));
    if (!saved) return;
    db.setImage(table, id, saved);
    return json(ctx.res, 200, { name: saved, url: `/screenshots/${saved}` });
  }

  json(ctx.res, 404, { error: 'Неизвестный вид загрузки' });
}, true);

route('POST', '/admin/clear/:entity/:id/:kind', async (ctx) => {
  const { entity, kind } = ctx.params;
  const id = Number(ctx.params.id);

  if (entity === 'program') {
    const program = db.getProgramById(id);
    if (!program) return json(ctx.res, 404, { error: 'Не найдено' });
    if (kind === 'screenshot' && program.screenshot) {
      await unlink(join(screenshotsDir, program.screenshot)).catch(() => {});
      db.setScreenshot(id, '');
    } else if (kind === 'file' && program.file_name) {
      await unlink(join(filesDir, program.file_name)).catch(() => {});
      db.setFile(id, '', null);
    }
    return json(ctx.res, 200, { ok: true });
  }

  if ((entity === 'family' || entity === 'model') && kind === 'image') {
    const table: 'families' | 'models' = entity === 'family' ? 'families' : 'models';
    const row = db.getRef(table, id);
    if (!row) return json(ctx.res, 404, { error: 'Не найдено' });
    if (row.image) await unlink(join(screenshotsDir, String(row.image))).catch(() => {});
    db.setImage(table, id, '');
    return json(ctx.res, 200, { ok: true });
  }

  json(ctx.res, 404, { error: 'Неизвестный вид очистки' });
}, true);

// -------------------------------------------------------- admin: references

route('GET', '/admin/ref/:table', (ctx) => {
  const spec = refSpec(ctx.params.table);
  if (!spec) return notFound(ctx);
  const rows = db.listRef(spec.table);
  html(ctx.res, 200, refListPage(ctx.user!, spec, rows, db.listFamilies(), refCounts(spec.table, rows)));
}, true);

route('GET', '/admin/ref/:table/new', (ctx) => {
  const spec = refSpec(ctx.params.table);
  if (!spec) return notFound(ctx);
  const familyId = Number(ctx.url.searchParams.get('family_id')) || 0;
  html(ctx.res, 200, refEditPage(ctx.user!, spec, null, db.listFamilies(), { familyId }));
}, true);

route('GET', '/admin/ref/:table/:id', (ctx) => {
  const spec = refSpec(ctx.params.table);
  if (!spec) return notFound(ctx);
  const row = db.getRef(spec.table, Number(ctx.params.id));
  if (!row) return notFound(ctx);
  html(ctx.res, 200, refEditPage(ctx.user!, spec, row, db.listFamilies(), refEditExtras(spec.table, Number(row.id))));
}, true);

route('POST', '/admin/ref/:table/save', async (ctx) => {
  const spec = refSpec(ctx.params.table);
  if (!spec) return notFound(ctx);
  const form = await readForm(ctx.req);
  const id = Number(form.get('id')) || 0;
  const row = id ? db.getRef(spec.table, id) : null;

  const error = spec.validate(form, id);
  if (error) {
    return html(ctx.res, 400, refEditPage(ctx.user!, spec, row, db.listFamilies(), {
      ...refEditExtras(spec.table, id),
      familyId: Number(form.get('family_id')) || 0,
      error,
    }));
  }

  const values = spec.values(form, id);
  let savedId = id;
  if (row) {
    db.updateRef(spec.table, id, values);
  } else {
    savedId = db.createRef(spec.table, values);
  }
  // A renamed family, model or category changes what the search haystack should contain.
  db.rebuildSearchText();
  redirect(ctx.res, `/admin/ref/${spec.table}/${savedId}`);
}, true);

route('POST', '/admin/ref/:table/delete/:id', async (ctx) => {
  const spec = refSpec(ctx.params.table);
  if (!spec) return notFound(ctx);
  const id = Number(ctx.params.id);
  const row = db.getRef(spec.table, id);
  if (!row) return notFound(ctx);

  const refusal = spec.beforeDelete(id);
  if (refusal) {
    const rows = db.listRef(spec.table);
    return html(ctx.res, 409, refListPage(ctx.user!, spec, rows, db.listFamilies(), refCounts(spec.table, rows), '', refusal));
  }

  // Files first: the rows that name them are about to disappear.
  if (spec.table === 'emulators') {
    for (const name of db.emulatorFileNames(id)) await unlink(join(filesDir, name)).catch(() => {});
  }
  if (spec.table === 'families') {
    for (const model of db.listModels(id)) {
      if (model.image) await unlink(join(screenshotsDir, model.image)).catch(() => {});
    }
  }
  if (row.image) await unlink(join(screenshotsDir, String(row.image))).catch(() => {});

  db.deleteRef(spec.table, id);
  db.rebuildSearchText();
  redirect(ctx.res, `/admin/ref/${spec.table}`);
}, true);

route('POST', '/admin/reorder/:table', async (ctx) => {
  const spec = refSpec(ctx.params.table);
  if (!spec || !spec.reorderable) return json(ctx.res, 404, { error: 'Нельзя менять порядок' });
  const form = await readForm(ctx.req, 64 * 1024);
  const ids = (form.get('order') ?? '')
    .split(',')
    .map((value) => Number(value))
    .filter((id) => Number.isInteger(id) && id > 0);
  if (ids.length === 0) return json(ctx.res, 400, { error: 'Пустой порядок' });
  db.setSortOrder(spec.table, ids);
  json(ctx.res, 200, { ok: true });
}, true);

// ------------------------------------------------------------- admin: users

route('GET', '/admin/users', (ctx) => {
  html(ctx.res, 200, userListPage(ctx.user!, db.listUsers()));
}, true);

route('GET', '/admin/users/new', (ctx) => html(ctx.res, 200, userEditPage(ctx.user!, null)), true);

route('GET', '/admin/users/:id', (ctx) => {
  const row = db.getUserById(Number(ctx.params.id));
  if (!row) return notFound(ctx);
  html(ctx.res, 200, userEditPage(ctx.user!, row));
}, true);

route('POST', '/admin/users/save', async (ctx) => {
  const form = await readForm(ctx.req);
  const id = Number(form.get('id')) || 0;
  const row = id ? db.getUserById(id) : null;
  const username = (form.get('username') ?? '').trim().slice(0, 60);
  const displayName = (form.get('display_name') ?? '').trim().slice(0, 120);
  const password = form.get('password') ?? '';

  const fail = (message: string): void => html(ctx.res, 400, userEditPage(ctx.user!, row, message));

  if (!username) return fail('Логин обязателен.');
  const taken = db.getUserByName(username);
  if (taken && taken.id !== id) return fail(`Логин «${username}» уже занят.`);
  if (!row && password.length < 8) return fail('Пароль короче 8 символов.');
  if (password && password.length < 8) return fail('Пароль короче 8 символов.');

  if (row) {
    db.updateUser(id, username, displayName);
    if (password) db.setPasswordHash(id, hashPassword(password));
  } else {
    db.createUser(username, hashPassword(password), displayName);
  }
  redirect(ctx.res, '/admin/users');
}, true);

route('POST', '/admin/users/delete/:id', (ctx) => {
  const id = Number(ctx.params.id);
  const row = db.getUserById(id);
  if (!row) return notFound(ctx);
  if (id === ctx.user!.id) {
    return html(ctx.res, 409, userListPage(ctx.user!, db.listUsers(), '', 'Нельзя удалить собственную учётную запись.'));
  }
  if (db.countUsers() <= 1) {
    return html(ctx.res, 409, userListPage(ctx.user!, db.listUsers(), '', 'Это единственный администратор.'));
  }
  db.deleteUser(id);
  redirect(ctx.res, '/admin/users');
}, true);

route('GET', '/admin/password', (ctx) => html(ctx.res, 200, passwordPage(ctx.user!)), true);

route('POST', '/admin/password', async (ctx) => {
  const form = await readForm(ctx.req);
  const user = ctx.user!;
  if (!verifyPassword(form.get('current') ?? '', user.password_hash)) {
    return html(ctx.res, 400, passwordPage(user, '', 'Текущий пароль не подошёл.'));
  }
  const next = form.get('next') ?? '';
  if (next.length < 8) return html(ctx.res, 400, passwordPage(user, '', 'Новый пароль короче 8 символов.'));
  if (next !== form.get('repeat')) return html(ctx.res, 400, passwordPage(user, '', 'Пароли не совпадают.'));
  db.setPasswordHash(user.id, hashPassword(next));
  html(ctx.res, 200, passwordPage(user, 'Пароль изменён.'));
}, true);

// ------------------------------------------------------------------ helpers

function editData(program: ProgramRow | null) {
  return {
    families: db.listFamilies(),
    categories: db.listCategories(),
    models: db.listModels(),
    emulators: db.listEmulators(),
    emulatorFiles: program ? (db.emulatorFilesFor([program.id]).get(program.id) ?? []) : [],
    selectedModels: program ? db.modelIdsForProgram(program.id) : [],
  };
}

/** "Программ" column on the reference lists. */
function refCounts(table: RefTable, rows: db.RefRow[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const row of rows) {
    const id = Number(row.id);
    if (table === 'families') counts.set(id, db.countProgramsInFamily(id));
    else if (table === 'models') counts.set(id, db.countProgramsWithModel(id));
    else if (table === 'emulators') counts.set(id, db.emulatorFileNames(id).length);
    else counts.set(id, db.listPrograms({ categoryId: id, includeHidden: true, perPage: 1 }).total);
  }
  return counts;
}

function refEditExtras(table: RefTable, id: number): { childModels?: db.RefRow[]; programCount?: number } {
  if (table === 'families') {
    return { childModels: db.listRef('models', id) as unknown as db.RefRow[], programCount: db.countProgramsInFamily(id) };
  }
  if (table === 'models') return { programCount: db.countProgramsWithModel(id) };
  if (table === 'emulators') return { programCount: db.emulatorFileNames(id).length };
  return {};
}

/** Reads the body as an image, stores it, removes the previous one. Answers on failure. */
async function saveImage(ctx: Ctx, prefix: string, previous: string): Promise<string | null> {
  const body = await readBody(ctx.req, config.maxScreenshotBytes);
  const kind = detectImage(body);
  if (!kind) {
    json(ctx.res, 400, { error: 'Это не PNG, JPEG, GIF или WebP' });
    return null;
  }
  const name = `${prefix}-${randomBytes(4).toString('hex')}${kind.ext}`;
  if (!isSafeName(name)) {
    json(ctx.res, 400, { error: 'Не удалось построить имя файла' });
    return null;
  }
  await writeFile(join(screenshotsDir, name), body);
  if (previous && previous !== name) await unlink(join(screenshotsDir, previous)).catch(() => {});
  return name;
}

/** The emulator downloads the package itself, so the template gets an absolute URL. */
function emulatorLaunchUrl(template: string, fileUrl: string): string {
  return template.replaceAll('{url}', encodeURIComponent(fileUrl));
}

function uniqueSlug(candidate: string, exceptId: number): string {
  const base = slugify(candidate) || `program-${Date.now()}`;
  let slug = base;
  let n = 2;
  while (db.slugExists(slug, exceptId)) slug = `${base}-${n++}`;
  return slug;
}

function storedFileName(prefix: string, original: string): string {
  const base = basename(original.replaceAll('\\', '/'));
  const ext = (extname(base).toLowerCase().match(/^\.[a-z0-9]{1,10}$/) ?? [''])[0];
  const stem = slugify(base.slice(0, base.length - extname(base).length)).slice(0, 60) || 'file';
  const name = `${prefix}-${stem}${ext}`;
  return isSafeName(name) ? name : `${prefix}-file${ext}`;
}

function notFound(ctx: Ctx): void {
  html(ctx.res, 404, errorPage(404, 'Такой страницы нет.'));
}

// -------------------------------------------------------------- dispatch

async function dispatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', config.siteUrl);
  let path = url.pathname;
  if (path.length > 1 && path.endsWith('/')) {
    redirect(res, path.replace(/\/+$/, '') + url.search, 301);
    return;
  }
  try {
    path = decodeURIComponent(path);
  } catch {
    // keep the raw path; it simply will not match any route
  }

  const method = req.method === 'HEAD' ? 'GET' : (req.method ?? 'GET');
  const user = currentUser(req);

  for (const r of routes) {
    if (r.method !== method) continue;
    const match = r.pattern.exec(path);
    if (!match) continue;

    if (r.auth && !user) {
      if (method === 'GET') return redirect(res, '/admin/login');
      return json(res, 401, { error: 'Нужен вход' });
    }
    // Defence in depth against cross-site form posts (SameSite=Lax already covers most of it).
    if ((method === 'POST' || method === 'PUT') && !sameOrigin(req)) {
      return json(res, 403, { error: 'Запрос с чужого origin' });
    }

    const params: Record<string, string> = {};
    r.keys.forEach((key, i) => {
      params[key] = decodeURIComponent(match[i + 1]);
    });
    await r.handler({ req, res, url, params, user });
    return;
  }

  notFound({ req, res, url, params: {}, user });
}

const server = createServer((req, res) => {
  const started = Date.now();
  res.on('finish', () => {
    if (req.url?.startsWith('/static/')) return;
    console.log(`${req.method} ${req.url} ${res.statusCode} ${Date.now() - started}ms`);
  });
  dispatch(req, res).catch((err: unknown) => {
    if (res.headersSent) return res.end();
    if (err instanceof BodyTooLarge) {
      console.warn(`body too large: ${req.method} ${req.url}`);
      return json(res, 413, { error: 'Файл слишком большой' });
    }
    console.error(`500 ${req.method} ${req.url}: ${(err as Error).stack ?? err}`);
    html(res, 500, errorPage(500, 'Что-то сломалось на сервере.'));
  });
});

server.listen(config.port, config.host, () => {
  console.log(`${config.siteName}: http://${config.host}:${config.port}  (public ${config.siteUrl})`);
  console.log(`data: ${config.dataDir}`);
  if (db.countUsers() === 0) {
    console.warn('No admin users yet. Create one:  npm run user -- add <login>');
  }
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`${signal}: shutting down`);
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
