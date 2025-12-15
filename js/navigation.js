// ━━━ Navigation & Label Management Module ━━━
// Handles nav label creation, positioning, interaction, and animation

import { NAV_COORDS, NAV_ORDER, LABEL_OFFSET_PX, NAV_SPEED_WHEN_ACTIVE } from './config.js';
import {
  prefersReducedMotion,
  COVER,
  MYC_MAP,
  NAV_OFFSETS,
  currentNavHover,
  setCurrentNavHover,
  ritualActive,
  LOCKED_ROUTES,
  ACTIVE_ANIMS,
  setActiveAnims,
  hudEnabled
} from './state.js';
import { coverMap } from './viewport.js';

/**
 * Computes branch-normal offsets for each navigation label.
 * Offsets push labels away from mycelium paths to avoid overlaps.
 */
export function computeNavOffsets(){
  if (!MYC_MAP || !MYC_MAP.paths) return;
  const cx = COVER.baseW/2, cy = COVER.baseH/2;

  for (const [id, {x:px, y:py}] of Object.entries(NAV_COORDS)){
    // Skip intro (sigil) - it should never have an offset
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
          nx = -aby/len; ny = abx/len; // left normal
          // make normal point away from canvas center
          const vx = px - cx, vy = py - cy;
          if (nx*vx + ny*vy < 0){ nx = -nx; ny = -ny; }
        }
      }
    }

    const mag = LABEL_OFFSET_PX[id] ?? 22;
    NAV_OFFSETS[id] = { nx: nx*mag, ny: ny*mag };
  }
}

/**
 * Shows a section and updates UI state.
 * @param {string} sectionName - The section to show
 * @param {Function} startRitualBackground - Function to start ritual background
 * @param {Function} stopRitualBackground - Function to stop ritual background
 */
export function showSection(sectionName, startRitualBackground, stopRitualBackground) {
  // Update active section
  const sections = document.querySelectorAll('.stage');
  sections.forEach(s => {
    const shouldBeActive = s.dataset.section === sectionName;
    s.classList.toggle('active-section', shouldBeActive);
  });
  
  // Update nav aria-current
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
  
  // Update hash (replaceState to avoid scroll jump)
  const hashId = sectionName === 'intro' ? '' : sectionName;
  const newUrl = hashId ? `${window.location.pathname}#${hashId}` : window.location.pathname;
  history.replaceState(null, '', newUrl);
  
  // Lock body scroll for panel screens (altar-screen or panel-screen)
  // Note: resume-screen detection removed (resume section disabled)
  const activeSection = document.querySelector(`.stage[data-section="${sectionName}"]`);
  const isPanel = activeSection?.classList.contains('panel-screen') || 
                  activeSection?.classList.contains('altar-screen');
  document.documentElement.style.overflow = isPanel ? 'hidden' : '';
  document.body.style.overflow = isPanel ? 'hidden' : '';
  
  // Toggle nav suppression for panel screens only (Now section should show nav like About/Skills/Work)
  const shouldSuppressNav = isPanel;
  document.body.classList.toggle('nav-suppressed', shouldSuppressNav);
  if (isPanel) {
    startRitualBackground();
  } else {
    stopRitualBackground();
  }
  
  // Focus the active section for accessibility
  if (activeSection && activeSection.getAttribute('tabindex') === '-1') {
    setTimeout(() => {
      activeSection.focus({ preventScroll: true });
    }, 100);
  }
  
  // Update section nav active state
  updateSectionNavActive(sectionName);
}

/**
 * Updates the section navigation active state.
 * @param {string} sectionName - The active section name
 */
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

/**
 * Creates a navigation label element.
 * @param {string} id - The node/section ID
 * @returns {HTMLElement} - The label element
 */
export function createNavLabel(id) {
  const label = document.createElement('a');
  label.dataset.node = id;
  label.dataset.section = id;
  label.className = 'network-node-label';
  const anchorId = id === 'intro' ? 'main' : id;
  label.href = `#${anchorId}`;
  
  // Display name mapping
  const displayNames = {
    'now': 'now',
    'about': 'about',
    'work': 'work',
    'blog': 'blog',
    'contact': 'contact',
    'skills': 'skills'
  };
  const displayText = displayNames[id] || id;
  
  label.innerHTML = `<span class="node-label">${displayText}</span>`;
  label.setAttribute('aria-label', `Navigate to ${displayText}`);
  return label;
}

/**
 * Creates the sigil node (intro button).
 * @returns {HTMLElement} - The sigil element
 */
export function createSigilNode() {
  const sigil = document.createElement('button');
  sigil.dataset.node = 'intro';
  sigil.dataset.section = 'intro';
  sigil.className = 'network-sigil-node';
  sigil.setAttribute('role', 'button');
  sigil.setAttribute('aria-label', 'Toggle ritual');
  // Image starts at 0° (no initial rotation - will rotate to 180° when clicked)
  sigil.innerHTML = '<img id="sigil" src="./artifacts/sigil/AZ-VZ-01.png" alt="" width="64" height="64">';
  return sigil;
}

/**
 * Positions all navigation labels on the page.
 * @param {Function} wireSigilToggle - Function to wire up sigil interaction
 * @param {Function} renderHUD - Function to render HUD overlay
 * @param {Function} showSectionCallback - Callback when section is clicked
 */
