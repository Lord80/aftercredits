import { accountKey, owner, requireSession, prefix } from './scope.js';
import {
  active,
  acknowledge,
  blank,
  cacheAt,
  overlay,
  reconcile,
  withEntries,
  working,
} from './cache.js';
import { rpc } from './auth.js';
import { requireEntries } from '../validation.js';
import { withLock, snapshot } from '../collection.js';
import { planImport, mergedEntries } from '../import-plan.js';
import { exportCurrent } from '../vault-store.js';

const notify = () => window.dispatchEvent(new Event('cloud-state'));
let phase = '',
  failure = '',
  timer,
  attempt = 0,
  busy = false,
  requested = false;
const lock = (id, fn) =>
  navigator.locks.request(accountKey(id), async () => {
    requireSession(id);
    return fn();
  });
function store(id, c, refresh = true) {
  requireSession(id);
  localStorage.setItem(accountKey(id), JSON.stringify(c));
  if (refresh && owner === id) window.dispatchEvent(new Event('cloud-collection'));
}
async function pull(id, base, cursor) {
  let after = cursor,
    head = null;
  const changes = [];
  for (;;) {
    requireSession(id);
    const page = await rpc(id, 'ac_pull', { after_revision: after, pinned_head: head });
    if (page?.status === 'stale') return null;
    if (
      page?.status !== 'ok' ||
      !Number.isSafeInteger(page.head) ||
      page.head < after ||
      (head !== null && page.head !== head) ||
      !Array.isArray(page.rows) ||
      page.rows.length > 100
    )
      throw new Error('Unexpected change page. The local cursor was preserved.');
    head = page.head;
    for (const r of page.rows) {
      if (
        !Number.isSafeInteger(r.revision) ||
        r.revision <= after ||
        r.revision > head ||
        typeof r.id !== 'string' ||
        (r.entry !== null && r.entry?.id !== r.id)
      )
        throw new Error('Invalid cloud record. The local cursor was preserved.');
      after = r.revision;
      changes.push(r);
    }
    if (page.rows.length < 100 || after === head) break;
  }
  if (after !== head) throw new Error('Incomplete change page. The local cursor was preserved.');
  const rows = overlay(base, changes);
  requireEntries(active(rows));
  return { rows, cursor: head };
}
const migrations = new WeakMap();
export async function previewMigration(id) {
  if (owner) throw new Error('This device already has an account archive.');
  const guest = snapshot();
  if (guest.notice) throw new Error('Export and recover the guest archive before connecting it.');
  requireEntries(guest.items);
  const remote = await pull(id, [], 0);
  if (!remote) throw new Error('The cloud collection changed during review. Preview it again.');
  const deleted = new Set(remote.rows.filter((r) => !r.entry).map((r) => r.id));
  const plan = planImport(
    active(remote.rows),
    guest.items.filter((e) => !deleted.has(e.id))
  );
  const preview = {
    id,
    remote,
    plan,
    guest: JSON.stringify(guest.items),
    deleted: guest.items.filter((e) => deleted.has(e.id)),
  };
  requireSession(id);
  return preview;
}
export async function migrationBackup(p, generate) {
  requireSession(p.id);
  const result = await exportCurrent(generate, p.guest, true);
  if (result.sessionOnly) throw new Error('Recover local storage before connecting.');
  migrations.set(p, result.receipt);
}
export async function connect(p, merge, accepted) {
  if (!migrations.has(p)) throw new Error('Download the guest recovery JSON first.');
  const check = await rpc(p.id, 'ac_pull', {
    after_revision: p.remote.cursor,
    pinned_head: p.remote.cursor,
  });
  if (check.status !== 'ok') throw new Error('The cloud archive changed. Generate a new preview.');
  // The guest lock pins the source; the account lock installs cache, cursor and pending edits together.
  await withLock(() =>
    lock(p.id, () => {
      const guest = snapshot();
      if (guest.notice || JSON.stringify(guest.items) !== p.guest)
        throw new Error('The guest collection changed. Review it again.');
      if (localStorage.getItem(accountKey(p.id)) !== null)
        throw new Error('This account is already connected. Sign out and back in.');
      const local = merge
        ? mergedEntries(active(p.remote.rows), p.plan, accepted)
        : active(p.remote.rows);
      store(p.id, withEntries({ ...blank(), ...p.remote }, local), false);
    })
  );
  return (await import('./auth.js')).activateSession(p.id);
}
export function syncStatus() {
  if (!owner) return { state: 'Local only', pending: 0, last: null };
  const c = cacheAt(accountKey(owner));
  return {
    state: c.incoming
      ? 'Conflict'
      : !navigator.onLine
        ? 'Offline'
        : phase ||
          (c.pending.length || c.flight
            ? 'Pending changes'
            : c.lastSync
              ? 'Synced'
              : 'Pending changes'),
    pending: c.pending.length,
    last: c.lastSync,
    error: failure,
  };
}
async function cycle(id) {
  const key = accountKey(id);
  for (let turn = 0; turn < 12; turn++) {
    const c = cacheAt(key);
    if (c.incoming) return;
    if (c.flight) {
      const f = c.flight;
      let res;
      try {
        res = await rpc(id, 'ac_apply', {
          operation_id: f.id,
          expected: f.expected,
          changes: f.changes,
        });
      } catch (error) {
        // A rejected transaction did not commit. Keep local edits editable for repair.
        // A timeout or lost reply must replay the exact same operation.
        if ([400, 409, 413, 422].includes(error.status))
          await lock(id, () => {
            const latest = cacheAt(key);
            if (latest.flight?.id === f.id) store(id, { ...latest, flight: null }, false);
          });
        throw error;
      }
      await lock(id, () => {
        const latest = cacheAt(key);
        if (latest.flight?.id !== f.id) throw new Error('The pending operation changed.');
        if (res.status === 'ok') store(id, acknowledge(latest, res.head));
        else if (res.status === 'stale') store(id, { ...latest, flight: null });
        else throw new Error('Unrecognized mutation response.');
      });
      continue;
    }
    const remote = await pull(id, c.rows, c.cursor);
    if (!remote) continue;
    const done = await lock(id, () => {
      let latest = cacheAt(key);
      if (latest.cursor !== c.cursor || latest.flight) return false;
      if (remote.cursor !== latest.cursor) {
        const result = reconcile(latest, remote);
        if (result.conflicts.length) {
          store(id, { ...latest, incoming: remote });
          return true;
        }
        latest = withEntries({ ...latest, ...remote }, result.entries);
      }
      if (latest.pending.length) {
        latest = {
          ...latest,
          flight: { id: crypto.randomUUID(), expected: latest.cursor, changes: latest.pending },
        };
        store(id, latest);
        return false;
      }
      store(id, { ...latest, lastSync: new Date().toISOString() }, false);
      if (remote.cursor !== c.cursor) window.dispatchEvent(new Event('cloud-collection'));
      return true;
    });
    if (done) return;
  }
  throw new Error('Cloud activity continued during sync. Try Sync now again.');
}
export function conflictPreview() {
  const c = cacheAt(accountKey(owner));
  return c.incoming
    ? { token: JSON.stringify([c.pending, c.incoming.cursor]), ...reconcile(c, c.incoming) }
    : null;
}
export async function resolveConflicts(token, choices) {
  await lock(owner, () => {
    const c = cacheAt(accountKey(owner));
    if (!c.incoming || JSON.stringify([c.pending, c.incoming.cursor]) !== token)
      throw new Error('Conflict review changed. Review it again.');
    const r = reconcile(c, c.incoming, choices);
    if (r.conflicts.some((g) => !['device', 'cloud'].includes(choices.get(g.key))))
      throw new Error('Choose a version for each conflict.');
    store(owner, withEntries({ ...c, ...c.incoming, incoming: null }, r.entries));
  });
  schedule();
}
export function schedule(delay = 200) {
  if (!owner) return;
  clearTimeout(timer);
  if (busy) {
    requested = true;
    return;
  }
  timer = setTimeout(syncNow, delay);
}
export async function syncNow() {
  if (!owner || busy || !navigator.onLine) {
    notify();
    return;
  }
  clearTimeout(timer);
  busy = true;
  phase = 'Syncing';
  failure = '';
  notify();
  let retry = false;
  try {
    await navigator.locks.request(
      prefix + '.sync.' + owner,
      { ifAvailable: true },
      async (grant) => {
        if (grant) await cycle(owner);
      }
    );
    attempt = 0;
    phase = '';
  } catch (error) {
    phase = 'Error';
    failure = error.message;
    retry = error.transient && attempt < 5;
    if (retry) attempt++;
  } finally {
    busy = false;
    notify();
    if (retry) schedule(Math.min(60000, 1000 * 2 ** attempt));
    else if (requested && !failure) schedule();
    requested = false;
  }
}
export function startSync() {
  window.addEventListener('cloud-edit', () => {
    attempt = 0;
    schedule();
    notify();
  });
  for (const event of ['online', 'focus'])
    window.addEventListener(event, () => {
      attempt = 0;
      schedule();
    });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) schedule();
  });
  window.addEventListener('offline', notify);
  window.addEventListener('storage', (event) => {
    if (event.key === accountKey(owner)) {
      notify();
      try {
        const c = cacheAt(accountKey(owner));
        if (!busy && !c.incoming && c.pending.length && !c.flight) schedule();
      } catch {
        phase = 'Error';
        failure = 'The account cache could not be read. Its stored data is protected.';
        notify();
      }
    }
  });
  schedule();
}
