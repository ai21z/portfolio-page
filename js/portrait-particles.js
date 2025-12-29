// Portrait Particle Effect - Desktop only
// Particles form the portrait, scatter on cursor interaction, reform after inactivity
// v2: crisp canvas, space-drift motion, cursor wake carving, batched rendering

// ─────────────────────────────────────────────────────────────────────────────
// PALETTE: 6 green bins from dark → light, each with alpha
// ─────────────────────────────────────────────────────────────────────────────
const PALETTE = [
  { r: 18, g: 30, b: 24, a: 0.45 },   // bin 0: deep shadow (sparse)
  { r: 30, g: 48, b: 38, a: 0.55 },   // bin 1: dark green
  { r: 48, g: 75, b: 58, a: 0.70 },   // bin 2: mid shadow
  { r: 70, g: 105, b: 82, a: 0.82 },  // bin 3: mid tone
  { r: 95, g: 135, b: 108, a: 0.90 }, // bin 4: light mid
  { r: 130, g: 170, b: 142, a: 0.96 }, // bin 5: highlight
];

// Precompute fillStyle strings for batched rendering
const PALETTE_STRINGS = PALETTE.map(c => `rgba(${c.r},${c.g},${c.b},${c.a})`);

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG: All tuneable parameters in one place
// ─────────────────────────────────────────────────────────────────────────────
const CONFIG = {
  // Sampling
  SAMPLE_SPACING: 2,            // pixels between samples (lower = more particles)
  PARTICLE_SIZE_MIN: 0.6,       // minimum dot radius
  PARTICLE_SIZE_MAX: 1.2,       // maximum dot radius
  BRIGHTNESS_THRESHOLD: 12,     // skip pixels darker than this
  ALPHA_THRESHOLD: 180,         // skip transparent pixels
  DARK_SKIP_PROBABILITY: 0.6,   // probability to skip dark pixels (bins 0-1)

  // Cursor interaction radii (in CSS pixels)
  INNER_RADIUS: 70,             // strong force zone
  OUTER_RADIUS: 140,            // weak force zone (activates near portrait)
  PROXIMITY_MARGIN: 80,         // extra margin outside wrapper for "near" detection

  // Force magnitudes
  RADIAL_PUSH: 0.15,            // outward push strength
  TANGENT_SWIRL: 0.12,          // perpendicular swirl strength
  VELOCITY_DRAG: 0.25,          // cursor velocity influence
  MAX_SPEED: 8,                 // clamp particle speed

  // Drift (idle animation)
  DRIFT_AMPLITUDE: 0.3,         // sine noise amplitude
  DRIFT_FREQUENCY: 0.0008,      // noise frequency (lower = slower)

  // Spring / damping
  DAMPING: 0.94,                // velocity decay per frame
  SPRING_NORMAL: 0.012,         // gravity to home during interaction
  SPRING_RECOVERY: 0.045,       // gravity to home during recovery

  // Timing
  IDLE_THRESHOLD_MS: 1500,      // ms before recovery mode kicks in
  RECOVERY_DURATION_MS: 2000,   // ms for full recovery ramp
};

// ─────────────────────────────────────────────────────────────────────────────
// Simple hash for deterministic per-particle noise
// ─────────────────────────────────────────────────────────────────────────────
function hashNoise(seed, t) {
  const x = Math.sin(seed * 12.9898 + t * CONFIG.DRIFT_FREQUENCY) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1; // range -1..1
}

