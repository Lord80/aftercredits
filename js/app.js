import { owner, configured, reloadScope, session, sessionKey } from './cloud/scope.js';
import { changeMovie, snapshot, STORAGE_KEY, initialize, LEGACY_KEY } from './collection.js';
import {
  entrance,
  editedFrame,
  setupAtmosphere,
  prepareCounters,
  play,
  canMove,
  timing,
  hideDialog,
  accentRating,
  removeFrame,
  showDialog,
  statistic,
} from './motion.js';
import { backupStatus, reminderDue, STATUS_KEY } from './vault-status.js';
import { indexCollection, runQuery } from './discovery.js';
import { loadPreferences, persistPreferences } from './discovery-preferences.js';
import { setupDiscovery } from './discovery-controls.js';
import { createLibrary, pageSizes } from './library.js';
import {
  arrangeStage,
  cueFrame,
  currentFrame,
  rememberFrame,
  latestFrame,
  stepFrame,
} from './stage.js';
import { startPicker, stopPicker, focusPicker, selection } from './picker.js';
import { icon, presentDetails } from './views.js';

const byId = (id) => document.getElementById(id);
const results = byId('results');
const query = byId('query');
const order = byId('order');
const editor = byId('editor');
const confirm = byId('confirm');
const title = byId('title');
const rating = byId('rating');
const formError = byId('form-error');
let movies = [];
let section = 'movie';
let subject = null;
let originalEntry;
let opener = null;
let busy = false;
let renderFrame;
const prefs = loadPreferences();
for (const [type, id] of Object.entries(prefs.frames)) rememberFrame(type, id);
let groups = indexCollection([]),
  groupEntries = { movie: [], tv: [] },
  selected = [],
  page = 0;
let lastGroup, lastQuery;
const controls = setupDiscovery({
  getState: () => prefs[section],
  getRows: () => groups[section],
  update(state) {
    prefs[section] = state;
    page = 0;
    persistPreferences(prefs);
    render();
  },
});
const drawLibrary = createLibrary(results, (destination) => {
  page = destination;
  if (prefs.layout === 'screening')
    rememberFrame(section, selected[page * pageSizes.screening]?.id);
  render();
});
let drawing = false;
function drawPage() {
  drawing = true;
  try {
    drawLibrary(selected, prefs.layout, page, groups[section].length, section);
  } finally {
    drawing = false;
  }
}
function ensurePage(id, chosen) {
  if (chosen && prefs.frames[section] !== id) {
    prefs.frames[section] = id;
    persistPreferences(prefs);
  }
  const position = selected.findIndex((e) => e.id === id);
  if (position >= 0 && Math.floor(position / pageSizes.screening) !== page) {
    page = Math.floor(position / pageSizes.screening);
    drawPage();
  }
}
let records = new Map();
const lens = document.createElement('i');
lens.className = 'tab-lens';
lens.setAttribute('aria-hidden', 'true');
let toastTimer;

function updateVaultControl() {
  const due = reminderDue(backupStatus());
  const control = byId('vault-open');
  control.toggleAttribute('data-due', due);
  control.setAttribute('aria-label', due ? 'Data Vault, backup reminder' : 'Data Vault');
}
async function openDataVault(tab, trigger, guest) {
  try {
    const { openVault } = await import('./vault.js');
    openVault(() => refresh(), updateVaultControl, tab, trigger, guest);
  } catch {
    feedback('The Data Vault could not open. Try again.');
  }
}
byId('vault-open').addEventListener('click', () => openDataVault('export'));
function refresh(state = snapshot()) {
  updateVaultControl();
  // A storage read parses new objects. Keep equal snapshots referentially stable for the strip and stage.
  const next = new Map();
  const previous = movies;
  movies = state.items.map((item) => {
    const prior = records.get(item.id);
    const bytes = prior?.item === item ? prior.bytes : JSON.stringify(item);
    const record = prior?.bytes === bytes ? prior : { bytes, item };
    next.set(item.id, record);
    return record.item;
  });
  records = next;
  if (previous.length !== movies.length || movies.some((entry, i) => entry !== previous[i])) {
    groups = indexCollection(movies);
    groupEntries = { movie: groups.movie.map((r) => r.entry), tv: groups.tv.map((r) => r.entry) };
  }
  byId('storage-note').textContent = state.notice;
  byId('storage-note').hidden = !state.notice;
  statistic(byId('total'), movies.length, (n) => String(Math.round(n)).padStart(2, '0'));
  const mean = movies.length
    ? movies.reduce((sum, film) => sum + film.rating, 0) / movies.length
    : null;
  statistic(byId('average'), mean, (n) => (n === null ? '—' : n.toFixed(1)));
  byId('movie-count').textContent = groups.movie.length;
  byId('tv-count').textContent = groups.tv.length;
  render();
}

