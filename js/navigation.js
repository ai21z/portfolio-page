// Navigation and label management

import { NAV_COORDS, NAV_ORDER, LABEL_OFFSET_PX, NAV_SPEED_WHEN_ACTIVE, RITUAL_LABEL_NUDGE_PX } from './config.js';
import {
  prefersReducedMotion,
  COVER,
  MYC_MAP,
  NAV_OFFSETS,
  currentNavHover,
  setCurrentNavHover,
  ritualActive,
  LOCKED_ROUTES,
  setActiveAnims,
  hudEnabled
} from './state.js';
import { coverMap } from './viewport.js';

// Branch-normal offsets pushing labels away from mycelium
export function computeNavOffsets(){
  if (!MYC_MAP || !MYC_MAP.paths) return;
  const cx = COVER.baseW/2, cy = COVER.baseH/2;

  for (const [id, {x:px, y:py}] of Object.entries(NAV_COORDS)){
    if (id === 'intro') {
      NAV_OFFSETS[id] = { nx: 0, ny: 0 };
      continue;
    }
    
    let bestD2 = Infinity, nx = 0, ny = 0;

    for (const path of MYC_MAP.paths){
      if (!path || path.length < 2) continue;
      for (let i=0;i<path.length-1;i++){
        const [ax,ay] = path[i], [bx,by] = path[i+1];
        const abx=bx-ax, aby=by-ay, ab2=abx*abx+aby*aby;
        if (ab2 < 1e-6) continue;

        const t = Math.max(0, Math.min(1, ((px-ax)*abx + (py-ay)*aby)/ab2));
        const cxp = ax + t*abx, cyp = ay + t*aby;
        const dx = px - cxp, dy = py - cyp, d2 = dx*dx + dy*dy;
        if (d2 < bestD2){
          bestD2 = d2;
          const len = Math.sqrt(ab2);
          nx = -aby/len; ny = abx/len;
          const vx = px - cx, vy = py - cy;
          if (nx*vx + ny*vy < 0){ nx = -nx; ny = -ny; }
        }
      }
    }

    const mag = LABEL_OFFSET_PX[id] ?? 22;
    NAV_OFFSETS[id] = { nx: nx*mag, ny: ny*mag };
  }
}

// The outgoing section keeps painting while it fades out (styles/layout.css .stage-leaving), so a
// switch overlaps the two views instead of cutting to an empty frame. Its modules release their
// canvases on 'stage:left'. Matches the 450 ms fade with a little margin.
const STAGE_LEAVE_MS = 500;

function finishLeaving(stage) {
  window.clearTimeout(stage.__leaveTimer);
  stage.__leaveTimer = 0;
  stage.classList.remove('stage-leaving');
  stage.dispatchEvent(new CustomEvent('stage:left', { bubbles: true }));
}

function leaveStage(stage, instant) {
  window.clearTimeout(stage.__leaveTimer);
  if (instant || prefersReducedMotion) {
    finishLeaving(stage);
    return;
  }
  stage.classList.add('stage-leaving');
  stage.__leaveTimer = window.setTimeout(() => finishLeaving(stage), STAGE_LEAVE_MS);
}

// The wheel scrolls whatever can scroll under the pointer, or the section's own list from anywhere
// on it (Work's timeline, or the section itself under the overlay nav). A wheel gesture that starts
// with nothing to scroll in its direction, and that nothing else consumed (the Blog dish zooms),
// steps to the previous or next section instead. One gesture, trackpad inertia included, moves one
// section, and the rest of that gesture is left alone by the section it lands on.
const WHEEL_ORDER = ['intro', 'about', 'skills', 'blog', 'work', 'contact'];
const WHEEL_STEP_PX = 60;
// A pause this long ends a gesture. Trackpad inertia keeps firing well inside it.
const WHEEL_GESTURE_GAP_MS = 220;
// Wheel input can be held up on its way to the page: behind a long task (Blog's first visit
// compiles its scene), or in a busy browser or GPU process (another tab compiling shaders). It
// reaches the page late, Chrome merges it into one event stamped with the newest input, and that
// looks like a pause. Input held up to this long still rejoins its gesture.
const WHEEL_HELD_MS = 1000;
// A gesture's end timer that runs this late ran after a long task.
const WHEEL_STALL_MS = 50;
// Covers the cross-fade, so a step never lands on a section still fading in.
const WHEEL_STEP_COOLDOWN_MS = 700;
// Wheel speed is read in px per frame of this length: the travel since the last reading over the
// time since it. A merged event spans several frames, so its speed stays true.
const WHEEL_FRAME_MS = 16;
// A reading spans at least this long, so events closer together (a 240 Hz display, a 1000 Hz
// mouse) add up into one, while a 120 or 144 Hz event, a touch among them, still reads on its own.
const WHEEL_READ_MS = 7;

