import { equal, identity, requireEntries } from './validation.js';

export function planImport(current, incoming) {
  const byId = new Map(current.map((entry) => [entry.id, entry]));
  const byIdentity = new Map(current.map((entry) => [identity(entry), entry]));
  const claims = new Map();
  const rows = incoming.map((entry) => {
    const sameId = byId.get(entry.id),
      sameTitle = byIdentity.get(identity(entry));
    const matches = new Set([sameId, sameTitle].filter(Boolean));
    for (const target of matches) claims.set(target, 1 + (claims.get(target) ?? 0));
    // A stable manual ID can survive a rename. A reused ID must never splice unrelated catalog records.
    const renamedManual =
      sameId &&
      sameId.tmdbId === null &&
      entry.tmdbId === null &&
      sameId.mediaType === entry.mediaType;
    const reusedId = sameId && !sameTitle && !renamedManual;
    return { entry, matches, current: sameTitle ?? sameId, reusedId };
  });
  let added = 0,
    duplicates = 0;
  const conflicts = [];
  for (const row of rows) {
    if (!row.current) {
      added++;
      continue;
    }
    row.ambiguous =
      row.reusedId ||
      row.matches.size > 1 ||
      [...row.matches].some((target) => claims.get(target) > 1);
    const keys = new Set([...Object.keys(row.current), ...Object.keys(row.entry)]);
    row.differences = [...keys].filter((k) => k !== 'id' && !equal(row.entry[k], row.current[k]));
    if (!row.differences.length && !row.ambiguous) duplicates++;
    else conflicts.push(row);
  }
  return { rows, added, duplicates, conflicts };
}

export function mergedEntries(current, plan, accepted) {
  const replacements = new Map();
  for (const row of plan.conflicts) {
    if (accepted.has(row.entry.id)) {
      if (row.ambiguous)
        throw new Error('Linked identities overlap. Keep the local records for this merge.');
      replacements.set(row.current.id, { ...row.entry, id: row.current.id });
    }
  }
  const additions = plan.rows.filter((row) => !row.current).map((row) => row.entry);
  return requireEntries([...additions, ...current.map((e) => replacements.get(e.id) ?? e)]);
}