function render() {
  cancelAnimationFrame(renderFrame);
  controls.sync();
  document.body.dataset.currentSection = section;
  document.body.dataset.browse = prefs.layout;
  const screening = prefs.layout === 'screening';
  byId('opening').hidden = !screening;
  byId('collection-title').setAttribute('aria-level', screening ? '2' : '1');
  document
    .querySelectorAll('a.brand,a.footer-brand')
    .forEach((a) => a.setAttribute('href', screening ? '#opening' : '#collection'));
  document
    .querySelectorAll('[data-layout]')
    .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.layout === prefs.layout)));
  document
    .querySelectorAll('[data-section]')
    .forEach((button) =>
      button.setAttribute('aria-pressed', String(button.dataset.section === section))
    );
  const tab = document.querySelector('[data-section="' + section + '"]');
  if (lens.parentNode !== tab) {
    const from = lens.isConnected && canMove() && lens.getBoundingClientRect();
    tab.prepend(lens);
    if (from) {
      const to = tab.getBoundingClientRect();
      play(
        lens,
        [
          {
            transform:
              'translateX(' + (from.left - to.left) + 'px) scaleX(' + from.width / to.width + ')',
          },
          { transform: 'none' },
        ],
        { duration: timing.shift }
      );
    }
  }
  if (groups[section] !== lastGroup || prefs[section] !== lastQuery) {
    lastGroup = groups[section];
    lastQuery = prefs[section];
    selected = runQuery(lastGroup, lastQuery);
  }
  page = Math.max(0, Math.min(page, Math.ceil(selected.length / pageSizes[prefs.layout]) - 1));
  drawPage();
  if (screening) arrangeStage(selected, groupEntries[section], section, ensurePage);
}

function highlightRating() {
  const value = rating.valueAsNumber;
  const score = byId('score');
  const direction = Math.sign(value - Number(score.textContent));
  if (editor.open && direction) accentRating(score, direction, value >= 9);
  rating.closest('.meter').toggleAttribute('data-high', value >= 9);
  score.textContent = value.toFixed(1);
  const meter = rating.closest('.meter');
  meter.style.setProperty('--sweep', (value - 1) * 30 + 'deg');
  meter.style.setProperty('--progress', ((value - 1) / 9) * 100 + '%');
  rating.setAttribute('aria-valuetext', value + ' out of 10');
  byId('increase').disabled = value >= 10;
  byId('decrease').disabled = value <= 1;
}

function fitEditor() {
  const viewport = window.visualViewport;
  const visual = viewport && viewport.scale === 1;
  const height = visual ? viewport.height : window.innerHeight;
  editor.toggleAttribute('data-tight', height <= 740);
  editor.toggleAttribute('data-short', height <= 480);
  if (height <= 740) {
    editor.style.setProperty('--usable-height', height + 'px');
    const inset = visual ? Math.max(0, window.innerHeight - height - viewport.offsetTop) : 0;
    editor.style.setProperty('--keyboard-inset', inset + 'px');
  }
}
function resizeEditor() {
  if (editor.open) fitEditor();
}
window.addEventListener('resize', resizeEditor);
window.visualViewport?.addEventListener('resize', resizeEditor);
window.visualViewport?.addEventListener('scroll', resizeEditor);

function openPanel(action, film, button) {
  subject = film?.id ?? null;
  originalEntry = film;
  opener = button;
  if (action === 'details') {
    const dialog = byId('detail-dialog');
    button.setAttribute('aria-expanded', 'true');
    presentDetails(dialog, film);
    showDialog(dialog, button, film.id);
    dialog.querySelector('.detail-close').focus({ preventScroll: true });
    return;
  }
  prepareCounters();
  if (action === 'delete') {
    byId('delete-copy').textContent = '“' + film.title + '” will be deleted from your collection.';
    showDialog(confirm, button);
    byId('keep').focus();
    return;
  }
  byId('editor-heading').textContent = film ? 'Edit title' : 'Add a title';
  byId('save').textContent = film ? 'Save changes' : 'Save title';
  title.value = film?.title || '';
  rating.value = film?.rating ?? 7;
  formError.textContent = '';
  title.removeAttribute('aria-invalid');
  highlightRating();
  startPicker(film?.mediaType ?? section, Boolean(film));
  fitEditor();
  showDialog(editor, button);
  focusPicker();
}

