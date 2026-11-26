import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, facets, fold, indexCollection, runQuery, unknown } from '../js/discovery.js';
import { readQuery } from '../js/discovery-preferences.js';

const record = (id, title, extra = {}) => ({
  id,
  title,
  mediaType: 'movie',
  rating: 8.5,
  added: '2021-05-01T01:30:00+02:00',
  tmdbId: null,
  metadata: null,
  ...extra,
});
const meta = (title, date, lang, genres) => ({
  title,
  originalTitle: title,
  releaseDate: date,
  originalLanguage: lang,
  genres: genres.map((id) => ({ id, name: id === 18 ? 'Drama' : 'Adventure' })),
  overview: 'A film.',
  posterPath: '/film.jpg',
  backdropPath: '/scene.jpg',
});
const items = [
  record('b', 'Lumière', {
    tmdbId: 1,
    metadata: meta('Été à Paris', '1994-01-01', 'fr', [18, 12]),
  }),
  record('a', 'Paris', {
    tmdbId: 2,
    metadata: meta('東京の空', '2002-03-04', 'ja', [18]),
    rating: 9,
  }),
  record('c', 'Paris after rain', { added: '2024-01-01', rating: 9.5 }),
  record('z', 'Lumière', { mediaType: 'tv' }),
];
const rows = indexCollection(items).movie;
const ids = (patch) => runQuery(rows, { ...defaults(), ...patch }).map((e) => e.id);
test('full-width, accents, mixed title tokens and Japanese script search locally', () => {
  assert.equal(fold('Ｅ́té  Straße'), 'ete strasse');
  assert.deepEqual(ids({ query: 'lumiere  PARIS' }), ['b']);
  assert.deepEqual(ids({ query: '東京 空' }), ['a']);
  assert.deepEqual(ids({ query: 'PARIS' }), ['a', 'c', 'b']);
  assert.deepEqual(ids({ query: 'zz paris' }), []);
});
test('facets are scoped, count distinct entries, and expose unknown groups', () => {
  const f = facets(rows);
  assert.deepEqual(
    f.genres.map((x) => [x.key, x.count]),
    [
      ['12', 1],
      ['18', 2],
      [unknown, 1],
    ]
  );
  assert.equal(f.languages.find((x) => x.key === 'fr').count, 1);
  assert.equal(f.sources.find((x) => x.key === 'manual').count, 1);
  assert.equal(f.missing.find((x) => x.key === 'none').count, 2);
  assert.deepEqual(
    f.decades.map((x) => x.key),
    ['2000', '1990']
  );
});
test('dimensions intersect; selections within genre and language match any', () => {
  assert.deepEqual(
    ids({
      genres: ['12', '18'],
      languages: ['ja', 'fr'],
      yearFrom: '1990',
      yearTo: '1999',
      ratingFrom: 8.5,
      ratingTo: 8.5,
      addedFrom: '2021-04-30',
      addedTo: '2021-04-30',
      source: 'catalog',
    }),
    ['b']
  );
  assert.deepEqual(
    ids({ genres: ['18'], languages: ['fr', 'ja'], ratingFrom: 8.5, ratingTo: 9 }).sort(),
    ['a', 'b']
  );
  assert.deepEqual(ids({ addedFrom: '2021-05-01' }), ['c']);
  assert.deepEqual(ids({ missing: 'poster', genres: [unknown], source: 'manual' }), ['c']);
  assert.deepEqual(ids({ yearTo: '2100', source: 'manual' }), []);
  assert.deepEqual(ids({ missing: 'none', languages: [unknown] }), []);
});
test('release sorts place missing last, tie-breaks do not depend on input order', () => {
  assert.deepEqual(ids({ sort: 'earlyRelease' }), ['b', 'a', 'c']);
  assert.deepEqual(ids({ sort: 'release' }), ['a', 'b', 'c']);
  assert.deepEqual(ids({ sort: 'highest' }), ['c', 'a', 'b']);
  assert.deepEqual(ids({ sort: 'lowest' }), ['b', 'a', 'c']);
  const entries = ['z', 'a', 'd'].map((id) => record(id, 'Same title'));
  for (const sort of [
    'recent',
    'oldest',
    'release',
    'earlyRelease',
    'alpha',
    'reverseAlpha',
    'highest',
    'lowest',
    'relevance',
  ])
    assert.deepEqual(
      runQuery(indexCollection(entries).movie, { ...defaults(), sort }).map((e) => e.id),
      ['a', 'd', 'z']
    );
});
test('same snapshots reuse indexed text, replacements are indexed afresh', () => {
  assert.equal(indexCollection(items).movie[0], rows[0]);
  const changed = indexCollection([{ ...items[0], title: 'Override' }]).movie;
  assert.equal(runQuery(changed, { ...defaults(), query: 'override' }).length, 1);
  assert.equal(runQuery(changed, { ...defaults(), query: 'lumiere' }).length, 0);
});
test('invalid persisted preferences cannot hide a library or invent a sort', () => {
  assert.deepEqual(
    readQuery({
      sort: 'bogus',
      missing: '__proto__',
      genres: [false],
      ratingFrom: 2.25,
      yearFrom: '2030',
      yearTo: '2020',
      addedTo: '2024-02-30',
    }),
    defaults()
  );
});
