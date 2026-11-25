import { inspectEntries, MAX_BYTES, requireEntries, validDate } from './validation.js';

export function makeBackup(entries, exportedAt = new Date().toISOString()) {
  requireEntries(entries);
  return {
    application: 'AFTERCREDITS',
    backupVersion: 1,
    exportedAt,
    entryCount: entries.length,
    collection: { version: 2, entries },
  };
}

export function backupText(entries, at) {
  const data = makeBackup(entries, at);
  const formatted = JSON.stringify(data, null, 2);
  if (new Blob([formatted]).size <= MAX_BYTES) return formatted;
  const compact = JSON.stringify(data);
  if (new Blob([compact]).size > MAX_BYTES)
    throw new Error('This archive exceeds the portable backup size limit.');
  return compact;
}

export function readBackup(input) {
  if (new Blob([input]).size > MAX_BYTES) throw new Error('Choose a JSON file of 16 MiB or less.');
  let data;
  try {
    data = JSON.parse(input.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('This file does not contain readable JSON.');
  }
  if (Array.isArray(data)) return inspectEntries(data, true);
  if (!data || typeof data !== 'object') throw new Error('Unrecognized backup format.');
  if ('application' in data || 'backupVersion' in data || 'collection' in data) {
    if (
      data.application !== 'AFTERCREDITS' ||
      data.backupVersion !== 1 ||
      data.collection?.version !== 2
    )
      throw new Error('Unsupported application or backup version.');
    if (
      !validDate(data.exportedAt) ||
      !Number.isSafeInteger(data.entryCount) ||
      !Array.isArray(data.collection.entries) ||
      data.entryCount !== data.collection.entries.length
    )
      throw new Error('The export date or declared entry count is invalid.');
    return inspectEntries(data.collection.entries);
  }
  if (data.version === 2 || data.version === 1)
    return inspectEntries(data.entries, data.version === 1);
  throw new Error('Unsupported collection version.');
}

function cell(value) {
  let string = String(value ?? '');
  // Quote every field. Neutralize formula prefixes even behind Unicode whitespace.
  if (/^[\t\r\n]|^[\s\u0000-\u001f\uFEFF]*[=+@\-＝＋＠－]/u.test(string)) string = "'" + string;
  return '"' + string.replaceAll('"', '""') + '"';
}

export function csvText(entries) {
  const rows = [
    [
      'Title',
      'Media type',
      'Personal rating',
      'TMDB ID',
      'Release year',
      'Release or first-air date',
      'Genres',
      'Original language',
      'Date added',
    ],
  ];
  for (const item of entries) {
    const meta = item.metadata ?? {};
    rows.push([
      item.title,
      item.mediaType,
      item.rating,
      item.tmdbId,
      meta.releaseDate?.slice(0, 4),
      meta.releaseDate,
      meta.genres?.map((g) => g.name || String(g.id)).join(' | '),
      meta.originalLanguage,
      item.added,
    ]);
  }
  return '\uFEFF' + rows.map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n';
}

export function fileName(kind, at, extension) {
  return 'aftercredits-' + kind + '-' + at.replace(/:/g, '-') + '.' + extension;
}