async function closePanel(dialog, updateCollection) {
  if (dialog === editor) stopPicker();
  const previousCard = opener?.closest('[data-film]');
  const neighborId = (previousCard?.nextElementSibling ?? previousCard?.previousElementSibling)
    ?.dataset.film;
  await hideDialog(dialog, opener, subject);
  if (dialog.id === 'detail-dialog') opener?.setAttribute('aria-expanded', 'false');
  updateCollection?.();
  let target = opener;
  if (!target?.isConnected || target.hidden) {
    const cards = [...results.querySelectorAll('[data-film]')];
    const current = cards.find((card) => card.dataset.film === subject);
    const neighbor = cards.find((card) => card.dataset.film === neighborId);
    target =
      [...(current?.querySelectorAll('button') ?? [])].find(
        (button) => button.dataset.action === opener?.dataset.action
      ) ??
      neighbor?.querySelector('.open-card') ??
      results.querySelector('.open-card, [data-clear], [data-add]') ??
      document.querySelector('.header-inner [data-add]');
  }
  target.focus({ preventScroll: true });
  opener = null;
  subject = null;
}

async function dismiss(dialog) {
  if (busy) return;
  busy = true;
  try {
    await closePanel(dialog);
  } finally {
    busy = false;
  }
}

function feedback(message) {
  const toast = byId('toast');
  clearTimeout(toastTimer);
  toast.replaceChildren(icon('check'), message);
  toast.classList.add('visible');
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 2700);
}

async function submit(event) {
  event.preventDefault();
  if (busy) return;
  busy = true;
  const dialog = event.target.closest('dialog');
  const deleting = dialog === confirm;
  const action = deleting ? 'delete' : subject ? 'edit' : 'add';
  try {
    const picked = deleting ? {} : selection();
    const savedId = await changeMovie({
      action,
      id: subject,
      originalEntry,
      ...picked,
      rating: rating.valueAsNumber,
    });
    await closePanel(dialog, () => {
      if (deleting) removeFrame(opener?.closest('[data-film]'));
      else {
        section = picked.mediaType;
        if (action === 'add') {
          rememberFrame(section, savedId);
          prefs.frames[section] = savedId;
          persistPreferences(prefs);
        }
        if (action === 'add') page = 0;
      }
      refresh();
      if (action === 'edit') editedFrame(subject);
    });
    feedback(
      { add: 'Title added to your collection.', edit: 'Title updated.', delete: 'Title removed.' }[
        action
      ]
    );
  } catch (error) {
    if (!deleting) {
      formError.textContent = error.message;
      const field = byId('catalog-panel').hidden
        ? title
        : (byId('picked').querySelector('button') ?? byId('catalog-query'));
      field.setAttribute('aria-invalid', 'true');
      focusPicker();
    } else {
      await closePanel(dialog);
      refresh();
      feedback(error.message);
    }
  } finally {
    busy = false;
  }
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button || busy) return;
  if (button.dataset.section) {
    section = button.dataset.section;
    page = 0;
    render();
  }
  if (button.dataset.layout && prefs.layout !== button.dataset.layout) {
    prefs.layout = button.dataset.layout;
    page = 0;
    persistPreferences(prefs);
    render();
  }
  if (button.hasAttribute('data-add')) openPanel('add', null, button);
  if (button.hasAttribute('data-dismiss')) dismiss(button.closest('dialog'));
  if (button.hasAttribute('data-clear')) {
    controls.clear();
  }
  if (button.id === 'return-latest' && latestFrame()) openPanel('details', latestFrame(), button);
  if (button.dataset.step) stepFrame(Number(button.dataset.step));
  if ((button.id === 'latest' || button.id === 'stage-open') && currentFrame())
    openPanel('details', currentFrame(), button);
  if (button.dataset.action) {
    const film = movies.find((item) => item.id === button.closest('[data-film]').dataset.film);
    if (film) {
      if (prefs.layout === 'screening' && button.dataset.action === 'details') cueFrame(film.id);
      openPanel(button.dataset.action, film, button);
    }
  }
});

for (const dialog of [editor, confirm, byId('detail-dialog')]) {
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    dismiss(dialog);
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dismiss(dialog);
  });
}
byId('movie-form').addEventListener('submit', submit);
byId('delete-form').addEventListener('submit', submit);
rating.addEventListener('input', highlightRating);
byId('increase').addEventListener('click', () => {
  rating.stepUp();
  highlightRating();
});
byId('decrease').addEventListener('click', () => {
  rating.stepDown();
  highlightRating();
});
title.addEventListener('input', () => {
  formError.textContent = '';
  title.removeAttribute('aria-invalid');
});
query.addEventListener('input', () => {
  prefs[section] = { ...prefs[section], query: query.value };
  page = 0;
  persistPreferences(prefs);
  cancelAnimationFrame(renderFrame);
  renderFrame = requestAnimationFrame(render);
});
order.addEventListener('change', () => {
  prefs[section] = { ...prefs[section], sort: order.value };
  page = 0;
  persistPreferences(prefs);
  render();
});
window.addEventListener('storage', (event) => {
  if (event.key === STATUS_KEY) updateVaultControl();
  if (event.key === STORAGE_KEY || event.key === LEGACY_KEY || event.key === null) refresh();
});

