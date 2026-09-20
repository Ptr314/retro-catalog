/**
 * Small HTTP helpers on top of node:http — cookies, bodies, static files, escaping.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { config } from './config.ts';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function html(res: ServerResponse, status: number, body: string): void {
  const buf = Buffer.from(body, 'utf8');
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': buf.length,
    'Content-Security-Policy':
      "default-src 'none'; img-src 'self' data:; style-src 'self'; script-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
  });
  res.end(buf);
}

export function text(res: ServerResponse, status: number, body: string): void {
  const buf = Buffer.from(body, 'utf8');
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': buf.length });
  res.end(buf);
}

export function json(res: ServerResponse, status: number, body: unknown): void {
  const buf = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': buf.length });
  res.end(buf);
}

export function redirect(res: ServerResponse, location: string, status = 303): void {
  res.writeHead(status, { Location: location, 'Content-Length': 0 });
  res.end();
}

export function cookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie;
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

export type CookieOptions = {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Lax' | 'Strict' | 'None';
  path?: string;
  maxAge?: number;
};

export function setCookie(res: ServerResponse, name: string, value: string, opts: CookieOptions = {}): void {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (opts.path) parts.push(`Path=${opts.path}`);
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
  if (opts.httpOnly) parts.push('HttpOnly');
  if (opts.secure) parts.push('Secure');
  if (opts.sameSite) parts.push(`SameSite=${opts.sameSite}`);
  const existing = res.getHeader('Set-Cookie');
  const list = Array.isArray(existing) ? existing : existing ? [String(existing)] : [];
  list.push(parts.join('; '));
  res.setHeader('Set-Cookie', list);
}

export class BodyTooLarge extends Error {}

export function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new BodyTooLarge(`body exceeds ${limit} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Forms are sent as application/x-www-form-urlencoded; files go through separate PUT requests. */
export async function readForm(req: IncomingMessage, limit = 512 * 1024): Promise<URLSearchParams> {
  const body = await readBody(req, limit);
  return new URLSearchParams(body.toString('utf8'));
}

export function clientIp(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) return forwarded.split(',')[0].trim();
  return req.socket.remoteAddress ?? 'unknown';
}

/** Only allow plain file names — no directories, no traversal. */
export function isSafeName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(name) && !name.includes('..');
}

export function corsHeaders(req: IncomingMessage): Record<string, string> {
  const allowed = config.corsOrigins;
  if (allowed.includes('*')) return { 'Access-Control-Allow-Origin': '*' };
  const origin = req.headers.origin as string | undefined;
  if (origin && allowed.includes(origin)) return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
  return { Vary: 'Origin' };
}

export type SendFileOptions = {
  /** Force a download with this name instead of rendering inline. */
  downloadAs?: string;
  contentType?: string;
  cors?: boolean;
  cacheSeconds?: number;
};

/** Serves a file with ETag, conditional requests and Range support (emulators fetch partial data). */
export async function sendFile(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  opts: SendFileOptions = {},
): Promise<void> {
  let info;
  try {
    info = await stat(path);
  } catch {
    text(res, 404, 'Not found');
    return;
  }
  if (!info.isFile()) {
    text(res, 404, 'Not found');
    return;
  }

  const etag = `W/"${info.size.toString(16)}-${info.mtimeMs.toString(16)}"`;
  const headers: Record<string, string | number> = {
    'Content-Type': opts.contentType ?? MIME[extname(path).toLowerCase()] ?? 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'bytes',
    ETag: etag,
    'Last-Modified': info.mtime.toUTCString(),
    'Cache-Control': `public, max-age=${opts.cacheSeconds ?? 3600}`,
    ...(opts.cors ? corsHeaders(req) : {}),
  };
  if (opts.downloadAs) {
    headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(opts.downloadAs)}`;
  }

  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    res.end();
    return;
  }

  const range = /^bytes=(\d*)-(\d*)$/.exec((req.headers.range as string) ?? '');
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : info.size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : info.size - 1;
    start = Math.max(0, start);
    end = Math.min(end, info.size - 1);
    if (start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${info.size}` });
      res.end();
      return;
    }
    headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
    headers['Content-Length'] = end - start + 1;
    res.writeHead(206, headers);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(path, { start, end }).pipe(res);
    return;
  }

  headers['Content-Length'] = info.size;
  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(path).pipe(res);
}

/** Image type detected from the file header, not from the declared Content-Type. */
export function detectImage(buf: Buffer): { ext: string; mime: string } | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { ext: '.png', mime: 'image/png' };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: '.jpg', mime: 'image/jpeg' };
  if (buf.subarray(0, 6).toString('latin1').startsWith('GIF8')) return { ext: '.gif', mime: 'image/gif' };
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') {
    return { ext: '.webp', mime: 'image/webp' };
  }
  return null;
}

/** Cyrillic-aware slug: "Клад 2" -> "klad-2". */
const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .split('')
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function formatBytes(bytes: number | null): string {
  if (!bytes || bytes <= 0) return '';
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}
