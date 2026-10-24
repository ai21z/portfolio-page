// Under reduced motion a scene holds still, so redrawing it every frame only spends the GPU on the
// same picture. After a second with no input a held loop waits a second between frames instead,
// so a late texture or a layout change still shows, and any input on the scene wakes it at once.

import { reducedMotion } from './motion.js';

const IDLE_AFTER_MS = 1000;
const IDLE_FRAME_MS = 1000;

export function createStillPacer(root) {
  let lastInput = performance.now();
  let timer = 0;
  let waiting = null;

  const touch = () => {
    lastInput = performance.now();
    if (!timer) return;
    clearTimeout(timer);
    timer = 0;
    const resume = waiting;
    waiting = null;
    resume?.();
  };

  for (const type of ['pointermove', 'pointerdown', 'wheel', 'keydown', 'focusin']) {
    root?.addEventListener(type, touch, { capture: true, passive: true });
  }
  for (const type of ['resize', 'dpr-changed', 'graphics:profile-change', 'motion:preference']) {
    window.addEventListener(type, touch);
  }

  return {
    touch,
    // True when a held loop should wait rather than ask for the next frame now.
    shouldIdle(now = performance.now()) {
      return reducedMotion && now - lastInput > IDLE_AFTER_MS;
    },
    // Calls resume after the idle frame interval, or as soon as input arrives.
    wait(resume) {
      clearTimeout(timer);
      waiting = resume;
      timer = setTimeout(() => {
        timer = 0;
        waiting = null;
        resume();
      }, IDLE_FRAME_MS);
    },
    cancel() {
      clearTimeout(timer);
      timer = 0;
      waiting = null;
    }
  };
}
