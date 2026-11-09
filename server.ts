/**
 * 0arc Backend Server
 * Provides full-stack API capabilities:
 * - Real-time cross-device synchronization via Server-Sent Events (SSE)
 * - Persistent cloud database (Server-side document store + MongoDB Atlas integration)
 * - IMDb and Gemini media lookup integration
 * - Development Vite middleware & Production static serving
 */
import express from 'express';
import { createServer as createViteServer } from 'vite';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { lookupMedia, resolveMediaDetails, searchImdb, type MediaKind } from './api/_lib/media.ts';
import {
  initCloudStore,
  getVaultData,
  saveVaultData,
  registerSseClient,
  connectMongo,
  getStorageUsage,
  getCloudImages,
  saveCloudImages,
  deleteCloudImage,
} from './api/_lib/cloudStore.ts';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const ACCESS_PASSWORD = process.env.APP_ACCESS_PASSWORD || '';
const SESSION_SECRET = process.env.APP_SESSION_SECRET || crypto.createHash('sha256').update(ACCESS_PASSWORD || crypto.randomBytes(32)).digest('hex');
const SESSION_TTL_SECONDS = 60 * 60 * 12;

const constantTimeEqual = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const signSession = (expiresAt: number) => {
  const payload = `${expiresAt}`;
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
};

const hasValidSession = (value: string | undefined) => {
  if (!value) return false;
  const [expiresAtText, signature] = value.split('.');
  const expiresAt = Number(expiresAtText);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() || !signature) return false;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(expiresAtText).digest('base64url');
  return constantTimeEqual(signature, expected);
};

