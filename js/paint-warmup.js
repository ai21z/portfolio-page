// The first entry into About, Skills or Contact held one frame of 70 to 170 ms while the GPU process
// built the programs for the paper cards, the lens glass and the notebook's typed glyphs. The second
// entry does not pay it. The idle warm-up paints a copy of each, all but invisible, for a few frames on
// the landing, so those programs are ready before the visitor opens the view. The cards and the lens
// need only a corner of themselves painted; the notebook's glyphs are drawn only where they show, so
// its copy is painted whole.
//
// The programs still cost a frame, now on the landing. So the copies wait until the landing's intro has
// played (the portrait fades in over 8.2 s) and the pointer has rested a moment, and that frame falls
// where nobody is acting.
const EARLIEST_MS = 9000;
const STILL_MS = 1500;
let lastInput = 0;
for (const type of ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart']) {
  window.addEventListener(type, () => { lastInput = performance.now(); }, { capture: true, passive: true });
}

function quietMoment() {
  return new Promise((resolve) => {
    const check = () => {
      const now = performance.now();
      const wait = Math.max(EARLIEST_MS - now, lastInput + STILL_MS - now);
      if (wait <= 0) resolve();
      else setTimeout(check, wait);
    };
    check();
  });
}

const frames = (count) => new Promise((resolve) => {
  const next = (left) => (left ? requestAnimationFrame(() => next(left - 1)) : resolve());
  next(count);
});

function inertCopy(element) {
  const copy = element.cloneNode(true);
  for (const node of [copy, ...copy.querySelectorAll('*')]) {
    for (const attribute of ['id', 'name', 'for', 'data-paper']) node.removeAttribute(attribute);
  }
  return copy;
}

// One copy at a time, each in its own quiet moment, so the programs are built over several small
// frames instead of one large one.
async function paintCopies(selectors, whole) {
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (!element) continue;
    await quietMoment();
    await new Promise((resolve) => requestIdleCallback(resolve, { timeout: 1000 }));
    const holder = document.createElement('div');
    holder.className = whole ? 'paint-warmup' : 'paint-warmup paint-warmup--corner';
    holder.setAttribute('aria-hidden', 'true');
    holder.inert = true;
    holder.append(inertCopy(element));
    document.body.append(holder);
    await frames(3);
    holder.remove();
  }
}

export const warmPaperPaint = () => paintCopies(['#about .slab', '#skills .slab', '#about .altar-lens'], false);
export const warmNotebookPaint = () => paintCopies(['#contact .notebook-page'], true);
