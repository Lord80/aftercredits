export const STORAGE_KEY = 'aftercredits.collection.v2';
export const LEGACY_KEY = 'aftercredits.collection.v1';
export const cleanTitle = (title) => title.normalize('NFKC').trim().replace(/\s+/gu, ' ');
export const titleKey = (title) => cleanTitle(title).toLowerCase();
export const validRating = (n) =>
  Number.isFinite(n) && n >= 1 && n <= 10 && Number.isInteger(n * 2);
export const validType = (type) => type === 'movie' || type === 'tv';

const temporary = 'Browser storage is unavailable. Changes will last for this tab session.';
let memoryOnly = false;
let items = [];
let notice = '';

function validEntry(entry) {
  return (
    entry &&
    typeof entry.id === 'string' &&
    entry.id &&
    typeof entry.title === 'string' &&
    cleanTitle(entry.title) &&
    validType(entry.mediaType) &&
    validRating(entry.rating) &&
    (entry.tmdbId === null || (Number.isSafeInteger(entry.tmdbId) && entry.tmdbId > 0)) &&
    typeof entry.added === 'string' &&
    Number.isFinite(Date.parse(entry.added))
  );
}

function read() {
  if (memoryOnly) return;
  let raw, legacy;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) legacy = localStorage.getItem(LEGACY_KEY);
  } catch {
    memoryOnly = true;
    notice = temporary;
    return;
  }
  notice = '';
  try {
    let entries;
    if (raw === null) {
      const old = legacy === null ? [] : JSON.parse(legacy);
      if (!Array.isArray(old)) throw new Error();
      entries = old.map((entry) => ({
        ...entry,
        mediaType: 'movie',
        tmdbId: null,
        metadata: null,
      }));
    } else {
      const data = JSON.parse(raw);
      if (data?.version !== 2 || !Array.isArray(data.entries)) throw new Error();
      entries = data.entries;
    }
    items = entries.filter(validEntry);
    if (items.length !== entries.length) {
      notice =
        'Some records need recovery. Your stored archive is protected. Changes will last for this tab session.';
      memoryOnly = true;
    }
    return raw === null && legacy !== null;
  } catch {
    notice =
      'The saved archive could not be read. Its data is protected. Changes will last for this tab session.';
    memoryOnly = true;
    items = [];
  }
}

function write(next) {
  items = next;
  if (!memoryOnly) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, entries: next }));
    } catch {
      memoryOnly = true;
      notice = temporary;
    }
  }
}

const withLock = (task) =>
  navigator.locks ? navigator.locks.request(STORAGE_KEY, async () => task()) : task();

export function initialize() {
  return withLock(() => {
    if (read() && !memoryOnly) write(items);
  });
}

export function snapshot() {
  read();
  return { items, notice };
}

export function changeMovie({ action, id, title, rating, mediaType, match }) {
  return withLock(() => {
    read();
    const existing = items.find((entry) => entry.id === id);
    if (id && !existing) throw new Error('This entry has already been removed.');
    if (action === 'delete') {
      write(items.filter((entry) => entry.id !== id));
      return;
    }
    const cleaned = cleanTitle(title);
    if (!cleaned) throw new Error('Enter a title.');
    if (!validRating(rating)) throw new Error('Choose a rating from 1 to 10 in half-point steps.');
    const type = existing?.mediaType ?? mediaType;
    const tmdbId = existing ? existing.tmdbId : (match?.tmdbId ?? null);
    if (
      !validType(type) ||
      (match && (match.mediaType !== type || !Number.isSafeInteger(tmdbId) || tmdbId < 1))
    ) {
      throw new Error('Select a valid movie or TV series.');
    }
    const duplicate = items.some(
      (entry) =>
        entry.id !== id &&
        entry.mediaType === type &&
        (tmdbId !== null
          ? entry.tmdbId === tmdbId
          : entry.tmdbId === null && titleKey(entry.title) === titleKey(cleaned))
    );
    if (duplicate) throw new Error('This title is already in this collection.');
    if (existing) {
      write(items.map((entry) => (entry.id === id ? { ...entry, title: cleaned, rating } : entry)));
    } else {
      const newId =
        globalThis.crypto?.randomUUID?.() ??
        Date.now().toString(36) + Math.random().toString(36).slice(2);
      write([
        {
          id: newId,
          mediaType: type,
          tmdbId,
          metadata: match?.metadata ?? null,
          title: cleaned,
          rating,
          added: new Date().toISOString(),
        },
        ...items,
      ]);
      return newId;
    }
  });
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
export function selectMovies(movies, query, order) {
  const key = titleKey(query);
  const result = movies.filter((movie) => titleKey(movie.title).includes(key));
  return result.sort((a, b) => {
    if (order === 'alpha') return collator.compare(a.title, b.title);
    if (order === 'highest' && a.rating !== b.rating) return b.rating - a.rating;
    if (order === 'lowest' && a.rating !== b.rating) return a.rating - b.rating;
    return Date.parse(b.added) - Date.parse(a.added);
  });
}
