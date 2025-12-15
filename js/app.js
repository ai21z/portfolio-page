/* ━━━ Necrography — Vissarion Zounarakis ━━━
 * Smart Navigation Node Placement System
 * - Static fungal mycelium background image
 * - Non-overlapping anchor-based node placement
 * - Automatic collision avoidance with content
 * - Branch-reveal highlight effect on hover
 * - Full accessibility support
 */

// ━━━ Module Imports ━━━
import { sizeCanvas, cumulativeLengths, pointAt, approach, throttle } from './utils.js';
import { buildGraphFromPaths, aStarPath } from './graph.js';
import { initNow, destroyNow } from './now-cultivating.js';
import { initWorkGlobe, cleanupWorkGlobe } from './work-globe-webgl.js';
import socialIconsAnimation from './social-icons-animation.js';
import { initHubToIcons } from './hub-to-icons.js';
import {
  RITUAL_RETURN_MS,
  NAV_SPEED_WHEN_ACTIVE,
  NAV_COORDS,
  NAV_ORDER,
  LABEL_OFFSET_PX,
  LABEL_SPEEDS,
  DEFAULT_SPEED,
  MAX_SPARKS,
  MIN_ROUTE_LEN_PX,
  MAX_ROUTE_LEN_PX,
  RESAMPLE_STEP_PX,
  RESAMPLE_MIN_POINTS
} from './config.js';
import {
  prefersReducedMotion,
  hudEnabled,
  hudCanvas,
  hudCtx,
  setHudEnabled,
  setHudCanvas,
  setHudCtx,
  bgImg,
  COVER,
  MYC_MAP,
  setMycMap,
  GRAPH,
  PATH_CACHE,
  setGraph,
  ritualActive,
  followerSparks,
  setRitualActive,
  setFollowerSparks,
  LOCKED_ROUTES,
  setLockedRoutes,
  NODE_IDS,
  NAV_OFFSETS,
  currentNavHover,
  setCurrentNavHover,
  sparkCanvas,
  sparkCtx,
  sporeCanvas,
  sporeCtx,
  setSparkCanvas,
  setSparkCtx,
  setSporeCanvas,
  setSporeCtx,
  ACTIVE_ANIMS,
  cascadeAnims,
  cascadeActive,
  spores,
  lastSporeFrame,
  lastSparkTs,
  setActiveAnims,
  setCascadeAnims,
  setCascadeActive,
  setSpores,
  setLastSporeFrame,
  setLastSparkTs
} from './state.js';
import {
  computeCoverFromImage,
  coverMap,
  toViewport,
  projectXY
} from './viewport.js';
import {
  startSpark,
  ritualCascade,
  drawSparks,
  startSparkToPoint
} from './sparks.js';
import {
  computeNavOffsets,
  showSection,
  createNavLabel,
  createSigilNode,
  layoutNavNodes,
  handleNavEnter,
  handleNavLeave,
  updateMovingLabels
} from './navigation.js';
import {
  buildLockedRoutes,
  pointAtRoute,
  imgPointAtRoute
} from './routes.js';
import { notebookContact } from './contact.js';

// ━━━ A11y: Insert current year in footer ━━━
const yearElement = document.getElementById('yr');
if (yearElement) yearElement.textContent = new Date().getFullYear();

// ━━━ Mycelium Geometry System (Exported from Python) ━━━
/**
 * Load exported geometry JSON and preload background image.
 */
async function loadMycelium() {
  const response = await fetch('artifacts/network.json');
  setMycMap(await response.json());
  console.log(`✅ Loaded ${MYC_MAP.paths.length} paths, ${MYC_MAP.junctions.length} junctions`);
}

/* ━━━ Image-Space Graph + Pathfinding ━━━ */

// ━━━ HUD Rendering ━━━
function initHUD() {
  if (!hudCanvas) {
    const canvas = document.createElement('canvas');
    canvas.id = 'hud-canvas';
    canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999;';
    document.body.appendChild(canvas);
    setHudCanvas(canvas);
    setHudCtx(canvas.getContext('2d'));
  }
  hudCanvas.width = window.innerWidth;
  hudCanvas.height = window.innerHeight;
}

// [LOCKED-ROUTE] HUD shows white anchor, cyan locked route, green live position
function renderHUD() {
  if (!hudEnabled) return;
  if (!hudCtx) initHUD();

  hudCtx.clearRect(0, 0, hudCanvas.width, hudCanvas.height);

  for (const [id, pt] of Object.entries(NAV_COORDS)) {
    const [tx, ty] = toViewport(pt.x, pt.y);
    
    // White: design anchor
    hudCtx.fillStyle = '#fff';
    hudCtx.beginPath();
    hudCtx.arc(tx, ty, 4, 0, Math.PI * 2);
    hudCtx.fill();
    
    hudCtx.fillStyle = '#fff';
    hudCtx.font = '10px monospace';
    hudCtx.fillText(`${id} anchor`, tx + 8, ty - 8);

    // Cyan: locked route polyline
    const route = LOCKED_ROUTES[id];
    if (route && route.projPts.length > 1) {
      hudCtx.strokeStyle = 'rgba(0,255,255,.4)';
      hudCtx.lineWidth = 1;
      hudCtx.beginPath();
      hudCtx.moveTo(route.projPts[0][0], route.projPts[0][1]);
      for (let i = 1; i < route.projPts.length; i++) {
        hudCtx.lineTo(route.projPts[i][0], route.projPts[i][1]);
      }
      hudCtx.stroke();
      hudCtx.lineWidth = 1;
    }

    // Green: live label position
    const el = document.querySelector(`[data-node="${id}"]`);
    if (el) {
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      
      hudCtx.fillStyle = '#0f0';
      hudCtx.beginPath();
      hudCtx.arc(cx, cy, 3, 0, Math.PI * 2);
      hudCtx.fill();
      
      hudCtx.fillStyle = '#0f0';
      hudCtx.fillText(`live (${Math.round(cx)},${Math.round(cy)})`, cx + 8, cy + 16);

      // Check orthogonal distance to locked route
      if (route && route.projPts.length > 1) {
        let minDist = Infinity;
        for (let i = 1; i < route.projPts.length; i++) {
          const [x0, y0] = route.projPts[i - 1];
          const [x1, y1] = route.projPts[i];
          const dx = x1 - x0;
          const dy = y1 - y0;
          const len = Math.hypot(dx, dy);
          if (len < 1e-6) continue;
          
          const t = Math.max(0, Math.min(1, ((cx - x0) * dx + (cy - y0) * dy) / (len * len)));
          const projX = x0 + t * dx;
          const projY = y0 + t * dy;
          const dist = Math.hypot(cx - projX, cy - projY);
          minDist = Math.min(minDist, dist);
        }
        
        if (minDist > 8) {
          console.warn(`[LOCKED-ROUTE] HUD: ${id} label is ${minDist.toFixed(1)}px off its route (should be <8px)`);
        }
      }
    }
  }
}

function toggleHUD() {
  setHudEnabled(!hudEnabled);
  if (hudEnabled) {
    initHUD();
    renderHUD();
  } else if (hudCanvas) {
    hudCanvas.remove();
    setHudCanvas(null);
    setHudCtx(null);
  }
}

// ━━━ Initialize canvas contexts (sparkCanvas already imported from state) ━━━
if (!sparkCanvas) {
  const canvas = document.createElement('canvas');
  canvas.id = 'spark-canvas';
  canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:5;';
  document.body.appendChild(canvas);
  setSparkCanvas(canvas);
}
  setSparkCtx(sparkCanvas.getContext('2d'));
if (sporeCanvas) {
  setSporeCtx(sporeCanvas.getContext('2d'));
}

// Main spark animation loop - wraps imported draw functions
function sparkLoopWrapper(ts) {
  const dt = Math.min(0.05, (ts - lastSparkTs) / 1000);
  setLastSparkTs(ts);
  updateMovingLabels(dt, pointAtRoute);
  drawSparks(dt, pointAtRoute);
  requestAnimationFrame(sparkLoopWrapper);
}

function resizeAll() {
  if (!COVER.ready) return; // Don't resize until image is loaded
  computeCoverFromImage();
  sizeCanvas(sparkCanvas);
  sizeCanvas(sporeCanvas);
  if (hudEnabled && hudCanvas) {
    hudCanvas.width = window.innerWidth;
    hudCanvas.height = window.innerHeight;
  }
  layoutNavNodes(wireSigilToggle, renderHUD, showSectionWithEffects);

  setActiveAnims(ACTIVE_ANIMS.map((anim) => {
    const projPts = projectXY(anim.imgPts);
    const cum = cumulativeLengths(projPts);
    const len = cum[cum.length - 1];
    if (!len) return null;
    const ratio = anim.len ? anim.s / anim.len : (anim.dir > 0 ? 0 : 1);
    const s = Math.max(0, Math.min(len, ratio * len));
    return { ...anim, projPts, cum, len, s };
  }).filter(Boolean));

  // [LOCKED-ROUTE] Reproject locked routes (keep imgPts unchanged, only update projPts/cum/len)
  for (const [id, route] of Object.entries(LOCKED_ROUTES)) {
    const projPts = projectXY(route.imgPts);
    const cum = cumulativeLengths(projPts);
    const len = cum[cum.length - 1];
    
    // Preserve s ratio and update boundaries
    const sRatio = route.len > 0 ? route.s / route.len : 0.5;
    const sHomeRatio = route.len > 0 ? route.sHome / route.len : 0.5;
    
    route.projPts = projPts;
    route.cum = cum;
    route.len = len;
    route.sMin = 24;
    route.sMax = len - 24;
    route.s = Math.max(route.sMin, Math.min(route.sMax, sRatio * len));
    route.sHome = Math.max(route.sMin, Math.min(route.sMax, sHomeRatio * len));
  }

  if (sporeCtx) createSpores();
}