const parseCookies = (header = '') => Object.fromEntries(header.split(';').map((part) => {
  const index = part.indexOf('=');
  return index < 0 ? ['', ''] : [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
}).filter(([key]) => key));

const loginPage = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>0arc — Private Access</title><style>body{margin:0;background:#09090b;color:#fafafa;font:14px system-ui;display:grid;place-items:center;min-height:100vh}main{width:min(360px,calc(100% - 40px));padding:28px;border:1px solid #27272a;border-radius:16px;background:#111113}h1{font-size:18px;margin:0 0 8px}p{color:#a1a1aa;font-size:12px;margin:0 0 20px}input,button{width:100%;box-sizing:border-box;padding:11px 12px;border-radius:9px;border:1px solid #3f3f46;background:#09090b;color:#fff;font:inherit}button{margin-top:10px;background:#fff;color:#09090b;border:0;font-weight:600;cursor:pointer}#error{color:#f87171;margin-top:12px;min-height:16px}</style></head><body><main><h1>Private archive</h1><p>This site is restricted. Enter the access password to continue.</p><form id="form"><input id="password" type="password" autocomplete="current-password" aria-label="Access password" required><button>Unlock archive</button><div id="error" role="alert"></div></form></main><script>form.addEventListener('submit',async(e)=>{e.preventDefault();error.textContent='';const r=await fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:password.value})});if(r.ok)location.reload();else error.textContent='Incorrect password.'})</script></body></html>`;

app.use(express.json({ limit: '15mb' }));

app.post('/api/auth/login', (req, res) => {
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!ACCESS_PASSWORD || !constantTimeEqual(password, ACCESS_PASSWORD)) {
    return res.status(401).json({ ok: false, error: 'Invalid credentials' });
  }
  const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
  res.setHeader('Set-Cookie', `arc_session=${signSession(expiresAt)}; Max-Age=${SESSION_TTL_SECONDS}; Path=/; HttpOnly; SameSite=Strict${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
  return res.json({ ok: true });
});

app.post('/api/auth/logout', (_req, res) => {
  res.setHeader('Set-Cookie', 'arc_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict');
  return res.json({ ok: true });
});

app.use((req, res, next) => {
  if (req.path.startsWith('/api/auth/')) return next();
  const cookies = parseCookies(req.headers.cookie);
  if (hasValidSession(cookies.arc_session)) return next();
  res.setHeader('Cache-Control', 'no-store');
  if (req.path.startsWith('/api/')) return res.status(401).json({ ok: false, error: 'Authentication required' });
  return res.status(401).type('html').send(loginPage);
});

// Initialize persistent storage engine on startup
initCloudStore().catch((err) => {
  console.error('[0arc] Failed to initialize cloud storage:', err);
});

// -------------------------------------------------------------
// IMDb & Gemini Media APIs
// -------------------------------------------------------------

app.get('/api/imdb/search', async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const type = typeof req.query.type === 'string' ? req.query.type.trim() : undefined;

  if (!query) {
    return res.json({ results: [] });
  }

  return res.json({ results: await searchImdb(query, type) });
});

app.get('/api/imdb/q', async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const type = typeof req.query.type === 'string' ? req.query.type.trim() : undefined;

  if (!query) {
    return res.json({ results: [] });
  }

  return res.json({ results: await searchImdb(query, type) });
});

app.post('/api/imdb/details', async (req, res) => {
  const { title, year, type, posterUrl } = req.body ?? {};

  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'Title is required' });
  }

  const requestedType: MediaKind = type === 'series' || type === 'anime' ? type : 'movie';
  const details = await resolveMediaDetails(
    title.trim(),
    year ? Number(year) : undefined,
    requestedType,
    typeof posterUrl === 'string' ? posterUrl : undefined
  );

  return res.json(details);
});

app.post('/api/gemini/media-lookup', async (req, res) => {
  const { title, type } = req.body ?? {};

  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'Title is required' });
  }

  return res.json(await lookupMedia(title.trim(), typeof type === 'string' ? type : 'movie'));
});

// -------------------------------------------------------------
// Cloud Vault & Real-Time Sync APIs
// -------------------------------------------------------------

/**
 * Fetch all cloud vault data for the user/browser.
 */
app.get('/api/cloud/data', async (_req, res) => {
  try {
    const data = await getVaultData();
    return res.json({ ok: true, data });
  } catch (err) {
    console.error('[API] /api/cloud/data error:', err);
    return res.status(500).json({ ok: false, error: 'Failed to load vault data' });
  }
});

/**
 * Save vault changes to the cloud and broadcast to other open devices.
 */
app.post('/api/cloud/sync', async (req, res) => {
  try {
    const { clientId, tools, notes, media, settings } = req.body ?? {};
    const result = await saveVaultData(
      {
        tools,
        notes,
        media,
        settings,
      },
      typeof clientId === 'string' ? clientId : undefined
    );
    return res.json(result);
  } catch (err) {
    console.error('[API] /api/cloud/sync error:', err);
    return res.status(500).json({ ok: false, error: 'Failed to synchronize vault data' });
  }
});

/**
 * Real-time Server-Sent Events (SSE) connection stream.
 * Automatically broadcasts updates across all open browsers and devices in real-time.
 */
app.get(['/api/cloud/sync/events', '/api/cloud/events'], (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  const clientId =
    typeof req.query.clientId === 'string' && req.query.clientId.trim()
      ? req.query.clientId.trim()
      : `device-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  registerSseClient(clientId, res);
});

/**
 * Check MongoDB connection status and settings.
 */
app.get('/api/cloud/mongo-status', async (_req, res) => {
  try {
    const data = await getVaultData();
    let maskedUri = '';
    if (data.mongoUri) {
      try {
        const parsed = new URL(data.mongoUri);
        if (parsed.password) {
          parsed.password = '******';
        }
        maskedUri = parsed.toString();
      } catch {
        maskedUri = 'Configured (Masked)';
      }
    }
    return res.json({
      ok: true,
      isMongoConnected: data.isMongoConnected,
      hasCustomMongo: Boolean(data.mongoUri),
      mongoUriMasked: maskedUri,
      storageType: data.isMongoConnected ? 'MongoDB Atlas' : 'Persistent Cloud Store',
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Failed to inspect database status' });
  }
});

/**
 * Calculate storage used against the MongoDB Atlas free plan allowance.
 */
app.get('/api/cloud/storage-usage', async (_req, res) => {
  try {
    const usage = await getStorageUsage();
    return res.json({ ok: true, ...usage });
  } catch (err) {
    console.error('[API] /api/cloud/storage-usage error:', err);
    return res.status(500).json({ ok: false, error: 'Failed to calculate storage usage' });
  }
});

app.get('/api/cloud/images', async (_req, res) => {
  try {
    return res.json({ ok: true, images: await getCloudImages() });
  } catch (err) {
    return res.status(503).json({ ok: false, error: err instanceof Error ? err.message : 'Image storage unavailable' });
  }
});

app.post('/api/cloud/images', async (req, res) => {
  try {
    const images = Array.isArray(req.body?.images) ? req.body.images : [];
    if (images.some((image: any) => !image?.id || !image?.dataUrl || typeof image.dataUrl !== 'string')) {
      return res.status(400).json({ ok: false, error: 'Invalid image payload' });
    }
    await saveCloudImages(images);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(503).json({ ok: false, error: err instanceof Error ? err.message : 'Image storage unavailable' });
  }
});

app.delete('/api/cloud/images/:id', async (req, res) => {
  try {
    await deleteCloudImage(req.params.id);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(503).json({ ok: false, error: err instanceof Error ? err.message : 'Image storage unavailable' });
  }
});

/**
 * Connect to external MongoDB / MongoDB Atlas.
 */
app.post('/api/cloud/mongo-config', async (req, res) => {
  const { uri } = req.body ?? {};
  if (typeof uri !== 'string') {
    return res.status(400).json({ ok: false, message: 'MongoDB connection URI is required.' });
  }

  const result = await connectMongo(uri.trim());
  return res.status(result.ok ? 200 : 400).json(result);
});

/**
 * Legacy Supabase bridge fallback for backwards compatibility.
 */
app.all('/api/supabase/*', async (req, res) => {
  try {
    if (req.path === '/api/supabase/data') {
      if (req.body && Object.keys(req.body).length > 0) {
        const saveRes = await saveVaultData(req.body);
        return res.json(saveRes);
      }
      const data = await getVaultData();
      return res.json({ ok: true, data });
    }
    return res.json({ ok: true });
  } catch {
    return res.json({ ok: true });
  }
});

// -------------------------------------------------------------
// Vite Middleware / Static Server
// -------------------------------------------------------------

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
    app.get('*', (_req, res) => {
      res.sendFile('dist/index.html', { root: '.' });
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`0arc cloud server active on http://0.0.0.0:${PORT}`);
  });
}

startServer();
