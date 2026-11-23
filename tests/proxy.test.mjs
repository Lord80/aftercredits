// Isolated contract fixtures exercise the Worker without live credentials or network calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.mjs';
const origin = 'https://journal.example';
const env = { ALLOWED_ORIGINS: origin, TMDB_READ_TOKEN: 'test-only' };
function call(path, method = 'GET', site = origin, bindings = env) {
  return worker.fetch(
    new Request('https://worker.example' + path, { method, headers: { Origin: site } }),
    bindings
  );
}
test('only approved origins, routes, methods and inputs reach TMDB', async (t) => {
  const transport = t.mock.method(globalThis, 'fetch', () => {
    throw new Error('unexpected request');
  });
  for (const [path, method, site, code] of [
    ['/search?type=movie&q=title', 'GET', 'https://other.example', 403],
    ['/search?type=movie&q=title', 'POST', origin, 405],
    ['/other?type=tv', 'GET', origin, 404],
    ['/details?type=tv&id=abc', 'GET', origin, 400],
    ['/search?type=person&q=a', 'GET', origin, 400],
    ['/search?type=movie&q=', 'GET', origin, 400],
    ['/search', 'OPTIONS', origin, 204],
  ])
    assert.equal((await call(path, method, site)).status, code);
  assert.equal(
    (await call('/search?type=tv&q=title', 'GET', origin, { ALLOWED_ORIGINS: origin })).status,
    503
  );
  assert.equal(transport.mock.callCount(), 0);
});
test('search and details normalize movie and series responses; token stays server-side', async (t) => {
  const fixture = {
    id: 42,
    title: 'Movie fixture',
    name: 'TV fixture',
    genre_ids: [16],
    first_air_date: '2025-04-01',
    poster_path: '/fixture.jpg',
    original_language: 'ja',
    overview: 'Test fixture only.',
  };
  const transport = t.mock.method(globalThis, 'fetch', async (url) =>
    Response.json(
      url.pathname.includes('search')
        ? { results: [fixture] }
        : { ...fixture, genres: [{ id: 16, name: 'Animation' }] }
    )
  );
  for (const type of ['movie', 'tv']) {
    const response = await call('/search?type=' + type + '&q=A%20%26%20B');
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
    const hit = (await response.json()).results[0];
    assert.equal(hit.mediaType, type);
    assert.equal(hit.tmdbId, 42);
    assert.equal(hit.metadata.title, type === 'movie' ? 'Movie fixture' : 'TV fixture');
    assert.equal(hit.metadata.posterPath, '/fixture.jpg');
    assert.equal(hit.metadata.backdropPath, null);
    const [url, opts] = transport.mock.calls.at(-1).arguments;
    assert.equal(url.origin, 'https://api.themoviedb.org');
    assert.equal(url.pathname, '/3/search/' + type);
    assert.equal(url.searchParams.get('query'), 'A & B');
    assert.equal(opts.headers.Authorization, 'Bearer test-only');
    const detail = await call('/details?type=' + type + '&id=42');
    const body = await detail.text();
    assert.ok(!body.includes('test-only'));
    assert.deepEqual(JSON.parse(body).item.metadata.genres, [{ id: 16, name: 'Animation' }]);
  }
});
test('TMDB failure, throttling and network failure have actionable status codes', async (t) => {
  let upstream = 429;
  t.mock.method(globalThis, 'fetch', async () => {
    if (!upstream) throw Error();
    return new Response(null, { status: upstream });
  });
  for (const [code, expected] of [
    [429, 429],
    [401, 502],
    [404, 404],
    [0, 503],
  ]) {
    upstream = code;
    assert.equal((await call('/details?type=tv&id=42')).status, expected);
  }
});
