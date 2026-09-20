# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start                      # server on config.host:config.port (default 127.0.0.1:8080)
npm run user -- add <login> [имя]  # create an admin; password asked interactively or via $PASSWORD
npm run user -- passwd <login> # change a password
npm run user -- list
npm run import -- catalog.json # bulk upsert from JSON; references resolved by slug/name (see tools/import.ts)
```

There is no build, no lint, no test suite and no `node_modules` — `npm install` is not part of the workflow. Every script is just `node --disable-warning=ExperimentalWarning <file>.ts`, so any file can be run the same way directly.

First-time setup: `cp config.example.json config.json`, set `siteUrl` to the address the site is actually reached at, create a user, then add at least one family in the admin — a program cannot exist without one. Emulators are reference rows now, not config.

## Verifying a change

With no test suite, verification means driving the running server. `curl` covers the server side well, and it is the fastest way to check routes, status codes, validation messages and what landed in the database.

**But curl cannot see the browser's rules, and the admin leans on them.** `curl` ignores the CSP, executes no JavaScript and does not enforce same-origin. Everything the admin does through `fetch`/XHR — saving a program, uploading a file, the Markdown preview, the clear buttons, drag-and-drop ordering — passed every curl check while being completely broken in a real browser, because the CSP had `default-src 'none'` and no `connect-src` (fixed by adding `connect-src 'self'`; keep it there). A change touching `public/admin.js`, the CSP or anything JS-driven is not verified until it has been exercised in an actual browser, logged in, with the console open.

Restarting matters too: Node holds the modules it imported, so an edited `.ts` file changes nothing until the process is restarted — and a page already open in the browser keeps the headers it was served with, so reload it after a restart.

## Hard constraints

- **Node >= 24, zero dependencies.** TypeScript runs through Node's native type stripping — no compiler, no bundler. Consequences: relative imports must carry the `.ts` extension (`./db.ts`), and only erasable syntax is allowed (no `enum`, no parameter properties, no decorators).
- **Never add an npm dependency.** Everything comes from the standard library: `node:sqlite` for storage, `node:crypto` for passwords and session signatures, `node:http` for the server.
- **No `multipart/form-data` parser exists, deliberately.** Admin forms post `application/x-www-form-urlencoded`; file uploads are separate `PUT` requests whose body is the raw file (`public/admin.js` drives them with XHR for a progress bar). Keep any new upload on that shape.

## Architecture

Flat module layout, each file one concern; `views/` renders, everything else is logic.

**Routing (`server.ts`).** A hand-rolled table: `route(method, path, handler, auth)` compiles `:param` into `([^/]+)`, first match in registration order wins. `dispatch()` centralizes the cross-cutting checks *before* calling a handler — session lookup, the `auth` flag (GET redirects to `/admin/login`, others get 401 JSON), and the same-origin check on every POST/PUT. Handlers therefore never repeat auth or CSRF logic; `ctx.user!` is safe inside an `auth: true` route. `HEAD` is dispatched as `GET`, and `sendFile` handles the empty body.

**`sealRoutes()` must stay last.** It registers `/:family` and `/:family/:model`, which match *any* top-level path, then sets a flag that makes `route()` throw. A route added after it would be silently unreachable; instead the process now fails to boot. A new top-level path therefore needs two edits: the `route()` call before `sealRoutes()`, and an entry in `RESERVED_SLUGS` (`reserved.ts`) so no family can claim that slug. `/favicon.ico` is a route for exactly this reason.

**Storage (`db.ts`).** `node:sqlite`'s synchronous API, WAL mode, one module-level connection. Schema changes go through the `migrations` array, applied against `PRAGMA user_version`: **append a new entry, never edit an existing one** — deployed databases only run the tail of the array.

`programs.search_text` is the denormalized lowercase haystack behind `LIKE`, rebuilt by `rebuildSearchText(id?)`. The lowercasing happens in JavaScript and must stay there: SQLite's `lower()` is ASCII-only, so `lower('Игра')` is still `'Игра'` and an SQL-side rebuild would silently break Cyrillic search. It is called inside `createProgram`/`updateProgram` (after `program_models` is written, same transaction) and with no argument after any reference-table rename, since family, model and category names are part of the haystack.

**Reference tables (`refs.ts`).** Families, models, emulators and categories share one CRUD implementation driven by `REF_SPECS`; the generic routes are `/admin/ref/:table/*`. `:table` is always looked up in `REF_SPECS` before any SQL, and column lists come from the spec — never from the request. Table-specific behaviour lives in the `validate` / `values` / `beforeDelete` hooks (reserved slugs, the `{url}` template check, the refusal to delete a family that still owns programs).

**Views (`views/`).** Plain functions returning HTML strings, composed through `layout()`. Every interpolated value must pass through `escapeHtml()` — **the single exception is `renderMarkdown()` output**, which is safe because it escapes its whole input first (see below). The CSP sent by `http.ts#html` starts from `default-src 'none'`, so inline `<script>`, inline `<style>` and `onclick=` will not execute, and **every directive the admin needs has to be spelled out** — `connect-src 'self'` in particular, or `fetch`/XHR are blocked (see *Verifying a change*). Client behaviour belongs in `public/admin.js`, served from `/static/`. The public pages deliberately need no JavaScript at all: the tiles/table switch is a link plus the `rc_view` cookie, and long descriptions collapse with `<details>`.

**Markdown (`markdown.ts`).** Descriptions are stored as Markdown and rendered on output. The security property is the ordering: `escapeHtml()` runs over the entire source *once, before any rule*, so the text can no longer contain `< > & " '` and every tag in the output is one this module produced. Link URLs are whitelisted against an anchored regex on the already-escaped string, which is why `javascript:` and `data:` cannot slip through. The editor's preview tab round-trips through `POST /admin/preview` rather than mirroring the renderer in JS — one renderer, one behaviour.

**`config.siteUrl` is load-bearing in two unrelated places:** it builds the absolute file URLs handed to emulators, and it is the origin compared in `sameOrigin()`. If it does not match how the site is actually reached, launch links break *and* every admin POST returns 403.

**Emulator handoff.** Each row in `emulators` carries a `url_template` containing `{url}`; `emulatorLaunchUrl()` substitutes the URL-encoded `{siteUrl}/files/{name}` of that program's per-emulator file. `GET /run/:slug/:emu` bumps both counters (`programs.runs` and the slot's own) and answers 302 — never 301, which browsers would cache and freeze the counter. The emulator fetches the file itself cross-origin, which is why `/files/` and `/screenshots/` carry CORS headers and `sendFile` implements `Range`.

**Sessions (`auth.ts`).** Stateless: the cookie holds `{uid, exp}` base64url-encoded plus an HMAC-SHA256 signature, verified with `timingSafeEqual`. There is no sessions table — replacing `data/session-secret` logs everyone out. Login throttling is an in-process `Map` keyed by IP, so it resets on restart and is per-process.

**Uploads.** `PUT /admin/upload/:entity/:id/:kind` (plus the four-segment `/admin/upload/program/:id/emu/:emuId`) takes the raw file as the body. Image type is decided by `detectImage()` from the file's magic bytes, not the client's `Content-Type`. Stored names are generated server-side and every static route gates on `isSafeName()` before joining a path:

| Where | Name | Holds |
|---|---|---|
| `data/files` | `{programId}-{stem}{ext}` | the main download |
| `data/files` | `{programId}-e{emulatorId}-{stem}{ext}` | the per-emulator file |
| `data/screenshots` | `p{id}-`, `f{id}-`, `m{id}-` + random + ext | program screenshots, family and model pictures |

The directory name `screenshots` is now slightly inaccurate — it holds every image — but `/screenshots/` is wired into `deploy/nginx.conf` and the backup instructions, so the prefixes carry the distinction instead. **SQLite never deletes files**: any handler that removes a row owning a file must `unlink` it first, as the program, emulator and family delete handlers do.

## Data and conventions

- `data/` (SQLite db, `files/`, `screenshots/`, `session-secret`) and `config.json` are gitignored. Backup = those three plus the db.
- All user-facing strings and UI copy are Russian; code comments and identifiers are English. `slugify()` transliterates Cyrillic.
- Admin save (`POST /admin/save`) answers JSON when `Accept: application/json`, HTML otherwise — `admin.js` uses the JSON path, a JS-less browser gets the form path. Keep both working.
- Public URLs: `/` (families), `/catalog`, `/<family>`, `/<family>/<model>`, `/p/<slug>`, `/dl/<slug>`, `/run/<slug>/<emulatorId>`. The family and model pages are the catalog with a fixed filter, so all four share `catalogBody()`.
- A program always belongs to exactly one family (`ON DELETE RESTRICT`) and to any number of models of *that* family — `/admin/save` drops model ids from other families rather than trusting the form.
- Deployment targets systemd (`deploy/retro-catalog.service`, hardened with `ProtectSystem=strict` + `ReadWritePaths=…/data`) behind Caddy or nginx (`deploy/`).
