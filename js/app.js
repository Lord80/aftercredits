import { changeMovie, selectMovies, snapshot, STORAGE_KEY } from './collection.js';
import {
  entrance,
  hideDialog,
  positions,
  removeFrame,
  reveal,
  showDialog,
  statistic,
} from './motion.js';
import { emptyState, icon, movieRow } from './views.js';

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
  render();
}

function render() {
  cancelAnimationFrame(renderFrame);
  const previous = positions(results);
  const selected = selectMovies(movies, query.value, order.value);
  if (selected.length) {
    const list = document.createElement('ol');
    list.className = 'movie-list';
    list.append(...selected.map(movieRow));
    results.replaceChildren(list);
    reveal(list, previous);
  } else {
    const searching = movies.length > 0;
    const sameState = results.firstElementChild?.classList.contains(
      searching ? 'no-match' : 'empty'
    );
    if (!sameState) {
      results.replaceChildren(emptyState(searching));
      reveal(results, previous);
    }
  }
  byId('result-status').textContent =
    selected.length +
    (selected.length === 1 ? ' film' : ' films') +
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
  if (action === 'delete') {
    byId('delete-copy').textContent = '“' + film.title + '” will be deleted from your collection.';
    showDialog(confirm);
    byId('keep').focus();
    return;
  }
  byId('editor-heading').textContent = film ? 'Edit movie' : 'Add a movie';
  byId('save').textContent = film ? 'Save changes' : 'Add movie';
  title.value = film?.title || '';
  rating.value = film?.rating ?? 7;
  formError.textContent = '';
  title.removeAttribute('aria-invalid');
  highlightRating();
  showDialog(editor);
  title.focus();
}

async function closePanel(dialog) {
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
    await changeMovie({ action, id: subject, title: title.value, rating: rating.valueAsNumber });
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
      { add: 'Movie added to your collection.', edit: 'Movie updated.', delete: 'Movie removed.' }[
        action
      ]
    );
  } catch (error) {
    if (!deleting) {
      formError.textContent = error.message;
      title.setAttribute('aria-invalid', 'true');
      title.focus();
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

for (const dialog of [editor, confirm]) {
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
  if (event.key === STORAGE_KEY || event.key === null) refresh();
});

refresh();
entrance();
