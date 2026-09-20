/**
 * Bulk import / update from a JSON file.
 *   node --disable-warning=ExperimentalWarning tools/import.ts catalog.json
 *
 * Format: an array of objects. "title" is required, everything else optional:
 * [
 *   {
 *     "title": "Клад",
 *     "slug": "klad",
 *     "platform": "Агат",
 *     "category": "Игра",
 *     "year": 1988,
 *     "author": "…",
 *     "publisher": "…",
 *     "description": "…",
 *     "tags": "аркада, платформер",
 *     "download_url": "https://…",
 *     "run_url": "https://…",
 *     "run_params": "machine=agat9",
 *     "run_enabled": true,
 *     "published": true
 *   }
 * ]
 * Records are matched by slug: an existing slug is updated, a new one is created.
 */
import { readFileSync } from 'node:fs';
import { createProgram, getProgramBySlug, slugExists, updateProgram } from '../db.ts';
import type { ProgramInput } from '../db.ts';
import { slugify } from '../http.ts';

type Row = Partial<Record<keyof ProgramInput, unknown>> & { title?: unknown };

const path = process.argv[2];
if (!path) {
  console.error('usage: import.ts <file.json>');
  process.exit(1);
}

const rows = JSON.parse(readFileSync(path, 'utf8')) as Row[];
if (!Array.isArray(rows)) {
  console.error('Ожидался массив объектов.');
  process.exit(1);
}

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const flag = (value: unknown, fallback: number): number => (value === undefined ? fallback : value ? 1 : 0);

let created = 0;
let updated = 0;
let skipped = 0;

for (const row of rows) {
  const title = str(row.title);
  if (!title) {
    skipped += 1;
    continue;
  }
  let slug = slugify(str(row.slug) || title) || `program-${created + updated + 1}`;
  const existing = getProgramBySlug(slug);
  if (!existing) {
    let n = 2;
    const base = slug;
    while (slugExists(slug, 0)) slug = `${base}-${n++}`;
  }

  const input: ProgramInput = {
    slug,
    title,
    platform: str(row.platform),
    category: str(row.category),
    year: Number(row.year) || null,
    author: str(row.author),
    publisher: str(row.publisher),
    description: str(row.description),
    tags: str(row.tags),
    download_url: str(row.download_url),
    run_enabled: flag(row.run_enabled, 1),
    run_url: str(row.run_url),
    run_params: str(row.run_params),
    published: flag(row.published, 1),
  };

  if (existing) {
    updateProgram(existing.id, input);
    updated += 1;
  } else {
    createProgram(input);
    created += 1;
  }
}

console.log(`создано: ${created}, обновлено: ${updated}, пропущено: ${skipped}`);