// Wait for background image before ANY layout or initialization
function initAfterImageLoad() {
  if (!bgImg) {
    console.error('❌ bgImg element not found!');
    return;
  }
  
  console.log(`🖼️ Background image loaded: ${bgImg.naturalWidth}×${bgImg.naturalHeight}px`);
  
  // Compute cover using naturalWidth/naturalHeight
  if (!computeCoverFromImage()) {
    console.error('❌ Failed to compute cover from image');
    return;
  }
  
  computeNavOffsets(); // Compute offsets with proper base dimensions
  
  // First layout now happens AFTER image loads
  layoutNavNodes(wireSigilToggle, renderHUD, showSectionWithEffects);
  
  console.log(`✅ Initial layout complete — ritual is ${ritualActive ? 'ACTIVE' : 'OFF'}`);
  
  // Now safe to do full resize setup
  sizeCanvas(sparkCanvas);
  sizeCanvas(sporeCanvas);
  if (sporeCtx) createSpores();
  
  // Start animation loops
  requestAnimationFrame(sparkLoopWrapper);
  startSpores();
}

// GATE all initialization on image load
if (bgImg) {
  if (!bgImg.complete) {
    console.log(`⏳ Waiting for background image to load...`);
    bgImg.addEventListener('load', initAfterImageLoad, { once: true });
  } else if (bgImg.naturalWidth > 0) {
    // Already loaded
    console.log(`✅ Background image already loaded`);
    initAfterImageLoad();
  } else {
    console.warn('⚠️ Background image complete but no naturalWidth, waiting for load event');
    bgImg.addEventListener('load', initAfterImageLoad, { once: true });
  }
} else {
  console.error('❌ #bg-front-img element not found in DOM');
}

// Keep updated on resize - throttled for performance
const resizeAllThrottled = throttle(resizeAll, 150);
window.addEventListener('resize', resizeAllThrottled, { passive: true });
window.addEventListener('orientationchange', resizeAllThrottled, { passive: true });

/* ━━━ Ritual Toggle (Sigil) — P0 FIX #3, #4 ━━━ */
function toggleRitualFromSigil(el){
  setRitualActive(!ritualActive);
  
  // Apply rotation to CHILD img#sigil only (not parent .network-sigil-node)
  // Simple toggle: 0° when off, 180° when on
  const img = el.querySelector('img#sigil');
  if (img) {
    img.style.transform = `rotate(${ritualActive ? 180 : 0}deg)`;
    img.style.transition = 'transform 0.5s cubic-bezier(0.16, 1, 0.3, 1)';
  } else {
    console.warn('⚠️ img#sigil not found in sigil node');
  }

  // spore burst at sigil center
  const r = el.getBoundingClientRect();
  simpleParticles(r.left + r.width/2, r.top + r.height/2);

  // Proper ritual gating with logging
  if (ritualActive){
    startRitualMotion();
    attachFollowerSparks();
    console.log(`🔮 Ritual ACTIVATED (ritualActive=${ritualActive}) — ${followerSparks.length} follower sparks attached, rotation=180°`);
  } else {
    stopRitualMotion();
    detachFollowerSparks();
    sendLightningHome(); // one quick, zippy home ping per nav
    console.log(`🔮 Ritual DEACTIVATED (ritualActive=${ritualActive}) — labels returning to anchors, rotation=0°`);
  }
  
  // Update layout to apply/remove offsets immediately
  layoutNavNodes(wireSigilToggle, renderHUD, showSectionWithEffects);
}

function wireSigilToggle(){
  const sigil = document.querySelector('.network-sigil-node');
  const sigilImg = sigil ? sigil.querySelector('img#sigil') : null;
  
  // Debug check for proper DOM structure
  console.log('Sigil elements found:', { 
    sigilWrap: !!sigil, 
    sigilImg: !!sigilImg,
    sigilClass: sigil?.className,
    imgId: sigilImg?.id 
  });
  
  if (!sigil) {
    console.warn('⚠️ .network-sigil-node not found — toggle will not work');
    return;
  }
  if (!sigilImg) {
    console.warn('⚠️ img#sigil not found inside .network-sigil-node — rotation will not work');
  }
  
  sigil.addEventListener('click', () => toggleRitualFromSigil(sigil));
  sigil.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter'){
      e.preventDefault();
      toggleRitualFromSigil(sigil);
    }
  });
  console.log('✅ Sigil toggle wired — click to activate ritual');
}

function attachFollowerSparks(){
  const sparks = [];
  for (const [id] of Object.entries(LOCKED_ROUTES)){
    if (id === 'intro') continue;
    sparks.push({ id, alpha: 0.85 });
  }
  setFollowerSparks(sparks);
}
function detachFollowerSparks(){ 
  setFollowerSparks([]);
}

function sendLightningHome(){
  for (const [id] of Object.entries(LOCKED_ROUTES)){
    if (id === 'intro') continue;
    startSpark('intro', id, 900); // quick home ping
  }
}

function startRitualMotion(){
  for (const route of Object.values(LOCKED_ROUTES)){
    if (!route) continue;
    
    // FIX: Pick initial direction based on position within route bounds
    // If closer to sMin, go forward (+1); if closer to sMax, go backward (-1)
    const distToMin = Math.abs(route.s - route.sMin);
    const distToMax = Math.abs(route.s - route.sMax);
    
    if (distToMin < distToMax) {
      route.dir = 1; // Start moving toward sMax
    } else {
      route.dir = -1; // Start moving toward sMin
    }
  }
}

function stopRitualMotion(){
  // Reset all routes back to home position (anchor)
  // This ensures next activation starts from anchors, not from where they stopped
  for (const route of Object.values(LOCKED_ROUTES)){
    if (!route) continue;
    route.s = route.sHome;
  }
  console.log('🏠 Routes reset to home positions (anchors)');
}

// ━━━ Spores Layer (ambient) ━━━

function createSpores() {
  if (!sporeCanvas || !sporeCtx) return;
  const cssW = window.innerWidth;
  const cssH = window.innerHeight;
  const count = cssW < 768 ? 30 : 50;
  setSpores(new Array(count).fill(0).map(() => ({
    x: Math.random() * cssW,
    y: Math.random() * cssH,
    vx: (Math.random() - 0.5) * 0.2,
    vy: (Math.random() - 0.5) * 0.2,
    r: 1 + Math.random() * 3,
    p: Math.random() * Math.PI * 2,
    a: 0.1 + Math.random() * 0.25,
    scalePhase: Math.random() * Math.PI * 2
  })));
  setLastSporeFrame(0);
}

function drawSpores(ts) {
  if (!sporeCtx || !sporeCanvas) return;
  if (ts - lastSporeFrame < 33) return;
  setLastSporeFrame(ts);

  const c = sporeCtx;
  const w = window.innerWidth;
  const h = window.innerHeight;
  c.clearRect(0, 0, w, h);

  for (const s of spores) {
    s.x = (s.x + s.vx + w) % w;
    s.y = (s.y + s.vy + h) % h;

    const pulse = (Math.sin(ts * 0.001 + s.p) + 1) / 2;
    const scalePulse = 0.8 + 0.4 * (Math.sin(ts * 0.0015 + s.scalePhase) + 1) / 2;
    const radius = s.r * scalePulse;

    c.shadowBlur = 8;
    c.shadowColor = `rgba(122,174,138,${s.a * pulse * 0.6})`;
    c.fillStyle = `rgba(122,174,138,${s.a * pulse})`;
    c.beginPath();
    c.arc(s.x, s.y, radius, 0, Math.PI * 2);
    c.fill();

    c.shadowBlur = 0;
    c.fillStyle = `rgba(200,255,220,${s.a * pulse * 0.8})`;
    c.beginPath();
    c.arc(s.x, s.y, radius * 0.4, 0, Math.PI * 2);
    c.fill();
  }
}

function startSpores() {
  if (!sporeCanvas || prefersReducedMotion) return;
  if (!sporeCtx) setSporeCtx(sporeCanvas.getContext('2d'));
  if (!sporeCtx) return;
  createSpores();

  function loop(ts) {
    drawSpores(ts);
    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
}

function nearestNodeId(pt) {
  if (!GRAPH) return -1;
  return GRAPH.nearestId(pt.x, pt.y, 96, 24);
}

// ━━━ [LOCKED-ROUTE] Stable Single-Branch Label Motion ━━━

// [LOCKED-ROUTE] Resample polyline to uniform spacing in image space
function resamplePolyline(pts, step = 10) {
  if (!pts || pts.length < 2) return pts;
  
  const resampled = [pts[0]];
  let accumulated = 0;
  
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const segLen = Math.hypot(x1 - x0, y1 - y0);
    
    let localDist = 0;
    while (accumulated + localDist + step <= segLen) {
      localDist += step;
      const t = localDist / segLen;
      resampled.push([
        x0 + (x1 - x0) * t,
        y0 + (y1 - y0) * t
      ]);
    }
    accumulated = segLen - localDist;
  }
  
  // Always include endpoint
  const last = pts[pts.length - 1];
  if (resampled[resampled.length - 1] !== last) {
    resampled.push(last);
  }
  
  return resampled;
}

