import { arrive, canMove, play, stageCaptions, stopMotion, timing } from './motion.js';
import { artwork, icon } from './views.js';

const byId = (id) => document.getElementById(id);
const mounts = [...document.querySelectorAll('.mount')];
const head = byId('headline');
const emptyHeading = head.cloneNode(true);
const command = byId('stage-open');
const initialCopy = byId('stage-description').textContent;
const ribbon = document.querySelector('.ribbon');
const shuttle = document.querySelector('.shuttle');
const mounted = new WeakMap();
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const remembered = new Map();
let sequence = [];
let section;
let index = -1;
let shown;
let newest;
let highlighted;

export const currentFrame = () => sequence[index];
export const latestFrame = () => newest;
export const rememberFrame = (type, id) => remembered.set(type, id);
let departing;

function drawMount(button, entry, origins, prints, direction) {
  const prior = mounted.get(button);
  if (prior === entry) return;
  stopMotion(button);
  mounted.set(button, entry);
  button.hidden = !entry;
  if (entry) button.dataset.print = entry.id;
  else delete button.dataset.print;
  button.replaceChildren();
  if (!entry) return;
  const center = button.id === 'latest';
  const print = prints.get(entry.id);
  const frame =
    print?.title === entry.title && print.path === entry.metadata?.posterPath
      ? print.node
      : artwork(entry.metadata?.posterPath, 'w342', entry.mediaType, entry.title);
  const name = document.createElement('span');
  name.className = 'sr-only';
  name.textContent = (center ? 'Open details for ' : 'Show poster for ') + entry.title;
  button.append(frame, name);
  if (!origins || prior?.id === entry.id) return;
  const from = origins.get(entry.id);
  const destination = getComputedStyle(button).transform;
  const start =
    from?.pose ??
    destination +
      ' translate3d(' +
      direction * 34 +
      'px, 9px, -90px) rotateY(' +
      direction * -9 +
      'deg)';
  // Pose and elevation are independent. Take the old print's live pose on an interrupted turn.
  play(
    button,
    [
      { transform: start, translate: from?.lift ?? '0px 0px', opacity: from?.opacity ?? 0.25 },
      { translate: '0px -5px', offset: 0.48 },
      { transform: destination, translate: '0px 0px', opacity: 1 },
    ],
    { duration: timing.travel }
  );
}

function releasePrint(print, pose, direction) {
  if (departing) {
    stopMotion(departing);
    departing.remove();
  }
  const sleeve = document.createElement('span');
  sleeve.className = 'mount departing-print';
  sleeve.setAttribute('aria-hidden', 'true');
  sleeve.inert = true;
  sleeve.append(print);
  space.append(sleeve);
  departing = sleeve;
  const flight = play(
    sleeve,
    [
      { transform: pose, opacity: 0.86 },
      { transform: pose + ' translate3d(' + -direction * 32 + 'px,4px,-84px)', opacity: 0 },
    ],
    { duration: timing.tap }
  );
  const clear = () => {
    sleeve.remove();
    if (departing === sleeve) departing = null;
  };
  if (flight) flight.finished.then(clear, clear);
  else clear();
}

