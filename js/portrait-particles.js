// Portrait Particle Effect - Desktop only
import { cappedDpr, isFirefox, isWebKit } from './utils.js';
import { getGraphicsBudget, reportFrameSample } from './graphics-governor.js';

const FIREFOX = isFirefox();
const WEBKIT = isWebKit();

const BRIGHTNESS_MULT = 1.35;
const ALPHA_BOOST = 0.0;

// Palette: 6 bins, shadows→highlights
const PALETTE_BASE = [
  { r: 12, g: 28, b: 32, a: 0.35, size: 0.5 },
  { r: 22, g: 45, b: 42, a: 0.50, size: 0.65 },
  { r: 45, g: 75, b: 60, a: 0.70, size: 0.85 },
  { r: 70, g: 110, b: 85, a: 0.85, size: 1.0 },
  { r: 105, g: 145, b: 112, a: 0.94, size: 1.15 },
  { r: 160, g: 185, b: 150, a: 1.0, size: 1.35 },
];

const PALETTE = PALETTE_BASE.map(c => ({
  r: Math.min(255, Math.round(c.r * BRIGHTNESS_MULT)),
  g: Math.min(255, Math.round(c.g * BRIGHTNESS_MULT)),
  b: Math.min(255, Math.round(c.b * BRIGHTNESS_MULT)),
  a: Math.min(1, c.a + ALPHA_BOOST),
  size: c.size,
}));

const PALETTE_STRINGS = PALETTE.map(c => `rgba(${c.r},${c.g},${c.b},${c.a})`);

const LITTLE_ENDIAN = (() => {
  const buf = new ArrayBuffer(4);
  const u32 = new Uint32Array(buf);
  const u8 = new Uint8Array(buf);
  u32[0] = 0x01020304;
  return u8[0] === 0x04;
})();

const PALETTE_UINT32 = PALETTE.map(c => {
  const a = Math.round(c.a * 255);
  if (LITTLE_ENDIAN) {
    return (a << 24) | (c.b << 16) | (c.g << 8) | c.r;
  } else {
    return (c.r << 24) | (c.g << 16) | (c.b << 8) | a;
  }
});

const CONFIG = {
  SAMPLE_SPACING: FIREFOX ? 3 : 2,
  PARTICLE_SKIP_PROBABILITY: FIREFOX ? 0.12 : 0.0,
  PARTICLE_SIZE_MIN: 0.6,
  PARTICLE_SIZE_MAX: 1.1,
  BRIGHTNESS_THRESHOLD: 8,
  ALPHA_THRESHOLD: 180,
  DARK_SKIP_PROBABILITY: FIREFOX ? 0.35 : 0.2,

  INNER_RADIUS: 45,
  OUTER_RADIUS: 90,
  PROXIMITY_MARGIN: 80,

  CANVAS_PAD: 850,          // legacy reference / minimum fallback
  CANVAS_PAD_MIN: 200,      // floor per side so idle particles always have breathing room
  CANVAS_MAX_BUF: (FIREFOX ? 3072 : 4096) * (FIREFOX ? 3072 : 4096), // max buffer pixels – DPR is reduced to stay within budget

  // Streaming
  STREAM_STRENGTH: 0.45,
  STREAM_CURVE_SCALE: 40,
  STREAM_CURVE_FREQ: 0.004,
  STREAM_ORBIT_RADIUS: 45,
  STREAM_ORBIT_SPEED: 0.12,
  STREAM_SPRING_CUT: 1.0,
  STREAM_RAMP_MS: 150,
  REFORM_RAMP_MS: 300,
  STREAM_DAMPING: 0.97,
  STREAM_BURST_STRENGTH: 0.8,
  STREAM_BURST_DURATION_MS: 120,
  STREAM_MAX_SPEED: 20,
  STREAM_STAGGER_MS: 350,
  STREAM_STAGGER_RANDOMNESS: 0.3,
  STREAM_SPEED_FAST: 1.4,
  STREAM_SPEED_MEDIUM: 1.0,
  STREAM_SPEED_SLOW: 0.6,
  REFORM_STAGGER_MS: 800,
  REFORM_STAGGER_RANDOMNESS: 0.1,
  REFORM_FORCE: 0.7,
  REFORM_DAMPING: 0.95,
  REFORM_STREAM_PHASE_DIST: 150,

  // Constellation mode (click easter egg)
  SIGIL_PATH: './artifacts/sigil/AZ-VZ-01.webp',
  SIGIL_FALLBACK_PATH: './artifacts/sigil/AZ-VZ-01.png',
  SIGIL_BRIGHTNESS_THRESHOLD: 40,
  CONSTELLATION_SCATTER: 0.6,
  CONSTELLATION_SPRING: 0.2,
  CONSTELLATION_RAMP_MS: 400,
  CONSTELLATION_DRIFT: 0.15,

  PORTRAIT_IDLE_OPACITY: 0.2,
  ACTIVATION_RADIUS: 200,
  ACTIVATION_RAMP_MS: 300,

  RADIAL_PUSH: 0.45,
  TANGENT_SWIRL: 0.03,
  VELOCITY_DRAG: 0.2,
  MAX_SPEED: 12,
  MAX_SPEED_DISINTEGRATE: 25,

  DRIFT_AMPLITUDE: 0.075,
  DRIFT_FREQUENCY: 0.0008,

  DAMPING: 0.92,
  SPRING_NORMAL: 0.025,
  SPRING_RECOVERY: 0.12,

  IDLE_THRESHOLD_MS: 200,
  RECOVERY_DURATION_MS: 400,

  DEBUG_PERF: false,
  DEBUG_FLOW: false,
  DEBUG_SIGIL: false,
  RENDER_MODE: 'auto',
};

function renderModeForBudget() {
  if (CONFIG.RENDER_MODE !== 'auto') return CONFIG.RENDER_MODE;
  return (FIREFOX || WEBKIT) ? 'fillrect' : 'imagedata';
}

function portraitBudget() {
  return getGraphicsBudget('portrait-particles');
}

function particleScaleFromBudget(budget) {
  return Math.max(0, Math.min(1, budget.particleScale ?? 1));
}

function hashNoise(seed, t) {
  const k = (seed * 0x9E3779B9 + (t * CONFIG.DRIFT_FREQUENCY * 1000) | 0) | 0;
  const h = Math.imul(k ^ (k >>> 16), 0x45d9f3b) ^ (k >>> 13);
  return ((h & 0xFFFF) / 32768) - 1;
}

/**
 * @typedef {Object} Particle
 * @property {number} homeX - Rest position X
 * @property {number} homeY - Rest position Y
 * @property {number} x - Current position X
 * @property {number} y - Current position Y
 * @property {number} vx - Velocity X
 * @property {number} vy - Velocity Y
 * @property {number} binIndex - Palette bin (0-5)
 * @property {number} size - Render size
 * @property {number} seed - Per-particle random seed
 * @property {boolean} isSigil - Part of constellation sigil
 */

