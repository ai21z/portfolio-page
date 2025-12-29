// Portrait Particle Effect - Desktop only
// Particles form the portrait, scatter on cursor interaction, reform after inactivity
// v2: crisp canvas, space-drift motion, cursor wake carving, batched rendering

// 
// PALETTE: 6 green bins from dark  light, each with alpha
// 
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

// ─
// ENDIANNESS DETECTION & UINT32 PALETTE (Phase 1)
// ─
const LITTLE_ENDIAN = (() => {
  const buf = new ArrayBuffer(4);
  const u32 = new Uint32Array(buf);
  const u8 = new Uint8Array(buf);
  u32[0] = 0x01020304;
  return u8[0] === 0x04;  // true if little-endian
})();

// Precompute palette as Uint32 for ImageData renderer
// Little-endian: memory layout is ABGR (displays as RGBA)
// Big-endian: memory layout is RGBA
const PALETTE_UINT32 = PALETTE.map(c => {
  const a = Math.round(c.a * 255);
  if (LITTLE_ENDIAN) {
    return (a << 24) | (c.b << 16) | (c.g << 8) | c.r;
  } else {
    return (c.r << 24) | (c.g << 16) | (c.b << 8) | a;
  }
});

// 
// CONFIG: All tuneable parameters in one place
// ─
const CONFIG = {
  // Sampling
  SAMPLE_SPACING: 1,            // pixels between samples (lower = more particles)
  PARTICLE_SKIP_PROBABILITY: 0.0, // skip this fraction of samples (0 = max density)
  PARTICLE_SIZE_MIN: 0.6,       // minimum dot radius
  PARTICLE_SIZE_MAX: 1.1,       // maximum dot radius
  BRIGHTNESS_THRESHOLD: 8,      // skip pixels darker than this
  ALPHA_THRESHOLD: 180,         // skip transparent pixels
  DARK_SKIP_PROBABILITY: 0.2,   // probability to skip dark pixels (bins 0-1) - reduced for more detail

  // HOME GRAVITY (dominant attractor)
  SPRING_BASE: 0.008,           // base spring strength (floaty near home)
  SPRING_EXTRA: 0.06,           // additional spring at max displacement
  HOME_RANGE: 50,               // distance (px) at which SPRING_EXTRA is fully engaged
  HOME_MAX_DISPLACEMENT: 80,    // hard cap: particles cannot stray further than this
  SPRING_RECOVERY: 0.08,        // spring strength boost during recovery phase

  // CURSOR GRAVITY (weak repulsion, steep falloff)
  CURSOR_MASS: 800,             // "mass" for inverse-square repulsion (lower = weaker)
  EPS: 25,                      // softening radius (prevents singularity, sets "core size")
  CURSOR_ACCEL_MAX: 0.5,        // clamp cursor acceleration to prevent spikes

  // WAKE & SWIRL (Gaussian falloff)
  SIGMA: 45,                    // Gaussian width (px) - controls corridor width
  WAKE_STRENGTH: 0.15,          // drag along mouse velocity
  SWIRL_STRENGTH: 0.04,         // tangential flow (subtle)

  // Phase 2: Cursor culling - skip expensive math beyond this radius
  // cutoff = max(3*SIGMA, HOME_MAX_DISPLACEMENT + EPS) = max(135, 105) = 135
  CURSOR_CUTOFF_SQ: 135 * 135,  // squared for fast comparison (18225)

  // General motion
  MAX_SPEED: 6,                 // clamp particle speed
  DAMPING: 0.92,                // velocity decay per frame

  // Drift (idle animation)
  DRIFT_AMPLITUDE: 0.25,        // sine noise amplitude
  DRIFT_FREQUENCY: 0.0008,      // noise frequency (lower = slower)

  // Timing
  IDLE_THRESHOLD_MS: 750,       // ms before recovery mode kicks in
  RECOVERY_DURATION_MS: 1000,   // ms for full recovery ramp

  // Velocity smoothing
  VELOCITY_SMOOTHING: 0.25,     // low-pass filter factor (0-1, lower = smoother)
  INTERACTION_SPEED_THRESHOLD: 0.5, // min mouse speed to count as "interacting"

  // Debug
  DEBUG_PERF: false,            // Enable performance logging (toggle for profiling)

  // Rendering
  RENDER_MODE: 'imagedata',     // 'imagedata' (Phase 1) or 'fillrect' (legacy)
};

