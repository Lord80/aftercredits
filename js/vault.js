import { owner } from './cloud/scope.js';
import { snapshot, STORAGE_KEY, LEGACY_KEY, withLock } from './collection.js';
import { MAX_BYTES } from './validation.js';
import { download } from './download.js';
import { csvText, readBackup } from './backup.js';
import {
  applyImport,
  checkpoints,
  exportCurrent,
  HISTORY_KEY,
  recoveryReport,
  review,
} from './vault-store.js';
import { backupStatus, dismissReminder, reminderDue, STATUS_KEY } from './vault-status.js';

const byId = (id) => document.getElementById('vault-' + id);
const dialog = document.getElementById('vault');
const content = byId('content');
content.replaceWith(content.content);

const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
let refreshRoom, updateControl, preview, recoveryReceipt, source, mode, tab, history;
let guestReview;
let operation,
  generation = 0,
  conflictsShown = 0;
const accepted = new Set();
const node = (tag, value) => {
  const el = document.createElement(tag);
  if (value !== undefined) el.textContent = value;
  return el;
};

function message(copy = '', error = false) {
  byId('message').textContent = copy;
  byId('message').toggleAttribute('data-error', error);
}

function overview() {
  const { items, notice } = snapshot();
  byId('local').textContent =
    notice || (items.length ? 'Saved on this device' : 'Empty collection');
  byId('json').querySelector('strong').textContent = notice
    ? 'Download readable titles'
    : 'Download a backup';
  const status = backupStatus();
  byId('last').textContent = status.exportedAt
    ? date.format(new Date(status.exportedAt))
    : 'None recorded';
  byId('reminder').hidden = !reminderDue(status);
  try {
    history = checkpoints();
  } catch {
    history = null;
  }
  updateControl();
}

function cancelPreview() {
  generation++;
  operation?.abort();
  operation = null;
  preview = null;
  guestReview = null;
  recoveryReceipt = null;
  accepted.clear();
  byId('actions').hidden = false;
  byId('advanced').hidden = false;
  byId('file').value = '';
  byId('preview').hidden = true;
  byId('conflicts').replaceChildren();
}

function drawHistory() {
  const area = byId('history');
  area.replaceChildren();
  if (!history?.length) {
    area.textContent = history
      ? 'No recovery snapshots yet.'
      : 'Recovery history is unavailable in this browser.';
    return;
  }
  for (const copy of history) {
    const button = node(
      'button',
      date.format(new Date(copy.at)) + ' · ' + copy.entries.length + ' titles'
    );
    button.className = 'button secondary';
    button.addEventListener('click', () => {
      try {
        tab = 'recovery';
        startReview(recoveryReport(copy), 'Snapshot from ' + date.format(new Date(copy.at)));
      } catch (err) {
        message(err.message, true);
      }
    });
    area.append(button);
  }
}

function resetView() {
  cancelPreview();
  tab = 'import';
  message();
  overview();
  drawHistory();
}
byId('json').addEventListener('click', async () => {
  const ticket = generation;
  operation?.abort();
  operation = new AbortController();
  try {
    const { recorded, sessionOnly } = await exportCurrent(
      (data, at, partial) => download(data, partial ? 'readable-titles' : 'backup', at, 'json'),
      undefined,
      false,
      operation.signal
    );
    if (ticket !== generation) return;
    overview();
    message(
      sessionOnly
        ? 'Export generated from readable titles in this tab. Protected, unreadable records are excluded. Check your downloads.'
        : 'JSON export generated. Check your downloads and keep the file somewhere safe.' +
            (recorded ? '' : ' The export date could not be recorded.')
    );
  } catch (err) {
    if (ticket === generation) message(err.message, true);
  }
});
byId('csv').addEventListener('click', () => {
  try {
    download(csvText(snapshot().items), 'collection', new Date().toISOString(), 'csv');
    message('CSV export generated. Check your downloads.');
  } catch {
    message('The spreadsheet could not be generated from these records.', true);
  }
});
byId('dismiss').addEventListener('click', async () => {
  try {
    await withLock(dismissReminder);
    byId('json').focus();
    overview();
    message('Reminder dismissed.');
  } catch {
    message('The reminder preference could not be saved.', true);
  }
});

