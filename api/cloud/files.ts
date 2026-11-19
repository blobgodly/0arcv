import type { ApiRequest, ApiResponse } from '../_lib/http.js';
import { deleteCloudFile, getCloudFiles, saveCloudFiles } from '../_lib/cloudStore.js';

const MAX_FILE_BYTES = 10 * 1024 * 1024;

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    if (req.method === 'GET') {
      return res.status(200).json({ ok: true, files: await getCloudFiles() });
    }
    if (req.method === 'POST') {
      const body = (req.body || {}) as { files?: unknown };
      const files = Array.isArray(body.files) ? body.files : [];
      if (files.some((file) => !file || typeof file !== 'object' || !(file as any).id || !(file as any).name || !(file as any).dataUrl)) {
        return res.status(400).json({ ok: false, error: 'Invalid file payload' });
      }
      if (files.some((file) => !Number.isFinite(Number((file as any).size)) || Number((file as any).size) > MAX_FILE_BYTES)) {
        return res.status(413).json({ ok: false, error: 'Each file must be 10 MB or smaller.' });
      }
      await saveCloudFiles(files as any[]);
      return res.status(200).json({ ok: true });
    }
    if (req.method === 'DELETE') {
      const id = typeof req.query?.id === 'string' ? req.query.id : '';
      if (!id) return res.status(400).json({ ok: false, error: 'File id is required' });
      await deleteCloudFile(id);
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (err) {
    return res.status(503).json({ ok: false, error: err instanceof Error ? err.message : 'File storage unavailable' });
  }
}