// Scroll positions as last seen. A fast wheel without scroll animation can carry a box to its end
// before this listener runs, and that gesture still belongs to the box, not to a section step.
const seenScrollTop = new WeakMap();
if (typeof document !== 'undefined') {
  document.addEventListener('scroll', (event) => {
    const el = event.target === document ? document.scrollingElement : event.target;
    if (el instanceof Element) seenScrollTop.set(el, el.scrollTop);
  }, { capture: true, passive: true });
}

// The viewport takes html's overflow, or body's when html leaves it visible. Panel sections set
// both to hidden, and then the document cannot scroll however tall it is.
function viewportScrolls() {
  const html = getComputedStyle(document.documentElement).overflowY;
  const overflow = html === 'visible' ? getComputedStyle(document.body).overflowY : html;
  return overflow !== 'hidden' && overflow !== 'clip';
}

function scrollableIn(el, direction) {
  return el.scrollHeight > el.clientHeight + 1
    && (direction > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0);
}

function isScroller(el, style) {
  return el === document.scrollingElement ? viewportScrolls() : style.overflowY === 'auto' || style.overflowY === 'scroll';
}

function movedUnseen(el) {
  const seen = seenScrollTop.get(el);
  return seen !== undefined && seen !== el.scrollTop;
}

function canScrollFrom(target, direction) {
  for (let el = target instanceof Element ? target : null; el; el = el.parentElement) {
    const style = getComputedStyle(el);
    if (isScroller(el, style) && (scrollableIn(el, direction) || movedUnseen(el))) return true;
    // A fixed section covers the viewport, so scrolling the document behind it shows nothing.
    // (Contact sits in the page flow, so the walk continues to the document there.)
    if (el.classList.contains('stage') && style.position === 'fixed') return false;
  }
  return false;
}

// A section can name the list the wheel drives from anywhere on it. Work's timeline scrolls with the
// pointer over the globe too, and the wheel moves on only once the timeline has reached its end.
const WHEEL_TARGETS = { work: '.work-rail-scroll' };

function sectionWheelTarget(target, direction) {
  const stage = document.querySelector('.stage.active-section');
  if (!stage) return null;
  const selector = WHEEL_TARGETS[stage.dataset.section];
  const list = selector ? stage.querySelector(selector) : null;
  if (list && list.getClientRects().length && scrollableIn(list, direction)) return list;
  // The overlay nav and the sigil sit outside the section, so a wheel over them scrolls the section.
  if (!stage.contains(target) && isScroller(stage, getComputedStyle(stage)) && scrollableIn(stage, direction)) return stage;
  return null;
}

function wheelStepBlocked() {
  const blog = document.getElementById('blog');
  return document.body.classList.contains('has-paper-open-global')
    || Boolean(document.querySelector([
      'dialog[open]',
      '.work-location-info.visible',
      '.project-panel.visible',
      '#graphics-help-panel:not([hidden])',
      '#graphics-profile-menu:not([hidden])'
    ].join(',')))
    || Boolean(blog?.classList.contains('active-section') && blog.classList.contains('in-category'));
}

const median = (list) => [...list].sort((a, b) => a - b)[list.length >> 1];

