import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acknowledge,
  active,
  blank,
  cacheAt,
  overlay,
  reconcile,
  validateCache,
  withEntries,
  working,
} from '../js/cloud/cache.js';

const entry = (id, title = id, extra = {}) => ({
  id,
  title,
  mediaType: 'movie',
  tmdbId: null,
  rating: 7.5,
  added: '2025-02-02T15:40:15.123456+04:00',
  metadata: null,
  ...extra,
});
const rows = (entries) =>
  entries.map((entry, index) => ({ id: entry.id, revision: index + 1, entry }));
const mirror = (...entries) => ({ ...blank(), rows: rows(entries), cursor: entries.length });
const uuid = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';

test('edits, removals and undos during an unacknowledged flight remain durable', () => {
  const e = entry('legacy', '夜', { metadata: { overview: 'First cut' }, edition: { cut: 'β' } });
  let c = withEntries(blank(), [e]);
  c = { ...c, flight: { id: uuid, expected: 0, changes: c.pending } };
  const changed = { ...e, rating: 8.5 };
  const committed = acknowledge(withEntries(c, [changed]), 1);
  assert.deepEqual(working(committed), [changed]);
  assert.deepEqual(active(committed.rows), [e]);
  assert.deepEqual(committed.pending, [{ id: e.id, entry: changed }]);
  const undone = acknowledge(withEntries(c, []), 1);
  assert.deepEqual(undone.pending, [{ id: e.id, entry: null }]);
  assert.deepEqual(working(undone), []);
  assert.throws(() => acknowledge(c, 2));
});

test('different titles converge automatically and a shared equivalent edit is acknowledged', () => {
  const a = entry('a'),
    b = entry('b'),
    c = withEntries(mirror(a, b), [{ ...a, rating: 10 }, b]);
  const incoming = { rows: overlay(c.rows, [{ id: 'b', entry: null, revision: 3 }]), cursor: 3 };
  assert.deepEqual(reconcile(c, incoming), { entries: [{ ...a, rating: 10 }], conflicts: [] });
  const converged = { rows: [{ id: 'a', entry: { ...a, rating: 10 }, revision: 4 }], cursor: 4 };
  assert.deepEqual(reconcile(c, converged).conflicts, []);
});

test('remote deletion versus offline edit requires a decision, including a newly seen tombstone', () => {
  const a = entry('a'),
    local = { ...a, rating: 6 };
  for (const c of [withEntries(mirror(a), [local]), withEntries(blank(), [local])]) {
    const remote = { rows: [{ id: a.id, revision: 2, entry: null }], cursor: 2 };
    const result = reconcile(c, remote);
    assert.equal(result.conflicts.length, 1);
    assert.deepEqual(result.conflicts[0].local, [local]);
    assert.deepEqual(reconcile(c, remote, new Map([['a', 'cloud']])).entries, []);
    assert.deepEqual(reconcile(c, remote, new Map([['a', 'device']])).entries, [local]);
  }
});

test('independent IDs for one normalized title form a single conflict while a TV entry stays separate', () => {
  const a = entry('left', 'Ｆｉｌｍ　Night'),
    b = entry('right', 'film night', { rating: 9 });
  const tv = entry('tv', 'film night', { mediaType: 'tv' });
  const c = withEntries(blank(), [a, tv]),
    remote = { rows: rows([b]), cursor: 1 };
  const { conflicts } = reconcile(c, remote);
  assert.equal(conflicts.length, 1);
  const r = reconcile(c, remote, new Map([[conflicts[0].key, 'cloud']]));
  assert.deepEqual(new Set(r.entries.map((e) => e.id)), new Set(['right', 'tv']));
});

test('invalid cache envelopes and incomplete synchronization records fail closed', () => {
  const e = entry('a'),
    c = mirror(e);
  assert.equal(validateCache(c), c);
  for (const broken of [
    { ...c, rows: [] },
    { ...c, cursor: -1 },
    { ...c, order: ['a', 'a'] },
    { ...c, pending: [{ id: 'b', entry: e }] },
    { ...c, flight: { expected: 2, id: uuid, changes: [] } },
    { ...c, incoming: { cursor: 1, rows: [] } },
    { ...c, pending: [{ id: 'a', entry: { ...e, rating: 3.2 } }] },
  ]) {
    const raw = JSON.stringify(broken);
    globalThis.localStorage = {
      getItem: () => raw,
      setItem: () => assert.fail('cache reads must never write'),
    };
    assert.throws(() => cacheAt('disposable-test'));
  }
});

test('cloud-only validation protects unsupported text and credentials while preserving ordinary Unicode', () => {
  assert.doesNotThrow(() => withEntries(blank(), [entry('a', '雪 🎥')]));
  for (const extra of [
    { owner_id: 'someone' },
    { metadata: { overview: '\0' } },
    { extension: ['\uD800'] },
    { secret: 'value' },
  ])
    assert.throws(() => withEntries(blank(), [entry('a', 'Title', extra)]));
});

test('a restore that swaps stable IDs can be represented in a single atomic change set', () => {
  const a = entry('a', 'East'),
    b = entry('b', 'West'),
    c = mirror(a, b);
  const next = [
      { ...b, title: 'East' },
      { ...a, title: 'West' },
    ],
    edited = withEntries(c, next);
  assert.equal(edited.pending.length, 2);
  assert.deepEqual(working(validateCache(edited)), next);
  const ack = acknowledge(
    { ...edited, flight: { id: uuid, expected: 2, changes: edited.pending } },
    4
  );
  assert.deepEqual(working(validateCache(ack)), next);
  assert.equal(ack.pending.length, 0);
});

test('independent changes to one title preserve its name, rating and nested metadata', () => {
  const base = entry('stable', 'A screening', {
    metadata: { overview: 'A walk', genres: [{ id: 3, name: 'Drama' }] },
    edition: 'original',
  });
  const local = { ...base, rating: 8.5, metadata: { ...base.metadata, originalTitle: '空' } };
  delete local.edition;
  const remote = {
    ...base,
    title: 'New display name',
    metadata: { ...base.metadata, overview: 'A longer walk' },
  };
  const cache = withEntries(mirror(base), [local]);
  const incoming = { rows: [{ id: base.id, revision: 2, entry: remote }], cursor: 2 };
  const result = reconcile(cache, incoming);
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.entries, [
    {
      ...local,
      title: remote.title,
      metadata: { ...local.metadata, overview: remote.metadata.overview },
    },
  ]);
  incoming.rows[0].entry = { ...remote, rating: 9 };
  assert.equal(reconcile(cache, incoming).conflicts.length, 1);
});
