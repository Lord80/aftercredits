import { owner, configured, session, sessionKey, reloadScope } from './scope.js';
import { hideDialog, showDialog } from '../motion.js';
import { icon } from '../views.js';
import { sorts } from '../discovery.js';

const byId = (id) => document.getElementById(id);
const dialog = byId('account-dialog'),
  heading = byId('account-heading'),
  body = byId('account-body');
const live = byId('account-message'),
  nav = byId('center-nav'),
  exit = byId('center-signout');
const headings = {
  overview: 'Overview',
  profile: 'Profile',
  preferences: 'Preferences',
  data: 'Data & backup',
  security: 'Security',
  auth: 'Sign in',
};
let app,
  trigger,
  current,
  cleanup,
  guestCopy,
  vault,
  cloud,
  busy = false,
  closing = false,
  version = 0;
function el(tag, value, style) {
  const element = document.createElement(tag);
  if (value !== undefined) element.textContent = value;
  if (style) element.className = style;
  return element;
}
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
  heading.parentElement.scrollTop = 0;
  if (dialog.open) heading.focus({ preventScroll: true });
}
async function run(progress, work) {
  if (busy || closing) return;
  busy = true;
  body.setAttribute('aria-busy', 'true');
  const focus = document.activeElement;
  body.inert = true;
  nav.inert = true;
  byId('center-guest').disabled = true;
  exit.disabled = byId('account-close').disabled = true;
  message(progress);
  try {
    await work();
    if (live.textContent === progress) message('');
  } catch (error) {
    message(error.message || 'Please try again.', true);
  } finally {
    busy = false;
    body.inert = nav.inert = byId('center-guest').disabled = false;
    exit.disabled = byId('account-close').disabled = false;
    body.removeAttribute('aria-busy');
    if (dialog.open && document.activeElement === document.body)
      (focus?.isConnected ? focus : heading).focus({ preventScroll: true });
  }
}
function action(parent, label, work, style = 'account-link', progress = '') {
  const button = el('button', label, style);
  button.type = 'button';
  button.onclick = () => run(progress, work);
  parent.append(button);
  return button;
}
async function close() {
  if (closing || busy) return;
  closing = true;
  version++;
  cleanup?.();
  cleanup = null;
  vault?.closeData();
  await hideDialog(dialog, trigger);
  body.replaceChildren();
  guestCopy = null;
  current = null;
  trigger.focus({ preventScroll: true });
  closing = false;
}
byId('account-close').onclick = close;
dialog.oncancel = (event) => {
  event.preventDefault();
  close();
};
dialog.onclick = (event) => {
  if (event.target !== dialog) return;
  const r = dialog.getBoundingClientRect();
  if (
    event.clientX < r.left ||
    event.clientX > r.right ||
    event.clientY < r.top ||
    event.clientY > r.bottom
  )
    close();
};
async function leave() {
  const id = owner || session()?.id;
  const { signOut } = await import('./auth.js');
  window.dispatchEvent(new Event('cloud-signing-out'));
  document.body.classList.add('account-leaving');
  vault?.closeData();
  page('Signing out…');
  try {
    const remote = await signOut(id);
    try {
      if (!remote) sessionStorage.setItem('aftercredits.logout-note', '1');
    } catch {}
    reloadScope();
  } catch (error) {
    if (session()?.id !== id) return reloadScope();
    document.body.classList.remove('account-leaving');
    window.dispatchEvent(new Event('cloud-signout-cancelled'));
    await navigate('security');
    throw error;
  }
}
exit.onclick = () => run('Signing out…', leave);
nav.onclick = (event) => {
  const button = event.target.closest('[data-center]');
  if (!button || busy || closing) return;
  const section = button.dataset.center;
  if (section !== current || heading.textContent !== headings[section]) navigate(section);
};
byId('center-guest').onclick = () => {
  if (!busy && !closing) navigate('overview');
};
function identity() {
  const s = owner && session();
  if (owner && (!s || s.id !== owner)) {
    reloadScope();
    return {};
  }
  const name = s ? s.displayName || s.email.split('@')[0] : 'Guest journal';
  const initials = Array.from(name.trim().split(/\s+/u).slice(0, 2), (part) => Array.from(part)[0])
    .join('')
    .toLocaleUpperCase();
  return { name, email: s?.email, initials };
}
function profileCard(counts) {
  const { name, email, initials } = identity();
  const card = el('div', undefined, 'archive-pass');
  const avatar = el('span', undefined, 'center-avatar');
  if (owner) avatar.textContent = initials;
  else avatar.append(icon('person'));
  avatar.setAttribute('aria-hidden', 'true');
  const caption = el('div', undefined, 'pass-caption');
  const title = el('strong', name);
  title.id = 'center-name';
  caption.append(title, el('small', email || 'On this device'));
  card.append(avatar, caption);
  if (counts) {
    const ledger = el('dl', undefined, 'center-counts');
    for (const [type, label] of [
      ['movie', 'Movies'],
      ['tv', 'TV series'],
    ]) {
      const pair = el('div'),
        count = el('dd', app.counts()[type]);
      count.id = 'center-' + type;
      pair.append(el('dt', label), count);
      ledger.append(pair);
    }
    card.append(ledger);
  }
  body.append(card);
}
function updateStatus() {
  const label = body.querySelector('.cloud-state');
  if (!dialog.open || !label) return;
  let title = 'Saved on this device';
  let note = 'Your guest journal is local to this browser.';
  let retry = false,
    review = false,
    diagnostic = '';
  if (owner) {
    try {
      const s = cloud.syncStatus();
      review = s.state === 'Conflict';
      retry = s.state === 'Error';
      if (review || retry) {
        title = 'Needs attention';
        note = review
          ? 'A title changed in two places. Choose which version to keep.'
          : 'Your copy is on this device. Automatic saving needs another try.';
        diagnostic = s.error;
      } else if (s.state === 'Offline') {
        title = s.last || s.pending || s.inFlight ? 'Offline · saved on this device' : 'Offline';
        note = s.last
          ? 'Changes will sync when you reopen or reconnect.'
          : 'Reconnect to download your private archive.';
      } else if (s.pending || s.inFlight || !s.last) {
        title = s.pending || s.inFlight ? 'Saving changes' : 'Opening your archive';
        note = 'You can keep using your collection.';
      } else {
        title = 'All changes saved';
        note = 'Your private archive is up to date.';
      }
    } catch {
      title = 'Needs attention';
      note = 'This browser could not read its saved copy.';
    }
  }
  if (app.storageNotice()) {
    title = 'Check device storage';
    note = app.storageNotice();
  }
  for (const [node, text] of [
    [label, title],
    [body.querySelector('.cloud-issue'), note],
  ])
    if (node.textContent !== text) node.textContent = text;
  body.querySelector('.save-state').dataset.attention = String(
    retry || review || !!app.storageNotice()
  );
  body.querySelector('.cloud-review').hidden = !review;
  body.querySelector('.cloud-retry').hidden = !retry;
  const details = body.querySelector('.cloud-diagnostic');
  details.hidden = !diagnostic;
  details.lastChild.textContent = diagnostic || '';
}
function statusBlock() {
  const block = el('div', undefined, 'save-state'),
    copy = el('div');
  const label = el('strong', undefined, 'cloud-state');
  label.setAttribute('role', 'status');
  copy.append(label, el('p', undefined, 'cloud-issue'));
  block.append(icon('check'), copy);
  action(copy, 'Review changes', conflicts, 'cloud-review account-link');
  action(copy, 'Try again', () => cloud.syncNow(), 'cloud-retry account-link');
  const details = el('details', undefined, 'cloud-diagnostic');
  details.append(el('summary', 'Technical details'), el('p'));
  copy.append(details);
  body.append(block);
  updateStatus();
}
function guestAccess() {
  if (configured) action(body, 'Sign in', () => navigate('auth'), 'button primary');
}
function overview() {
  profileCard(true);
  statusBlock();
  if (!owner) guestAccess();
}
async function profile(ticket) {
  profileCard(false);
  if (!owner) {
    guestAccess();
    return;
  }
  const [{ field }, { updateDisplayName }] = await Promise.all([
    import('./account-forms.js'),
    import('./auth.js'),
  ]);
  if (ticket !== version) return;
  const form = el('form', undefined, 'cloud-form');
  const name = field(form, 'Display name', 'text', 'nickname', session().displayName || '');
  name.maxLength = 80;
  name.pattern = '.*\\S.*';
  const email = field(form, 'Email', 'email', 'email', session().email);
  email.readOnly = true;
  form.append(el('button', 'Save name', 'button primary'));
  form.onsubmit = (event) => {
    event.preventDefault();
    run('Saving name…', async () => {
      await updateDisplayName(owner, name.value);
      window.dispatchEvent(new Event('account-profile'));
      await navigate('profile');
      message('Display name saved.');
    });
  };
  body.append(form);
}
function preferences() {
  const form = el('div', undefined, 'center-prefs');
  function select(id, label, options, value, save) {
    const wrap = el('div'),
      caption = el('label', label),
      input = el('select');
    input.id = 'preference-' + id;
    caption.htmlFor = input.id;
    for (const [key, text] of options) input.add(new Option(text, key));
    input.value = value;
    input.onchange = () => save(input.value);
    wrap.append(caption, input);
    form.append(wrap);
  }
  select(
    'layout',
    'Collection layout',
    [
      ['screening', 'Screening Room'],
      ['gallery', 'Gallery'],
      ['compact', 'Compact'],
    ],
    app.prefs.layout,
    app.setLayout
  );
  select('movie-sort', 'Movie sort order', sorts, app.prefs.movie.sort, (value) =>
    app.setSort('movie', value)
  );
  select('tv-sort', 'TV series sort order', sorts, app.prefs.tv.sort, (value) =>
    app.setSort('tv', value)
  );
  const label = el('label', undefined, 'ambient-choice'),
    check = el('input');
  check.type = 'checkbox';
  const caption = el('span', 'Ambient motion');
  const note = el('small');
  caption.append(note);
  label.append(caption, check);
  function sync() {
    check.checked = app.ambient.enabled();
    check.disabled = app.ambient.forced();
    note.textContent = check.disabled
      ? 'Paused by your device’s motion or performance settings.'
      : 'Gentle movement in the cinema street.';
  }
  sync();
  check.onchange = () => app.ambient.setEnabled(check.checked);
  window.addEventListener('ambient-change', sync);
  cleanup = () => window.removeEventListener('ambient-change', sync);
  form.append(label);
  body.append(form);
}
function security() {
  if (!owner) {
    body.append(
      el(
        'p',
        configured
          ? 'Sign in to manage your password.'
          : 'This journal uses guest storage on this device.'
      )
    );
    guestAccess();
    return;
  }
  body.append(el('p', 'Manage access to ' + session().email + '.'));
  action(
    body,
    'Reset password',
    async () => {
      const { authScreen } = await import('./account-forms.js');
      authScreen(
        {
          ...ui,
          security: () => {
            page('Security');
            security();
          },
        },
        'recover',
        session().email
      );
    },
    'button secondary'
  );
  body.append(el('p', 'Signing out keeps pending changes on this device for your next sign-in.'));
  action(body, 'Sign out of this device', leave, 'account-link');
}
async function conflicts() {
  vault?.closeData();
  const section = current;
  const { reviewChanges } = await import('./conflict-view.js');
  await reviewChanges(
    ui,
    cloud,
    () => navigate(section),
    section === 'data' ? 'Back to data & backup' : 'Back to overview'
  );
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
async function navigate(section) {
  const ticket = ++version;
  current = section;
  if (vault && !byId('vault').hidden) vault.closeData();
  dialog.dataset.sectionName = section;
  for (const btn of nav.querySelectorAll('button')) {
    if (btn.dataset.center === section) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  }
  exit.hidden = !owner;
  page(headings[section]);
  try {
    if (owner) {
      cloud ||= await import('./sync.js');
      if (ticket !== version) return;
    }
    if (section === 'overview') overview();
    else if (section === 'profile') await profile(ticket);
    else if (section === 'preferences') preferences();
    else if (section === 'security') security();
    else if (section === 'data') {
      const [data, guest] = await Promise.all([
        import('../vault.js'),
        owner ? import('./guest-import.js') : null,
      ]);
      if (ticket !== version) return;
      vault = data;
      statusBlock();
      vault.openData(app.refresh, app.updateVaultControl, guest);
    } else if (section === 'auth') {
      if (session() && !owner) {
        page('Open your archive');
        action(
          body,
          'Continue',
          async () => {
            const { resumeConnection } = await import('./auth.js');
            await resumeConnection(session().id);
            reloadScope();
          },
          'button primary'
        );
        action(body, 'Sign out', leave);
        return;
      }
      const { authScreen } = await import('./account-forms.js');
      if (ticket !== version) return;
      authScreen(ui);
      try {
        for (const [key, text] of [
          [
            'aftercredits.session-ended',
            'Your session ended. Sign in to reopen your archive. Unsynced changes stay on this device.',
          ],
          [
            'aftercredits.logout-note',
            'Signed out on this device. The server could not be reached.',
          ],
        ])
          if (sessionStorage.getItem(key)) {
            sessionStorage.removeItem(key);
            message(text);
            break;
          }
      } catch {}
    }
  } catch (error) {
    if (ticket === version)
      message(error.message || 'This section could not open. Try again.', true);
  }
}
export async function openAccount(section, opener, controls) {
  if (closing || dialog.open) return;
  app = controls;
  trigger = opener;
  showDialog(dialog, trigger);
  await navigate(section);
}
window.addEventListener('cloud-state', updateStatus);
window.addEventListener('archive-updated', () => {
  if (!dialog.open) return;
  for (const [type, count] of Object.entries(app.counts())) {
    const elem = byId('center-' + type);
    if (elem) elem.textContent = count;
  }
  updateStatus();
});
window.addEventListener('storage', (event) => {
  if (
    dialog.open &&
    current === 'overview' &&
    owner &&
    event.key === sessionKey &&
    session()?.id === owner
  ) {
    const title = byId('center-name');
    if (title) {
      const { name, initials } = identity();
      title.textContent = name;
      body.querySelector('.center-avatar').textContent = initials;
    }
  }
});