// [LOCKED-ROUTE] Find closest point on polyline and return arc-length
function projectOntoPolyline(px, py, polyline) {
  let bestDist = Infinity;
  let bestS = 0;
  let cumS = 0;
  
  for (let i = 1; i < polyline.length; i++) {
    const [x0, y0] = polyline[i - 1];
    const [x1, y1] = polyline[i];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const segLen = Math.hypot(dx, dy);
    
    if (segLen < 1e-6) {
      const d = Math.hypot(px - x0, py - y0);
      if (d < bestDist) {
        bestDist = d;
        bestS = cumS;
      }
      continue;
    }
    
    const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / (segLen * segLen)));
    const closestX = x0 + t * dx;
    const closestY = y0 + t * dy;
    const d = Math.hypot(px - closestX, py - closestY);
    
    if (d < bestDist) {
      bestDist = d;
      bestS = cumS + t * segLen;
    }
    
    cumS += segLen;
  }
  
  return { dist: bestDist, s: bestS };
}

// [LOCKED-ROUTE] Slice polyline by arc-length window [sStart, sEnd]
function slicePolylineByS(poly, sStart, sEnd) {
  if (!poly || poly.length < 2) return poly;
  
  const result = [];
  let cumS = 0;
  
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i];
    
    if (i === 0) {
      // Check if start point is within window
      if (cumS >= sStart) result.push([x0, y0]);
      continue;
    }
    
    const [x1, y1] = poly[i - 1];
    const segLen = Math.hypot(x0 - x1, y0 - y1);
    const segEnd = cumS + segLen;
    
    // Segment overlaps [sStart, sEnd]?
    if (segEnd >= sStart && cumS <= sEnd) {
      // Add start interpolation if needed
      if (result.length === 0 && cumS < sStart) {
        const t = (sStart - cumS) / segLen;
        result.push([
          x1 + (x0 - x1) * t,
          y1 + (y0 - y1) * t
        ]);
      }
      
      // Add endpoint if within window
      if (cumS >= sStart && cumS <= sEnd) {
        result.push([x0, y0]);
      }
      
      // Add end interpolation if we've passed sEnd
      if (segEnd > sEnd && cumS < sEnd) {
        const t = (sEnd - cumS) / segLen;
        result.push([
          x1 + (x0 - x1) * t,
          y1 + (y0 - y1) * t
        ]);
        break;
      }
    }
    
    cumS = segEnd;
    if (cumS > sEnd) break;
  }
  
  return result.length >= 2 ? result : poly;
}

// [LOCKED-ROUTE] Ritual: sparks to all current label positions
function ritualCatchUp() {
  if (prefersReducedMotion) return;
  
  let delay = 0;
  // Iterate over what's actually locked
  for (const id of Object.keys(LOCKED_ROUTES)) {
    const route = LOCKED_ROUTES[id];
    if (!route) continue;
    
    const [imgX, imgY] = imgPointAtRoute(route, route.s);
    
    setTimeout(() => {
      startSparkToPoint('intro', imgX, imgY, 750);
    }, delay);
    
    delay += 60 + Math.random() * 40;
  }
}

// ━━━ Initialization ━━━
async function initNetworkAndNav() {
  if (!MYC_MAP) return;

  setGraph(buildGraphFromPaths(MYC_MAP.paths));
  computeNavOffsets();                 // AFTER graph built
  PATH_CACHE.clear();

  for (const [id, pt] of Object.entries(NAV_COORDS)) {
    NODE_IDS[id] = GRAPH.nearestId(pt.x, pt.y, 80, 24);
  }

  const introId = NODE_IDS.intro;
  if (introId != null && introId >= 0) {
    for (const [id, gid] of Object.entries(NODE_IDS)) {
      if (id === 'intro' || gid == null || gid < 0) continue;
      aStarPath(introId, gid, GRAPH, PATH_CACHE); // warm both ways
      aStarPath(gid, introId, GRAPH, PATH_CACHE);
    }
  }

  // [LOCKED-ROUTE] Lock each label to a single polyline (never re-snap)
  buildLockedRoutes();

  layoutNavNodes(wireSigilToggle, renderHUD, showSectionWithEffects);
}

// ━━━ Blog: Hub menu controls ━━━
function initBlogControls() {
  console.log('[Blog Nav] Initializing blog controls...');
  
  // Populate article counts in memorandum and mobile grid
  populateBlogCounts();
  
  const hubButtons = document.querySelectorAll('.hub-btn');
  
  // Hub button wiring for navigation
  let lastButtonClickTime = 0;
  const BUTTON_DEBOUNCE = 300; // ms
  
  hubButtons.forEach(btn => {
    const hubId = btn.dataset.hub;
    
    // Hover events
    btn.addEventListener('mouseenter', () => {
      window.dispatchEvent(new CustomEvent('blog:hover', { detail: { hubId, source: 'menu' } }));
    });
    
    btn.addEventListener('mouseleave', () => {
      window.dispatchEvent(new CustomEvent('blog:hover-off', { detail: { hubId } }));
    });
    
    // Focus events (keyboard navigation)
    btn.addEventListener('focus', () => {
      window.dispatchEvent(new CustomEvent('blog:hover', { detail: { hubId, source: 'menu' } }));
    });
    
    btn.addEventListener('blur', () => {
      window.dispatchEvent(new CustomEvent('blog:hover-off', { detail: { hubId } }));
    });
    
    // Click + keyboard activation (debounced)
    const activateHub = () => {
      const now = performance.now();
      if (now - lastButtonClickTime < BUTTON_DEBOUNCE) {
        console.log('[Blog Nav] Button click debounced (too fast)');
        return;
      }
      lastButtonClickTime = now;
      
      enterBlogCategory(hubId);
    };
    
    btn.addEventListener('click', activateHub);
    
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activateHub();
      }
    });
  });
  
  // Listen for WebGL canvas click navigation (hub nodes)
  window.addEventListener('blog:navigate', (e) => {
    const { hubId } = e.detail;
    if (hubId) {
      enterHub(hubId);
    }
  });
  
  // Listen for rim label hover (trigger WebGL hub highlight)
  document.addEventListener('mouseover', (e) => {
    const arcBtn = e.target.closest('.arc-btn');
    if (arcBtn && arcBtn.dataset.hub) {
      const hubId = arcBtn.dataset.hub;
      console.log('[Blog Nav] Rim label hover:', hubId);
      window.dispatchEvent(new CustomEvent('blog:hover', { 
        detail: { hubId, source: 'rim-label' }
      }));
    }
  });
  
  document.addEventListener('mouseout', (e) => {
    const arcBtn = e.target.closest('.arc-btn');
    if (arcBtn && arcBtn.dataset.hub) {
      const hubId = arcBtn.dataset.hub;
      window.dispatchEvent(new CustomEvent('blog:hover-off', { 
        detail: { hubId }
      }));
    }
  });
  
  // Listen for rim label clicks (.arc-btn in dish-labels)
  document.addEventListener('click', (e) => {
    const arcBtn = e.target.closest('.arc-btn');
    if (arcBtn && arcBtn.dataset.hub) {
      const hubId = arcBtn.dataset.hub;
      console.log('[Blog Nav] Rim label clicked:', hubId);
      enterHub(hubId);
    }
  });
  
  // Listen for rim label keyboard activation
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      const arcBtn = e.target.closest('.arc-btn');
      if (arcBtn && arcBtn.dataset.hub) {
        e.preventDefault();
        const hubId = arcBtn.dataset.hub;
        console.log('[Blog Nav] Rim label activated (kbd):', hubId);
        enterHub(hubId);
      }
    }
  });
  
  // Listen for Map button click
  const btnMap = document.getElementById('btn-map');
  if (btnMap) {
    btnMap.addEventListener('click', () => {
      console.log('[Blog Nav] Map button clicked');
      exitToMap();
    });
  }
  
  // Legacy: Listen for Petri Map button click (may not exist anymore)
  window.addEventListener('blog:map', () => {
    console.log('[Blog Nav] Map button clicked (legacy event)');
    exitToMap();
  });
  
  // Wire up aria-live status for hover announcements
  const hubStatus = document.getElementById('hub-status');
  const HUB_INFO = {
    craft: { title: 'CRAFT', desc: 'Tools, code, and making by hand' },
    cosmos: { title: 'COSMOS', desc: 'Systems, networks, and emergence' },
    codex: { title: 'CODEX', desc: 'Engineering notes and debugging journals' },
    convergence: { title: 'CONVERGENCE', desc: 'Where disciplines meet' }
  };
  
  // Create tooltip element
  const tooltip = document.createElement('div');
  tooltip.className = 'blog-hub-tooltip';
  tooltip.innerHTML = `
    <span class="blog-hub-tooltip-title"></span>
    <span class="blog-hub-tooltip-description"></span>
  `;
  document.querySelector('#blog').appendChild(tooltip);
  
  const tooltipTitle = tooltip.querySelector('.blog-hub-tooltip-title');
  const tooltipDesc = tooltip.querySelector('.blog-hub-tooltip-description');
  
  window.addEventListener('blog:hover', (e) => {
    const { hubId } = e.detail;
    if (hubStatus && hubId && HUB_INFO[hubId]) {
      const info = HUB_INFO[hubId];
      hubStatus.textContent = `Preview: ${info.title}. ${info.desc}.`;
      
      // Show tooltip
      tooltipTitle.textContent = info.title;
      tooltipDesc.textContent = info.desc;
      tooltip.classList.add('visible');
    }
  });
  
  window.addEventListener('blog:hover-off', () => {
    if (hubStatus) {
      hubStatus.textContent = '';
    }
    // Hide tooltip
    tooltip.classList.remove('visible');
  });
  
  console.log('[Blog Nav] Blog controls initialized');
}