// A new trackpad swipe during the last one's inertia. Inertia only slows, so the stream must first
// have fallen to half its top speed since the step (the median of three readings, so a lone spike
// is no top, and a swipe that steps while it still speeds up has not fallen from anything). A new
// swipe then shows as three readings in a row faster than three times the inertia and 4 px a
// frame, which inertia never gets back to. A touch that stops the inertia first reads at half its
// speed or less (a long gap reads low too), and within 400 ms of it (a busy page sees the ramp in
// few, sparse events) a gentler swipe will do: faster than one and a half times the inertia and
// three times the low point. A swipe still speeding up, a steady or noisy drag and a merged event
// (whose speed is spread over its frames) never qualify. Only matters once the gesture has stepped.
function startsNewSwipe(gesture, speed, at) {
  if (!gesture.stepped || gesture.speeds.length < 3) return false;
  const level = median(gesture.speeds);
  const fallen = level <= gesture.top / 2;
  const low = gesture.low && at - gesture.low.at <= 400 ? gesture.low : null;
  if (fallen && speed <= level / 2) {
    const floor = Math.max(4, level * 1.5, speed * 3);
    gesture.low = { floor: low ? Math.min(low.floor, floor) : floor, at };
    gesture.rise = null;
    return false;
  }
  gesture.low = low;
  // A rise starts at the first reading above the inertia and is judged against the inertia as it
  // was then, before the rise's own readings lift the level.
  const rise = gesture.rise ?? (fallen && speed > level ? { base: level, count: 0 } : null);
  gesture.rise = rise && speed > rise.base ? rise : null;
  if (!gesture.rise) return false;
  rise.count = speed > (low ? low.floor : Math.max(4, rise.base * 3)) ? rise.count + 1 : 0;
  return rise.count >= 3;
}

// Input held up on its way to the page arrives after its gesture's end. It still tells: its time
// falls inside the pause, or (for a gesture that has stepped) it merges the travel of the whole
// hold into one event, at least twice what an event of the gesture carried and at a fifth of its
// last speed or more across the gap (inertia decays over a long hold). A new notch carries one
// event's travel, and a new swipe after a real pause reads slow across it, so each starts a gesture
// of its own, or, rejoining a stepped gesture, reads as the touch of a new swipe and splits off.
function heldBack(gesture, size, at) {
  const gap = at - gesture.lastAt;
  if (gap <= WHEEL_GESTURE_GAP_MS) return true;
  const last = gesture.speeds.at(-1);
  const speed = (gesture.travel + size) * WHEEL_FRAME_MS / (at - gesture.readAt);
  return gesture.stepped && gap <= WHEEL_HELD_MS && size >= 2 * median(gesture.sizes)
    && (last === undefined || speed >= last / 5);
}

