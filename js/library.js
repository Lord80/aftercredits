import { actionButton, artwork, dateLabel, emptyState, icon, movieRow } from './views.js';
import { languageLabel } from './discovery.js';
import { positions, reveal } from './motion.js';
import { trackStrip } from './filmstrip.js';

export const pageSizes = { screening: 72, gallery: 24, compact: 60 };
function element(tag, cls, value) {
  const el = document.createElement(tag);
  el.className = cls;
  if (value !== undefined) el.textContent = value;
  return el;
}
function libraryCard(entry, layout) {
  const grid = layout === 'gallery';
  const card = element('li', 'library-card');
  card.dataset.film = entry.id;
  const open = element('button', 'open-card library-open');
  open.type = 'button';
  open.dataset.action = 'details';
  open.setAttribute('aria-haspopup', 'dialog');
  open.setAttribute('aria-controls', 'detail-dialog');
  open.setAttribute('aria-expanded', 'false');
  open.setAttribute('aria-description', 'Open title details');
  const meta = entry.metadata;
  const poster = artwork(
    meta?.posterPath,
    grid ? 'w342' : 'w92',
    entry.mediaType,
    entry.title,
    'lazy'
  );
  const year = typeof meta?.releaseDate === 'string' ? meta.releaseDate.slice(0, 4) : '';
  const genre = Array.isArray(meta?.genres)
    ? meta.genres.find((g) => typeof g?.name === 'string' && g.name)?.name
    : '';
  const language =
    typeof meta?.originalLanguage === 'string' && meta.originalLanguage
      ? languageLabel(meta.originalLanguage)
      : '';
  const caption = element(
    'span',
    'library-caption',
    [...(grid ? [year] : []), genre, language].filter(Boolean).join(' · ') ||
      (entry.tmdbId === null ? 'Manual entry' : 'Catalog entry')
  );
  if (!grid && year) caption.prepend(element('span', 'ledger-mobile-year', year + ' · '));
  const label = element('div', 'library-label');
  label.append(element('h3', 'library-title', entry.title), caption);
  const rating = element('span', 'score-badge');
  rating.append(
    element('span', 'sr-only', 'Personal rating '),
    icon('star'),
    entry.rating.toFixed(1)
  );
  open.append(poster, label);
  if (grid) poster.append(rating);
  else open.append(element('span', 'ledger-year', year || '—'), rating);
  const when = element('time', 'library-date', dateLabel.format(new Date(entry.added)));
  when.dateTime = entry.added;
  when.setAttribute('aria-label', 'Added ' + when.textContent);
  const actions = element('div', 'actions');
  actions.append(actionButton('edit', entry.title), actionButton('delete', entry.title));
  const foot = element('div', 'library-foot');
  foot.append(when, actions);
  card.append(open, foot);
  return card;
}
function ledgerHead() {
  const head = element('div', 'ledger-head');
  head.setAttribute('aria-hidden', 'true');
  const fields = element('div', 'ledger-fields');
  fields.append(...['Title', 'Year', 'Rating'].map((label) => element('span', '', label)));
  head.append(fields, element('span', '', 'Added'));
  return head;
}
export function createLibrary(results, onPage) {
  let mounted = new Map(),
    previousLayout,
    previousPage,
    totalPages = 0;
  const pager = document.getElementById('browse-pages'),
    select = document.getElementById('browse-page');
  pager.onclick = (e) => {
    const b = e.target.closest('[data-page-step]');
    if (b) onPage(Number(select.value) + Number(b.dataset.pageStep));
  };
  select.onchange = () => onPage(Number(select.value));
  return function draw(entries, layout, page, groupLength, section) {
    const screening = layout === 'screening',
      size = pageSizes[layout];
    const count = Math.ceil(entries.length / size);
    pager.hidden = count <= 1;
    if (totalPages !== count && count > 1) {
      select.replaceChildren(
        ...Array.from({ length: count }, (_, i) => new Option(String(i + 1), String(i)))
      );
      document.getElementById('page-total').textContent = 'of ' + count;
    }
    totalPages = count;
    select.value = String(page);
    pager.firstElementChild.disabled = page === 0;
    pager.lastElementChild.disabled = page >= count - 1;
    const status = document.getElementById('result-status');
    const noun = section === 'movie' ? 'movie' : 'series';
    const label =
      (entries.length === groupLength ? groupLength : entries.length + ' of ' + groupLength) +
      ' ' +
      noun +
      (section === 'movie' && groupLength !== 1 ? 's' : '');
    if (status.textContent !== label) status.textContent = label;
    const surface = results.parentElement;
    if (screening && entries.length && document.getElementById('storage-note').hidden)
      surface.style.setProperty('--frames', Math.min(size, entries.length - page * size));
    else surface.style.removeProperty('--frames');
    const previous = screening ? positions(results) : null;
    if (!entries.length) {
      const state = section + (groupLength ? '-search' : '-empty');
      if (results.firstElementChild?.dataset.state !== state) {
        const panel = emptyState(Boolean(groupLength), section);
        panel.dataset.state = state;
        results.replaceChildren(panel);
        reveal(results, new Map());
      }
      mounted.clear();
      trackStrip(null);
      previousLayout = layout;
      return;
    }
    let list = results.querySelector('ol');
    if (!list || previousLayout !== layout) {
      mounted.clear();
      list = document.createElement('ol');
      list.className = screening ? 'movie-list' : 'library-list ' + layout + '-list';
      if (layout === 'compact') results.replaceChildren(ledgerHead(), list);
      else results.replaceChildren(list);
    }
    list.toggleAttribute('data-long', screening && entries.length > 24);
    const next = new Map(),
      cards = entries.slice(page * size, (page + 1) * size).map((entry) => {
        const old = mounted.get(entry.id);
        const record =
          old?.entry === entry
            ? old
            : { entry, node: screening ? movieRow(entry) : libraryCard(entry, layout) };
        next.set(entry.id, record);
        return record.node;
      });
    const focus = document.activeElement;
    const oldFocus = list.contains(focus)
      ? { id: focus.closest('[data-film]')?.dataset.film, action: focus.dataset.action }
      : null;
    if (!list.moveBefore && cards.length > 24 && list.firstElementChild !== cards[0] && !oldFocus)
      list.replaceChildren(...cards);
    else {
      for (const [id, record] of mounted) if (next.get(id) !== record) record.node.remove();
      let sibling = list.firstElementChild;
      for (const node of cards) {
        if (node === sibling) sibling = sibling.nextElementSibling;
        else if (list.moveBefore && node.parentElement === list) list.moveBefore(node, sibling);
        else list.insertBefore(node, sibling);
      }
    }
    if (oldFocus && document.activeElement !== focus && !document.querySelector('dialog[open]')) {
      const target =
        next.get(oldFocus.id)?.node.querySelector('[data-action="' + oldFocus.action + '"]') ||
        list.querySelector('.open-card');
      target?.focus({ preventScroll: true });
    }
    if (screening) reveal(list, previous);
    else if (previousLayout !== layout || previousPage !== page) reveal(list, new Map());
    previousPage = page;
    trackStrip(screening ? list : null);
    mounted = next;
    previousLayout = layout;
  };
}
