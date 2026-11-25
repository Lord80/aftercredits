import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { backupText, csvText, makeBackup, readBackup, fileName } from '../js/backup.js';
import { inspectEntries, MAX_BYTES } from '../js/validation.js';
import { planImport, mergedEntries } from '../js/import-plan.js';
import { changeMovie, STORAGE_KEY, LEGACY_KEY } from '../js/collection.js';
import {
  applyImport,
  checkpoints,
  exportCurrent,
  HISTORY_KEY,
  recoveryReport,
  review,
} from '../js/vault-store.js';
import { backupStatus, dismissReminder, reminderDue, STATUS_KEY } from '../js/vault-status.js';

const at = '2026-01-23T04:05:06.987Z';
const manual = {
  id: 'local/one',
  mediaType: 'movie',
  title: '雨の朝',
  rating: 9.5,
  added: at,
  tmdbId: null,
  metadata: null,
};
const movie = {
  ...manual,
  id: 'film',
  title: '日出 · My cut',
  tmdbId: 57,
  added: '2024-02-29',
  metadata: {
    title: '日出',
    originalTitle: '日の出',
    releaseDate: '2004-02-29',
    overview: 'Line one\nLine two',
    originalLanguage: 'ja',
    genres: [
      { id: 16, name: 'Animation' },
      { id: 3, name: '' },
    ],
    posterPath: '/cover-A.jpg',
    backdropPath: '/background_2.webp',
    runtime: 134,
  },
  edition: { cuts: ['復元版', 'Original'] },
};
const tv = { ...movie, mediaType: 'tv', id: 'series', rating: 1 };
const saved = [manual, movie, tv];
const simple = (i) => ({ ...manual, id: 'id-' + i, title: 'Manual ' + i });
const raw = (entries) => JSON.stringify({ version: 2, entries }, null, 2);
const report = (entries) => readBackup(raw(entries));
let values, deny, requests;
beforeEach(() => {
  values = new Map();
  deny = () => false;
  requests = [];
  globalThis.localStorage = {
    getItem: (k) => values.get(k) ?? null,
    setItem(k, v) {
      if (deny(k, v)) throw new DOMException('Full', 'QuotaExceededError');
      values.set(k, v);
    },
    removeItem: (k) => values.delete(k),
  };
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: async (key, options, fn) => {
        requests.push(key);
        options.signal?.throwIfAborted();
        return fn();
      },
    },
  });
});

test('full versioned, offline JSON round trip preserves every entry, metadata extension, score, timestamp and order', async () => {
  values.set(STORAGE_KEY, raw(saved));
  values.set('unrelated.secret', 'unrelated private value');
  let text;
  const result = await exportCurrent((bytes) => {
    text = bytes;
  });
  assert.ok(result.recorded);
  assert.ok(!text.includes('unrelated'));
  const exported = JSON.parse(text);
  assert.equal(exported.application, 'AFTERCREDITS');
  assert.equal(exported.backupVersion, 1);
  assert.equal(exported.entryCount, 3);
  assert.ok(Date.parse(exported.exportedAt));
  assert.equal(backupStatus().exportedAt, exported.exportedAt);
  assert.deepEqual(readBackup('\uFEFF' + text).entries, saved);
  assert.deepEqual(inspectEntries(saved).entries, saved);
  const current = [simple(7)];
  values.set(STORAGE_KEY, raw(current));
  const p = review(readBackup(text));
  const copy = await exportCurrent(
    (data) => assert.deepEqual(readBackup(data).entries, current),
    p.base,
    true
  );
  await applyImport(p, 'restore', new Set(), copy.receipt);
  assert.deepEqual(JSON.parse(values.get(STORAGE_KEY)).entries, saved);
  assert.deepEqual(recoveryReport(checkpoints()[0]).entries, current);
  assert.match(
    fileName('backup', at, 'json'),
    /^aftercredits-backup-2026-01-23T04-05-06.987Z\.json$/
  );
});

