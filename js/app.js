/* Necrography — Vissarion Zounarakis
 * Navigation system with mycelium background and spark animations
 */

// Signal to inline bootstrap that the ES-module loaded successfully
window.__appBooted = true;
document.documentElement.classList.add('js-ready');

import { sizeCanvas, cumulativeLengths, throttle } from './utils.js';
import { buildGraphFromPaths, aStarPath } from './graph.js';
import socialIconsAnimation from './social-icons-animation.js';
import { initHubToIcons } from './hub-to-icons.js';
import { NAV_COORDS } from './config.js';
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
  setRitualActive,
  setFollowerSparks,
  LOCKED_ROUTES,
  NODE_IDS,
  sparkCanvas,
  sparkCtx,
  sporeCanvas,
  sporeCtx,
  setSparkCanvas,
  setSparkCtx,
  setSporeCtx,
  ACTIVE_ANIMS,
  spores,
  lastSporeFrame,
  lastSparkTs,
  setActiveAnims,
  setSpores,
  setLastSporeFrame,
  setLastSparkTs
} from './state.js';
import {
  computeCoverFromImage,
  toViewport,
  toImg,
  projectXY
} from './viewport.js';
import {
  startSpark,
  drawSparks,
  startSparkToPoint,
  computeRouteVp
} from './sparks.js';
import {
  computeNavOffsets,
  showSection,
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
import { portraitParticles } from './portrait-particles.js';
import {
  getGraphicsBudget,
  initGraphicsGovernor,
  markGraphicsActivity,
  setGraphicsSection
} from './graphics-governor.js';

initGraphicsGovernor();

const markUserGraphicsActivity = throttle((reason) => {
  markGraphicsActivity(reason, 700);
}, 120);

function initGraphicsActivityListeners() {
  const passive = { passive: true };

  window.addEventListener('wheel', () => markUserGraphicsActivity('wheel'), passive);
  window.addEventListener('scroll', () => markUserGraphicsActivity('scroll'), passive);
  window.addEventListener('touchmove', () => markUserGraphicsActivity('touchmove'), passive);
  window.addEventListener('pointerdown', () => markGraphicsActivity('pointerdown', 500), passive);
  window.addEventListener('pointermove', (event) => {
    if (event.buttons) markUserGraphicsActivity('pointerdrag');
  }, passive);
}

initGraphicsActivityListeners();

// Mycelium geometry (exported from Python)
let myceliumReadyPromise = null;
let navStreamsWired = false;
let blogNetworkModulePromise = null;
let workGlobeModulePromise = null;
let nowCardsModulePromise = null;

function ensureSectionModule(sectionName) {
  if (sectionName === 'blog' && !blogNetworkModulePromise) {
    blogNetworkModulePromise = import('./blog-network-webgl.js').catch((err) => {
      blogNetworkModulePromise = null;
      console.warn('⚠️ blog network module unavailable:', err);
    });
  }

  if (sectionName === 'work' && !workGlobeModulePromise) {
    workGlobeModulePromise = import('./work-globe-webgl.js').catch((err) => {
      workGlobeModulePromise = null;
      console.warn('⚠️ work globe module unavailable:', err);
    });
  }

  if (sectionName === 'now' && !nowCardsModulePromise) {
    nowCardsModulePromise = import('./now-cards.js').catch((err) => {
      nowCardsModulePromise = null;
      console.warn('⚠️ now cards module unavailable:', err);
    });
  }
}

async function loadMycelium() {
  if (MYC_MAP) return MYC_MAP;
  const response = await fetch('artifacts/network-lite.json');
  const data = await response.json();
  setMycMap(data);
  return data;
}

function ensureMyceliumReady() {
  if (GRAPH) return Promise.resolve(true);
  if (!myceliumReadyPromise) {
    myceliumReadyPromise = (async () => {
      await loadMycelium();
      await initNetworkAndNav();
      return true;
    })().catch((err) => {
      myceliumReadyPromise = null;
      console.warn('⚠️ network-lite.json unavailable:', err);
      return false;
    });
  }
  return myceliumReadyPromise;
}

// HUD rendering
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

// HUD: white anchor, cyan route, green live position
function renderHUD() {
  if (!hudEnabled) return;
  if (!hudCtx) initHUD();

  hudCtx.clearRect(0, 0, hudCanvas.width, hudCanvas.height);

  for (const [id, pt] of Object.entries(NAV_COORDS)) {
    const [tx, ty] = toViewport(pt.x, pt.y);
    
    hudCtx.fillStyle = '#fff';
    hudCtx.beginPath();
    hudCtx.arc(tx, ty, 4, 0, Math.PI * 2);
    hudCtx.fill();
    
    hudCtx.fillStyle = '#fff';
    hudCtx.font = '10px monospace';
    hudCtx.fillText(`${id} anchor`, tx + 8, ty - 8);

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

// Canvas init
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

// Pre-rendered spore glow sprite — avoids expensive runtime shadowBlur
const _SPORE_GLOW_SIZE = 32;
const _sporeGlowCanvas = document.createElement('canvas');
_sporeGlowCanvas.width = _SPORE_GLOW_SIZE;
_sporeGlowCanvas.height = _SPORE_GLOW_SIZE;
const _sgCtx = _sporeGlowCanvas.getContext('2d');
const _sgGrad = _sgCtx.createRadialGradient(_SPORE_GLOW_SIZE/2, _SPORE_GLOW_SIZE/2, 0, _SPORE_GLOW_SIZE/2, _SPORE_GLOW_SIZE/2, _SPORE_GLOW_SIZE/2);
_sgGrad.addColorStop(0, 'rgba(200,255,220,1)');
_sgGrad.addColorStop(0.25, 'rgba(122,174,138,0.7)');
_sgGrad.addColorStop(0.6, 'rgba(122,174,138,0.2)');
_sgGrad.addColorStop(1, 'rgba(122,174,138,0)');
_sgCtx.fillStyle = _sgGrad;
_sgCtx.fillRect(0, 0, _SPORE_GLOW_SIZE, _SPORE_GLOW_SIZE);

// Spark animation loop — only runs when intro is active
let _sparkRafId = null;
let _sporeRafId = null;
function sparkLoopWrapper(ts) {
  const dt = Math.min(0.05, (ts - lastSparkTs) / 1000);
  setLastSparkTs(ts);

  // Only run sparks/labels when intro section is active
  const introActive = _introStage?.classList.contains('active-section');
  if (introActive && !document.hidden) {
    updateMovingLabels(dt, pointAtRoute);
    drawSparks(dt, pointAtRoute);
    _sparkRafId = requestAnimationFrame(sparkLoopWrapper);
  } else {
    // Clear canvases and stop the loop
    releaseCanvasBacking(sparkCanvas, sparkCtx);
    _sparkRafId = null;
  }
}
function ensureSparkLoop() {
  if (_sparkRafId == null) {
    setLastSparkTs(performance.now());
    _sparkRafId = requestAnimationFrame(sparkLoopWrapper);
  }
}
// Cache the intro stage element to avoid DOM queries every frame
const _introStage = document.querySelector('.stage[data-section="intro"]');

function isIntroSectionActive() {
  return _introStage?.classList.contains('active-section');
}

function releaseCanvasBacking(canvas, ctx) {
  if (!canvas) return;
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  if (canvas.width !== 1 || canvas.height !== 1) {
    canvas.width = 1;
    canvas.height = 1;
  }
}

function releaseIntroCanvasBuffers() {
  releaseCanvasBacking(sparkCanvas, sparkCtx);
  releaseCanvasBacking(sporeCanvas, sporeCtx);
  setSpores([]);
  setLastSporeFrame(0);
}

function releaseInactiveFeatureCanvasBuffers(activeSectionName) {
  if (activeSectionName !== 'work') {
    releaseCanvasBacking(document.getElementById('work-globe-canvas'), null);
  }
  if (activeSectionName !== 'blog') {
    releaseCanvasBacking(document.getElementById('blog-network-canvas'), null);
  }
}

function restoreIntroCanvasBuffers() {
  if (!COVER.ready) return;
  sizeCanvas(sparkCanvas, { systemName: 'intro-sparks' });
  sizeCanvas(sporeCanvas, { systemName: 'intro-spores' });
  if (sporeCtx) createSpores();
}

function resizeAll() {
  if (!COVER.ready) return; // Don't resize until image is loaded
  computeCoverFromImage();
  if (isIntroSectionActive()) {
    restoreIntroCanvasBuffers();
  } else {
    releaseIntroCanvasBuffers();
  }
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

// Reproject routes on resize
  for (const [id, route] of Object.entries(LOCKED_ROUTES)) {
    const projPts = projectXY(route.imgPts);
    const cum = cumulativeLengths(projPts);
    const len = cum[cum.length - 1];
    
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

}

// Init after background loads
function initAfterImageLoad() {
  if (!bgImg) {
    console.error('❌ bgImg element not found!');
    return;
  }
  
  // Compute cover using naturalWidth/naturalHeight
  if (!computeCoverFromImage()) {
    console.error('❌ Failed to compute cover from image');
    return;
  }
  
  computeNavOffsets(); // Compute offsets with proper base dimensions
  
  layoutNavNodes(wireSigilToggle, renderHUD, showSectionWithEffects);
  wireNavigationStreams();

  if (isIntroSectionActive()) {
    restoreIntroCanvasBuffers();
    ensureSparkLoop();
    startSpores();
  } else {
    releaseIntroCanvasBuffers();
  }
}

// Gate init on image load
if (bgImg) {
  if (!bgImg.complete) {
    bgImg.addEventListener('load', initAfterImageLoad, { once: true });
  } else if (bgImg.naturalWidth > 0) {
    initAfterImageLoad();
  } else {
    console.warn('⚠️ Background image complete but no naturalWidth, waiting for load event');
    bgImg.addEventListener('load', initAfterImageLoad, { once: true });
  }
} else {
  console.error('❌ #bg-front-img element not found in DOM');
}

// Throttled resize
const resizeAllThrottled = throttle(resizeAll, 150);
window.addEventListener('resize', resizeAllThrottled, { passive: true });
window.addEventListener('orientationchange', resizeAllThrottled, { passive: true });

// Ritual toggle (sigil)
function toggleRitualFromSigil(el){
  setRitualActive(!ritualActive);
  if (!GRAPH) {
    void ensureMyceliumReady().then((ready) => {
      if (ready && ritualActive) {
        startRitualMotion();
        layoutNavNodes(wireSigilToggle, renderHUD, showSectionWithEffects);
        ritualCatchUp();
      }
    });
  }
  
  const img = el.querySelector('img#sigil');
  if (img) {
    img.style.transform = `rotate(${ritualActive ? 180 : 0}deg)`;
    img.style.transition = 'transform 0.5s cubic-bezier(0.16, 1, 0.3, 1)';
  } else {
    console.warn('⚠️ img#sigil not found in sigil node');
  }

  const r = el.getBoundingClientRect();
  simpleParticles(r.left + r.width/2, r.top + r.height/2);

  if (ritualActive){
    startRitualMotion();
    attachFollowerSparks();
  } else {
    stopRitualMotion();
    detachFollowerSparks();
    sendLightningHome(); // one quick, zippy home ping per nav
  }
  
  layoutNavNodes(wireSigilToggle, renderHUD, showSectionWithEffects);
}

function wireSigilToggle(){
  const sigil = document.querySelector('.network-sigil-node');
  const sigilImg = sigil ? sigil.querySelector('img#sigil') : null;
  
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
  // Reset routes to home position
  for (const route of Object.values(LOCKED_ROUTES)){
    if (!route) continue;
    route.s = route.sHome;
  }
}

// Ambient spores

function createSpores() {
  if (!sporeCanvas || !sporeCtx) return;
  const budget = getGraphicsBudget('intro-spores');
  if (budget.quiet || budget.particleScale <= 0) {
    setSpores([]);
    setLastSporeFrame(0);
    sporeCtx.clearRect(0, 0, sporeCanvas.width, sporeCanvas.height);
    return;
  }
  const cssW = window.innerWidth;
  const cssH = window.innerHeight;
  const count = Math.max(8, Math.round((cssW < 768 ? 30 : 50) * budget.particleScale));
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
  const budget = getGraphicsBudget('intro-spores');
  if (budget.quiet || spores.length === 0) return;
  const frameInterval = Math.max(33, budget.frameIntervalMs || 33);
  if (ts - lastSporeFrame < frameInterval) return;
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

    // Use pre-rendered glow sprite instead of shadowBlur
    const glowDiam = radius * 6; // Sprite covers glow area
    c.globalAlpha = s.a * pulse;
    c.drawImage(_sporeGlowCanvas, s.x - glowDiam / 2, s.y - glowDiam / 2, glowDiam, glowDiam);

    // Bright core dot
    c.globalAlpha = s.a * pulse * 0.8;
    c.fillStyle = 'rgba(200,255,220,1)';
    c.beginPath();
    c.arc(s.x, s.y, radius * 0.4, 0, Math.PI * 2);
    c.fill();

    c.globalAlpha = 1;
  }
}

function startSpores() {
  if (!sporeCanvas || prefersReducedMotion) return;
  const budget = getGraphicsBudget('intro-spores');
  if (budget.quiet || budget.particleScale <= 0) return;
  if (!sporeCtx) setSporeCtx(sporeCanvas.getContext('2d'));
  if (!sporeCtx) return;
  createSpores();

  function loop(ts) {
    const introActive = _introStage?.classList.contains('active-section');
    if (!introActive || document.hidden) {
      // Clear and stop loop — will restart when section becomes active
      releaseCanvasBacking(sporeCanvas, sporeCtx);
      _sporeRafId = null;
      return;
    }
    drawSpores(ts);
    _sporeRafId = requestAnimationFrame(loop);
  }

  _sporeRafId = requestAnimationFrame(loop);
}
function ensureSporeLoop() {
  if (_sporeRafId == null && !prefersReducedMotion && sporeCanvas) {
    _sporeRafId = requestAnimationFrame(function loop(ts) {
      const introActive = _introStage?.classList.contains('active-section');
      if (!introActive || document.hidden) {
        releaseCanvasBacking(sporeCanvas, sporeCtx);
        _sporeRafId = null;
        return;
      }
      drawSpores(ts);
      _sporeRafId = requestAnimationFrame(loop);
    });
  }
}

function nearestNodeId(pt) {
  if (!GRAPH) return -1;
  return GRAPH.nearestId(pt.x, pt.y, 96, 24);
}

// Label motion along locked routes

// Resample polyline to uniform spacing
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
  
  const last = pts[pts.length - 1];
  if (resampled[resampled.length - 1] !== last) {
    resampled.push(last);
  }
  
  return resampled;
}

// Project point onto polyline and return arc length
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

// Slice polyline by arc length window
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
    
    if (segEnd >= sStart && cumS <= sEnd) {
      if (result.length === 0 && cumS < sStart) {
        const t = (sStart - cumS) / segLen;
        result.push([
          x1 + (x0 - x1) * t,
          y1 + (y0 - y1) * t
        ]);
      }
      
      if (cumS >= sStart && cumS <= sEnd) {
        result.push([x0, y0]);
      }
      
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

// Send sparks to current label positions
function ritualCatchUp() {
  if (prefersReducedMotion) return;
  
  let delay = 0;
  for (const id of Object.keys(LOCKED_ROUTES)) {
    const route = LOCKED_ROUTES[id];
    if (!route) continue;
    
    const imgPoint = imgPointAtRoute(route, route.s);
    if (!imgPoint) continue;

    const [imgX, imgY] = imgPoint;
    
    setTimeout(() => {
      startSparkToPoint('intro', imgX, imgY, 750);
    }, delay);
    
    delay += 60 + Math.random() * 40;
  }
}

// Init network and navigation
async function initNetworkAndNav() {
  if (!MYC_MAP) return;

  setGraph(buildGraphFromPaths(MYC_MAP.paths));
  computeNavOffsets();
  PATH_CACHE.clear();

  for (const [id, pt] of Object.entries(NAV_COORDS)) {
    NODE_IDS[id] = GRAPH.nearestId(pt.x, pt.y, 80, 24);
  }

  const introId = NODE_IDS.intro;
  if (introId != null && introId >= 0) {
    for (const [id, gid] of Object.entries(NODE_IDS)) {
      if (id === 'intro' || gid == null || gid < 0) continue;
      aStarPath(introId, gid, GRAPH, PATH_CACHE);
      aStarPath(gid, introId, GRAPH, PATH_CACHE);
    }
  }

  // Lock each label to a single polyline
  buildLockedRoutes();

  layoutNavNodes(wireSigilToggle, renderHUD, showSectionWithEffects);
}

// Blog hub controls
function initBlogControls() {
  populateBlogCounts();
  
  const hubButtons = document.querySelectorAll('.hub-btn');
  
  let lastButtonClickTime = 0;
  const BUTTON_DEBOUNCE = 300; // ms
  
  hubButtons.forEach(btn => {
    const hubId = btn.dataset.hub;
    
    btn.addEventListener('mouseenter', () => {
      window.dispatchEvent(new CustomEvent('blog:hover', { detail: { hubId, source: 'menu' } }));
    });
    
    btn.addEventListener('mouseleave', () => {
      window.dispatchEvent(new CustomEvent('blog:hover-off', { detail: { hubId } }));
    });
    
    btn.addEventListener('focus', () => {
      window.dispatchEvent(new CustomEvent('blog:hover', { detail: { hubId, source: 'menu' } }));
    });
    
    btn.addEventListener('blur', () => {
      window.dispatchEvent(new CustomEvent('blog:hover-off', { detail: { hubId } }));
    });
    
    const activateHub = () => {
      const now = performance.now();
      if (now - lastButtonClickTime < BUTTON_DEBOUNCE) {
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
  
  window.addEventListener('blog:navigate', (e) => {
    const { hubId } = e.detail;
    if (hubId) {
      enterHub(hubId);
    }
  });
  
  document.addEventListener('mouseover', (e) => {
    const arcBtn = e.target.closest('.arc-btn');
    if (arcBtn && arcBtn.dataset.hub) {
      const hubId = arcBtn.dataset.hub;
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
  
  // Sync arc-btn highlight when hub points are hovered (bidirectional)
  window.addEventListener('blog:hover', (e) => {
    const { hubId, source } = e.detail;
    if (source === 'hub-point' && hubId) {
      const arcBtn = document.querySelector(`.arc-btn[data-hub="${hubId}"]`);
      if (arcBtn) arcBtn.classList.add('hovered');
    }
  });
  
  window.addEventListener('blog:hover-off', (e) => {
    const { hubId, source } = e.detail;
    if (source === 'hub-point' && hubId) {
      const arcBtn = document.querySelector(`.arc-btn[data-hub="${hubId}"]`);
      if (arcBtn) arcBtn.classList.remove('hovered');
    }
  });
  
  document.addEventListener('click', (e) => {
    const arcBtn = e.target.closest('.arc-btn');
    if (arcBtn && arcBtn.dataset.hub) {
      const hubId = arcBtn.dataset.hub;
      enterHub(hubId);
    }
  });
  
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      const arcBtn = e.target.closest('.arc-btn');
      if (arcBtn && arcBtn.dataset.hub) {
        e.preventDefault();
        const hubId = arcBtn.dataset.hub;
        enterHub(hubId);
      }
    }
  });
  
  const btnMap = document.getElementById('btn-map');
  if (btnMap) {
    btnMap.addEventListener('click', () => {
      exitToMap();
    });
  }
  
  const hubStatus = document.getElementById('hub-status');
  const HUB_INFO = {
    craft: { title: 'CRAFT', desc: 'Tools, code, and making by hand' },
    cosmos: { title: 'COSMOS', desc: 'Systems, networks, and emergence' },
    codex: { title: 'CODEX', desc: 'Engineering notes and debugging journals' },
    convergence: { title: 'CONVERGENCE', desc: 'Where disciplines meet' }
  };
  
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
      
      tooltipTitle.textContent = info.title;
      tooltipDesc.textContent = info.desc;
      tooltip.classList.add('visible');
    }
  });
  
  window.addEventListener('blog:hover-off', () => {
    if (hubStatus) {
      hubStatus.textContent = '';
    }
    tooltip.classList.remove('visible');
  });
}

// Blog category and article navigation

function updateBlogNavActive(hubId) {
  document.querySelectorAll('.blog-nav-link').forEach(link => {
    if (link.dataset.hub === hubId) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });
}

let pendingBlogHashTimer = null;

function clearPendingBlogHashAction() {
  if (pendingBlogHashTimer) {
    clearTimeout(pendingBlogHashTimer);
    pendingBlogHashTimer = null;
  }
}

function scheduleBlogHashAction(action) {
  clearPendingBlogHashAction();
  pendingBlogHashTimer = setTimeout(() => {
    pendingBlogHashTimer = null;
    action();
  }, 100);
}

function enterHub(hubId) {
  if (!hubId || hubId === 'source') {
    return;
  }
  
  const blogSection = document.getElementById('blog');
  if (blogSection) {
    blogSection.dataset.mode = 'category';
    blogSection.classList.add('in-category'); // Legacy support
  }
  
  const dishLabels = document.getElementById('dish-labels');
  if (dishLabels) {
    dishLabels.style.display = 'none';
  }
  
  updateBlogNavActive(hubId);
  
  const categoryView = document.getElementById('blog-category-view');
  if (categoryView) {
    categoryView.setAttribute('data-category', hubId);
    categoryView.removeAttribute('hidden');
    loadCategoryContent(hubId);
  }
  
  history.pushState({ view: 'category', hubId }, '', `#blog/${hubId}`);
}

function resetBlogMapState({ updateHistory = false } = {}) {
  clearPendingBlogHashAction();

  const blogSection = document.getElementById('blog');
  if (blogSection) {
    blogSection.dataset.mode = 'map';
    blogSection.classList.remove('in-category');
  }
  
  const dishLabels = document.getElementById('dish-labels');
  if (dishLabels) {
    dishLabels.style.display = '';
  }
  
  updateBlogNavActive(null);
  
  const categoryView = document.getElementById('blog-category-view');
  const articleView = document.getElementById('blog-article-view');
  if (categoryView) categoryView.setAttribute('hidden', '');
  if (articleView) articleView.setAttribute('hidden', '');

  if (updateHistory) {
    history.pushState({ view: 'map' }, '', '#blog');
  }
}

function exitToMap() {
  resetBlogMapState({ updateHistory: true });
}

function enterBlogCategory(hubId) { return enterHub(hubId); }
function exitBlogCategory() { return exitToMap(); }

let ARTICLES_REGISTRY = null;

async function loadArticlesRegistry() {
  if (ARTICLES_REGISTRY) return ARTICLES_REGISTRY;
  
  try {
    const res = await fetch('./blog/articles.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    ARTICLES_REGISTRY = await res.json();
    return ARTICLES_REGISTRY;
  } catch (err) {
    console.warn('[Blog] Could not load articles.json, using fallback:', err.message);
    ARTICLES_REGISTRY = { craft: [], cosmos: [], codex: [], convergence: [] };
    return ARTICLES_REGISTRY;
  }
}

async function populateBlogCounts() {
  const registry = await loadArticlesRegistry();
  const hubs = ['craft', 'cosmos', 'codex', 'convergence'];
  
  hubs.forEach(hub => {
    const count = (registry[hub] || []).length;
    const countText = count > 0 ? `(${count})` : '';
    
    const memoCount = document.querySelector(`.blog-memo-count[data-hub="${hub}"]`);
    if (memoCount) memoCount.textContent = countText;
    
    const specCount = document.querySelector(`.specimen-count[data-hub="${hub}"]`);
    if (specCount) specCount.textContent = countText;
  });
}

async function loadCategoryContent(hubId) {
  const content = document.getElementById('blog-category-content');
  const titleEl = document.getElementById('blog-category-title');
  if (!content) return;
  
  const registry = await loadArticlesRegistry();
  const articles = registry[hubId] || [];
  const hubTitle = hubId.toUpperCase();
  
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
  
  content.querySelectorAll('.blog-article-item').forEach(item => {
    const articleId = item.dataset.article;
    const activateArticle = () => {
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

// Article scroll navigation
function initArticleScrollNav() {
  const scrollNav = document.querySelector('.article-scroll-nav');
  if (!scrollNav) return;
  
  const articleView = document.getElementById('blog-article-view');
  const articleContent = document.getElementById('blog-article-content');
  if (!articleView || !articleContent) return;
  
  const SCROLL_AMOUNT = 300; // ~10 lines
  const THRESHOLD = 400; // ~15 lines - show/hide threshold
  
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
  
  const updateScrollNav = () => {
    const isArticleVisible = !articleView.hidden && articleView.offsetParent !== null;
    if (!isArticleVisible) {
      scrollNav.classList.remove('visible');
      return;
    }
    
    const scrollTop = articleView.scrollTop;
    const scrollHeight = articleView.scrollHeight;
    const clientHeight = articleView.clientHeight;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    
    const pastTop = scrollTop > THRESHOLD;
    const beforeEnd = distanceFromBottom > THRESHOLD;
    const shouldShow = pastTop && beforeEnd;
    
    scrollNav.classList.toggle('visible', shouldShow);
  };
  
  articleView.addEventListener('scroll', updateScrollNav);
  
  const observer = new MutationObserver(() => {
    if (!articleView.hidden) {
      articleView.scrollTop = 0;
    }
    updateScrollNav();
  });
  observer.observe(articleView, { attributes: true, attributeFilter: ['hidden'] });
  
  updateScrollNav();
}

function enterBlogArticle(hubId, articleId) {
  const categoryView = document.getElementById('blog-category-view');
  if (categoryView) {
    categoryView.setAttribute('hidden', '');
  }
  
  updateBlogNavActive(hubId);
  
  const articleView = document.getElementById('blog-article-view');
  if (articleView) {
    articleView.removeAttribute('hidden');
    loadArticleContent(hubId, articleId);
  }
  
  history.pushState({ view: 'article', hubId, articleId }, '', `#blog/${hubId}/${articleId}`);
}

function exitBlogArticle() {
  document.getElementById('blog-category-view')?.removeAttribute('hidden');
  
  document.getElementById('blog-article-view')?.setAttribute('hidden', '');
  
  const categoryView = document.getElementById('blog-category-view');
  if (categoryView) {
    const hubId = history.state?.hubId || 'craft';
    history.pushState({ view: 'category', hubId }, '', `#blog/${hubId}`);
  }
}

function loadArticleContent(hubId, articleId) {
  const content = document.getElementById('blog-article-content');
  if (!content) return;
  
  const path = `./blog/${hubId}/${articleId}.html`;
  
  fetch(path)
    .then(res => {
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      return res.text();
    })
    .then(html => {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const article = doc.querySelector('.article-container');
      if (article) {
        content.innerHTML = article.innerHTML;
        
        setupArticleNavigation(content, hubId);
      } else {
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

function setupArticleNavigation(container, hubId) {
  const breadcrumbLinks = container.querySelectorAll('.breadcrumb a');
  breadcrumbLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const href = link.getAttribute('href');
      
      if (href.includes('#blog?hub=') || href.includes('#blog/')) {
        exitBlogArticle();
      } else if (href.includes('#blog')) {
        exitToMap();
      }
    });
  });
  
  const backButton = container.querySelector('.back-button');
  if (backButton) {
    backButton.addEventListener('click', (e) => {
      e.preventDefault();
      exitBlogArticle();
    });
  }
}

// Section visibility with effects
function showSectionWithEffects(sectionName, options = {}) {
  setGraphicsSection(sectionName);
  markGraphicsActivity('section-transition', 900);
  showSection(sectionName, startRitualBackground, stopRitualBackground, options);
  releaseInactiveFeatureCanvasBuffers(sectionName);
  ensureSectionModule(sectionName);
  
  const isBlogVisible = sectionName === 'blog';
  if (isBlogVisible) {
    resetBlogMapState();
  }

  window.dispatchEvent(new CustomEvent('blog:visible', {
    detail: { visible: isBlogVisible }
  }));

  // Restart intro-only loops when navigating back to intro
  if (sectionName === 'intro') {
    restoreIntroCanvasBuffers();
    ensureSparkLoop();
    ensureSporeLoop();
  } else {
    releaseIntroCanvasBuffers();
  }
}

function startStream(targetVpX, targetVpY) {
  const budget = getGraphicsBudget('portrait-particles');
  if (!budget.allowPortraitStreaming) {
    portraitParticles?.clearStream?.();
    return;
  }

  portraitParticles?.setStreamTargetVp?.(targetVpX, targetVpY);
}

function stopStream() {
  portraitParticles?.clearStream?.();
}

function wireNavigationStreams() {
  if (navStreamsWired) return;
  const nav = document.getElementById('network-nav');
  if (!nav) return;

  const navNodes = nav.querySelectorAll('.network-node-label, .network-sigil-node');
  if (!navNodes.length) return;

  navStreamsWired = true;
  navNodes.forEach(el => {
    const id = el.dataset.node;
    const runNavEnter = () => {
      if (!id) return;
      if (GRAPH || prefersReducedMotion) {
        handleNavEnter(id, el, startSpark, startSparkToPoint, pointAtRoute);
        return;
      }

      void ensureMyceliumReady().then((ready) => {
        if (!ready) return;
        if (el.matches(':hover') || document.activeElement === el) {
          handleNavEnter(id, el, startSpark, startSparkToPoint, pointAtRoute);
        }
      });
    };

    const runStream = () => {
      const rect = el.getBoundingClientRect();
      const vpX = rect.left + rect.width / 2;
      const vpY = rect.top + rect.height / 2;
      startStream(vpX, vpY);
    };

    el.addEventListener('pointerenter', () => {
      runNavEnter();
      runStream();
    });

    el.addEventListener('pointerleave', () => {
      handleNavLeave(id, el);
      stopStream();
    });

    el.addEventListener('focus', () => {
      runNavEnter();
      runStream();
    });

    el.addEventListener('blur', () => {
      handleNavLeave(id, el);
      stopStream();
    });
  });
}

window.addEventListener('DOMContentLoaded', async () => {
  wireNavigationStreams();

  // Social icons: stream on hover
  const socialIcons = document.querySelectorAll('.living-sigils .sigil-vial');
  socialIcons.forEach(icon => {
    icon.addEventListener('pointerenter', () => {
      if (!GRAPH) void ensureMyceliumReady();
      const rect = icon.getBoundingClientRect();
      const vpX = rect.left + rect.width / 2;
      const vpY = rect.top + rect.height / 2;
      startStream(vpX, vpY);
    });
    
    icon.addEventListener('pointerleave', () => {
      stopStream();
    });
  });

  if (location.hash && location.hash !== '#intro') {
    void ensureMyceliumReady();
  }

  const hash = window.location.hash.slice(1);
  
  if (hash.startsWith('blog/')) {
    const parts = hash.split('/');
    const hubId = parts[1];
    const articleId = parts[2];
    
    showSectionWithEffects('blog');
    
    if (articleId) {
      scheduleBlogHashAction(() => enterBlogArticle(hubId, articleId));
    } else if (hubId) {
      scheduleBlogHashAction(() => enterHub(hubId));
    }
  } else {
    const validSections = ['intro', 'about', 'work', 'contact', 'blog', 'skills', 'now'];
    const initialSection = validSections.includes(hash) ? hash : 'intro';
    showSectionWithEffects(initialSection);
  }

  if (hudEnabled) {
    initHUD();
    renderHUD();
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'H') toggleHUD();
    
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

  initRitualBackground();

  notebookContact.init();

  socialIconsAnimation.init();

  const contactSection = document.getElementById('contact');
  if (contactSection) {
    contactSection.addEventListener('click', (e) => {
      if (e.target === contactSection) {
        showSectionWithEffects('intro', { historyMode: 'push' });
      }
    });
  }
  
  initBlogControls();
  
  document.getElementById('btn-map-category')?.addEventListener('click', exitToMap);
  document.getElementById('btn-map-article')?.addEventListener('click', exitToMap);
  
  document.querySelectorAll('.blog-nav-link').forEach(link => {
    link.addEventListener('click', () => {
      const hubId = link.dataset.hub;
      if (hubId === 'map') {
        exitToMap();
      } else {
        enterHub(hubId);
      }
    });
  });
  
  initArticleScrollNav();
});

// Mobile menu
const sigilBtn = document.getElementById('myco-sigil-btn');
const menuDlg  = document.getElementById('necro-menu');

if (sigilBtn && menuDlg && typeof menuDlg.showModal === 'function') {
  sigilBtn.addEventListener('click', () => {
    menuDlg.showModal();
    sigilBtn.setAttribute('aria-expanded', 'true');
  });

  menuDlg.addEventListener('click', (e) => {
    if (e.target === menuDlg) menuDlg.close();
  });
  menuDlg.querySelector('[data-close]')?.addEventListener('click', () => menuDlg.close());
  menuDlg.addEventListener('close', () => sigilBtn.setAttribute('aria-expanded','false'));

  menuDlg.querySelectorAll('[data-nav-open]').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const section = a.getAttribute('data-nav-open');
      document.dispatchEvent(new CustomEvent('open-section', { detail: section }));
      if (section) location.hash = section;
      menuDlg.close();
    });
  });
}

// Post-load layout
window.addEventListener('load', () => {
  if (COVER.ready) {
    computeCoverFromImage();
    computeNavOffsets();
    layoutNavNodes(wireSigilToggle, renderHUD, showSectionWithEffects);
    if (hudEnabled) renderHUD();
  }
  
  initHubToIcons();
});

// Glitch text effect
const glitchElements = document.querySelectorAll('.glitch-text');
glitchElements.forEach(el => {
  el.setAttribute('data-text', el.textContent);
});

// Simple particle effect
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
    
    requestAnimationFrame(() => {
      particle.style.transform = `translate(${Math.cos(angle) * distance}px, ${Math.sin(angle) * distance}px)`;
      particle.style.opacity = '0';
    });
  }
  
  setTimeout(() => layer.remove(), 600);
}

// Debug helper (console command)
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

// Hash change (back/forward)
window.addEventListener('hashchange', () => {
  const hash = window.location.hash.slice(1);
  
  if (hash.startsWith('blog/')) {
    const parts = hash.split('/');
    const hubId = parts[1]; // craft, cosmos, convergence, codex
    const articleId = parts[2]; // optional article slug
    
    showSectionWithEffects('blog');
    
    if (articleId) {
      scheduleBlogHashAction(() => enterBlogArticle(hubId, articleId));
    } else if (hubId) {
      scheduleBlogHashAction(() => enterHub(hubId));
    }
    return;
  }
  
  const validSections = ['intro', 'about', 'work', 'contact', 'blog', 'skills', 'now'];
  if (validSections.includes(hash)) {
    showSectionWithEffects(hash, { historyMode: 'none' });
  } else if (!hash) {
    showSectionWithEffects('intro', { historyMode: 'none' });
  } else {
    showSectionWithEffects('intro');
  }
});

// Back button (altar screens)
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action="go-intro"]');
  if (!btn) return;
  e.preventDefault();
  showSectionWithEffects('intro', { historyMode: 'push' });
});