// ━━━ Blog: Category/Article navigation ━━━

// Update blog nav active state
function updateBlogNavActive(hubId) {
  document.querySelectorAll('.blog-nav-link').forEach(link => {
    if (link.dataset.hub === hubId) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });
}

// Unified hub entry (called by both rim labels and canvas hub clicks)
function enterHub(hubId) {
  // Ignore source node
  if (!hubId || hubId === 'source') {
    console.warn('[Blog Nav] Cannot enter hub:', hubId);
    return;
  }
  
  console.log('[Blog Nav] Entering hub:', hubId);
  
  // Set mode to 'category' on blog section
  const blogSection = document.getElementById('blog');
  if (blogSection) {
    blogSection.dataset.mode = 'category';
    blogSection.classList.add('in-category'); // Legacy support
  }
  
  // Hide dish labels (we're in reading mode now)
  const dishLabels = document.getElementById('dish-labels');
  if (dishLabels) {
    dishLabels.style.display = 'none';
  }
  
  // Update nav active state
  updateBlogNavActive(hubId);
  
  // Show category view
  const categoryView = document.getElementById('blog-category-view');
  if (categoryView) {
    categoryView.setAttribute('data-category', hubId);
    categoryView.removeAttribute('hidden');
    loadCategoryContent(hubId);
    console.log('[Blog Nav] Category view opened for:', hubId);
  } else {
    console.error('[Blog Nav] Category view element not found!');
  }
  
  // Update URL
  history.pushState({ view: 'category', hubId }, '', `#blog/${hubId}`);
}

// Exit to map view (reverses enterHub)
function exitToMap() {
  console.log('[Blog Nav] Exiting to map');
  
  // Set mode back to 'map'
  const blogSection = document.getElementById('blog');
  if (blogSection) {
    blogSection.dataset.mode = 'map';
    blogSection.classList.remove('in-category');
  }
  
  // Show dish labels again
  const dishLabels = document.getElementById('dish-labels');
  if (dishLabels) {
    dishLabels.style.display = '';
  }
  
  // Clear nav active state
  updateBlogNavActive(null);
  
  // Hide category and article views
  const categoryView = document.getElementById('blog-category-view');
  const articleView = document.getElementById('blog-article-view');
  if (categoryView) categoryView.setAttribute('hidden', '');
  if (articleView) articleView.setAttribute('hidden', '');
  
  console.log('[Blog Nav] Returned to map view');
  
  // Update URL
  history.pushState({ view: 'map' }, '', '#blog');
}

// Legacy alias for backwards compatibility
function enterBlogCategory(hubId) { return enterHub(hubId); }
function exitBlogCategory() { return exitToMap(); }

// Legacy alias for showMapRoot (now just calls exitToMap)
function showMapRoot() {
  exitToMap();
}

// Articles registry (loaded from articles.json)
let ARTICLES_REGISTRY = null;

// Load articles registry from JSON
async function loadArticlesRegistry() {
  if (ARTICLES_REGISTRY) return ARTICLES_REGISTRY;
  
  try {
    const res = await fetch('./blog/articles.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    ARTICLES_REGISTRY = await res.json();
    console.log('[Blog] Articles registry loaded:', ARTICLES_REGISTRY);
    return ARTICLES_REGISTRY;
  } catch (err) {
    console.warn('[Blog] Could not load articles.json, using fallback:', err.message);
    // Fallback to empty registry
    ARTICLES_REGISTRY = { craft: [], cosmos: [], codex: [], convergence: [] };
    return ARTICLES_REGISTRY;
  }
}

// Populate article counts in memorandum and mobile grid
async function populateBlogCounts() {
  const registry = await loadArticlesRegistry();
  const hubs = ['craft', 'cosmos', 'codex', 'convergence'];
  
  hubs.forEach(hub => {
    const count = (registry[hub] || []).length;
    const countText = count > 0 ? `(${count})` : '';
    
    // Update desktop memorandum
    const memoCount = document.querySelector(`.blog-memo-count[data-hub="${hub}"]`);
    if (memoCount) memoCount.textContent = countText;
    
    // Update mobile specimen grid
    const specCount = document.querySelector(`.specimen-count[data-hub="${hub}"]`);
    if (specCount) specCount.textContent = countText;
  });
  
  console.log('[Blog] Article counts populated');
}

async function loadCategoryContent(hubId) {
  const content = document.getElementById('blog-category-content');
  const titleEl = document.getElementById('blog-category-title');
  if (!content) return;
  
  // Load articles from registry
  const registry = await loadArticlesRegistry();
  const articles = registry[hubId] || [];
  const hubTitle = hubId.toUpperCase();
  
  // Update header title
  if (titleEl) titleEl.textContent = hubTitle;
  
  content.innerHTML = `
    ${articles.length === 0 ? '<p class="blog-empty-state">No articles yet. Check back soon!</p>' : ''}
    <div class="blog-article-list">
      ${articles.map(a => `
        <div class="blog-article-item" data-article="${a.id}" tabindex="0" role="button" aria-label="Read ${a.title}">
          <h3>${a.title}</h3>
          <div class="meta">${a.date}</div>
          <div class="excerpt">${a.excerpt}</div>
        </div>
      `).join('')}
    </div>
  `;
  
  // Wire article clicks
  content.querySelectorAll('.blog-article-item').forEach(item => {
    const articleId = item.dataset.article;
    console.log(`[Blog Nav] Wiring article: hubId="${hubId}", articleId="${articleId}"`);
    const activateArticle = () => {
      console.log(`[Blog Nav] 🖱️ Article clicked: hubId="${hubId}", articleId="${articleId}"`);
      enterBlogArticle(hubId, articleId);
    };
    
    item.addEventListener('click', activateArticle);
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activateArticle();
      }
    });
  });
}

// ━━━ Article Scroll Navigation ━━━
function initArticleScrollNav() {
  const scrollNav = document.querySelector('.article-scroll-nav');
  if (!scrollNav) return;
  
  const articleView = document.getElementById('blog-article-view');
  const articleContent = document.getElementById('blog-article-content');
  if (!articleView || !articleContent) return;
  
  const SCROLL_AMOUNT = 300; // ~10 lines
  const THRESHOLD = 400; // ~15 lines - show/hide threshold
  
  // Button click handlers
  scrollNav.querySelectorAll('.scroll-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      
      switch (action) {
        case 'top':
          articleView.scrollTo({ top: 0, behavior: 'smooth' });
          break;
        case 'up':
          articleView.scrollBy({ top: -SCROLL_AMOUNT, behavior: 'smooth' });
          break;
        case 'down':
          articleView.scrollBy({ top: SCROLL_AMOUNT, behavior: 'smooth' });
          break;
        case 'bottom':
          articleView.scrollTo({ top: articleView.scrollHeight, behavior: 'smooth' });
          break;
      }
    });
  });
  
  // Update nav visibility based on scroll position AND article view visibility
  const updateScrollNav = () => {
    // Only show if article view is visible
    const isArticleVisible = !articleView.hidden && articleView.offsetParent !== null;
    if (!isArticleVisible) {
      scrollNav.classList.remove('visible');
      return;
    }
    
    const scrollTop = articleView.scrollTop;
    const scrollHeight = articleView.scrollHeight;
    const clientHeight = articleView.clientHeight;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    
    // Show nav only when scrolled past threshold AND not near the end
    const pastTop = scrollTop > THRESHOLD;
    const beforeEnd = distanceFromBottom > THRESHOLD;
    const shouldShow = pastTop && beforeEnd;
    
    scrollNav.classList.toggle('visible', shouldShow);
  };
  
  articleView.addEventListener('scroll', updateScrollNav);
  
  // Also update when article view visibility changes
  const observer = new MutationObserver(() => {
    // Reset scroll position when article opens
    if (!articleView.hidden) {
      articleView.scrollTop = 0;
    }
    updateScrollNav();
  });
  observer.observe(articleView, { attributes: true, attributeFilter: ['hidden'] });
  
  // Initial state (hidden)
  updateScrollNav();
}

function enterBlogArticle(hubId, articleId) {
  console.log(`[Blog Nav] 📄 Entering article: hubId="${hubId}", articleId="${articleId}"`);
  
  // Hide category view
  const categoryView = document.getElementById('blog-category-view');
  if (categoryView) {
    categoryView.setAttribute('hidden', '');
    console.log('[Blog Nav] Category view hidden');
  } else {
    console.error('[Blog Nav] Category view element not found!');
  }
  
  // Update nav active state for article view too
  updateBlogNavActive(hubId);
  
  // Show article view
  const articleView = document.getElementById('blog-article-view');
  if (articleView) {
    articleView.removeAttribute('hidden');
    console.log('[Blog Nav] Article view shown');
    loadArticleContent(hubId, articleId);
  } else {
    console.error('[Blog Nav] Article view element not found!');
  }
  
  // Update URL
  history.pushState({ view: 'article', hubId, articleId }, '', `#blog/${hubId}/${articleId}`);
  console.log(`[Blog Nav] URL updated to: #blog/${hubId}/${articleId}`);
}

function exitBlogArticle() {
  console.log('[Blog Nav] Exiting article');
  
  // Show category view
  document.getElementById('blog-category-view')?.removeAttribute('hidden');
  
  // Hide article view
  document.getElementById('blog-article-view')?.setAttribute('hidden', '');
  
  // Restore category URL
  const categoryView = document.getElementById('blog-category-view');
  if (categoryView) {
    const hubId = history.state?.hubId || 'craft';
    history.pushState({ view: 'category', hubId }, '', `#blog/${hubId}`);
  }
}

