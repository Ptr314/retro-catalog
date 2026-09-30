/**
 * What is on disk under data/, measured for the admin's statistics page and compared
 * with what the database refers to. Read-only: it reports orphans, it never removes them.
 */
import { readdir, stat, statfs } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { config, filesDir, screenshotsDir } from './config.ts';

export type FileEntry = { name: string; bytes: number };

export type DirReport = {
  count: number;
  bytes: number;
  /** On disk, but no row names them: left behind by a failed upload or a hand-edited database. */
  orphans: FileEntry[];
  /** Named by a row, but absent on disk: a broken download, launch or picture. */
  missing: string[];
  largest: FileEntry[];
  /** By extension, biggest total first. */
  byType: { ext: string; count: number; bytes: number }[];
};

export type DiskReport = {
  files: DirReport;
  screenshots: DirReport;
  /** catalog.db plus its -wal and -shm companions. */
  database: { bytes: number; walBytes: number };
  backups: { count: number; bytes: number; newest: string };
  /** Anything else lying in data/ (integration archives and the like). */
  otherBytes: number;
  /** The volume data/ lives on; null where the platform cannot tell. */
  volume: { freeBytes: number; totalBytes: number } | null;
};

/** Plain files directly inside dir; a missing directory is an empty one. */
async function listFiles(dir: string): Promise<FileEntry[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: FileEntry[] = [];
  for (const name of names) {
    try {
      const info = await stat(join(dir, name));
      if (info.isFile()) out.push({ name, bytes: info.size });
    } catch {
      // vanished between readdir and stat: not ours to report
    }
  }
  return out;
}

/** Total size of everything under dir, subdirectories included. */
async function treeBytes(dir: string): Promise<number> {
  let total = 0;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) total += await treeBytes(path);
    else if (entry.isFile()) total += (await stat(path).catch(() => null))?.size ?? 0;
  }
  return total;
}

const sum = (entries: FileEntry[]): number => entries.reduce((total, entry) => total + entry.bytes, 0);

function dirReport(entries: FileEntry[], referenced: string[]): DirReport {
  // Names are compared without case: on a case-insensitive disk "A.zip" is "a.zip".
  const known = new Set(referenced.map((name) => name.toLowerCase()));
  const present = new Set(entries.map((entry) => entry.name.toLowerCase()));

  const types = new Map<string, { ext: string; count: number; bytes: number }>();
  for (const entry of entries) {
    const ext = extname(entry.name).toLowerCase() || '(без расширения)';
    const row = types.get(ext) ?? { ext, count: 0, bytes: 0 };
    row.count += 1;
    row.bytes += entry.bytes;
    types.set(ext, row);
  }

  return {
    count: entries.length,
    bytes: sum(entries),
    orphans: entries.filter((entry) => !known.has(entry.name.toLowerCase())),
    missing: referenced.filter((name) => !present.has(name.toLowerCase())),
    largest: [...entries].sort((a, b) => b.bytes - a.bytes).slice(0, 10),
    byType: [...types.values()].sort((a, b) => b.bytes - a.bytes),
  };
}

export async function diskReport(referenced: { files: string[]; screenshots: string[] }): Promise<DiskReport> {
  const [files, screenshots, top, backups] = await Promise.all([
    listFiles(filesDir),
    listFiles(screenshotsDir),
    listFiles(config.dataDir),
    listFiles(join(config.dataDir, 'backups')),
  ]);

  const size = (name: string): number => top.find((entry) => entry.name === name)?.bytes ?? 0;
  const databaseBytes = size('catalog.db');
  const walBytes = size('catalog.db-wal') + size('catalog.db-shm');
  // backup_db.py writes .zip; .db copies made by its earlier version still count.
  const copies = backups.filter((entry) => entry.name.endsWith('.zip') || entry.name.endsWith('.db'));

  let volume: DiskReport['volume'] = null;
  try {
    const fs = await statfs(config.dataDir);
    volume = { freeBytes: Number(fs.bavail) * Number(fs.bsize), totalBytes: Number(fs.blocks) * Number(fs.bsize) };
  } catch {
    // not every filesystem answers; the page simply leaves the line out
  }

  const filesReport = dirReport(files, referenced.files);
  const screenshotsReport = dirReport(screenshots, referenced.screenshots);
  const everything = await treeBytes(config.dataDir);

  return {
    files: filesReport,
    screenshots: screenshotsReport,
    database: { bytes: databaseBytes, walBytes },
    backups: {
      count: copies.length,
      bytes: sum(copies),
      // backup_db.py puts the timestamp in the name, so the last name is the newest copy
      newest: copies.map((entry) => entry.name).sort().pop() ?? '',
    },
    otherBytes: Math.max(
      0,
      everything - filesReport.bytes - screenshotsReport.bytes - databaseBytes - walBytes - sum(backups),
    ),
    volume,
  };
}
