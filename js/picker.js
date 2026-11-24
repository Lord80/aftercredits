import { configured, details, search } from './catalog.js';
import { resultButton } from './views.js';

const get = (id) => document.getElementById(id);
const query = get('catalog-query'),
  status = get('catalog-status'),
  list = get('matches'),
  type = get('movie-form').elements['media-type'];
let controller,
  timer,
  picked = null,
  mode = 'manual';
function cancel() {
  clearTimeout(timer);
  controller?.abort();
}
function resetResults() {
  cancel();
  picked = null;
  get('form-error').textContent = '';
  get('title').removeAttribute('aria-invalid');
  query.removeAttribute('aria-invalid');
  list.replaceChildren();
  get('picked').replaceChildren();
  get('picked').hidden = true;
  get('retry').hidden = true;
  delete status.dataset.loading;
  delete status.dataset.error;
  status.textContent = '';
  get('save').disabled = mode === 'lookup';
}
function setMode(value) {
  mode = value;
  resetResults();
  const lookup = value === 'lookup';
  get('lookup-mode').setAttribute('aria-pressed', String(lookup));
  get('manual-mode').setAttribute('aria-pressed', String(!lookup));
  get('manual-panel').hidden = lookup;
  get('catalog-panel').hidden = !lookup;
  get('title').required = !lookup;
  if (lookup && query.value.trim()) schedule();
}
function schedule() {
  resetResults();
  const term = query.value.trim();
  if (!term) return;
  status.dataset.loading = 'true';
  status.textContent = 'Searching TMDB…';
  controller = new AbortController();
  const signal = controller.signal;
  timer = setTimeout(async () => {
    try {
      const hits = await search(type.value, term, signal);
      if (signal.aborted) return;
      status.textContent = hits.length
        ? 'Select the title you watched.'
        : 'No titles found. Try the original title or a different spelling.';
      for (const item of hits) {
        const button = resultButton(item);
        button.addEventListener('click', () => choose(item));
        list.append(button);
      }
    } catch (error) {
      if (signal.aborted) return;
      status.textContent = error.message.includes('busy')
        ? error.message
        : 'Search is unavailable. Retry or enter your title manually.';
      status.dataset.error = 'true';
      get('retry').hidden = false;
    } finally {
      if (!signal.aborted) delete status.dataset.loading;
    }
  }, 300);
}
async function choose(item) {
  resetResults();
  controller = new AbortController();
  const signal = controller.signal;
  const panel = get('picked');
  panel.hidden = false;
  const selected = resultButton(item, true);
  const change = document.createElement('span');
  change.className = 'change-match';
  change.textContent = 'Change selection';
  selected.querySelector('.match-info').append(change);
  selected.addEventListener('click', () => {
    schedule();
    query.focus();
  });
  panel.append(selected);
  status.dataset.loading = 'true';
  status.textContent = 'Loading title details…';
  selected.focus();
  try {
    const full = await details(item, signal);
    if (signal.aborted) return;
    picked = full;
    const names = (full.metadata.genres || []).map((genre) => genre.name).filter(Boolean);
    if (names.length) {
      const genres = document.createElement('small');
      genres.textContent = names.slice(0, 2).join(' · ');
      change.before(genres);
    }
    status.textContent = 'Title selected.';
  } catch {
    if (signal.aborted) return;
    picked = item;
    status.textContent = 'Full details are unavailable. You can save this TMDB search result.';
  }
  delete status.dataset.loading;
  get('save').disabled = false;
}
get('lookup-mode').addEventListener('click', () => {
  setMode('lookup');
  query.focus();
});
get('manual-mode').addEventListener('click', () => {
  setMode('manual');
  get('title').focus();
});
query.addEventListener('input', schedule);
query.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    (list.querySelector('button') ?? get('picked').querySelector('button'))?.focus();
  }
});
get('retry').addEventListener('click', () => {
  schedule();
  query.focus();
});
get('add-type').addEventListener('change', () => {
  setMode(mode);
});
export function startPicker(mediaType, isEdit) {
  query.value = '';
  type.value = mediaType;
  get('add-options').hidden = isEdit;
  get('lookup-mode').disabled = !configured;
  get('connection-note').hidden = configured;
  setMode(!isEdit && configured ? 'lookup' : 'manual');
}
export function focusPicker() {
  (mode === 'lookup' ? query : get('title')).focus();
}
export function stopPicker() {
  cancel();
}
export function selection() {
  if (mode === 'lookup' && !picked) throw new Error('Select a TMDB result first.');
  return {
    mediaType: type.value,
    match: picked,
    title: picked?.metadata.title ?? get('title').value,
  };
}
