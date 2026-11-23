import { catalogOrigin } from './config.js';

export const configured = Boolean(catalogOrigin);
async function request(path, params, signal) {
  const url = new URL(path, catalogOrigin);
  url.search = new URLSearchParams(params);
  const timeout = AbortSignal.timeout(9500);
  const response = await fetch(url, {
    signal: AbortSignal.any([signal, timeout]),
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  });
  if (!response.ok)
    throw new Error(
      response.status === 429 ? 'TMDB is busy. Try again shortly.' : 'TMDB could not be reached.'
    );
  return response.json();
}
export async function search(type, q, signal) {
  const { results } = await request('/search', { type, q }, signal);
  if (!Array.isArray(results)) throw new Error('TMDB returned an unreadable response.');
  return results.filter(
    (item) => item.mediaType === type && item.metadata?.title && Number.isSafeInteger(item.tmdbId)
  );
}
export async function details(item, signal) {
  const data = await request('/details', { type: item.mediaType, id: item.tmdbId }, signal);
  if (
    data.item?.tmdbId !== item.tmdbId ||
    data.item.mediaType !== item.mediaType ||
    !data.item.metadata?.title
  )
    throw new Error('Details unavailable.');
  return data.item;
}
export function imageUrl(path, size) {
  return typeof path === 'string' && /^\/[\w.-]+\.(jpg|png|webp)$/i.test(path)
    ? 'https://image.tmdb.org/t/p/' + size + path
    : '';
}