function loadArticleContent(hubId, articleId) {
  const content = document.getElementById('blog-article-content');
  if (!content) {
    console.error('[Blog Nav] blog-article-content element NOT FOUND');
    return;
  }
  
  const path = `./blog/${hubId}/${articleId}.html`;
  console.log(`[Blog Nav] Loading article: ${path}`);
  console.log(`[Blog Nav] Article ID: "${articleId}", Hub ID: "${hubId}"`);
  
  // Load from existing HTML files
  fetch(path)
    .then(res => {
      console.log(`[Blog Nav] Fetch response: ${res.status} ${res.statusText}`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      return res.text();
    })
    .then(html => {
      console.log(`[Blog Nav] HTML loaded, length: ${html.length}`);
      // Extract body content (simple parser)
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const article = doc.querySelector('.article-container');
      if (article) {
        console.log('[Blog Nav] Article container found, injecting content');
        content.innerHTML = article.innerHTML;
        
        // Wire up breadcrumb and back button navigation
        setupArticleNavigation(content, hubId);
      } else {
        console.error('[Blog Nav] No .article-container found in HTML');
        content.innerHTML = '<p>Article not found.</p>';
        if (titleEl) titleEl.textContent = 'Article Not Found';
      }
    })
    .catch(err => {
      console.error('[Blog Nav] Failed to load article:', err);
      content.innerHTML = `
        <div style="padding: 40px; text-align: center;">
          <p style="color: rgba(201, 194, 179, 0.7); margin-bottom: 16px;">Failed to load article.</p>
          <p style="color: rgba(201, 194, 179, 0.5); font-size: 0.9em;">
            ${err.message || 'Network error'}<br>
            <small>Path: ./blog/${hubId}/${articleId}.html</small>
          </p>
          <p style="color: rgba(201, 194, 179, 0.4); font-size: 0.85em; margin-top: 24px;">
            Note: This page requires a local server (e.g., <code>npx serve</code> or VS Code Live Server)
          </p>
        </div>
      `;
      if (titleEl) titleEl.textContent = 'Error Loading Article';
    });
}

// Set up navigation for article breadcrumbs and back button
function setupArticleNavigation(container, hubId) {
  // Handle breadcrumb clicks
  const breadcrumbLinks = container.querySelectorAll('.breadcrumb a');
  breadcrumbLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const href = link.getAttribute('href');
      
      if (href.includes('#blog?hub=') || href.includes('#blog/')) {
        // Category breadcrumb - go back to category view
        exitBlogArticle();
      } else if (href.includes('#blog')) {
        // Blog root breadcrumb - go back to map
        exitToMap();
      }
    });
  });
  
  // Handle back button clicks
  const backButton = container.querySelector('.back-button');
  if (backButton) {
    backButton.addEventListener('click', (e) => {
      e.preventDefault();
      exitBlogArticle();
    });
  }
}

// ━━━ Section visibility wrapper (controls blog network and other section-specific features) ━━━
function showSectionWithEffects(sectionName) {
  console.log('[App] showSectionWithEffects called:', sectionName);
  showSection(sectionName, startRitualBackground, stopRitualBackground);
  
  // Emit blog:visible event for overlay
  const isBlogVisible = sectionName === 'blog';
  window.dispatchEvent(new CustomEvent('blog:visible', {
    detail: { visible: isBlogVisible }
  }));
  
  const blog = document.getElementById('blog');
  console.log('[App] Section visibility IMMEDIATE:', {
    blogExists: !!blog,
    hasActiveSection: blog?.classList.contains('active-section'),
    allClasses: blog?.className,
    opacity: getComputedStyle(blog || {}).opacity,
    display: getComputedStyle(blog || {}).display,
    pointerEvents: getComputedStyle(blog || {}).pointerEvents,
    emittedBlogVisible: isBlogVisible
  });
  
  // Check again after CSS transition completes (0.8s)
  setTimeout(() => {
    const blogAfter = document.getElementById('blog');
    console.log('[App] Section visibility AFTER TRANSITION (0.8s):', {
      opacity: getComputedStyle(blogAfter || {}).opacity,
      display: getComputedStyle(blogAfter || {}).display,
      pointerEvents: getComputedStyle(blogAfter || {}).pointerEvents,
      visible: getComputedStyle(blogAfter || {}).opacity === '1'
    });
  }, 900);
  
  // Blog network visibility now handled by WebGL version
  // if (sectionName === 'blog') {
  //   blogNetwork.show();
  // } else {
  //   blogNetwork.hide();
  // }
}

window.addEventListener('DOMContentLoaded', async () => {
  await loadMycelium().catch(err => console.warn('⚠️ network.json unavailable:', err));
  await initNetworkAndNav();

  const nav = document.getElementById('network-nav');
  if (nav) {
    nav.querySelectorAll('.network-node-label, .network-sigil-node').forEach(el => {
      const id = el.dataset.node;
      el.addEventListener('pointerenter', () => handleNavEnter(id, el, startSpark, startSparkToPoint, pointAtRoute));
      el.addEventListener('pointerleave', () => handleNavLeave(id, el));
      el.addEventListener('focus', () => handleNavEnter(id, el, startSpark, startSparkToPoint, pointAtRoute));
      el.addEventListener('blur', () => handleNavLeave(id, el));
    });
  }

  // Honor hash on load, or default to intro
  const hash = window.location.hash.slice(1);
  
  // Handle blog sub-routes on initial load
  if (hash.startsWith('blog/')) {
    const parts = hash.split('/');
    const hubId = parts[1];
    const articleId = parts[2];
    
    console.log(`🎯 Page Load: blog sub-route detected - hubId="${hubId}", articleId="${articleId || 'none'}"`);
    showSectionWithEffects('blog');
    
    // Navigate to category or article after blog section loads
    if (articleId) {
      setTimeout(() => enterBlogArticle(hubId, articleId), 100);
    } else if (hubId) {
      setTimeout(() => enterHub(hubId), 100);
    }
  } else {
    const validSections = ['intro', 'about', 'work', 'projects', 'contact', 'blog', 'resume', 'skills', 'now'];
    const initialSection = validSections.includes(hash) ? hash : 'intro';
    console.log(`🎯 Page Load: hash="${hash}", showing section="${initialSection}"`);
    showSectionWithEffects(initialSection);
  }

  if (hudEnabled) {
    initHUD();
    renderHUD();
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'H') toggleHUD();
    
    // ESC key for blog navigation
    if (e.key === 'Escape') {
      const articleView = document.getElementById('blog-article-view');
      const categoryView = document.getElementById('blog-category-view');
      
      if (articleView && !articleView.hasAttribute('hidden')) {
        exitBlogArticle();
      } else if (categoryView && !categoryView.hasAttribute('hidden')) {
        exitBlogCategory();
      }
    }
  });

  // Initialize ritual background system
  initRitualBackground();

  // Initialize contact form
  notebookContact.init();

  // Initialize social icons animation (vials)
  socialIconsAnimation.init();

  // NOTE: Blog network now uses WebGL version loaded directly in HTML
  // blogNetwork.init();

  // Contact section: click background to close
  const contactSection = document.getElementById('contact');
  if (contactSection) {
    contactSection.addEventListener('click', (e) => {
      // Only close if clicking directly on the section (background), not on the notebook or its children
      if (e.target === contactSection) {
        showSectionWithEffects('intro');
      }
    });
  }
  
  // ━━━ Blog: Hub menu wiring ━━━
  initBlogControls();
  
  // Blog Map buttons (in category and article views)
  document.getElementById('btn-map-category')?.addEventListener('click', exitToMap);
  document.getElementById('btn-map-article')?.addEventListener('click', exitToMap);
  
  // Blog Navigation Bar links
  document.querySelectorAll('.blog-nav-link').forEach(link => {
    link.addEventListener('click', () => {
      const hubId = link.dataset.hub;
      if (hubId === 'map') {
        exitToMap();
      } else {
        // Navigate to the hub (will work from both category and article views)
        enterHub(hubId);
      }
    });
  });
  
  // Article Scroll Navigation
  initArticleScrollNav();
});

// Mobile sigil menu
const sigilBtn = document.getElementById('myco-sigil-btn');
const menuDlg  = document.getElementById('necro-menu');

if (sigilBtn && menuDlg && typeof menuDlg.showModal === 'function') {
  sigilBtn.addEventListener('click', () => {
    menuDlg.showModal();                          // native modal + backdrop
    sigilBtn.setAttribute('aria-expanded', 'true');
  });

  // Close handlers
  menuDlg.addEventListener('click', (e) => {
    if (e.target === menuDlg) menuDlg.close();    // click backdrop
  });
  menuDlg.querySelector('[data-close]')?.addEventListener('click', () => menuDlg.close());
  menuDlg.addEventListener('close', () => sigilBtn.setAttribute('aria-expanded','false'));

  // Wire menu items (hash + custom event for your router)
  menuDlg.querySelectorAll('[data-nav-open]').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const section = a.getAttribute('data-nav-open');
      // optional: let your existing app.js listen for this
      document.dispatchEvent(new CustomEvent('open-section', { detail: section }));
      // basic fallback: update hash (you can hook hashchange)
      if (section) location.hash = section;
      menuDlg.close();
    });
  });
}

// ━━━ Post-load layout (fonts & image settling) ━━━
window.addEventListener('load', () => {
  // Ensure cover is recomputed after all assets settle
  if (COVER.ready) {
    computeCoverFromImage();
    computeNavOffsets();
    layoutNavNodes(wireSigilToggle, renderHUD, showSectionWithEffects);
    if (hudEnabled) renderHUD();
  }
  
  // Initialize hub-to-icons spore system (mobile only)
  initHubToIcons();
});