// ─────────────────────────────────────────────────────────────────────────────
// CLASS: PortraitParticles
// ─────────────────────────────────────────────────────────────────────────────
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

    // Mouse state (in wrapper-local coords)
    this.mouseX = -9999;
    this.mouseY = -9999;
    this.prevMouseX = -9999;
    this.prevMouseY = -9999;
    this.mouseVelX = 0;
    this.mouseVelY = 0;
    this.isNearWrapper = false;
    this.lastInteractionTime = 0;

    // Animation state
    this.animationId = null;
    this.running = false;
    this.initialized = false;
    this.lastFrameTime = 0;

    // Observers
    this.intersectionObserver = null;
    this.mutationObserver = null;
    this.isVisible = false;

    // Bound handlers (for cleanup)
    this.boundHandlePointerMove = this.handlePointerMove.bind(this);
    this.boundHandleVisibilityChange = this.handleVisibilityChange.bind(this);
    this.boundHandleResize = this.handleResize.bind(this);
    this.boundAnimate = this.animate.bind(this);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // INIT
  // ───────────────────────────────────────────────────────────────────────────
  init(wrapperSelector = '.portrait-wrap') {
    if (this.initialized) return;

    // Desktop only: skip on touch devices
    if (window.matchMedia('(pointer: coarse)').matches) return;

    // Respect reduced motion preference
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    this.wrapper = document.querySelector(wrapperSelector);
    if (!this.wrapper) return;

    this.img = this.wrapper.querySelector('.portrait');
    if (!this.img) return;

    // Wait for image to load
    if (this.img.complete && this.img.naturalWidth > 0) {
      this.setup();
    } else {
      this.img.addEventListener('load', () => this.setup(), { once: true });
    }
  }

  setup() {
    this.createCanvas();
    this.sampleImage();
    this.setupObservers();
    this.setupEventListeners();
    this.initialized = true;

    // Start if intro section is active
    const introSection = document.querySelector('.stage[data-section="intro"]');
    if (introSection?.classList.contains('active-section')) {
      this.start();
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // CANVAS SETUP (crisp rendering)
  // ───────────────────────────────────────────────────────────────────────────
  createCanvas() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'portrait-particles-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.wrapper.appendChild(this.canvas);

    this.ctx = this.canvas.getContext('2d', { alpha: true });
    this.resize();
  }

  resize() {
    // Use IMAGE rendered size (not wrapper, which may have transforms)
    this.width = this.img.clientWidth;
    this.height = this.img.clientHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.canvas.width = this.width * this.dpr;
    this.canvas.height = this.height * this.dpr;
    this.canvas.style.width = this.width + 'px';
    this.canvas.style.height = this.height + 'px';

    // CRISP: reset transform every resize, do NOT call scale() repeatedly
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // IMAGE SAMPLING
  // ───────────────────────────────────────────────────────────────────────────
  sampleImage() {
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
      console.warn('[Portrait Particles] Cannot sample image (CORS?):', e);
      return;
    }

    const data = imageData.data;
    const spacing = CONFIG.SAMPLE_SPACING;

    // Scale from image coords → display coords
    const scaleX = this.width / imgW;
    const scaleY = this.height / imgH;

    this.particles = [];
    let seed = 0;

    for (let y = 0; y < imgH; y += spacing) {
      for (let x = 0; x < imgW; x += spacing) {
        const i = (y * imgW + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];

        if (a < CONFIG.ALPHA_THRESHOLD) continue;

        // Brightness (luma)
        const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
        if (brightness < CONFIG.BRIGHTNESS_THRESHOLD) continue;

        // Quantize to palette bin
        const binIndex = Math.min(
          PALETTE.length - 1,
          Math.floor((brightness / 255) * PALETTE.length)
        );

        // Probabilistic skip for dark bins (avoids solid background)
        if (binIndex <= 1 && Math.random() < CONFIG.DARK_SKIP_PROBABILITY) continue;

        // Map to display coordinates
        const homeX = x * scaleX;
        const homeY = y * scaleY;

        this.particles.push({
          homeX,
          homeY,
          x: homeX,
          y: homeY,
          vx: 0,
          vy: 0,
          binIndex,
          size: CONFIG.PARTICLE_SIZE_MIN + Math.random() * (CONFIG.PARTICLE_SIZE_MAX - CONFIG.PARTICLE_SIZE_MIN),
          seed: seed++, // unique seed for drift noise
        });
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // OBSERVERS
  // ───────────────────────────────────────────────────────────────────────────
  setupObservers() {
    // IntersectionObserver: detect when wrapper is in viewport
    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          this.isVisible = entry.isIntersecting;
          if (this.isVisible && this.shouldRun()) {
            this.start();
          } else if (!this.isVisible) {
            this.stop();
          }
        });
      },
      { threshold: 0.1 }
    );
    this.intersectionObserver.observe(this.wrapper);

    // MutationObserver: detect when intro section becomes active/inactive
    const introSection = document.querySelector('.stage[data-section="intro"]');
    if (introSection) {
      this.mutationObserver = new MutationObserver((mutations) => {
        mutations.forEach(mutation => {
          if (mutation.attributeName === 'class') {
            const isActive = introSection.classList.contains('active-section');
            if (isActive && this.isVisible && !this.running) {
              this.start();
            } else if (!isActive && this.running) {
              this.stop();
            }
          }
        });
      });
      this.mutationObserver.observe(introSection, { attributes: true });
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // EVENT LISTENERS
  // ───────────────────────────────────────────────────────────────────────────
  setupEventListeners() {
    // Track pointer on WINDOW so we detect cursor near the wrapper
    window.addEventListener('pointermove', this.boundHandlePointerMove);
    document.addEventListener('visibilitychange', this.boundHandleVisibilityChange);
    window.addEventListener('resize', this.boundHandleResize);
  }

  handlePointerMove(e) {
    // Get wrapper rect (may be affected by transforms, but good enough for proximity)
    const rect = this.wrapper.getBoundingClientRect();
    const margin = CONFIG.PROXIMITY_MARGIN;

    // Expanded rect for "near" detection
    const nearLeft = rect.left - margin;
    const nearRight = rect.right + margin;
    const nearTop = rect.top - margin;
    const nearBottom = rect.bottom + margin;

    // Check if cursor is within expanded bounds
    const inExpandedBounds =
      e.clientX >= nearLeft && e.clientX <= nearRight &&
      e.clientY >= nearTop && e.clientY <= nearBottom;

    // Convert to wrapper-local coords (relative to image position)
    const imgRect = this.img.getBoundingClientRect();
    const localX = e.clientX - imgRect.left;
    const localY = e.clientY - imgRect.top;

    // Compute velocity
    if (this.mouseX > -1000) {
      this.mouseVelX = localX - this.mouseX;
      this.mouseVelY = localY - this.mouseY;
    }

    this.prevMouseX = this.mouseX;
    this.prevMouseY = this.mouseY;
    this.mouseX = localX;
    this.mouseY = localY;

    this.isNearWrapper = inExpandedBounds;
    if (inExpandedBounds) {
      this.lastInteractionTime = performance.now();
    }
  }

  handleVisibilityChange() {
    if (document.hidden) {
      this.stop();
    } else if (this.shouldRun()) {
      this.start();
    }
  }

  handleResize() {
    this.resize();
    this.sampleImage();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // LIFECYCLE
  // ───────────────────────────────────────────────────────────────────────────
  shouldRun() {
    if (document.hidden) return false;
    if (!this.isVisible) return false;

    const introSection = document.querySelector('.stage[data-section="intro"]');
    if (!introSection?.classList.contains('active-section')) return false;

    return true;
  }

  start() {
    if (this.running || !this.initialized || this.particles.length === 0) return;
    this.running = true;
    this.lastFrameTime = performance.now();
    this.lastInteractionTime = performance.now();
    this.animate();
  }

  stop() {
    this.running = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // ANIMATION LOOP
  // ───────────────────────────────────────────────────────────────────────────
  animate() {
    if (!this.running) return;

    const now = performance.now();
    const rawDt = (now - this.lastFrameTime) / 16.667; // normalize to ~60fps
    const dt = Math.max(0.5, Math.min(rawDt, 2)); // clamp dt
    this.lastFrameTime = now;

    const timeSinceInteraction = now - this.lastInteractionTime;
    const isRecovering = !this.isNearWrapper && timeSinceInteraction > CONFIG.IDLE_THRESHOLD_MS;

    // Interpolate spring strength for recovery
    let spring = CONFIG.SPRING_NORMAL;
    let driftScale = 1;
    if (isRecovering) {
      const progress = Math.min(1, (timeSinceInteraction - CONFIG.IDLE_THRESHOLD_MS) / CONFIG.RECOVERY_DURATION_MS);
      spring = CONFIG.SPRING_NORMAL + (CONFIG.SPRING_RECOVERY - CONFIG.SPRING_NORMAL) * progress;
      driftScale = 1 - progress * 0.8; // reduce drift during recovery
    }

    // Update particles
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];

      // A) IDLE DRIFT (subtle wander)
      const driftX = hashNoise(p.seed, now) * CONFIG.DRIFT_AMPLITUDE * driftScale;
      const driftY = hashNoise(p.seed + 1000, now + 500) * CONFIG.DRIFT_AMPLITUDE * driftScale;

      // B) CURSOR WAKE (if near wrapper)
      let forceX = 0;
      let forceY = 0;

      if (this.isNearWrapper) {
        const dx = p.x - this.mouseX;
        const dy = p.y - this.mouseY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < CONFIG.OUTER_RADIUS && dist > 0.1) {
          // Normalized direction away from cursor
          const nx = dx / dist;
          const ny = dy / dist;

          // Tangent (perpendicular) for swirl
          const tx = -ny;
          const ty = nx;

          // Force falloff: stronger in INNER_RADIUS, weaker in OUTER_RADIUS
          let strength;
          if (dist < CONFIG.INNER_RADIUS) {
            strength = 1 - dist / CONFIG.INNER_RADIUS;
          } else {
            strength = (1 - (dist - CONFIG.INNER_RADIUS) / (CONFIG.OUTER_RADIUS - CONFIG.INNER_RADIUS)) * 0.4;
          }

          // 1) Radial push (away from cursor)
          forceX += nx * CONFIG.RADIAL_PUSH * strength;
          forceY += ny * CONFIG.RADIAL_PUSH * strength;

          // 2) Tangential swirl (perpendicular flow)
          forceX += tx * CONFIG.TANGENT_SWIRL * strength;
          forceY += ty * CONFIG.TANGENT_SWIRL * strength;

          // 3) Drag along cursor velocity (carves wake)
          forceX += this.mouseVelX * CONFIG.VELOCITY_DRAG * strength;
          forceY += this.mouseVelY * CONFIG.VELOCITY_DRAG * strength;
        }
      }

      // C) SPRING to home (gravity)
      const homeDistX = p.homeX - p.x;
      const homeDistY = p.homeY - p.y;

      // Apply forces (dt-scaled)
      p.vx += (forceX + driftX + homeDistX * spring) * dt;
      p.vy += (forceY + driftY + homeDistY * spring) * dt;

      // Damping
      p.vx *= CONFIG.DAMPING;
      p.vy *= CONFIG.DAMPING;

      // Clamp speed
      const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
      if (speed > CONFIG.MAX_SPEED) {
        const scale = CONFIG.MAX_SPEED / speed;
        p.vx *= scale;
        p.vy *= scale;
      }

      // Update position
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }

    // Decay mouse velocity
    this.mouseVelX *= 0.85;
    this.mouseVelY *= 0.85;

    this.render();
    this.animationId = requestAnimationFrame(this.boundAnimate);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // RENDER (batched by palette bin)
  // ───────────────────────────────────────────────────────────────────────────
  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    // Group particles by bin for batched rendering
    const bins = new Array(PALETTE.length);
    for (let i = 0; i < PALETTE.length; i++) bins[i] = [];

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      bins[p.binIndex].push(p);
    }

    // Draw each bin with single fillStyle
    for (let b = 0; b < PALETTE.length; b++) {
      const particles = bins[b];
      if (particles.length === 0) continue;

      ctx.fillStyle = PALETTE_STRINGS[b];

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        // Use fillRect for crisp square dots (faster than arc)
        const s = p.size;
        ctx.fillRect(p.x - s * 0.5, p.y - s * 0.5, s, s);
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // DESTROY (full cleanup)
  // ───────────────────────────────────────────────────────────────────────────
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

    if (this.canvas) {
      this.canvas.remove();
      this.canvas = null;
    }

    this.ctx = null;
    this.particles = [];
    this.initialized = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT & AUTO-INIT
// ─────────────────────────────────────────────────────────────────────────────
export const portraitParticles = new PortraitParticles();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => portraitParticles.init());
} else {
  portraitParticles.init();
}
