// Cloudflare injects the read token as a secret binding at runtime.
const api = 'https://api.themoviedb.org/3';
function text(value) {
  return typeof value === 'string' ? value : '';
}
function imagePath(value) {
  return /^\/[\w.-]+\.(jpg|png|webp)$/i.test(value) ? value : null;
}

export function mapTitle(raw, mediaType) {
  const title = text(mediaType === 'movie' ? raw.title : raw.name);
  if (!title || !Number.isSafeInteger(raw.id) || raw.id < 1) return null;
  const groups = Array.isArray(raw.genres)
    ? raw.genres
    : (raw.genre_ids ?? []).map((id) => ({ id }));
  return {
    tmdbId: raw.id,
    mediaType,
    metadata: {
      title,
      originalTitle: text(raw.original_title ?? raw.original_name),
      releaseDate: text(raw.release_date ?? raw.first_air_date),
      originalLanguage: text(raw.original_language),
      overview: text(raw.overview),
      genres: groups
        .filter((g) => Number.isInteger(g?.id))
        .map((g) => ({ id: g.id, name: text(g.name) })),
      posterPath: imagePath(raw.poster_path),
      backdropPath: imagePath(raw.backdrop_path),
    },
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim());
    const headers = { Vary: 'Origin', 'Cache-Control': 'no-store' };
    const reply = (body, status = 200) => Response.json(body, { status, headers });
    if (!origin || !allowed.includes(origin)) return reply({ error: 'Origin unavailable.' }, 403);
    headers['Access-Control-Allow-Origin'] = origin;
    if (request.method === 'OPTIONS')
      return new Response(null, {
        status: 204,
        headers: { ...headers, 'Access-Control-Allow-Methods': 'GET, OPTIONS' },
      });
    if (request.method !== 'GET') return reply({ error: 'Use GET.' }, 405);
    const { pathname, searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    if (!['movie', 'tv'].includes(type)) return reply({ error: 'Invalid media type.' }, 400);
    let target;
    if (pathname === '/search') {
      const q = (searchParams.get('q') ?? '').trim();
      if (!q || q.length > 160) return reply({ error: 'Enter 1–160 characters.' }, 400);
      target = new URL(api + '/search/' + type);
      target.searchParams.set('query', q);
      target.searchParams.set('include_adult', 'false');
    } else if (pathname === '/details') {
      const id = searchParams.get('id');
      if (!/^[1-9]\d{0,12}$/.test(id ?? '')) return reply({ error: 'Invalid title ID.' }, 400);
      target = new URL(api + '/' + type + '/' + id);
    } else return reply({ error: 'Unknown route.' }, 404);
    if (!env.TMDB_READ_TOKEN) return reply({ error: 'TMDB search needs configuration.' }, 503);
    target.searchParams.set('language', 'en-US');
    try {
      const upstream = await fetch(target, {
        headers: { Authorization: 'Bearer ' + env.TMDB_READ_TOKEN, Accept: 'application/json' },
        redirect: 'manual',
        signal: AbortSignal.timeout(7000),
      });
      if (!upstream.ok) {
        const status = upstream.status === 429 ? 429 : upstream.status === 404 ? 404 : 502;
        return reply({ error: 'TMDB is currently unavailable.' }, status);
      }
      const raw = await upstream.json();
      if (pathname === '/search') {
        const results = raw.results.map((record) => mapTitle(record, type)).filter(Boolean);
        return reply({ results });
      }
      const item = mapTitle(raw, type);
      if (!item || item.tmdbId !== Number(searchParams.get('id')))
        return reply({ error: 'Invalid details response.' }, 502);
      return reply({ item });
    } catch {
      return reply({ error: 'TMDB did not respond in time.' }, 503);
    }
  },
};
