// Project the section of the street behind the aperture at a slightly longer
// focal length. Only this small window repaints while it is on screen.
const aperture = document.querySelector('.viewer-aperture');
const street = document.querySelector('.plaza img');
const latest = document.getElementById('latest');
const desktop = matchMedia('(min-width: 651px)');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
let visible = false;
let frame = 0;

function project() {
  frame = 0;
  if (!desktop.matches || !latest.hidden || !street.naturalWidth) return;
  const lens = aperture.getBoundingClientRect();
  const field = street.getBoundingClientRect();
  const fit = Math.max(field.width / street.naturalWidth, field.height / street.naturalHeight);
  const width = street.naturalWidth * fit;
  const height = street.naturalHeight * fit;
  const [xAnchor, yAnchor] = getComputedStyle(street).objectPosition.split(' ').map(parseFloat);
  const x = lens.left + lens.width / 2 - field.left - ((field.width - width) * xAnchor) / 100;
  const y = lens.top + lens.height / 2 - field.top - ((field.height - height) * yAnchor) / 100;
  const zoom = 1.18;
  aperture.style.setProperty('--lens-size', width * zoom + 'px ' + height * zoom + 'px');
  aperture.style.setProperty(
    '--lens-position',
    aperture.clientWidth / 2 - x * zoom + 'px ' + (aperture.clientHeight / 2 - y * zoom) + 'px'
  );
}

export function alignLens() {
  if (!frame) frame = requestAnimationFrame(project);
}

export function startViewfinder() {
  street.addEventListener('load', alignLens);
  if ('ResizeObserver' in window) new ResizeObserver(alignLens).observe(aperture);
  if ('IntersectionObserver' in window)
    new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) alignLens();
    }).observe(aperture);
  window.addEventListener('resize', alignLens);
  window.addEventListener(
    'scroll',
    () => {
      if (visible && latest.hidden && desktop.matches && !reduced.matches) alignLens();
    },
    { passive: true }
  );
  alignLens();
}
