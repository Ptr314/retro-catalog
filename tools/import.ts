/**
 * Bulk import / update from a JSON file.
 *   node --disable-warning=ExperimentalWarning tools/import.ts catalog.json
 *
 * Format: an array of objects. "title" and "family" are required, the rest optional:
 * [
 *   {
 *     "title": "Клад",
 *     "slug": "klad",
 *     "family": "agat",              // slug or name of an existing family
 *     "models": ["agat-9"],          // slugs or names, must belong to that family
 *     "category": "Игра",            // name of an existing top-level category
 *     "subcategory": "Аркада",       // name of an existing subcategory of it
 *     "year": 1988,
 *     "author": "…",
 *     "author_wanted": false,
 *     "promoted": false,             // heads the "new" order; kept on update if absent
 *     "source_url": "https://…",     // shown as «Автор/Источник»; anything but http(s) is dropped
 *     "description": "Markdown",
 *     "graphics": "…",               // these three are kept on update if absent
 *     "music": "…",
 *     "metadata": "key:value\n…",
 *     "published": true
 *   }
 * ]
 * References must already exist in the admin — an unknown family, model or category
 * is reported and the row is skipped. Records are matched by slug: existing is updated.
 *
 * Imports from external catalogs (matched by integration + external id, with files and
 * screenshots) are a different tool: tools/integrations/.
 */
import { readFileSync } from 'node:fs';
import {
  createProgram, getProgramBySlug, listCategories, listFamilies, listModels, slugTaken, updateProgram,
} from '../db.ts';
import type { ProgramInput } from '../db.ts';
import { slugify } from '../http.ts';

type Row = {
  title?: unknown;
  slug?: unknown;
  family?: unknown;
  models?: unknown;
  category?: unknown;
  subcategory?: unknown;
  year?: unknown;
  author?: unknown;
  author_wanted?: unknown;
  promoted?: unknown;
  source_url?: unknown;
  description?: unknown;
  graphics?: unknown;
  music?: unknown;
  metadata?: unknown;
  published?: unknown;
};

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
const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

const families = listFamilies();
const categories = listCategories();

let created = 0;
let updated = 0;
let skipped = 0;

const skip = (title: string, reason: string): void => {
  console.warn(`пропущено «${title || '(без названия)'}»: ${reason}`);
  skipped += 1;
};

for (const row of rows) {
  const title = str(row.title);
  if (!title) {
    skip('', 'нет названия');
    continue;
  }

  const familyRef = str(row.family);
  const family = families.find((f) => same(f.slug, familyRef) || same(f.name, familyRef));
  if (!family) {
    skip(title, `семейство «${familyRef}» не найдено`);
    continue;
  }

  const categoryRef = str(row.category);
  const category = categoryRef ? categories.find((c) => !c.parent_id && same(c.name, categoryRef)) : null;
  if (categoryRef && !category) {
    skip(title, `категория «${categoryRef}» не найдена`);
    continue;
  }

  const subcategoryRef = str(row.subcategory);
  const subcategory =
    subcategoryRef && category
      ? categories.find((c) => c.parent_id === category.id && same(c.name, subcategoryRef))
      : null;
  if (subcategoryRef && !subcategory) {
    skip(title, `подкатегория «${subcategoryRef}» не найдена в категории «${categoryRef}»`);
    continue;
  }

  const familyModels = listModels(family.id);
  const wanted = Array.isArray(row.models) ? row.models.map((m) => str(m)).filter(Boolean) : [];
  const modelIds: number[] = [];
  let badModel = '';
  for (const ref of wanted) {
    const model = familyModels.find((m) => same(m.slug, ref) || same(m.name, ref));
    if (!model) {
      badModel = ref;
      break;
    }
    modelIds.push(model.id);
  }
  if (badModel) {
    skip(title, `модель «${badModel}» не найдена в семействе «${family.name}»`);
    continue;
  }

  let slug = slugify(str(row.slug) || title) || `program-${created + updated + 1}`;
  const existing = getProgramBySlug(slug);
  if (!existing) {
    const base = slug;
    let n = 2;
    // Taken by a program or by a model: both answer at /<family>/<slug>.
    while (slugTaken(slug, 0)) slug = `${base}-${n++}`;
  }

  const kept = (value: unknown, existingValue: string | undefined): string =>
    value === undefined ? (existingValue ?? '') : str(value);

  const input: ProgramInput = {
    slug,
    title,
    family_id: family.id,
    category_id: subcategory ? subcategory.id : category ? category.id : null,
    year: Number(row.year) || null,
    author: str(row.author),
    author_wanted: flag(row.author_wanted, 0),
    promoted: flag(row.promoted, existing ? existing.promoted : 0),
    source_url: /^https?:\/\//i.test(str(row.source_url)) ? str(row.source_url).slice(0, 500) : '',
    description: str(row.description),
    graphics: kept(row.graphics, existing?.graphics),
    music: kept(row.music, existing?.music),
    metadata: kept(row.metadata, existing?.metadata),
    published: flag(row.published, 1),
  };

  if (existing) {
    updateProgram(existing.id, input, modelIds);
    updated += 1;
  } else {
    createProgram(input, modelIds);
    created += 1;
  }
}

console.log(`создано: ${created}, обновлено: ${updated}, пропущено: ${skipped}`);
