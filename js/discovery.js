import { validDate } from './validation.js';

// All inputs are local archive records. Index immutable entry snapshots once per lifetime.
const index = new WeakMap();
const alphabet = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
const languageNames = Intl.DisplayNames && new Intl.DisplayNames(['en'], { type: 'language' });
export const unknown = 'unknown';
export const defaults = () => ({
  query: '',
  sort: 'auto',
  genres: [],
  languages: [],
  yearFrom: '',
  yearTo: '',
  ratingFrom: '',
  ratingTo: '',
  addedFrom: '',
  addedTo: '',
  source: '',
  missing: '',
});
export const sorts = [
  ['auto', 'Automatic'],
  ['relevance', 'Relevance'],
  ['recent', 'Recently added'],
  ['oldest', 'Earliest added'],
  ['release', 'Newest release'],
  ['earlyRelease', 'Oldest release'],
  ['highest', 'Highest rating'],
  ['lowest', 'Lowest rating'],
  ['alpha', 'Title A–Z'],
  ['reverseAlpha', 'Title Z–A'],
];
export const missingLabels = {
  any: 'Any missing detail',
  none: 'Complete details',
  record: 'No metadata',
  genre: 'No genre',
  language: 'No language',
  release: 'No release date',
  poster: 'No poster',
  backdrop: 'No backdrop',
  overview: 'No description',
};
export function languageLabel(code) {
  if (code === unknown) return 'Unknown language';
  try {
    return languageNames?.of(code) || code;
  } catch {
    return code;
  }
}
const text = (value) => (typeof value === 'string' ? value : '');
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
export function fold(value) {
  return text(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/ß/gu, 'ss')
    .replace(/ς/gu, 'σ')
    .normalize('NFD')
    .replace(/(\p{Script=Latin})\p{M}+/gu, '$1')
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
    .trim();
}
function dateStamp(value) {
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : null;
}
function indexed(entry) {
  if (index.has(entry)) return index.get(entry);
  const meta = entry.metadata;
  const genres = new Map();
  for (const genre of Array.isArray(meta?.genres) ? meta.genres : []) {
    if (Number.isSafeInteger(genre?.id)) genres.set(String(genre.id), text(genre.name).trim());
  }
  const language = text(meta?.originalLanguage).toLowerCase() || unknown;
  const release = validDate(meta?.releaseDate, true) ? meta.releaseDate : '';
  const added = dateStamp(entry.added);
  const missing = [];
  if (!meta) missing.push('record');
  if (!genres.size) missing.push('genre');
  if (language === unknown) missing.push('language');
  if (!release) missing.push('release');
  if (!meta?.posterPath) missing.push('poster');
  if (!meta?.backdropPath) missing.push('backdrop');
  if (!text(meta?.overview).trim()) missing.push('overview');
  const titles = [
    ...new Set([entry.title, meta?.title, meta?.originalTitle].map(fold).filter(Boolean)),
  ];
  const row = {
    entry,
    genres,
    language,
    release,
    year: release.slice(0, 4),
    missing,
    titles,
    added,
    addedDay: added === null ? '' : new Date(added).toISOString().slice(0, 10),
  };
  index.set(entry, row);
  return row;
}
export function indexCollection(entries) {
  const groups = { movie: [], tv: [] };
  for (const entry of entries) groups[entry.mediaType]?.push(indexed(entry));
  return groups;
}
function count(map, key, label) {
  const item = map.get(key);
  if (!item) map.set(key, { key, label, count: 1 });
  else {
    item.count++;
    if (label && (!item.label || compare(label, item.label) < 0)) item.label = label;
  }
}
export function facets(rows) {
  const genres = new Map(),
    languages = new Map(),
    decades = new Map(),
    sources = new Map(),
    missing = new Map();
  for (const r of rows) {
    if (r.genres.size) for (const [id, name] of r.genres) count(genres, id, name);
    else count(genres, unknown, 'Unknown genre');
    count(languages, r.language, languageLabel(r.language));
    if (r.year) {
      const d = String(Math.floor(Number(r.year) / 10) * 10);
      count(decades, d, d + 's');
    }
    const source = r.entry.tmdbId === null ? 'manual' : 'catalog';
    count(sources, source, source === 'manual' ? 'Manual' : 'Catalog');
    for (const key of r.missing.length ? ['any', ...r.missing] : ['none'])
      count(missing, key, missingLabels[key]);
  }
  function options(map) {
    return [...map.values()]
      .map((v) => ({ ...v, label: v.label || 'Genre ' + v.key }))
      .sort(
        (a, b) =>
          (a.key === unknown) - (b.key === unknown) ||
          alphabet.compare(a.label, b.label) ||
          compare(a.key, b.key)
      );
  }
  return {
    genres: options(genres),
    languages: options(languages),
    sources: options(sources),
    missing: options(missing),
    decades: [...decades.values()].sort((a, b) => Number(b.key) - Number(a.key)),
  };
}
function score(titles, phrase, tokens) {
  if (!tokens.every((token) => titles.some((title) => title.includes(token)))) return -1;
  let best = 0;
  for (const [i, title] of titles.entries()) {
    const phraseScore =
      title === phrase
        ? 10000
        : title.startsWith(phrase)
          ? 5000
          : title.includes(phrase)
            ? 2500
            : 0;
    const tokenScore = tokens.reduce(
      (sum, t) =>
        sum + (title.startsWith(t) || title.includes(' ' + t) ? 10 : title.includes(t) ? 3 : 0),
      0
    );
    best = Math.max(best, phraseScore + tokenScore + (i === 0 ? 1 : 0));
  }
  return best;
}
function inRange(value, min, max) {
  return (
    (!min && !max) ||
    (value !== null && value !== '' && (!min || value >= min) && (!max || value <= max))
  );
}
export function runQuery(rows, state) {
  const phrase = fold(state.query),
    tokens = [...new Set(phrase.split(' ').filter(Boolean))];
  const sort = state.sort === 'auto' ? (phrase ? 'relevance' : 'recent') : state.sort;
  const ranks = new Map();
  const selected = rows.filter((r) => {
    if (
      state.genres.length &&
      !state.genres.some((g) => (g === unknown ? !r.genres.size : r.genres.has(g)))
    )
      return false;
    if (state.languages.length && !state.languages.includes(r.language)) return false;
    if (state.source && (r.entry.tmdbId === null) !== (state.source === 'manual')) return false;
    if (
      state.missing &&
      !(state.missing === 'none'
        ? !r.missing.length
        : state.missing === 'any'
          ? r.missing.length
          : r.missing.includes(state.missing))
    )
      return false;
    if (
      !inRange(r.year, state.yearFrom, state.yearTo) ||
      !inRange(r.entry.rating, state.ratingFrom, state.ratingTo) ||
      !inRange(r.addedDay, state.addedFrom, state.addedTo)
    )
      return false;
    if (tokens.length) {
      const rank = score(r.titles, phrase, tokens);
      if (rank < 0) return false;
      ranks.set(r, rank);
    }
    return true;
  });
  return selected
    .sort((a, b) => {
      let primary = 0;
      if (sort === 'alpha' || sort === 'reverseAlpha')
        primary = alphabet.compare(a.entry.title, b.entry.title) * (sort === 'alpha' ? 1 : -1);
      else if (sort === 'highest' || sort === 'lowest')
        primary = (a.entry.rating - b.entry.rating) * (sort === 'highest' ? -1 : 1);
      else if (sort === 'release' || sort === 'earlyRelease')
        primary =
          Number(!a.release) - Number(!b.release) ||
          compare(a.release, b.release) * (sort === 'release' ? -1 : 1);
      else if (sort === 'oldest')
        primary = Number(a.added === null) - Number(b.added === null) || compare(a.added, b.added);
      else if (sort === 'relevance' && tokens.length) primary = ranks.get(b) - ranks.get(a);
      return (
        primary ||
        Number(a.added === null) - Number(b.added === null) ||
        compare(b.added, a.added) ||
        alphabet.compare(a.entry.title, b.entry.title) ||
        compare(a.entry.id, b.entry.id)
      );
    })
    .map((r) => r.entry);
}

// Compatibility for callers of the original mixed-media selection API.
export function selectMovies(entries, query, sort) {
  return runQuery(entries.map(indexed), { ...defaults(), query, sort });
}
