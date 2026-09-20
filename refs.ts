/**
 * Reference tables (families, models, emulators, categories) are the same CRUD
 * four times over. One spec per table drives the generic routes and views;
 * everything table-specific lives in the hooks below.
 *
 * The table name and the column list always come from here, never from a request.
 */
import * as db from './db.ts';
import type { RefRow, RefTable } from './db.ts';
import { slugify } from './http.ts';
import { isReservedSlug } from './reserved.ts';

export type RefFieldType = 'text' | 'slug' | 'markdown' | 'image' | 'years' | 'family';

export type RefField = {
  /** Column name; also the form field name. */
  name: string;
  label: string;
  type: RefFieldType;
  required?: boolean;
  maxLength?: number;
  placeholder?: string;
  hint?: string;
};

export type RefSpec = {
  table: RefTable;
  /** Plural, for the list page. */
  title: string;
  /** Singular, for the edit page. */
  titleOne: string;
  fields: RefField[];
  /** Columns shown in the list table, in order. */
  listFields: string[];
  /** Rows can be dragged to reorder. */
  reorderable: boolean;
  /** Rows belong to a family (models). */
  scopedToFamily: boolean;
  /** '' when the form is acceptable, otherwise a Russian message. */
  validate(form: URLSearchParams, id: number): string;
  /** Form values mapped onto columns. Only values are bound to the query. */
  values(form: URLSearchParams, id: number): RefRow;
  /** '' when the row may be deleted, otherwise a Russian refusal. */
  beforeDelete(id: number): string;
};

const str = (form: URLSearchParams, name: string, max = 200): string =>
  (form.get(name) ?? '').trim().slice(0, max);

/** Picks a free slug: the typed one, else one built from the name, else name-2, -3… */
function uniqueRefSlug(
  table: 'families' | 'models',
  raw: string,
  fallback: string,
  familyId: number,
  exceptId: number,
): string {
  const base = slugify(raw) || slugify(fallback) || `${table === 'families' ? 'family' : 'model'}-${Date.now()}`;
  let slug = base;
  let n = 2;
  while ((table === 'families' && isReservedSlug(slug)) || db.refSlugExists(table, slug, familyId, exceptId)) {
    slug = `${base}-${n}`;
    n += 1;
  }
  return slug;
}

const families: RefSpec = {
  table: 'families',
  title: 'Семейства',
  titleOne: 'Семейство',
  reorderable: true,
  scopedToFamily: false,
  listFields: ['image', 'name', 'slug'],
  fields: [
    { name: 'name', label: 'Название', type: 'text', required: true, maxLength: 120 },
    {
      name: 'slug',
      label: 'Адрес страницы',
      type: 'slug',
      maxLength: 80,
      placeholder: 'сгенерируется из названия',
      hint: 'Семейство открывается по адресу /<адрес>, модели — /<адрес>/<модель>.',
    },
    { name: 'image', label: 'Картинка', type: 'image' },
    { name: 'description', label: 'Описание', type: 'markdown' },
    {
      name: 'wanted_note',
      label: 'Розыск автора',
      type: 'markdown',
      hint: 'Показывается во всплывающем окне у программ этого семейства с флагом «Разыскивается автор»: куда писать, что уже известно.',
    },
  ],
  validate(form, id) {
    if (!str(form, 'name')) return 'Название обязательно.';
    const typed = slugify(str(form, 'slug', 80));
    if (typed && isReservedSlug(typed)) return `Адрес «${typed}» занят системой, выберите другой.`;
    if (typed && db.refSlugExists('families', typed, 0, id)) return `Адрес «${typed}» уже занят другим семейством.`;
    return '';
  },
  values(form, id) {
    const name = str(form, 'name', 120);
    return {
      name,
      slug: uniqueRefSlug('families', str(form, 'slug', 80), name, 0, id),
      description: str(form, 'description', 20000),
      wanted_note: str(form, 'wanted_note', 5000),
    };
  },
  beforeDelete(id) {
    const programs = db.countProgramsInFamily(id);
    // ON DELETE RESTRICT would raise a raw SQLite error; say it in Russian first.
    return programs > 0
      ? `В семействе ${programs} ${plural(programs, 'программа', 'программы', 'программ')} — сначала перенесите или удалите их.`
      : '';
  },
};

