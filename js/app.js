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
  hideDialog,
  positions,
  removeFrame,
  reveal,
  showDialog,
  statistic,
} from './motion.js';
import { startPicker, stopPicker, focusPicker, selection } from './picker.js';
import { imageUrl } from './catalog.js';
import { emptyState, icon, movieRow, dateLabel } from './views.js';

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
let toastTimer;

function refresh() {
  const state = snapshot();
  movies = state.items;
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
  const selected = selectMovies(group, query.value, order.value);
  if (selected.length) {
    const list = document.createElement('ol');
    list.className = 'movie-list';
    list.append(...selected.map(movieRow));
    results.replaceChildren(list);
    reveal(list, previous);
  } else {
    results.replaceChildren(emptyState(group.length > 0, section));
    reveal(results, previous);
  }
  byId('result-status').textContent =
    selected.length +
    (selected.length === 1 ? ' title' : ' titles') +
    (query.value ? ' matching your search.' : ' in your collection.');
}

function highlightRating() {
  const value = rating.valueAsNumber;
  byId('score').textContent = value.toFixed(1);
  rating.style.setProperty('--progress', ((value - 1) / 9) * 100 + '%');
  rating.setAttribute('aria-valuetext', value + ' out of 10');
  byId('increase').disabled = value >= 10;
  byId('decrease').disabled = value <= 1;
}

function openPanel(action, film, button) {
  subject = film?.id ?? null;
  opener = button;
  if (action === 'details') {
    const m = film.metadata;
    const dialog = byId('detail-dialog'),
      banner = dialog.querySelector('.detail-hero');
    banner.replaceChildren();
    banner.hidden = true;
    const src = imageUrl(m?.backdropPath, 'w780');
    if (src) {
      const image = new Image();
      image.alt = '';
      image.onload = () => {
        if (banner.contains(image)) banner.hidden = false;
      };
      image.onerror = () => image.remove();
      banner.append(image);
      image.src = src;
    }
    byId('detail-title').textContent = film.title;
    byId('detail-type').textContent = film.mediaType === 'tv' ? 'TV series' : 'Movie';
    const facts = [
      m?.releaseDate,
      ...(Array.isArray(m?.genres) ? m.genres.map((g) => g?.name) : []),
      typeof m?.originalLanguage === 'string' ? m.originalLanguage.toUpperCase() : null,
    ].filter(Boolean);
    byId('detail-facts').textContent = facts.join('  ·  ');
    byId('detail-description').textContent =
      m?.overview ||
      (film.tmdbId
        ? 'A description is unavailable for this title.'
        : 'This title was saved manually.');
    byId('detail-personal').textContent =
      'Your rating ' +
      film.rating.toFixed(1) +
      ' / 10  ·  Added ' +
      dateLabel.format(new Date(film.added));
    showDialog(dialog);
    dialog.querySelector('button').focus();
    return;
  }
  if (action === 'delete') {
    byId('delete-copy').textContent = '“' + film.title + '” will be deleted from your collection.';
    showDialog(confirm);
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
  showDialog(editor);
  focusPicker();
}

async function closePanel(dialog) {
  if (dialog === editor) stopPicker();
  await hideDialog(dialog);
  if (opener?.isConnected) opener.focus({ preventScroll: true });
  else {
    const row = [...results.querySelectorAll('[data-film]')].find(
      (el) => el.dataset.film === subject
    );
    (row?.querySelector('button') ?? document.querySelector('.header-inner [data-add]')).focus({
      preventScroll: true,
    });
  }
  subject = null;
  opener = null;
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
    await changeMovie({ action, id: subject, ...picked, rating: rating.valueAsNumber });
    if (!deleting) section = picked.mediaType;
    if (deleting) {
      removeFrame(
        [...results.querySelectorAll('[data-film]')].find((row) => row.dataset.film === subject)
      );
    } else {
      query.value = '';
    }
    refresh();
    await closePanel(dialog);
    feedback(
      { add: 'Title added to your collection.', edit: 'Title updated.', delete: 'Title removed.' }[
        action
      ]
    );
  } catch (error) {
    if (!deleting) {
      formError.textContent = error.message;
      title.setAttribute('aria-invalid', 'true');
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
  if (button.dataset.action) {
    const film = movies.find((item) => item.id === button.closest('[data-film]').dataset.film);
    if (film) openPanel(button.dataset.action, film, button);
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

await initialize();
refresh();
entrance();
