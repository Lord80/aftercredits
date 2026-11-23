import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  STORAGE_KEY,
  LEGACY_KEY,
  initialize,
  changeMovie,
  snapshot,
  selectMovies,
} from '../js/collection.js';

const values = new Map();
beforeEach(() => {
  values.clear();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
});
const legacy = {
  id: 'legacy-1',
  title: 'Original entry',
  rating: 9.5,
  added: '2025-02-01T10:23:00.000Z',
};
const mutate = (args) => Promise.resolve().then(() => changeMovie(args));
function selected(tmdbId, mediaType, title = 'Contract fixture') {
  return {
    action: 'add',
    title,
    rating: 8.5,
    mediaType,
    match: {
      tmdbId,
      mediaType,
      metadata: { title, genres: [{ id: 16, name: 'Animation' }], originalLanguage: 'ja' },
    },
  };
}
test('migration is idempotent, preserves the old bytes and does not resurrect a deletion', async () => {
  const original = JSON.stringify([legacy]);
  values.set(LEGACY_KEY, original);
  await initialize();
  await initialize();
  assert.equal(values.get(LEGACY_KEY), original);
  assert.deepEqual(snapshot().items, [
    { ...legacy, tmdbId: null, metadata: null, mediaType: 'movie' },
  ]);
  assert.equal(JSON.parse(values.get(STORAGE_KEY)).version, 2);
  await mutate({ action: 'delete', id: legacy.id });
  await initialize();
  assert.deepEqual(snapshot().items, []);
});
test('identity includes media type and TMDB ID; remakes and same-ID TV titles coexist', async () => {
  await mutate(selected(101, 'movie'));
  await mutate(selected(101, 'tv'));
  await mutate(selected(102, 'movie'));
  await assert.rejects(mutate(selected(101, 'movie', 'Alias')), /already/);
  const before = snapshot().items[0];
  await mutate({ action: 'edit', id: before.id, title: 'Personal name', rating: 1 });
  const after = snapshot().items[0];
  assert.deepEqual(after, { ...before, title: 'Personal name', rating: 1 });
  assert.equal(after.metadata.title, 'Contract fixture');
});
test('manual titles validate whitespace, normalized case, increments and bounds', async () => {
  await mutate({ title: '  Full    width ', rating: 10, mediaType: 'movie' });
  await assert.rejects(
    mutate({ title: 'ＦULL width', rating: 7.5, mediaType: 'movie' }),
    /already/
  );
  await mutate({ title: 'Full width', rating: 7.5, mediaType: 'tv' });
  for (const rating of [0, 10.5, 5.25, NaN])
    await assert.rejects(mutate({ title: 'x', rating, mediaType: 'movie' }), /rating/);
  await assert.rejects(mutate({ title: '  ', rating: 1, mediaType: 'movie' }), /title/);
  assert.deepEqual(
    selectMovies(snapshot().items, 'FULL', 'highest').map((e) => e.rating),
    [10, 7.5]
  );
});
test('unsupported, damaged and partial archives are protected from destructive updates', async () => {
  for (const raw of [
    'bad JSON',
    JSON.stringify({ version: 3, entries: [] }),
    JSON.stringify({ version: 2, entries: [null] }),
  ]) {
    values.set(STORAGE_KEY, raw);
    const archive = await import('../js/collection.js?recovery=' + encodeURIComponent(raw));
    await archive.initialize();
    assert.match(archive.snapshot().notice, /protected/);
    await archive.changeMovie(selected(3, 'movie'));
    assert.equal(archive.snapshot().items.length, 1);
    assert.equal(values.get(STORAGE_KEY), raw);
  }
});
