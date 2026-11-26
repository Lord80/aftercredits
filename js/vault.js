import { configured, owner, session } from './cloud/scope.js';
import { snapshot, STORAGE_KEY, LEGACY_KEY, withLock } from './collection.js';
import { MAX_BYTES } from './validation.js';
import { csvText, fileName, readBackup } from './backup.js';
import {
  applyImport,
  checkpoints,
  exportCurrent,
  HISTORY_KEY,
  recoveryReport,
  review,
} from './vault-store.js';
import { backupStatus, dismissReminder, reminderDue, STATUS_KEY } from './vault-status.js';
import { hideDialog, showDialog } from './motion.js';

const byId = (id) => document.getElementById('vault-' + id);
const dialog = document.getElementById('vault');
const content = byId('content');
content.replaceWith(content.content);
const tabs = [...dialog.querySelectorAll('[data-vault-tab]')];
const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
let refreshRoom, updateControl, preview, recoveryReceipt, source, mode, tab, history;
let operation,
  generation = 0,
  closing = false,
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
  byId('movies').textContent = items.filter((item) => item.mediaType === 'movie').length;
  byId('series').textContent = items.filter((item) => item.mediaType === 'tv').length;
  byId('local').textContent = notice
    ? owner
      ? 'Storage protected'
      : 'Session only'
    : items.length
      ? 'Saved locally'
      : 'Empty collection';
  if (notice) byId('local').textContent += ' · ' + notice;
  byId('json').textContent = notice ? 'Download readable titles' : 'Download JSON backup';
  const status = backupStatus();
  byId('last').textContent = status.exportedAt
    ? date.format(new Date(status.exportedAt))
    : 'None recorded';
  byId('cloud-note').textContent = owner
    ? 'Account archive · ' + (session()?.email || 'signed in')
    : configured
      ? 'Guest archive · local only.'
      : 'Cloud sync is not configured.';
  byId('reminder').hidden = !reminderDue(status);
  try {
    history = checkpoints();
  } catch {
    history = null;
  }
  byId('history-count').textContent = history
    ? history.length + (history.length === 1 ? ' snapshot' : ' snapshots')
    : 'Unavailable';
  updateControl();
}

function cancelPreview() {
  generation++;
  operation?.abort();
  operation = null;
  preview = null;
  recoveryReceipt = null;
  accepted.clear();
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
        startReview(recoveryReport(copy), 'Snapshot from ' + date.format(new Date(copy.at)));
      } catch (err) {
        message(err.message, true);
      }
    });
    area.append(button);
  }
}

function openTab(name) {
  cancelPreview();
  tab = name;
  for (const button of tabs) {
    const selected = button.dataset.vaultTab === tab;
    button.setAttribute('aria-pressed', String(selected));
    byId(button.dataset.vaultTab).hidden = !selected;
  }
  message();
  overview();
  if (tab === 'recovery') drawHistory();
  if (tab === 'cloud') openCloud();
}
async function openCloud() {
  const area = byId('cloud');
  if (!configured) {
    area.replaceChildren(
      node('h3', 'Cloud sync'),
      node(
        'p',
        'This journal is local to this browser. To enable private account sync, connect a Supabase project using the setup guide.'
      )
    );
    const guide = node('a', 'Cloud setup guide');
    guide.href = 'https://github.com/Lord80/aftercredits/blob/main/docs/phase-3b/README.md';
    guide.className = 'text-button';
    area.append(guide);
    return;
  }
  try {
    const ui = await import('./cloud/panel.js');
    if (tab === 'cloud' && dialog.open) ui.openCloud(area, download);
  } catch {
    message('Account tools could not open. Your local collection is available.', true);
  }
}
tabs.forEach((button) =>
  button.addEventListener('click', () => {
    if (tab !== button.dataset.vaultTab) openTab(button.dataset.vaultTab);
  })
);

