const dateLabel = new Intl.DateTimeFormat(undefined, {
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

function actionButton(action, title) {
  const button = document.createElement('button');
  button.className = 'icon-button';
  button.dataset.action = action;
  const description = (action === 'edit' ? 'Edit ' : 'Delete ') + title;
  button.setAttribute('aria-label', description);
  button.title = description;
  button.append(icon(action === 'edit' ? 'edit' : 'trash'));
  return button;
}

export function movieRow(movie, index) {
  const row = document.createElement('li');
  row.className = 'movie';
  row.dataset.film = movie.id;
  const number = document.createElement('span');
  number.className = 'number';
  number.setAttribute('aria-hidden', 'true');
  number.textContent = String(index + 1).padStart(2, '0');
  const title = document.createElement('h3');
  title.textContent = movie.title;
  const time = document.createElement('time');
  time.dateTime = movie.added;
  const added = dateLabel.format(new Date(movie.added));
  time.textContent = added;
  time.setAttribute('aria-label', 'Added ' + added);
  const rating = document.createElement('span');
  rating.className = 'rating';
  rating.append(icon('star'), movie.rating.toFixed(1));
  rating.setAttribute('aria-label', 'Rated ' + movie.rating + ' out of 10');
  const actions = document.createElement('div');
  actions.className = 'actions';
  actions.append(actionButton('edit', movie.title), actionButton('delete', movie.title));
  row.append(number, title, time, rating, actions);
  return row;
}

export function emptyState(searching) {
  const panel = document.createElement('div');
  if (searching) {
    panel.className = 'no-match';
    panel.innerHTML =
      '<h3>No matching films.</h3><p>Try another title or clear your search.</p><button class="button secondary" data-clear>Clear search</button>';
  } else {
    panel.className = 'empty';
    panel.innerHTML =
      '<div class="empty-art" aria-hidden="true"></div><div class="empty-text"><h3>Your first frame awaits.</h3><p>Add your first movie to begin your personal film archive.</p><button class="button empty-button" data-add>Add your first movie</button></div>';
    panel.querySelector('button').prepend(icon('plus'));
  }
  return panel;
}
