const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const animate = () => window.gsap && !reduced.matches && !document.hidden;

export function entrance() {
  if (!animate()) return;
  gsap.from('.hero-art', { scale: 1.035, duration: 1.25, ease: 'power2.out' });
  gsap.from(
    ['.eyebrow', '.hero h1 span', '.hero h1 em', '.hero p', '.collection-top', '.toolbar'],
    {
      y: 13,
      opacity: 0,
      stagger: 0.065,
      duration: 0.58,
      ease: 'power3.out',
      clearProps: 'transform,opacity',
    }
  );
}

export function positions(list) {
  return new Map(
    [...list.querySelectorAll('[data-film]')].map((row) => [
      row.dataset.film,
      row.getBoundingClientRect().top,
    ])
  );
}

export function reveal(list, previous) {
  if (!animate()) return;
  let entered = 0;
  for (const row of list.children) {
    const top = previous.get(row.dataset.film);
    if (top !== undefined) {
      const y = top - row.getBoundingClientRect().top;
      if (Math.abs(y) > 1)
        gsap.from(row, { y, duration: 0.32, ease: 'power3.out', clearProps: 'transform' });
    } else {
      gsap.from(row, {
        y: 8,
        opacity: 0,
        duration: 0.33,
        delay: Math.min(entered++, 7) * 0.035,
        clearProps: 'transform,opacity',
      });
    }
  }
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
    background: 'var(--bg)',
    zIndex: '1',
  });
  document.body.append(ghost);
  gsap.to(ghost, { x: -15, opacity: 0, duration: 0.22, onComplete: () => ghost.remove() });
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

export function showDialog(dialog) {
  dialog.showModal();
  if (animate())
    gsap.fromTo(
      dialog,
      { y: 22, opacity: 0, scale: 0.985, clipPath: 'inset(0 0 7% 0 round 10px)' },
      {
        y: 0,
        opacity: 1,
        scale: 1,
        clipPath: 'inset(0 0 0% 0 round 10px)',
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
