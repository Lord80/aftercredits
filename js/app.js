import {
  changeMovie,
  selectMovies,
  snapshot,
  STORAGE_KEY,
  initialize,
  LEGACY_KEY,
} from './collection.js';
import {
  entrance,
  editedFrame,
  setupAtmosphere,
  prepareCounters,
  play,
  canMove,
  timing,
  hideDialog,
  positions,
  accentRating,
  removeFrame,
  reveal,
  showDialog,
  statistic,
} from './motion.js';
import { trackStrip } from './filmstrip.js';
import {
  arrangeStage,
  cueFrame,
  currentFrame,
  rememberFrame,
  latestFrame,
  stepFrame,
} from './stage.js';
import { startPicker, stopPicker, focusPicker, selection } from './picker.js';
import { emptyState, icon, movieRow, presentDetails } from './views.js';

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
let opener = null;
let busy = false;
let renderFrame;
const cardNodes = new WeakMap();
let records = new Map();
const lens = document.createElement('i');
lens.className = 'tab-lens';
lens.setAttribute('aria-hidden', 'true');
let toastTimer;

function refresh(state = snapshot()) {
  // A storage read parses new objects. Keep equal snapshots referentially stable for the strip and stage.
  const next = new Map();
  movies = state.items.map((item) => {
    const bytes = JSON.stringify(item);
    const prior = records.get(item.id);
    const record = prior?.bytes === bytes ? prior : { bytes, item };
    next.set(item.id, record);
    return record.item;
  });
  records = next;
  byId('storage-note').textContent = state.notice;
  byId('storage-note').hidden = !state.notice;
  statistic(byId('total'), movies.length, (n) => String(Math.round(n)).padStart(2, '0'));
  const mean = movies.length
    ? movies.reduce((sum, film) => sum + film.rating, 0) / movies.length
    : null;
  statistic(byId('average'), mean, (n) => (n === null ? '—' : n.toFixed(1)));
  byId('movie-count').textContent = movies.filter((m) => m.mediaType === 'movie').length;
  byId('tv-count').textContent = movies.filter((m) => m.mediaType === 'tv').length;
  render();
}

function render() {
  cancelAnimationFrame(renderFrame);
  const previous = positions(results);
  document.body.dataset.currentSection = section;
  const group = movies.filter((m) => m.mediaType === section);
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
  const selected = selectMovies(group, query.value, order.value);
  const gallery = results.parentElement;
  if (selected.length && byId('storage-note').hidden)
    gallery.style.setProperty('--frames', selected.length);
  else gallery.style.removeProperty('--frames');
  if (selected.length) {
    let list = results.querySelector('.movie-list');
    if (!list) {
      list = document.createElement('ol');
      list.className = 'movie-list';
      results.replaceChildren(list);
    }
    list.toggleAttribute('data-long', selected.length > 24);
    const cards = selected.map((entry) => {
      if (!cardNodes.has(entry)) cardNodes.set(entry, movieRow(entry));
      return cardNodes.get(entry);
    });
    // A state-preserving move keeps decoded prints, skipped layouts and keyboard focus attached.
    // Older engines can batch a large reorder when focus is outside the strip.
    const first = list.firstElementChild;
    if (
      !list.moveBefore && cards.length > 24 &&
      first &&
      first !== cards[0] &&
      !list.contains(document.activeElement)
    ) {
      list.replaceChildren(...cards);
    } else {
      const retained = new Set(cards);
      for (const card of [...list.children]) if (!retained.has(card)) card.remove();
      let next = list.firstElementChild;
      for (const card of cards) {
        if (card === next) next = next.nextElementSibling;
        else if (list.moveBefore && card.parentElement === list) list.moveBefore(card, next);
        else list.insertBefore(card, next);
      }
    }
    reveal(list, previous);
  } else {
    const state = section + (group.length ? '-search' : '-empty');
    if (results.firstElementChild?.dataset.state !== state) {
      const panel = emptyState(group.length > 0, section);
      panel.dataset.state = state;
      results.replaceChildren(panel);
      reveal(results, previous);
    }
  }
  arrangeStage(selected, group, section);
  trackStrip(results.querySelector('.movie-list'));
  byId('result-status').textContent =
    selected.length +
    (selected.length === 1 ? ' title' : ' titles') +
    (query.value ? ' matching your search.' : ' in your collection.');
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
      results.querySelector('[data-add]') ??
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
      ...picked,
      rating: rating.valueAsNumber,
    });
    await closePanel(dialog, () => {
      if (deleting) removeFrame(opener?.closest('[data-film]'));
      else {
        section = picked.mediaType;
        if (action === 'add') rememberFrame(section, savedId);
        query.value = '';
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
    query.value = '';
    render();
  }
  if (button.hasAttribute('data-add')) openPanel('add', null, button);
  if (button.hasAttribute('data-dismiss')) dismiss(button.closest('dialog'));
  if (button.hasAttribute('data-clear')) {
    query.value = '';
    render();
    query.focus();
  }
  if (button.id === 'return-latest' && latestFrame()) openPanel('details', latestFrame(), button);
  if (button.dataset.step) stepFrame(Number(button.dataset.step));
  if ((button.id === 'latest' || button.id === 'stage-open') && currentFrame())
    openPanel('details', currentFrame(), button);
  if (button.dataset.action) {
    const film = movies.find((item) => item.id === button.closest('[data-film]').dataset.film);
    if (film) {
      if (button.dataset.action === 'details') cueFrame(film.id);
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
  cancelAnimationFrame(renderFrame);
  renderFrame = requestAnimationFrame(render);
});
order.addEventListener('change', render);
window.addEventListener('storage', (event) => {
  if (event.key === STORAGE_KEY || event.key === LEGACY_KEY || event.key === null) refresh();
});

results.addEventListener('focusin', (event) => {
  const card = event.target.closest('.open-card');
  if (card) cueFrame(card.closest('[data-film]').dataset.film);
});
results.addEventListener('keydown', (event) => {
  const card = event.target.closest('.open-card')?.closest('[data-film]');
  if (!card || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  const neighbor =
    event.key === 'ArrowLeft' ? card.previousElementSibling : card.nextElementSibling;
  neighbor?.querySelector('.open-card').focus({ preventScroll: true });
});
document.querySelector('.projector').addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  stepFrame(event.key === 'ArrowLeft' ? -1 : 1);
});
setupAtmosphere();
refresh(await initialize());
entrance();
