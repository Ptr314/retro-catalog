/**
 * Storage layer: SQLite via the built-in node:sqlite module.
 * Synchronous API — fine for this traffic level and much simpler than callbacks.
 */
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { config } from './config.ts';
import { metadataSearchText } from './metadata.ts';

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
  /** Launch URL with placeholders: {url}, {rawurl}, {meta:key} (see server.ts#emulatorLaunchUrl). */
  url_template: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type Category = {
  id: number;
  /** NULL for a top-level category; otherwise the top-level one it sits under. Two levels only. */
  parent_id: number | null;
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
  /** 1 = shown first under the "new" order. */
  promoted: number;
  /** http(s) link shown as «Автор/Источник», or empty. */
  source_url: string;
  /** Markdown source. */
  description: string;
  /** Free text credits, filled mostly by integrations. */
  graphics: string;
  music: string;
  /** "key:value" lines (see metadata.ts): import parameters, also fed to {meta:key} in emulator templates. */
  metadata: string;
  /** The external system a row was imported from, and its id there. Both empty for hand-made rows. */
  integration: string;
  external_id: string;
  /** Hash of the source record at the last import; the importer skips a row whose hash is unchanged. */
  source_hash: string;
  /** ISO date since which the importer no longer finds the row in its source, or empty. */
  missing_since: string;
  /** The cover: the first of program_screenshots, denormalised. File name inside data/screenshots, or empty. */
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
  /** Set when the program's category is a second-level one. */
  category_parent_id: number | null;
  category_parent_name: string | null;
};

export type ProgramInput = Omit<
  Program,
  | 'id' | 'screenshot' | 'file_name' | 'file_size' | 'downloads' | 'runs' | 'created_at' | 'updated_at'
  | 'integration' | 'external_id' | 'source_hash' | 'missing_since'
>;

export type Screenshot = {
  id: number;
  program_id: number;
  /** File name inside data/screenshots. */
  file_name: string;
  sort_order: number;
  /** Where an importer took the picture from; empty for an uploaded one. */
  source_url: string;
  created_at: string;
};

/**
 * What a program offers one emulator: an uploaded file, a ready-made launch address,
 * or both — in which case the file wins (see `packageUrlFor` in server.ts).
 */
