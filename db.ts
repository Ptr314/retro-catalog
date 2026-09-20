/**
 * Storage layer: SQLite via the built-in node:sqlite module.
 * Synchronous API — fine for this traffic level and much simpler than callbacks.
 */
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { config } from './config.ts';

export type Program = {
  id: number;
  slug: string;
  title: string;
  platform: string;
  category: string;
  year: number | null;
  author: string;
  publisher: string;
  description: string;
  tags: string;
  /** File name inside data/screenshots, or empty. */
  screenshot: string;
  /** External download link, or empty when the file is hosted here. */
  download_url: string;
  /** File name inside data/files, or empty. */
  file_name: string;
  file_size: number | null;
  /** 1 = show the "run in emulator" button. */
  run_enabled: number;
  /** Override: package URL handed to the emulator instead of the default one. */
  run_url: string;
  /** Extra query string for the emulator, e.g. "machine=agat9&ram=128". */
  run_params: string;
  published: number;
  downloads: number;
  runs: number;
  created_at: string;
  updated_at: string;
};

export type ProgramInput = Omit<
  Program,
  'id' | 'screenshot' | 'file_name' | 'file_size' | 'downloads' | 'runs' | 'created_at' | 'updated_at'
>;

export type User = {
  id: number;
  username: string;
  password_hash: string;
  created_at: string;
};

