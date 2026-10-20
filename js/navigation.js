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

// The wheel scrolls whatever can scroll under the pointer, or the section's own list (Work's
// timeline) from anywhere on it. A wheel gesture that starts with nothing to scroll in its
// direction, and that nothing else consumed (the Blog dish zooms), steps to the previous or next
// section instead. One gesture, trackpad inertia included, moves one section.
const WHEEL_ORDER = ['intro', 'about', 'skills', 'blog', 'work', 'contact'];
const WHEEL_STEP_PX = 60;
// A pause this long ends a gesture. Trackpad inertia keeps firing well inside it.
const WHEEL_GESTURE_GAP_MS = 220;
// Covers the cross-fade, so a step never lands on a section still fading in.
const WHEEL_STEP_COOLDOWN_MS = 700;

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

function canScrollFrom(target, direction) {
  for (let el = target instanceof Element ? target : null; el; el = el.parentElement) {
    const style = getComputedStyle(el);
    const scroller = el === document.scrollingElement ? viewportScrolls() : style.overflowY === 'auto' || style.overflowY === 'scroll';
    if (scroller && scrollableIn(el, direction)) return true;
    // A fixed section covers the viewport, so scrolling the document behind it shows nothing.
    // (Contact sits in the page flow, so the walk continues to the document there.)
    if (el.classList.contains('stage') && style.position === 'fixed') return false;
  }
  return false;
}

// A section can name the list the wheel drives from anywhere on it. Work's timeline scrolls with the
// pointer over the globe too, and the wheel moves on only once the timeline has reached its end.
const WHEEL_TARGETS = { work: '.work-rail-scroll' };

function sectionWheelTarget(direction) {
  const stage = document.querySelector('.stage.active-section');
  const selector = WHEEL_TARGETS[stage?.dataset.section];
  const el = selector ? stage.querySelector(selector) : null;
  return el && el.getClientRects().length && scrollableIn(el, direction) ? el : null;
}

function wheelStepBlocked() {
  const blog = document.getElementById('blog');
  return document.body.classList.contains('has-paper-open-global')
    || Boolean(document.querySelector('dialog[open]'))
    || Boolean(blog?.classList.contains('active-section') && blog.classList.contains('in-category'));
}

export function initWheelSteps(showSectionCallback) {
  let gesture = null;
  let lastStepAt = -Infinity;
  window.addEventListener('wheel', (event) => {
    // Pinch zoom arrives as ctrl+wheel, and sideways swipes are not a request to move on.
    if (event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
    const delta = event.deltaY * unit;
    if (!delta) return;
    // When the input happened, not when a busy page got to it, so a stalled frame cannot split
    // one gesture in two. Same clock as performance.now().
    const now = event.timeStamp || performance.now();
    if (!gesture || now - gesture.lastAt > WHEEL_GESTURE_GAP_MS) {
      const direction = Math.sign(delta);
      const consumed = canScrollFrom(event.target, direction);
      gesture = { direction, distance: 0, stepped: false, consumed, drive: consumed ? null : sectionWheelTarget(direction) };
    }
    gesture.lastAt = now;
    // Listeners on the target run first, so a handled wheel (the dish zoom) is already marked.
    if (event.defaultPrevented) gesture.consumed = true;
    if (gesture.drive && !gesture.consumed) {
      // A running target, so fast notches add up while a smooth scroll is still in flight.
      const el = gesture.drive;
      const start = gesture.driveTop ?? el.scrollTop;
      gesture.driveTop = Math.max(0, Math.min(el.scrollHeight - el.clientHeight, start + delta));
      el.scrollTo({ top: gesture.driveTop, behavior: prefersReducedMotion || Math.abs(delta) < 40 ? 'auto' : 'smooth' });
      return;
    }
    if (gesture.consumed || gesture.stepped || wheelStepBlocked()) return;
    gesture.distance += Math.abs(delta);
    if (gesture.distance < WHEEL_STEP_PX || now - lastStepAt < WHEEL_STEP_COOLDOWN_MS) return;
    const current = document.querySelector('.stage.active-section')?.dataset.section;
    const index = WHEEL_ORDER.indexOf(current);
    const next = index < 0 ? null : WHEEL_ORDER[index + gesture.direction];
    if (!next) return;
    gesture.stepped = true;
    lastStepAt = now;
    showSectionCallback(next, { historyMode: 'push' });
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