const models: RefSpec = {
  table: 'models',
  title: 'Модели',
  titleOne: 'Модель',
  reorderable: true,
  scopedToFamily: true,
  listFields: ['image', 'name', 'years', 'slug'],
  fields: [
    { name: 'family_id', label: 'Семейство', type: 'family', required: true },
    { name: 'name', label: 'Название', type: 'text', required: true, maxLength: 120 },
    {
      name: 'slug',
      label: 'Адрес страницы',
      type: 'slug',
      maxLength: 80,
      placeholder: 'сгенерируется из названия',
      hint: 'Открывается по адресу /<семейство>/<адрес>.',
    },
    { name: 'years', label: 'Годы выпуска', type: 'years', maxLength: 60, placeholder: '1984—1993' },
    { name: 'image', label: 'Картинка', type: 'image' },
    { name: 'description', label: 'Описание', type: 'markdown' },
  ],
  validate(form, id) {
    if (!str(form, 'name')) return 'Название обязательно.';
    const familyId = Number(form.get('family_id')) || 0;
    if (!familyId || !db.getRef('families', familyId)) return 'Выберите семейство.';
    const typed = slugify(str(form, 'slug', 80));
    if (typed && db.refSlugExists('models', typed, familyId, id)) {
      return `Адрес «${typed}» уже занят другой моделью этого семейства.`;
    }
    return '';
  },
  values(form, id) {
    const name = str(form, 'name', 120);
    const familyId = Number(form.get('family_id')) || 0;
    return {
      family_id: familyId,
      name,
      slug: uniqueRefSlug('models', str(form, 'slug', 80), name, familyId, id),
      years: str(form, 'years', 60),
      description: str(form, 'description', 20000),
    };
  },
  // Deleting a model only drops association rows; the warning lives in the confirm dialog.
  beforeDelete() {
    return '';
  },
};

const emulators: RefSpec = {
  table: 'emulators',
  title: 'Эмуляторы',
  titleOne: 'Эмулятор',
  reorderable: true,
  scopedToFamily: false,
  listFields: ['name', 'url_template'],
  fields: [
    { name: 'name', label: 'Название', type: 'text', required: true, maxLength: 120 },
    {
      name: 'url_template',
      label: 'URL запуска',
      type: 'text',
      required: true,
      maxLength: 500,
      placeholder: 'https://emu.example.com/?machine=agat9&url={url}',
      hint: 'Вместо {url} подставится адрес файла программы. Эмулятор скачивает файл сам.',
    },
  ],
  validate(form) {
    if (!str(form, 'name')) return 'Название обязательно.';
    const template = str(form, 'url_template', 500);
    if (!template) return 'URL запуска обязателен.';
    if (!template.includes('{url}')) return 'В шаблоне нет {url} — эмулятору некуда подставить ссылку на файл.';
    try {
      const url = new URL(template);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'Шаблон должен быть http(s)-адресом.';
    } catch {
      return 'Шаблон не похож на адрес.';
    }
    return '';
  },
  values(form) {
    return { name: str(form, 'name', 120), url_template: str(form, 'url_template', 500) };
  },
  // Uploaded files are unlinked by the delete handler; SQLite only drops the rows.
  beforeDelete() {
    return '';
  },
};

const categories: RefSpec = {
  table: 'categories',
  title: 'Категории программ',
  titleOne: 'Категория',
  reorderable: true,
  scopedToFamily: false,
  listFields: ['name'],
  fields: [{ name: 'name', label: 'Название категории', type: 'text', required: true, maxLength: 120 }],
  validate(form, id) {
    const name = str(form, 'name', 120);
    if (!name) return 'Название обязательно.';
    const existing = db
      .listRef('categories')
      .find((row) => String(row.name).toLowerCase() === name.toLowerCase() && Number(row.id) !== id);
    return existing ? `Категория «${name}» уже есть.` : '';
  },
  values(form) {
    return { name: str(form, 'name', 120) };
  },
  beforeDelete() {
    return '';
  },
};

export const REF_SPECS: Record<string, RefSpec> = { families, models, emulators, categories };

export function refSpec(table: string): RefSpec | null {
  return Object.prototype.hasOwnProperty.call(REF_SPECS, table) ? REF_SPECS[table] : null;
}

/** Russian plural; the view layer has its own copy for counts it renders. */
function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