// 
// CLASS: PortraitParticles
// 
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
    this.rawVelX = 0;           // raw velocity (for smoothing)
    this.rawVelY = 0;
    this.mouseVelX = 0;         // smoothed velocity (low-pass filtered)
    this.mouseVelY = 0;
    this.lastPointerTime = 0;   // for time-based velocity
    this.isNearWrapper = false;
    this.lastInteractionTime = 0;
    this.isActivelyInteracting = false;  // tracks if we're in an active interaction session

    // Pre-built bins for rendering (avoids per-frame allocation)
    this.bins = [];

    // ImageData renderer (Phase 1)
    this.imageData = null;
    this.buf32 = null;
    this.bufWidth = 0;
    this.bufHeight = 0;

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

    // Performance tracking (Phase 0 instrumentation)
    this.perfBufferSize = 300;
    this.perfIndex = 0;
    this.perfFrameMs = new Float32Array(300);
    this.perfPhysicsMs = new Float32Array(300);
    this.perfRenderMs = new Float32Array(300);
    this.perfFrameCount = 0;
    this.lastPerfLogTime = 0;
  }

  // 
  // INIT
  // 
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

  // 
  // CANVAS SETUP (crisp rendering)
  // 
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

    // Canvas backing store = device pixels
    this.bufWidth = Math.round(this.width * this.dpr);
    this.bufHeight = Math.round(this.height * this.dpr);
    this.canvas.width = this.bufWidth;
    this.canvas.height = this.bufHeight;
    this.canvas.style.width = this.width + 'px';
    this.canvas.style.height = this.height + 'px';

    // Create ImageData buffer for Phase 1 renderer
    this.imageData = this.ctx.createImageData(this.bufWidth, this.bufHeight);
    this.buf32 = new Uint32Array(this.imageData.data.buffer);

    // Transform: identity for ImageData, dpr-scaled for fillRect
    // Set to identity by default; fillRect path will set its own transform
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // 
  // IMAGE SAMPLING
  // 
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

    // Scale from image coords  display coords
    const scaleX = this.width / imgW;
    const scaleY = this.height / imgH;

    this.particles = [];

    // Initialize bins array (built once, not per-frame)
    this.bins = new Array(PALETTE.length);
    for (let b = 0; b < PALETTE.length; b++) this.bins[b] = [];

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

        // General skip for performance (applied before binning)
        if (Math.random() < CONFIG.PARTICLE_SKIP_PROBABILITY) continue;

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

        const particle = {
          homeX,
          homeY,
          x: homeX,
          y: homeY,
          vx: 0,
          vy: 0,
          binIndex,
          size: CONFIG.PARTICLE_SIZE_MIN + Math.random() * (CONFIG.PARTICLE_SIZE_MAX - CONFIG.PARTICLE_SIZE_MIN),
          // Precompute phase offsets for continuous sine drift (no micro-jumps)
          phaseX: Math.random() * Math.PI * 2,
          phaseY: Math.random() * Math.PI * 2,
        };

        this.particles.push(particle);
        this.bins[binIndex].push(particle);  // Add to pre-built bin
      }
    }

    // Hide underlying image permanently - particles are the portrait now
    if (this.img && this.particles.length > 0) {
      this.img.style.opacity = '0';
    }

    console.log('[particles]', this.particles.length);
  }

  // 
  // OBSERVERS
  // 
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

  // 
  // EVENT LISTENERS
  // 
  setupEventListeners() {
    // Track pointer on WINDOW so we detect cursor near the wrapper
    window.addEventListener('pointermove', this.boundHandlePointerMove);
    document.addEventListener('visibilitychange', this.boundHandleVisibilityChange);
    window.addEventListener('resize', this.boundHandleResize);
  }

  handlePointerMove(e) {
    const now = performance.now();

    // Get image rect for direct hit detection
    const imgRect = this.img.getBoundingClientRect();

    // Check if cursor is directly over the portrait
    const isDirectlyOver = e.clientX >= imgRect.left && e.clientX <= imgRect.right &&
                           e.clientY >= imgRect.top && e.clientY <= imgRect.bottom;

    // Dynamic margin: 0 initially, HOME_MAX_DISPLACEMENT when actively interacting
    // This lets you "chase" displaced particles but requires touching the portrait to start
    const margin = this.isActivelyInteracting ? CONFIG.HOME_MAX_DISPLACEMENT : 0;

    // Expanded rect for "near" detection (only meaningful during interaction)
    const nearLeft = imgRect.left - margin;
    const nearRight = imgRect.right + margin;
    const nearTop = imgRect.top - margin;
    const nearBottom = imgRect.bottom + margin;

    // Check if cursor is within expanded bounds
    const inExpandedBounds = e.clientX >= nearLeft && e.clientX <= nearRight &&
                             e.clientY >= nearTop && e.clientY <= nearBottom;

    // Convert to wrapper-local coords (relative to image position)
    const localX = e.clientX - imgRect.left;
    const localY = e.clientY - imgRect.top;

    // Time-based velocity calculation
    if (this.mouseX > -1000 && this.lastPointerTime > 0) {
      const dtMs = now - this.lastPointerTime;
      if (dtMs > 0) {
        // Raw velocity (px per 16.67ms frame)
        const scale = 16.667 / dtMs;
        this.rawVelX = (localX - this.mouseX) * scale;
        this.rawVelY = (localY - this.mouseY) * scale;

        // Low-pass filter for smooth velocity
        const alpha = CONFIG.VELOCITY_SMOOTHING;
        this.mouseVelX += (this.rawVelX - this.mouseVelX) * alpha;
        this.mouseVelY += (this.rawVelY - this.mouseVelY) * alpha;
      }
    }

    this.prevMouseX = this.mouseX;
    this.prevMouseY = this.mouseY;
    this.mouseX = localX;
    this.mouseY = localY;
    this.lastPointerTime = now;
    this.isNearWrapper = inExpandedBounds;

    // Only update lastInteractionTime if actually interacting (moving fast enough)
    if (inExpandedBounds) {
      const speed = Math.sqrt(this.mouseVelX * this.mouseVelX + this.mouseVelY * this.mouseVelY);
      if (speed > CONFIG.INTERACTION_SPEED_THRESHOLD) {
        this.lastInteractionTime = now;

        // Activate interaction mode when directly touching OR already active
        if (isDirectlyOver || this.isActivelyInteracting) {
          this.isActivelyInteracting = true;
        }
      }
    }

    // Deactivate interaction mode when cursor leaves expanded bounds
    if (!inExpandedBounds) {
      this.isActivelyInteracting = false;
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

  // 
  // LIFECYCLE
  // 
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

  // 
  // ANIMATION LOOP
  // 
  animate() {
    if (!this.running) return;

    const now = performance.now();
    const frameMs = now - this.lastFrameTime;
    const rawDt = frameMs / 16.667;  // normalize to ~60fps
    const dt = Math.max(0.5, Math.min(rawDt, 2));  // clamp dt
    this.lastFrameTime = now;

    // Phase 0: Start physics timing
    const physicsStart = performance.now();

    const timeSinceInteraction = now - this.lastInteractionTime;

    // Recovery based on inactivity (regardless of cursor position)
    const isRecovering = timeSinceInteraction > CONFIG.IDLE_THRESHOLD_MS;

    // Recovery ramp: boost home gravity, reduce drift/cursor influence
    let recoveryProgress = 0;
    if (isRecovering) {
      recoveryProgress = Math.min(1, (timeSinceInteraction - CONFIG.IDLE_THRESHOLD_MS) / CONFIG.RECOVERY_DURATION_MS);
    }
    const driftScale = 1 - recoveryProgress * 0.85;
    const cursorScale = 1 - recoveryProgress * 0.9;  // fade out cursor influence during recovery

    // Precompute time factor for continuous sine drift
    const timeFactorX = now * CONFIG.DRIFT_FREQUENCY;
    const timeFactorY = now * CONFIG.DRIFT_FREQUENCY * 0.9;

    // Precompute constants for Phase 2 optimizations
    const sigma2x2 = 2 * CONFIG.SIGMA * CONFIG.SIGMA;  // Gaussian denominator
    const cursorCutoffSq = CONFIG.CURSOR_CUTOFF_SQ;
    const eps2 = CONFIG.EPS * CONFIG.EPS;
    const maxSpeedSq = CONFIG.MAX_SPEED * CONFIG.MAX_SPEED;
    const cursorActive = this.isNearWrapper && cursorScale > 0.01;

    // Update particles
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];

      // 
      // A) HOME GRAVITY (dominant attractor, non-linear spring)
      // 
      const homeDistX = p.homeX - p.x;
      const homeDistY = p.homeY - p.y;
      const homeDist = Math.sqrt(homeDistX * homeDistX + homeDistY * homeDistY);

      // Non-linear spring: stronger when far from home
      const homeRatio = Math.min(1, homeDist / CONFIG.HOME_RANGE);
      let springK = CONFIG.SPRING_BASE + CONFIG.SPRING_EXTRA * homeRatio;

      // Boost spring during recovery
      if (isRecovering) {
        springK += CONFIG.SPRING_RECOVERY * recoveryProgress;
      }

      const homeAccelX = homeDistX * springK;
      const homeAccelY = homeDistY * springK;

      // 
      // B+C) CURSOR FORCES: repulsion + wake + swirl (merged with culling)
      // Phase 2: Skip particles beyond cutoff radius for massive perf gain
      // 
      let cursorAccelX = 0;
      let cursorAccelY = 0;
      let wakeAccelX = 0;
      let wakeAccelY = 0;

      if (cursorActive) {
        const dx = p.x - this.mouseX;
        const dy = p.y - this.mouseY;
        const r2 = dx * dx + dy * dy;

        // Phase 2: Early-out if beyond cutoff (skip exp/pow/sqrt)
        if (r2 < cursorCutoffSq) {
          // B) CURSOR REPULSION: softened inverse-square
          // Optimized: pow(t, 1.5)  t * sqrt(t)
          const t = r2 + eps2;
          const denom = t * Math.sqrt(t);

          if (denom > 0.001) {
            cursorAccelX = CONFIG.CURSOR_MASS * dx / denom;
            cursorAccelY = CONFIG.CURSOR_MASS * dy / denom;

            // Clamp cursor acceleration (compare squared first)
            const cursorAccelMagSq = cursorAccelX * cursorAccelX + cursorAccelY * cursorAccelY;
            const maxAccelSq = CONFIG.CURSOR_ACCEL_MAX * CONFIG.CURSOR_ACCEL_MAX;
            if (cursorAccelMagSq > maxAccelSq) {
              const clampScale = CONFIG.CURSOR_ACCEL_MAX / Math.sqrt(cursorAccelMagSq);
              cursorAccelX *= clampScale;
              cursorAccelY *= clampScale;
            }

            cursorAccelX *= cursorScale;
            cursorAccelY *= cursorScale;
          }

          // C) WAKE DRAG: Gaussian falloff
          const gaussian = Math.exp(-r2 / sigma2x2);
          wakeAccelX = this.mouseVelX * CONFIG.WAKE_STRENGTH * gaussian * cursorScale;
          wakeAccelY = this.mouseVelY * CONFIG.WAKE_STRENGTH * gaussian * cursorScale;

          // Swirl: tangential flow (only if not too close)
          if (r2 > 1) {
            const r = Math.sqrt(r2);
            const tx = -dy / r;
            const ty = dx / r;
            wakeAccelX += tx * CONFIG.SWIRL_STRENGTH * gaussian * cursorScale;
            wakeAccelY += ty * CONFIG.SWIRL_STRENGTH * gaussian * cursorScale;
          }
        }
      }

      // 
      // D) IDLE DRIFT (continuous sine noise)
      // 
      const driftX = Math.sin(timeFactorX + p.phaseX) * CONFIG.DRIFT_AMPLITUDE * driftScale;
      const driftY = Math.sin(timeFactorY + p.phaseY) * CONFIG.DRIFT_AMPLITUDE * driftScale;

      // 
      // APPLY FORCES (dt-scaled)
      // 
      p.vx += (homeAccelX + cursorAccelX + wakeAccelX + driftX) * dt;
      p.vy += (homeAccelY + cursorAccelY + wakeAccelY + driftY) * dt;

      // Damping
      p.vx *= CONFIG.DAMPING;
      p.vy *= CONFIG.DAMPING;

      // Clamp speed (lazy sqrt: compare squared first)
      const speedSq = p.vx * p.vx + p.vy * p.vy;
      if (speedSq > maxSpeedSq) {
        const scale = CONFIG.MAX_SPEED / Math.sqrt(speedSq);
        p.vx *= scale;
        p.vy *= scale;
      }

      // Update position
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      // 
      // E) HARD DISPLACEMENT CAP (safety: prevent global collapse)
      // 
      const finalDistX = p.x - p.homeX;
      const finalDistY = p.y - p.homeY;
      const finalDist = Math.sqrt(finalDistX * finalDistX + finalDistY * finalDistY);
      if (finalDist > CONFIG.HOME_MAX_DISPLACEMENT) {
        // Project back toward home
        const capScale = CONFIG.HOME_MAX_DISPLACEMENT / finalDist;
        p.x = p.homeX + finalDistX * capScale;
        p.y = p.homeY + finalDistY * capScale;
        // Also dampen velocity toward home to prevent bouncing
        p.vx *= 0.5;
        p.vy *= 0.5;
      }
    }

    // Gradual velocity decay when not receiving pointer events
    const timeSincePointer = now - this.lastPointerTime;
    if (timeSincePointer > 50) {
      this.mouseVelX *= 0.92;
      this.mouseVelY *= 0.92;
    }

    // Phase 0: End physics timing, start render timing
    const physicsEnd = performance.now();
    const physicsMs = physicsEnd - physicsStart;

    const renderStart = performance.now();
    this.render();
    const renderEnd = performance.now();
    const renderMs = renderEnd - renderStart;

    // Phase 0: Store in ring buffer and log periodically
    if (CONFIG.DEBUG_PERF) {
      this.perfFrameMs[this.perfIndex] = frameMs;
      this.perfPhysicsMs[this.perfIndex] = physicsMs;
      this.perfRenderMs[this.perfIndex] = renderMs;
      this.perfIndex = (this.perfIndex + 1) % this.perfBufferSize;
      this.perfFrameCount++;

      // Log every 60 frames
      if (this.perfFrameCount % 60 === 0) {
        this.logPerfMetrics();
      }
    }

    this.animationId = requestAnimationFrame(this.boundAnimate);
  }

  // 
  // PERFORMANCE LOGGING (Phase 0)
  // 
  logPerfMetrics() {
    const samples = Math.min(this.perfFrameCount, this.perfBufferSize);
    if (samples < 10) return;  // Not enough data

    // Calculate averages
    let sumFrame = 0, sumPhysics = 0, sumRender = 0;
    for (let i = 0; i < samples; i++) {
      sumFrame += this.perfFrameMs[i];
      sumPhysics += this.perfPhysicsMs[i];
      sumRender += this.perfRenderMs[i];
    }
    const avgFrame = sumFrame / samples;
    const avgPhysics = sumPhysics / samples;
    const avgRender = sumRender / samples;

    // Calculate p95 frameMs (sort a copy, pick 95th percentile)
    const frameCopy = Array.from(this.perfFrameMs.subarray(0, samples)).sort((a, b) => a - b);
    const p95Index = Math.floor(samples * 0.95);
    const p95Frame = frameCopy[p95Index];

    // Estimate FPS
    const avgFps = avgFrame > 0 ? 1000 / avgFrame : 0;

    console.log(
      `[perf] frames=${samples} | avgFrame=${avgFrame.toFixed(2)}ms (${avgFps.toFixed(1)}fps) | p95=${p95Frame.toFixed(2)}ms | physics=${avgPhysics.toFixed(2)}ms | render=${avgRender.toFixed(2)}ms | particles=${this.particles.length}`
    );
  }

  // 
  // RENDER DISPATCHER
  // 
  render() {
    if (CONFIG.RENDER_MODE === 'imagedata') {
      this.renderImageData();
    } else {
      this.renderFillRect();
    }
  }

  // 
  // RENDER: ImageData / Uint32 buffer (Phase 1)
  // 
  renderImageData() {
    const buf32 = this.buf32;
    const bufWidth = this.bufWidth;
    const bufHeight = this.bufHeight;
    const dpr = this.dpr;

    // Clear buffer (transparent black)
    buf32.fill(0);

    // Write 1 device pixel per particle
    const particles = this.particles;
    const len = particles.length;

    for (let i = 0; i < len; i++) {
      const p = particles[i];

      // Convert CSS coords to device pixel coords (round to nearest)
      const px = (p.x * dpr + 0.5) | 0;
      const py = (p.y * dpr + 0.5) | 0;

      // Bounds check
      if (px >= 0 && px < bufWidth && py >= 0 && py < bufHeight) {
        const idx = py * bufWidth + px;
        buf32[idx] = PALETTE_UINT32[p.binIndex];
      }
    }

    // Single putImageData call
    this.ctx.putImageData(this.imageData, 0, 0);
  }

  // 
  // RENDER: fillRect fallback (legacy)
  // 
  renderFillRect() {
    const ctx = this.ctx;

    // Set transform for CSS-pixel coords with dpr scaling
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);

    // Draw from pre-built bins (no per-frame allocation)
    for (let b = 0; b < this.bins.length; b++) {
      const particles = this.bins[b];
      if (particles.length === 0) continue;

      ctx.fillStyle = PALETTE_STRINGS[b];

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        // Use fillRect for crisp square dots (faster than arc)
        const s = p.size;
        ctx.fillRect(p.x - s * 0.5, p.y - s * 0.5, s, s);
      }
    }

    // Reset to identity for consistency
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // 
  // DESTROY (full cleanup)
  // 
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

// 
// EXPORT & AUTO-INIT
// 
export const portraitParticles = new PortraitParticles();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => portraitParticles.init());
} else {
  portraitParticles.init();
}
