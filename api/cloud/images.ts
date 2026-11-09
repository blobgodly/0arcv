import type { ApiRequest, ApiResponse } from '../_lib/http.js';
import { deleteCloudImage, getCloudImages, saveCloudImages } from '../_lib/cloudStore.js';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    if (req.method === 'GET') {
      return res.status(200).json({ ok: true, images: await getCloudImages() });
    }
    if (req.method === 'POST') {
      const body = (req.body || {}) as { images?: unknown };
      const images = Array.isArray(body.images) ? body.images : [];
      if (images.some((image) => !image || typeof image !== 'object' || !(image as any).id || !(image as any).dataUrl)) {
        return res.status(400).json({ ok: false, error: 'Invalid image payload' });
      }
      await saveCloudImages(images as any[]);
      return res.status(200).json({ ok: true });
    }
    if (req.method === 'DELETE') {
      const id = typeof req.query?.id === 'string' ? req.query.id : '';
      if (!id) return res.status(400).json({ ok: false, error: 'Image id is required' });
      await deleteCloudImage(id);
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (err) {
    return res.status(503).json({ ok: false, error: err instanceof Error ? err.message : 'Image storage unavailable' });
  }
}