function paint(move = false, direction = 1, follow = false) {
  const active = currentFrame();
  const count = sequence.length;
  const animate = move && canMove();
  const origins = animate
    ? new Map(
        mounts
          .filter((b) => !b.hidden)
          .map((b) => {
            const style = getComputedStyle(b);
            return [
              mounted.get(b)?.id,
              { pose: style.transform, lift: style.translate, opacity: style.opacity },
            ];
          })
      )
    : null;
  const previous = count > 2 ? sequence[(index + count - 1) % count] : null;
  const next = count > 1 ? sequence[(index + 1) % count] : null;
  const prints = new Map();
  for (const button of mounts) {
    const entry = mounted.get(button);
    if (entry)
      prints.set(entry.id, {
        node: button.querySelector('.artwork'),
        title: entry.title,
        path: entry.metadata?.posterPath,
      });
  }
  const trio = [previous, active, next];
  if (origins && shown && !trio.some((e) => e?.id === shown.id) && prints.has(shown.id)) {
    releasePrint(prints.get(shown.id).node, origins.get(shown.id).pose, direction);
  }
  trio.forEach((entry, i) => drawMount(mounts[i], entry, origins, prints, direction));
  if (animate && active !== shown) {
    stageCaptions(direction);
    if (!active)
      arrive(
        ribbon,
        { scale: 0.94, translate: '0 12px', opacity: 0.6 },
        { duration: timing.travel }
      );
  }
  const latestButton = byId('return-latest');
  latestButton.hidden = !newest || newest === active;
  ribbon.hidden = Boolean(active);
  shuttle.hidden = count < 2;
  byId('stage-index').textContent = index + 1 + ' / ' + count;
  const announcement = active ? active.title + ', poster ' + (index + 1) + ' of ' + count : '';
  const status = byId('stage-status');
  if (status.textContent !== announcement) status.textContent = announcement;
  if (active !== shown) {
    const score = byId('stage-score');
    if (active) {
      head.textContent = active.title;
      const meta = active.metadata;
      byId('stage-kicker').textContent = [
        section === 'tv' ? 'TV Series' : 'Movie',
        typeof meta?.releaseDate === 'string' ? meta.releaseDate.slice(0, 4) : '',
        typeof meta?.genres?.[0]?.name === 'string' ? meta.genres[0].name : '',
      ]
        .filter(Boolean)
        .join('  /  ');
      byId('stage-description').textContent =
        typeof meta?.overview === 'string' ? meta.overview : '';
      score.querySelector('strong').textContent = active.rating.toFixed(1);
      command.replaceChildren(icon('next'), 'View title');
      command.removeAttribute('data-add');
      command.setAttribute('aria-haspopup', 'dialog');
      command.setAttribute('aria-controls', 'detail-dialog');
    } else {
      head.replaceChildren(...[...emptyHeading.childNodes].map((node) => node.cloneNode(true)));
      byId('stage-kicker').textContent = 'Personal watch journal';
      byId('stage-description').textContent = initialCopy;
      command.replaceChildren(icon('plus'), 'Add a title');
      command.dataset.add = '';
      command.removeAttribute('aria-haspopup');
      command.removeAttribute('aria-controls');
      command.removeAttribute('aria-expanded');
    }
    score.hidden = !active;
    shown = active;
    document.querySelector('.opening').classList.toggle('has-film', Boolean(active));
  }
  highlighted?.removeAttribute('data-current');
  highlighted?.querySelector('.open-card')?.removeAttribute('aria-current');
  highlighted =
    active && document.querySelector('.movie-list [data-film="' + CSS.escape(active.id) + '"]');
  if (highlighted) {
    highlighted.dataset.current = '';
    highlighted.querySelector('.open-card').setAttribute('aria-current', 'true');
    if (follow) {
      const strip = highlighted.parentElement;
      const box = highlighted.getBoundingClientRect(),
        bounds = strip.getBoundingClientRect();
      const shift =
        box.left < bounds.left ? box.left - bounds.left : Math.max(0, box.right - bounds.right);
      if (shift) strip.scrollBy({ left: shift, behavior: reduced.matches ? 'instant' : 'smooth' });
    }
  }
}
export function arrangeStage(visibleEntries, group, type) {
  const previousSection = section;
  section = type;
  newest = group.reduce(
    (latest, entry) =>
      !latest || Date.parse(entry.added) > Date.parse(latest.added) ? entry : latest,
    null
  );
  sequence = visibleEntries.length ? visibleEntries : newest ? [newest] : [];
  index = sequence.findIndex((entry) => entry.id === remembered.get(type));
  if (index < 0 && sequence.length) index = 0;
  paint(
    previousSection !== undefined,
    previousSection !== type && type === 'movie' ? -1 : 1,
    previousSection !== undefined && currentFrame()?.id !== shown?.id
  );
}
export function cueFrame(id, direction) {
  const destination = sequence.findIndex((entry) => entry.id === id);
  if (destination < 0 || destination === index) return;
  direction ??= Math.sign(destination - index);
  index = destination;
  remembered.set(section, currentFrame().id);
  paint(true, direction, true);
}
export function stepFrame(direction) {
  if (sequence.length < 2) return;
  cueFrame(sequence[(index + direction + sequence.length) % sequence.length].id, direction);
}

