import { owner, session, sessionKey, reloadScope } from './scope.js';
import { signOut, updateDisplayName, resumeConnection } from './auth.js';
import { syncStatus, syncNow, conflictPreview, resolveConflicts } from './sync.js';
import { guestCount, guestPreview } from './guest-import.js';
import { authScreen, field } from './account-forms.js';
import { hideDialog, showDialog } from '../motion.js';
import { icon } from '../views.js';

const dialog = document.getElementById('account-dialog');
const heading = document.getElementById('account-heading');
const body = document.getElementById('account-body');
const trigger = document.getElementById('account-open');
const live = document.getElementById('account-message');
const closeButton = document.getElementById('account-close');
let openVault,
  cleanup,
  busy = false,
  closing = false,
  guestCopy;
const el = (tag, value) => {
  const node = document.createElement(tag);
  if (value !== undefined) node.textContent = value;
  return node;
};
function message(text, error = false) {
  live.textContent = text;
  live.toggleAttribute('data-error', error);
}
function page(title) {
  cleanup?.();
  cleanup = null;
  heading.textContent = title;
  body.replaceChildren();
  message('');
  dialog.scrollTop = 0;
  if (dialog.open) heading.focus({ preventScroll: true });
}
async function run(progress, work) {
  if (busy || closing) return;
  busy = true;
  body.setAttribute('aria-busy', 'true');
  closeButton.disabled = true;
  body.inert = true;
  const focused = document.activeElement;
  message(progress);
  try {
    await work();
    if (live.textContent === progress) message('');
  } catch (err) {
    message(err.message, true);
  } finally {
    body.inert = false;
    body.removeAttribute('aria-busy');
    closeButton.disabled = false;
    busy = false;
    if (
      dialog.open &&
      focused?.isConnected &&
      !body.contains(document.activeElement) &&
      document.activeElement !== heading
    )
      focused.focus({ preventScroll: true });
  }
}
function action(parent, label, fn, style = '', progress = 'Working…') {
  const b = el('button', label);
  b.type = 'button';
  b.className = style;
  if (parent.classList.contains('account-menu')) b.append(icon('next'));
  b.onclick = () => run(progress, fn);
  parent.append(b);
  return b;
}
async function close() {
  if (closing) return;
  closing = true;
  cleanup?.();
  cleanup = null;
  await hideDialog(dialog, trigger);
  body.replaceChildren();
  message('');
  guestCopy = null;
  trigger.focus({ preventScroll: true });
  closing = false;
}
closeButton.onclick = () => {
  if (!busy) close();
};
dialog.addEventListener('cancel', (e) => {
  e.preventDefault();
  if (!busy) close();
});
dialog.addEventListener('click', (e) => {
  if (e.target !== dialog || closing || busy) return;
  const r = dialog.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
    close();
});
async function leave() {
  const id = owner || session()?.id;
  document.body.classList.add('account-leaving');
  page('Signing out…');
  try {
    const remote = await signOut(id);
    try {
      if (!remote) sessionStorage.setItem('aftercredits.logout-note', '1');
    } catch {}
    reloadScope();
  } catch (error) {
    document.body.classList.remove('account-leaving');
    if (session()?.id !== id) return reloadScope();
    if (owner) connected();
    throw error;
  }
}
const labels = {
  Synced: 'Up to date',
  Syncing: 'Syncing…',
  Offline: 'Offline · saved on this device',
  'Pending changes': 'Waiting to sync',
  Conflict: 'Changes need review',
  Error: 'Sync paused',
};
function updateStatus() {
  if (!owner || !dialog.open) return;
  const label = body.querySelector('.cloud-state');
  if (!label) return;
  try {
    const state = syncStatus();
    label.textContent = labels[state.state] || 'Checking sync';
    const pending = body.querySelector('.account-pending');
    if (pending) pending.hidden = !state.pending;
    const review = body.querySelector('.cloud-review');
    if (review) review.hidden = state.state !== 'Conflict';
    const retry = body.querySelector('.cloud-retry');
    if (retry) retry.hidden = state.state !== 'Error';
    const summary = body.querySelector('.cloud-last');
    if (summary) {
      const info = [];
      if (state.last) info.push('Last synced ' + new Date(state.last).toLocaleString() + '.');
      if (state.pending)
        info.push(
          state.pending +
            (state.pending === 1 ? ' change' : ' changes') +
            ' saved on this device to sync.'
        );
      summary.textContent = info.join(' ');
      summary.hidden = !info.length;
    }
    const note = body.querySelector('.cloud-issue');
    if (note) {
      note.textContent =
        state.state === 'Error'
          ? 'Your local changes are safe. Check your connection and try syncing again.'
          : state.state === 'Conflict'
            ? 'A title changed on two devices. Choose the version to keep.'
            : '';
      note.hidden = !note.textContent;
    }
  } catch {
    label.textContent = 'Archive needs attention';
    message(
      'This browser could not read its saved copy. Open Data & backup to inspect the archive.',
      true
    );
  }
}
function menuList() {
  const list = el('div');
  list.className = 'account-menu';
  body.append(list);
  return list;
}
function statusBlock() {
  const state = el('strong');
  state.className = 'cloud-state';
  state.setAttribute('role', 'status');
  const note = el('p');
  note.className = 'cloud-issue';
  body.append(state, note);
}
function connected() {
  const s = session();
  if (!s || s.id !== owner) return reloadScope();
  page(s.displayName || 'Your account');
  body.append(el('p', s.email));
  statusBlock();
  const list = menuList();
  action(list, 'Review sync conflicts', conflicts, 'cloud-review');
  action(list, 'Retry sync', syncNow, 'cloud-retry');
  action(list, 'Settings', settings);
  action(list, 'Data & backup', async () => {
    await close();
    await openVault('export', trigger);
  });
  const count = guestCount();
  if (count)
    action(
      list,
      'Review guest titles (' + count + ')',
      async () => {
        const guest = guestPreview();
        await close();
        await openVault('import', trigger, guest);
      },
      '',
      'Checking guest titles…'
    );
  action(list, 'Sign out', leave, 'account-logout', 'Signing out…');
  const pending = el('p', 'Unsynced changes stay on this device for your next sign-in.');
  pending.className = 'account-pending';
  body.append(pending);
  updateStatus();
}
function settings() {
  const s = session();
  page('Settings');
  const form = el('form');
  form.className = 'cloud-form';
  const name = field(form, 'Display name', 'text', 'nickname', s.displayName || '');
  name.maxLength = 80;
  const save = el('button', 'Save name');
  save.className = 'button primary';
  form.append(save);
  form.onsubmit = (e) => {
    e.preventDefault();
    run('Saving name…', async () => {
      await updateDisplayName(owner, name.value);
      window.dispatchEvent(new Event('account-profile'));
      connected();
      message('Display name saved.');
    });
  };
  body.append(form);
  statusBlock();
  const last = el('p');
  last.className = 'cloud-last';
  body.append(
    last,
    el(
      'p',
      navigator.serviceWorker?.controller
        ? 'This archive is ready to reopen offline.'
        : 'Offline reopening is available once this device finishes saving the app.'
    )
  );
  const list = menuList();
  action(list, 'Sync now', syncNow, '', 'Syncing…');
  action(list, 'Back to account', connected);
  updateStatus();
}
function conflicts() {
  const p = conflictPreview();
  if (!p) return connected();
  page('Review changes');
  body.append(
    el('p', 'Choose the version to keep for each title. Your other titles will sync automatically.')
  );
  const choices = new Map();
  for (const group of p.conflicts) {
    const title = (group.local[0] || group.remote[0] || group.base[0]).title;
    const comparison = el('dl');
    comparison.className = 'account-comparison';
    for (const [source, entries] of [['This device', group.local], ['Cloud', group.remote]]) {
      const column = el('div');
      column.append(el('dt', source));
      if (!entries.length) column.append(el('dd', 'Deleted'));
      for (const entry of entries) {
        const rating = entry.rating.toFixed(1) + ' / 10';
        column.append(el('dd', entry.title === title ? rating : entry.title + ' · ' + rating));
      }
      comparison.append(column);
    }
    const detail = el('details');
    detail.append(el('summary', 'Compare all saved fields'));
    detail.ontoggle = () => {
      if (!detail.open || detail.childElementCount > 1) return;
      for (const [label, entries] of [
        ['Earlier', group.base],
        ['This device', group.local],
        ['Cloud', group.remote],
      ])
        detail.append(
          el('strong', label),
          el('pre', entries.length ? JSON.stringify(entries, null, 2) : 'Deleted / absent')
        );
    };
    const label = el('label', 'Version for ' + title);
    const select = el('select');
    for (const [text, value] of [
      ['Choose a version', ''],
      ['Keep this device', 'device'],
      ['Keep cloud', 'cloud'],
    ])
      select.add(new Option(text, value));
    select.onchange = () => {
      if (select.value) choices.set(group.key, select.value);
      else choices.delete(group.key);
      apply.disabled = choices.size !== p.conflicts.length;
    };
    label.append(select);
    body.append(el('h3', title), comparison, detail, label);
  }
  const apply = action(
    body,
    'Confirm resolutions',
    async () => {
      await resolveConflicts(p.token, choices);
      connected();
    },
    'button primary'
  );
  apply.disabled = true;
  action(body, 'Back to account', connected, 'account-link');
}
const ui = {
  el,
  body,
  page,
  message,
  action,
  run,
  onLeave: (fn) => {
    cleanup = fn;
  },
  guestCopyMatches: (items) => guestCopy === JSON.stringify(items),
  noteGuestCopy: (items) => {
    guestCopy = JSON.stringify(items);
  },
  authenticated(guestTitles) {
    try {
      if (guestTitles) {
        const key = 'aftercredits.guest-offer.' + session().id;
        if (!sessionStorage.getItem(key)) {
          sessionStorage.setItem(key, '1');
          sessionStorage.setItem('aftercredits.guest-tip', session().id);
        }
      }
    } catch {}
    reloadScope();
  },
};
export function openAccount(vault) {
  if (dialog.open || closing) return;
  openVault = vault;
  showDialog(dialog, trigger);
  if (owner) connected();
  else if (session()) {
    page('Open your archive');
    action(
      body,
      'Continue',
      async () => {
        await resumeConnection(session()?.id);
        reloadScope();
      },
      'button primary'
    );
    action(body, 'Sign out', leave, 'account-link');
  } else {
    authScreen(ui);
    try {
      if (sessionStorage.getItem('aftercredits.session-ended')) {
        sessionStorage.removeItem('aftercredits.session-ended');
        message(
          'Your session ended. Sign in to reopen your archive. Unsynced changes stay on this device.'
        );
      } else if (sessionStorage.getItem('aftercredits.logout-note')) {
        sessionStorage.removeItem('aftercredits.logout-note');
        message('Signed out on this device. The server could not be reached.');
      }
    } catch {}
  }
}
window.addEventListener('cloud-state', updateStatus);
window.addEventListener('storage', (e) => {
  if (
    e.key === sessionKey &&
    owner &&
    dialog.open &&
    body.querySelector('.account-logout') &&
    session()?.id === owner
  )
    heading.textContent = session().displayName || 'Your account';
});
