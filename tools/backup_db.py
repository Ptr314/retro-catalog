"""
A consistent copy of the catalog database, taken while the server keeps running.

    py tools/backup_db.py [--out DIR] [--keep N]

  --out   where the copy goes. Default: <data>/backups.
  --keep  after a successful copy, leave only the N newest catalog-*.zip in that
          directory (0 = keep everything, the default).

The database runs in WAL mode, so copying catalog.db as a file can miss what still sits
in catalog.db-wal. This goes through SQLite's online backup instead: the result is one
self-contained database, checked with PRAGMA integrity_check and then packed into
catalog-YYYYMMDD-HHMMSS.zip (the archive holds a single catalog-YYYYMMDD-HHMMSS.db).

Only the database is copied. data/files and data/screenshots are plain files — back
them up with whatever copies directories (rsync, tar).
"""
import argparse
import os
import sqlite3
import sys
import zipfile
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / 'integrations'))
from catalog_db import data_dir, load_config  # noqa: E402

PREFIX = 'catalog-'


def main():
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding='utf-8', errors='replace')

    parser = argparse.ArgumentParser(description='Резервная копия базы каталога.')
    parser.add_argument('--out', help='каталог для копий (по умолчанию <data>/backups)')
    parser.add_argument('--keep', type=int, default=0, help='оставить только N последних копий (0 — все)')
    args = parser.parse_args()

    data = data_dir(load_config())
    source_path = data / 'catalog.db'
    if not source_path.exists():
        print('Ошибка: база %s не найдена.' % source_path)
        return 2

    out_dir = Path(args.out).resolve() if args.out else data / 'backups'
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = '%s%s' % (PREFIX, datetime.now().strftime('%Y%m%d-%H%M%S'))
    target_path = out_dir / (stamp + '.zip')
    # Both steps work under temporary names: a half-made file must never look like a backup.
    copy_path = out_dir / (stamp + '.db.partial')
    partial_path = out_dir / (stamp + '.zip.partial')

    try:
        source = sqlite3.connect(source_path.as_uri() + '?mode=ro', uri=True, timeout=30)
        target = sqlite3.connect(copy_path)
        try:
            source.backup(target)
            verdict = target.execute('PRAGMA integrity_check').fetchone()[0]
            version = target.execute('PRAGMA user_version').fetchone()[0]
            programs = target.execute('SELECT COUNT(*) FROM programs').fetchone()[0]
        finally:
            target.close()
            source.close()
        if verdict != 'ok':
            raise sqlite3.DatabaseError('проверка целостности: %s' % verdict)
        plain_bytes = copy_path.stat().st_size
        with zipfile.ZipFile(partial_path, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            archive.write(copy_path, stamp + '.db')
        # Read the archive back before trusting it: a truncated zip is worse than none.
        with zipfile.ZipFile(partial_path) as archive:
            broken = archive.testzip()
        if broken is not None:
            raise zipfile.BadZipFile('архив не читается: %s' % broken)
        os.replace(partial_path, target_path)
    except (sqlite3.Error, OSError, zipfile.BadZipFile) as err:
        print('Ошибка: копия не сделана: %s' % err)
        return 1
    finally:
        for leftover in (copy_path, partial_path):
            try:
                os.unlink(leftover)
            except OSError:
                pass

    print('Копия: %s (%d КБ, без сжатия %d КБ; версия схемы %d, программ: %d)' % (
        target_path, max(1, target_path.stat().st_size // 1024), max(1, plain_bytes // 1024), version, programs))

    if args.keep > 0:
        # Names carry the timestamp, so sorting by name is sorting by age.
        copies = sorted(out_dir.glob(PREFIX + '*.zip'))
        for old in copies[:-args.keep]:
            old.unlink()
            print('Удалена старая копия: %s' % old.name)
    return 0


if __name__ == '__main__':
    sys.exit(main())
