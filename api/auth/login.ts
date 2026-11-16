import type { ApiRequest, ApiResponse } from '../_lib/http.js';
import { allowLoginAttempt, createSessionCookie, verifyAccessPassword } from '../_lib/auth.js';

export default function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const forwardedFor = req.headers?.['x-forwarded-for'];
  const clientKey = Array.isArray(forwardedFor) ? forwardedFor[0] : String(forwardedFor || 'unknown').split(',')[0].trim();
  if (!allowLoginAttempt(clientKey)) return res.status(429).json({ ok: false, error: 'Too many attempts. Try again later.' });
  const password = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>).password : undefined;
  if (typeof password !== 'string' || password.length > 1024 || !verifyAccessPassword(password)) return res.status(401).json({ ok: false, error: 'Invalid credentials' });
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Set-Cookie', createSessionCookie());
  return res.json({ ok: true });
}
