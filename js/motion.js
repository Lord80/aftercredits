import { alignLens } from './viewfinder.js';

const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const animate = () => window.gsap && !reduced.matches && !document.hidden;

const ease = 'power3.out';
reduced.addEventListener('change', (event) => {
  if (event.matches)
    window.gsap?.globalTimeline
      .getChildren(false, true, true)
      .forEach((tween) => tween.totalProgress(1));
});

export function entrance() {
  if (!animate()) return;
  const sequence = gsap.timeline({
    onComplete: alignLens,
    defaults: { ease, clearProps: 'transform,opacity' },
  });
  sequence
    .from('.plaza', { scale: 1.025, xPercent: 0.35, duration: 1.4 }, 0)
    .from(
      ['.eyebrow', '.opening h1 > span', '.opening h1 em', '.intro', '.hero-add'],
      { opacity: 0, y: 14, stagger: 0.055, duration: 0.52 },
      0.035
    )
    .from(
      ['.viewer', '.archive-head'],
      { opacity: 0.35, y: 14, scale: 0.97, stagger: 0.06, duration: 0.54 },
      0.16
    );
}

export function accentRating(node) {
  if (animate())
    gsap.fromTo(
      node,
      { scale: 1.13, y: -1 },
      { scale: 1, y: 0, duration: 0.22, ease, overwrite: true, clearProps: 'transform' }
    );
}

export function positions(list) {
  return new Map(
    [...list.querySelectorAll('[data-film]')].map((row) => [
      row.dataset.film,
      row.getBoundingClientRect(),
    ])
  );
}

export function reveal(list, previous) {
  if (!animate()) return;
  const rows = [...list.children];
  // Read all destination boxes together, before starting any new tweens.
  for (const tween of gsap.getTweensOf(rows)) tween.totalProgress(1).kill();
  const boxes = rows.map((row) => row.getBoundingClientRect());
  let entered = 0;
  rows.forEach((row, index) => {
    const box = boxes[index];
    if (box.bottom < 0 || box.top > window.innerHeight + 120) return;
    const prior = previous.get(row.dataset.film);
    if (prior) {
      const x = prior.left - box.left,
        y = prior.top - box.top;
      if (Math.abs(x) > 1 || Math.abs(y) > 1)
        gsap.from(row, { x, y, duration: 0.34, ease, clearProps: 'transform' });
    } else {
      gsap.from(row, {
        y: 12,
        opacity: 0,
        scale: 0.991,
        duration: 0.38,
        delay: Math.min(entered++, 5) * 0.028,
        ease,
        clearProps: 'transform,opacity',
      });
    }
  });
}

export function removeFrame(row) {
  if (!row || !animate()) return;
  const bounds = row.getBoundingClientRect();
  const ghost = row.cloneNode(true);
  ghost.removeAttribute('data-film');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  Object.assign(ghost.style, {
    position: 'fixed',
    pointerEvents: 'none',
    top: bounds.top + 'px',
    left: bounds.left + 'px',
    width: bounds.width + 'px',
    height: bounds.height + 'px',
    zIndex: '1',
  });
  document.body.append(ghost);
  gsap.to(ghost, {
    y: -5,
    scale: 0.97,
    opacity: 0,
    duration: 0.2,
    onComplete: () => ghost.remove(),
  });
}

export function statistic(node, value, format) {
  const last = Number(node.dataset.value);
  if (value === last) return;
  node.dataset.value = String(value);
  node._counter?.kill();
  if (value === null || !Number.isFinite(last) || !animate()) {
    node.textContent = format(value);
    return;
  }
  const counter = { value: last };
  node._counter = gsap.to(counter, {
    value,
    duration: 0.36,
    ease: 'power2.out',
    onUpdate: () => {
      node.textContent = format(counter.value);
    },
    onComplete: () => {
      node.textContent = format(value);
    },
  });
}

export function showDialog(dialog, opener) {
  dialog.showModal();
  if (!animate()) return;
  const from = opener.getBoundingClientRect();
  const to = dialog.getBoundingClientRect();
  const clamp = gsap.utils.clamp;
  // Expand toward the chosen object while keeping the readable pane close to its final position.
  const x = clamp(-36, 36, (from.left + from.width / 2 - to.left - to.width / 2) * 0.14);
  const y = clamp(-26, 26, (from.top + from.height / 2 - to.top - to.height / 2) * 0.14);
  gsap.fromTo(
    dialog,
    { x, y, opacity: 0.3, scale: 0.94 },
    {
      x: 0,
      y: 0,
      opacity: 1,
      scale: 1,
      duration: 0.32,
      ease: 'power3.out',
      clearProps: 'all',
      overwrite: true,
    }
  );
}

export function hideDialog(dialog) {
  if (!animate()) {
    dialog.close();
    return Promise.resolve();
  }
  return new Promise((resolve) =>
    gsap.to(dialog, {
      y: 9,
      opacity: 0,
      duration: 0.15,
      overwrite: true,
      onComplete() {
        dialog.close();
        gsap.set(dialog, { clearProps: 'all' });
        resolve();
      },
    })
  );
}
