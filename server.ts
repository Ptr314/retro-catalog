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
import type { Program, ProgramInput, User } from './db.ts';
import {
  BodyTooLarge, clientIp, detectImage, formatBytes, html, isSafeName,
  json, readBody, readForm, redirect, sendFile, slugify, text,
} from './http.ts';
import {
  authenticate, currentUser, endSession, hashPassword, loginBlockedFor, noteLoginFailure,
  noteLoginSuccess, sameOrigin, startSession, verifyPassword,
} from './auth.ts';
import { errorPage } from './views/layout.ts';
import { listPage, programPage } from './views/catalog.ts';
import type { ListQuery } from './views/catalog.ts';
import { adminListPage, editPage, loginPage, passwordPage } from './views/admin.ts';

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
  const pattern = new RegExp(
    `^${path.replace(/:[A-Za-z]+/g, (m) => {
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
    platform: (p.get('platform') ?? '').slice(0, 60),
    category: (p.get('category') ?? '').slice(0, 60),
    year: p.get('year') ? Number(p.get('year')) || null : null,
    sort: p.get('sort') ?? 'new',
  };
  const page = Number(p.get('page')) || 1;
  const result = db.listPrograms({ ...query, page, perPage: 24 });
  html(ctx.res, 200, listPage(result.rows, result.total, result.page, result.pages, query, db.facets()));
});

route('GET', '/p/:slug', (ctx) => {
  const program = db.getProgramBySlug(ctx.params.slug);
  if (!program || (!program.published && !ctx.user)) return notFound(ctx);
  html(ctx.res, 200, programPage(program, {
    download: downloadTarget(program) ? `/dl/${program.slug}` : '',
    run: runTarget(program) ? `/run/${program.slug}` : '',
  }));
});

route('GET', '/dl/:slug', async (ctx) => {
  const program = db.getProgramBySlug(ctx.params.slug);
  if (!program || (!program.published && !ctx.user)) return notFound(ctx);
  const target = downloadTarget(program);
  if (!target) return notFound(ctx);
  db.bumpDownloads(program.id);
  if (target.kind === 'external') return redirect(ctx.res, target.url, 302);
  await sendFile(ctx.req, ctx.res, join(filesDir, target.name), {
    downloadAs: target.name,
    contentType: 'application/octet-stream',
    cors: true,
    cacheSeconds: 86400,
  });
});

route('GET', '/run/:slug', (ctx) => {
  const program = db.getProgramBySlug(ctx.params.slug);
  if (!program || (!program.published && !ctx.user)) return notFound(ctx);
  const target = runTarget(program);
  if (!target) return notFound(ctx);
  db.bumpRuns(program.id);
  redirect(ctx.res, target, 302);
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

route('GET', '/admin/new', (ctx) => html(ctx.res, 200, editPage(ctx.user!, null)), true);

route('GET', '/admin/edit/:id', (ctx) => {
  const program = db.getProgramById(Number(ctx.params.id));
  if (!program) return notFound(ctx);
  html(ctx.res, 200, editPage(ctx.user!, program));
}, true);

route('POST', '/admin/save', async (ctx) => {
  const form = await readForm(ctx.req);
  const id = Number(form.get('id')) || 0;
  const title = (form.get('title') ?? '').trim();
  const wantsJson = (ctx.req.headers.accept ?? '').includes('application/json');

  if (!title) {
    if (wantsJson) return json(ctx.res, 400, { error: 'Название обязательно' });
    return html(ctx.res, 400, editPage(ctx.user!, id ? db.getProgramById(id) : null, 'Название обязательно.'));
  }

  const input: ProgramInput = {
    slug: uniqueSlug((form.get('slug') ?? '').trim() || slugify(title) || `program-${Date.now()}`, id),
    title: title.slice(0, 200),
    platform: (form.get('platform') ?? '').trim().slice(0, 60),
    category: (form.get('category') ?? '').trim().slice(0, 60),
    year: Number(form.get('year')) || null,
    author: (form.get('author') ?? '').trim().slice(0, 120),
    publisher: (form.get('publisher') ?? '').trim().slice(0, 120),
    description: (form.get('description') ?? '').trim().slice(0, 20000),
    tags: (form.get('tags') ?? '').trim().slice(0, 200),
    download_url: safeUrl(form.get('download_url')),
    run_enabled: form.get('run_enabled') ? 1 : 0,
    run_url: safeUrl(form.get('run_url')),
    run_params: (form.get('run_params') ?? '').trim().slice(0, 300),
    published: form.get('published') ? 1 : 0,
  };

  let savedId = id;
  if (id && db.getProgramById(id)) {
    db.updateProgram(id, input);
  } else {
    savedId = db.createProgram(input);
  }

  if (wantsJson) return json(ctx.res, 200, { id: savedId, slug: input.slug });
  redirect(ctx.res, `/admin/edit/${savedId}`);
}, true);

route('PUT', '/admin/upload/:id/screenshot', async (ctx) => {
  const program = db.getProgramById(Number(ctx.params.id));
  if (!program) return json(ctx.res, 404, { error: 'Не найдено' });

  const body = await readBody(ctx.req, config.maxScreenshotBytes);
  const kind = detectImage(body);
  if (!kind) return json(ctx.res, 400, { error: 'Это не PNG, JPEG, GIF или WebP' });

  const name = `${program.id}-${randomBytes(4).toString('hex')}${kind.ext}`;
  await writeFile(join(screenshotsDir, name), body);
  if (program.screenshot) await unlink(join(screenshotsDir, program.screenshot)).catch(() => {});
  db.setScreenshot(program.id, name);
  json(ctx.res, 200, { screenshot: name, url: `/screenshots/${name}` });
}, true);

route('PUT', '/admin/upload/:id/file', async (ctx) => {
  const program = db.getProgramById(Number(ctx.params.id));
  if (!program) return json(ctx.res, 404, { error: 'Не найдено' });

  const original = ctx.url.searchParams.get('name') ?? 'file.bin';
  const name = storedFileName(program.id, original);
  const body = await readBody(ctx.req, config.maxFileBytes);
  if (body.length === 0) return json(ctx.res, 400, { error: 'Пустой файл' });

  await writeFile(join(filesDir, name), body);
  if (program.file_name && program.file_name !== name) {
    await unlink(join(filesDir, program.file_name)).catch(() => {});
  }
  db.setFile(program.id, name, body.length);
  json(ctx.res, 200, { file: name, size: body.length, human: formatBytes(body.length) });
}, true);

route('POST', '/admin/clear/:id/:what', async (ctx) => {
  const program = db.getProgramById(Number(ctx.params.id));
  if (!program) return json(ctx.res, 404, { error: 'Не найдено' });
  if (ctx.params.what === 'screenshot' && program.screenshot) {
    await unlink(join(screenshotsDir, program.screenshot)).catch(() => {});
    db.setScreenshot(program.id, '');
  } else if (ctx.params.what === 'file' && program.file_name) {
    await unlink(join(filesDir, program.file_name)).catch(() => {});
    db.setFile(program.id, '', null);
  }
  json(ctx.res, 200, { ok: true });
}, true);

route('POST', '/admin/delete/:id', async (ctx) => {
  const program = db.getProgramById(Number(ctx.params.id));
  if (!program) return notFound(ctx);
  if (program.screenshot) await unlink(join(screenshotsDir, program.screenshot)).catch(() => {});
  if (program.file_name) await unlink(join(filesDir, program.file_name)).catch(() => {});
  db.deleteProgram(program.id);
  redirect(ctx.res, '/admin');
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

// ------------------------------------------------------------- helpers

type DownloadTarget = { kind: 'file'; name: string } | { kind: 'external'; url: string } | null;

function downloadTarget(p: Program): DownloadTarget {
  if (p.file_name) return { kind: 'file', name: p.file_name };
  if (p.download_url) return { kind: 'external', url: p.download_url };
  return null;
}

/** The emulator downloads the package itself, so it needs an absolute URL. */
function runTarget(p: Program): string {
  if (!p.run_enabled) return '';
  const packageUrl = p.run_url || (p.file_name ? `${config.siteUrl}/files/${p.file_name}` : p.download_url);
  if (!packageUrl) return '';
  const url = new URL(config.emulator.baseUrl);
  if (p.run_params) {
    for (const [key, value] of new URLSearchParams(p.run_params)) url.searchParams.set(key, value);
  }
  url.searchParams.set(config.emulator.param, packageUrl);
  return url.toString();
}

function uniqueSlug(candidate: string, exceptId: number): string {
  const base = slugify(candidate) || `program-${Date.now()}`;
  let slug = base;
  let n = 2;
  while (db.slugExists(slug, exceptId)) slug = `${base}-${n++}`;
  return slug;
}

function safeUrl(value: string | null): string {
  const raw = (value ?? '').trim().slice(0, 500);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function storedFileName(id: number, original: string): string {
  const base = basename(original.replaceAll('\\', '/'));
  const ext = (extname(base).toLowerCase().match(/^\.[a-z0-9]{1,10}$/) ?? [''])[0];
  const stem = slugify(base.slice(0, base.length - extname(base).length)).slice(0, 60) || 'file';
  const name = `${id}-${stem}${ext}`;
  return isSafeName(name) ? name : `${id}-file${ext}`;
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

  if (path === '/favicon.ico') return redirect(res, '/static/favicon.svg', 301);
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
