import type { ApiRequest, ApiResponse } from './_lib/http.js';
import { allowAiRequest, applyArchiveChange, getAiServiceError, respondToArchiveChat } from './_lib/aiChat.js';
import { readParam } from './_lib/http.js';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  const action = readParam(req.query?.action);
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const forwardedFor = req.headers?.['x-forwarded-for'];
  const clientKey = Array.isArray(forwardedFor) ? forwardedFor[0] : String(forwardedFor || 'unknown').split(',')[0].trim();
  if (!allowAiRequest(clientKey)) return res.status(429).json({ ok: false, error: 'Too many requests. Please wait a minute and try again.' });

  if (action === 'chat') {
    try {
      const body = (req.body || {}) as { message?: unknown; history?: unknown };
      const reply = await respondToArchiveChat(body.message, body.history);
      return res.status(200).json({ ok: true, reply });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message.startsWith('Enter a message') || message.startsWith('Messages must')) {
        return res.status(400).json({ ok: false, error: message });
      }
      if (message.includes('not configured')) return res.status(503).json({ ok: false, error: message });
      console.error('[AI Chat] Request failed:', error);
      const serviceError = getAiServiceError(error);
      return res.status(serviceError.status).json({ ok: false, error: serviceError.message });
    }
  }

  if (action === 'apply') {
    try {
      const result = await applyArchiveChange((req.body as any)?.proposal);
      return res.status(200).json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The proposed change could not be applied.';
      const status = /proposal|invalid|expired|field|title|target|choose|url|rating|tags|year/i.test(message) ? 400 : 500;
      return res.status(status).json({ ok: false, error: message });
    }
  }

  return res.status(404).json({ ok: false, error: 'Unknown AI action' });
}