// ━━━ Glitch Text Effect Setup ━━━
const glitchElements = document.querySelectorAll('.glitch-text');
glitchElements.forEach(el => {
  el.setAttribute('data-text', el.textContent);
});

// ━━━ Removed duplicate sigil handler (using wireSigilToggle() instead) ━━━

/**
 * Simple Particle Effect (kept for use by toggleRitualFromSigil)
 * Creates ~12 lightweight particles that fly outward and fade
 */
function simpleParticles(x, y) {
  if (prefersReducedMotion) return;
  
  const layer = document.createElement('div');
  Object.assign(layer.style, {
    position:'absolute', 
    inset:0, 
    overflow:'hidden', 
    pointerEvents:'none',
    zIndex:999
  });
  document.body.appendChild(layer);
  
  const count = 12;
  for (let i=0; i<count; i++){
    const particle = document.createElement('span');
    const angle = (Math.PI * 2) * (i / count);
    const distance = 50 + Math.random() * 30;
    const size = 3;
    
    Object.assign(particle.style, {
      position:'absolute',
      left: x + 'px', 
      top: y + 'px',
      width: size + 'px', 
      height: size + 'px',
      borderRadius:'50%',
      background:'rgba(230,227,216,.7)',
      transform:'translate(-50%,-50%)',
      transition:'transform .5s ease-out, opacity .5s ease-out'
    });
    
    layer.appendChild(particle);
    
    // Animate in next frame
    requestAnimationFrame(() => {
      particle.style.transform = `translate(${Math.cos(angle) * distance}px, ${Math.sin(angle) * distance}px)`;
      particle.style.opacity = '0';
    });
  }
  
  // Clean up after animation
  setTimeout(() => layer.remove(), 600);
}

/* ━━━ NOTES ━━━
 * Navigation:
 * - NAV_COORDS provides fixed 1920×1080 anchors; toViewportCover() keeps them glued to the artwork.
 * - GRAPH is an A* graph derived from artifacts/network.json so sparks hug real mycelium branches.
 *
 * Motion:
 * - Sparks animate as lightweight dots with additive glow; PATH_CACHE prevents redundant routing.
 * - prefers-reduced-motion skips animation and applies motion-highlight styling instead.
 * - Ambient spores pause when reduced motion is requested.
 *
 * Accessibility:
 * - Labels remain keyboard focusable with focus-visible styling and click handlers.
 * - showSection() keeps content panes in sync with nav state.
 */

// ━━━ Debug Helper (Console Command) ━━━
window.verifyAlignment = function() {
  console.log('\n=== ALIGNMENT VERIFICATION ===');
  console.log(`Ritual Active: ${ritualActive}`);
  console.log(`Cover Ready: ${COVER.ready}`);
  console.log(`Base Dimensions: ${COVER.baseW}×${COVER.baseH}`);
  console.log(`Transform: scale=${COVER.s.toFixed(4)}, offset=(${COVER.dx.toFixed(2)}, ${COVER.dy.toFixed(2)})`);
  console.log('\nLabel Positions:');
  for (const [id, pt] of Object.entries(NAV_COORDS)) {
    const el = document.querySelector(`[data-node="${id}"]`);
    if (!el) continue;
    const [ax, ay] = toViewport(pt.x, pt.y);
    const rect = el.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const deltaX = centerX - ax;
    const deltaY = centerY - ay;
    const route = LOCKED_ROUTES[id];
    console.log(`  ${id.padEnd(10)}: anchor=(${ax.toFixed(1)}, ${ay.toFixed(1)}), center=(${centerX.toFixed(1)}, ${centerY.toFixed(1)}), delta=(${deltaX.toFixed(1)}, ${deltaY.toFixed(1)})${route ? `, route=${route.len.toFixed(0)}px` : ''}`);
  }
  console.log('\nRun this command after load and after toggling ritual to verify alignment.\n');
};

// ━━━ Hash change listener (back/forward navigation) ━━━
window.addEventListener('hashchange', () => {
  const hash = window.location.hash.slice(1);
  
  // Handle blog sub-routes (e.g., #blog/craft, #blog/cosmos/article-slug)
  if (hash.startsWith('blog/')) {
    const parts = hash.split('/');
    const hubId = parts[1]; // craft, cosmos, convergence, codex
    const articleId = parts[2]; // optional article slug
    
    // First ensure blog section is visible
    showSectionWithEffects('blog');
    
    // Then navigate to the specific category or article
    if (articleId) {
      // Navigate to article view
      setTimeout(() => enterBlogArticle(hubId, articleId), 100);
    } else if (hubId) {
      // Navigate to category view
      setTimeout(() => enterHub(hubId), 100);
    }
    return;
  }
  
  const validSections = ['intro', 'about', 'work', 'projects', 'contact', 'blog', 'resume', 'skills', 'now'];
  if (validSections.includes(hash)) {
    showSectionWithEffects(hash);
  } else if (!hash) {
    showSectionWithEffects('intro');
  }
});

// ━━━ Back button handler (for altar screens) ━━━
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action="go-intro"]');
  if (!btn) return;
  e.preventDefault();
  showSectionWithEffects('intro');
});

// ━━━ Section nav handler (for section-to-section navigation) ━━━
document.addEventListener('click', (e) => {
  const link = e.target.closest('.section-nav-link');
  if (!link) return;
  e.preventDefault();
  const targetSection = link.dataset.section;
  if (targetSection) {
    showSectionWithEffects(targetSection);
  }
});

// ━━━ About: Paper focus (desktop only) ━━━
const mqWide = window.matchMedia('(min-width: 901px)');
if (mqWide.matches) {
  initAboutPaperFocus();       // desktop/tablet-wide only
  initSkillsPaperFocus();      // desktop/tablet-wide only
}
mqWide.addEventListener('change', (e) => {
  if (e.matches) {
    initAboutPaperFocus();          // re-enable when growing past 900
    initSkillsPaperFocus();         // re-enable when growing past 900
  }
  // When shrinking to mobile, simply don't bind zoom. If one is open,
  // the user can close it with the close/backdrop already in the DOM.
});

const mqMobile = window.matchMedia('(max-width: 900px)');

function aboutMobileInertify() {
  const papers = document.querySelectorAll('#about [data-paper]');
  papers.forEach(el => {
    // Remove keyboard focus on mobile; keep inner links (mailto) usable
    if (el.hasAttribute('tabindex')) el.removeAttribute('tabindex');
    el.setAttribute('aria-disabled', 'true'); // a11y hint (visuals unchanged)
  });
}

function aboutRestoreFocusForWide() {
  const papers = document.querySelectorAll('#about [data-paper]');
  papers.forEach(el => {
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
    el.removeAttribute('aria-disabled');
  });
}

if (mqMobile.matches) aboutMobileInertify();
mqMobile.addEventListener('change', e => {
  if (e.matches) aboutMobileInertify(); else aboutRestoreFocusForWide();
});

// Mobile: front-card blur toggle
(function () {
  const mqMobile = window.matchMedia('(max-width: 900px)');
  const altarSel = '#about .altar';

  function bindAboutFrontToggle() {
    const altar = document.querySelector(altarSel);
    if (!altar || altar.__frontBound) return;
    altar.__frontBound = true;

    altar.addEventListener('click', (e) => {
      const card = e.target.closest('.slab.paper');

      // 1) Clicked the background → clear everything (no blur)
      if (!card) {
        altar.classList.remove('has-front');
        altar.querySelectorAll('.slab.paper.is-front')
             .forEach(el => el.classList.remove('is-front'));
        return;
      }

      // 2) Don’t toggle when clicking real controls inside the card
      if (e.target.closest('a,button,[role="button"]')) return;

      // 3) Toggle front: if card is already front → clear; else set it front
      const isFront = card.classList.contains('is-front');
      
      // Always clear all is-front classes first
      altar.querySelectorAll('.slab.paper.is-front')
           .forEach(el => el.classList.remove('is-front'));
      
      // If card was NOT front, set it as front and add has-front to altar
      // If card WAS front, remove has-front from altar (clears blur on all cards)
      if (!isFront) {
        altar.classList.add('has-front');
        card.classList.add('is-front');
      } else {
        // Remove has-front class - CSS will handle blur clearing automatically
        altar.classList.remove('has-front');
      }
    }, { passive: true });
  }

  function unbindState() {
    const altar = document.querySelector(altarSel);
    if (!altar) return;
    altar.classList.remove('has-front');
    altar.querySelectorAll('.slab.paper.is-front')
         .forEach(el => el.classList.remove('is-front'));
  }

  if (mqMobile.matches) bindAboutFrontToggle();
  mqMobile.addEventListener('change', e => {
    if (e.matches) bindAboutFrontToggle(); else unbindState();
  });
})();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MOBILE BLUR TOGGLE FOR SKILLS SECTION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
(function() {
  const mqMobile = window.matchMedia('(max-width: 900px)');
  const altarSel = '#skills .altar';

  function bindSkillsFrontToggle() {
    const altar = document.querySelector(altarSel);
    if (!altar || altar.__frontBound) return;
    altar.__frontBound = true;

    altar.addEventListener('click', (e) => {
      const card = e.target.closest('.slab.paper');

      // 1) Clicked the background → clear everything (no blur)
      if (!card) {
        altar.classList.remove('has-front');
        altar.querySelectorAll('.slab.paper.is-front')
             .forEach(el => el.classList.remove('is-front'));
        return;
      }

      // 2) Don't toggle when clicking real controls inside the card
      if (e.target.closest('a,button,[role="button"]')) return;

      // 3) Toggle front: if card is already front → clear; else set it front
      const isFront = card.classList.contains('is-front');
      
      // Always clear all is-front classes first
      altar.querySelectorAll('.slab.paper.is-front')
           .forEach(el => el.classList.remove('is-front'));
      
      // If card was NOT front, set it as front and add has-front to altar
      // If card WAS front, remove has-front from altar (clears blur on all cards)
      if (!isFront) {
        altar.classList.add('has-front');
        card.classList.add('is-front');
      } else {
        // Remove has-front class - CSS will handle blur clearing automatically
        altar.classList.remove('has-front');
      }
    }, { passive: true });
  }

  function unbindState() {
    const altar = document.querySelector(altarSel);
    if (!altar) return;
    altar.classList.remove('has-front');
    altar.querySelectorAll('.slab.paper.is-front')
         .forEach(el => el.classList.remove('is-front'));
  }

  if (mqMobile.matches) bindSkillsFrontToggle();
  mqMobile.addEventListener('change', e => {
    if (e.matches) bindSkillsFrontToggle(); else unbindState();
  });
})();

