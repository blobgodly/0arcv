import { lookupMedia, resolveMediaDetails, searchImdb, type MediaKind } from './_lib/media.js';
import { readBodyField, readBodyNumber, readParam, type ApiRequest, type ApiResponse } from './_lib/http.js';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  const provider = readParam(req.query?.provider);
  const action = readParam(req.query?.action);

  if (provider === 'imdb' && action === 'search') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const query = readParam(req.query?.q);
    const type = readParam(req.query?.type) || undefined;
    if (!query) return res.status(200).json({ results: [] });
    try {
      const results = await searchImdb(query, type);
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
      return res.status(200).json({ results });
    } catch {
      return res.status(200).json({ results: [] });
    }
  }

  if (provider === 'imdb' && action === 'details') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const title = readBodyField(req.body, 'title');
    if (!title) return res.status(400).json({ error: 'Title is required' });
    const requestedType = readBodyField(req.body, 'type');
    const type: MediaKind = requestedType === 'series' || requestedType === 'anime' ? requestedType : 'movie';
    const details = await resolveMediaDetails(title, readBodyNumber(req.body, 'year'), type, readBodyField(req.body, 'posterUrl') || undefined);
    return res.status(200).json(details);
  }

  if (provider === 'gemini' && action === 'lookup') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const title = readBodyField(req.body, 'title');
    if (!title) return res.status(400).json({ error: 'Title is required' });
    const type = readBodyField(req.body, 'type') || 'movie';
    return res.status(200).json(await lookupMedia(title, type));
  }

  return res.status(404).json({ error: 'Unknown media action' });
}
