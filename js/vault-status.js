import { keyFor } from './cloud/scope.js';
export const STATUS_KEY = keyFor('aftercredits.vault.status.v1');
const fresh = () => ({ exportedAt: null, changes: 0, dismissedAt: 0 });
export function backupStatus() {
  try {
    const s = JSON.parse(localStorage.getItem(STATUS_KEY));
    if (
      s &&
      Number.isSafeInteger(s.changes) &&
      s.changes >= 0 &&
      Number.isSafeInteger(s.dismissedAt) &&
      s.dismissedAt >= 0 &&
      (s.exportedAt === null ||
        (typeof s.exportedAt === 'string' && Number.isFinite(Date.parse(s.exportedAt))))
    )
      return s;
  } catch {}
  return fresh();
}
// Companion bookkeeping never determines whether the primary archive was saved.
export function noteChanges(count) {
  try {
    const s = backupStatus();
    s.changes += count;
    localStorage.setItem(STATUS_KEY, JSON.stringify(s));
  } catch {}
}
export function recordExport(at, changes) {
  localStorage.setItem(STATUS_KEY, JSON.stringify({ ...fresh(), changes, exportedAt: at }));
}
export function dismissReminder() {
  const s = backupStatus();
  localStorage.setItem(STATUS_KEY, JSON.stringify({ ...s, dismissedAt: s.changes }));
}
export function reminderDue(s) {
  return s.changes - s.dismissedAt >= 5;
}
