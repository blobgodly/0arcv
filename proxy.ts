import { next } from '@vercel/functions';
import { hasValidSessionCookie, privateLoginPage } from './api/_lib/auth.js';

const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

export default function proxy(request: Request) {
  const { pathname, protocol } = new URL(request.url);
  const headers = new Headers(securityHeaders);
  if (protocol === 'https:') headers.set('Strict-Transport-Security', 'max-age=63072000');

  if (pathname === '/api/auth/login' || pathname === '/api/auth/logout') {
    return next({ headers });
  }

  if (hasValidSessionCookie(request.headers.get('cookie') || undefined)) {
    return next({ headers });
  }

  headers.set('Cache-Control', 'no-store');
  if (pathname.startsWith('/api/')) {
    return Response.json({ ok: false, error: 'Authentication required' }, { status: 401, headers });
  }

  headers.set('Content-Type', 'text/html; charset=utf-8');
  return new Response(privateLoginPage, { status: 401, headers });
}

