// Scroll only the physical filmstrip, keeping the selected poster and page still.
const controls = document.querySelector('.strip-controls');
let strip;
let queued = 0;
function measure() {
  queued = 0;
  const extent = strip ? strip.scrollWidth - strip.clientWidth : 0;
  controls.hidden = extent < 2;
  if (!controls.hidden) {
    controls.firstElementChild.disabled = strip.scrollLeft < 2;
    controls.lastElementChild.disabled = strip.scrollLeft >= extent - 2;
  }
}
function schedule() {
  if (!queued) queued = requestAnimationFrame(measure);
}
const observer = 'ResizeObserver' in window ? new ResizeObserver(schedule) : null;
window.addEventListener('resize', schedule);
export function trackStrip(list) {
  if (strip !== list) {
    strip?.removeEventListener('scroll', schedule);
    observer?.disconnect();
    strip = list;
    if (strip) {
      strip.addEventListener('scroll', schedule, { passive: true });
      observer?.observe(strip);
    }
  }
  schedule();
}
controls.addEventListener('click', (event) => {
  const button = event.target.closest('[data-scroll]');
  if (!button || !strip) return;
  strip.scrollBy({
    left: strip.clientWidth * 0.87 * Number(button.dataset.scroll),
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
  });
});