// One camera response for the whole gate. No animation loop runs at rest.
const space = document.querySelector('.stage-space');
const finePointer = matchMedia(
  '(hover:hover) and (pointer:fine) and (prefers-reduced-motion:no-preference)'
);
let lightFrame = 0;
let lightX = 0,
  lightY = 0;
function settleLight() {
  cancelAnimationFrame(lightFrame);
  lightFrame = 0;
  space.style.removeProperty('--yaw');
  space.style.removeProperty('--pitch');
  space.style.removeProperty('--shine');
}
space.addEventListener('pointermove', (event) => {
  if (!finePointer.matches || event.pointerType !== 'mouse') return;
  lightX = event.clientX;
  lightY = event.clientY;
  if (lightFrame) return;
  lightFrame = requestAnimationFrame(() => {
    lightFrame = 0;
    const bounds = space.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (lightX - bounds.left) / bounds.width));
    const y = Math.min(1, Math.max(0, (lightY - bounds.top) / bounds.height));
    space.style.setProperty('--yaw', (x - 0.5) * 5 + 'deg');
    space.style.setProperty('--pitch', (0.5 - y) * 3 + 'deg');
    space.style.setProperty('--shine', 15 + 70 * x + '%');
  });
});
space.addEventListener('pointerleave', settleLight);
finePointer.addEventListener('change', settleLight);

let touch;
let dragFrame = 0;
let dragDistance = 0;
function releaseDrag() {
  cancelAnimationFrame(dragFrame);
  dragFrame = 0;
  touch = null;
  if (!space.style.translate) return;
  const from = space.style.translate;
  space.style.removeProperty('translate');
  play(space, [{ translate: from }, { translate: '0px' }], { duration: timing.shift });
}
space.addEventListener(
  'pointermove',
  (event) => {
    if (!touch || event.pointerId !== touch.id || !canMove()) return;
    const dx = event.clientX - touch.x;
    if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(event.clientY - touch.y) * 1.4) return;
    dragDistance = Math.max(-19, Math.min(19, dx * 0.21));
    if (!dragFrame)
      dragFrame = requestAnimationFrame(() => {
        dragFrame = 0;
        space.style.translate = dragDistance + 'px';
      });
  },
  { passive: true }
);
reduced.addEventListener('change', releaseDrag);
document.addEventListener('visibilitychange', releaseDrag);
let suppressClick = false;
space.addEventListener('pointerdown', (event) => {
  suppressClick = false;
  if (event.pointerType === 'touch' && event.isPrimary && sequence.length > 1)
    touch = { id: event.pointerId, x: event.clientX, y: event.clientY };
});
space.addEventListener('pointercancel', releaseDrag);
space.addEventListener('pointerup', (event) => {
  if (!touch || event.pointerId !== touch.id) return;
  const dx = event.clientX - touch.x,
    dy = event.clientY - touch.y;
  releaseDrag();
  if (Math.abs(dx) < 36 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
  suppressClick = true;
  stepFrame(dx < 0 ? 1 : -1);
});
space.addEventListener(
  'click',
  (event) => {
    if (suppressClick && event.detail) {
      event.preventDefault();
      event.stopPropagation();
    }
    suppressClick = false;
  },
  true
);