export type EmulatorFile = {
  program_id: number;
  emulator_id: number;
  emulator_name: string;
  url_template: string;
  /** File in data/files, or empty. */
  file_name: string;
  file_size: number | null;
  /** http(s) address handed to the emulator when no file is uploaded, or empty. */
  file_url: string;
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

  // Where the program came from: the author's page or the archive it was taken from.
  `ALTER TABLE programs ADD COLUMN source_url TEXT NOT NULL DEFAULT '';`,

  // A slot may hold a ready-made launch address instead of an uploaded file, so a row
  // here no longer implies a file: file_name and file_url are both optional, but a row
  // with neither is deleted rather than kept.
  `ALTER TABLE program_emulator_files ADD COLUMN file_url TEXT NOT NULL DEFAULT '';`,

  // Promoted programs head the "new" order.
  `ALTER TABLE programs ADD COLUMN promoted INTEGER NOT NULL DEFAULT 0;`,

  // Integrations: two-level categories, external ids and metadata, several screenshots.
  //
  // categories is rebuilt because its column-level UNIQUE(name) cannot be dropped, and a
  // genre may repeat under different parents. DROP TABLE fires programs.category_id's
  // ON DELETE SET NULL, so the links are parked in a temp table and put back afterwards.
  `CREATE TABLE categories_new (
     id         INTEGER PRIMARY KEY,
     parent_id  INTEGER REFERENCES categories_new(id) ON DELETE RESTRICT,
     name       TEXT    NOT NULL,
     sort_order INTEGER NOT NULL DEFAULT 0,
     created_at TEXT    NOT NULL,
     updated_at TEXT    NOT NULL
   );
   INSERT INTO categories_new (id, parent_id, name, sort_order, created_at, updated_at)
     SELECT id, NULL, name, sort_order, created_at, updated_at FROM categories;
   CREATE TEMP TABLE category_links AS
     SELECT id, category_id FROM programs WHERE category_id IS NOT NULL;
   DROP TABLE categories;
   ALTER TABLE categories_new RENAME TO categories;
   UPDATE programs
      SET category_id = (SELECT l.category_id FROM category_links l WHERE l.id = programs.id)
    WHERE id IN (SELECT id FROM category_links);
   DROP TABLE category_links;
   CREATE INDEX categories_order ON categories(parent_id, sort_order, id);
   CREATE UNIQUE INDEX categories_name ON categories(COALESCE(parent_id, 0), name);

   ALTER TABLE programs ADD COLUMN integration   TEXT NOT NULL DEFAULT '';
   ALTER TABLE programs ADD COLUMN external_id   TEXT NOT NULL DEFAULT '';
   ALTER TABLE programs ADD COLUMN metadata      TEXT NOT NULL DEFAULT '';
   ALTER TABLE programs ADD COLUMN graphics      TEXT NOT NULL DEFAULT '';
   ALTER TABLE programs ADD COLUMN music         TEXT NOT NULL DEFAULT '';
   ALTER TABLE programs ADD COLUMN source_hash   TEXT NOT NULL DEFAULT '';
   ALTER TABLE programs ADD COLUMN missing_since TEXT NOT NULL DEFAULT '';
   CREATE UNIQUE INDEX programs_external ON programs(integration, external_id) WHERE integration <> '';

   CREATE TABLE program_screenshots (
     id         INTEGER PRIMARY KEY,
     program_id INTEGER NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
     file_name  TEXT    NOT NULL,
     sort_order INTEGER NOT NULL DEFAULT 0,
     source_url TEXT    NOT NULL DEFAULT '',
     created_at TEXT    NOT NULL
   );
   CREATE INDEX program_screenshots_program ON program_screenshots(program_id, sort_order, id);
   INSERT INTO program_screenshots (program_id, file_name, sort_order, created_at)
     SELECT id, screenshot, 10, updated_at FROM programs WHERE screenshot <> '';`,
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

/** parentId narrows models to a family and categories to the children of one category. */
export function listRef(table: RefTable, parentId: number | null = null): RefRow[] {
  const column = table === 'models' ? 'family_id' : table === 'categories' ? 'parent_id' : '';
  const clause = column && parentId ? `WHERE ${column} = ?` : '';
  const params = clause ? [parentId as number] : [];
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

/** Both levels; callers split them by parent_id. */
export function listCategories(): Category[] {
  return db.prepare('SELECT * FROM categories ORDER BY sort_order, id').all() as unknown as Category[];
}

export function countSubcategories(categoryId: number): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM categories WHERE parent_id = ?').get(categoryId) as { n: number };
  return Number(row.n);
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
  /** A top-level category matches its own programs and those of its subcategories. */
  categoryId?: number | null;
  subcategoryId?: number | null;
  year?: number | null;
  /** Admin list: only rows the importer no longer finds in their source. */
  missingOnly?: boolean;
  sort?: string;
  page?: number;
  perPage?: number;
  includeHidden?: boolean;
};

const SORTS: Record<string, string> = {
  new: 'p.promoted DESC, p.created_at DESC, p.id DESC',
  title: 'p.title ASC',
  year: 'p.year IS NULL, p.year DESC, p.title ASC',
  popular: 'p.downloads + p.runs DESC, p.title ASC',
};

const PROGRAM_SELECT = `SELECT p.*, f.slug AS family_slug, f.name AS family_name,
         f.wanted_note AS family_wanted_note, c.name AS category_name,
         c.parent_id AS category_parent_id, pc.name AS category_parent_name
  FROM programs p
  JOIN families f ON f.id = p.family_id
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN categories pc ON pc.id = c.parent_id`;

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
    where.push('(p.category_id = ? OR p.category_id IN (SELECT id FROM categories WHERE parent_id = ?))');
    params.push(opts.categoryId, opts.categoryId);
  }
  if (opts.subcategoryId) {
    where.push('p.category_id = ?');
    params.push(opts.subcategoryId);
  }
  if (opts.missingOnly) where.push("p.missing_since <> ''");
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

