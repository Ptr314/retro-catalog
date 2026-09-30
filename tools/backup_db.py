"""
A consistent copy of the catalog database, taken while the server keeps running.

    py tools/backup_db.py [--out DIR] [--keep N]

  --out   where the copy goes. Default: <data>/backups.
  --keep  after a successful copy, leave only the N newest catalog-*.db in that
          directory (0 = keep everything, the default).

The database runs in WAL mode, so copying catalog.db as a file can miss what still sits
in catalog.db-wal. This goes through SQLite's online backup instead: the result is one
self-contained file, checked with PRAGMA integrity_check before it is kept.

Only the database is copied. data/files and data/screenshots are plain files — back
them up with whatever copies directories (rsync, tar).
"""
import argparse
import os
import sqlite3
import sys
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
    target_path = out_dir / ('%s%s.db' % (PREFIX, datetime.now().strftime('%Y%m%d-%H%M%S')))
    # Written under a temporary name: a half-made file must never look like a backup.
    partial_path = target_path.with_suffix('.partial')

    try:
        source = sqlite3.connect(source_path.as_uri() + '?mode=ro', uri=True, timeout=30)
        target = sqlite3.connect(partial_path)
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
        os.replace(partial_path, target_path)
    except (sqlite3.Error, OSError) as err:
        try:
            os.unlink(partial_path)
        except OSError:
            pass
        print('Ошибка: копия не сделана: %s' % err)
        return 1

    print('Копия: %s (%d КБ, версия схемы %d, программ: %d)' % (
        target_path, max(1, target_path.stat().st_size // 1024), version, programs))

    if args.keep > 0:
        # Names carry the timestamp, so sorting by name is sorting by age.
        copies = sorted(out_dir.glob(PREFIX + '*.db'))
        for old in copies[:-args.keep]:
            old.unlink()
            print('Удалена старая копия: %s' % old.name)
    return 0


if __name__ == '__main__':
    sys.exit(main())
