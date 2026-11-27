import { snapshot, persistEntries, withLock } from './collection.js';
import { backupText, readBackup } from './backup.js';
import { requireEntries } from './validation.js';
import { mergedEntries, planImport } from './import-plan.js';
import { backupStatus, noteChanges, recordExport } from './vault-status.js';

import { keyFor } from './cloud/scope.js';
export const HISTORY_KEY = keyFor('aftercredits.vault.recovery.v1');
const historyLimit = 3;
const recoveryDownloads = new WeakMap();
const changed = 'The collection changed since this preview. Review the current collection again.';
export function checkpoints() {
  const raw = localStorage.getItem(HISTORY_KEY);
  if (raw === null) return [];
  const history = JSON.parse(raw);
  if (
    history?.version !== 1 ||
    !Array.isArray(history.copies) ||
    history.copies.length > historyLimit ||
    !history.copies.every(
      (c) =>
        typeof c?.at === 'string' && Number.isFinite(Date.parse(c.at)) && Array.isArray(c.entries)
    )
  )
    throw new Error('Local recovery history could not be read.');
  return history.copies;
}

export function review(report) {
  const state = snapshot();
  return {
    report,
    base: JSON.stringify(state.items),
    plan: planImport(state.items, report.entries),
    notice: state.notice,
  };
}

export function recoveryReport(copy) {
  return readBackup(JSON.stringify({ version: 2, entries: copy.entries }));
}

function countChanges(before, after) {
  const previous = new Map(before.map((entry) => [entry.id, entry]));
  let changes = 0;
  for (const entry of after) {
    const other = previous.get(entry.id);
    if (!other || JSON.stringify(other) !== JSON.stringify(entry)) changes++;
    previous.delete(entry.id);
  }
  return changes + previous.size;
}

function storeWithCheckpoint(items, next) {
  const prior = localStorage.getItem(HISTORY_KEY);
  const copies = [{ at: new Date().toISOString(), entries: items }, ...checkpoints()].slice(
    0,
    historyLimit
  );
  let wroteHistory = false;
  let writingArchive;
  while (copies.length) {
    try {
      writingArchive = false;
      localStorage.setItem(HISTORY_KEY, JSON.stringify({ version: 1, copies }));
      wroteHistory = true;
      writingArchive = true;
      persistEntries(next);
      return;
    } catch (error) {
      if (error.name === 'QuotaExceededError' && copies.length > 1) {
        copies.pop();
        continue;
      }
      if (wroteHistory) {
        try {
          if (prior === null) localStorage.removeItem(HISTORY_KEY);
          else localStorage.setItem(HISTORY_KEY, prior);
        } catch {
          /* The persisted pre-import checkpoint is still safe. */
        }
      }
      throw new Error(
        writingArchive
          ? 'Browser storage could not save the import. Your current collection is intact.'
          : 'A recovery snapshot could not be saved. The collection is intact.'
      );
    }
  }
}

export async function exportCurrent(generate, expected, recovery = false, signal) {
  signal?.throwIfAborted();
  const { items, notice } = snapshot();
  const base = JSON.stringify(items);
  if (expected !== undefined && base !== expected) throw new Error(changed);
  const at = new Date().toISOString();
  // Initiate the download during the user's click. Only the reminder receipt needs the lock.
  generate(backupText(items, at), at, Boolean(notice));
  let recorded = false;
  if (!recovery && !notice) {
    try {
      await withLock(() => {
        const current = snapshot();
        if (current.notice || backupStatus().exportedAt > at) return;
        recordExport(
          at,
          JSON.stringify(current.items) === base ? 0 : countChanges(items, current.items)
        );
        recorded = true;
      });
    } catch {
      /* The generated file is independent of the optional receipt. */
    }
  }
  const receipt = {};
  if (recovery && !notice) recoveryDownloads.set(receipt, base);
  return { receipt, recorded, sessionOnly: Boolean(notice) };
}

export function applyImport(
  preview,
  mode,
  accepted = new Set(),
  receipt = null,
  signal,
  checkSource
) {
  if (!navigator.locks)
    throw new Error(
      'Safe imports require a browser with Web Locks. Open the HTTPS site in a current browser.'
    );
  return withLock(
    () => {
      checkSource?.();
      if (mode !== 'merge' && mode !== 'restore') throw new Error('Unknown import mode.');
      const { items, notice } = snapshot();
      if (notice)
        throw new Error(
          'Storage is protected or unavailable. Export readable titles before continuing.'
        );
      if (preview.base !== JSON.stringify(items)) throw new Error(changed);
      if (preview.report.invalid)
        throw new Error('Every entry must pass validation before import.');
      requireEntries(items);
      const incoming = requireEntries(preview.report.entries);
      if (mode === 'restore' && recoveryDownloads.get(receipt) !== preview.base)
        throw new Error('Generate a recovery JSON of the current collection first.');
      const plan = planImport(items, incoming);
      const next = mode === 'restore' ? incoming : mergedEntries(items, plan, accepted);
      if (JSON.stringify(next) === preview.base) return false;
      // Both keys are written synchronously under the same collection lock. Storage.setItem
      // is atomic per key. A crash between writes leaves a readable pre-import archive.
      storeWithCheckpoint(items, next);
      if (mode === 'restore') recoveryDownloads.delete(receipt);
      noteChanges(
        mode === 'merge' ? plan.added + accepted.size : Math.max(1, countChanges(items, next))
      );
      return true;
    },
    { signal }
  );
}