results.addEventListener('focusin', (event) => {
  const card = event.target.closest('.open-card');
  if (!drawing && card && prefs.layout === 'screening')
    cueFrame(card.closest('[data-film]').dataset.film);
});
results.addEventListener('keydown', (event) => {
  const card = event.target.closest('.open-card')?.closest('[data-film]');
  if (prefs.layout !== 'screening' || !card || !['ArrowLeft', 'ArrowRight'].includes(event.key))
    return;
  event.preventDefault();
  const neighbor =
    event.key === 'ArrowLeft' ? card.previousElementSibling : card.nextElementSibling;
  if (neighbor) neighbor.querySelector('.open-card').focus({ preventScroll: true });
  else {
    const i = selected.findIndex((entry) => entry.id === card.dataset.film);
    const target = selected[i + (event.key === 'ArrowLeft' ? -1 : 1)];
    if (!target) return;
    cueFrame(target.id);
    results
      .querySelector('[data-film="' + CSS.escape(target.id) + '"] .open-card')
      ?.focus({ preventScroll: true });
  }
});
document.querySelector('.projector').addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  stepFrame(event.key === 'ArrowLeft' ? -1 : 1);
});
setupAtmosphere();
refresh(await initialize());
entrance();

const accountButton = byId('account-open');
function accountLabel() {
  const s = session();
  const name = owner && s?.id === owner && s.displayName;
  accountButton.querySelector('span').textContent = name || 'Account';
  accountButton.setAttribute('aria-label', name ? 'Account, ' + name : 'Account');
}
async function openAccount() {
  if (!configured) return openDataVault('cloud', accountButton);
  try {
    const panel = await import('./cloud/panel.js');
    panel.openAccount(openDataVault);
  } catch {
    feedback('Account could not open. Try again.');
  }
}
accountLabel();
accountButton.onclick = openAccount;
window.addEventListener('account-profile', accountLabel);
window.addEventListener('storage', (e) => {
  if (e.key === sessionKey) accountLabel();
});

if (configured) {
  window.addEventListener('cloud-session-ended', () => {
    try {
      sessionStorage.setItem('aftercredits.open-account', '1');
      sessionStorage.setItem('aftercredits.session-ended', '1');
    } catch {}
    reloadScope();
  });
  window.addEventListener('cloud-collection', () => refresh());
  if (owner) import('./cloud/local.js').then((module) => module.prepareOfflineShell());
  if (owner)
    import('./cloud/sync.js')
      .then((module) => {
        const attention = () => {
          try {
            const { state, last } = module.syncStatus();
            const note = byId('first-sync');
            const copy = last
              ? ''
              : state === 'Offline' || state === 'Error'
                ? 'This device still needs to download your private archive. Open Account to check sync.'
                : 'Opening your private collection…';
            if (note.textContent !== copy) note.textContent = copy;
            note.hidden = !copy;
            const needsReview = state === 'Conflict' || state === 'Error';
            accountButton.toggleAttribute('data-attention', needsReview);
            accountButton.title = needsReview ? 'Account · sync needs attention' : 'Account';
            if (needsReview) accountButton.setAttribute('aria-label', accountButton.title);
            else accountLabel();
          } catch {
            accountButton.title = 'Account · check local storage';
          }
        };
        window.addEventListener('cloud-state', attention);
        attention();
        module.startSync();
      })
      .catch(() => feedback('Cloud sync is unavailable. Your archive is kept locally.'));
  try {
    if (owner && sessionStorage.getItem('aftercredits.guest-tip') === owner) {
      sessionStorage.removeItem('aftercredits.guest-tip');
      feedback('Your archive is open. Guest titles can be imported from Account.');
    }
    if (sessionStorage.getItem('aftercredits.open-account')) {
      sessionStorage.removeItem('aftercredits.open-account');
      openAccount();
    }
  } catch {}
}

// Complete a first connection that was left open in an earlier release without importing guest data.
const unfinishedConnection = configured && !owner && session()?.id;
if (unfinishedConnection) {
  import('./cloud/auth.js')
    .then((auth) => auth.resumeConnection(unfinishedConnection))
    .then(reloadScope)
    .catch(openAccount);
}
