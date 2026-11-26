import { accountKey, owner, session, reloadScope } from './scope.js';
import { activateSession, signIn, signOut, requestRecovery, resetPassword } from './auth.js';
import { active } from './cache.js';
import {
  previewMigration,
  migrationBackup,
  connect,
  syncStatus,
  syncNow,
  conflictPreview,
  resolveConflicts,
} from './sync.js';

function el(tag, text) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  return e;
}
let area,
  download,
  version = 0,
  preview,
  hasCopy = false,
  waiting = false;
const status = () => area.querySelector('.cloud-message');
function say(text, error = false) {
  const node = status();
  if (!node) return;
  node.textContent = text;
  node.toggleAttribute('data-error', error);
}
function reload() {
  try {
    sessionStorage.setItem('aftercredits.open-account', '1');
  } catch {}
  reloadScope();
}
function section(title, copy) {
  const block = el('div');
  block.className = 'cloud-section';
  block.append(el('h3', title));
  if (copy) block.append(el('p', copy));
  return block;
}
function button(text, action, primary = false) {
  const b = el('button', text);
  b.type = 'button';
  b.className = 'button ' + (primary ? 'primary' : 'secondary');
  b.onclick = () => run(action);
  return b;
}
async function run(action) {
  if (waiting) return;
  waiting = true;
  const v = version;
  area.setAttribute('aria-busy', 'true');
  say('Working…');
  try {
    await action();
    if (v === version && status()?.textContent === 'Working…') say('');
  } catch (e) {
    if (v === version) say(e.message, true);
  } finally {
    waiting = false;
    area.removeAttribute('aria-busy');
  }
}
function input(form, label, type, autocomplete) {
  const wrap = el('label', label),
    field = el('input');
  field.type = type;
  field.autocomplete = autocomplete;
  field.required = true;
  wrap.append(field);
  form.append(wrap);
  return field;
}
function base() {
  const restoreFocus = area.contains(document.activeElement);
  if (restoreFocus)
    queueMicrotask(() => {
      const heading = area.querySelector('h3');
      if (heading && !area.hidden) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
      }
    });
  version++;
  area.replaceChildren();
  const message = el('p');
  message.className = 'cloud-message';
  message.setAttribute('role', 'status');
  area.append(message);
}
function add(node) {
  area.insertBefore(node, status());
}
function authForm(recovery = false) {
  base();
  const block = section(
    recovery ? 'Recover your account' : 'Your private archive',
    recovery
      ? 'Request an email code, then enter it with a new password.'
      : 'Sign in to compare this browser with your private cloud collection. Guest titles stay here until you choose to copy them.'
  );
  const form = el('form');
  form.className = 'cloud-form';
  const email = input(form, 'Email', 'email', 'username');
  if (recovery)
    form.append(
      button('Send recovery code', async () => {
        if (!email.reportValidity()) return;
        await requestRecovery(email.value.trim());
        say('If this account exists, check your email for the recovery code.');
      })
    );
  const code = recovery ? input(form, 'Recovery code', 'text', 'one-time-code') : null;
  const password = input(
    form,
    recovery ? 'New password' : 'Password',
    'password',
    recovery ? 'new-password' : 'current-password'
  );
  const submit = el('button', recovery ? 'Set new password' : 'Sign in');
  submit.className = 'button primary';
  form.append(submit);
  form.onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      const pass = password.value;
      password.value = '';
      if (recovery) {
        await resetPassword(email.value.trim(), code.value.trim(), pass);
        authForm();
        say('Password updated. Sign in to continue.');
      } else {
        await signIn(email.value.trim(), pass);
        reload();
      }
    });
  };
  block.append(
    form,
    button(recovery ? 'Back to sign in' : 'Forgot password?', () => authForm(!recovery))
  );
  add(block);
}
function switchOut() {
  // Hide any account contents as soon as sign-out is requested.
  document.documentElement.style.visibility = 'hidden';
  return signOut()
    .then((remote) => {
      try {
        if (!remote) sessionStorage.setItem('aftercredits.logout-note', '1');
      } catch {}
      reload();
    })
    .catch((error) => {
      document.documentElement.style.visibility = '';
      throw error;
    });
}
function accountLine(s) {
  const line = el('div');
  line.className = 'cloud-identity';
  line.append(el('strong', s.email), button('Sign out', switchOut));
  add(line);
}
function details(title, groups) {
  const d = el('details'),
    summary = el('summary', title);
  d.append(summary);
  d.ontoggle = () => {
    if (!d.open || d.childElementCount > 1) return;
    for (const [name, list] of groups) {
      d.append(
        el('strong', name),
        el('pre', list.length ? JSON.stringify(list, null, 2) : 'Deleted / absent')
      );
    }
  };
  return d;
}
function choice(text) {
  const label = el('label'),
    input = el('input');
  input.type = 'checkbox';
  label.className = 'cloud-choice';
  label.append(input, text);
  return { label, input };
}
function migration(s) {
  base();
  accountLine(s);
  const block = section(
    'Connect this device',
    'Review the guest and cloud archives before connecting. Your original guest collection stays available after sign-out.'
  );
  add(block);
  if (localStorage.getItem(accountKey(s.id)) !== null) {
    block.append(
      button(
        'Open saved account archive',
        async () => {
          await activateSession(s.id);
          reload();
        },
        true
      )
    );
    return;
  }
  block.append(
    button(
      'Compare collections',
      async () => {
        preview = await previewMigration(s.id);
        hasCopy = false;
        drawMigration(s);
      },
      true
    )
  );
}
function drawMigration(s) {
  base();
  accountLine(s);
  const p = preview,
    plan = p.plan,
    accepted = new Set();
  const block = section(
    'Connection preview',
    active(p.remote.rows).length +
      ' cloud titles · ' +
      plan.added +
      ' new guest titles · ' +
      plan.duplicates +
      ' duplicates · ' +
      plan.conflicts.length +
      ' conflicts.'
  );
  if (p.deleted.length)
    block.append(
      el('p', p.deleted.length + ' previously deleted cloud titles will stay in the guest archive.')
    );
  const include = choice('Copy new guest titles into this account');
  block.append(include.label);
  const options = el('div');
  options.hidden = true;
  include.input.onchange = () => {
    options.hidden = !include.input.checked;
  };
  options.append(el('p', 'Existing cloud versions are kept unless you select a guest version.'));
  for (const row of plan.conflicts) {
    options.append(
      details(row.entry.title, [
        ['Guest', [row.entry]],
        ['Cloud', [row.current]],
      ])
    );
    if (!row.ambiguous) {
      const use = choice('Use guest version of ' + row.entry.title);
      options.append(use.label);
      use.input.onchange = () =>
        use.input.checked ? accepted.add(row.entry.id) : accepted.delete(row.entry.id);
    }
  }
  block.append(options);
  const confirm = button(
    'Confirm connection',
    async () => {
      await connect(p, include.input.checked, accepted);
      reload();
    },
    true
  );
  confirm.disabled = !hasCopy;
  block.append(
    button('Download guest recovery JSON', async () => {
      await migrationBackup(p, (data, at) => download(data, 'before-cloud', at, 'json'));
      hasCopy = true;
      confirm.disabled = false;
      say('Recovery JSON generated. Check your downloads before confirming.');
    }),
    confirm,
    button('Cancel preview', () => {
      preview = null;
      migration(s);
    })
  );
  add(block);
}
function updateStatus() {
  if (!area?.isConnected || area.hidden || !owner) return;
  const label = area.querySelector('.cloud-state'),
    when = area.querySelector('.cloud-last');
  if (!label) return;
  try {
    const state = syncStatus();
    label.textContent = state.state + (state.pending ? ' · ' + state.pending + ' pending' : '');
    when.textContent = state.last
      ? 'Last successful sync · ' + new Date(state.last).toLocaleString()
      : 'No completed synchronization yet.';
    const shell = area.querySelector('.cloud-shell');
    if (shell)
      shell.textContent = navigator.serviceWorker?.controller
        ? 'Offline opening is ready on this device.'
        : 'Offline opening becomes available once this browser caches the app.';
    area.querySelector('.cloud-review').hidden = state.state !== 'Conflict';
    if (state.error) say(state.error, true);
    else if (status()?.hasAttribute('data-error')) say('');
  } catch {
    say('The account cache could not be read. Its data is protected.', true);
  }
}
function connected(s) {
  base();
  accountLine(s);
  const block = section(
    'Account archive',
    'Changes are saved on this device first. Keep independent JSON backups in Export.'
  );
  const label = el('strong'),
    when = el('p');
  label.className = 'cloud-state';
  label.setAttribute('role', 'status');
  when.className = 'cloud-last';
  const inspect = button('Review sync conflicts', () => conflicts(s));
  inspect.classList.add('cloud-review');
  inspect.hidden = true;
  block.append(
    label,
    when,
    button(
      'Sync now',
      async () => {
        await syncNow();
        updateStatus();
      },
      true
    ),
    inspect
  );
  const shell = el('p');
  shell.className = 'cloud-shell';
  block.append(shell);
  block.append(
    el(
      'p',
      'Signing out returns to the guest journal. Pending changes stay on this device for your next sign-in.'
    )
  );
  add(block);
  updateStatus();
}
function conflicts(s) {
  const p = conflictPreview();
  if (!p) {
    connected(s);
    return;
  }
  base();
  accountLine(s);
  const block = section(
    'Resolve changes',
    'Choose which version to keep for each group. Other titles merge automatically. Open a comparison to inspect exact ratings, dates and metadata.'
  );
  const choices = new Map();
  const apply = button(
    'Confirm resolutions',
    async () => {
      await resolveConflicts(p.token, choices);
      connected(s);
    },
    true
  );
  apply.disabled = p.conflicts.length > 0;
  for (const g of p.conflicts) {
    const title = (g.local[0] || g.remote[0] || g.base[0]).title;
    block.append(
      details(title, [
        ['Earlier version', g.base],
        ['This device', g.local],
        ['Cloud', g.remote],
      ])
    );
    const label = el('label', 'Version for ' + title + ' '),
      select = el('select');
    for (const [value, text] of [
      ['', 'Choose a version'],
      ['device', 'Keep this device'],
      ['cloud', 'Keep cloud'],
    ]) {
      const o = el('option', text);
      o.value = value;
      select.append(o);
    }
    select.onchange = () => {
      if (select.value) choices.set(g.key, select.value);
      else choices.delete(g.key);
      apply.disabled = choices.size !== p.conflicts.length;
    };
    label.append(select);
    block.append(label);
  }
  block.append(
    apply,
    button('Back to account', () => connected(s))
  );
  add(block);
}
export function openCloud(node, saveDownload) {
  area = node;
  download = saveDownload;
  const s = session();
  if (!s) {
    authForm();
    try {
      if (sessionStorage.getItem('aftercredits.session-ended')) {
        sessionStorage.removeItem('aftercredits.session-ended');
        say('Your session ended. Sign in again to reopen your archive and its pending edits.');
      } else if (sessionStorage.getItem('aftercredits.logout-note')) {
        sessionStorage.removeItem('aftercredits.logout-note');
        say('Signed out on this browser. The server could not confirm session revocation.');
      }
    } catch {}
  } else if (owner) connected(s);
  else migration(s);
}
window.addEventListener('cloud-state', updateStatus);
navigator.serviceWorker?.addEventListener('controllerchange', updateStatus);
