import { defaults, missingLabels, sorts } from './discovery.js';
import { keyFor, assertScope } from './cloud/scope.js';
import { validDate, validRating } from './validation.js';

export const preferenceKey = keyFor('aftercredits.discovery.v1');
export const layouts = ['screening', 'gallery', 'compact'];
const options = (values) =>
  Array.isArray(values)
    ? [...new Set(values.filter((v) => typeof v === 'string' && v.length <= 40))].slice(0, 512)
    : [];
export function readQuery(raw = {}) {
  const result = defaults();
  if (!raw || typeof raw !== 'object') return result;
  result.query = typeof raw.query === 'string' ? raw.query.slice(0, 300) : '';
  if (sorts.some(([key]) => key === raw.sort)) result.sort = raw.sort;
  result.genres = options(raw.genres).filter((v) => /^(?:[1-9]\d*|unknown)$/.test(v));
  result.languages = options(raw.languages).filter((v) => /^(?:[a-z]{2,3}|unknown)$/.test(v));
  if (['manual', 'catalog'].includes(raw.source)) result.source = raw.source;
  if (Object.hasOwn(missingLabels, raw.missing)) result.missing = raw.missing;
  for (const edge of ['From', 'To']) {
    if (/^\d{4}$/.test(raw['year' + edge])) result['year' + edge] = String(raw['year' + edge]);
    if (validRating(raw['rating' + edge])) result['rating' + edge] = raw['rating' + edge];
    if (validDate(raw['added' + edge], true)) result['added' + edge] = raw['added' + edge];
  }
  for (const k of ['year', 'rating', 'added'])
    if (result[k + 'From'] && result[k + 'To'] && result[k + 'From'] > result[k + 'To'])
      result[k + 'From'] = result[k + 'To'] = '';
  return result;
}
export function loadPreferences() {
  let raw;
  try {
    raw = JSON.parse(localStorage.getItem(preferenceKey));
  } catch {}
  if (raw?.version !== 1) raw = {};
  const frames = {};
  for (const type of ['movie', 'tv'])
    if (typeof raw.frames?.[type] === 'string' && raw.frames[type].length <= 512)
      frames[type] = raw.frames[type];
  return {
    version: 1,
    frames,
    layout: layouts.includes(raw.layout) ? raw.layout : 'screening',
    movie: readQuery(raw.movie),
    tv: readQuery(raw.tv),
  };
}
export function persistPreferences(prefs) {
  try {
    assertScope();
    localStorage.setItem(preferenceKey, JSON.stringify(prefs));
  } catch {
    /* Browsing also works with tab-only preferences. */
  }
}
