import { imageUrl } from './catalog.js';
export const dateLabel = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});
export function icon(name) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(ns, 'use');
  use.setAttribute('href', '#' + name);
  svg.append(use);
  return svg;
}
function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
}
export function artwork(path, size, type, title) {
  const frame = el('span', 'artwork');
  if (title) {
    const initials = title
      .trim()
      .split(/\s+/u)
      .slice(0, 2)
      .map((word) => [...word][0])
      .join('');
    const imprint = el('span', 'bookplate', initials.toLocaleUpperCase());
    imprint.setAttribute('aria-hidden', 'true');
    frame.dataset.stock = String(title.codePointAt(0) % 4);
    frame.append(imprint);
  } else {
    frame.append(icon(type === 'tv' ? 'tv' : 'film'));
  }
  const src = imageUrl(path, size);
  if (src) {
    const img = new Image();
    img.alt = '';
    img.loading = size === 'w342' ? 'lazy' : 'eager';
    img.decoding = 'async';
    img.addEventListener('error', () => img.remove(), { once: true });
    const higherDensity = { w185: 'w342', w342: 'w780', w780: 'w1280' }[size];
    if (higherDensity) {
      const larger = imageUrl(path, higherDensity);
      img.srcset = src + ' 1x, ' + larger + ' 2x';
    }
    img.src = src;
    frame.append(img);
  }
  return frame;
}
function actionButton(action, title) {
  const button = el('button', 'icon-button');
  button.dataset.action = action;
  button.setAttribute('aria-label', (action === 'edit' ? 'Edit ' : 'Delete ') + title);
  button.append(icon(action === 'edit' ? 'edit' : 'trash'));
  return button;
}
export function movieRow(movie) {
  const card = el('li', 'poster-card');
  card.dataset.film = movie.id;
  const open = el('button', 'open-card');
  open.dataset.action = 'details';
  open.setAttribute('aria-haspopup', 'dialog');
  open.setAttribute('aria-controls', 'detail-dialog');
  open.setAttribute('aria-expanded', 'false');
  const poster = artwork(movie.metadata?.posterPath, 'w342', movie.mediaType, movie.title);
  const badge = el('span', 'score-badge');
  badge.append(el('span', 'sr-only', 'Your rating '), icon('star'), movie.rating.toFixed(1));
  poster.append(badge);
  const title = el('h3', '', movie.title);
  const year =
    typeof movie.metadata?.releaseDate === 'string' ? movie.metadata.releaseDate.slice(0, 4) : '';
  const caption = el(
    'span',
    'poster-caption',
    [year, movie.mediaType === 'tv' ? 'TV series' : 'Movie'].filter(Boolean).join(' · ')
  );
  const label = el('div', 'print-label');
  label.append(caption, title);
  open.append(el('span', 'sr-only', 'View title details'), poster, label);
  const bottom = el('div', 'card-bottom');
  const time = el('time', '', dateLabel.format(new Date(movie.added)));
  time.dateTime = movie.added;
  const date = el('div', 'added-date');
  date.append(el('span', 'date-prefix', 'Added'), time);
  const actions = el('div', 'actions');
  actions.append(actionButton('edit', movie.title), actionButton('delete', movie.title));
  bottom.append(date, actions);
  card.append(open, bottom);
  return card;
}
export function resultButton(item, selected = false) {
  const button = el('button', 'match');
  button.type = 'button';
  const text = el('span', 'match-info');
  const date = item.metadata.releaseDate?.slice(0, 4) || 'Year unavailable';
  text.append(
    el('strong', '', item.metadata.title),
    el('small', '', date + ' · ' + (item.mediaType === 'tv' ? 'TV series' : 'Movie'))
  );
  const poster = artwork(item.metadata.posterPath, 'w185', item.mediaType, item.metadata.title);
  button.append(poster, text);
  if (!selected) button.append(icon('next'));
  return button;
}
export function presentLatest(button, entry) {
  button.hidden = !entry;
  const stage = button.querySelector('.latest-image');
  stage.replaceChildren();
  if (!entry) return;
  const meta = entry.metadata;
  const wide = Boolean(imageUrl(meta?.backdropPath, 'w780'));
  stage.classList.toggle('portrait-source', !wide && Boolean(meta?.posterPath));
  stage.append(
    artwork(
      wide ? meta.backdropPath : meta?.posterPath,
      wide ? 'w780' : 'w185',
      entry.mediaType,
      entry.title
    )
  );
  button.querySelector('small').textContent =
    entry.mediaType === 'tv' ? 'Latest series' : 'Latest movie';
  button.querySelector('strong').textContent = entry.title;
}
export function emptyState(searching, type) {
  const panel = el('div', searching ? 'no-match' : 'empty');
  const movie = type === 'movie';
  const content = el('div', 'empty-text');
  const heading = searching
    ? 'No matching titles.'
    : movie
      ? 'Your first screening.'
      : 'Your first series.';
  const copy = searching
    ? 'Try a different title or clear your search.'
    : movie
      ? 'Give a movie a rating to start your collection.'
      : 'Save a series you’ve watched and give it a rating.';
  content.append(el('h3', '', heading), el('p', '', copy));
  const button = el('button', 'button ' + (searching ? 'secondary' : 'empty-button'));
  if (searching) {
    button.dataset.clear = '';
    button.textContent = 'Clear search';
  } else {
    const art = el('div', 'empty-art');
    art.setAttribute('aria-hidden', 'true');
    panel.append(art);
    button.dataset.add = '';
    button.append(icon('plus'), movie ? 'Add a movie' : 'Add a series');
  }
  content.append(button);
  panel.append(content);
  return panel;
}

