import type { ApiRequest, ApiResponse } from './_lib/http.js';
import { allowLoginAttempt, clearSessionCookie, createSessionCookie, verifyAccessPassword } from './_lib/auth.js';
import { readParam } from './_lib/http.js';

export default function handler(req: ApiRequest, res: ApiResponse) {
  const action = readParam(req.query?.action);
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  res.setHeader('Cache-Control', 'no-store');

  if (action === 'login') {
    const forwardedFor = req.headers?.['x-forwarded-for'];
    const clientKey = Array.isArray(forwardedFor) ? forwardedFor[0] : String(forwardedFor || 'unknown').split(',')[0].trim();
    if (!allowLoginAttempt(clientKey)) return res.status(429).json({ ok: false, error: 'Too many attempts. Try again later.' });
    const password = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>).password : undefined;
    if (typeof password !== 'string' || password.length > 1024 || !verifyAccessPassword(password)) {
      return res.status(401).json({ ok: false, error: 'Invalid credentials' });
    }
    res.setHeader('Set-Cookie', createSessionCookie());
    return res.json({ ok: true });
  }

  if (action === 'logout') {
    res.setHeader('Set-Cookie', clearSessionCookie());
    return res.json({ ok: true });
  }

  return res.status(404).json({ ok: false, error: 'Unknown auth action' });
}