test('raw v2 and compatible v1 envelopes and arrays migrate offline without touching the original legacy key', async () => {
  const old = { id: 'old', title: 'From 2024', rating: 6.5, added: at };
  const expected = { ...old, mediaType: 'movie', tmdbId: null, metadata: null };
  const bytes = JSON.stringify([old]);
  assert.deepEqual(readBackup(JSON.stringify({ version: 1, entries: [old] })).entries, [expected]);
  assert.deepEqual(readBackup(bytes).entries, [expected]);
  values.set(LEGACY_KEY, bytes);
  assert.deepEqual(
    review(readBackup(raw(saved))).plan.rows.map((r) => r.entry),
    saved
  );
  assert.equal(values.get(LEGACY_KEY), bytes);
  assert.equal(values.has(STORAGE_KEY), false);
  assert.equal(readBackup(JSON.stringify([tv])).invalid, 1);
});

test('merge counts duplicates, remakes, same-number series, normalized manual titles and field conflicts', async () => {
  const incomingManual = { ...manual, id: 'alias', title: ' ＮＥＯＮ  ', rating: 2.5 };
  const existing = [{ ...manual, id: 'local', title: 'Neon' }, movie];
  values.set(STORAGE_KEY, raw(existing));
  const other = { ...movie, tmdbId: 71, id: 'remake' };
  const p = review(report([incomingManual, tv, { ...movie, id: 'different' }, other]));
  assert.deepEqual([p.plan.added, p.plan.duplicates, p.plan.conflicts.length], [2, 1, 1]);
  const expected = [tv, other, ...existing];
  assert.deepEqual(mergedEntries(existing, p.plan, new Set()), expected);
  await applyImport(p, 'merge', new Set(['alias']));
  assert.deepEqual(JSON.parse(values.get(STORAGE_KEY)).entries, [
    tv,
    other,
    { ...incomingManual, id: 'local' },
    movie,
  ]);
  const reorder = {
    ...movie,
    metadata: Object.fromEntries(Object.entries(movie.metadata).reverse()),
  };
  assert.equal(planImport([movie], [reorder]).duplicates, 1);
});

test('ambiguous cross-links and reused local IDs cannot replace unrelated catalog records', () => {
  for (const entries of [[{ ...tv, id: movie.id }], [{ ...movie, tmdbId: 400 }]]) {
    const plan = planImport([movie, tv], entries);
    assert.ok(plan.conflicts[0].ambiguous);
    assert.deepEqual(mergedEntries([movie, tv], plan, new Set()), [movie, tv]);
    assert.throws(() => mergedEntries([movie, tv], plan, new Set([movie.id])));
  }
  const one = { ...manual, title: 'Old title' };
  const plan = planImport([one], [{ ...one, title: 'New title' }]);
  assert.equal(plan.conflicts.length, 1);
  assert.equal(mergedEntries([one], plan, new Set([one.id]))[0].title, 'New title');
});