export function layoutNavNodes(wireSigilToggle, renderHUD, showSectionCallback) {
  const nav = document.getElementById('network-nav');
  if (!nav) {
    console.error('❌ layoutNavNodes: #network-nav element not found!');
    return;
  }
  
  // Don't layout if cover isn't ready yet
  if (!COVER.ready) {
    console.warn('⚠️ layoutNavNodes: COVER not ready, skipping layout');
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
            showSectionCallback(id);
            targetStage.focus?.({ preventScroll: false });
          }
        });
        frag.appendChild(label);
      }
    }
    nav.appendChild(frag);
    wireSigilToggle(); // Wire up the ritual toggle
  }

  // Static mode = ZERO offsets, proper logging
  for (const [id, pt] of Object.entries(NAV_COORDS)) {
    const el = nav.querySelector(`[data-node="${id}"]`);
    if (!el) continue;

    const [ax, ay] = coverMap(pt.x, pt.y);

    // Only apply branch-normal offset when ritualActive === true
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
    
    // Keep the DOT (container center) pinned to the node
    el.style.transform = `translate(-50%, -50%)`;
    
    // Move only the TEXT to avoid the mycelium
    const labelText = el.querySelector('.node-label');
    if (labelText) {
      labelText.style.transform = `translateX(-50%) translate(${tx}px, ${ty}px)`;
    }

    // NO collision nudging in static mode
    if (ritualActive && id === 'blog') {
      const target = el.getBoundingClientRect();
      const face = document.querySelector('.portrait-wrap')?.getBoundingClientRect();
      if (face && !(target.right < face.left || target.left > face.right || target.bottom < face.top || target.top > face.bottom)) {
        // nudge along normal in viewport space
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

/**
 * Handles mouse enter on navigation labels.
 * @param {string} id - The node ID
 * @param {HTMLElement} el - The DOM element
 * @param {Function} startSpark - Function to start spark animation
 * @param {Function} startSparkToPoint - Function to start spark to point
 * @param {Function} pointAtRoute - Function to get position on route
 */
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
        // If ritual is active, spark to current position on route
        if (ritualActive) {
          const route = LOCKED_ROUTES[dest];
          if (route && route.len >= 60) {
            // Get current VIEWPORT position on route (not image space)
            const [vpX, vpY] = pointAtRoute(route, route.s);
            
            // Convert back to image space for startSparkToPoint
            // Inverse of coverMap: (vp - dx) / s = img
            const imgX = (vpX - COVER.dx) / COVER.s;
            const imgY = (vpY - COVER.dy) / COVER.s;
            
            startSparkToPoint('intro', imgX, imgY, 700);
          } else {
            // Fallback to anchor if route is too short or missing
            startSpark('intro', dest, 700);
          }
        } else {
          // Static mode: spark to anchor
          startSpark('intro', dest, 700);
        }
      }, delay);
      
      delay += 50 + Math.random() * 50;
    }
  } else {
    // When hovering a label, spark back to intro
    // If ritual is active, use current position
    if (ritualActive) {
      const route = LOCKED_ROUTES[id];
      if (route && route.len >= 60) {
        const [vpX, vpY] = pointAtRoute(route, route.s);
        
        // Convert viewport back to image space
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

/**
 * Handles mouse leave on navigation labels.
 * @param {string} id - The node ID
 * @param {HTMLElement} el - The DOM element
 */
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

/**
 * Updates moving label positions during ritual mode.
 * @param {number} dt - Delta time in seconds
 * @param {Function} pointAtRoute - Function to get position on locked route
 */
export function updateMovingLabels(dt, pointAtRoute) {
  if (prefersReducedMotion) return; // PRM: freeze motion globally
  
  // CRITICAL FIX: Only run this when ritual is ACTIVE
  // Static labels are positioned by layoutNavNodes() ONLY
  if (!ritualActive) return;
  
  const nav = document.getElementById('network-nav');
  if (!nav) return;
  
  // Iterate over what's actually locked (not a static list)
  for (const id of Object.keys(LOCKED_ROUTES)) {
    const route = LOCKED_ROUTES[id];
    if (!route || route.len < 60) continue; // too short → stay static (no jitter)
    
    // Get anchor position in viewport using coverMap
    const anchor = NAV_COORDS[id];
    if (!anchor) continue;
    const [anchorX, anchorY] = coverMap(anchor.x, anchor.y);
    
    // Ritual active: oscillate along the route
    route.speed = NAV_SPEED_WHEN_ACTIVE;
    route.s += route.dir * route.speed * dt;

    if (route.s >= route.sMax){ route.s = route.sMax; route.dir = -1; }
    if (route.s <= route.sMin){ route.s = route.sMin; route.dir =  1; }
    
    // Recompute position using SAME locked route (uses coverMap internally)
    const [px, py] = pointAtRoute(route, route.s);
    
    // Position element with delta from anchor
    const el = nav.querySelector(`[data-node="${id}"]`);
    if (!el) continue;
    
    const dx = Math.round(px - anchorX);
    const dy = Math.round(py - anchorY);
    el.style.left = `${anchorX}px`;
    el.style.top = `${anchorY}px`;
    
    // Keep the DOT pinned to the anchor
    el.style.transform = `translate(-50%, -50%)`;
    
    // Move only the TEXT along the route
    const labelText = el.querySelector('.node-label');
    if (labelText) {
      labelText.style.transform = `translateX(-50%) translate(${dx}px, ${dy}px)`;
    }
  }
}