/**
 * Level ramp with fixed-time feel across frame rates.
 * @param {number} current
 * @param {number} target
 * @param {number} rampMs
 * @param {number} dt - normalized dt (1.0 ~= 60fps)
 * @returns {number}
 */
function ramp(current, target, rampMs, dt) {
  const step = dt * (1000 / rampMs) / 60;
  const delta = target - current;
  return Math.abs(delta) <= step ? target : current + Math.sign(delta) * step;
}

/**
 * Tracks dirty rectangle bounds for optimized rendering.
 * Uses exclusive bounds (x1/y1 not included) internally.
 */
class DirtyRect {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.reset();
  }

  resize(w, h) {
    this.w = w;
    this.h = h;
    this.reset();
  }

  reset() {
    this.minX = this.w;
    this.minY = this.h;
    this.maxX = -1;
    this.maxY = -1;
  }

  add(x, y) {
    if (x < this.minX) this.minX = x;
    if (x > this.maxX) this.maxX = x;
    if (y < this.minY) this.minY = y;
    if (y > this.maxY) this.maxY = y;
  }

  get valid() {
    return this.maxX >= this.minX && this.maxY >= this.minY;
  }

  /**
   * Writes exclusive bounds into `out` (no allocations).
   * @param {{x0:number,y0:number,x1:number,y1:number,w:number,h:number}} out
   * @param {number} margin
   */
  boundsInto(out, margin = 0) {
    if (!this.valid) {
      out.x0 = out.y0 = out.x1 = out.y1 = out.w = out.h = 0;
      return out;
    }

    const x0 = Math.max(0, this.minX - margin);
    const y0 = Math.max(0, this.minY - margin);
    const x1 = Math.min(this.w, this.maxX + margin + 1);
    const y1 = Math.min(this.h, this.maxY + margin + 1);

    out.x0 = x0; out.y0 = y0;
    out.x1 = x1; out.y1 = y1;
    out.w = x1 - x0;
    out.h = y1 - y0;
    return out;
  }
}

/**
 * Unions two already-computed bounds (no allocations).
 * @param {{x0:number,y0:number,x1:number,y1:number,w:number,h:number}} a
 * @param {{x0:number,y0:number,x1:number,y1:number,w:number,h:number}} b
 * @param {{x0:number,y0:number,x1:number,y1:number,w:number,h:number}} out
 */
function unionBoundsInto(a, b, out) {
  const aValid = a.w > 0 && a.h > 0;
  const bValid = b.w > 0 && b.h > 0;

  if (!aValid && !bValid) {
    out.x0 = out.y0 = out.x1 = out.y1 = out.w = out.h = 0;
    return out;
  }
  if (!aValid) {
    out.x0 = b.x0; out.y0 = b.y0; out.x1 = b.x1; out.y1 = b.y1; out.w = b.w; out.h = b.h;
    return out;
  }
  if (!bValid) {
    out.x0 = a.x0; out.y0 = a.y0; out.x1 = a.x1; out.y1 = a.y1; out.w = a.w; out.h = a.h;
    return out;
  }

  const x0 = Math.min(a.x0, b.x0);
  const y0 = Math.min(a.y0, b.y0);
  const x1 = Math.max(a.x1, b.x1);
  const y1 = Math.max(a.y1, b.y1);

  out.x0 = x0; out.y0 = y0;
  out.x1 = x1; out.y1 = y1;
  out.w = x1 - x0;
  out.h = y1 - y0;
  return out;
}

/**
 * Clears a region of the buffer using optimal strategy.
 * @param {Uint32Array} buf32
 * @param {number} bufWidth
 * @param {number} bufHeight
 * @param {{x0:number,y0:number,x1:number,y1:number,w:number,h:number}} bounds
 * @param {number} dirtyThreshold
 */
function clearRegion(buf32, bufWidth, bufHeight, bounds, dirtyThreshold = 0.5) {
  const w = bounds.w, h = bounds.h;
  if (w <= 0 || h <= 0) return;

  const dirtyArea = w * h;
  const totalArea = bufWidth * bufHeight;

  if (dirtyArea > totalArea * dirtyThreshold) {
    buf32.fill(0);
    return;
  }

  if (w === bufWidth) {
    buf32.fill(0, bounds.y0 * bufWidth, bounds.y1 * bufWidth);
    return;
  }

  const x0 = bounds.x0;
  for (let row = bounds.y0; row < bounds.y1; row++) {
    const start = row * bufWidth + x0;
    buf32.fill(0, start, start + w);
  }
}

class PortraitParticles {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.particles = [];
    this.wrapper = null;
    this.img = null;
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.padLeft = CONFIG.CANVAS_PAD;
    this.padRight = CONFIG.CANVAS_PAD;
    this.padTop = CONFIG.CANVAS_PAD;
    this.padBottom = CONFIG.CANVAS_PAD;

    this.mouseX = -9999;
    this.mouseY = -9999;
    this.prevMouseX = -9999;
    this.prevMouseY = -9999;
    this.mouseVelX = 0;
    this.mouseVelY = 0;
    this.isNearWrapper = false;
    this.lastInteractionTime = 0;
    this.lastPointerTime = 0;

    this.activationLevel = 0;
    this.targetActivation = 0;
    this.cursorDistToWrapper = 9999;
    this.cursorInsideWrapper = false;

    this.bins = [];

    this.imageData = null;
    this.buf32 = null;
    this.bufWidth = 0;
    this.bufHeight = 0;
    this.renderMode = renderModeForBudget();
    this.lastStats = null;

    this.animationId = null;
    this.releaseTimer = 0;
    this.running = false;
    this.initialized = false;
    this.lastFrameTime = 0;

    this.intersectionObserver = null;
    this.mutationObserver = null;
    this.isVisible = false;

    this.boundHandlePointerMove = this.handlePointerMove.bind(this);
    this.boundHandleVisibilityChange = this.handleVisibilityChange.bind(this);
    this.boundHandleResize = this.handleResize.bind(this);
    this.boundHandleClick = this.handleClick.bind(this);
    this.boundHandleGraphicsChange = this.handleGraphicsChange.bind(this);
    this.boundAnimate = this.animate.bind(this);

    this.perfBufferSize = 300;
    this.perfIndex = 0;
    this.perfFrameMs = new Float32Array(300);
    this.perfPhysicsMs = new Float32Array(300);
    this.perfRenderMs = new Float32Array(300);
    this.perfFrameCount = 0;
    this.lastPerfLogTime = 0;