test('invalid structures, counts, dates, unsafe nested fields, oversize files or repeated identities leave the original bytes intact', async () => {
  const original = raw(saved);
  values.set(STORAGE_KEY, original);
  for (const bad of [
    'broken',
    '{}',
    'false',
    JSON.stringify({ version: 7, entries: [] }),
    JSON.stringify({ ...makeBackup([]), entryCount: 1 }),
    JSON.stringify({ ...makeBackup([]), exportedAt: '2024-02-30' }),
    JSON.stringify({ ...makeBackup([]), application: 'Other' }),
    JSON.stringify({ ...makeBackup([]), backupVersion: 2 }),
    ' '.repeat(MAX_BYTES + 1),
  ])
    assert.throws(() => readBackup(bad));
  let nested = 'leaf';
  for (let i = 0; i < 16; i++) nested = { deeper: nested };
  for (const patch of [
    { id: '' },
    { id: 5 },
    { title: ' ' },
    { rating: 1.25 },
    { rating: 11 },
    { mediaType: 'film' },
    { tmdbId: 0 },
    { added: '2024-02-30' },
    { added: 'yesterday' },
    { title: 'x'.repeat(65537) },
    { optional: nested },
    { metadata: { releaseDate: '2023-02-29' } },
    { metadata: { genres: [{ id: 'x' }] } },
    { metadata: { genres: 'drama' } },
    { metadata: { originalLanguage: 42 } },
    { metadata: { posterPath: 'https://example.org/a.jpg' } },
    { metadata: ['Drama'] },
    { metadata: { overview: 4 } },
    { metadata: { backdropPath: '/bad/dir.jpg' } },
    { metadata: { API_KEY: 'sample' } },
    { optional: JSON.parse('{"__proto__":{"sample":true}}') },
  ]) {
    const p = review(report([tv, { ...manual, ...patch }]));
    assert.equal(p.report.invalid, 1);
    await assert.rejects(() => applyImport(p, 'merge'), /validation/);
    assert.equal(values.get(STORAGE_KEY), original);
  }
  for (const duplicate of [
    { ...movie, id: tv.id },
    { ...movie, id: 'another' },
  ])
    assert.equal(report([movie, tv, duplicate]).invalid, 1);
  assert.equal(values.has(HISTORY_KEY), false);
});

test('empty and large archives can round trip, preview and restore with an explicit recovery copy', async () => {
  assert.throws(() => inspectEntries(new Array(50001)), /50,000/);
  const many = Array.from({ length: 6000 }, (_, i) => simple(i));
  assert.deepEqual(readBackup(backupText(many)).entries, many);
  values.set(STORAGE_KEY, raw(many));
  const p = review(report([]));
  assert.equal(await applyImport(p, 'merge'), false);
  await assert.rejects(() => applyImport(p, 'restore'), /recovery JSON/);
  const pCopy = await exportCurrent(() => {}, p.base, true);
  await applyImport(p, 'restore', new Set(), pCopy.receipt);
  assert.deepEqual(JSON.parse(values.get(STORAGE_KEY)).entries, []);
  assert.equal(checkpoints()[0].entries.length, 6000);
  const back = review(recoveryReport(checkpoints()[0]));
  const backCopy = await exportCurrent(() => {}, back.base, true);
  await applyImport(back, 'restore', new Set(), backCopy.receipt);
  assert.deepEqual(JSON.parse(values.get(STORAGE_KEY)).entries, many);
  assert.deepEqual(checkpoints()[0].entries, []);
});

test('spreadsheet output has UTF-8 BOM, CRLF, quoted cells, Unicode, embedded newlines and neutralized formulas', () => {
  const title = ' ＋5, "雨"\nline';
  const csv = csvText([
    { ...movie, title, metadata: { ...movie.metadata, genres: [{ id: 1, name: '=1+1' }] } },
  ]);
  assert.ok(csv.startsWith('\uFEFF"Title"'));
  assert.ok(csv.endsWith('\r\n'));
  assert.ok(csv.includes('"\' ＋5, ""雨""\nline"'));
  assert.ok(csv.includes('"\'=1+1"'));
  for (const input of ['=2+2', '@SUM(1)', ' +1', '\tA', '\rA', '-4'])
    assert.ok(csvText([{ ...manual, title: input }]).includes('"\'' + input + '"'));
  assert.equal(csvText([]).split('\r\n').length, 2);
});

test('quota errors protect the primary, retain earlier snapshots, and prune history only as necessary', async () => {
  for (let i = 0; i < 4; i++) await applyImport(review(report([simple(i)])), 'merge');
  assert.equal(checkpoints().length, 3);
  const before = values.get(STORAGE_KEY),
    history = values.get(HISTORY_KEY);
  const p = review(report([simple(10)]));
  deny = (k) => k === STORAGE_KEY;
  await assert.rejects(() => applyImport(p, 'merge'), /intact/);
  assert.equal(values.get(STORAGE_KEY), before);
  assert.equal(values.get(HISTORY_KEY), history);
  deny = (k) => k === HISTORY_KEY;
  await assert.rejects(() => applyImport(p, 'merge'), /snapshot/);
  assert.equal(values.get(STORAGE_KEY), before);
  deny = (k, v) => k === HISTORY_KEY && JSON.parse(v).copies.length > 1;
  await applyImport(p, 'merge');
  assert.equal(checkpoints().length, 1);
  assert.deepEqual(checkpoints()[0].entries, JSON.parse(before).entries);
});

