/**
 * 0arc Backend Server
 * Provides full-stack API capabilities:
 * - Real-time cross-device synchronization via Server-Sent Events (SSE)
 * - Persistent cloud database (Server-side document store + MongoDB Atlas integration)
 * - IMDb and Gemini media lookup integration
 * - Development Vite middleware & Production static serving
 */
import express from 'express';
import fs from 'fs';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import { lookupMedia, resolveMediaDetails, searchImdb, type MediaKind } from './api/_lib/media.ts';
import { allowLoginAttempt, clearSessionCookie, createSessionCookie, hasValidSessionCookie, privateLoginPage, verifyAccessPassword } from './api/_lib/auth.ts';
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
  getCloudFiles,
  saveCloudFiles,
  deleteCloudFile,
} from './api/_lib/cloudStore.ts';

dotenv.config();

const app = express();
app.set('trust proxy', 1);
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '32mb' }));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=63072000');
  next();
});

app.get('/api/health', (_req, res) => {
  return res.json({ ok: true, status: 'healthy', timestamp: new Date().toISOString() });
});

app.post('/api/auth/login', (req, res) => {
  if (!allowLoginAttempt(req.ip || 'unknown')) return res.status(429).json({ ok: false, error: 'Too many attempts. Try again later.' });
  const password = typeof req.body?.password === 'string' && req.body.password.length <= 1024 ? req.body.password : '';
  if (!verifyAccessPassword(password)) return res.status(401).json({ ok: false, error: 'Invalid credentials' });
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Set-Cookie', createSessionCookie());
  return res.json({ ok: true });
});

app.post('/api/auth/logout', (_req, res) => {
  res.setHeader('Set-Cookie', clearSessionCookie());
  return res.json({ ok: true });
});

app.use((req, res, next) => {
  if (req.path.startsWith('/api/auth/')) return next();
  if (hasValidSessionCookie(req.headers.cookie)) return next();
  res.setHeader('Cache-Control', 'no-store');
  if (req.path.startsWith('/api/')) return res.status(401).json({ ok: false, error: 'Authentication required' });
  return res.status(401).type('html').send(privateLoginPage);
});

// Initialize persistent storage engine on startup
initCloudStore().catch((err) => {
  console.error('[0arc] Failed to initialize cloud storage:', err);
});

// -------------------------------------------------------------
// IMDb & Media APIs
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
    if (images.some((image: any) => !Number.isFinite(Number(image.size)) || Number(image.size) > 10 * 1024 * 1024)) {
      return res.status(413).json({ ok: false, error: 'Each image must be 10 MB or smaller.' });
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

app.get('/api/cloud/files', async (_req, res) => {
  try {
    return res.json({ ok: true, files: await getCloudFiles() });
  } catch (err) {
    return res.status(503).json({ ok: false, error: err instanceof Error ? err.message : 'File storage unavailable' });
  }
});

app.post('/api/cloud/files', async (req, res) => {
  try {
    const files = Array.isArray(req.body?.files) ? req.body.files : [];
    if (files.some((file: any) => !file?.id || !file?.name || !file?.dataUrl || typeof file.dataUrl !== 'string')) {
      return res.status(400).json({ ok: false, error: 'Invalid file payload' });
    }
    if (files.some((file: any) => !Number.isFinite(Number(file.size)) || Number(file.size) > 10 * 1024 * 1024)) {
      return res.status(413).json({ ok: false, error: 'Each file must be 10 MB or smaller.' });
    }
    await saveCloudFiles(files);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(503).json({ ok: false, error: err instanceof Error ? err.message : 'File storage unavailable' });
  }
});

app.delete('/api/cloud/files/:id', async (req, res) => {
  try {
    await deleteCloudFile(req.params.id);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(503).json({ ok: false, error: err instanceof Error ? err.message : 'File storage unavailable' });
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
  const distPath = path.resolve(process.cwd(), 'dist');
  const indexPath = path.join(distPath, 'index.html');

  if (fs.existsSync(indexPath)) {
    console.log(`[0arc] Serving static production build from ${distPath}`);
    app.use(express.static(distPath));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(indexPath);
    });
  } else if (process.env.NODE_ENV !== 'production') {
    console.log('[0arc] Starting Vite dev middleware...');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`0arc cloud server active on http://0.0.0.0:${PORT}`);
  });
}

startServer();