export function initWheelSteps(showSectionCallback) {
  const root = document.documentElement;
  let gesture = null;
  let lastStepAt = -Infinity;
  let pending = null;

  const deltaOf = (event) => {
    // Read the mode first: Firefox switches line-mode notches to pixels once a page reads a delta.
    const mode = event.deltaMode;
    // Pinch zoom arrives as ctrl+wheel, and sideways swipes are not a request to move on.
    if (event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return 0;
    // At 40 px a line, a 3-line Firefox notch weighs what a 100 to 120 px Chrome notch does.
    return event.deltaY * (mode === 1 ? 40 : mode === 2 ? window.innerHeight : 1);
  };

  const step = (direction, at) => {
    const index = WHEEL_ORDER.indexOf(activeSection());
    const next = index < 0 ? null : WHEEL_ORDER[index + direction];
    if (!next) return;
    gesture.stepped = true;
    gesture.top = 0;
    lastStepAt = at;
    // The rest of this gesture reaches the incoming section. Its handlers (the dish zoom) skip it.
    root.dataset.wheelStepTail = '';
    showSectionCallback(next, { historyMode: 'push' });
  };

  const activeSection = () => document.querySelector('.stage.active-section')?.dataset.section;

  // A slow notch, or one at high browser zoom, can weigh less than the step distance. A short
  // gesture of one or two notches that nothing handled still asks to move on. Notches dropped in
  // the cooldown never counted towards distance, so they cannot fire here either, and a gesture
  // overtaken by other navigation (a nav click, Back) is dropped. The step tail is left for the
  // next gesture to clear.
  const settle = (ended) => {
    if (ended !== gesture || ended.section !== activeSection()) return;
    if (ended.stepped || ended.consumed || ended.drive || ended.events > 2 || ended.distance < 3) return;
    const now = performance.now();
    if (wheelStepBlocked() || now - lastStepAt < WHEEL_STEP_COOLDOWN_MS) return;
    step(ended.direction, now);
  };

  // A gesture ends once a pause has passed. An end timer that runs late (a long task) waits two
  // more frames first: browsers hand queued input to the page at the start of a frame, so input
  // held behind the long task still arrives first, however slow the frames (a page whose every
  // frame is a long task still ends its gestures). Input held anywhere else rejoins through
  // heldBack. A hidden page has no frames and no wheel input, so there it ends at once.
  const end = (current) => {
    current.ended = true;
    settle(current);
  };
  const armEnd = (current) => {
    window.clearTimeout(current.endTimer);
    window.cancelAnimationFrame(current.endFrame);
    const due = performance.now() + WHEEL_GESTURE_GAP_MS;
    current.endTimer = window.setTimeout(() => {
      if (document.hidden || performance.now() - due <= WHEEL_STALL_MS) {
        end(current);
        return;
      }
      current.endFrame = window.requestAnimationFrame(() => {
        current.endFrame = window.requestAnimationFrame(() => end(current));
      });
    }, WHEEL_GESTURE_GAP_MS);
  };

  // Scrolls a driven box. Small trackpad deltas and reduced motion apply at once, whatever the
  // box's own CSS scroll-behavior (every .stage is smooth).
  const driveTo = (el, top, smooth) => {
    if (smooth) {
      el.scrollTo({ top, behavior: 'smooth' });
      return;
    }
    const inline = el.style.scrollBehavior;
    el.style.scrollBehavior = 'auto';
    el.scrollTop = top;
    el.style.scrollBehavior = inline;
  };

  // Capture phase: track the gesture before the target's own handlers see the event.
  window.addEventListener('wheel', (event) => {
    pending = null;
    const delta = deltaOf(event);
    if (!delta) return;
    const size = Math.abs(delta);
    const direction = Math.sign(delta);
    // When the input happened, not when a busy page got to it. Same clock as performance.now().
    const now = event.timeStamp || performance.now();
    const live = Boolean(gesture) && direction === gesture.direction
      && (!gesture.ended || heldBack(gesture, size, now));
    const span = live ? now - gesture.readAt : 0;
    const speed = span >= WHEEL_READ_MS ? (gesture.travel + size) * WHEEL_FRAME_MS / span : null;
    if (!live || (speed !== null && startsNewSwipe(gesture, speed, now))) {
      if (gesture) {
        window.clearTimeout(gesture.endTimer);
        window.cancelAnimationFrame(gesture.endFrame);
      }
      delete root.dataset.wheelStepTail;
      const consumed = canScrollFrom(event.target, direction);
      const drive = consumed || wheelStepBlocked() ? null : sectionWheelTarget(event.target, direction);
      gesture = {
        direction, distance: 0, events: 0, sizes: [], speeds: [], top: 0, low: null, rise: null,
        travel: 0, readAt: now, stepped: false, consumed, drive, section: activeSection()
      };
    }
    gesture.ended = false;
    gesture.lastAt = now;
    gesture.events += 1;
    gesture.sizes.push(size);
    if (gesture.sizes.length > 3) gesture.sizes.shift();
    // A gesture's first event only starts the clock, unless it split off at a reading.
    if (speed === null) {
      if (gesture.events > 1) gesture.travel += size;
    } else {
      gesture.travel = 0;
      gesture.readAt = now;
      gesture.speeds.push(speed);
      if (gesture.speeds.length > 3) gesture.speeds.shift();
      if (gesture.speeds.length === 3) gesture.top = Math.max(gesture.top, median(gesture.speeds));
    }
    armEnd(gesture);
    pending = { event, delta, now };
  }, { capture: true, passive: true });

  // Bubble phase: decide once the target's handlers have had their say.
  window.addEventListener('wheel', (event) => {
    if (!pending || pending.event !== event) return;
    const { delta, now } = pending;
    pending = null;
    if (event.defaultPrevented) gesture.consumed = true;
    if (gesture.drive && !gesture.consumed) {
      // A running target, so fast notches add up while a smooth scroll is still in flight.
      const el = gesture.drive;
      const start = gesture.driveTop ?? el.scrollTop;
      gesture.driveTop = Math.max(0, Math.min(el.scrollHeight - el.clientHeight, start + delta));
      driveTo(el, gesture.driveTop, !prefersReducedMotion && Math.abs(delta) >= 40);
      return;
    }
    if (gesture.consumed || gesture.stepped || wheelStepBlocked()) return;
    // A notch inside the cooldown is dropped, not saved up to fire later.
    if (now - lastStepAt < WHEEL_STEP_COOLDOWN_MS) return;
    gesture.distance += Math.abs(delta);
    if (gesture.distance >= WHEEL_STEP_PX) step(gesture.direction, now);
  }, { passive: true });
}

export function showSection(sectionName, options = {}) {
  const sections = document.querySelectorAll('.stage');
  sections.forEach(s => {
    const shouldBeActive = s.dataset.section === sectionName;
    const wasActive = s.classList.contains('active-section');
    if (shouldBeActive && s.classList.contains('stage-leaving')) {
      // Returning before the fade ended: keep what is still drawn, never fire 'stage:left'.
      window.clearTimeout(s.__leaveTimer);
      s.__leaveTimer = 0;
      s.classList.remove('stage-leaving');
    }
    s.classList.toggle('active-section', shouldBeActive);
    s.inert = !shouldBeActive;
    if (wasActive && !shouldBeActive) leaveStage(s, options.instant);
  });
  
  document.querySelectorAll('.network-node-label, .network-sigil-node').forEach(label =>
    {
      const isActive = label.dataset.section === sectionName;
      label.classList.toggle('active', isActive);
      if (isActive) {
        label.setAttribute('aria-current', 'page');
      } else {
        label.removeAttribute('aria-current');
      }
    }
  );
  
  const hashId = sectionName === 'intro' ? '' : sectionName;
  const newUrl = hashId ? `${window.location.pathname}#${hashId}` : window.location.pathname;
  if (options.historyMode !== 'none') {
    const currentUrl = `${window.location.pathname}${window.location.hash}`;
    if (currentUrl !== newUrl) {
      const state = { view: sectionName };
      if (options.historyMode === 'push') {
        history.pushState(state, '', newUrl);
      } else {
        history.replaceState(state, '', newUrl);
      }
    }
  }
  
  const activeSection = document.querySelector(`.stage[data-section="${sectionName}"]`);
  // The wheel's "did this box just scroll" check needs a starting point for the section shown.
  if (activeSection) seenScrollTop.set(activeSection, activeSection.scrollTop);
  const isPanel = activeSection?.classList.contains('panel-screen') ||
                  activeSection?.classList.contains('altar-screen');
  document.documentElement.style.overflow = isPanel ? 'hidden' : '';
  document.body.style.overflow = isPanel ? 'hidden' : '';
  
  const shouldSuppressNav = isPanel;
  document.body.classList.toggle('nav-suppressed', shouldSuppressNav);

  if (activeSection && activeSection.getAttribute('tabindex') === '-1') {
    activeSection.focus({ preventScroll: true });
  }
  
  updateSectionNavActive(sectionName);
}

export function updateSectionNavActive(sectionName) {
  document.querySelectorAll('.section-nav-link').forEach(link => {
    const isActive = link.dataset.section === sectionName;
    link.classList.toggle('active', isActive);
    if (isActive) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });
}

function createNavLabel(id) {
  const label = document.createElement('a');
  label.dataset.node = id;
  label.dataset.section = id;
  label.className = 'network-node-label';
  const anchorId = id === 'intro' ? 'main' : id;
  label.href = `#${anchorId}`;
  
  const displayText = id;
  
  label.innerHTML = `<span class="node-label">${displayText}</span>`;
  label.setAttribute('aria-label', `Navigate to ${displayText}`);
  return label;
}

function createSigilNode() {
  const sigil = document.createElement('button');
  sigil.dataset.node = 'intro';
  sigil.dataset.section = 'intro';
  sigil.className = 'network-sigil-node';
  sigil.setAttribute('aria-label', 'Toggle ritual');
  sigil.innerHTML = '<picture><source srcset="./artifacts/sigil/AZ-01.webp" type="image/webp"><img id="sigil" src="./artifacts/sigil/AZ-01.png" alt="" width="64" height="64" decoding="async" loading="lazy"></picture>';
  return sigil;
}

export function layoutNavNodes(wireSigilToggle, renderHUD, showSectionCallback) {
  const nav = document.getElementById('network-nav');
  if (!nav) {
    console.error('layoutNavNodes: #network-nav element not found!');
    return;
  }
  
  if (!COVER.ready) {
    console.warn('layoutNavNodes: COVER not ready, skipping layout');
    return;
  }

  if (nav.children.length === 0) {
    const frag = document.createDocumentFragment();
    for (const id of NAV_ORDER) {
      if (id === 'intro') {
        const sigil = createSigilNode();
        frag.appendChild(sigil);
      } else {
        const label = createNavLabel(id);
        label.addEventListener('click', (event) => {
          const targetStage = document.querySelector(`.stage[data-section="${id}"]`);
          if (targetStage) {
            event.preventDefault();
            showSectionCallback(id, { historyMode: 'push' });
            targetStage.focus?.({ preventScroll: false });
          }
        });
        frag.appendChild(label);
      }
    }
    nav.appendChild(frag);
    wireSigilToggle();
  }

  for (const [id, pt] of Object.entries(NAV_COORDS)) {
    const el = nav.querySelector(`[data-node="${id}"]`);
    if (!el) continue;

    const [ax, ay] = coverMap(pt.x, pt.y);

    let tx = 0, ty = 0;
    if (ritualActive) {
      const off = NAV_OFFSETS[id] || { nx: 0, ny: 0 };
      const [ox, oy] = coverMap(pt.x + off.nx, pt.y + off.ny);
      tx = Math.round(ox - ax);
      ty = Math.round(oy - ay);
    }

    const left = Math.round(ax) + 0.5;
    const top = Math.round(ay) + 0.5;
    el.style.left = `${left}px`;
    el.style.top  = `${top}px`;
    
    el.style.transform = `translate(-50%, -50%)`;
    
    const labelText = el.querySelector('.node-label');
    if (labelText) {
      const nudge = RITUAL_LABEL_NUDGE_PX[id] || { x: 0, y: 0 };
      labelText.style.transform = `translateX(-50%) translate(${tx + nudge.x}px, ${ty + nudge.y}px)`;
    }

    if (ritualActive && id === 'blog') {
      const target = el.getBoundingClientRect();
      const face = document.querySelector('.portrait-wrap')?.getBoundingClientRect();
      if (face && !(target.right < face.left || target.left > face.right || target.bottom < face.top || target.top > face.bottom)) {
        let step = 0, tx2 = tx, ty2 = ty;
        const off = NAV_OFFSETS[id] || { nx: 0, ny: 0 };
        const [nox1, noy1] = coverMap(pt.x + off.nx + 4, pt.y + off.ny + 4);
        const [nox0, noy0] = coverMap(pt.x + off.nx, pt.y + off.ny);
        const ndx = Math.sign((nox1 - nox0) || 0), ndy = Math.sign((noy1 - noy0) || 0);
        while (step++ < 8) {
          tx2 += 4*ndx; ty2 += 4*ndy;
          el.style.transform = `translate(-50%, -50%) translate(${tx2}px, ${ty2}px)`;
          const r = el.getBoundingClientRect();
          if (r.right < face.left || r.left > face.right || r.bottom < face.top || r.top > face.bottom) break;
        }
      }
    }
  }

  if (hudEnabled && renderHUD) renderHUD();
}

export function handleNavEnter(id, el, startSpark, startSparkToPoint, pointAtRoute) {
  if (currentNavHover === id) return;
  setCurrentNavHover(id);

  if (prefersReducedMotion) {
    document.querySelectorAll('.network-node-label, .network-sigil-node').forEach(node => node.classList.remove('motion-highlight'));
    el.classList.add('motion-highlight');
    if (id !== 'intro') {
      const introEl = document.querySelector('.network-sigil-node[data-node="intro"], .network-node-label[data-node="intro"]');
      introEl?.classList.add('motion-highlight');
    }
    return;
  }

  if (id === 'intro') {
    let delay = 0;
    for (const dest of NAV_ORDER) {
      if (dest === 'intro') continue;
      
      setTimeout(() => {
        if (ritualActive) {
          const route = LOCKED_ROUTES[dest];
          if (route && route.len >= 60) {
            const [vpX, vpY] = pointAtRoute(route, route.s);
            
            const imgX = (vpX - COVER.dx) / COVER.s;
            const imgY = (vpY - COVER.dy) / COVER.s;
            
            startSparkToPoint('intro', imgX, imgY, 700);
          } else {
            startSpark('intro', dest, 700);
          }
        } else {
          startSpark('intro', dest, 700);
        }
      }, delay);
      
      delay += 50 + Math.random() * 50;
    }
  } else {
    if (ritualActive) {
      const route = LOCKED_ROUTES[id];
      if (route && route.len >= 60) {
        const [vpX, vpY] = pointAtRoute(route, route.s);
        
        const imgX = (vpX - COVER.dx) / COVER.s;
        const imgY = (vpY - COVER.dy) / COVER.s;
        
        startSparkToPoint(id, NAV_COORDS.intro.x, NAV_COORDS.intro.y, 700);
      } else {
        startSpark(id, 'intro', 700);
      }
    } else {
      startSpark(id, 'intro', 700);
    }
  }
}

export function handleNavLeave(id, el) {
  if (currentNavHover !== id) return;
  setCurrentNavHover(null);

  if (prefersReducedMotion) {
    el.classList.remove('motion-highlight');
    if (id !== 'intro') {
      const introEl = document.querySelector('.network-sigil-node[data-node="intro"], .network-node-label[data-node="intro"]');
      introEl?.classList.remove('motion-highlight');
    }
  } else {
    setActiveAnims([]);
  }
}

// Updates label positions during ritual mode
export function updateMovingLabels(dt, pointAtRoute) {
  if (prefersReducedMotion) return;
  
  if (!ritualActive) return;
  
  const nav = document.getElementById('network-nav');
  if (!nav) return;
  
  for (const id of Object.keys(LOCKED_ROUTES)) {
    const route = LOCKED_ROUTES[id];
    if (!route || route.len < 60) continue;
    
    const anchor = NAV_COORDS[id];
    if (!anchor) continue;
    const [anchorX, anchorY] = coverMap(anchor.x, anchor.y);
    
    route.speed = NAV_SPEED_WHEN_ACTIVE;
    route.s += route.dir * route.speed * dt;

    if (route.s >= route.sMax){ route.s = route.sMax; route.dir = -1; }
    if (route.s <= route.sMin){ route.s = route.sMin; route.dir =  1; }
    
    const [px, py] = pointAtRoute(route, route.s);
    
    const el = nav.querySelector(`[data-node="${id}"]`);
    if (!el) continue;
    
    const dx = Math.round(px - anchorX);
    const dy = Math.round(py - anchorY);
    el.style.left = `${anchorX}px`;
    el.style.top = `${anchorY}px`;
    
    el.style.transform = `translate(-50%, -50%)`;
    
    const labelText = el.querySelector('.node-label');
    if (labelText) {
      const nudge = RITUAL_LABEL_NUDGE_PX[id] || { x: 0, y: 0 };
      labelText.style.transform = `translateX(-50%) translate(${dx + nudge.x}px, ${dy + nudge.y}px)`;
    }
  }
}
