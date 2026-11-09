import type { ApiRequest, ApiResponse } from '../../_lib/http.js';
import { deleteCloudImage } from '../../_lib/cloudStore.js';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'DELETE') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const rawId = req.query?.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  if (!id) return res.status(400).json({ ok: false, error: 'Image id is required' });
  try {
    await deleteCloudImage(id);
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(503).json({ ok: false, error: err instanceof Error ? err.message : 'Image storage unavailable' });
  }
}
