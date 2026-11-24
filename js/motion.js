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
  const sequence = gsap.timeline({ defaults: { ease, clearProps: 'transform,opacity' } });
  sequence
    .from('.plaza', { scale: 1.035, duration: 1.15 }, 0)
    .from('.stage-copy', { x: -14, opacity: 0.35, duration: 0.48 }, 0)
    .from('.stage-space', { y: 18, scale: 0.94, duration: 0.72 }, 0)
    .from('.archive', { y: 12, opacity: 0.5, duration: 0.48 }, 0.09);
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
  if (!animate()) return new Map();
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
    if (
      box.bottom < 0 ||
      box.top > window.innerHeight + 120 ||
      box.right < 0 ||
      box.left > innerWidth + 24
    )
      return;
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

function posterOffset(opener, poster) {
  const candidate = opener?.dataset.targetFilm
    ? document.querySelector('[data-film="' + CSS.escape(opener.dataset.targetFilm) + '"] .artwork')
    : (opener?.querySelector('.artwork') ?? document.querySelector('#latest .artwork'));
  const source = candidate?.getBoundingClientRect();
  const target = poster.getBoundingClientRect();
  if (
    !source?.width ||
    !target.width ||
    source.bottom <= 0 ||
    source.top >= innerHeight ||
    source.left >= innerWidth ||
    source.right <= 0
  )
    return { y: 18, scale: 0.91 };
  return {
    x: source.left - target.left + (source.width - target.width) / 2,
    y: source.top - target.top + (source.height - target.height) / 2,
    scaleX: source.width / target.width,
    scaleY: source.height / target.height,
  };
}

export function showDialog(dialog, opener) {
  dialog.showModal();
  if (dialog.id === 'detail-dialog') dialog.querySelector('.detail-scroll').scrollTop = 0;
  if (!animate()) return;
  const timeline = gsap.timeline({ defaults: { ease, clearProps: 'transform,opacity' } });
  if (dialog.id === 'detail-dialog') {
    const poster = dialog.querySelector('#detail-poster');
    timeline
      .from(poster, { ...posterOffset(opener, poster), duration: 0.46 }, 0)
      .from(
        dialog.querySelector('.detail-sheet'),
        { x: 22, y: 8, opacity: 0, duration: 0.35 },
        0.07
      )
      .from(dialog.querySelector('.detail-hero'), { opacity: 0, duration: 0.46 }, 0);
  } else if (dialog.id === 'editor') {
    timeline
      .from(
        dialog.querySelector('.catalog-column'),
        { y: 38, scale: 0.92, opacity: 0.3, duration: 0.36 },
        0
      )
      .from(
        dialog.querySelector('.rating-bay'),
        { y: 24, rotation: -2, scale: 0.9, opacity: 0.2, duration: 0.4 },
        0.035
      )
      .from(dialog.querySelector('.editor-foot'), { y: 12, opacity: 0.3, duration: 0.24 }, 0.08);
  } else timeline.from(dialog, { scale: 0.95, y: 8, opacity: 0.4, duration: 0.2 }, 0);
}

export function hideDialog(dialog, opener) {
  if (!animate()) {
    dialog.close();
    return Promise.resolve();
  }
  const poster = dialog.id === 'detail-dialog' && dialog.querySelector('#detail-poster');
  return new Promise((resolve) => {
    const timeline = gsap.timeline({
      onComplete: () => {
        dialog.close();
        gsap.set(dialog, { clearProps: 'transform,opacity' });
        if (poster) gsap.set(poster, { clearProps: 'transform' });
        resolve();
      },
    });
    if (poster) {
      gsap.getTweensOf(poster).forEach((tween) => tween.totalProgress(1).kill());
      timeline
        .to(poster, { ...posterOffset(opener, poster), duration: 0.26, ease: 'power2.inOut' }, 0)
        .to(dialog, { opacity: 0, duration: 0.17 }, 0.09);
    } else timeline.to(dialog, { opacity: 0, y: 10, duration: 0.16, ease: 'power2.out' });
  });
}
