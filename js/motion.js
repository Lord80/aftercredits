// CSS owns the timing scale. Read it once, before any measured interaction.
const tokens = getComputedStyle(document.documentElement);
const duration = (name) => parseFloat(tokens.getPropertyValue('--motion-' + name));
export const timing = {
  tap: duration('tap'),
  shift: duration('shift'),
  travel: duration('travel'),
  projection: duration('projection'),
  beat: duration('beat'),
  glide: tokens.getPropertyValue('--ease-out').trim(),
  return: tokens.getPropertyValue('--ease-return').trim(),
};
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const slow = matchMedia('(update: slow)');
const compact = matchMedia('(max-width: 620px)');
export const canMove = () =>
  !reduce.matches && !slow.matches && !document.hidden && !!Element.prototype.animate;
const running = new Map();
const counters = new Map();

export function stopMotion(node) {
  running.get(node)?.cancel();
}
// One finite effect per actor. Its normal DOM state always describes the final frame.
export function play(node, frames, options = {}) {
  if (!node) return;
  stopMotion(node);
  if (!canMove()) return;
  let effect;
  try {
    effect = node.animate(frames, {
      duration: timing.shift,
      easing: timing.glide,
      fill: 'backwards',
      ...options,
    });
  } catch {
    // An unsupported timing or keyframe still leaves the semantic destination in place.
    return;
  }
  running.set(node, effect);
  const release = () => {
    if (running.get(node) === effect) running.delete(node);
  };
  effect.finished.then(release, release);
  return effect;
}
export function arrive(node, from, options) {
  return play(
    node,
    [from, { translate: '0px 0px', scale: '1', rotate: '0deg', opacity: 1 }],
    options
  );
}
function settle() {
  if (canMove()) return;
  for (const effect of running.values()) effect.cancel();
  for (const tween of counters.values()) tween.totalProgress(1);
}
function cancelInside(container) {
  for (const [node, effect] of running) if (container.contains(node)) effect.cancel();
}
window.addEventListener('resize', () => {
  const dialog = document.querySelector('dialog[open]');
  if (dialog) cancelInside(dialog);
});
reduce.addEventListener('change', settle);
slow.addEventListener('change', settle);
document.addEventListener('visibilitychange', settle);

export function setupAtmosphere() {
  const control = document.querySelector('#ambient-control');
  let paused = false;
  try {
    paused = localStorage.getItem('aftercredits.ambient-paused') === '1';
  } catch {}
  function sync() {
    const forced = reduce.matches || slow.matches;
    document.documentElement.toggleAttribute('data-still', paused || forced || document.hidden);
    control.disabled = forced;
    control.setAttribute('aria-pressed', String(!paused && !forced));
  }
  control.onclick = () => {
    paused = !paused;
    try {
      localStorage.setItem('aftercredits.ambient-paused', paused ? '1' : '0');
    } catch {}
    sync();
  };
  document.documentElement.setAttribute('data-atmosphere', '');
  control.hidden = false;
  sync();
  reduce.addEventListener('change', sync);
  slow.addEventListener('change', sync);
  document.addEventListener('visibilitychange', sync);
}

export function entrance() {
  if (!canMove()) return;
  const q = (selector) => document.querySelector(selector);
  let repeat = false;
  try {
    repeat = sessionStorage.getItem('aftercredits.entered') === '1';
    sessionStorage.setItem('aftercredits.entered', '1');
  } catch {}
  // The existing Splice exposure leads. Repeat visits cut directly to the titles.
  const beat = timing.beat * (repeat ? 0.4 : 1);
  if (!repeat) arrive(q('.plaza'), { scale: 1.018 }, { duration: timing.projection });
  const actors = [
    ['.stats', { translate: '0 -4px', opacity: 0.78 }],
    ['.dock', { translate: '0 9px', scale: 0.97, opacity: 0.82 }],
    ['.stage-copy', { translate: '-9px 0', opacity: 0.72 }],
    ['.projector', { translate: '0 12px', scale: 0.96 }],
    ['.archive-head', { translate: '0 5px', opacity: 0.8 }],
    ['.gallery', { translate: '0 8px', opacity: 0.78 }],
  ];
  actors.forEach(([selector, from], i) =>
    arrive(q(selector), from, {
      delay: i * beat,
      duration: repeat ? timing.shift : timing.travel,
    })
  );
}

export function accentRating(node, direction, high) {
  arrive(node, { translate: '0 ' + direction * 3 + 'px', scale: 1.07 }, { duration: timing.tap });
  if (high)
    arrive(
      node.parentNode.querySelector('.icon'),
      { scale: 1.32, rotate: '-9deg' },
      { duration: timing.shift }
    );
}
export function stageCaptions(direction) {
  ['#headline', '#stage-kicker', '#stage-description', '#stage-score'].forEach((s, i) => {
    arrive(
      document.querySelector(s),
      { translate: direction * 7 + 'px ' + (i === 0 ? 3 : 0) + 'px', opacity: 0.58 },
      { duration: timing.shift, delay: (i * timing.beat) / 2 }
    );
  });
}

