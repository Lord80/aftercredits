import { readBackup } from '../backup.js';
import { applyImport } from '../vault-store.js';
import { inspectEntries } from '../validation.js';
import { accountKey, owner, requireSession } from './scope.js';
import { cacheAt } from './cache.js';
import { rpc } from './auth.js';

const guestKey = 'aftercredits.collection.v2';
const source = () =>
  localStorage.getItem(guestKey) ?? localStorage.getItem('aftercredits.collection.v1');
export function guestCount() {
  try {
    const raw = source();
    if (!raw) return 0;
    const data = JSON.parse(raw);
    return (Array.isArray(data) ? data : data?.entries)?.length || 0;
  } catch {
    return 0;
  }
}
function ready() {
  requireSession(owner);
  const c = cacheAt(accountKey(owner));
  if (!navigator.onLine || !c.lastSync || c.incoming || c.pending.length || c.flight)
    throw new Error('Finish syncing this archive before importing guest titles.');
  return c;
}
export function guestPreview() {
  const c = ready();
  const raw = source();
  if (!raw) throw new Error('There are no guest titles on this device.');
  const guest = readBackup(raw);
  if (guest.invalid)
    throw new Error(
      'Some guest titles need recovery. Export the guest journal from Data Vault before importing.'
    );
  const deleted = new Set(c.rows.filter((row) => !row.entry).map((row) => row.id));
  const report = inspectEntries(guest.entries.filter((entry) => !deleted.has(entry.id)));
  return {
    report,
    skipped: guest.total - report.total,
    apply: (preview, accepted, signal) => importGuest(raw, c.cursor, preview, accepted, signal),
  };
}
async function importGuest(raw, cursor, preview, accepted, signal) {
  const check = () => {
    if (source() !== raw)
      throw new Error('The guest collection changed. Review it again from Account.');
    if (ready().cursor !== cursor)
      throw new Error('The private archive changed. Review it again from Account.');
  };
  check();
  const pinned = await rpc(owner, 'ac_pull', { after_revision: cursor, pinned_head: cursor });
  if (pinned?.status !== 'ok' || pinned.head !== cursor)
    throw new Error('The private archive changed. Sync and review the guest titles again.');
  return navigator.locks.request(guestKey, { signal }, () =>
    applyImport(preview, 'merge', accepted, null, signal, check)
  );
}
