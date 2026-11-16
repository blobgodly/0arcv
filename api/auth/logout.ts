import type { ApiRequest, ApiResponse } from '../_lib/http.js';
import { clearSessionCookie } from '../_lib/auth.js';

export default function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Set-Cookie', clearSessionCookie());
  return res.json({ ok: true });
}