// Uniform-width strip frames let us bound both layout reads and animation work to the viewport.
function visibleRows(list) {
  if (!list?.firstElementChild) return [];
  if (!list.classList.contains('movie-list')) return [list.firstElementChild];
  const width = list.firstElementChild.offsetWidth;
  if (!width) return [];
  const first = Math.max(0, Math.floor(list.scrollLeft / width) - 2);
  const last = Math.min(list.children.length, first + Math.ceil(list.clientWidth / width) + 5);
  const rows = [];
  for (let i = first; i < last; i++) rows.push(list.children[i]);
  return rows;
}
export function positions(results) {
  if (!canMove()) return new Map();
  return new Map(
    visibleRows(results.querySelector('.movie-list')).map((row) => [
      row.dataset.film,
      row.getBoundingClientRect(),
    ])
  );
}
export function reveal(list, previous) {
  if (!canMove()) return;
  const rows = visibleRows(list);
  rows.forEach(stopMotion);
  const boxes = rows.map((row) => row.getBoundingClientRect());
  rows.forEach((row, i) => {
    const box = boxes[i];
    if (box.right < 0 || box.left > innerWidth || box.bottom < 0 || box.top > innerHeight) return;
    const prior = previous.get(row.dataset.film);
    if (prior) {
      const delta = prior.left - box.left;
      if (Math.abs(delta) > 1) arrive(row, { translate: delta + 'px 0' });
    } else
      arrive(
        row,
        { translate: '9px 5px', opacity: 0.46 },
        { delay: (Math.min(i, 4) * timing.beat) / 2 }
      );
  });
}
export function removeFrame(row) {
  if (!canMove() || !row) return;
  const box = row.getBoundingClientRect();
  if (box.right < 0 || box.left > innerWidth || box.top > innerHeight || box.bottom < 0) return;
  const ghost = row.cloneNode(true);
  ghost.removeAttribute('data-film');
  ghost.classList.add('departing-frame');
  ghost.inert = true;
  ghost.setAttribute('aria-hidden', 'true');
  Object.assign(ghost.style, {
    left: box.left + 'px',
    top: box.top + 'px',
    width: box.width + 'px',
    height: box.height + 'px',
  });
  document.body.append(ghost);
  const effect = play(
    ghost,
    [{ opacity: 1 }, { translate: '-12px -8px', scale: 0.93, opacity: 0 }],
    { duration: timing.tap }
  );
  if (effect)
    effect.finished.then(
      () => ghost.remove(),
      () => ghost.remove()
    );
  else ghost.remove();
}
let requestedCounters = false;
export function prepareCounters() {
  if (requestedCounters || window.gsap || !canMove()) return;
  requestedCounters = true;
  const script = document.createElement('script');
  script.src = new URL('../assets/vendor/gsap.min.js', import.meta.url).href;
  script.fetchPriority = 'low';
  document.head.append(script);
}

export function statistic(node, value, format) {
  const next = String(value);
  if (node.dataset.value === next) return;
  const last = parseFloat(node.textContent);
  if (node.hasAttribute('data-value')) prepareCounters();
  node.dataset.value = next;
  counters.get(node)?.kill();
  counters.delete(node);
  if (!window.gsap || !canMove() || value === null || !Number.isFinite(last)) {
    node.textContent = format(value);
    return;
  }
  const counter = { value: last };
  counters.set(
    node,
    gsap.to(counter, {
      value,
      duration: timing.shift / 1000,
      ease: 'power2.out',
      onUpdate: () => {
        node.textContent = format(counter.value);
      },
      onComplete: () => {
        node.textContent = format(value);
        counters.delete(node);
      },
    })
  );
}

