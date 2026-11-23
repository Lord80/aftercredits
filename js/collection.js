// A film's ID and added date are stable across title and rating edits.
export const STORAGE_KEY = 'aftercredits.collection.v1';
export const cleanTitle = (title) => title.normalize('NFKC').trim().replace(/\s+/gu, ' ');
export const titleKey = (title) => cleanTitle(title).toLowerCase();
export const validRating = (value) =>
  Number.isFinite(value) && value >= 1 && value <= 10 && Number.isInteger(value * 2);

const temporary = 'Browser storage is unavailable. Changes will last for this tab session.';
let memoryOnly = false;
let items = [];
let notice = '';

function read() {
  if (memoryOnly) return;
  let raw;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    memoryOnly = true;
    notice = temporary;
    return;
  }
  let records;
  try {
    records = raw === null ? [] : JSON.parse(raw);
    if (!Array.isArray(records)) throw new TypeError();
  } catch {
    items = [];
    notice = 'The saved archive could not be read. Adding a movie will start a new archive.';
    return;
  }
  const titles = new Set();
  const ids = new Set();
  items = records
    .filter((film) => {
      if (
        !film ||
        typeof film.title !== 'string' ||
        !cleanTitle(film.title) ||
        typeof film.id !== 'string' ||
        !film.id ||
        !validRating(film.rating) ||
        typeof film.added !== 'string' ||
        !Number.isFinite(Date.parse(film.added))
      )
        return false;
      const key = titleKey(film.title);
      if (ids.has(film.id) || titles.has(key)) return false;
      ids.add(film.id);
      titles.add(key);
      return true;
    })
    .map((film) => ({ ...film, title: cleanTitle(film.title) }));
  notice =
    items.length === records.length
      ? ''
      : 'Some saved entries could not be read. Your valid films are available below.';
}

function write(next) {
  items = next;
  if (memoryOnly) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    notice = '';
  } catch {
    memoryOnly = true;
    notice = temporary;
  }
}

export function snapshot() {
  read();
  return { items, notice };
}

export async function changeMovie({ action, id, title, rating }) {
  function apply() {
    read();
    const existing = items.find((film) => film.id === id);
    if (id && !existing) throw new Error('This film has already been removed from your archive.');
    if (action === 'delete') {
      write(items.filter((film) => film.id !== id));
      return;
    }
    const cleaned = cleanTitle(title);
    if (!cleaned) throw new Error('Enter a movie title.');
    if (!validRating(rating)) throw new Error('Choose a rating from 1 to 10 in half-point steps.');
    if (items.some((film) => film.id !== id && titleKey(film.title) === titleKey(cleaned))) {
      throw new Error('A movie with this title is already in your collection.');
    }
    if (existing) {
      write(items.map((film) => (film.id === id ? { ...film, title: cleaned, rating } : film)));
    } else {
      const newId =
        globalThis.crypto?.randomUUID?.() ??
        Date.now().toString(36) + Math.random().toString(36).slice(2);
      write([{ id: newId, title: cleaned, rating, added: new Date().toISOString() }, ...items]);
    }
  }
  if (navigator.locks) return navigator.locks.request(STORAGE_KEY, apply);
  return apply();
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
