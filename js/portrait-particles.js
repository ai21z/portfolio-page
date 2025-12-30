// Portrait Particle Effect - Desktop only
// Particles form the portrait, scatter on cursor interaction, reform after inactivity
// v2: crisp canvas, space-drift motion, cursor wake carving, batched rendering

// 
// BRIGHTNESS: Multiplier for particle RGB (1.0 = original, 1.3 = 30% brighter)
// Adjust this to make the portrait clearer while preserving shade ratios
// 
const BRIGHTNESS_MULT = 1.35;  // boost overall brightness for clarity
const ALPHA_BOOST = 0.0;       // handled per-bin now

// 
// PALETTE: 6 bins from dark → light with 3D depth effect
// - Shadows: smaller particles, more transparent (recede)
// - Highlights: larger particles, more opaque (pop forward)
// 
// Size multipliers create depth: shadows shrink, highlights grow
// 
const PALETTE_BASE = [
  { r: 12, g: 28, b: 32, a: 0.35, size: 0.5 },   // bin 0: deep shadow - small, faint
  { r: 22, g: 45, b: 42, a: 0.50, size: 0.65 },  // bin 1: dark - teal tint
  { r: 45, g: 75, b: 60, a: 0.70, size: 0.85 },  // bin 2: mid shadow - necrotic
  { r: 70, g: 110, b: 85, a: 0.85, size: 1.0 },  // bin 3: mid tone - base size
  { r: 105, g: 145, b: 112, a: 0.94, size: 1.15 }, // bin 4: light mid - larger
  { r: 160, g: 185, b: 150, a: 1.0, size: 1.35 },  // bin 5: highlight - largest, solid
];

// Apply brightness multiplier (preserves ratios, clamps to 255)
const PALETTE = PALETTE_BASE.map(c => ({
  r: Math.min(255, Math.round(c.r * BRIGHTNESS_MULT)),
  g: Math.min(255, Math.round(c.g * BRIGHTNESS_MULT)),
  b: Math.min(255, Math.round(c.b * BRIGHTNESS_MULT)),
  a: Math.min(1, c.a + ALPHA_BOOST),
  size: c.size,  // size multiplier for 3D depth
}));

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
  DARK_SKIP_PROBABILITY: 0.2,   // probability to skip dark pixels (bins 0-1)

  // Cursor interaction radii (in CSS pixels)
  INNER_RADIUS: 45,             // strong force zone (tight cut)
  OUTER_RADIUS: 90,             // weak force zone (narrow falloff)
  PROXIMITY_MARGIN: 80,         // extra margin outside wrapper for "near" detection

  // Portrait crossfade (solid portrait → particles)
  PORTRAIT_IDLE_OPACITY: 0.2,   // portrait opacity when cursor is away (0 = invisible)
  ACTIVATION_RADIUS: 200,       // distance from wrapper edge where activation starts
  ACTIVATION_RAMP_MS: 300,      // ms to ramp activation up/down

  // Force magnitudes (strong slice, particles clear the path)
  RADIAL_PUSH: 0.45,            // outward push strength (strong to clear path)
  TANGENT_SWIRL: 0.03,          // perpendicular swirl strength (minimal)
  VELOCITY_DRAG: 0.2,           // cursor velocity influence
  MAX_SPEED: 12,                // clamp particle speed (higher for fast scatter)

  // Drift (idle animation)
  DRIFT_AMPLITUDE: 0.075,       // sine noise amplitude (1/4 of original 0.3)
  DRIFT_FREQUENCY: 0.0008,      // noise frequency (lower = slower)

  // Spring / damping
  DAMPING: 0.92,                // velocity decay per frame (slightly more drag)
  SPRING_NORMAL: 0.025,         // gravity to home during interaction (stronger pull back)
  SPRING_RECOVERY: 0.12,        // gravity to home during recovery (fast snap back)

  // Timing
  IDLE_THRESHOLD_MS: 200,       // ms before recovery mode kicks in (quick)
  RECOVERY_DURATION_MS: 400,    // ms for full recovery ramp (fast)

  // Debug
  DEBUG_PERF: false,            // Enable performance logging (toggle for profiling)

  // Rendering
  RENDER_MODE: 'imagedata',     // 'imagedata' (Phase 1) or 'fillrect' (legacy)
};