function visibleBox(node) {
  if (!node?.isConnected) return null;
  const box = node.getBoundingClientRect();
  const clip = node.closest('.movie-list, #matches')?.getBoundingClientRect();
  if (
    !box.width ||
    !box.height ||
    box.right <= 0 ||
    box.bottom <= 0 ||
    box.left >= innerWidth ||
    box.top >= innerHeight ||
    (clip &&
      (box.right <= clip.left ||
        box.left >= clip.right ||
        box.bottom <= clip.top ||
        box.top >= clip.bottom))
  )
    return null;
  return box;
}
export function editedFrame(id) {
  const row = document.querySelector('[data-film="' + CSS.escape(id) + '"]');
  if (!canMove() || !visibleBox(row)) return;
  arrive(
    row.querySelector('h3'),
    { translate: '0 3px', opacity: 0.65 },
    { duration: timing.shift }
  );
  arrive(row.querySelector('.score-badge'), { scale: 1.12 }, { duration: timing.tap });
}
function originBox(opener, id) {
  const match = CSS.escape(id);
  const selector = '[data-film="' + match + '"], [data-print="' + match + '"]';
  const exact = opener?.closest(selector)?.querySelector('.artwork');
  const from = visibleBox(exact);
  if (from) return from;
  // A cross-tab update may have replaced or removed the original mount.
  const mount = document.querySelector('[data-print="' + match + '"] .artwork');
  return (
    visibleBox(mount) ?? visibleBox(document.querySelector('[data-film="' + match + '"] .artwork'))
  );
}
// Transform about the center so the outside corners meet the original print.
function offset(source, dest) {
  if (!source || !dest.width || !dest.height) return 'translateY(12px) scale(.96)';
  const x = source.left - dest.left + (source.width - dest.width) / 2;
  const y = source.top - dest.top + (source.height - dest.height) / 2;
  return (
    'translate(' +
    x +
    'px,' +
    y +
    'px) scale(' +
    source.width / dest.width +
    ',' +
    source.height / dest.height +
    ')'
  );
}
export function focusPrint(poster, source) {
  if (canMove())
    play(
      poster,
      [{ transform: offset(source, poster.getBoundingClientRect()) }, { transform: 'none' }],
      { duration: timing.travel }
    );
}
export function showDialog(dialog, opener, id) {
  const detail = dialog.id === 'detail-dialog';
  const source = canMove() && (detail ? originBox(opener, id) : visibleBox(opener));
  dialog.showModal();
  if (detail) dialog.querySelector('.detail-scroll').scrollTop = 0;
  if (!canMove()) return;
  const q = (s) => dialog.querySelector(s);
  if (detail) {
    const poster = q('#detail-poster');
    play(
      poster,
      [{ transform: offset(source, poster.getBoundingClientRect()) }, { transform: 'none' }],
      { duration: timing.projection }
    );
    arrive(q('.detail-hero'), { scale: 1.024, opacity: 0.22 }, { duration: timing.projection });
    arrive(
      q('.detail-sheet'),
      { translate: compact.matches ? '0 18px' : '20px 3px', opacity: 0.64 },
      { delay: timing.beat * 2, duration: timing.travel }
    );
    ['.detail-heading', '.detail-mount', '.detail-notes'].forEach((s, i) =>
      arrive(
        q(s),
        { translate: '0 6px', opacity: 0.55 },
        { delay: timing.beat * (3 + i), duration: timing.shift }
      )
    );
  } else if (dialog.id === 'editor') {
    const pane = q('.catalog-column'),
      target = pane.getBoundingClientRect();
    const dx = source
      ? Math.max(
          -60,
          Math.min(60, (source.left + source.width / 2 - target.left - target.width / 2) * 0.2)
        )
      : 0;
    const dy = source && source.top < target.top ? -24 : 32;
    arrive(
      pane,
      { translate: dx + 'px ' + dy + 'px', scale: 0.94, opacity: 0.62 },
      { duration: timing.travel }
    );
    arrive(
      q('.rating-bay'),
      { translate: '0 18px', rotate: compact.matches ? '0deg' : '-2deg', scale: 0.95 },
      { delay: timing.beat }
    );
    arrive(q('.editor-foot'), { translate: '0 7px', opacity: 0.68 }, { delay: 2 * timing.beat });
  } else arrive(dialog, { translate: '0 6px', scale: 0.97, opacity: 0.7 });
}
export async function hideDialog(dialog, opener, id) {
  const detail = dialog.id === 'detail-dialog';
  const poster = detail && dialog.querySelector('#detail-poster');
  // Sample the in-flight pose before interruption, then measure the untransformed destination.
  const current = poster && canMove() && getComputedStyle(poster).transform;
  if (canMove()) {
    // Preserve the exposure of the reading glass and captions through an interrupted close.
    for (const [node, effect] of running) {
      if (node !== poster && dialog.contains(node)) effect.pause();
    }
    if (poster) stopMotion(poster);
    const style = getComputedStyle(dialog);
    const start = { opacity: style.opacity, translate: style.translate, scale: style.scale };
    let exit;
    if (poster) {
      const target = offset(originBox(opener, id), poster.getBoundingClientRect());
      play(dialog, [{ opacity: 1 }, { opacity: 0.95, offset: 0.35 }, { opacity: 0 }], {
        duration: timing.shift,
      });
      exit = play(poster, [{ transform: current }, { transform: target }], {
        duration: timing.shift,
        easing: timing.return,
      });
    } else
      exit = play(dialog, [start, { translate: '0 9px', scale: 0.985, opacity: 0 }], {
        duration: timing.tap,
      });
    await exit?.finished.catch(() => {});
  }
  dialog.close();
  cancelInside(dialog);
}

// Local glass reflections track only the two narrow glass rails, one write per frame.
const fine = matchMedia(
  '(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)'
);
for (const rail of document.querySelectorAll('.dock,.toolbar')) {
  let frame = 0,
    clientX = 0;
  function reset() {
    cancelAnimationFrame(frame);
    frame = 0;
    rail.style.removeProperty('--glint');
  }
  rail.addEventListener('pointermove', (event) => {
    if (!fine.matches || event.pointerType !== 'mouse' || document.hidden) return;
    clientX = event.clientX;
    if (!frame)
      frame = requestAnimationFrame(() => {
        frame = 0;
        const box = rail.getBoundingClientRect();
        rail.style.setProperty('--glint', Math.round(clientX - box.left - box.width / 2) + 'px');
      });
  });
  rail.addEventListener('pointerleave', reset);
  fine.addEventListener('change', reset);
}
