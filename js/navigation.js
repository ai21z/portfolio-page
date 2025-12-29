// Navigation and label management

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

export function showSection(sectionName, startRitualBackground, stopRitualBackground) {
  const sections = document.querySelectorAll('.stage');
  sections.forEach(s => {
    const shouldBeActive = s.dataset.section === sectionName;
    s.classList.toggle('active-section', shouldBeActive);
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
  history.replaceState(null, '', newUrl);
  
  const activeSection = document.querySelector(`.stage[data-section="${sectionName}"]`);
  const isPanel = activeSection?.classList.contains('panel-screen') || 
                  activeSection?.classList.contains('altar-screen');
  document.documentElement.style.overflow = isPanel ? 'hidden' : '';
  document.body.style.overflow = isPanel ? 'hidden' : '';
  
  const shouldSuppressNav = isPanel;
  document.body.classList.toggle('nav-suppressed', shouldSuppressNav);
  if (isPanel) {
    startRitualBackground();
  } else {
    stopRitualBackground();
  }
  
  if (activeSection && activeSection.getAttribute('tabindex') === '-1') {
    setTimeout(() => {
      activeSection.focus({ preventScroll: true });
    }, 100);
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

function createSigilNode() {
  const sigil = document.createElement('button');
  sigil.dataset.node = 'intro';
  sigil.dataset.section = 'intro';
  sigil.className = 'network-sigil-node';
  sigil.setAttribute('role', 'button');
  sigil.setAttribute('aria-label', 'Toggle ritual');
  sigil.innerHTML = '<img id="sigil" src="./artifacts/sigil/AZ-VZ-01.png" alt="" width="64" height="64">';
  return sigil;
}

export function layoutNavNodes(wireSigilToggle, renderHUD, showSectionCallback) {
  const nav = document.getElementById('network-nav');
  if (!nav) {
    console.error('❌ layoutNavNodes: #network-nav element not found!');
    return;
  }
  
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
      labelText.style.transform = `translateX(-50%) translate(${tx}px, ${ty}px)`;
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
      labelText.style.transform = `translateX(-50%) translate(${dx}px, ${dy}px)`;
    }
  }
}
