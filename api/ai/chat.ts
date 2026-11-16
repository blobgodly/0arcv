import type { ApiRequest, ApiResponse } from '../_lib/http.js';
import { allowAiRequest, getAiServiceError, respondToArchiveChat } from '../_lib/aiChat.js';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const forwardedFor = (req as any).headers?.['x-forwarded-for'];
  const clientKey = Array.isArray(forwardedFor) ? forwardedFor[0] : String(forwardedFor || 'unknown').split(',')[0].trim();
  if (!allowAiRequest(clientKey)) return res.status(429).json({ ok: false, error: 'Too many requests. Please wait a minute and try again.' });

  try {
    const body = (req.body || {}) as { message?: unknown; history?: unknown };
    const reply = await respondToArchiveChat(body.message, body.history);
    return res.status(200).json({ ok: true, reply });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.startsWith('Enter a message') || message.startsWith('Messages must')) {
      return res.status(400).json({ ok: false, error: message });
    }
    if (message.includes('not configured')) {
      return res.status(503).json({ ok: false, error: message });
    }
    console.error('[AI Chat] Request failed:', error);
    const serviceError = getAiServiceError(error);
    return res.status(serviceError.status).json({ ok: false, error: serviceError.message });
  }
}