const languageNames = Intl.DisplayNames && new Intl.DisplayNames(undefined, { type: 'language' });
const releaseLabel = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC',
});

export function presentDetails(dialog, entry) {
  const meta = entry.metadata ?? {};
  const get = (id) => dialog.querySelector('#' + id);
  const series = entry.mediaType === 'tv';
  const banner = dialog.querySelector('.detail-hero');
  const backdrop = imageUrl(meta.backdropPath, 'w780');
  banner.hidden = !backdrop;
  banner.replaceChildren();
  if (backdrop) {
    const image = new Image();
    image.alt = '';
    image.decoding = 'async';
    image.addEventListener('error', () => image.remove(), { once: true });
    banner.append(image);
    image.srcset = backdrop + ' 1x, ' + imageUrl(meta.backdropPath, 'w1280') + ' 2x';
    image.src = backdrop;
  }
  const poster = get('detail-poster');
  poster.replaceChildren(artwork(meta.posterPath, 'w185', entry.mediaType, entry.title));
  get('detail-type').replaceChildren(icon(series ? 'tv' : 'film'), series ? 'TV series' : 'Movie');
  get('detail-title').textContent = entry.title;
  const original = get('detail-original');
  original.hidden = !meta.originalTitle || meta.originalTitle === entry.title;
  original.textContent = original.hidden ? '' : meta.originalTitle;
  get('detail-description').textContent =
    meta.overview ||
    (entry.tmdbId
      ? 'A description is unavailable for this title.'
      : 'This title was saved manually.');

  const facts = get('detail-facts');
  facts.replaceChildren();
  function fact(label, value) {
    if (!value) return;
    const group = el('div');
    group.append(el('dt', '', label), el('dd', '', value));
    facts.append(group);
  }
  if (typeof meta.releaseDate === 'string' && meta.releaseDate) {
    const day = new Date(meta.releaseDate + 'T00:00:00Z');
    fact(
      series ? 'First aired' : 'Released',
      Number.isFinite(+day) ? releaseLabel.format(day) : meta.releaseDate
    );
  }
  if (Array.isArray(meta.genres))
    fact(
      'Genres',
      meta.genres
        .map((g) => g?.name)
        .filter(Boolean)
        .join(' · ')
    );
  if (typeof meta.originalLanguage === 'string' && /^[a-z]{2,3}$/i.test(meta.originalLanguage))
    fact('Original language', languageNames?.of(meta.originalLanguage) ?? meta.originalLanguage);
  facts.hidden = !facts.childElementCount;
  get('detail-score').textContent = entry.rating.toFixed(1);
  get('detail-added').dateTime = entry.added;
  get('detail-added').textContent = 'Added ' + dateLabel.format(new Date(entry.added));
}