function download(text, kind, at, ext) {
  const blob = new Blob([text], {
    type: ext === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = node('a');
  link.download = fileName(kind, at, ext);
  link.href = url;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
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
    tabs.find((button) => button.dataset.vaultTab === tab).focus();
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
  const describe = (e) => e.title + ' · ' + e.rating + '/10 · added ' + e.added;
  box.append(
    node('p', 'Local · ' + describe(row.current)),
    node('p', 'File · ' + describe(row.entry))
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
          'Local · ' +
            (JSON.stringify(row.current[k], null, 2) ?? 'Missing') +
            '\nFile · ' +
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
  label.append(choice, 'Use the file’s version of ' + row.entry.title);
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
  byId('apply').textContent = restore ? 'Confirm replacement' : 'Confirm merge';
}
function setMode(next) {
  mode = next;
  recoveryReceipt = null;
  byId('consent').checked = false;
  dialog.querySelector('input[name="vault-mode"][value="' + mode + '"]').checked = true;
  byId('mode-note').textContent =
    mode === 'merge'
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
byId('consent').addEventListener('change', enabled);

function startReview(report, name) {
  cancelPreview();
  message();
  source = name;
  preview = review(report);
  const { plan, notice } = preview;
  byId('preview').hidden = false;
  byId('preview-title').textContent = tab === 'recovery' ? 'Recovery preview' : 'Import preview';
  byId('source').textContent = name;
  const summary = byId('summary');
  summary.replaceChildren();
  for (const [label, value] of Object.entries({
    Total: report.total,
    Movies: report.movies,
    Series: report.series,
    New: plan.added,
    Duplicates: plan.duplicates,
    Conflicts: plan.conflicts.length,
    Invalid: report.invalid,
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
  dialog.querySelector('.vault-modes').hidden = tab === 'recovery';
  setMode(tab === 'recovery' ? 'restore' : 'merge');
  byId('preview-title').focus();
}
byId('file').addEventListener('change', async (event) => {
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
    const changed = await applyImport(
      preview,
      mode,
      new Set(accepted),
      recoveryReceipt,
      operation.signal
    );
    if (ticket !== generation) return;
    openTab(tab);
    refreshRoom();
    message(
      changed
        ? 'Collection saved locally. A pre-import snapshot is available in Recovery.'
        : 'Your collection already matches this backup.'
    );
    tabs.find((button) => button.dataset.vaultTab === tab).focus();
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
  openTab(tab);
  (tab === 'import' ? byId('file') : tabs[2]).focus();
  message('Preview cancelled. Your collection is intact.');
});
async function close() {
  if (closing) return;
  closing = true;
  cancelPreview();
  await hideDialog(dialog, byId('open'));
  history = null;
  byId('history').replaceChildren();
  closing = false;
  byId('open').focus({ preventScroll: true });
}
byId('close').onclick = close;
dialog.addEventListener('cancel', (e) => {
  e.preventDefault();
  close();
});
dialog.addEventListener('click', (event) => {
  if (event.target !== dialog) return;
  const r = dialog.getBoundingClientRect();
  if (
    event.clientX < r.left ||
    event.clientX > r.right ||
    event.clientY < r.top ||
    event.clientY > r.bottom
  )
    close();
});
function refreshVault(key) {
  if (!dialog.open) return;
  if (
    [null, STORAGE_KEY, LEGACY_KEY].includes(key) &&
    preview &&
    preview.base !== JSON.stringify(snapshot().items)
  ) {
    const report = preview.report;
    startReview(report, source);
    message('The local collection changed. Review this updated comparison before confirming.');
  }
  if ([null, STORAGE_KEY, LEGACY_KEY, HISTORY_KEY, STATUS_KEY].includes(key)) {
    overview();
    if (tab === 'recovery') drawHistory();
  }
}
window.addEventListener('storage', (event) => refreshVault(event.key));
window.addEventListener('cloud-collection', () => refreshVault(STORAGE_KEY));

export function openVault(refresh, syncControl, initialTab = 'export') {
  if (dialog.open || closing) return;
  refreshRoom = refresh;
  updateControl = syncControl;
  openTab(initialTab);
  showDialog(dialog, byId('open'));
  dialog.scrollTop = 0;
  byId('close').focus({ preventScroll: true });
}