/**
 * A program lives at /<family>/<slug>, the same shape as a model page, and the model
 * wins there. So a program slug is taken when another program has it or any model does —
 * any, not only its own family's, because a program can be moved to another family.
 * catalog_db.py#slug_taken is the importer's copy of this rule.
 */
export function slugTaken(slug: string, exceptProgramId = 0): boolean {
  if (slugExists(slug, exceptProgramId)) return true;
  return db.prepare('SELECT id FROM models WHERE slug = ?').get(slug) !== undefined;
}

export function createProgram(p: ProgramInput, modelIds: number[]): number {
  return transaction(() => {
    const ts = now();
    const result = db
      .prepare(
        `INSERT INTO programs
           (slug, title, family_id, category_id, year, author, author_wanted, promoted, source_url,
            description, graphics, music, metadata, published, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        p.slug, p.title, p.family_id, p.category_id, p.year, p.author, p.author_wanted, p.promoted, p.source_url,
        p.description, p.graphics, p.music, p.metadata, p.published, ts, ts,
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
         author_wanted = ?, promoted = ?, source_url = ?, description = ?, graphics = ?, music = ?,
         metadata = ?, published = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      p.slug, p.title, p.family_id, p.category_id, p.year, p.author,
      p.author_wanted, p.promoted, p.source_url, p.description, p.graphics, p.music,
      p.metadata, p.published, now(), id,
    );
    writeProgramModels(id, modelIds);
    writeSearchText(id);
  });
}

export function deleteProgram(id: number): void {
  db.prepare('DELETE FROM programs WHERE id = ?').run(id);
}

/** The administrator has dealt with a row the importer reported as gone from its source. */
export function clearMissing(id: number): void {
  db.prepare("UPDATE programs SET missing_since = '' WHERE id = ?").run(id);
}

// ------------------------------------------------------------------ screenshots

export function listScreenshots(programId: number): Screenshot[] {
  return db
    .prepare('SELECT * FROM program_screenshots WHERE program_id = ? ORDER BY sort_order, id')
    .all(programId) as unknown as Screenshot[];
}

export function getScreenshot(id: number): Screenshot | null {
  return (db.prepare('SELECT * FROM program_screenshots WHERE id = ?').get(id) as unknown as Screenshot) ?? null;
}

/** Appends to the end of the program's strip. */
export function addScreenshot(programId: number, fileName: string): number {
  return transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO program_screenshots (program_id, file_name, sort_order, created_at)
         VALUES (?, ?, COALESCE((SELECT MAX(sort_order) FROM program_screenshots WHERE program_id = ?), 0) + 10, ?)`,
      )
      .run(programId, fileName, programId, now());
    syncCover(programId);
    return Number(result.lastInsertRowid);
  });
}

export function deleteScreenshot(id: number): void {
  transaction(() => {
    const row = getScreenshot(id);
    if (!row) return;
    db.prepare('DELETE FROM program_screenshots WHERE id = ?').run(id);
    syncCover(Number(row.program_id));
  });
}

/** Ids of another program are ignored: the WHERE pins the rows to this one. */
export function setScreenshotOrder(programId: number, ids: number[]): void {
  const stmt = db.prepare('UPDATE program_screenshots SET sort_order = ? WHERE id = ? AND program_id = ?');
  transaction(() => {
    ids.forEach((id, index) => stmt.run((index + 1) * 10, id, programId));
    syncCover(programId);
  });
}

/**
 * programs.screenshot mirrors the first screenshot, so tiles and lists read the cover
 * without a join. Every change to program_screenshots ends here, inside its transaction;
 * catalog_db.py#sync_cover does the same for the importer.
 */