// [AA-FIX] Watch for DPR changes (zoom/display scaling)
let lastDPR = window.devicePixelRatio || 1;
setInterval(() => {
  const currentDPR = window.devicePixelRatio || 1;
  if (currentDPR !== lastDPR) {
    console.log(`[AA-FIX] DPR changed from ${lastDPR} to ${currentDPR}`);
    lastDPR = currentDPR;
    // If a card is open, recompute its position
    const openCard = document.querySelector('.paper-open');
    if (openCard) {
      const r = openCard.getBoundingClientRect();
      const vw = window.innerWidth, vh = window.innerHeight;
      const cx = r.left + r.width/2, cy = r.top + r.height/2;
      const ipx = (n) => Math.round(Number(n) || 0);
      const tx = ipx((vw/2) - cx);
      const ty = ipx((vh/2) - cy);
      openCard.style.setProperty('--open-tx', `${tx}px`);
      openCard.style.setProperty('--open-ty', `${ty}px`);
    }
  }
}, 500);

/**
 * initAboutPaperFocus
 * 
 * Click (or Enter/Space) on an About "paper" zooms it to center and darkens the rest.
 * ESC or clicking the backdrop closes it.
 */
function initAboutPaperFocus(){
  initPaperFocusForSection('about');
}

/**
 * initSkillsPaperFocus
 * 
 * Click (or Enter/Space) on a Skills "paper" zooms it to center and darkens the rest.
 * ESC or clicking the backdrop closes it.
 */
function initSkillsPaperFocus(){
  initPaperFocusForSection('skills');
}

/**
 * Generic paper focus for altar sections
 */
function initPaperFocusForSection(sectionId){
  const section = document.getElementById(sectionId);
  if (!section) return;
  // Remove any old, scoped overlays (they caused the rectangle issue)
  section.querySelectorAll('.paper-overlay')?.forEach(n=>n.remove());

  const backdrop = document.getElementById('paper-backdrop');
  if (!backdrop) {
    console.warn('⚠️ paper-backdrop not found');
    return;
  }
  
  const papers = section.querySelectorAll('.paper');
  papers.forEach(p => {
    // ensure focusable for keyboard users
    if (!p.hasAttribute('tabindex')) p.setAttribute('tabindex','0');
    
    p.addEventListener('click', () => {
      // CRITICAL: Desktop zoom only - don't run on mobile (≤900px)
      if (window.innerWidth <= 900) return;
      
      // Toggle: if this paper is already open, close it; otherwise open it
      if (p.classList.contains('paper-open')) {
        closePaper();
      } else {
        openPaper(p);
      }
    });
    p.addEventListener('keydown', (e) => {
      // CRITICAL: Desktop zoom only - don't run on mobile (≤900px)
      if (window.innerWidth <= 900) return;
      
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (p.classList.contains('paper-open')) {
          closePaper();
        } else {
          openPaper(p);
        }
      }
    });
  });
  
  backdrop.addEventListener('click', closePaper);
  
  function onEsc(e){ if (e.key === 'Escape') closePaper(); }
  
  function openPaper(el){
    if (document.body.classList.contains('has-paper-open-global')) return;
    // Freeze current pixels before portaling
    const r = el.getBoundingClientRect();
    const computed = getComputedStyle(el);
    
    // Utility: integer pixel snapping for crispness
    const ipx = (n) => Math.round(Number(n) || 0);
    
    // Create an invisible placeholder that holds the exact same space and positioning
    const placeholder = document.createElement('div');
    // Copy all the classes so it gets the same CSS positioning rules
    placeholder.className = el.className.replace('paper-open', '') + ' paper-placeholder';
    placeholder.style.visibility = 'hidden';
    placeholder.style.pointerEvents = 'none';
    // Don't override the CSS positioning - let it use the same rules
    
    el.__portal = { parent: el.parentNode, placeholder: placeholder };
    el.__portal.parent.insertBefore(placeholder, el);
    // Move to <body> so fixed positioning uses viewport (avoids rectangle/backdrop bugs)
    document.body.appendChild(el);
    el.classList.add('paper-open');
    el.style.position = 'fixed';
    el.style.left = `${r.left}px`;
    el.style.top  = `${r.top}px`;
    el.style.width  = `${r.width}px`;
    el.style.height = `${r.height}px`;
    
    // Start with transform at 0 (paper at original position)
    el.style.setProperty('--open-tx', '0px');
    el.style.setProperty('--open-ty', '0px');
    el.style.setProperty('--open-scale', '1');
    
    // Compute center translation and scale to fit
    const vw = window.innerWidth, vh = window.innerHeight;
    const cx = r.left + r.width/2, cy = r.top + r.height/2;
    const tx = ipx((vw/2) - cx);
    const ty = ipx((vh/2) - cy);
    const fitW = (vw * 0.86) / r.width;
    const fitH = (vh * 0.80) / r.height;
    const scale = Math.min(fitW, fitH, 2.4);
    
    // Expose final layout size (rounded) for settled state
    const targetW = ipx(r.width * scale);
    const targetH = ipx(r.height * scale);
    el.style.setProperty('--open-w', `${targetW}px`);
    el.style.setProperty('--open-h', `${targetH}px`);
    
    // Animate to magnified state in next frame
    requestAnimationFrame(() => {
      el.style.setProperty('--open-tx', `${tx}px`);
      el.style.setProperty('--open-ty', `${ty}px`);
      el.style.setProperty('--open-scale', `${scale}`);
    });
    
    // [AA-FIX] When transform transition finishes, demote from compositor for better AA
    // We keep the scale() but remove will-change to allow subpixel rendering
    let settled = false;
    const applySettle = () => {
      if (settled) return;
      settled = true;
      
      el.classList.add('paper-open--settled');
      
      // Force compositor demotion - inline styles + CSS !important rules
      el.style.willChange = 'auto';
      el.style.backfaceVisibility = 'visible';
      
      // Force browser to re-evaluate layer promotion
      void el.offsetHeight;
      
      console.log('[AA-FIX] Settled:', el.className, 'willChange:', getComputedStyle(el).willChange);
    };
    
    const onEnd = (e) => {
      if (e.propertyName !== 'transform') return;
      el.removeEventListener('transitionend', onEnd);
      applySettle();
    };
    el.addEventListener('transitionend', onEnd, { once: true });
    
    // Fallback: ensure settle happens even if transitionend doesn't fire
    setTimeout(applySettle, 350); // 300ms transition + 50ms buffer
    
    // Accessibility + backdrop
    el.setAttribute('role','dialog');
    el.setAttribute('aria-modal','true');
    document.body.classList.add('has-paper-open-global');
    requestAnimationFrame(() => el.focus({ preventScroll:true }));
    document.addEventListener('keydown', onEsc);
    // Hide hover ring while opened
    document.body.classList.remove('hovering-paper');
  }
  
  function closePaper(){
    const openEl = document.querySelector('.paper-open');
    if (openEl){
      // [AA-FIX] Remove settled state and re-enable will-change for closing animation
      openEl.classList.remove('paper-open--settled');
      openEl.style.willChange = 'transform';
      
      // animate back to wall
      openEl.style.setProperty('--open-tx','0px');
      openEl.style.setProperty('--open-ty','0px');
      openEl.style.setProperty('--open-scale','1');
      const cleanup = () => {
        openEl.classList.remove('paper-open');
        openEl.removeAttribute('role');
        openEl.removeAttribute('aria-modal');
        openEl.style.position = '';
        openEl.style.left = '';
        openEl.style.top = '';
        openEl.style.width = '';
        openEl.style.height = '';
        openEl.style.willChange = '';
        openEl.style.removeProperty('--open-tx');
        openEl.style.removeProperty('--open-ty');
        openEl.style.removeProperty('--open-scale');
        // restore into original DOM position
        if (openEl.__portal){
          openEl.__portal.parent.insertBefore(openEl, openEl.__portal.placeholder);
          openEl.__portal.placeholder.remove();
          openEl.__portal = null;
        }
        openEl.removeEventListener('transitionend', cleanup);
      };
      openEl.addEventListener('transitionend', cleanup);
    }
    document.body.classList.remove('has-paper-open-global');
    document.removeEventListener('keydown', onEsc);
  }
}

// ───────────────────────── Breathing Ring Around Cursor (paper hover) ─────────────────────────
/**
 * Thin breathing ring around your existing glowing cursor while papers are hoverable
 */
