import { accountKey, owner, requireSession, prefix, session } from './scope.js';
import { active, acknowledge, cacheAt, overlay, reconcile, withEntries } from './cache.js';
import { rpc } from './auth.js';
import { requireEntries } from '../validation.js';

const notify = () => window.dispatchEvent(new Event('cloud-state'));
const foregroundInterval = 60000;
let phase = '',
  failure = '',
  timer,
  periodic,
  activeRequest,
  requested = false;
let attempt = 0,
  started = false,
  suspended = false;
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
async function pull(id, base, cursor, signal) {
  let after = cursor,
    head = null;
  const changes = [];
  for (;;) {
    requireSession(id);
    const page = await rpc(id, 'ac_pull', { after_revision: after, pinned_head: head }, signal);
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
  if (!changes.length) return { rows: base, cursor: head };
  const rows = overlay(base, changes);
  requireEntries(active(rows));
  return { rows, cursor: head };
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
    inFlight: Boolean(c.flight),
    last: c.lastSync,
    error: failure,
  };
}
async function cycle(id, signal) {
  const key = accountKey(id);
  for (let turn = 0; turn < 12; turn++) {
    signal.throwIfAborted();
    const c = cacheAt(key);
    if (c.incoming) {
      const waiting = await lock(id, () => {
        const latest = cacheAt(key);
        if (!latest.incoming) return false;
        const merged = reconcile(latest, latest.incoming);
        if (merged.conflicts.length) return true;
        store(id, withEntries({ ...latest, ...latest.incoming, incoming: null }, merged.entries));
        return false;
      });
      if (waiting) return;
      continue;
    }
    if (c.flight) {
      const f = c.flight;
      let res;
      try {
        res = await rpc(
          id,
          'ac_apply',
          {
            operation_id: f.id,
            expected: f.expected,
            changes: f.changes,
          },
          signal
        );
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
    const remote = await pull(id, c.rows, c.cursor, signal);
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
  throw new Error('Cloud activity continued during sync. Please try again.');
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
function available() {
  return owner && !suspended && navigator.onLine && !document.hidden && session()?.id === owner;
}
function schedule(delay = 180, freshness = 0) {
  if (!available()) return;
  if (activeRequest) {
    if (!freshness) requested = true;
    return;
  }
  clearTimeout(timer);
  timer = setTimeout(() => synchronize(freshness), delay);
}
function armForegroundCheck() {
  clearTimeout(periodic);
  if (!available() || failure) return;
  periodic = setTimeout(() => synchronize(foregroundInterval - 2000), foregroundInterval);
}
async function synchronize(freshness = 0) {
  if (!available() || activeRequest) return;
  clearTimeout(timer);
  clearTimeout(periodic);
  const controller = new AbortController();
  activeRequest = controller;
  let retry = false;
  try {
    await navigator.locks.request(
      prefix + '.sync.' + owner,
      { ifAvailable: true },
      async (grant) => {
        if (!grant || !available()) return;
        const c = cacheAt(accountKey(owner));
        const age = Date.now() - Date.parse(c.lastSync);
        if (
          !c.incoming &&
          freshness &&
          !failure &&
          !c.flight &&
          !c.pending.length &&
          age >= 0 &&
          age < freshness
        )
          return;
        phase = 'Syncing';
        failure = '';
        notify();
        await cycle(owner, controller.signal);
        attempt = 0;
        phase = '';
      }
    );
  } catch (error) {
    if (controller.signal.aborted) {
      phase = '';
    } else {
      phase = 'Error';
      failure = error.message;
      retry = error.transient && attempt < 5;
      if (retry) attempt++;
    }
  } finally {
    activeRequest = null;
    notify();
    const again = requested;
    requested = false;
    if (retry) schedule(1000 * 2 ** attempt);
    else if (again && !failure) schedule();
    else {
      try {
        if (!cacheAt(accountKey(owner)).incoming) armForegroundCheck();
      } catch {
        /* A protected cache needs user intervention. */
      }
    }
  }
}
export function syncNow() {
  attempt = 0;
  return synchronize();
}
function pause() {
  clearTimeout(timer);
  clearTimeout(periodic);
  requested = false;
  activeRequest?.abort();
  notify();
}
export function startSync() {
  if (!owner || started) return;
  started = true;
  const resume = (freshness = 0) => {
    if (available()) {
      attempt = 0;
      schedule(180, freshness);
    }
  };
  window.addEventListener('cloud-edit', () => {
    resume();
    notify();
  });
  window.addEventListener('online', () => resume());
  window.addEventListener('offline', pause);
  window.addEventListener('focus', () => resume(2000));
  document.addEventListener('visibilitychange', () => (document.hidden ? pause() : resume()));
  window.addEventListener('pagehide', () => {
    suspended = true;
    pause();
  });
  window.addEventListener('pageshow', () => {
    suspended = false;
    resume();
  });
  for (const event of ['cloud-signing-out', 'cloud-session-ended'])
    window.addEventListener(event, () => {
      suspended = true;
      pause();
    });
  window.addEventListener('cloud-signout-cancelled', () => {
    suspended = false;
    resume();
  });
  window.addEventListener('storage', (event) => {
    if (event.key !== accountKey(owner)) return;
    try {
      const c = cacheAt(accountKey(owner));
      if (c.incoming) clearTimeout(timer);
      else if (c.pending.length || c.flight) schedule();
      else if (phase === 'Error' && c.lastSync !== JSON.parse(event.oldValue || 'null')?.lastSync) {
        phase = failure = '';
        attempt = 0;
        armForegroundCheck();
      }
    } catch {
      phase = 'Error';
      failure = 'The saved copy on this device needs attention.';
    }
    notify();
  });
  resume();
}
