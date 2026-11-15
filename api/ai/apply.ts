import type { ApiRequest, ApiResponse } from '../_lib/http.js';
import { allowAiRequest, applyArchiveChange } from '../_lib/aiChat.js';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const forwardedFor = (req as any).headers?.['x-forwarded-for'];
  const clientKey = Array.isArray(forwardedFor) ? forwardedFor[0] : String(forwardedFor || 'unknown').split(',')[0].trim();
  if (!allowAiRequest(clientKey)) return res.status(429).json({ ok: false, error: 'Too many requests. Please wait and try again.' });
  try {
    const result = await applyArchiveChange((req.body as any)?.proposal);
    return res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The proposed change could not be applied.';
    const status = /proposal|invalid|expired|field|title|target|choose|url|rating|tags|year/i.test(message) ? 400 : 500;
    return res.status(status).json({ ok: false, error: message });
  }
}
