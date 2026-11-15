import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { ApiRequest, ApiResponse } from './http.js';

const ACCESS_PASSWORD = process.env.APP_ACCESS_PASSWORD || '';
const SESSION_SECRET = process.env.APP_SESSION_SECRET || createHash('sha256').update(ACCESS_PASSWORD || randomBytes(32)).digest('hex');
const SESSION_TTL_SECONDS = 60 * 60 * 12;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 10;
const loginAttempts = new Map<string, { startedAt: number; count: number }>();

export function allowLoginAttempt(clientKey: string) {
  const now = Date.now();
  const key = clientKey || 'unknown';
  const current = loginAttempts.get(key);
  if (!current || now - current.startedAt >= LOGIN_WINDOW_MS) {
    if (!current && loginAttempts.size >= 1000) {
      for (const [storedKey, window] of loginAttempts) {
        if (now - window.startedAt >= LOGIN_WINDOW_MS) loginAttempts.delete(storedKey);
      }
      if (loginAttempts.size >= 1000) return false;
    }
    loginAttempts.set(key, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= MAX_LOGIN_ATTEMPTS) return false;
  current.count += 1;
  return true;
}

function readCookie(header: string | undefined, name: string) {
  for (const part of (header || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(separator + 1).trim()); }
    catch { return undefined; }
  }
  return undefined;
}

function signSession(expiresAt: number) {
  const payload = String(expiresAt);
  const signature = createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function hasValidSessionCookie(cookieHeader: string | undefined) {
  const value = readCookie(cookieHeader, 'arc_session');
  if (!value) return false;
  const [expiresAtText, signature] = value.split('.');
  const expiresAt = Number(expiresAtText);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() || !signature) return false;
  const expected = Buffer.from(createHmac('sha256', SESSION_SECRET).update(expiresAtText).digest('base64url'));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function verifyAccessPassword(value: unknown) {
  if (!ACCESS_PASSWORD || typeof value !== 'string') return false;
  const expected = Buffer.from(ACCESS_PASSWORD);
  const actual = Buffer.from(value);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createSessionCookie() {
  const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `arc_session=${signSession(expiresAt)}; Max-Age=${SESSION_TTL_SECONDS}; Path=/; HttpOnly; SameSite=Strict${secure}`;
}

export function clearSessionCookie() {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `arc_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict${secure}`;
}

export function requireSession(req: ApiRequest, res: ApiResponse) {
  const cookieHeader = req.headers?.cookie;
  if (hasValidSessionCookie(Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader)) return true;
  res.setHeader('Cache-Control', 'no-store');
  res.status(401).json({ ok: false, error: 'Authentication required' });
  return false;
}

export const privateLoginPage = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>0arc — Private Access</title><style>body{margin:0;background:#09090b;color:#fafafa;font:14px system-ui;display:grid;place-items:center;min-height:100vh}main{width:min(360px,calc(100% - 40px));padding:28px;border:1px solid #27272a;border-radius:16px;background:#111113}h1{font-size:18px;margin:0 0 8px}p{color:#a1a1aa;font-size:12px;margin:0 0 20px}input,button{width:100%;box-sizing:border-box;padding:11px 12px;border-radius:9px;border:1px solid #3f3f46;background:#09090b;color:#fff;font:inherit}button{margin-top:10px;background:#fff;color:#09090b;border:0;font-weight:600;cursor:pointer}#error{color:#f87171;margin-top:12px;min-height:16px}</style></head><body><main><h1>Private archive</h1><p>This site is restricted. Enter the access password to continue.</p><form id="form"><input id="password" type="password" autocomplete="current-password" aria-label="Access password" required><button>Unlock archive</button><div id="error" role="alert"></div></form></main><script>form.addEventListener('submit',async(e)=>{e.preventDefault();error.textContent='';const r=await fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:password.value})});if(r.ok)location.reload();else error.textContent='Incorrect password.'})</script></body></html>`;