const db = new DatabaseSync(join(config.dataDir, 'catalog.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA busy_timeout = 5000');
db.exec('PRAGMA foreign_keys = ON');

const migrations: string[] = [
  `CREATE TABLE programs (
     id           INTEGER PRIMARY KEY,
     slug         TEXT    NOT NULL UNIQUE,
     title        TEXT    NOT NULL,
     platform     TEXT    NOT NULL DEFAULT '',
     category     TEXT    NOT NULL DEFAULT '',
     year         INTEGER,
     author       TEXT    NOT NULL DEFAULT '',
     publisher    TEXT    NOT NULL DEFAULT '',
     description  TEXT    NOT NULL DEFAULT '',
     tags         TEXT    NOT NULL DEFAULT '',
     screenshot   TEXT    NOT NULL DEFAULT '',
     download_url TEXT    NOT NULL DEFAULT '',
     file_name    TEXT    NOT NULL DEFAULT '',
     file_size    INTEGER,
     run_enabled  INTEGER NOT NULL DEFAULT 1,
     run_url      TEXT    NOT NULL DEFAULT '',
     run_params   TEXT    NOT NULL DEFAULT '',
     published    INTEGER NOT NULL DEFAULT 1,
     downloads    INTEGER NOT NULL DEFAULT 0,
     runs         INTEGER NOT NULL DEFAULT 0,
     search_text  TEXT    NOT NULL DEFAULT '',
     created_at   TEXT    NOT NULL,
     updated_at   TEXT    NOT NULL
   );
   CREATE INDEX programs_platform ON programs(platform);
   CREATE INDEX programs_category ON programs(category);
   CREATE INDEX programs_year     ON programs(year);
   CREATE INDEX programs_created  ON programs(created_at);

   CREATE TABLE users (
     id            INTEGER PRIMARY KEY,
     username      TEXT NOT NULL UNIQUE,
     password_hash TEXT NOT NULL,
     created_at    TEXT NOT NULL
   );`,
];

function migrate(): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  let version = Number(row.user_version);
  while (version < migrations.length) {
    db.exec('BEGIN');
    try {
      db.exec(migrations[version]);
      version += 1;
      db.exec(`PRAGMA user_version = ${version}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    console.log(`db: migrated to version ${version}`);
  }
}

migrate();

const now = (): string => new Date().toISOString();

/** Lowercased haystack: SQLite's LIKE is case-insensitive for ASCII only, Cyrillic needs this. */
function searchText(p: ProgramInput): string {
  return [p.title, p.author, p.publisher, p.platform, p.category, p.tags, p.description]
    .join(' ')
    .toLowerCase();
}

// ---------------------------------------------------------------- programs

export type ListOptions = {
  q?: string;
  platform?: string;
  category?: string;
  year?: number | null;
  sort?: string;
  page?: number;
  perPage?: number;
  includeHidden?: boolean;
};

const SORTS: Record<string, string> = {
  new: 'created_at DESC, id DESC',
  title: 'title ASC',
  year: 'year IS NULL, year DESC, title ASC',
  popular: 'downloads + runs DESC, title ASC',
};

export function listPrograms(opts: ListOptions): { rows: Program[]; total: number; pages: number; page: number } {
  const where: string[] = [];
  const params: (string | number)[] = [];

  if (!opts.includeHidden) where.push('published = 1');
  if (opts.platform) {
    where.push('platform = ?');
    params.push(opts.platform);
  }
  if (opts.category) {
    where.push('category = ?');
    params.push(opts.category);
  }
  if (opts.year) {
    where.push('year = ?');
    params.push(opts.year);
  }
  if (opts.q) {
    where.push('search_text LIKE ?');
    params.push(`%${opts.q.toLowerCase()}%`);
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const countRow = db.prepare(`SELECT COUNT(*) AS n FROM programs ${clause}`).get(...params) as { n: number };
  const total = Number(countRow.n);

  const perPage = Math.min(Math.max(opts.perPage ?? 24, 1), 100);
  const pages = Math.max(Math.ceil(total / perPage), 1);
  const page = Math.min(Math.max(opts.page ?? 1, 1), pages);
  const order = SORTS[opts.sort ?? 'new'] ?? SORTS.new;

  const rows = db
    .prepare(`SELECT * FROM programs ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...params, perPage, (page - 1) * perPage) as unknown as Program[];

  return { rows, total, pages, page };
}

export function getProgramBySlug(slug: string): Program | null {
  return (db.prepare('SELECT * FROM programs WHERE slug = ?').get(slug) as unknown as Program) ?? null;
}

export function getProgramById(id: number): Program | null {
  return (db.prepare('SELECT * FROM programs WHERE id = ?').get(id) as unknown as Program) ?? null;
}

export function createProgram(p: ProgramInput): number {
  const ts = now();
  const result = db
    .prepare(
      `INSERT INTO programs
         (slug, title, platform, category, year, author, publisher, description, tags,
          download_url, run_enabled, run_url, run_params, published, search_text, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      p.slug, p.title, p.platform, p.category, p.year, p.author, p.publisher, p.description, p.tags,
      p.download_url, p.run_enabled, p.run_url, p.run_params, p.published, searchText(p), ts, ts,
    );
  return Number(result.lastInsertRowid);
}

export function updateProgram(id: number, p: ProgramInput): void {
  db.prepare(
    `UPDATE programs SET
       slug = ?, title = ?, platform = ?, category = ?, year = ?, author = ?, publisher = ?,
       description = ?, tags = ?, download_url = ?, run_enabled = ?, run_url = ?, run_params = ?,
       published = ?, search_text = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    p.slug, p.title, p.platform, p.category, p.year, p.author, p.publisher, p.description, p.tags,
    p.download_url, p.run_enabled, p.run_url, p.run_params, p.published, searchText(p), now(), id,
  );
}

export function setScreenshot(id: number, name: string): void {
  db.prepare('UPDATE programs SET screenshot = ?, updated_at = ? WHERE id = ?').run(name, now(), id);
}

export function setFile(id: number, name: string, size: number | null): void {
  db.prepare('UPDATE programs SET file_name = ?, file_size = ?, updated_at = ? WHERE id = ?').run(name, size, now(), id);
}

export function deleteProgram(id: number): void {
  db.prepare('DELETE FROM programs WHERE id = ?').run(id);
}

export function bumpDownloads(id: number): void {
  db.prepare('UPDATE programs SET downloads = downloads + 1 WHERE id = ?').run(id);
}

export function bumpRuns(id: number): void {
  db.prepare('UPDATE programs SET runs = runs + 1 WHERE id = ?').run(id);
}

export function slugExists(slug: string, exceptId = 0): boolean {
  const row = db.prepare('SELECT id FROM programs WHERE slug = ? AND id <> ?').get(slug, exceptId);
  return row !== undefined;
}

/** Facets for the filter bar: only values actually present in the catalog. */
export function facets(): { platforms: { value: string; n: number }[]; categories: { value: string; n: number }[]; years: number[] } {
  const platforms = db
    .prepare(`SELECT platform AS value, COUNT(*) AS n FROM programs WHERE published = 1 AND platform <> '' GROUP BY platform ORDER BY n DESC, value ASC`)
    .all() as unknown as { value: string; n: number }[];
  const categories = db
    .prepare(`SELECT category AS value, COUNT(*) AS n FROM programs WHERE published = 1 AND category <> '' GROUP BY category ORDER BY n DESC, value ASC`)
    .all() as unknown as { value: string; n: number }[];
  const years = (
    db.prepare('SELECT DISTINCT year FROM programs WHERE published = 1 AND year IS NOT NULL ORDER BY year DESC').all() as unknown as { year: number }[]
  ).map((r) => Number(r.year));
  return { platforms, categories, years };
}

export function stats(): { total: number; published: number; withFile: number; downloads: number; runs: number } {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(published) AS published,
              SUM(CASE WHEN file_name <> '' THEN 1 ELSE 0 END) AS withFile,
              COALESCE(SUM(downloads), 0) AS downloads,
              COALESCE(SUM(runs), 0) AS runs
       FROM programs`,
    )
    .get() as Record<string, number | null>;
  return {
    total: Number(row.total ?? 0),
    published: Number(row.published ?? 0),
    withFile: Number(row.withFile ?? 0),
    downloads: Number(row.downloads ?? 0),
    runs: Number(row.runs ?? 0),
  };
}

// ------------------------------------------------------------------- users

export function getUserByName(username: string): User | null {
  return (db.prepare('SELECT * FROM users WHERE username = ?').get(username) as unknown as User) ?? null;
}

export function getUserById(id: number): User | null {
  return (db.prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as User) ?? null;
}

export function createUser(username: string, passwordHash: string): number {
  const result = db
    .prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?,?,?)')
    .run(username, passwordHash, now());
  return Number(result.lastInsertRowid);
}

export function setPasswordHash(id: number, passwordHash: string): void {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, id);
}

export function countUsers(): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
  return Number(row.n);
}

export function listUsers(): User[] {
  return db.prepare('SELECT * FROM users ORDER BY username').all() as unknown as User[];
}

export function close(): void {
  db.close();
}
