/**
 * Password hashing (scrypt) and stateless sessions (HMAC-signed cookie).
 * No session table: the cookie carries user id + expiry, the signature proves it is ours.
 */
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { config, isHttps, sessionSecret } from './config.ts';
import { getUserById, getUserByName } from './db.ts';
import type { User } from './db.ts';
import { cookies, setCookie } from './http.ts';

const SECRET = sessionSecret();
export const COOKIE_NAME = 'rc_session';

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  const actual = scryptSync(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function sign(payload: string): string {
  return createHmac('sha256', SECRET).update(payload).digest('base64url');
}

function makeToken(userId: number): string {
  const payload = Buffer.from(
    JSON.stringify({ uid: userId, exp: Date.now() + config.sessionTtlHours * 3600_000 }),
  ).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function readToken(token: string): number | null {
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const payload = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const want = Buffer.from(sign(payload));
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { uid: number; exp: number };
    if (typeof data.uid !== 'number' || typeof data.exp !== 'number' || data.exp < Date.now()) return null;
    return data.uid;
  } catch {
    return null;
  }
}

export function startSession(res: ServerResponse, userId: number): void {
  setCookie(res, COOKIE_NAME, makeToken(userId), {
    httpOnly: true,
    sameSite: 'Lax',
    secure: isHttps,
    path: '/',
    maxAge: config.sessionTtlHours * 3600,
  });
}

export function endSession(res: ServerResponse): void {
  setCookie(res, COOKIE_NAME, '', { httpOnly: true, sameSite: 'Lax', secure: isHttps, path: '/', maxAge: 0 });
}

export function currentUser(req: IncomingMessage): User | null {
  const token = cookies(req)[COOKIE_NAME];
  if (!token) return null;
  const uid = readToken(token);
  return uid === null ? null : getUserById(uid);
}

/**
 * Defence in depth on top of SameSite=Lax: state-changing requests must come from our
 * own origin. "Our own" means the host the browser is actually talking to (the Host
 * header), not only config.siteUrl — the same server answers on localhost, 127.0.0.1
 * and its public name, and each is a different origin to the browser.
 *
 * Trusting Host is safe here because the session is a host-scoped cookie: a page on
 * another site has a different Origin host, and a DNS-rebinding page that does match
 * its own Host carries no session cookie for it.
 */
export function sameOrigin(req: IncomingMessage): boolean {
  const host = String(req.headers.host ?? '').toLowerCase();
  const ours = (value: string): boolean => {
    try {
      const url = new URL(value);
      return url.origin === config.siteUrl || (host !== '' && url.host.toLowerCase() === host);
    } catch {
      return false; // "null" and other opaque origins
    }
  };
  const origin = (req.headers.origin as string) || '';
  if (origin) return ours(origin);
  const referer = (req.headers.referer as string) || '';
  if (referer) return ours(referer);
  return false;
}

// Throttle password guessing: per-IP counter with a growing lockout.
const attempts = new Map<string, { n: number; until: number }>();

export function loginBlockedFor(ip: string): number {
  const entry = attempts.get(ip);
  if (!entry) return 0;
  return Math.max(0, entry.until - Date.now());
}

export function noteLoginFailure(ip: string): void {
  const entry = attempts.get(ip) ?? { n: 0, until: 0 };
  entry.n += 1;
  if (entry.n >= 5) entry.until = Date.now() + Math.min(entry.n - 4, 10) * 30_000;
  attempts.set(ip, entry);
}

export function noteLoginSuccess(ip: string): void {
  attempts.delete(ip);
}

export function authenticate(username: string, password: string): User | null {
  const user = getUserByName(username);
  // Always run scrypt so a missing user is not faster than a wrong password.
  const stored = user?.password_hash ?? 'scrypt$00$00';
  const ok = verifyPassword(password, stored);
  return ok && user ? user : null;
}

setInterval(() => {
  const nowMs = Date.now();
  for (const [ip, entry] of attempts) if (entry.until && entry.until < nowMs) attempts.delete(ip);
}, 600_000).unref();
