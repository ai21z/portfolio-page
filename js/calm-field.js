// The calm field on the landing (styles/components.css, #main[data-calm]::before): a dark ellipse under the
// name, the portrait, the bio, the project links and the colophon, so the network fades out where the
// reading happens and still frames the screen from the right. It is sized from those elements' text, not
// a fixed box, so it follows any change to the column. Compact layouts stack the column over the whole
// width and keep the network as it is.
import { isCompact, compactMediaQuery } from './compact.js';

const main = document.getElementById('main');
const READING = ['.name', '.tape', '.selected-projects', '.foot small', '.foot-coords'];
let frame = 0;

// The text itself: the name and the colophon sit in boxes that span the whole grid.
function textRect(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  return range.getBoundingClientRect();
}

function place() {
  frame = 0;
  if (isCompact()) {
    delete main.dataset.calm;
    return;
  }
  const portrait = main.querySelector('.portrait');
  const rects = READING.map((selector) => main.querySelector(selector)).filter(Boolean).map(textRect);
  if (portrait) rects.push(portrait.getBoundingClientRect());
  const shown = rects.filter((rect) => rect.width && rect.height);
  if (!shown.length) return;
  const box = main.getBoundingClientRect();
  const left = Math.min(...shown.map((rect) => rect.left)) - box.left;
  const top = Math.min(...shown.map((rect) => rect.top)) - box.top;
  const width = Math.max(...shown.map((rect) => rect.right)) - box.left - left;
  const height = Math.max(...shown.map((rect) => rect.bottom)) - box.top - top;
  // Centred left of the column's middle, where the portrait and the start of every line sit, and wide
  // enough that the darkest part covers the bio. Fitted to Sitting B's landing C at 1440x900.
  main.style.setProperty('--calm-x', `${Math.round(left + width * 0.27)}px`);
  main.style.setProperty('--calm-y', `${Math.round(top + height * 0.48)}px`);
  main.style.setProperty('--calm-rx', `${Math.round(width * 1.1)}px`);
  main.style.setProperty('--calm-ry', `${Math.round(height * 0.875)}px`);
  main.dataset.calm = '';
}

function schedule() {
  if (!frame) frame = requestAnimationFrame(place);
}

if (main) {
  const observer = new ResizeObserver(schedule);
  observer.observe(main);
  for (const el of main.querySelectorAll([...READING, '.portrait'].join(', '))) observer.observe(el);
  compactMediaQuery().addEventListener('change', schedule);
  document.fonts?.ready.then(schedule);
  schedule();
}