// 
// Simple hash for deterministic per-particle noise
// 
function hashNoise(seed, t) {
  const x = Math.sin(seed * 12.9898 + t * CONFIG.DRIFT_FREQUENCY) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1; // range -1..1
}

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
    this.mouseVelX = 0;
    this.mouseVelY = 0;
    this.isNearWrapper = false;
    this.lastInteractionTime = 0;
    this.lastPointerTime = 0;

    // Activation state (0 = solid portrait, 1 = fully particles)
    this.activationLevel = 0;
    this.targetActivation = 0;
    this.cursorDistToWrapper = 9999;
    this.cursorInsideWrapper = false;  // true when cursor is inside the wrapper rect

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
        
        // Size varies by bin for 3D depth (shadows small, highlights large)
        const binSize = PALETTE[binIndex].size;
        const baseSize = CONFIG.PARTICLE_SIZE_MIN + Math.random() * (CONFIG.PARTICLE_SIZE_MAX - CONFIG.PARTICLE_SIZE_MIN);

        const particle = {
          homeX,
          homeY,
          x: homeX,
          y: homeY,
          vx: 0,
          vy: 0,
          binIndex,
          size: baseSize * binSize,  // scaled by bin for 3D effect
          seed: Math.random() * 10000,  // for hashNoise drift
        };

        this.particles.push(particle);
        this.bins[binIndex].push(particle);  // Add to pre-built bin
      }
    }

    // Set portrait to idle opacity (semi-visible behind particles)
    if (this.img && this.particles.length > 0) {
      this.img.style.opacity = String(CONFIG.PORTRAIT_IDLE_OPACITY);
      this.img.style.transition = 'opacity 0.15s ease-out';
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
    // Get wrapper rect with margin for "near" detection
    const rect = this.wrapper.getBoundingClientRect();
    const margin = CONFIG.PROXIMITY_MARGIN;

    // Check if cursor is near the wrapper
    this.isNearWrapper =
      e.clientX >= rect.left - margin &&
      e.clientX <= rect.right + margin &&
      e.clientY >= rect.top - margin &&
      e.clientY <= rect.bottom + margin;

    // Calculate distance from cursor to wrapper edge (negative = inside)
    const distLeft = rect.left - e.clientX;
    const distRight = e.clientX - rect.right;
    const distTop = rect.top - e.clientY;
    const distBottom = e.clientY - rect.bottom;
    const distX = Math.max(distLeft, distRight, 0);
    const distY = Math.max(distTop, distBottom, 0);
    this.cursorDistToWrapper = Math.sqrt(distX * distX + distY * distY);
    
    // If inside wrapper, distance is negative (use 0)
    if (e.clientX >= rect.left && e.clientX <= rect.right &&
        e.clientY >= rect.top && e.clientY <= rect.bottom) {
      this.cursorDistToWrapper = 0;
      this.cursorInsideWrapper = true;
    } else {
      this.cursorInsideWrapper = false;
    }

    // Set target activation based on distance
    // 0 = cursor far away (solid portrait), 1 = cursor touching (pure particles)
    if (this.cursorDistToWrapper <= 0) {
      this.targetActivation = 1;  // inside wrapper = fully active
    } else if (this.cursorDistToWrapper < CONFIG.ACTIVATION_RADIUS) {
      this.targetActivation = 1 - (this.cursorDistToWrapper / CONFIG.ACTIVATION_RADIUS);
    } else {
      this.targetActivation = 0;  // far away = solid portrait
    }

    // Convert to wrapper-local coords
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;

    // Calculate velocity
    this.mouseVelX = localX - this.mouseX;
    this.mouseVelY = localY - this.mouseY;

    this.prevMouseX = this.mouseX;
    this.prevMouseY = this.mouseY;
    this.mouseX = localX;
    this.mouseY = localY;

    // Track when we last received a pointer event (for velocity decay)
    this.lastPointerTime = performance.now();

    // Update interaction time if near wrapper
    if (this.isNearWrapper) {
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

    // Smooth activation ramping
    const activationDelta = (this.targetActivation - this.activationLevel);
    const rampSpeed = dt * (1000 / CONFIG.ACTIVATION_RAMP_MS) / 60;  // normalize to 60fps
    if (Math.abs(activationDelta) < rampSpeed) {
      this.activationLevel = this.targetActivation;
    } else {
      this.activationLevel += Math.sign(activationDelta) * rampSpeed;
    }

    // Update portrait opacity based on activation (solid when inactive)
    if (this.img) {
      const portraitOpacity = CONFIG.PORTRAIT_IDLE_OPACITY * (1 - this.activationLevel);
      this.img.style.opacity = String(portraitOpacity);
    }

    const timeSinceInteraction = now - this.lastInteractionTime;

    // Recovery: ramp spring from SPRING_NORMAL to SPRING_RECOVERY after idle
    const isRecovering = this.activationLevel < 0.1 && timeSinceInteraction > CONFIG.IDLE_THRESHOLD_MS;

    let springK = CONFIG.SPRING_NORMAL;
    // Drift scales with activation: 0.25 when idle, 1.0 when fully active
    let driftScale = 0.25 + this.activationLevel * 0.75;

    if (isRecovering) {
      const progress = Math.min(1, (timeSinceInteraction - CONFIG.IDLE_THRESHOLD_MS) / CONFIG.RECOVERY_DURATION_MS);
      springK = CONFIG.SPRING_NORMAL + (CONFIG.SPRING_RECOVERY - CONFIG.SPRING_NORMAL) * progress;
      driftScale = 0.25 * (1 - progress * 0.5);  // reduce to ~12.5% during full recovery
    }

    // Precompute constants
    const outerRadiusSq = CONFIG.OUTER_RADIUS * CONFIG.OUTER_RADIUS;
    const maxSpeedSq = CONFIG.MAX_SPEED * CONFIG.MAX_SPEED;
    
    // Colored particles (bins 0,1,4,5) scatter like sand when cursor inside
    // Green particles (bins 2,3) behave normally with spring
    const cursorInside = this.cursorInsideWrapper;

    // Update particles
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      
      // Determine if this is a "colored" particle (sand behavior) or green (normal)
      const isColoredParticle = p.binIndex <= 1 || p.binIndex >= 4;

      // 
      // A) HOME GRAVITY (simple linear spring)
      // For colored particles: no spring while cursor is inside (scatter like sand)
      // 
      const homeDistX = p.homeX - p.x;
      const homeDistY = p.homeY - p.y;
      
      let particleSpring = springK;
      if (isColoredParticle && cursorInside) {
        particleSpring = 0;  // no home gravity - scatter freely like sand
      }

      // 
      // B) CURSOR FORCES: radial push + tangent swirl + velocity drag
      // 
      let forceX = 0;
      let forceY = 0;

      if (this.isNearWrapper) {
        const dx = p.x - this.mouseX;
        const dy = p.y - this.mouseY;
        const r2 = dx * dx + dy * dy;

        // Early-out for particles outside outer radius
        if (r2 < outerRadiusSq && r2 > 0.1) {
          const dist = Math.sqrt(r2);
          const nx = dx / dist;  // normalized radial direction (outward)
          const ny = dy / dist;
          const tx = -ny;  // tangent direction
          const ty = nx;

          // Strength based on inner/outer radius zones
          let strength;
          if (dist < CONFIG.INNER_RADIUS) {
            // Inner zone: full strength ramping to zero at center
            strength = 1 - dist / CONFIG.INNER_RADIUS;
          } else {
            // Outer zone: fade from 40% to 0
            strength = (1 - (dist - CONFIG.INNER_RADIUS) / (CONFIG.OUTER_RADIUS - CONFIG.INNER_RADIUS)) * 0.4;
          }
          
          // Colored particles get pushed harder (sand scatter effect)
          if (isColoredParticle) {
            strength *= 1.8;
          }

          // Radial push (outward from cursor)
          forceX += nx * CONFIG.RADIAL_PUSH * strength;
          forceY += ny * CONFIG.RADIAL_PUSH * strength;

          // Tangent swirl (perpendicular flow)
          forceX += tx * CONFIG.TANGENT_SWIRL * strength;
          forceY += ty * CONFIG.TANGENT_SWIRL * strength;

          // Velocity drag (particles follow cursor motion)
          forceX += this.mouseVelX * CONFIG.VELOCITY_DRAG * strength;
          forceY += this.mouseVelY * CONFIG.VELOCITY_DRAG * strength;
        }
      }

      // 
      // C) IDLE DRIFT (hashNoise for organic feel)
      // Colored particles get extra drift when cursor inside (sand floating)
      // 
      let particleDriftScale = driftScale;
      if (isColoredParticle && cursorInside) {
        particleDriftScale = driftScale * 2.5;  // more floaty drift
      }
      const driftX = hashNoise(p.seed, now) * CONFIG.DRIFT_AMPLITUDE * particleDriftScale;
      const driftY = hashNoise(p.seed + 1000, now + 500) * CONFIG.DRIFT_AMPLITUDE * particleDriftScale;

      // 
      // APPLY FORCES (dt-scaled)
      // 
      p.vx += (forceX + driftX + homeDistX * particleSpring) * dt;
      p.vy += (forceY + driftY + homeDistY * particleSpring) * dt;

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
