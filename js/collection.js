import {
  cleanTitle,
  equal,
  titleKey,
  validRating,
  validType,
  validEntry,
  legacyEntry,
  identity,
} from './validation.js';
import { noteChanges } from './vault-status.js';
export { cleanTitle, titleKey, validRating, validType } from './validation.js';

import { owner, accountKey, assertScope } from './cloud/scope.js';
let accountStore;
export const STORAGE_KEY = owner ? accountKey(owner) : 'aftercredits.collection.v2';
export const LEGACY_KEY = 'aftercredits.collection.v1';
const temporary = 'Browser storage is unavailable. Changes will last for this tab session.';
let memoryOnly = false;
let items = [];
let notice = '';

function read() {
  if (owner) {
    try {
      items = accountStore.accountEntries();
      notice = '';
    } catch {
      items = [];
      notice = 'The account cache could not be read. Its stored data is protected.';
    }
    return;
  }
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
      entries = old.map(legacyEntry);
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

export function persistEntries(next) {
  assertScope();
  if (owner) accountStore.saveAccountEntries(next);
  else localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, entries: next }));
}
function write(next, changes = 0) {
  if (owner) {
    persistEntries(next);
    items = next;
    if (changes) noteChanges(changes);
    return;
  }
  items = next;
  if (!memoryOnly) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, entries: next }));
      if (changes) noteChanges(changes);
    } catch {
      memoryOnly = true;
      notice = temporary;
    }
  }
}

export const withLock = (task, options = {}) =>
  navigator.locks
    ? navigator.locks.request(STORAGE_KEY, options, async () => {
        assertScope();
        return task();
      })
    : owner
      ? Promise.reject(
          new Error(
            'Safe account writes require Web Locks. Open the HTTPS site in a current browser.'
          )
        )
      : task();

export async function initialize() {
  if (owner) accountStore = await import('./cloud/local.js');
  // Reading v2 is atomic. Only the legacy copy needs to coordinate with writers.
  if (read() && !memoryOnly) {
    await withLock(() => {
      if (read() && !memoryOnly) write(items);
    });
  }
  return { items, notice };
}

export function snapshot() {
  read();
  return { items, notice };
}

export function changeMovie({ action, id, title, rating, mediaType, match, originalEntry }) {
  return withLock(() => {
    read();
    const existing = items.find((entry) => entry.id === id);
    if (id && !existing) throw new Error('This entry has already been removed.');
    if (owner && existing && originalEntry && !equal(existing, originalEntry))
      throw new Error(
        'This title changed while it was open. Reopen it to review the latest version.'
      );
    if (action === 'delete') {
      write(
        items.filter((entry) => entry.id !== id),
        1
      );
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
    const key = identity({ mediaType: type, tmdbId, title: cleaned });
    const duplicate = items.some((entry) => entry.id !== id && identity(entry) === key);
    if (duplicate) throw new Error('This title is already in this collection.');
    if (existing) {
      if (existing.title !== cleaned || existing.rating !== rating)
        write(
          items.map((entry) => (entry.id === id ? { ...entry, title: cleaned, rating } : entry)),
          1
        );
    } else {
      const newId =
        globalThis.crypto?.randomUUID?.() ??
        Date.now().toString(36) + Math.random().toString(36).slice(2);
      write(
        [
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
        ],
        1
      );
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