function syncCover(programId: number): void {
  db.prepare(
    `UPDATE programs
        SET screenshot = COALESCE((SELECT file_name FROM program_screenshots
                                    WHERE program_id = ? ORDER BY sort_order, id LIMIT 1), '')
      WHERE id = ?`,
  ).run(programId, programId);
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
         AND (pef.file_name <> '' OR pef.file_url <> '')
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

/** The launch address used when nothing is uploaded. Empty removes it. */
export function setEmulatorUrl(programId: number, emulatorId: number, url: string): void {
  transaction(() => {
    if (url) {
      db.prepare(
        `INSERT INTO program_emulator_files (program_id, emulator_id, file_name, file_size, file_url, updated_at)
         VALUES (?,?,'',NULL,?,?)
         ON CONFLICT (program_id, emulator_id)
         DO UPDATE SET file_url = excluded.file_url, updated_at = excluded.updated_at`,
      ).run(programId, emulatorId, url, now());
      return;
    }
    db.prepare(
      `UPDATE program_emulator_files SET file_url = '', updated_at = ?
       WHERE program_id = ? AND emulator_id = ?`,
    ).run(now(), programId, emulatorId);
    dropEmptySlot(programId, emulatorId);
  });
}

export function clearEmulatorFile(programId: number, emulatorId: number): void {
  transaction(() => {
    db.prepare(
      `UPDATE program_emulator_files SET file_name = '', file_size = NULL, updated_at = ?
       WHERE program_id = ? AND emulator_id = ?`,
    ).run(now(), programId, emulatorId);
    // The slot survives if it still carries a launch address.
    dropEmptySlot(programId, emulatorId);
  });
}

function dropEmptySlot(programId: number, emulatorId: number): void {
  db.prepare(
    `DELETE FROM program_emulator_files
      WHERE program_id = ? AND emulator_id = ? AND file_name = '' AND file_url = ''`,
  ).run(programId, emulatorId);
}

/** Programs this emulator can launch, by file or by address. */
export function countProgramsWithEmulator(emulatorId: number): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM program_emulator_files WHERE emulator_id = ?')
    .get(emulatorId) as { n: number };
  return Number(row.n);
}

/** File names an emulator owns across all programs — unlinked before the row disappears. */
export function emulatorFileNames(emulatorId: number): string[] {
  return (
    db
      .prepare("SELECT file_name FROM program_emulator_files WHERE emulator_id = ? AND file_name <> ''")
      .all(emulatorId) as unknown as { file_name: string }[]
  ).map((r) => String(r.file_name));
}

/**
 * Does any row still name this stored file? The program's download and its emulator
 * slots may share one file, so nothing is unlinked while this is true.
 * catalog_db.py#file_referenced is the importer's copy.
 */
