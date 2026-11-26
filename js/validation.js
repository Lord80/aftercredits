export const cleanTitle = (title) => title.normalize('NFKC').trim().replace(/\s+/gu, ' ');
export const titleKey = (title) => cleanTitle(title).toLowerCase();
export const validRating = (n) =>
  Number.isFinite(n) && n >= 1 && n <= 10 && Number.isInteger(n * 2);
export const validType = (type) => type === 'movie' || type === 'tv';

const positiveId = (id) => Number.isSafeInteger(id) && id > 0;
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const identity = (entry) =>
  entry.mediaType +
  ':' +
  (entry.tmdbId === null ? 'manual:' + titleKey(entry.title) : entry.tmdbId);

// Preserve the existing reader's compatibility with previously saved records.
export function validEntry(entry) {
  return (
    entry &&
    typeof entry.id === 'string' &&
    entry.id &&
    typeof entry.title === 'string' &&
    cleanTitle(entry.title) &&
    validType(entry.mediaType) &&
    validRating(entry.rating) &&
    (entry.tmdbId === null || positiveId(entry.tmdbId)) &&
    typeof entry.added === 'string' &&
    Number.isFinite(Date.parse(entry.added))
  );
}

export const legacyEntry = (entry) => ({
  ...entry,
  mediaType: 'movie',
  tmdbId: null,
  metadata: null,
});
export const MAX_BYTES = 16 * 1024 * 1024;
export const MAX_ENTRIES = 50000;
const maxText = 262144;
const text = (v, max) => typeof v === 'string' && v.length <= max;
const unsafeKey =
  /^(?:__proto__|prototype|constructor)$|password|secret|token|credential|authorization|apikey/i;
function check(condition, message) {
  if (!condition) throw new Error(message);
}

// Unknown, bounded JSON fields can travel with a print. Never merge them into app objects.
function validateTree(value, depth = 0) {
  check(depth <= 12, 'Optional data is nested too deeply.');
  if (typeof value === 'string') {
    check(text(value, maxText), 'A text field is too long.');
  } else if (Array.isArray(value)) {
    check(value.length <= 2048, 'An optional list is too large.');
    value.forEach((v) => validateTree(v, depth + 1));
  } else if (object(value)) {
    const keys = Object.keys(value);
    check(keys.length <= 128, 'A record contains too many fields.');
    for (const key of keys) {
      check(
        key.length > 0 &&
          key.length <= 128 &&
          !unsafeKey.test(key.replace(/[-_\s]/g, '')) &&
          !['__proto__', 'prototype', 'constructor'].includes(key),
        'An unsafe or credential field is present.'
      );
      validateTree(value[key], depth + 1);
    }
  } else {
    check(
      value === null || typeof value === 'boolean' || Number.isFinite(value),
      'Invalid JSON value.'
    );
  }
}

export function validDate(value, dayOnly = false) {
  if (typeof value !== 'string') return false;
  const match =
    /^(\d{4}-\d{2}-\d{2})(?:T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d))?$/.exec(
      value
    );
  if (!match || (dayOnly && value !== match[1]) || !Number.isFinite(Date.parse(value)))
    return false;
  const day = new Date(match[1] + 'T00:00:00Z');
  return Number.isFinite(+day) && day.toISOString().slice(0, 10) === match[1];
}

function validateMetadata(meta) {
  if (meta === null || meta === undefined) return;
  check(object(meta), 'Metadata must be an object or null.');
  for (const k of ['title', 'originalTitle', 'overview']) {
    if (k in meta)
      check(text(meta[k], k === 'overview' ? maxText : 65536), 'Invalid metadata ' + k + '.');
  }
  if ('releaseDate' in meta)
    check(meta.releaseDate === '' || validDate(meta.releaseDate, true), 'Invalid release date.');
  if ('originalLanguage' in meta)
    check(
      text(meta.originalLanguage, 3) && /^(?:[a-z]{2,3})?$/i.test(meta.originalLanguage),
      'Invalid language code.'
    );
  for (const k of ['posterPath', 'backdropPath']) {
    if (k in meta && meta[k] !== null)
      check(
        text(meta[k], 512) && /^\/[\w.-]+\.(?:jpg|png|webp)$/i.test(meta[k]),
        'Invalid artwork path.'
      );
  }
  if ('genres' in meta) {
    check(Array.isArray(meta.genres) && meta.genres.length <= 128, 'Invalid genre list.');
    for (const genre of meta.genres)
      check(
        object(genre) && positiveId(genre.id) && (!('name' in genre) || text(genre.name, 512)),
        'Invalid genre.'
      );
  }
}

export function inspectEntries(entries, legacy = false) {
  check(Array.isArray(entries), 'The backup must contain an entries list.');
  check(entries.length <= MAX_ENTRIES, 'The file exceeds the 50,000-entry limit.');
  const result = {
    entries: [],
    total: entries.length,
    movies: 0,
    series: 0,
    invalid: 0,
    errors: [],
  };
  const ids = new Set(),
    identities = new Set();
  for (const [index, source] of entries.entries()) {
    const entry = legacy ? legacyEntry(source) : source;
    if (entry?.mediaType === 'movie') result.movies++;
    if (entry?.mediaType === 'tv') result.series++;
    try {
      check(object(source), 'Expected a title record.');
      if (legacy)
        check(
          !['mediaType', 'tmdbId', 'metadata'].some((k) => k in source),
          'This record is not a v1 entry.'
        );
      validateTree(entry);
      check(
        text(entry.id, 512) && entry.id.trim() && !/[\u0000-\u001f\u007f]/u.test(entry.id),
        'Invalid local ID.'
      );
      check(text(entry.title, 65536) && cleanTitle(entry.title), 'Invalid display title.');
      check(validType(entry.mediaType), 'Invalid media type.');
      check(entry.tmdbId === null || positiveId(entry.tmdbId), 'Invalid TMDB ID.');
      check(validRating(entry.rating), 'Expected a rating from 1 to 10 in half steps.');
      check(validDate(entry.added), 'Invalid date added.');
      validateMetadata(entry.metadata);
      const key = identity(entry);
      check(
        !ids.has(entry.id) && !identities.has(key),
        'Repeated local ID or title identity within the file.'
      );
      ids.add(entry.id);
      identities.add(key);
      result.entries.push(entry);
    } catch (error) {
      result.invalid++;
      if (result.errors.length < 5)
        result.errors.push('Entry ' + (index + 1) + ' · ' + error.message);
    }
  }
  return result;
}

export function requireEntries(entries) {
  const result = inspectEntries(entries);
  check(!result.invalid, result.errors[0]);
  return result.entries;
}

export function equal(a, b) {
  if (a === b) return true;
  if (
    !a ||
    !b ||
    typeof a !== 'object' ||
    typeof b !== 'object' ||
    Array.isArray(a) !== Array.isArray(b)
  )
    return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && equal(a[key], b[key]))
  );
}