function compareRow(row) {
  const box = node('div');
  box.className = 'vault-conflict';
  box.append(node('strong', row.entry.title));
  if (row.ambiguous) {
    box.append(
      node(
        'p',
        'The local ID and title identity overlap other records. Merge keeps the local records.'
      )
    );
    return box;
  }
  const local = guestReview ? 'Account' : 'Local',
    incoming = guestReview ? 'Guest' : 'File';
  const describe = (e) => e.title + ' · ' + e.rating + '/10 · added ' + e.added;
  box.append(
    node('p', local + ' · ' + describe(row.current)),
    node('p', incoming + ' · ' + describe(row.entry))
  );
  const detail = node('details');
  detail.append(node('summary', 'Compare changed fields (' + row.differences.length + ')'));
  detail.addEventListener('toggle', () => {
    if (!detail.open || detail.childElementCount > 1) return;
    for (const k of row.differences) {
      detail.append(
        node('strong', k),
        node(
          'pre',
          local +
            ' · ' +
            (JSON.stringify(row.current[k], null, 2) ?? 'Missing') +
            '\n' +
            incoming +
            ' · ' +
            (JSON.stringify(row.entry[k], null, 2) ?? 'Missing')
        )
      );
    }
  });
  box.append(detail);
  const choice = node('input');
  choice.type = 'checkbox';
  choice.checked = accepted.has(row.entry.id);
  const label = node('label');
  label.append(
    choice,
    'Use the ' + (guestReview ? 'guest' : 'file’s') + ' version of ' + row.entry.title
  );
  choice.addEventListener('change', () => {
    if (choice.checked) accepted.add(row.entry.id);
    else accepted.delete(row.entry.id);
    enabled();
  });
  box.append(label);
  return box;
}

function appendConflicts() {
  const area = byId('conflicts');
  area.querySelector('.more-conflicts')?.remove();
  const rows = preview.plan.conflicts;
  for (const row of rows.slice(conflictsShown, conflictsShown + 15)) area.append(compareRow(row));
  conflictsShown = Math.min(rows.length, conflictsShown + 15);
  if (conflictsShown < rows.length) {
    const more = node('button', 'Show more conflicts (' + (rows.length - conflictsShown) + ')');
    more.className = 'text-button more-conflicts';
    more.onclick = () => {
      const first = area.children.length - 1;
      appendConflicts();
      area.children[first]?.querySelector('summary,input')?.focus();
    };
    area.append(more);
  }
}

function enabled() {
  const restore = mode === 'restore';
  byId('consent').disabled = recoveryReceipt === null;
  byId('apply').disabled =
    !preview ||
    !!preview.notice ||
    !!preview.report.invalid ||
    !navigator.locks ||
    (restore
      ? recoveryReceipt === null || !byId('consent').checked
      : !preview.plan.added && !accepted.size);
  byId('apply').className = 'button ' + (restore ? 'danger' : 'primary');
  byId('apply').textContent = restore
    ? 'Confirm replacement'
    : guestReview
      ? 'Import guest titles'
      : 'Confirm merge';
}
function setMode(next) {
  mode = next;
  recoveryReceipt = null;
  byId('consent').checked = false;
  dialog.querySelector('input[name="vault-mode"][value="' + mode + '"]').checked = true;
  byId('mode-note').textContent = guestReview
    ? 'Your account keeps its ratings and dates unless you select a guest version. A recovery snapshot is saved before import.'
    : mode === 'merge'
      ? 'New titles will be added. Local ratings, dates and metadata are kept unless you choose a file version.'
      : 'The file’s IDs, order, dates and ratings will become your collection.';
  byId('protect').hidden = mode !== 'restore';
  byId('conflicts').replaceChildren();
  conflictsShown = 0;
  if (mode === 'merge' && !preview.report.invalid) appendConflicts();
  enabled();
}
for (const radio of dialog.querySelectorAll('[name="vault-mode"]')) {
  radio.addEventListener('change', () => setMode(radio.value));
}
byId('replace').addEventListener('toggle', () => {
  if (!byId('replace').open && preview && tab === 'import' && mode === 'restore') setMode('merge');
});
byId('consent').addEventListener('change', enabled);

