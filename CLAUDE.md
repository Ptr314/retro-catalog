# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start                      # server on config.host:config.port (default 127.0.0.1:8080)
npm run user -- add <login>    # create an admin; password asked interactively or via $PASSWORD
npm run user -- passwd <login> # change a password
npm run user -- list
npm run import -- catalog.json # bulk upsert from JSON, matched by slug (format documented in tools/import.ts)
```

There is no build, no lint, no test suite and no `node_modules` — `npm install` is not part of the workflow. Every script is just `node --disable-warning=ExperimentalWarning <file>.ts`, so any file can be run the same way directly.

First-time setup: `cp config.example.json config.json`, set `siteUrl` and `emulator.baseUrl`, then create a user.

## Hard constraints

- **Node >= 24, zero dependencies.** TypeScript runs through Node's native type stripping — no compiler, no bundler. Consequences: relative imports must carry the `.ts` extension (`./db.ts`), and only erasable syntax is allowed (no `enum`, no parameter properties, no decorators).
- **Never add an npm dependency.** Everything comes from the standard library: `node:sqlite` for storage, `node:crypto` for passwords and session signatures, `node:http` for the server.
- **No `multipart/form-data` parser exists, deliberately.** Admin forms post `application/x-www-form-urlencoded`; file uploads are separate `PUT` requests whose body is the raw file (`public/admin.js` drives them with XHR for a progress bar). Keep any new upload on that shape.

## Architecture

Flat module layout, each file one concern; `views/` renders, everything else is logic.

**Routing (`server.ts`).** A hand-rolled table: `route(method, path, handler, auth)` compiles `:param` into `([^/]+)`. `dispatch()` centralizes the cross-cutting checks *before* calling a handler — session lookup, the `auth` flag (GET redirects to `/admin/login`, others get 401 JSON), and the same-origin check on every POST/PUT. Handlers therefore never repeat auth or CSRF logic; `ctx.user!` is safe inside an `auth: true` route. `HEAD` is dispatched as `GET`, and `sendFile` handles the empty body.

**Storage (`db.ts`).** `node:sqlite`'s synchronous API, WAL mode, one module-level connection. Schema changes go through the `migrations` array, applied against `PRAGMA user_version`: **append a new entry, never edit an existing one** — deployed databases only run the tail of the array.

`programs.search_text` is a denormalized lowercased concatenation of the text fields, rebuilt by `searchText()` inside `createProgram`/`updateProgram`. It exists because SQLite's `LIKE` is case-insensitive for ASCII only and the catalog is Cyrillic. Any new searchable column must be added there too, or it silently won't be findable.

**Views (`views/`).** Plain functions returning HTML strings, composed through `layout()`. Every interpolated value must pass through `escapeHtml()`. The CSP sent by `http.ts#html` is `script-src 'self'; style-src 'self'` — inline `<script>`, inline `<style>` and `onclick=` attributes will not execute. Client behaviour belongs in `public/admin.js`, served from `/static/`.

**`config.siteUrl` is load-bearing in two unrelated places:** it builds the absolute package URLs handed to the emulator, and it is the origin compared in `sameOrigin()`. If it does not match how the site is actually reached, emulator links break *and* every admin POST returns 403.

**Emulator handoff.** `runTarget()` in `server.ts` resolves the package URL from the first of: `run_url` override → uploaded file as `{siteUrl}/files/{name}` → external `download_url`; then merges the record's `run_params` into `emulator.baseUrl` and appends `emulator.param`. The emulator fetches that URL itself cross-origin, which is why `/files/` and `/screenshots/` carry CORS headers and `sendFile` implements `Range`.

**Sessions (`auth.ts`).** Stateless: the cookie holds `{uid, exp}` base64url-encoded plus an HMAC-SHA256 signature, verified with `timingSafeEqual`. There is no sessions table — replacing `data/session-secret` logs everyone out. Login throttling is an in-process `Map` keyed by IP, so it resets on restart and is per-process.

**Uploads.** Image type is decided by `detectImage()` from the file's magic bytes, not the client's `Content-Type`. Stored names are generated server-side (`{id}-{slug}{ext}` for files, `{id}-{random}{ext}` for screenshots) and every static route gates on `isSafeName()` before joining a path. Replacing an asset unlinks the previous one; so does deleting a program.

## Data and conventions

- `data/` (SQLite db, `files/`, `screenshots/`, `session-secret`) and `config.json` are gitignored. Backup = those three plus the db.
- All user-facing strings and UI copy are Russian; code comments and identifiers are English. `slugify()` transliterates Cyrillic.
- Admin save (`POST /admin/save`) answers JSON when `Accept: application/json`, HTML otherwise — `admin.js` uses the JSON path, a JS-less browser gets the form path. Keep both working.
- Deployment targets systemd (`deploy/retro-catalog.service`, hardened with `ProtectSystem=strict` + `ReadWritePaths=…/data`) behind Caddy or nginx (`deploy/`).