test('stale previews, cancellation and missing locks cannot mutate the archive', async () => {
  const original = raw(saved);
  values.set(STORAGE_KEY, original);
  const p = review(report([simple(8)]));
  const stop = new AbortController();
  stop.abort();
  await assert.rejects(() => applyImport(p, 'merge', new Set(), null, stop.signal));
  assert.equal(values.get(STORAGE_KEY), original);
  assert.equal(values.has(HISTORY_KEY), false);
  await changeMovie({ title: 'Intervening save', mediaType: 'tv', rating: 8 });
  const newer = values.get(STORAGE_KEY);
  await assert.rejects(() => applyImport(p, 'merge'), /changed/);
  await assert.rejects(
    () => exportCurrent(() => assert.fail('stale download'), p.base, true),
    /changed/
  );
  assert.equal(values.get(STORAGE_KEY), newer);
  assert.ok(requests.every((k) => k === STORAGE_KEY));
  Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
  assert.throws(() => applyImport(review(report([])), 'restore'), /Web Locks/);
});

test('only generated JSON records a backup date, repeated no-op edits do not trigger reminders', async () => {
  for (let i = 0; i < 5; i++)
    await changeMovie({ title: 'Changed ' + i, mediaType: 'movie', rating: 8 });
  assert.ok(reminderDue(backupStatus()));
  const id = JSON.parse(values.get(STORAGE_KEY)).entries[0].id;
  await changeMovie({ action: 'edit', id, title: 'Changed 4', rating: 8 });
  assert.equal(backupStatus().changes, 5);
  dismissReminder();
  assert.equal(reminderDue(backupStatus()), false);
  csvText(saved);
  await assert.rejects(() =>
    exportCurrent(() => {
      throw new Error('Download unavailable');
    })
  );
  await exportCurrent(() => {}, undefined, true);
  assert.equal(backupStatus().exportedAt, null);
  deny = (k) => k === STATUS_KEY;
  assert.equal((await exportCurrent(() => {})).recorded, false);
  deny = () => false;
  await exportCurrent(() => {});
  assert.ok(Date.parse(backupStatus().exportedAt));
  assert.equal(backupStatus().changes, 0);
});

test('export captures the clicked archive and counts a concurrent edit while its receipt is waiting', async () => {
  values.set(STORAGE_KEY, raw([movie]));
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: async (_key, _options, work) => {
        await gate;
        return work();
      },
    },
  });
  let file;
  const exportDone = exportCurrent((data) => {
    file = readBackup(data).entries;
  });
  assert.deepEqual(file, [movie]);
  values.set(STORAGE_KEY, raw([{ ...movie, rating: 10 }]));
  release();
  assert.ok((await exportDone).recorded);
  assert.equal(backupStatus().changes, 1);
});

test('a mixed or damaged primary cannot be replaced, and its readable subset is labelled on export', async () => {
  const original = raw([movie, { rating: 0 }]);
  values.set(STORAGE_KEY, original);
  const p = review(report([manual]));
  assert.match(p.notice, /protected/);
  await assert.rejects(() => applyImport(p, 'merge'), /protected/);
  const result = await exportCurrent((data, _at, partial) => {
    assert.ok(partial);
    assert.deepEqual(readBackup(data).entries, [movie]);
  });
  assert.ok(result.sessionOnly && !result.recorded);
  assert.equal(values.get(STORAGE_KEY), original);
  assert.equal(values.has(HISTORY_KEY), false);
});