function startReview(report, name, guest = null) {
  cancelPreview();
  guestReview = guest;
  message();
  source = name;
  preview = review(report);
  const { plan, notice } = preview;
  byId('actions').hidden = byId('advanced').hidden = true;
  byId('preview').hidden = false;
  byId('preview-title').textContent = guestReview
    ? 'Review guest titles'
    : tab === 'recovery'
      ? 'Recovery preview'
      : 'Import preview';
  byId('source').textContent = name;
  const summary = byId('summary');
  summary.replaceChildren();
  for (const [label, value] of Object.entries({
    [guestReview ? 'Guest titles' : tab === 'recovery' ? 'In saved copy' : 'In backup']:
      report.total,
    New: plan.added,
    'Already saved': plan.duplicates,
    ...(plan.conflicts.length ? { 'Different versions': plan.conflicts.length } : {}),
    ...(report.invalid ? { Invalid: report.invalid } : {}),
  })) {
    const group = node('div');
    group.append(node('dt', label), node('dd', value));
    summary.append(group);
  }
  const errors = [...report.errors];
  if (notice) errors.push(notice);
  if (!navigator.locks)
    errors.push('Safe import requires Web Locks. Use the HTTPS site in a current browser.');
  byId('errors').replaceChildren(...errors.map((err) => node('p', err)));
  byId('errors').hidden = !errors.length;
  byId('options').hidden = !!errors.length;
  byId('replace').open = false;
  byId('replace').hidden = tab === 'recovery' || Boolean(guestReview);
  setMode(tab === 'recovery' ? 'restore' : 'merge');
  byId('preview-title').focus();
}
byId('file').addEventListener('change', async (event) => {
  tab = 'import';
  const file = event.target.files[0];
  if (!file) return;
  cancelPreview();
  const ticket = generation;
  message('Reading backup…');
  try {
    if (file.size > MAX_BYTES) throw new Error('Choose a JSON file of 16 MiB or less.');
    const bytes = await file.arrayBuffer();
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new Error('The backup must be valid UTF-8 JSON.');
    }
    if (ticket === generation) startReview(readBackup(text), file.name);
  } catch (err) {
    if (ticket === generation) message(err.message, true);
  }
});
byId('copy').addEventListener('click', async () => {
  if (!preview) return;
  const ticket = generation;
  operation?.abort();
  operation = new AbortController();
  try {
    const result = await exportCurrent(
      (data, at) => download(data, 'before-restore', at, 'json'),
      preview.base,
      true,
      operation.signal
    );
    if (ticket !== generation || mode !== 'restore') return;
    recoveryReceipt = result.receipt;
    enabled();
    message('Recovery JSON generated. Check that you have the file before confirming replacement.');
  } catch (err) {
    if (ticket === generation) message(err.message, true);
  }
});
byId('apply').addEventListener('click', async () => {
  if (!preview || byId('apply').disabled) return;
  const ticket = generation;
  operation = new AbortController();
  byId('apply').disabled = true;
  byId('options').inert = true;
  try {
    const changed = guestReview
      ? await guestReview.apply(preview, new Set(accepted), operation.signal)
      : await applyImport(preview, mode, new Set(accepted), recoveryReceipt, operation.signal);
    if (ticket !== generation) return;
    resetView();
    refreshRoom();
    message(
      changed
        ? 'Collection saved locally. Your previous collection is in recovery history.'
        : 'Your collection already matches this backup.'
    );
    byId('json').focus();
  } catch (err) {
    if (ticket === generation) {
      enabled();
      message(err.message, true);
    }
  } finally {
    byId('options').inert = false;
  }
});
byId('cancel').addEventListener('click', () => {
  resetView();
  byId('file').focus();
  message('Preview cancelled. Your collection is intact.');
});
function refreshVault(key) {
  if (dialog.hidden) return;
  if (
    [null, STORAGE_KEY, LEGACY_KEY].includes(key) &&
    preview &&
    preview.base !== JSON.stringify(snapshot().items)
  ) {
    if (guestReview) {
      cancelPreview();
      message('Your account changed. Review the guest titles again from Account.');
      return;
    }
    const report = preview.report;
    startReview(report, source);
    message('The local collection changed. Review this updated comparison before confirming.');
  }
  if ([null, STORAGE_KEY, LEGACY_KEY, HISTORY_KEY, STATUS_KEY].includes(key)) {
    overview();
    drawHistory();
  }
}
window.addEventListener('storage', (event) => refreshVault(event.key));
window.addEventListener('cloud-collection', () => refreshVault(STORAGE_KEY));

export function openData(refresh, syncControl, guestTools) {
  refreshRoom = refresh;
  updateControl = syncControl;
  dialog.hidden = false;
  byId('advanced').open = false;
  resetView();
  const count = owner && guestTools?.guestCount();
  byId('guest').hidden = !count;
  if (count) {
    byId('guest').querySelector('small').textContent =
      count + (count === 1 ? ' title on this device' : ' titles on this device');
    byId('guest').onclick = () => {
      try {
        const guest = guestTools.guestPreview();
        startReview(
          guest.report,
          'Guest journal on this device' +
            (guest.skipped ? ' · ' + guest.skipped + ' previously deleted titles excluded' : ''),
          guest
        );
      } catch (error) {
        message(error.message, true);
      }
    };
  }
}
export function closeData() {
  cancelPreview();
  history = null;
  byId('history').replaceChildren();
  byId('guest').onclick = null;
  dialog.hidden = true;
}