// Section navigation
document.addEventListener('click', (e) => {
  const link = e.target.closest('.section-nav-link');
  if (!link) return;
  e.preventDefault();
  const targetSection = link.dataset.section;
  if (targetSection) {
    showSectionWithEffects(targetSection, { historyMode: 'push' });
  }
});

// Paper focus (desktop)
const mqWide = window.matchMedia('(min-width: 901px)');
if (mqWide.matches) {
  initAboutPaperFocus();       // desktop/tablet-wide only
  initSkillsPaperFocus();      // desktop/tablet-wide only
}
mqWide.addEventListener('change', (e) => {
  if (e.matches) {
    initAboutPaperFocus();
    initSkillsPaperFocus();
  }
});

const mqMobile = window.matchMedia('(max-width: 900px)');

function aboutMobileInertify() {
  const papers = document.querySelectorAll('#about [data-paper]');
  papers.forEach(el => {
    if (el.hasAttribute('tabindex')) el.removeAttribute('tabindex');
    el.setAttribute('aria-disabled', 'true');
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

// Skills mobile blur toggle
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

// [AA-FIX] Watch for DPR changes via matchMedia (event-driven, no polling)
let lastDPR = window.devicePixelRatio || 1;
function watchDPR() {
  const mql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  mql.addEventListener('change', function onDprChange() {
    const currentDPR = window.devicePixelRatio || 1;
    if (currentDPR !== lastDPR) {
      lastDPR = currentDPR;
      // Dispatch an event other modules can listen to
      window.dispatchEvent(new CustomEvent('dpr-changed', { detail: { dpr: currentDPR } }));
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
    // Re-attach for the new DPR value
    mql.removeEventListener('change', onDprChange);
    watchDPR();
  }, { once: true });
}
watchDPR();

// Pause/resume intro loops when tab visibility changes
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    const introActive = _introStage?.classList.contains('active-section');
    if (introActive) {
      restoreIntroCanvasBuffers();
      ensureSparkLoop();
      ensureSporeLoop();
    }
  }
});

function initAboutPaperFocus(){
  initPaperFocusForSection('about');
}

function initSkillsPaperFocus(){
  initPaperFocusForSection('skills');
}

function initPaperFocusForSection(sectionId){
  const section = document.getElementById(sectionId);
  if (!section) return;
  if (section.__paperFocusBound) return;
  section.querySelectorAll('.paper-overlay')?.forEach(n=>n.remove());

  const backdrop = document.getElementById('paper-backdrop');
  if (!backdrop) {
    console.warn('⚠️ paper-backdrop not found');
    return;
  }
  section.__paperFocusBound = true;
  
  const papers = section.querySelectorAll('.paper');
  papers.forEach(p => {
    if (!p.hasAttribute('tabindex')) p.setAttribute('tabindex','0');
    
    p.addEventListener('click', () => {
      if (window.innerWidth <= 900) return;
      if (p.classList.contains('paper-open')) {
        closePaper();
      } else {
        openPaper(p);
      }
    });
    p.addEventListener('keydown', (e) => {
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
    const r = el.getBoundingClientRect();
    const computed = getComputedStyle(el);
    
    const ipx = (n) => Math.round(Number(n) || 0);
    
    // Capture the REAL content height (scrollHeight) before clipping
    // The closed-state max-height clips content; we need the full height for the open state
    const realContentH = Math.max(el.scrollHeight, r.height);
    
    const placeholder = document.createElement('div');
    placeholder.className = el.className.replace('paper-open', '') + ' paper-placeholder';
    placeholder.style.visibility = 'hidden';
    placeholder.style.pointerEvents = 'none';
    
    el.__portal = { parent: el.parentNode, placeholder: placeholder };
    el.__portal.parent.insertBefore(placeholder, el);
    document.body.appendChild(el);
    el.classList.add('paper-open');
    el.style.position = 'fixed';
    el.style.left = `${r.left}px`;
    el.style.top  = `${r.top}px`;
    el.style.width  = `${r.width}px`;
    el.style.height = `${realContentH}px`;
    
    el.style.setProperty('--open-tx', '0px');
    el.style.setProperty('--open-ty', '0px');
    el.style.setProperty('--open-scale', '1');
    
    const vw = window.innerWidth, vh = window.innerHeight;
    const cx = r.left + r.width/2, cy = r.top + realContentH/2;
    const tx = ipx((vw/2) - cx);
    const ty = ipx((vh/2) - cy);
    const fitW = (vw * 0.86) / r.width;
    const fitH = (vh * 0.80) / realContentH;
    const scale = Math.min(fitW, fitH, 2.4);
    
    const targetW = ipx(r.width * scale);
    const targetH = ipx(realContentH * scale);
    el.style.setProperty('--open-w', `${targetW}px`);
    el.style.setProperty('--open-h', `${targetH}px`);
    
    requestAnimationFrame(() => {
      el.style.setProperty('--open-tx', `${tx}px`);
      el.style.setProperty('--open-ty', `${ty}px`);
      el.style.setProperty('--open-scale', `${scale}`);
    });
    
    // Demote from compositor after transition for better AA
    let settled = false;
    const applySettle = () => {
      if (settled) return;
      settled = true;
      
      el.classList.add('paper-open--settled');
      
      el.style.willChange = 'auto';
      el.style.backfaceVisibility = 'visible';
      
      void el.offsetHeight;
    };
    
    const onEnd = (e) => {
      if (e.propertyName !== 'transform') return;
      el.removeEventListener('transitionend', onEnd);
      applySettle();
    };
    el.addEventListener('transitionend', onEnd, { once: true });
    
    setTimeout(applySettle, 350);
    
    el.setAttribute('role','dialog');
    el.setAttribute('aria-modal','true');
    document.body.classList.add('has-paper-open-global');
    requestAnimationFrame(() => el.focus({ preventScroll:true }));
    document.addEventListener('keydown', onEsc);
    document.body.classList.remove('hovering-paper');
  }

  function closePaper(){
    const openEl = document.querySelector('.paper-open');
    if (openEl){
      openEl.classList.remove('paper-open--settled');
      openEl.style.willChange = 'transform';
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

// Cursor hover ring — only runs when hovering a paper element
function initPaperHoverRing(){
  const ring = document.getElementById('cursor-ring');
  if (!ring) return;
  let currentX = 0, currentY = 0;
  let targetX = 0, targetY = 0;
  let rafId = null;
  let isHovering = false;
  
  const updatePosition = () => {
    currentX += (targetX - currentX) * 1.0;
    currentY += (targetY - currentY) * 1.0;
    
    ring.style.left = currentX + 'px';
    ring.style.top = currentY + 'px';
    
    if (isHovering) {
      rafId = requestAnimationFrame(updatePosition);
    } else {
      rafId = null;
    }
  };
  // Don't start the loop immediately — it starts on hover
  
  document.addEventListener('mousemove', (e) => {
    targetX = e.clientX;
    targetY = e.clientY;
  }, { passive: true });
  
  const startRing = () => {
    isHovering = true;
    if (!rafId) rafId = requestAnimationFrame(updatePosition);
  };
  const stopRing = () => {
    isHovering = false;
    // rafId will self-clear on next frame
  };
  
  const about = document.getElementById('about');
  const skills = document.getElementById('skills');

  [about, skills].forEach(section => {
    if (!section) return;
    section.addEventListener('mouseenter', (e) => {
      if (e.target.closest('.paper') && !document.body.classList.contains('has-paper-open-global')) {
        document.body.classList.add('hovering-paper');
        startRing();
      }
    }, true);
    
    section.addEventListener('mouseleave', (e) => {
      if (e.target.closest('.paper')) {
        document.body.classList.remove('hovering-paper');
        stopRing();
      }
    }, true);
  });
}

// Ritual background (disabled)
var SIGNALS = {
  canvas: null,
  ctx: null,
  raf: 0,
  interval: 0,
  pulses: [],
  spores: [],
  lastTs: 0
};

function initRitualBackground(){
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
  return;
}

function stopRitualBackground(){
  if (typeof SIGNALS === 'undefined') return;
  const sigil = getSigilEl();
  if (sigil) sigil.classList.remove('sigil-spin', 'sigil-kick');
  if (SIGNALS.interval) { clearInterval(SIGNALS.interval); SIGNALS.interval = 0; }
  if (SIGNALS.raf) { cancelAnimationFrame(SIGNALS.raf); SIGNALS.raf = 0; }
  SIGNALS.pulses.length = 0;
  SIGNALS.spores.length = 0;
  if (SIGNALS.ctx) SIGNALS.ctx.clearRect(0,0,SIGNALS.canvas.width, SIGNALS.canvas.height);
}

function collectEdges(){
  const candidates = [
    window.MYCELIUM?.links, window.MYCELIUM?.edges,
    window.graph?.links, window.__network?.links, window.NETWORK?.links
  ].find(Boolean);
  const nodes = (window.MYCELIUM?.nodes || window.graph?.nodes || window.__network?.nodes || window.NETWORK?.nodes) || [];
  if (!candidates || !nodes.length) return null;
  const byId = new Map(nodes.map(n => [n.id ?? n.name ?? n.i, n]));
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
  const sigil = getSigilEl();
  if (sigil) {
    sigil.classList.remove('sigil-kick');
    void sigil.offsetWidth;
    sigil.classList.add('sigil-kick');
  }
  const center = getSigilCenter();
  const edges = collectEdges();
  if (edges) {
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
        start: t0 + i*0.006,
        speed: 2200,
        life: 0.35
      });
    });
  } else {
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
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgba(0,0,0,0.20)';
  ctx.fillRect(0,0,w,h);
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
      const segLen = Math.hypot(p.bx - p.ax, p.by - p.ay);
      const prog = Math.min(1, (age * p.speed) / segLen);
      const bx = p.ax + (p.bx - p.ax)*prog;
      const by = p.ay + (p.by - p.ay)*prog;
      const glow = Math.max(0, 1 - (age / (p.life+0.0001)));
      ctx.strokeStyle = `rgba(45,212,175,${0.75*glow})`;
      ctx.lineWidth = 2.0;
      ctx.beginPath(); ctx.moveTo(p.ax, p.ay); ctx.lineTo(bx, by); ctx.stroke();
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
  const spores = SIGNALS.spores;
  for (let i=spores.length-1; i>=0; i--){
    const s = spores[i];
    s.t += dt; if (s.t > s.life) { spores.splice(i,1); continue; }
    s.x += s.vx*dt; s.y += s.vy*dt;
    const fade = 1 - (s.t / s.life);
    ctx.fillStyle = `rgba(45,212,175,${0.9*fade})`;
    ctx.beginPath(); ctx.arc(s.x, s.y, 1.2 + (1.6*fade), 0, Math.PI*2); ctx.fill();
    if (Math.random() < 0.03){
      ctx.fillStyle = `rgba(255,122,51,${0.6*fade})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, 1.0, 0, Math.PI*2); ctx.fill();
    }
  }
}