function initPaperHoverRing(){
  const ring = document.getElementById('cursor-ring');
  if (!ring) return;
  
  // Track cursor position smoothly using RAF for 60fps updates
  let currentX = 0, currentY = 0;
  let targetX = 0, targetY = 0;
  let rafId = null;
  
  const updatePosition = () => {
    // Smooth interpolation for buttery movement
    currentX += (targetX - currentX) * 1.0; // 1.0 = instant (no lag)
    currentY += (targetY - currentY) * 1.0;
    
    ring.style.left = currentX + 'px';
    ring.style.top = currentY + 'px';
    
    rafId = requestAnimationFrame(updatePosition);
  };
  
  // Start the animation loop
  updatePosition();
  
  // Update target position on mouse move
  document.addEventListener('mousemove', (e) => {
    targetX = e.clientX;
    targetY = e.clientY;
  }, { passive: true });
  
  // Show ring when hovering clickable papers (not when one is already open)
  const about = document.getElementById('about');
  if (!about) return;
  
  about.addEventListener('mouseenter', (e) => {
    if (e.target.closest('.paper') && !document.body.classList.contains('has-paper-open-global')) {
      document.body.classList.add('hovering-paper');
    }
  }, true);
  
  about.addEventListener('mouseleave', (e) => {
    if (e.target.closest('.paper')) {
      document.body.classList.remove('hovering-paper');
    }
  }, true);
}

// ───────────────────────── Ritual Background (panel mode) ─────────────────────────
var SIGNALS = {
  canvas: null,
  ctx: null,
  raf: 0,
  interval: 0,
  pulses: [],  // moving fronts along edges or radial rays
  spores: [],  // drifting dots
  lastTs: 0
};

function initRitualBackground(){
  // DISABLED FOR PERFORMANCE - No radial rays effect
  return;
}
function createSignalsCanvas(){
  const c = document.createElement('canvas');
  c.id = 'signals-canvas';
  c.className = 'signals-canvas';
  c.setAttribute('aria-hidden','true');
  document.body.appendChild(c);
  return c;
}

function getSigilEl(){
  return document.querySelector('.network-sigil-node, .sigil, #sigil, [data-sigil]') || null;
}
function getSigilCenter(){
  const el = getSigilEl();
  if (!el) return { x: window.innerWidth/2, y: window.innerHeight/2 };
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width/2, y: r.top + r.height/2 };
}

function startRitualBackground(){
  // DISABLED FOR PERFORMANCE - No more radial rays effect
  return;
}

function stopRitualBackground(){
  // DISABLED FOR PERFORMANCE - No cleanup needed
  if (typeof SIGNALS === 'undefined') return;
  const sigil = getSigilEl();
  if (sigil) sigil.classList.remove('sigil-spin', 'sigil-kick');
  if (SIGNALS.interval) { clearInterval(SIGNALS.interval); SIGNALS.interval = 0; }
  if (SIGNALS.raf) { cancelAnimationFrame(SIGNALS.raf); SIGNALS.raf = 0; }
  SIGNALS.pulses.length = 0;
  SIGNALS.spores.length = 0;
  if (SIGNALS.ctx) SIGNALS.ctx.clearRect(0,0,SIGNALS.canvas.width, SIGNALS.canvas.height);
}

// Try to use real graph edges if available; otherwise radial rays fallback
function collectEdges(){
  const candidates = [
    window.MYCELIUM?.links, window.MYCELIUM?.edges,
    window.graph?.links, window.__network?.links, window.NETWORK?.links
  ].find(Boolean);
  const nodes = (window.MYCELIUM?.nodes || window.graph?.nodes || window.__network?.nodes || window.NETWORK?.nodes) || [];
  if (!candidates || !nodes.length) return null;
  const byId = new Map(nodes.map(n => [n.id ?? n.name ?? n.i, n]));
  // Map to screen coords if your renderer maintains node.screenX/Y; else use x/y
  return candidates
    .map(e => {
      const a = byId.get(e.source?.id ?? e.source ?? e.a ?? e.from);
      const b = byId.get(e.target?.id ?? e.target ?? e.b ?? e.to);
      if (!a || !b) return null;
      const ax = a.screenX ?? a.x ?? a.cx ?? a.fx ?? 0;
      const ay = a.screenY ?? a.y ?? a.cy ?? a.fy ?? 0;
      const bx = b.screenX ?? b.x ?? b.cx ?? b.fx ?? 0;
      const by = b.screenY ?? b.y ?? b.cy ?? b.fy ?? 0;
      return { ax, ay, bx, by };
    })
    .filter(Boolean);
}

function triggerLightningBurst(){
  // micro kick on the sigil
  const sigil = getSigilEl();
  if (sigil) {
    sigil.classList.remove('sigil-kick'); // restart animation
    void sigil.offsetWidth;
    sigil.classList.add('sigil-kick');
  }
  const center = getSigilCenter();
  const edges = collectEdges();
  if (edges) {
    // Create a traveling front along every edge outward from center
    // We sort edges by their min distance to center so the cascade looks radial.
    const ranked = edges.map(e => {
      const mx = (e.ax + e.bx)*0.5, my = (e.ay + e.by)*0.5;
      const d = Math.hypot(mx - center.x, my - center.y);
      return { ...e, d };
    }).sort((a,b)=>a.d-b.d);
    const t0 = performance.now()/1000;
    ranked.forEach((e, i) => {
      SIGNALS.pulses.push({
        type: 'edge',
        ax: e.ax, ay: e.ay, bx: e.bx, by: e.by,
        // stagger start by distance for wave effect
        start: t0 + i*0.006,
        speed: 2200,   // px/s of front progression
        life: 0.35     // how long the glow lingers
      });
    });
  } else {
    // Fallback: 180 radial rays (additive)
    const t0 = performance.now()/1000;
    for (let i=0;i<180;i++){
      const a = (i/180)*Math.PI*2;
      const r = Math.max(window.innerWidth, window.innerHeight) * 0.66;
      SIGNALS.pulses.push({
        type: 'ray',
        x: center.x, y: center.y,
        tx: center.x + Math.cos(a)*r,
        ty: center.y + Math.sin(a)*r,
        start: t0 + i*0.0025,
        speed: 2600,
        life: 0.28
      });
    }
  }
  // Spawn spores peeling off the sigil
  for (let i=0;i<24;i++){
    const ang = Math.random()*Math.PI*2;
    const v = 30 + Math.random()*90; // px/s
    SIGNALS.spores.push({
      x: center.x, y: center.y,
      vx: Math.cos(ang)*v, vy: Math.sin(ang)*v,
      t: 0, life: 1.4 + Math.random()*0.6
    });
  }
}

function renderSignals(dt){
  const ctx = SIGNALS.ctx; if (!ctx) return;
  const w = SIGNALS.canvas.clientWidth, h = SIGNALS.canvas.clientHeight;
  // Fade trail (additive-soft persistence)
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgba(0,0,0,0.20)';
  ctx.fillRect(0,0,w,h);

  // Draw pulses
  ctx.globalCompositeOperation = 'lighter';
  const now = performance.now()/1000;
  const pulses = SIGNALS.pulses;
  for (let i=pulses.length-1; i>=0; i--){
    const p = pulses[i];
    const age = now - p.start;
    if (age < 0) continue;
    if (age > p.life + 0.6) { pulses.splice(i,1); continue; }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (p.type === 'edge'){
      // front progress [0..1]
      const segLen = Math.hypot(p.bx - p.ax, p.by - p.ay);
      const prog = Math.min(1, (age * p.speed) / segLen);
      const bx = p.ax + (p.bx - p.ax)*prog;
      const by = p.ay + (p.by - p.ay)*prog;
      const glow = Math.max(0, 1 - (age / (p.life+0.0001)));
      ctx.strokeStyle = `rgba(45,212,175,${0.75*glow})`;
      ctx.lineWidth = 2.0;
      ctx.beginPath(); ctx.moveTo(p.ax, p.ay); ctx.lineTo(bx, by); ctx.stroke();
      // white-hot core
      ctx.strokeStyle = `rgba(255,255,255,${0.25*glow})`; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(p.ax, p.ay); ctx.lineTo(bx, by); ctx.stroke();
    } else { // ray
      const segLen = Math.hypot(p.tx - p.x, p.ty - p.y);
      const prog = Math.min(1, (age * p.speed) / segLen);
      const bx = p.x + (p.tx - p.x)*prog;
      const by = p.y + (p.ty - p.y)*prog;
      const glow = Math.max(0, 1 - (age / (p.life+0.0001)));
      ctx.strokeStyle = `rgba(45,212,175,${0.7*glow})`;
      ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(bx, by); ctx.stroke();
      ctx.strokeStyle = `rgba(255,255,255,${0.22*glow})`; ctx.lineWidth = 0.9;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(bx, by); ctx.stroke();
    }
  }

  // Draw spores
  const spores = SIGNALS.spores;
  for (let i=spores.length-1; i>=0; i--){
    const s = spores[i];
    s.t += dt; if (s.t > s.life) { spores.splice(i,1); continue; }
    s.x += s.vx*dt; s.y += s.vy*dt;
    const fade = 1 - (s.t / s.life);
    ctx.fillStyle = `rgba(45,212,175,${0.9*fade})`;
    ctx.beginPath(); ctx.arc(s.x, s.y, 1.2 + (1.6*fade), 0, Math.PI*2); ctx.fill();
    // rare ember flickers
    if (Math.random() < 0.03){
      ctx.fillStyle = `rgba(255,122,51,${0.6*fade})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, 1.0, 0, Math.PI*2); ctx.fill();
    }
  }
}