    // Dirty rect tracking (swap pattern, allocation-free bounds)
    this.dirtyPrev = null;
    this.dirtyCurr = null;
    this._prevBounds = { x0: 0, y0: 0, x1: 0, y1: 0, w: 0, h: 0 };
    this._currBounds = { x0: 0, y0: 0, x1: 0, y1: 0, w: 0, h: 0 };
    this._unionBounds = { x0: 0, y0: 0, x1: 0, y1: 0, w: 0, h: 0 };

    // Stream state
    this.streamTarget = null;
    this.lastStreamTarget = null;
    this.streamLevel = 0;
    this.streamStartTime = 0;
    this.burstApplied = false;
    this.streamLaunchDelays = null;

    // Reform state
    this.isReforming = false;
    this.reformStartTime = 0;
    this.reformDelays = null;
    this.reformNormalizedDelays = null;
    this.reformStreamTarget = null;

    // Constellation state
    this.constellationActive = false;
    this.constellationLevel = 0;
    this.targetConstellationLevel = 0;
    this.sigilMask = null;
  }

  init(wrapperSelector = '.portrait-wrap') {
    if (this.initialized) return;
    if (window.matchMedia('(pointer: coarse)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const budget = portraitBudget();
    if (budget.quiet || particleScaleFromBudget(budget) <= 0) return;

    this.wrapper = document.querySelector(wrapperSelector);
    if (!this.wrapper) return;

    this.img = this.wrapper.querySelector('.portrait');
    if (!this.img) return;

    if (this.img.complete && this.img.naturalWidth > 0) {
      this.setup();
    } else {
      this.img.addEventListener('load', () => this.setup(), { once: true });
    }
  }

  setup() {
    this.createCanvas();
    this.sampleImage();
    this.sampleSigil();
    this.setupObservers();
    this.setupEventListeners();
    this.initialized = true;

    // Re-compute canvas dimensions once the entry animation settles so
    // padding and DPR are based on the final (untransformed) wrapper position.
    this.wrapper.addEventListener('animationend', () => this.resize(), { once: true });

    const introSection = document.querySelector('.stage[data-section="intro"]');
    if (introSection?.classList.contains('active-section')) {
      this.start();
    }
  }

  createCanvas() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'portrait-particles-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    
    // CSS variables for positioning are set by resize()
    
    this.wrapper.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d', { alpha: true });
    this.resize();
  }

  selectRenderMode() {
    this.renderMode = renderModeForBudget();
    if (this.canvas) {
      this.canvas.dataset.portraitRenderMode = this.renderMode;
    }
    return this.renderMode;
  }

  publishStats(extra = {}) {
    const stats = {
      renderMode: this.renderMode,
      particleCount: this.particles.length,
      backingWidth: this.canvas?.width ?? 0,
      backingHeight: this.canvas?.height ?? 0,
      bufferPixels: (this.canvas?.width ?? 0) * (this.canvas?.height ?? 0),
      dpr: this.dpr,
      running: this.running,
      visible: this.isVisible,
      initialized: this.initialized,
      ...extra
    };

    this.lastStats = stats;
    window.__portraitParticleStats = stats;
  }

  releaseBuffers() {
    if (!this.canvas) return;
    if (this.releaseTimer) {
      clearTimeout(this.releaseTimer);
      this.releaseTimer = 0;
    }

    this.canvas.width = 1;
    this.canvas.height = 1;
    this.imageData = null;
    this.buf32 = null;
    this.bufWidth = 1;
    this.bufHeight = 1;
    this.dirtyPrev = null;
    this.dirtyCurr = null;
    this.publishStats({ released: true });
  }

  ensureBuffers() {
    if (!this.canvas || !this.ctx) return;
    if (!this.buf32 && this.renderMode === 'imagedata') {
      this.resize();
      return;
    }
    if (this.canvas.width <= 1 || this.canvas.height <= 1) {
      this.resize();
    }
  }

  resize() {
    this.width = this.img.clientWidth;
    this.height = this.img.clientHeight;
    const budget = portraitBudget();
    this.selectRenderMode();

    // --- Asymmetric padding: cover full viewport from portrait position ---
    const rect = this.wrapper.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const minPad = CONFIG.CANVAS_PAD_MIN;

    // Estimate untransformed position (compensates for CSS transform on wrapper,
    // e.g. during the fadeInPortrait scale animation).  translateY is small
    // (≤10 px) and covered by the 50 px margin added below.
    const uLeft   = rect.left + (rect.width  - this.width)  * 0.5;
    const uTop    = rect.top  + (rect.height - this.height) * 0.5;
    const uRight  = uLeft + this.width;
    const uBottom = uTop  + this.height;

    this.padLeft   = Math.max(minPad, Math.ceil(uLeft)          + 50);
    this.padRight  = Math.max(minPad, Math.ceil(vw - uRight)    + 50);
    this.padTop    = Math.max(minPad, Math.ceil(uTop)           + 50);
    this.padBottom = Math.max(minPad, Math.ceil(vh - uBottom)   + 50);

    let cssW = this.width + this.padLeft + this.padRight;
    let cssH = this.height + this.padTop + this.padBottom;
    this.dpr = cappedDpr(1.5, {
      systemName: 'portrait-particles',
      width: cssW,
      height: cssH
    });

    // Cap buffer size to limit memory; reduce DPR instead of CSS coverage
    const maxBuf = Math.min(CONFIG.CANVAS_MAX_BUF, budget.maxCanvasPixels);
    const estBuf = Math.round(cssW * this.dpr) * Math.round(cssH * this.dpr);
    if (estBuf > maxBuf) {
      this.dpr = Math.max(0.5, Math.sqrt(maxBuf / (cssW * cssH)));
    }

    // Update CSS positioning (canvas offset = left/top padding)
    this.wrapper.style.setProperty('--pp-pad-left', this.padLeft + 'px');
    this.wrapper.style.setProperty('--pp-pad-top', this.padTop + 'px');

    this.bufWidth  = Math.round(cssW * this.dpr);
    this.bufHeight = Math.round(cssH * this.dpr);
    this.canvas.width  = this.bufWidth;
    this.canvas.height = this.bufHeight;
    this.canvas.style.width  = cssW + 'px';
    this.canvas.style.height = cssH + 'px';

    this.ctx.setTransform(1, 0, 0, 1, 0, 0);

    if (this.renderMode === 'imagedata') {
      this.imageData = this.ctx.createImageData(this.bufWidth, this.bufHeight);
      this.buf32 = new Uint32Array(this.imageData.data.buffer);

      // Dirty rects depend on buffer size
      if (!this.dirtyPrev) {
        this.dirtyPrev = new DirtyRect(this.bufWidth, this.bufHeight);
        this.dirtyCurr = new DirtyRect(this.bufWidth, this.bufHeight);
      } else {
        this.dirtyPrev.resize(this.bufWidth, this.bufHeight);
        this.dirtyCurr.resize(this.bufWidth, this.bufHeight);
      }
    } else {
      this.imageData = null;
      this.buf32 = null;
      this.dirtyPrev = null;
      this.dirtyCurr = null;
    }

    this.publishStats({ resized: true });
  }

  sampleImage() {
    const budget = portraitBudget();
    const particleScale = particleScaleFromBudget(budget);
    if (budget.quiet || particleScale <= 0) {
      this.particles = [];
      this.bins = new Array(PALETTE.length);
      for (let b = 0; b < PALETTE.length; b++) this.bins[b] = [];
      this.publishStats({ sampled: true });
      return;
    }

    const offscreen = document.createElement('canvas');
    const offCtx = offscreen.getContext('2d');
    const imgW = this.img.naturalWidth;
    const imgH = this.img.naturalHeight;

    offscreen.width = imgW;
    offscreen.height = imgH;
    offCtx.drawImage(this.img, 0, 0, imgW, imgH);

    let imageData;
    try {
      imageData = offCtx.getImageData(0, 0, imgW, imgH);
    } catch (e) {
      console.warn('[particles] CORS error:', e);
      return;
    }
    const data = imageData.data;
    const spacing = Math.max(CONFIG.SAMPLE_SPACING, Math.round(CONFIG.SAMPLE_SPACING / Math.max(0.2, particleScale)));
    const skipProbability = Math.min(0.92, CONFIG.PARTICLE_SKIP_PROBABILITY + (1 - particleScale) * 0.55);
    const darkSkipProbability = Math.min(0.92, CONFIG.DARK_SKIP_PROBABILITY + (1 - particleScale) * 0.35);
    const scaleX = this.width / imgW;
    const scaleY = this.height / imgH;

    this.particles = [];
    this.bins = new Array(PALETTE.length);
    for (let b = 0; b < PALETTE.length; b++) this.bins[b] = [];

    for (let y = 0; y < imgH; y += spacing) {
      for (let x = 0; x < imgW; x += spacing) {
        const i = (y * imgW + x) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];

        if (a < CONFIG.ALPHA_THRESHOLD) continue;
        const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
        if (brightness < CONFIG.BRIGHTNESS_THRESHOLD) continue;
        if (Math.random() < skipProbability) continue;

        const binIndex = Math.min(PALETTE.length - 1, Math.floor((brightness / 255) * PALETTE.length));
        if (binIndex <= 1 && Math.random() < darkSkipProbability) continue;

        const homeX = x * scaleX;
        const homeY = y * scaleY;
        const binSize = PALETTE[binIndex].size;
        const baseSize = CONFIG.PARTICLE_SIZE_MIN + Math.random() * (CONFIG.PARTICLE_SIZE_MAX - CONFIG.PARTICLE_SIZE_MIN);

        const particle = {
          homeX, homeY,
          x: homeX, y: homeY,
          vx: 0, vy: 0,
          binIndex,
          size: baseSize * binSize,
          seed: Math.random() * 10000,
          isSigil: false,
        };

        this.particles.push(particle);
        this.bins[binIndex].push(particle);
      }
    }

    if (this.img && this.particles.length > 0) {
      this.img.style.opacity = String(CONFIG.PORTRAIT_IDLE_OPACITY);
      this.img.style.transition = 'opacity 0.15s ease-out';
    }

    console.log('[particles]', this.particles.length, 'sampled');
    this.publishStats({ sampled: true });
  }

  sampleSigil() {
    const sigil = new Image();
    sigil.crossOrigin = 'anonymous';
    
    sigil.onload = () => {
      const offscreen = document.createElement('canvas');
      const ctx = offscreen.getContext('2d');
      const imgW = sigil.naturalWidth;
      const imgH = sigil.naturalHeight;
      
      offscreen.width = imgW;
      offscreen.height = imgH;
      ctx.drawImage(sigil, 0, 0, imgW, imgH);
      
      let imageData;
      try {
        imageData = ctx.getImageData(0, 0, imgW, imgH);
      } catch (e) {
        console.warn('[particles] Sigil CORS error:', e);
        return;
      }
      
      const data = imageData.data;
      const scaleX = imgW / this.width;
      const scaleY = imgH / this.height;
      
      let sigilCount = 0;
      for (const p of this.particles) {
        const sx = Math.floor(p.homeX * scaleX);
        const sy = Math.floor(p.homeY * scaleY);
        
        if (sx >= 0 && sx < imgW && sy >= 0 && sy < imgH) {
          const i = (sy * imgW + sx) * 4;
          const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
          const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
          
          if (brightness > CONFIG.SIGIL_BRIGHTNESS_THRESHOLD && a > 100) {
            p.isSigil = true;
            sigilCount++;
          }
        }
      }
      
      console.log('[particles] Sigil constellation:', sigilCount, 'particles marked');
    };
    
    sigil.onerror = () => {
      if (sigil.src.endsWith('/AZ-VZ-01.webp') || sigil.src.endsWith('AZ-VZ-01.webp')) {
        sigil.src = CONFIG.SIGIL_FALLBACK_PATH;
        return;
      }
      console.warn('[particles] Failed to load sigil image');
    };

    sigil.src = CONFIG.SIGIL_PATH;
  }

  setupObservers() {
    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          this.isVisible = entry.isIntersecting;
          if (this.isVisible && this.shouldRun()) this.start();
          else if (!this.isVisible) this.stop();
        });
      },
      { threshold: 0.1 }
    );
    this.intersectionObserver.observe(this.wrapper);

    const introSection = document.querySelector('.stage[data-section="intro"]');
    if (introSection) {
      this.mutationObserver = new MutationObserver((mutations) => {
        mutations.forEach(mutation => {
          if (mutation.attributeName === 'class') {
            const isActive = introSection.classList.contains('active-section');
            if (isActive && this.isVisible && !this.running) this.start();
            else if (!isActive) this.stop({ release: true });
          }
        });
      });
      this.mutationObserver.observe(introSection, { attributes: true });
    }
  }

  setupEventListeners() {
    window.addEventListener('pointermove', this.boundHandlePointerMove);
    document.addEventListener('visibilitychange', this.boundHandleVisibilityChange);
    window.addEventListener('resize', this.boundHandleResize);
    window.addEventListener('graphics:profile-change', this.boundHandleGraphicsChange);
    this.wrapper.addEventListener('click', this.boundHandleClick);
  }

  handleClick(e) {
    const rect = this.wrapper.getBoundingClientRect();
    const sx = rect.width  > 0 ? this.width  / rect.width  : 1;
    const sy = rect.height > 0 ? this.height / rect.height : 1;
    const localX = (e.clientX - rect.left) * sx;
    const localY = (e.clientY - rect.top)  * sy;

    if (localX >= 0 && localX <= this.width && localY >= 0 && localY <= this.height) {
      this.toggleConstellation();
    }
  }

  handlePointerMove(e) {
    const rect = this.wrapper.getBoundingClientRect();
    const margin = CONFIG.PROXIMITY_MARGIN;

    this.isNearWrapper =
      e.clientX >= rect.left - margin &&
      e.clientX <= rect.right + margin &&
      e.clientY >= rect.top - margin &&
      e.clientY <= rect.bottom + margin;

    const distLeft = rect.left - e.clientX;
    const distRight = e.clientX - rect.right;
    const distTop = rect.top - e.clientY;
    const distBottom = e.clientY - rect.bottom;
    const distX = Math.max(distLeft, distRight, 0);
    const distY = Math.max(distTop, distBottom, 0);
    this.cursorDistToWrapper = Math.sqrt(distX * distX + distY * distY);

    if (e.clientX >= rect.left && e.clientX <= rect.right &&
        e.clientY >= rect.top && e.clientY <= rect.bottom) {
      this.cursorDistToWrapper = 0;
      this.cursorInsideWrapper = true;
    } else {
      this.cursorInsideWrapper = false;
    }

    if (this.cursorDistToWrapper <= 0) {
      this.targetActivation = 1;
    } else if (this.cursorDistToWrapper < CONFIG.ACTIVATION_RADIUS) {
      this.targetActivation = 1 - (this.cursorDistToWrapper / CONFIG.ACTIVATION_RADIUS);
    } else {
      this.targetActivation = 0;
    }

    // Convert to local coords, compensating for CSS transforms (scale animation)
    const sx = rect.width  > 0 ? this.width  / rect.width  : 1;
    const sy = rect.height > 0 ? this.height / rect.height : 1;
    const localX = (e.clientX - rect.left) * sx;
    const localY = (e.clientY - rect.top)  * sy;

    this.mouseVelX = localX - this.mouseX;
    this.mouseVelY = localY - this.mouseY;
    this.prevMouseX = this.mouseX;
    this.prevMouseY = this.mouseY;
    this.mouseX = localX;
    this.mouseY = localY;

    this.lastPointerTime = performance.now();
    if (this.isNearWrapper) this.lastInteractionTime = performance.now();
  }

  handleVisibilityChange() {
    if (document.hidden) this.stop({ release: true });
    else if (this.shouldRun()) this.start();
  }

  handleGraphicsChange() {
    const budget = portraitBudget();
    if (budget.quiet) {
      this.clearStream();
      this.stop({ release: true, forceRelease: true });
      return;
    }

    if (!budget.allowPortraitStreaming) {
      this.clearStream();
    }

    if (this.shouldRun()) this.start();
    else this.stop({ release: true });
  }

  handleResize() {
    this.resize();
    this.sampleImage();
    this.sampleSigil();
  }

  shouldRun() {
    if (document.hidden) return false;
    if (!this.isVisible) return false;
    const introSection = document.querySelector('.stage[data-section="intro"]');
    if (!introSection?.classList.contains('active-section')) return false;
    return true;
  }

  start() {
    if (this.running || !this.initialized || this.particles.length === 0) return;
    if (this.releaseTimer) {
      clearTimeout(this.releaseTimer);
      this.releaseTimer = 0;
    }
    this.selectRenderMode();
    this.ensureBuffers();
    this.running = true;
    this.lastFrameTime = performance.now();
    this.lastInteractionTime = performance.now();
    this.publishStats({ started: true, released: false });
    this.animate();
  }

  stop(options = {}) {
    this.running = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    if (options.release) {
      if (options.forceRelease) {
        this.releaseBuffers();
        return;
      }

      if (this.releaseTimer) clearTimeout(this.releaseTimer);
      this.releaseTimer = window.setTimeout(() => {
        this.releaseTimer = 0;
        if (this.shouldRun()) {
          this.start();
          return;
        }
        this.releaseBuffers();
      }, 160);
    } else {
      this.publishStats({ stopped: true });
    }
  }

  animate() {
    if (!this.running) return;

    const now = performance.now();
    const budget = portraitBudget();
    if (budget.quiet) {
      this.clearStream();
      this.stop({ release: true, forceRelease: true });
      return;
    }
    if (!budget.allowPortraitStreaming) {
      this.clearStream();
    }
    this.selectRenderMode();
    this.ensureBuffers();
    if (budget.frameIntervalMs && now - this.lastFrameTime < budget.frameIntervalMs) {
      this.animationId = requestAnimationFrame(this.boundAnimate);
      return;
    }

    const frameMs = now - this.lastFrameTime;
    const rawDt = frameMs / 16.667;
    const dt = Math.max(0.5, Math.min(rawDt, 2));
    this.lastFrameTime = now;

    const physicsStart = performance.now();

    // Ramp levels smoothly
    this.activationLevel = ramp(this.activationLevel, this.targetActivation, CONFIG.ACTIVATION_RAMP_MS, dt);

    const targetStreamLevel = this.streamTarget ? 1 : 0;
    const streamRampMs = this.streamTarget ? CONFIG.STREAM_RAMP_MS : CONFIG.REFORM_RAMP_MS;
    this.streamLevel = ramp(this.streamLevel, targetStreamLevel, streamRampMs, dt);

    this.constellationLevel = ramp(this.constellationLevel, this.targetConstellationLevel, CONFIG.CONSTELLATION_RAMP_MS, dt);

    if (this.img) {
      const portraitOpacity = CONFIG.PORTRAIT_IDLE_OPACITY * (1 - this.activationLevel);
      this.img.style.opacity = String(portraitOpacity);
    }

    const timeSinceInteraction = now - this.lastInteractionTime;
    const isRecovering = this.activationLevel < 0.1 && timeSinceInteraction > CONFIG.IDLE_THRESHOLD_MS;

    let springK = CONFIG.SPRING_NORMAL;
    let driftScale = 0.25 + this.activationLevel * 0.75;

    if (isRecovering) {
      const progress = Math.min(1, (timeSinceInteraction - CONFIG.IDLE_THRESHOLD_MS) / CONFIG.RECOVERY_DURATION_MS);
      springK = CONFIG.SPRING_NORMAL + (CONFIG.SPRING_RECOVERY - CONFIG.SPRING_NORMAL) * progress;
      driftScale = 0.25 * (1 - progress * 0.5);
    }

    const outerRadiusSq = CONFIG.OUTER_RADIUS * CONFIG.OUTER_RADIUS;
    const cursorInside = this.cursorInsideWrapper;

    const hasStream = this.streamLevel > 0.01 && this.streamTarget;
    const streamTargetX = hasStream ? this.streamTarget.x : 0;
    const streamTargetY = hasStream ? this.streamTarget.y : 0;
    const streamTime = hasStream ? (now - this.streamStartTime) : 0;
    
    const hasConstellation = this.constellationLevel > 0.01;

    // Pre-compute all damping powers once per frame (avoids Math.pow per particle)
    const dampNormal   = Math.pow(CONFIG.DAMPING, dt);
    const dampStream   = Math.pow(CONFIG.STREAM_DAMPING, dt);
    const dampReform   = Math.pow(CONFIG.REFORM_DAMPING, dt);
    const dampOrbit    = Math.pow(0.96, dt);

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      const isColoredParticle = p.binIndex <= 1 || p.binIndex >= 4;

      const homeDistX = p.homeX - p.x;
      const homeDistY = p.homeY - p.y;

      let particleSpring = springK;
      if (isColoredParticle && cursorInside) particleSpring = 0;

      const isDust = p.binIndex >= 4;
      
      if (hasStream && isDust) {
        particleSpring *= (1 - this.streamLevel * CONFIG.STREAM_SPRING_CUT);
      }
      
      let isWaitingToReform = false;
      let isActivelyReforming = false;

      if (this.isReforming && isDust && this.reformDelays) {
        const reformTime = now - this.reformStartTime;
        const reformDelay = this.reformDelays[i];

        if (reformTime < reformDelay) {
          isWaitingToReform = true;
          particleSpring = 0;
        } else {
          isActivelyReforming = true;
          const distToHome = Math.sqrt(homeDistX * homeDistX + homeDistY * homeDistY);
          const nearHome = distToHome < 20;

          if (nearHome) {
            particleSpring = springK * 1.5;
          } else {
            particleSpring = 0;
          }
        }
      }
      
      if (hasConstellation) {
        if (p.isSigil) {
          particleSpring = CONFIG.CONSTELLATION_SPRING + (springK - CONFIG.CONSTELLATION_SPRING) * (1 - this.constellationLevel);
        } else {
          particleSpring *= (1 - this.constellationLevel * 0.98);
        }
      }

      let forceX = 0, forceY = 0;

      if (this.isNearWrapper) {
        const dx = p.x - this.mouseX;
        const dy = p.y - this.mouseY;
        const r2 = dx * dx + dy * dy;

        if (r2 < outerRadiusSq && r2 > 0.1) {
          const dist = Math.sqrt(r2);
          const nx = dx / dist;
          const ny = dy / dist;
          const tx = -ny;
          const ty = nx;

          let strength;
          if (dist < CONFIG.INNER_RADIUS) {
            strength = 1 - dist / CONFIG.INNER_RADIUS;
          } else {
            strength = (1 - (dist - CONFIG.INNER_RADIUS) / (CONFIG.OUTER_RADIUS - CONFIG.INNER_RADIUS)) * 0.4;
          }

          if (isColoredParticle) strength *= 1.8;

          forceX += nx * CONFIG.RADIAL_PUSH * strength;
          forceY += ny * CONFIG.RADIAL_PUSH * strength;
          forceX += tx * CONFIG.TANGENT_SWIRL * strength;
          forceY += ty * CONFIG.TANGENT_SWIRL * strength;
          forceX += this.mouseVelX * CONFIG.VELOCITY_DRAG * strength;
          forceY += this.mouseVelY * CONFIG.VELOCITY_DRAG * strength;
        }
      }

      if (hasStream && isDust) {
        const launchDelay = this.streamLaunchDelays ? this.streamLaunchDelays[i] : 0;
        const particleStreamTime = streamTime - launchDelay;

        if (particleStreamTime > 0) {
          const dx = streamTargetX - p.x;
          const dy = streamTargetY - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          
          const tierRoll = (p.seed % 100) / 100;
          let speedMult;
          if (tierRoll < 0.3) {
            speedMult = CONFIG.STREAM_SPEED_FAST;
          } else if (tierRoll < 0.7) {
            speedMult = CONFIG.STREAM_SPEED_MEDIUM;
          } else {
            speedMult = CONFIG.STREAM_SPEED_SLOW;
          }

          const inBurstPhase = particleStreamTime < CONFIG.STREAM_BURST_DURATION_MS;
          
          if (dist > 1) {
            const nx = dx / dist;
            const ny = dy / dist;
            const px = -ny;
            const py = nx;

            if (inBurstPhase) {
              const burstAngle = p.seed * 6.28;
              const bx = Math.cos(burstAngle);
              const by = Math.sin(burstAngle);

              const burstFade = 1 - (particleStreamTime / CONFIG.STREAM_BURST_DURATION_MS);
              forceX += bx * CONFIG.STREAM_BURST_STRENGTH * burstFade * this.streamLevel * speedMult;
              forceY += by * CONFIG.STREAM_BURST_STRENGTH * burstFade * this.streamLevel * speedMult;
            } else {
              const curvePhase = p.seed * 6.28 + particleStreamTime * CONFIG.STREAM_CURVE_FREQ;
              const curveAmount = Math.sin(curvePhase) * CONFIG.STREAM_CURVE_SCALE / (dist + 50);

              if (dist > CONFIG.STREAM_ORBIT_RADIUS) {
                const attraction = CONFIG.STREAM_STRENGTH * this.streamLevel * speedMult;
                forceX += (nx + px * curveAmount * 0.3) * attraction;
                forceY += (ny + py * curveAmount * 0.3) * attraction;
              } else {
                const orbitStrength = CONFIG.STREAM_ORBIT_SPEED * this.streamLevel;
                forceX += px * orbitStrength;
                forceY += py * orbitStrength;
                const centripetal = 0.02 * this.streamLevel;
                forceX += nx * centripetal;
                forceY += ny * centripetal;
              }
            }
          }
        }
      }
      
      if (isActivelyReforming && this.reformStreamTarget) {
        const distToHome = Math.sqrt(homeDistX * homeDistX + homeDistY * homeDistY);
        const streamDx = this.reformStreamTarget.x - p.x;
        const streamDy = this.reformStreamTarget.y - p.y;
        const distToStream = Math.sqrt(streamDx * streamDx + streamDy * streamDy);

        const normDelay = this.reformNormalizedDelays ? this.reformNormalizedDelays[i] : 0.5;
        const speedMult = CONFIG.STREAM_SPEED_FAST - normDelay * (CONFIG.STREAM_SPEED_FAST - CONFIG.STREAM_SPEED_SLOW);
        
        if (distToStream > CONFIG.REFORM_STREAM_PHASE_DIST) {
          if (distToStream > 5) {
            const nx = streamDx / distToStream;
            const ny = streamDy / distToStream;
            forceX += nx * CONFIG.REFORM_FORCE * speedMult;
            forceY += ny * CONFIG.REFORM_FORCE * speedMult;
          }
        } else {
          if (distToHome > 5) {
            const nx = homeDistX / distToHome;
            const ny = homeDistY / distToHome;
            forceX += nx * CONFIG.REFORM_FORCE * speedMult * 0.8;
            forceY += ny * CONFIG.REFORM_FORCE * speedMult * 0.8;
          }
        }
      }

      if (hasConstellation) {
        if (p.isSigil) {
          const floatX = hashNoise(p.seed + 2000, now * 0.5) * CONFIG.CONSTELLATION_DRIFT * this.constellationLevel;
          const floatY = hashNoise(p.seed + 3000, now * 0.5 + 500) * CONFIG.CONSTELLATION_DRIFT * this.constellationLevel;
          forceX += floatX;
          forceY += floatY;
        } else {
          const centerX = this.width * 0.5;
          const centerY = this.height * 0.5;
          const dx = p.x - centerX;
          const dy = p.y - centerY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          
          if (dist > 1) {
            const nx = dx / dist;
            const ny = dy / dist;
            forceX += nx * CONFIG.CONSTELLATION_SCATTER * this.constellationLevel;
            forceY += ny * CONFIG.CONSTELLATION_SCATTER * this.constellationLevel;
          }
          
          const spiralStrength = 0.08 * this.constellationLevel;
          forceX += dy / (dist + 50) * spiralStrength;
          forceY -= dx / (dist + 50) * spiralStrength;
        }
      }

      let particleDriftScale = driftScale;
      if (isColoredParticle && cursorInside) particleDriftScale = driftScale * 2.5;

      const driftX = hashNoise(p.seed, now) * CONFIG.DRIFT_AMPLITUDE * particleDriftScale;
      const driftY = hashNoise(p.seed + 1000, now + 500) * CONFIG.DRIFT_AMPLITUDE * particleDriftScale;

      if (isWaitingToReform && this.lastStreamTarget) {
        const orbitDx = this.lastStreamTarget.x - p.x;
        const orbitDy = this.lastStreamTarget.y - p.y;
        const orbitDist = Math.sqrt(orbitDx * orbitDx + orbitDy * orbitDy);
        if (orbitDist > 1) {
          const orbitNx = orbitDx / orbitDist;
          const orbitNy = orbitDy / orbitDist;
          const orbitPx = -orbitNy;
          const orbitPy = orbitNx;
          const orbitForce = CONFIG.STREAM_ORBIT_SPEED * 0.7;
          p.vx += (orbitPx * orbitForce + driftX) * dt;
          p.vy += (orbitPy * orbitForce + driftY) * dt;
          const centripetal = 0.015;
          p.vx += orbitNx * centripetal * dt;
          p.vy += orbitNy * centripetal * dt;
        }
        const orbitDamp = dampOrbit;
        p.vx *= orbitDamp;
        p.vy *= orbitDamp;
      } else {
        p.vx += (forceX + driftX + homeDistX * particleSpring) * dt;
        p.vy += (forceY + driftY + homeDistY * particleSpring) * dt;
      }

      let dampPow = dampNormal;
      if (hasStream && isDust) {
        dampPow = dampStream;
      } else if (isActivelyReforming) {
        dampPow = dampReform;
      }
      p.vx *= dampPow;
      p.vy *= dampPow;

      const currentMaxSpeed = (hasStream && isDust) ? CONFIG.STREAM_MAX_SPEED : CONFIG.MAX_SPEED;
      const currentMaxSpeedSq = currentMaxSpeed * currentMaxSpeed;
      const speedSq = p.vx * p.vx + p.vy * p.vy;
      if (speedSq > currentMaxSpeedSq) {
        const scale = currentMaxSpeed / Math.sqrt(speedSq);
        p.vx *= scale;
        p.vy *= scale;
      }

      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }

    const timeSincePointer = now - this.lastPointerTime;
    if (timeSincePointer > 50) {
      const mouseDecay = Math.pow(0.92, dt);
      this.mouseVelX *= mouseDecay;
      this.mouseVelY *= mouseDecay;
    }

    const physicsEnd = performance.now();
    const physicsMs = physicsEnd - physicsStart;

    const renderStart = performance.now();
    this.render();
    const renderEnd = performance.now();
    const renderMs = renderEnd - renderStart;
    reportFrameSample('portrait-particles', frameMs);

    if (CONFIG.DEBUG_PERF) {
      this.perfFrameMs[this.perfIndex] = frameMs;
      this.perfPhysicsMs[this.perfIndex] = physicsMs;
      this.perfRenderMs[this.perfIndex] = renderMs;
      this.perfIndex = (this.perfIndex + 1) % this.perfBufferSize;
      this.perfFrameCount++;

      if (this.perfFrameCount % 60 === 0) this.logPerfMetrics();
    }

    this.animationId = requestAnimationFrame(this.boundAnimate);
  }

  logPerfMetrics() {
    const samples = Math.min(this.perfFrameCount, this.perfBufferSize);
    if (samples < 10) return;

    let sumFrame = 0, sumPhysics = 0, sumRender = 0;
    for (let i = 0; i < samples; i++) {
      sumFrame += this.perfFrameMs[i];
      sumPhysics += this.perfPhysicsMs[i];
      sumRender += this.perfRenderMs[i];
    }
    const avgFrame = sumFrame / samples;
    const avgPhysics = sumPhysics / samples;
    const avgRender = sumRender / samples;

    const frameCopy = Array.from(this.perfFrameMs.subarray(0, samples)).sort((a, b) => a - b);
    const p95Index = Math.floor(samples * 0.95);
    const p95Frame = frameCopy[p95Index];
    const avgFps = avgFrame > 0 ? 1000 / avgFrame : 0;

    console.log(
      `[perf] frames=${samples} | avgFrame=${avgFrame.toFixed(2)}ms (${avgFps.toFixed(1)}fps) | p95=${p95Frame.toFixed(2)}ms | physics=${avgPhysics.toFixed(2)}ms | render=${avgRender.toFixed(2)}ms | particles=${this.particles.length}`
    );
  }

  render() {
    if (this.renderMode === 'imagedata') this.renderImageData();
    else this.renderFillRect();
  }

  renderImageData() {
    const buf32 = this.buf32;
    if (!buf32 || !this.imageData || !this.dirtyPrev || !this.dirtyCurr) return;

    const bufWidth = this.bufWidth;
    const bufHeight = this.bufHeight;
    const dpr = this.dpr;
    const padL = this.padLeft;
    const padT = this.padTop;
    const MARGIN = 2;
    const DIRTY_THRESHOLD = 0.5;

    // 1) Clear previous frame's dirty area
    const prevBounds = this.dirtyPrev.boundsInto(this._prevBounds, MARGIN);
    if (prevBounds.w > 0 && prevBounds.h > 0) {
      clearRegion(buf32, bufWidth, bufHeight, prevBounds, DIRTY_THRESHOLD);
    }

    // 2) Draw particles + track current dirty rect
    const currRect = this.dirtyCurr;
    currRect.reset();

    const particles = this.particles;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const px = ((p.x + padL) * dpr + 0.5) | 0;
      const py = ((p.y + padT) * dpr + 0.5) | 0;

      if (px >= 0 && px < bufWidth && py >= 0 && py < bufHeight) {
        buf32[py * bufWidth + px] = PALETTE_UINT32[p.binIndex];
        currRect.add(px, py);
      }
    }

    const currBounds = currRect.boundsInto(this._currBounds, MARGIN);

    // 3) Upload union(prev, curr) so cleared pixels disappear and new ones appear
    const union = unionBoundsInto(prevBounds, currBounds, this._unionBounds);
    if (union.w > 0 && union.h > 0) {
      this.ctx.putImageData(this.imageData, 0, 0, union.x0, union.y0, union.w, union.h);
    }

    // 4) Swap prev/curr for next frame (zero allocations)
    const tmp = this.dirtyPrev;
    this.dirtyPrev = this.dirtyCurr;
    this.dirtyCurr = tmp;
  }

  renderFillRect() {
    const ctx = this.ctx;
    const padL = this.padLeft;
    const padT = this.padTop;
    const cssW = this.width + this.padLeft + this.padRight;
    const cssH = this.height + this.padTop + this.padBottom;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    for (let b = 0; b < this.bins.length; b++) {
      const particles = this.bins[b];
      if (particles.length === 0) continue;

      ctx.fillStyle = PALETTE_STRINGS[b];
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const s = p.size;
        ctx.fillRect(p.x + padL - s * 0.5, p.y + padT - s * 0.5, s, s);
      }
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // === STREAMING API ===

  setStreamTarget(localX, localY) {
    if (!portraitBudget().allowPortraitStreaming) {
      this.clearStream();
      return;
    }

    if (!this.streamTarget) {
      this.streamStartTime = performance.now();
      this.calculateLaunchDelays(localX, localY);
      this.isReforming = false;
      this.reformDelays = null;
      this.reformNormalizedDelays = null;
      this.reformStreamTarget = null;
    }
    this.streamTarget = { x: localX, y: localY };
  }

  calculateLaunchDelays(targetX, targetY) {
    const particles = this.particles;
    const len = particles.length;
    let maxDist = 0;
    for (let i = 0; i < len; i++) {
      const p = particles[i];
      if (p.binIndex >= 4) {
        const dx = p.homeX - targetX;
        const dy = p.homeY - targetY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > maxDist) maxDist = dist;
      }
    }

    this.streamLaunchDelays = new Float32Array(len);
    const staggerMs = CONFIG.STREAM_STAGGER_MS;
    const randomness = CONFIG.STREAM_STAGGER_RANDOMNESS;

    for (let i = 0; i < len; i++) {
      const p = particles[i];
      if (p.binIndex >= 4 && maxDist > 0) {
        const dx = p.homeX - targetX;
        const dy = p.homeY - targetY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const normalizedDist = dist / maxDist;
        const baseDelay = normalizedDist * staggerMs;
        const randomOffset = (hashNoise(p.seed, 0) * 0.5 + 0.5) * randomness * staggerMs;
        this.streamLaunchDelays[i] = baseDelay + randomOffset;
      } else {
        this.streamLaunchDelays[i] = 0;
      }
    }
  }
  
  setStreamTargetVp(vpX, vpY) {
    if (!this.initialized || !this.wrapper) return;
    if (!portraitBudget().allowPortraitStreaming) {
      this.clearStream();
      return;
    }

    const rect = this.wrapper.getBoundingClientRect();

    // Convert viewport → wrapper-local, compensating for CSS transforms
    // (e.g. the fadeInPortrait scale animation on .portrait-wrap).
    const sx = rect.width  > 0 ? this.width  / rect.width  : 1;
    const sy = rect.height > 0 ? this.height / rect.height : 1;
    let localX = (vpX - rect.left) * sx;
    let localY = (vpY - rect.top)  * sy;

    // Clamp to canvas area (asymmetric margins)
    const mL = this.padLeft - 30;
    const mR = this.padRight - 30;
    const mT = this.padTop - 30;
    const mB = this.padBottom - 30;
    localX = Math.max(-mL, Math.min(this.width + mR, localX));
    localY = Math.max(-mT, Math.min(this.height + mB, localY));

    this.setStreamTarget(localX, localY);
  }
  
  clearStream() {
    if (this.streamTarget) {
      this.lastStreamTarget = { ...this.streamTarget };
      this.calculateReformDelays();
      this.isReforming = true;
      this.reformStartTime = performance.now();
      this.reformStreamTarget = { x: this.width * 0.5, y: this.height * 0.5 };
    }
    this.streamTarget = null;
    this.streamLaunchDelays = null;
  }
  
  calculateReformDelays() {
    const particles = this.particles;
    const len = particles.length;
    this.reformDelays = new Float32Array(len);
    this.reformNormalizedDelays = new Float32Array(len);
    const staggerMs = CONFIG.REFORM_STAGGER_MS;

    for (let i = 0; i < len; i++) {
      const p = particles[i];
      if (p.binIndex >= 4) {
        const seedRandom = (hashNoise(p.seed + 777, 0) + 1) * 0.5;
        this.reformDelays[i] = seedRandom * staggerMs;
        this.reformNormalizedDelays[i] = seedRandom;
      } else {
        this.reformDelays[i] = 0;
        this.reformNormalizedDelays[i] = 0;
      }
    }
  }
  
  // === CONSTELLATION API ===

  toggleConstellation() {
    if (this.constellationActive) {
      this.cancelConstellation();
    } else {
      this.triggerConstellation();
    }
  }

  triggerConstellation() {
    this.constellationActive = true;
    this.targetConstellationLevel = 1;
  }

  cancelConstellation() {
    this.constellationActive = false;
    this.targetConstellationLevel = 0;
  }

  destroy() {
    this.stop();

    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
      this.intersectionObserver = null;
    }
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }

    window.removeEventListener('pointermove', this.boundHandlePointerMove);
    document.removeEventListener('visibilitychange', this.boundHandleVisibilityChange);
    window.removeEventListener('resize', this.boundHandleResize);
    window.removeEventListener('graphics:profile-change', this.boundHandleGraphicsChange);
    if (this.wrapper) {
      this.wrapper.removeEventListener('click', this.boundHandleClick);
    }

    if (this.canvas) {
      this.canvas.remove();
      this.canvas = null;
    }
    this.ctx = null;
    this.particles = [];
    this.initialized = false;
  }
}

export const portraitParticles = new PortraitParticles();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => portraitParticles.init());
} else {
  portraitParticles.init();
}
