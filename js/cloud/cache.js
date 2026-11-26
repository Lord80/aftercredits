import { equal, identity, requireEntries } from '../validation.js';

export const blank = () => ({
  version: 1,
  cursor: 0,
  rows: [],
  pending: [],
  order: [],
  flight: null,
  incoming: null,
  lastSync: null,
});
const safeCursor = (value) => Number.isSafeInteger(value) && value >= 0;
const validId = (value) =>
  typeof value === 'string' &&
  value.trim() &&
  value.length <= 512 &&
  !/[\u0000-\u001f\u007f]/u.test(value);
function validateRows(rows, cursor) {
  if (!Array.isArray(rows)) return false;
  const ids = new Set(),
    revisions = new Set();
  for (const row of rows) {
    if (!validId(row?.id) || ids.has(row.id) || (row.entry !== null && row.entry?.id !== row.id))
      return false;
    ids.add(row.id);
    if (cursor !== undefined) {
      if (
        !safeCursor(row.revision) ||
        row.revision === 0 ||
        row.revision > cursor ||
        revisions.has(row.revision)
      )
        return false;
      revisions.add(row.revision);
    }
  }
  requireEntries(active(rows));
  return cursor === undefined || cursor === 0 || revisions.has(cursor);
}
function validSnapshot(value) {
  return value && safeCursor(value.cursor) && validateRows(value.rows, value.cursor);
}
export function validateCache(c) {
  if (
    !validSnapshot(c) ||
    c.version !== 1 ||
    !validateRows(c.pending) ||
    !Array.isArray(c.order) ||
    !c.order.every(validId) ||
    new Set(c.order).size !== c.order.length ||
    !(
      c.lastSync === null ||
      (typeof c.lastSync === 'string' && Number.isFinite(Date.parse(c.lastSync)))
    ) ||
    !(c.incoming === null || (validSnapshot(c.incoming) && c.incoming.cursor > c.cursor)) ||
    !(
      c.flight === null ||
      (!c.incoming &&
        /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(c.flight?.id) &&
        c.flight.expected === c.cursor &&
        c.flight.changes?.length &&
        validateRows(c.flight.changes))
    )
  ) {
    throw new Error('The account cache needs recovery. Its stored data is protected.');
  }
  requireEntries(working(c));
  return c;
}
let previousKey, previousRaw, previousCache;
export function cacheAt(key) {
  const raw = localStorage.getItem(key);
  if (raw === null) throw new Error('The account cache is missing. Reconnect through Data Vault.');
  if (previousKey === key && previousRaw === raw) return previousCache;
  const c = validateCache(JSON.parse(raw));
  previousKey = key;
  previousRaw = raw;
  previousCache = c;
  return c;
}
export const active = (rows) => rows.flatMap((r) => (r.entry ? [r.entry] : []));
function entriesById(entries) {
  return new Map(entries.map((e) => [e.id, e]));
}
export function working(c) {
  const map = entriesById(active(c.rows));
  for (const { id, entry } of c.pending) {
    if (entry) map.set(id, entry);
    else map.delete(id);
  }
  const ordered = [];
  for (const id of c.order) {
    if (map.has(id)) {
      ordered.push(map.get(id));
      map.delete(id);
    }
  }
  return [...ordered, ...map.values()];
}
// PostgreSQL JSONB cannot represent NUL or unpaired UTF-16 surrogates.
function incompatibleText(value) {
  if (typeof value === 'string') return /[\u0000\uD800-\uDFFF]/u.test(value);
  return (
    value &&
    typeof value === 'object' &&
    Object.entries(value).some(([key, child]) => incompatibleText(key) || incompatibleText(child))
  );
}
const reservedFields = ['owner', 'owner_id', 'ownerId', 'revision', 'updated_at', 'deleted_at'];
export function withEntries(c, entries) {
  requireEntries(entries);
  const old = entriesById(active(c.rows)),
    pending = [];
  for (const entry of entries) {
    if (!equal(old.get(entry.id), entry)) {
      if (incompatibleText(entry) || reservedFields.some((key) => Object.hasOwn(entry, key)))
        throw new Error(
          'A title contains a reserved cloud field or unsupported text. Keep its original JSON and review it before connecting.'
        );
      pending.push({ id: entry.id, entry });
    }
    old.delete(entry.id);
  }
  for (const id of old.keys()) pending.push({ id, entry: null });
  return { ...c, pending, order: entries.map((e) => e.id) };
}
export function overlay(rows, changes) {
  const map = new Map(rows.map((r) => [r.id, r]));
  for (const row of changes) map.set(row.id, row);
  return [...map.values()];
}
export function acknowledge(c, head) {
  const op = c.flight;
  if (!op || head !== op.expected + op.changes.length)
    throw new Error('Unexpected cloud acknowledgement.');
  const rows = overlay(
    c.rows,
    op.changes.map((row, i) => ({ ...row, revision: op.expected + i + 1 }))
  );
  return withEntries({ ...c, rows, cursor: head, flight: null }, working(c));
}

// Compare connected sets of stable IDs and title identities. A rename or simultaneous
// creation with two different local IDs must not produce two copies of the same film.
export function reconcile(c, incoming, choices = new Map()) {
  const base = active(c.rows),
    local = working(c),
    remote = active(incoming.rows);
  const parents = new Map(),
    seen = new Map();
  function root(id) {
    let top = id;
    while (parents.has(top)) top = parents.get(top);
    while (id !== top) {
      const next = parents.get(id);
      parents.set(id, top);
      id = next;
    }
    return top;
  }
  for (const list of [base, local, remote])
    for (const e of list) {
      const key = identity(e);
      if (seen.has(key)) {
        const a = root(e.id),
          b = root(seen.get(key));
        if (a !== b) parents.set(a, b);
      } else seen.set(key, e.id);
    }
  const groups = new Map();
  for (const [side, list] of Object.entries({ base, local, remote }))
    for (const e of list) {
      const key = root(e.id);
      if (!groups.has(key)) groups.set(key, { key, base: [], local: [], remote: [] });
      groups.get(key)[side].push(e);
    }
  const deleted = new Set(
    incoming.rows.filter((r) => !r.entry && r.revision > c.cursor).map((r) => r.id)
  );
  const same = (a, b) => {
    const map = entriesById(b);
    return a.length === b.length && a.every((e) => equal(e, map.get(e.id)));
  };
  const entries = [],
    conflicts = [];
  for (const g of groups.values()) {
    if (same(g.local, g.base) || same(g.remote, g.local)) entries.push(...g.remote);
    else if (same(g.remote, g.base) && !g.local.some((e) => deleted.has(e.id)))
      entries.push(...g.local);
    else {
      conflicts.push(g);
      entries.push(...(choices.get(g.key) === 'cloud' ? g.remote : g.local));
    }
  }
  return { entries, conflicts };
}
