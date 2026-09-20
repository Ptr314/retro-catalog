/**
 * Storage layer: SQLite via the built-in node:sqlite module.
 * Synchronous API — fine for this traffic level and much simpler than callbacks.
 */
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { config } from './config.ts';

export type Family = {
  id: number;
  /** The /<family> URL segment. */
  slug: string;
  name: string;
  /** File name inside data/screenshots, or empty. */
  image: string;
  /** Markdown source. */
  description: string;
  /** Markdown: how to help find an author. Shown on "author wanted" programs of this family. */
  wanted_note: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type Model = {
  id: number;
  family_id: number;
  /** The /<family>/<model> URL segment, unique inside the family. */
  slug: string;
  name: string;
  image: string;
  /** Free text, e.g. "1984—1993". */
  years: string;
  description: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type Emulator = {
  id: number;
  name: string;
  /** Launch URL carrying the {url} placeholder for the package address. */
  url_template: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type Category = {
  id: number;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type Program = {
  id: number;
  slug: string;
  title: string;
  family_id: number;
  category_id: number | null;
  year: number | null;
  author: string;
  /** 1 = "Разыскивается автор". */
  author_wanted: number;
  /** Markdown source. */
  description: string;
  /** File name inside data/screenshots, or empty. */
  screenshot: string;
  /** Main download, file name inside data/files, or empty. */
  file_name: string;
  file_size: number | null;
  published: number;
  downloads: number;
  runs: number;
  created_at: string;
  updated_at: string;
};

/** A program joined to the names its pages need. */
export type ProgramRow = Program & {
  family_slug: string;
  family_name: string;
  family_wanted_note: string;
  category_name: string | null;
};

export type ProgramInput = Omit<
  Program,
  'id' | 'screenshot' | 'file_name' | 'file_size' | 'downloads' | 'runs' | 'created_at' | 'updated_at'
>;

export type EmulatorFile = {
  program_id: number;
  emulator_id: number;
  emulator_name: string;
  url_template: string;
  file_name: string;
  file_size: number | null;
  runs: number;
};

export type User = {
  id: number;
  username: string;
  display_name: string;
  password_hash: string;
  created_at: string;
  updated_at: string;
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

  // Reference tables (WO1). Deliberately a clean slate: the flat platform/category
  // columns and the single global emulator have no equivalent in the new model.
  `DROP TABLE IF EXISTS programs;
   DROP TABLE IF EXISTS users;

   CREATE TABLE families (
     id          INTEGER PRIMARY KEY,
     slug        TEXT    NOT NULL UNIQUE,
     name        TEXT    NOT NULL,
     image       TEXT    NOT NULL DEFAULT '',
     description TEXT    NOT NULL DEFAULT '',
     sort_order  INTEGER NOT NULL DEFAULT 0,
     created_at  TEXT    NOT NULL,
     updated_at  TEXT    NOT NULL
   );
   CREATE INDEX families_order ON families(sort_order, id);

   CREATE TABLE models (
     id          INTEGER PRIMARY KEY,
     family_id   INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
     slug        TEXT    NOT NULL,
     name        TEXT    NOT NULL,
     image       TEXT    NOT NULL DEFAULT '',
     years       TEXT    NOT NULL DEFAULT '',
     description TEXT    NOT NULL DEFAULT '',
     sort_order  INTEGER NOT NULL DEFAULT 0,
     created_at  TEXT    NOT NULL,
     updated_at  TEXT    NOT NULL,
     UNIQUE (family_id, slug)
   );
   CREATE INDEX models_family ON models(family_id, sort_order, id);

   CREATE TABLE emulators (
     id           INTEGER PRIMARY KEY,
     name         TEXT    NOT NULL,
     url_template TEXT    NOT NULL,
     sort_order   INTEGER NOT NULL DEFAULT 0,
     created_at   TEXT    NOT NULL,
     updated_at   TEXT    NOT NULL
   );
   CREATE INDEX emulators_order ON emulators(sort_order, id);

   CREATE TABLE categories (
     id         INTEGER PRIMARY KEY,
     name       TEXT    NOT NULL UNIQUE,
     sort_order INTEGER NOT NULL DEFAULT 0,
     created_at TEXT    NOT NULL,
     updated_at TEXT    NOT NULL
   );
   CREATE INDEX categories_order ON categories(sort_order, id);

   CREATE TABLE programs (
     id            INTEGER PRIMARY KEY,
     slug          TEXT    NOT NULL UNIQUE,
     title         TEXT    NOT NULL,
     family_id     INTEGER NOT NULL REFERENCES families(id)   ON DELETE RESTRICT,
     category_id   INTEGER          REFERENCES categories(id) ON DELETE SET NULL,
     year          INTEGER,
     author        TEXT    NOT NULL DEFAULT '',
     author_wanted INTEGER NOT NULL DEFAULT 0,
     description   TEXT    NOT NULL DEFAULT '',
     screenshot    TEXT    NOT NULL DEFAULT '',
     file_name     TEXT    NOT NULL DEFAULT '',
     file_size     INTEGER,
     published     INTEGER NOT NULL DEFAULT 1,
     downloads     INTEGER NOT NULL DEFAULT 0,
     runs          INTEGER NOT NULL DEFAULT 0,
     search_text   TEXT    NOT NULL DEFAULT '',
     created_at    TEXT    NOT NULL,
     updated_at    TEXT    NOT NULL
   );
   CREATE INDEX programs_family   ON programs(family_id);
   CREATE INDEX programs_category ON programs(category_id);
   CREATE INDEX programs_year     ON programs(year);
   CREATE INDEX programs_created  ON programs(created_at);

   CREATE TABLE program_models (
     program_id INTEGER NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
     model_id   INTEGER NOT NULL REFERENCES models(id)   ON DELETE CASCADE,
     PRIMARY KEY (program_id, model_id)
   ) WITHOUT ROWID;
   CREATE INDEX program_models_model ON program_models(model_id);

   CREATE TABLE program_emulator_files (
     program_id  INTEGER NOT NULL REFERENCES programs(id)  ON DELETE CASCADE,
     emulator_id INTEGER NOT NULL REFERENCES emulators(id) ON DELETE CASCADE,
     file_name   TEXT    NOT NULL,
     file_size   INTEGER,
     runs        INTEGER NOT NULL DEFAULT 0,
     updated_at  TEXT    NOT NULL,
     PRIMARY KEY (program_id, emulator_id)
   ) WITHOUT ROWID;
   CREATE INDEX program_emulator_files_emu ON program_emulator_files(emulator_id);

   CREATE TABLE users (
     id            INTEGER PRIMARY KEY,
     username      TEXT NOT NULL UNIQUE,
     display_name  TEXT NOT NULL DEFAULT '',
     password_hash TEXT NOT NULL,
     created_at    TEXT NOT NULL,
     updated_at    TEXT NOT NULL
   );`,

  // Per-family note shown next to "author wanted" programs: whom to write to, what is known.
  `ALTER TABLE families ADD COLUMN wanted_note TEXT NOT NULL DEFAULT '';`,
];

/** Runs fn inside BEGIN/COMMIT, rolling back on any throw. Must not be nested. */
export function transaction<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function migrate(): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  let version = Number(row.user_version);
  while (version < migrations.length) {
    const next = version + 1;
    transaction(() => {
      db.exec(migrations[version]);
      db.exec(`PRAGMA user_version = ${next}`);
    });
    version = next;
    console.log(`db: migrated to version ${version}`);
  }
}

migrate();

const now = (): string => new Date().toISOString();

// ------------------------------------------------------------- reference tables

/** Tables the generic reference CRUD may touch. Never comes from a request. */
export type RefTable = 'families' | 'models' | 'emulators' | 'categories';

export type RefRow = Record<string, string | number | null>;

export function listRef(table: RefTable, familyId: number | null = null): RefRow[] {
  const clause = table === 'models' && familyId ? 'WHERE family_id = ?' : '';
  const params = clause ? [familyId as number] : [];
  return db
    .prepare(`SELECT * FROM ${table} ${clause} ORDER BY sort_order, id`)
    .all(...params) as unknown as RefRow[];
}

export function getRef(table: RefTable, id: number): RefRow | null {
  return (db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as unknown as RefRow) ?? null;
}

/** Columns come from REF_SPECS, values from the form — only the values are bound. */
export function createRef(table: RefTable, values: RefRow): number {
  const columns = Object.keys(values);
  const ts = now();
  const result = db
    .prepare(
      `INSERT INTO ${table} (${columns.join(', ')}, sort_order, created_at, updated_at)
       VALUES (${columns.map(() => '?').join(', ')},
               COALESCE((SELECT MAX(sort_order) FROM ${table}), 0) + 10, ?, ?)`,
    )
    .run(...columns.map((c) => values[c]), ts, ts);
  return Number(result.lastInsertRowid);
}

export function updateRef(table: RefTable, id: number, values: RefRow): void {
  const columns = Object.keys(values);
  db.prepare(`UPDATE ${table} SET ${columns.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .run(...columns.map((c) => values[c]), now(), id);
}

export function deleteRef(table: RefTable, id: number): void {
  db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
}

/** Persists a drag-and-drop order. Gaps of 10 leave room for single-step swaps. */
export function setSortOrder(table: RefTable, ids: number[]): void {
  const stmt = db.prepare(`UPDATE ${table} SET sort_order = ? WHERE id = ?`);
  transaction(() => {
    ids.forEach((id, index) => stmt.run((index + 1) * 10, id));
  });
}

export function listFamilies(): Family[] {
  return db.prepare('SELECT * FROM families ORDER BY sort_order, id').all() as unknown as Family[];
}

/** Families for the home page, with the counts the cards show. */
export function familyCards(): (Family & { programs: number; models: number })[] {
  return db
    .prepare(
      `SELECT f.*,
              (SELECT COUNT(*) FROM programs p WHERE p.family_id = f.id AND p.published = 1) AS programs,
              (SELECT COUNT(*) FROM models m WHERE m.family_id = f.id) AS models
         FROM families f
        ORDER BY f.sort_order, f.id`,
    )
    .all() as unknown as (Family & { programs: number; models: number })[];
}

export function getFamilyById(id: number): Family | null {
  return (db.prepare('SELECT * FROM families WHERE id = ?').get(id) as unknown as Family) ?? null;
}

export function getFamilyBySlug(slug: string): Family | null {
  return (db.prepare('SELECT * FROM families WHERE slug = ?').get(slug) as unknown as Family) ?? null;
}

export function listModels(familyId: number | null = null): Model[] {
  const clause = familyId ? 'WHERE family_id = ?' : '';
  const params = familyId ? [familyId] : [];
  return db
    .prepare(`SELECT * FROM models ${clause} ORDER BY sort_order, id`)
    .all(...params) as unknown as Model[];
}

export function getModelBySlug(familyId: number, slug: string): Model | null {
  return (
    (db.prepare('SELECT * FROM models WHERE family_id = ? AND slug = ?').get(familyId, slug) as unknown as Model) ?? null
  );
}

export function listEmulators(): Emulator[] {
  return db.prepare('SELECT * FROM emulators ORDER BY sort_order, id').all() as unknown as Emulator[];
}

export function listCategories(): Category[] {
  return db.prepare('SELECT * FROM categories ORDER BY sort_order, id').all() as unknown as Category[];
}

export function countProgramsInFamily(familyId: number): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM programs WHERE family_id = ?').get(familyId) as { n: number };
  return Number(row.n);
}

export function countProgramsWithModel(modelId: number): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM program_models WHERE model_id = ?').get(modelId) as { n: number };
  return Number(row.n);
}

export function countModelsInFamily(familyId: number): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM models WHERE family_id = ?').get(familyId) as { n: number };
  return Number(row.n);
}

export function refSlugExists(table: 'families' | 'models', slug: string, familyId: number, exceptId = 0): boolean {
  const row =
    table === 'families'
      ? db.prepare('SELECT id FROM families WHERE slug = ? AND id <> ?').get(slug, exceptId)
      : db.prepare('SELECT id FROM models WHERE slug = ? AND family_id = ? AND id <> ?').get(slug, familyId, exceptId);
  return row !== undefined;
}

// ---------------------------------------------------------------------- programs

export type ListOptions = {
  q?: string;
  familyId?: number | null;
  modelId?: number | null;
  categoryId?: number | null;
  year?: number | null;
  sort?: string;
  page?: number;
  perPage?: number;
  includeHidden?: boolean;
};

const SORTS: Record<string, string> = {
  new: 'p.created_at DESC, p.id DESC',
  title: 'p.title ASC',
  year: 'p.year IS NULL, p.year DESC, p.title ASC',
  popular: 'p.downloads + p.runs DESC, p.title ASC',
};

const PROGRAM_SELECT = `SELECT p.*, f.slug AS family_slug, f.name AS family_name,
         f.wanted_note AS family_wanted_note, c.name AS category_name
  FROM programs p
  JOIN families f ON f.id = p.family_id
  LEFT JOIN categories c ON c.id = p.category_id`;

function listWhere(opts: ListOptions): { clause: string; params: (string | number)[] } {
  const where: string[] = [];
  const params: (string | number)[] = [];

  if (!opts.includeHidden) where.push('p.published = 1');
  if (opts.familyId) {
    where.push('p.family_id = ?');
    params.push(opts.familyId);
  }
  if (opts.modelId) {
    where.push('EXISTS (SELECT 1 FROM program_models pm WHERE pm.program_id = p.id AND pm.model_id = ?)');
    params.push(opts.modelId);
  }
  if (opts.categoryId) {
    where.push('p.category_id = ?');
    params.push(opts.categoryId);
  }
  if (opts.year) {
    where.push('p.year = ?');
    params.push(opts.year);
  }
  if (opts.q) {
    where.push('p.search_text LIKE ?');
    params.push(`%${opts.q.toLowerCase()}%`);
  }

  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

export function listPrograms(opts: ListOptions): { rows: ProgramRow[]; total: number; pages: number; page: number } {
  const { clause, params } = listWhere(opts);

  const countRow = db
    .prepare(`SELECT COUNT(*) AS n FROM programs p ${clause}`)
    .get(...params) as { n: number };
  const total = Number(countRow.n);

  const perPage = Math.min(Math.max(opts.perPage ?? 24, 1), 100);
  const pages = Math.max(Math.ceil(total / perPage), 1);
  const page = Math.min(Math.max(opts.page ?? 1, 1), pages);
  const order = SORTS[opts.sort ?? 'new'] ?? SORTS.new;

  const rows = db
    .prepare(`${PROGRAM_SELECT} ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...params, perPage, (page - 1) * perPage) as unknown as ProgramRow[];

  return { rows, total, pages, page };
}

export function getProgramBySlug(slug: string): ProgramRow | null {
  return (db.prepare(`${PROGRAM_SELECT} WHERE p.slug = ?`).get(slug) as unknown as ProgramRow) ?? null;
}

export function getProgramById(id: number): ProgramRow | null {
  return (db.prepare(`${PROGRAM_SELECT} WHERE p.id = ?`).get(id) as unknown as ProgramRow) ?? null;
}

export function slugExists(slug: string, exceptId = 0): boolean {
  const row = db.prepare('SELECT id FROM programs WHERE slug = ? AND id <> ?').get(slug, exceptId);
  return row !== undefined;
}

export function createProgram(p: ProgramInput, modelIds: number[]): number {
  return transaction(() => {
    const ts = now();
    const result = db
      .prepare(
        `INSERT INTO programs
           (slug, title, family_id, category_id, year, author, author_wanted, description, published, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        p.slug, p.title, p.family_id, p.category_id, p.year, p.author, p.author_wanted,
        p.description, p.published, ts, ts,
      );
    const id = Number(result.lastInsertRowid);
    writeProgramModels(id, modelIds);
    writeSearchText(id);
    return id;
  });
}

export function updateProgram(id: number, p: ProgramInput, modelIds: number[]): void {
  transaction(() => {
    db.prepare(
      `UPDATE programs SET
         slug = ?, title = ?, family_id = ?, category_id = ?, year = ?, author = ?,
         author_wanted = ?, description = ?, published = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      p.slug, p.title, p.family_id, p.category_id, p.year, p.author,
      p.author_wanted, p.description, p.published, now(), id,
    );
    writeProgramModels(id, modelIds);
    writeSearchText(id);
  });
}

export function deleteProgram(id: number): void {
  db.prepare('DELETE FROM programs WHERE id = ?').run(id);
}

export function setScreenshot(id: number, name: string): void {
  db.prepare('UPDATE programs SET screenshot = ?, updated_at = ? WHERE id = ?').run(name, now(), id);
}

export function setFile(id: number, name: string, size: number | null): void {
  db.prepare('UPDATE programs SET file_name = ?, file_size = ?, updated_at = ? WHERE id = ?').run(name, size, now(), id);
}

/** Family and model pictures live in the same directory as program screenshots. */
export function setImage(table: 'families' | 'models', id: number, name: string): void {
  db.prepare(`UPDATE ${table} SET image = ?, updated_at = ? WHERE id = ?`).run(name, now(), id);
}

export function bumpDownloads(id: number): void {
  db.prepare('UPDATE programs SET downloads = downloads + 1 WHERE id = ?').run(id);
}

/** Both counters: the program one drives "popular", the per-emulator one is reporting. */
export function bumpRuns(programId: number, emulatorId: number): void {
  transaction(() => {
    db.prepare('UPDATE programs SET runs = runs + 1 WHERE id = ?').run(programId);
    db.prepare('UPDATE program_emulator_files SET runs = runs + 1 WHERE program_id = ? AND emulator_id = ?')
      .run(programId, emulatorId);
  });
}

function writeProgramModels(programId: number, modelIds: number[]): void {
  db.prepare('DELETE FROM program_models WHERE program_id = ?').run(programId);
  const stmt = db.prepare('INSERT OR IGNORE INTO program_models (program_id, model_id) VALUES (?,?)');
  for (const modelId of modelIds) stmt.run(programId, modelId);
}

export function modelIdsForProgram(programId: number): number[] {
  return (
    db.prepare('SELECT model_id FROM program_models WHERE program_id = ?').all(programId) as unknown as {
      model_id: number;
    }[]
  ).map((r) => Number(r.model_id));
}

export function modelsForProgram(programId: number): Model[] {
  return db
    .prepare(
      `SELECT m.* FROM models m
       JOIN program_models pm ON pm.model_id = m.id
       WHERE pm.program_id = ?
       ORDER BY m.sort_order, m.id`,
    )
    .all(programId) as unknown as Model[];
}

// --------------------------------------------------------------- emulator files

export function emulatorFilesFor(programIds: number[]): Map<number, EmulatorFile[]> {
  const out = new Map<number, EmulatorFile[]>();
  if (programIds.length === 0) return out;
  const rows = db
    .prepare(
      `SELECT pef.*, e.name AS emulator_name, e.url_template
       FROM program_emulator_files pef
       JOIN emulators e ON e.id = pef.emulator_id
       WHERE pef.program_id IN (${programIds.map(() => '?').join(',')})
       ORDER BY e.sort_order, e.id`,
    )
    .all(...programIds) as unknown as EmulatorFile[];
  for (const row of rows) {
    const list = out.get(Number(row.program_id)) ?? [];
    list.push(row);
    out.set(Number(row.program_id), list);
  }
  return out;
}

export function getEmulatorFile(programId: number, emulatorId: number): EmulatorFile | null {
  return (
    (db
      .prepare(
        `SELECT pef.*, e.name AS emulator_name, e.url_template
         FROM program_emulator_files pef
         JOIN emulators e ON e.id = pef.emulator_id
         WHERE pef.program_id = ? AND pef.emulator_id = ?`,
      )
      .get(programId, emulatorId) as unknown as EmulatorFile) ?? null
  );
}

export function setEmulatorFile(programId: number, emulatorId: number, name: string, size: number | null): void {
  db.prepare(
    `INSERT INTO program_emulator_files (program_id, emulator_id, file_name, file_size, updated_at)
     VALUES (?,?,?,?,?)
     ON CONFLICT (program_id, emulator_id)
     DO UPDATE SET file_name = excluded.file_name, file_size = excluded.file_size, updated_at = excluded.updated_at`,
  ).run(programId, emulatorId, name, size, now());
}

export function clearEmulatorFile(programId: number, emulatorId: number): void {
  db.prepare('DELETE FROM program_emulator_files WHERE program_id = ? AND emulator_id = ?').run(programId, emulatorId);
}

/** File names an emulator owns across all programs — unlinked before the row disappears. */
export function emulatorFileNames(emulatorId: number): string[] {
  return (
    db.prepare('SELECT file_name FROM program_emulator_files WHERE emulator_id = ?').all(emulatorId) as unknown as {
      file_name: string;
    }[]
  ).map((r) => String(r.file_name));
}

export function programFileNames(programId: number): string[] {
  return (
    db.prepare('SELECT file_name FROM program_emulator_files WHERE program_id = ?').all(programId) as unknown as {
      file_name: string;
    }[]
  ).map((r) => String(r.file_name));
}

// ------------------------------------------------------------------ search text

type SearchSource = {
  id: number;
  title: string;
  author: string;
  year: number | null;
  description: string;
  author_wanted: number;
  family_name: string;
  category_name: string | null;
  model_names: string | null;
};

/**
 * Rebuilds the LIKE haystack. Lowercasing happens here and not in SQL on purpose:
 * SQLite's lower() is ASCII-only, so lower('Игра') would still be 'Игра'.
 * No id rebuilds every program — cheap at this size and impossible to get wrong.
 */
export function rebuildSearchText(programId?: number): void {
  const rows = db
    .prepare(
      `SELECT p.id, p.title, p.author, p.year, p.description, p.author_wanted,
              f.name AS family_name, c.name AS category_name,
              (SELECT group_concat(m.name, ' ')
                 FROM program_models pm JOIN models m ON m.id = pm.model_id
                WHERE pm.program_id = p.id) AS model_names
         FROM programs p
         JOIN families f ON f.id = p.family_id
         LEFT JOIN categories c ON c.id = p.category_id
        ${programId ? 'WHERE p.id = ?' : ''}`,
    )
    .all(...(programId ? [programId] : [])) as unknown as SearchSource[];

  const stmt = db.prepare('UPDATE programs SET search_text = ? WHERE id = ?');
  for (const row of rows) stmt.run(haystack(row), row.id);
}

function haystack(row: SearchSource): string {
  return [
    row.title,
    row.author,
    row.year ? String(row.year) : '',
    row.family_name,
    row.category_name ?? '',
    row.model_names ?? '',
    row.description,
    row.author_wanted ? 'разыскивается автор' : '',
  ]
    .join(' ')
    .toLowerCase();
}

/** Called inside createProgram/updateProgram, which already hold a transaction. */
function writeSearchText(programId: number): void {
  rebuildSearchText(programId);
}

// ----------------------------------------------------------------------- facets

export type Facets = {
  models: { id: number; name: string; n: number }[];
  categories: { id: number; name: string; n: number }[];
  years: number[];
};

/** Filter-bar values, scoped to a family when one is selected. */
export function facets(familyId: number | null = null): Facets {
  const familyClause = familyId ? 'AND p.family_id = ?' : '';
  const params = familyId ? [familyId] : [];

  const models = db
    .prepare(
      `SELECT m.id, m.name, COUNT(*) AS n
         FROM program_models pm
         JOIN models m ON m.id = pm.model_id
         JOIN programs p ON p.id = pm.program_id
        WHERE p.published = 1 ${familyClause}
        GROUP BY m.id, m.name
        ORDER BY m.sort_order, m.id`,
    )
    .all(...params) as unknown as { id: number; name: string; n: number }[];

  const categories = db
    .prepare(
      `SELECT c.id, c.name, COUNT(*) AS n
         FROM programs p JOIN categories c ON c.id = p.category_id
        WHERE p.published = 1 ${familyClause}
        GROUP BY c.id, c.name
        ORDER BY c.sort_order, c.id`,
    )
    .all(...params) as unknown as { id: number; name: string; n: number }[];

  const years = (
    db
      .prepare(
        `SELECT DISTINCT p.year FROM programs p
          WHERE p.published = 1 AND p.year IS NOT NULL ${familyClause}
          ORDER BY p.year DESC`,
      )
      .all(...params) as unknown as { year: number }[]
  ).map((r) => Number(r.year));

  return { models, categories, years };
}

export type Stats = {
  programs: number;
  published: number;
  withFile: number;
  families: number;
  models: number;
  emulators: number;
  downloads: number;
  runs: number;
};

export function stats(): Stats {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS programs,
              COALESCE(SUM(published), 0) AS published,
              SUM(CASE WHEN file_name <> '' THEN 1 ELSE 0 END) AS withFile,
              COALESCE(SUM(downloads), 0) AS downloads,
              COALESCE(SUM(runs), 0) AS runs
         FROM programs`,
    )
    .get() as Record<string, number | null>;
  const count = (table: RefTable): number =>
    Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);

  return {
    programs: Number(row.programs ?? 0),
    published: Number(row.published ?? 0),
    withFile: Number(row.withFile ?? 0),
    families: count('families'),
    models: count('models'),
    emulators: count('emulators'),
    downloads: Number(row.downloads ?? 0),
    runs: Number(row.runs ?? 0),
  };
}

// ------------------------------------------------------------------------ users

export function getUserByName(username: string): User | null {
  return (db.prepare('SELECT * FROM users WHERE username = ?').get(username) as unknown as User) ?? null;
}

export function getUserById(id: number): User | null {
  return (db.prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as User) ?? null;
}

export function createUser(username: string, passwordHash: string, displayName = ''): number {
  const ts = now();
  const result = db
    .prepare('INSERT INTO users (username, display_name, password_hash, created_at, updated_at) VALUES (?,?,?,?,?)')
    .run(username, displayName, passwordHash, ts, ts);
  return Number(result.lastInsertRowid);
}

export function updateUser(id: number, username: string, displayName: string): void {
  db.prepare('UPDATE users SET username = ?, display_name = ?, updated_at = ? WHERE id = ?')
    .run(username, displayName, now(), id);
}

export function setPasswordHash(id: number, passwordHash: string): void {
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(passwordHash, now(), id);
}

export function deleteUser(id: number): void {
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
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
