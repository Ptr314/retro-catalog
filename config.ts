/**
 * Configuration: defaults <- config.json <- environment variables.
 * No external dependencies: plain JSON file next to the sources.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const rootDir = dirname(fileURLToPath(import.meta.url));

export type Config = {
  /** TCP port the server listens on. */
  port: number;
  /** Bind address. Use 127.0.0.1 when a reverse proxy sits in front. */
  host: string;
  /** Public base URL without trailing slash. Used to build absolute links for the emulator. */
  siteUrl: string;
  siteName: string;
  siteTagline: string;
  /** Where the database, screenshots and program files live. */
  dataDir: string;
  /** Origins allowed to fetch /files and /screenshots cross-origin (the emulators). "*" allows all. */
  corsOrigins: string[];
  maxScreenshotBytes: number;
  maxFileBytes: number;
  sessionTtlHours: number;
};

const defaults: Config = {
  port: 8080,
  host: '127.0.0.1',
  siteUrl: 'http://localhost:8080',
  siteName: 'Каталог ретро-софта',
  siteTagline: 'Программы для компьютеров прошлого века',
  dataDir: join(rootDir, 'data'),
  corsOrigins: ['*'],
  maxScreenshotBytes: 2 * 1024 * 1024,
  maxFileBytes: 64 * 1024 * 1024,
  sessionTtlHours: 24 * 14,
};

function loadFile(): Partial<Config> {
  const path = join(rootDir, 'config.json');
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Partial<Config>;
  } catch (err) {
    console.error(`config.json is not valid JSON: ${(err as Error).message}`);
    process.exit(1);
  }
}

const file = loadFile();

export const config: Config = {
  ...defaults,
  ...file,
  port: Number(process.env.PORT ?? file.port ?? defaults.port),
  host: process.env.HOST ?? file.host ?? defaults.host,
  siteUrl: (process.env.SITE_URL ?? file.siteUrl ?? defaults.siteUrl).replace(/\/+$/, ''),
  dataDir: resolveDataDir(process.env.DATA_DIR ?? file.dataDir ?? defaults.dataDir),
};

function resolveDataDir(value: string): string {
  return isAbsolute(value) ? value : resolve(rootDir, value);
}

export const screenshotsDir = join(config.dataDir, 'screenshots');
export const filesDir = join(config.dataDir, 'files');

for (const dir of [config.dataDir, screenshotsDir, filesDir]) {
  mkdirSync(dir, { recursive: true });
}

/** HMAC key for session cookies. Generated once, kept out of git. */
export function sessionSecret(): Buffer {
  const path = join(config.dataDir, 'session-secret');
  if (!existsSync(path)) {
    const secret = randomBytes(32);
    writeFileSync(path, secret.toString('hex'), { mode: 0o600 });
    try {
      chmodSync(path, 0o600);
    } catch {
      // Windows ignores POSIX modes; nothing to do.
    }
    return secret;
  }
  return Buffer.from(readFileSync(path, 'utf8').trim(), 'hex');
}

export const isHttps = config.siteUrl.startsWith('https://');