export function fileReferenced(name: string): boolean {
  if (db.prepare('SELECT 1 FROM programs WHERE file_name = ? LIMIT 1').get(name) !== undefined) return true;
  return db.prepare('SELECT 1 FROM program_emulator_files WHERE file_name = ? LIMIT 1').get(name) !== undefined;
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
  category_parent_name: string | null;
  model_names: string | null;
  graphics: string;
  music: string;
  metadata: string;
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
              p.graphics, p.music, p.metadata,
              f.name AS family_name, c.name AS category_name, pc.name AS category_parent_name,
              (SELECT group_concat(m.name, ' ')
                 FROM program_models pm JOIN models m ON m.id = pm.model_id
                WHERE pm.program_id = p.id) AS model_names
         FROM programs p
         JOIN families f ON f.id = p.family_id
         LEFT JOIN categories c ON c.id = p.category_id
         LEFT JOIN categories pc ON pc.id = c.parent_id
        ${programId ? 'WHERE p.id = ?' : ''}`,
    )
    .all(...(programId ? [programId] : [])) as unknown as SearchSource[];

  const stmt = db.prepare('UPDATE programs SET search_text = ? WHERE id = ?');
  for (const row of rows) stmt.run(haystack(row), row.id);
}

/** catalog_db.py#haystack is the importer's copy: same parts, same order. Change both. */
function haystack(row: SearchSource): string {
  return [
    row.title,
    row.author,
    row.year ? String(row.year) : '',
    row.family_name,
    row.category_parent_name ?? '',
    row.category_name ?? '',
    row.model_names ?? '',
    row.description,
    row.author_wanted ? 'разыскивается автор' : '',
    row.graphics,
    row.music,
    metadataSearchText(row.metadata),
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
  /** Top level only; a count includes the programs of the subcategories. */
  categories: { id: number; name: string; n: number }[];
  /** Children of the chosen category that have programs; empty when none is chosen. */
  subcategories: { id: number; name: string; n: number }[];
  years: number[];
};

/** Filter-bar values, scoped to a family when one is selected. */
export function facets(familyId: number | null = null, categoryId: number | null = null): Facets {
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
      `SELECT t.id, t.name, COUNT(*) AS n
         FROM programs p
         JOIN categories c ON c.id = p.category_id
         JOIN categories t ON t.id = COALESCE(c.parent_id, c.id)
        WHERE p.published = 1 ${familyClause}
        GROUP BY t.id, t.name
        ORDER BY t.sort_order, t.id`,
    )
    .all(...params) as unknown as { id: number; name: string; n: number }[];

  const subcategories = categoryId
    ? (db
        .prepare(
          `SELECT c.id, c.name, COUNT(*) AS n
             FROM programs p JOIN categories c ON c.id = p.category_id
            WHERE p.published = 1 AND c.parent_id = ? ${familyClause}
            GROUP BY c.id, c.name
            ORDER BY c.sort_order, c.id`,
        )
        .all(categoryId, ...params) as unknown as { id: number; name: string; n: number }[])
    : [];

  const years = (
    db
      .prepare(
        `SELECT DISTINCT p.year FROM programs p
          WHERE p.published = 1 AND p.year IS NOT NULL ${familyClause}
          ORDER BY p.year DESC`,
      )
      .all(...params) as unknown as { year: number }[]
  ).map((r) => Number(r.year));

  return { models, categories, subcategories, years };
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

// ----------------------------------------------------------------------- report

/** Everything the admin's statistics page reads from the database, in one pass. */
export type Report = {
  engine: {
    sqliteVersion: string;
    schemaVersion: number;
    journalMode: string;
    pageSize: number;
    pageCount: number;
    /** Pages inside the file that hold nothing: space a VACUUM would give back. */
    freePages: number;
  };
  /** Row counts, table by table. */
  tables: { name: string; rows: number }[];
  programs: {
    total: number;
    published: number;
    promoted: number;
    authorWanted: number;
    missing: number;
    withFile: number;
    withLaunch: number;
    withScreenshot: number;
    withoutCategory: number;
    withoutModels: number;
    withoutDescription: number;
    withoutYear: number;
    withoutAuthor: number;
    yearFrom: number | null;
    yearTo: number | null;
    downloads: number;
    runs: number;
    firstCreated: string;
    lastCreated: string;
    lastUpdated: string;
  };
  categories: { top: number; sub: number };
  byFamily: { name: string; slug: string; models: number; programs: number; published: number; downloads: number; runs: number; bytes: number }[];
  /** Top level; programs of the subcategories are counted in. The last row, id 0, is "no category". */
  byCategory: { id: number; name: string; subcategories: number; programs: number }[];
  /** integration '' = made by hand. */
  byIntegration: { integration: string; programs: number; published: number; missing: number; lastUpdated: string }[];
  /** decade 0 = year unknown. */
  byDecade: { decade: number; programs: number }[];
  byEmulator: { name: string; slots: number; files: number; links: number; bytes: number; runs: number }[];
  popular: { title: string; slug: string; family_slug: string; downloads: number; runs: number }[];
  recent: { title: string; slug: string; family_slug: string; created_at: string; integration: string }[];
  /** File names the database refers to, for comparing with what is on disk. */
  referenced: { files: string[]; screenshots: string[] };
  screenshots: { total: number; imported: number; programsWithSeveral: number; most: number };
};

export function report(): Report {
  const all = <T>(sql: string): T[] => db.prepare(sql).all() as unknown as T[];
  const one = <T>(sql: string): T => db.prepare(sql).get() as unknown as T;
  const num = (sql: string): number => Number(Object.values(one<Record<string, number | null>>(sql))[0] ?? 0);
  const pragma = (name: string): string | number => Object.values(one<Record<string, string | number>>(`PRAGMA ${name}`))[0];

  const tableNames = [
    'families', 'models', 'emulators', 'categories', 'programs',
    'program_models', 'program_emulator_files', 'program_screenshots', 'users',
  ];

  const p = one<Record<string, number | string | null>>(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(published), 0) AS published,
            COALESCE(SUM(promoted), 0) AS promoted,
            COALESCE(SUM(author_wanted), 0) AS authorWanted,
            COALESCE(SUM(missing_since <> ''), 0) AS missing,
            COALESCE(SUM(file_name <> ''), 0) AS withFile,
            COALESCE(SUM(screenshot <> ''), 0) AS withScreenshot,
            COALESCE(SUM(category_id IS NULL), 0) AS withoutCategory,
            COALESCE(SUM(description = ''), 0) AS withoutDescription,
            COALESCE(SUM(year IS NULL), 0) AS withoutYear,
            COALESCE(SUM(author = ''), 0) AS withoutAuthor,
            MIN(year) AS yearFrom, MAX(year) AS yearTo,
            COALESCE(SUM(downloads), 0) AS downloads,
            COALESCE(SUM(runs), 0) AS runs,
            COALESCE(MIN(created_at), '') AS firstCreated,
            COALESCE(MAX(created_at), '') AS lastCreated,
            COALESCE(MAX(updated_at), '') AS lastUpdated
       FROM programs`,
  );
  const n = (key: string): number => Number(p[key] ?? 0);

  return {
    engine: {
      sqliteVersion: String(one<{ v: string }>('SELECT sqlite_version() AS v').v),
      schemaVersion: Number(pragma('user_version')),
      journalMode: String(pragma('journal_mode')),
      pageSize: Number(pragma('page_size')),
      pageCount: Number(pragma('page_count')),
      freePages: Number(pragma('freelist_count')),
    },
    tables: tableNames.map((name) => ({ name, rows: num(`SELECT COUNT(*) FROM ${name}`) })),
    programs: {
      total: n('total'),
      published: n('published'),
      promoted: n('promoted'),
      authorWanted: n('authorWanted'),
      missing: n('missing'),
      withFile: n('withFile'),
      withLaunch: num(
        `SELECT COUNT(DISTINCT program_id) FROM program_emulator_files WHERE file_name <> '' OR file_url <> ''`,
      ),
      withScreenshot: n('withScreenshot'),
      withoutCategory: n('withoutCategory'),
      withoutModels: num('SELECT COUNT(*) FROM programs WHERE id NOT IN (SELECT program_id FROM program_models)'),
      withoutDescription: n('withoutDescription'),
      withoutYear: n('withoutYear'),
      withoutAuthor: n('withoutAuthor'),
      yearFrom: p.yearFrom === null ? null : Number(p.yearFrom),
      yearTo: p.yearTo === null ? null : Number(p.yearTo),
      downloads: n('downloads'),
      runs: n('runs'),
      firstCreated: String(p.firstCreated),
      lastCreated: String(p.lastCreated),
      lastUpdated: String(p.lastUpdated),
    },
    categories: {
      top: num('SELECT COUNT(*) FROM categories WHERE parent_id IS NULL'),
      sub: num('SELECT COUNT(*) FROM categories WHERE parent_id IS NOT NULL'),
    },
    byFamily: all(
      `SELECT f.name, f.slug,
              (SELECT COUNT(*) FROM models m WHERE m.family_id = f.id) AS models,
              COUNT(p.id) AS programs,
              COALESCE(SUM(p.published), 0) AS published,
              COALESCE(SUM(p.downloads), 0) AS downloads,
              COALESCE(SUM(p.runs), 0) AS runs,
              COALESCE(SUM(p.file_size), 0) AS bytes
         FROM families f LEFT JOIN programs p ON p.family_id = f.id
        GROUP BY f.id ORDER BY f.sort_order, f.id`,
    ),
    byCategory: all(
      // The ORDER BY of a compound SELECT takes column names only, hence the wrapping query.
      `SELECT * FROM (
       SELECT t.id, t.name,
              (SELECT COUNT(*) FROM categories s WHERE s.parent_id = t.id) AS subcategories,
              (SELECT COUNT(*) FROM programs p
                WHERE p.category_id = t.id
                   OR p.category_id IN (SELECT id FROM categories WHERE parent_id = t.id)) AS programs
         FROM categories t WHERE t.parent_id IS NULL
        UNION ALL
       SELECT 0, '', 0, (SELECT COUNT(*) FROM programs WHERE category_id IS NULL)
       ) ORDER BY id = 0, programs DESC`,
    ),
    byIntegration: all(
      `SELECT integration, COUNT(*) AS programs,
              COALESCE(SUM(published), 0) AS published,
              COALESCE(SUM(missing_since <> ''), 0) AS missing,
              MAX(updated_at) AS lastUpdated
         FROM programs GROUP BY integration ORDER BY integration = '', programs DESC`,
    ),
    byDecade: all(
      `SELECT COALESCE(year / 10 * 10, 0) AS decade, COUNT(*) AS programs
         FROM programs GROUP BY 1 ORDER BY 1 = 0, 1`,
    ),
    byEmulator: all(
      `SELECT e.name,
              COUNT(pef.program_id) AS slots,
              COALESCE(SUM(pef.file_name <> ''), 0) AS files,
              COALESCE(SUM(pef.file_name = '' AND pef.file_url <> ''), 0) AS links,
              COALESCE(SUM(pef.file_size), 0) AS bytes,
              COALESCE(SUM(pef.runs), 0) AS runs
         FROM emulators e LEFT JOIN program_emulator_files pef ON pef.emulator_id = e.id
        GROUP BY e.id ORDER BY e.sort_order, e.id`,
    ),
    popular: all(
      `SELECT p.title, p.slug, f.slug AS family_slug, p.downloads, p.runs
         FROM programs p JOIN families f ON f.id = p.family_id
        WHERE p.downloads + p.runs > 0
        ORDER BY p.downloads + p.runs DESC, p.title LIMIT 10`,
    ),
    recent: all(
      `SELECT p.title, p.slug, f.slug AS family_slug, p.created_at, p.integration
         FROM programs p JOIN families f ON f.id = p.family_id
        ORDER BY p.created_at DESC, p.id DESC LIMIT 10`,
    ),
    referenced: {
      files: all<{ name: string }>(
        `SELECT file_name AS name FROM programs WHERE file_name <> ''
          UNION SELECT file_name FROM program_emulator_files WHERE file_name <> ''`,
      ).map((row) => String(row.name)),
      screenshots: all<{ name: string }>(
        `SELECT file_name AS name FROM program_screenshots
          UNION SELECT image FROM families WHERE image <> ''
          UNION SELECT image FROM models WHERE image <> ''`,
      ).map((row) => String(row.name)),
    },
    screenshots: {
      total: num('SELECT COUNT(*) FROM program_screenshots'),
      imported: num(`SELECT COUNT(*) FROM program_screenshots WHERE source_url <> ''`),
      programsWithSeveral: num(
        'SELECT COUNT(*) FROM (SELECT 1 FROM program_screenshots GROUP BY program_id HAVING COUNT(*) > 1)',
      ),
      most: num(
        'SELECT COALESCE(MAX(c), 0) FROM (SELECT COUNT(*) AS c FROM program_screenshots GROUP BY program_id)',
      ),
    },
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
