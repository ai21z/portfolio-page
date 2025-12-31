// Portrait Particle Effect - Desktop only

const BRIGHTNESS_MULT = 1.35;
const ALPHA_BOOST = 0.0;

// Palette: 6 bins, shadows→highlights. Size creates 3D depth.
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

// Endianness detected for Uint32 buffer
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
  SAMPLE_SPACING: 1,
  PARTICLE_SKIP_PROBABILITY: 0.0,
  PARTICLE_SIZE_MIN: 0.6,
  PARTICLE_SIZE_MAX: 1.1,
  BRIGHTNESS_THRESHOLD: 8,
  ALPHA_THRESHOLD: 180,
  DARK_SKIP_PROBABILITY: 0.2,

  INNER_RADIUS: 45,
  OUTER_RADIUS: 90,
  PROXIMITY_MARGIN: 80,

  // Canvas padding to prevent visible rectangle edge
  // Large padding so dust can stream toward distant nav elements
  CANVAS_PAD: 850,

  // Dust streaming (nav hover - dust particles flow toward target in ribbons)
  STREAM_STRENGTH: 0.45,            // Pull toward target (stronger = faster)
  STREAM_CURVE_SCALE: 40,           // How much streams curve (seed-based)
  STREAM_CURVE_FREQ: 0.004,         // Frequency of curve oscillation
  STREAM_ORBIT_RADIUS: 45,          // Radius at which particles start orbiting
  STREAM_ORBIT_SPEED: 0.12,         // Tangential orbit speed
  STREAM_SPRING_CUT: 1.0,           // Full spring cut for streaming dust
  STREAM_RAMP_MS: 150,              // Time to reach full streaming (faster)
  REFORM_RAMP_MS: 300,              // Time to reform
  STREAM_DAMPING: 0.97,             // Less damping = particles travel further
  STREAM_BURST_STRENGTH: 0.8,       // Initial outward burst on hover start
  STREAM_BURST_DURATION_MS: 120,    // How long the burst phase lasts
  STREAM_MAX_SPEED: 20,             // Higher speed limit for streaming
  
  // Staggered launch - particles peel away gradually based on distance
  STREAM_STAGGER_MS: 350,           // Max delay for furthest particles to launch
  STREAM_STAGGER_RANDOMNESS: 0.3,   // Random variation in launch timing (0-1)
  
  // Speed tiers - particles travel at different speeds for organic feel
  STREAM_SPEED_FAST: 1.4,           // Fast tier multiplier (~30% of particles)
  STREAM_SPEED_MEDIUM: 1.0,         // Medium tier multiplier (~40% of particles)
  STREAM_SPEED_SLOW: 0.6,           // Slow tier multiplier (~30% of particles)
  
  // Staggered reform - particles return as cohesive stream, then disperse to homes
  REFORM_STAGGER_MS: 800,           // Max delay spread for head-body-tail effect
  REFORM_STAGGER_RANDOMNESS: 0.1,   // Less randomness for cleaner stream look
  REFORM_FORCE: 0.7,                // Active pull force during stream phase
  REFORM_DAMPING: 0.95,             // Damping during reform travel
  REFORM_STREAM_PHASE_DIST: 150,    // Distance at which particles switch from "stream" to "home" targeting

  // Eyes reveal (click easter egg)
  // Eye regions as fractions of portrait dimensions [x, y, radiusX, radiusY]
  // Adjust these to match your actual eye positions!
  LEFT_EYE: { cx: 0.38, cy: 0.38, rx: 0.09, ry: 0.045 },
  RIGHT_EYE: { cx: 0.62, cy: 0.38, rx: 0.09, ry: 0.045 },
  EYE_REVEAL_SCATTER: 0.8,          // Force pushing non-eye particles away
  EYE_REVEAL_SPRING: 0.15,          // Strong spring keeping eye particles in place
  EYE_REVEAL_RAMP_MS: 300,

  PORTRAIT_IDLE_OPACITY: 0.2,
  ACTIVATION_RADIUS: 200,
  ACTIVATION_RAMP_MS: 300,

  RADIAL_PUSH: 0.45,
  TANGENT_SWIRL: 0.03,
  VELOCITY_DRAG: 0.2,
  MAX_SPEED: 12,
  MAX_SPEED_DISINTEGRATE: 25,       // Higher speed limit during disintegration

  DRIFT_AMPLITUDE: 0.075,
  DRIFT_FREQUENCY: 0.0008,

  DAMPING: 0.92,
  SPRING_NORMAL: 0.025,
  SPRING_RECOVERY: 0.12,

  IDLE_THRESHOLD_MS: 200,
  RECOVERY_DURATION_MS: 400,

  DEBUG_PERF: false,
  DEBUG_FLOW: false,
  DEBUG_EYES: false,  // Draw eye regions
  RENDER_MODE: 'imagedata',
};

function hashNoise(seed, t) {
  const x = Math.sin(seed * 12.9898 + t * CONFIG.DRIFT_FREQUENCY) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
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

    this.animationId = null;
    this.running = false;
    this.initialized = false;
    this.lastFrameTime = 0;

    this.intersectionObserver = null;
    this.mutationObserver = null;
    this.isVisible = false;

    this.boundHandlePointerMove = this.handlePointerMove.bind(this);
    this.boundHandleVisibilityChange = this.handleVisibilityChange.bind(this);
    this.boundHandleResize = this.handleResize.bind(this);
    this.boundAnimate = this.animate.bind(this);

    this.perfBufferSize = 300;
    this.perfIndex = 0;
    this.perfFrameMs = new Float32Array(300);
    this.perfPhysicsMs = new Float32Array(300);
    this.perfRenderMs = new Float32Array(300);
    this.perfFrameCount = 0;
    this.lastPerfLogTime = 0;

    // Disintegration state (nav hover - particles fly toward target)
    this.streamTarget = null;  // {x, y} in local coords - where dust streams to
    this.streamLevel = 0;       // 0-1 ramped level
    this.streamStartTime = 0;   // For time-based effects
    this.burstApplied = false;  // Track if initial burst was applied
    this.streamLaunchDelays = null;  // Per-particle launch delays for staggered effect
    
    // Reform state (staggered return to portrait)
    this.isReforming = false;
    this.reformStartTime = 0;
    this.reformDelays = null;  // Per-particle reform delays (ms)
    this.reformNormalizedDelays = null;  // 0-1 normalized for speed correlation
    this.reformStreamTarget = null;  // Common target all particles stream toward first

    // Eye reveal state (click easter egg)
    this.eyeRevealActive = false;
    this.eyeRevealLevel = 0;
    this.targetEyeRevealLevel = 0;
  }

  init(wrapperSelector = '.portrait-wrap') {
    if (this.initialized) return;
    if (window.matchMedia('(pointer: coarse)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

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
    this.setupObservers();
    this.setupEventListeners();
    this.initialized = true;

    const introSection = document.querySelector('.stage[data-section="intro"]');
    if (introSection?.classList.contains('active-section')) {
      this.start();
    }
  }

  createCanvas() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'portrait-particles-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    
    // Set CSS variable for padding (used by CSS for positioning)
    this.wrapper.style.setProperty('--pp-pad', CONFIG.CANVAS_PAD + 'px');
    
    this.wrapper.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d', { alpha: true });
    this.resize();
  }

  resize() {
    this.width = this.img.clientWidth;
    this.height = this.img.clientHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    const pad = CONFIG.CANVAS_PAD;
    const pad2 = pad * 2;

    // Canvas is larger than wrapper to allow particles to escape without clipping
    this.bufWidth = Math.round((this.width + pad2) * this.dpr);
    this.bufHeight = Math.round((this.height + pad2) * this.dpr);
    this.canvas.width = this.bufWidth;
    this.canvas.height = this.bufHeight;
    this.canvas.style.width = (this.width + pad2) + 'px';
    this.canvas.style.height = (this.height + pad2) + 'px';

    this.imageData = this.ctx.createImageData(this.bufWidth, this.bufHeight);
    this.buf32 = new Uint32Array(this.imageData.data.buffer);
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

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
      console.warn('[particles] CORS error:', e);
      return;
    }
    const data = imageData.data;
    const spacing = CONFIG.SAMPLE_SPACING;
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
        if (Math.random() < CONFIG.PARTICLE_SKIP_PROBABILITY) continue;

        const binIndex = Math.min(PALETTE.length - 1, Math.floor((brightness / 255) * PALETTE.length));
        if (binIndex <= 1 && Math.random() < CONFIG.DARK_SKIP_PROBABILITY) continue;

        const homeX = x * scaleX;
        const homeY = y * scaleY;
        const binSize = PALETTE[binIndex].size;
        const baseSize = CONFIG.PARTICLE_SIZE_MIN + Math.random() * (CONFIG.PARTICLE_SIZE_MAX - CONFIG.PARTICLE_SIZE_MIN);

        // Check if particle is in eye region (for reveal effect)
        const normX = homeX / this.width;
        const normY = homeY / this.height;
        const inLeftEye = this.isInEllipse(normX, normY, CONFIG.LEFT_EYE);
        const inRightEye = this.isInEllipse(normX, normY, CONFIG.RIGHT_EYE);
        const isEye = inLeftEye || inRightEye;

        const particle = {
          homeX, homeY,
          x: homeX, y: homeY,
          vx: 0, vy: 0,
          binIndex,
          size: baseSize * binSize,
          seed: Math.random() * 10000,
          isEye,
        };

        this.particles.push(particle);
        this.bins[binIndex].push(particle);
      }
    }

    if (this.img && this.particles.length > 0) {
      this.img.style.opacity = String(CONFIG.PORTRAIT_IDLE_OPACITY);
      this.img.style.transition = 'opacity 0.15s ease-out';
    }

    const eyeCount = this.particles.filter(p => p.isEye).length;
    console.log('[particles]', this.particles.length, '| eyes:', eyeCount);
  }

  // Check if point is inside ellipse region
  isInEllipse(normX, normY, eye) {
    const dx = (normX - eye.cx) / eye.rx;
    const dy = (normY - eye.cy) / eye.ry;
    return (dx * dx + dy * dy) <= 1;
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
            else if (!isActive && this.running) this.stop();
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
    
    // Click inside portrait triggers eye reveal
    this.wrapper.addEventListener('click', (e) => {
      // Only trigger if click is inside the portrait bounds
      const rect = this.wrapper.getBoundingClientRect();
      const localX = e.clientX - rect.left;
      const localY = e.clientY - rect.top;
      
      if (localX >= 0 && localX <= this.width && localY >= 0 && localY <= this.height) {
        this.toggleEyeReveal();
      }
    });
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

    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;

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
    if (document.hidden) this.stop();
    else if (this.shouldRun()) this.start();
  }

  handleResize() {
    this.resize();
    this.sampleImage();
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

  animate() {
    if (!this.running) return;

    const now = performance.now();
    const frameMs = now - this.lastFrameTime;
    const rawDt = frameMs / 16.667;
    const dt = Math.max(0.5, Math.min(rawDt, 2));
    this.lastFrameTime = now;

    const physicsStart = performance.now();

    // Activation ramped smoothly
    const activationDelta = this.targetActivation - this.activationLevel;
    const rampSpeed = dt * (1000 / CONFIG.ACTIVATION_RAMP_MS) / 60;
    if (Math.abs(activationDelta) < rampSpeed) {
      this.activationLevel = this.targetActivation;
    } else {
      this.activationLevel += Math.sign(activationDelta) * rampSpeed;
    }

    // Stream level ramped
    const targetStreamLevel = this.streamTarget ? 1 : 0;
    const streamDelta = targetStreamLevel - this.streamLevel;
    const streamRampMs = this.streamTarget ? CONFIG.STREAM_RAMP_MS : CONFIG.REFORM_RAMP_MS;
    const streamRampSpeed = dt * (1000 / streamRampMs) / 60;
    if (Math.abs(streamDelta) < streamRampSpeed) {
      this.streamLevel = targetStreamLevel;
    } else {
      this.streamLevel += Math.sign(streamDelta) * streamRampSpeed;
    }
    
    // Eye reveal level ramped
    const eyeDelta = this.targetEyeRevealLevel - this.eyeRevealLevel;
    const eyeRampSpeed = dt * (1000 / 400) / 60;  // 400ms ramp
    if (Math.abs(eyeDelta) < eyeRampSpeed) {
      this.eyeRevealLevel = this.targetEyeRevealLevel;
    } else {
      this.eyeRevealLevel += Math.sign(eyeDelta) * eyeRampSpeed;
    }

    // Portrait opacity updated
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
    const maxSpeedSq = CONFIG.MAX_SPEED * CONFIG.MAX_SPEED;
    const cursorInside = this.cursorInsideWrapper;

    // Pre-compute streaming target in local coords
    const hasStream = this.streamLevel > 0.01 && this.streamTarget;
    const streamTargetX = hasStream ? this.streamTarget.x : 0;
    const streamTargetY = hasStream ? this.streamTarget.y : 0;
    const streamTime = hasStream ? (now - this.streamStartTime) : 0;
    
    // Eye reveal active?
    const hasEyeReveal = this.eyeRevealLevel > 0.01;

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      const isColoredParticle = p.binIndex <= 1 || p.binIndex >= 4;

      const homeDistX = p.homeX - p.x;
      const homeDistY = p.homeY - p.y;

      // Base spring strength
      let particleSpring = springK;
      
      // Colored particles: no spring when cursor inside (sand scatter) - keep this behavior
      if (isColoredParticle && cursorInside) particleSpring = 0;
      
      // Dust particles (bins 4-5 = highlights) stream to target
      const isDust = p.binIndex >= 4;
      
      // Streaming: cut spring for dust so they can fly away
      if (hasStream && isDust) {
        particleSpring *= (1 - this.streamLevel * CONFIG.STREAM_SPRING_CUT);
      }
      
      // Reforming: staggered return with head-body-tail stream effect
      // Furthest particles lead the way, creating a magical spell-like stream
      let isWaitingToReform = false;
      let isActivelyReforming = false;
      
      if (this.isReforming && isDust && this.reformDelays) {
        const reformTime = now - this.reformStartTime;
        const reformDelay = this.reformDelays[i];
        
        if (reformTime < reformDelay) {
          // WAITING: Particle hasn't started returning yet - FREEZE it
          isWaitingToReform = true;
          particleSpring = 0;  // No spring at all
        } else {
          // ACTIVE: This particle is now streaming home
          isActivelyReforming = true;
          
          // CRITICAL: Disable spring during travel - we use active forces only
          // Spring pulls to individual homes which would scatter the stream!
          const distToHome = Math.sqrt(homeDistX * homeDistX + homeDistY * homeDistY);
          const nearHome = distToHome < 20;
          
          if (nearHome) {
            // Very close to home - restore spring for final settle
            particleSpring = springK * 1.5;
          } else {
            // Still traveling - NO spring, use reform forces only
            particleSpring = 0;
          }
        }
      }
      
      // Eye reveal: eye particles get STRONGER spring, non-eye particles lose spring
      if (hasEyeReveal) {
        if (p.isEye) {
          // Eyes stay locked in place - strong spring
          particleSpring = CONFIG.EYE_REVEAL_SPRING + (springK - CONFIG.EYE_REVEAL_SPRING) * (1 - this.eyeRevealLevel);
        } else {
          // Non-eye particles lose their spring, scatter outward
          particleSpring *= (1 - this.eyeRevealLevel * 0.95);
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

      // DUST STREAMING: Pull dust particles toward target with staggered launch + speed tiers
      if (hasStream && isDust) {
        // Get this particle's launch delay
        const launchDelay = this.streamLaunchDelays ? this.streamLaunchDelays[i] : 0;
        const particleStreamTime = streamTime - launchDelay;
        
        // Only stream if this particle has "launched" (past its delay)
        if (particleStreamTime > 0) {
          const dx = streamTargetX - p.x;
          const dy = streamTargetY - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          
          // Speed tier based on seed (deterministic per-particle)
          const tierRoll = (p.seed % 100) / 100;
          let speedMult;
          if (tierRoll < 0.3) {
            speedMult = CONFIG.STREAM_SPEED_FAST;   // 30% fast
          } else if (tierRoll < 0.7) {
            speedMult = CONFIG.STREAM_SPEED_MEDIUM; // 40% medium
          } else {
            speedMult = CONFIG.STREAM_SPEED_SLOW;   // 30% slow
          }
          
          // Check if we're in burst phase (relative to this particle's launch)
          const inBurstPhase = particleStreamTime < CONFIG.STREAM_BURST_DURATION_MS;
          
          if (dist > 1) {
            const nx = dx / dist;
            const ny = dy / dist;
            
            // Perpendicular direction for curves
            const px = -ny;
            const py = nx;
            
            if (inBurstPhase) {
              // BURST PHASE: Push outward from home position first
              // Random outward burst direction (seeded for consistency)
              const burstAngle = p.seed * 6.28;
              const bx = Math.cos(burstAngle);
              const by = Math.sin(burstAngle);
              
              const burstFade = 1 - (particleStreamTime / CONFIG.STREAM_BURST_DURATION_MS);
              forceX += bx * CONFIG.STREAM_BURST_STRENGTH * burstFade * this.streamLevel * speedMult;
              forceY += by * CONFIG.STREAM_BURST_STRENGTH * burstFade * this.streamLevel * speedMult;
            } else {
              // Seed-based curve: each particle follows slightly different curved path
              const curvePhase = p.seed * 6.28 + particleStreamTime * CONFIG.STREAM_CURVE_FREQ;
              const curveAmount = Math.sin(curvePhase) * CONFIG.STREAM_CURVE_SCALE / (dist + 50);
              
              if (dist > CONFIG.STREAM_ORBIT_RADIUS) {
                // Flying toward target - apply attraction + curve, scaled by speed tier
                const attraction = CONFIG.STREAM_STRENGTH * this.streamLevel * speedMult;
                forceX += (nx + px * curveAmount * 0.3) * attraction;
                forceY += (ny + py * curveAmount * 0.3) * attraction;
              } else {
                // Close to target - orbit around it
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
      
      // REFORM FORCES: Two-phase return - stream together first, then disperse to homes
      if (isActivelyReforming && this.reformStreamTarget) {
        const distToHome = Math.sqrt(homeDistX * homeDistX + homeDistY * homeDistY);
        
        // Calculate distance to stream target (portrait center)
        const streamDx = this.reformStreamTarget.x - p.x;
        const streamDy = this.reformStreamTarget.y - p.y;
        const distToStream = Math.sqrt(streamDx * streamDx + streamDy * streamDy);
        
        // Speed tier CORRELATED with delay: early particles (head) are faster
        // This ensures head stays ahead, tail stays behind
        const normDelay = this.reformNormalizedDelays ? this.reformNormalizedDelays[i] : 0.5;
        // normDelay: 0 = head (first to leave), 1 = tail (last to leave)
        // Head gets fast speed, tail gets slow speed
        const speedMult = CONFIG.STREAM_SPEED_FAST - normDelay * (CONFIG.STREAM_SPEED_FAST - CONFIG.STREAM_SPEED_SLOW);
        
        if (distToStream > CONFIG.REFORM_STREAM_PHASE_DIST) {
          // PHASE 1: Far from portrait - stream TOGETHER toward portrait center
          // All particles head to the SAME target = cohesive stream
          if (distToStream > 5) {
            const nx = streamDx / distToStream;
            const ny = streamDy / distToStream;
            
            // Strong pull toward common target
            forceX += nx * CONFIG.REFORM_FORCE * speedMult;
            forceY += ny * CONFIG.REFORM_FORCE * speedMult;
          }
        } else {
          // PHASE 2: Close to portrait - now disperse to individual homes
          if (distToHome > 5) {
            const nx = homeDistX / distToHome;
            const ny = homeDistY / distToHome;
            
            // Pull toward individual home
            forceX += nx * CONFIG.REFORM_FORCE * speedMult * 0.8;
            forceY += ny * CONFIG.REFORM_FORCE * speedMult * 0.8;
          }
        }
      }
      
      // EYE REVEAL: Scatter non-eye particles outward from center
      if (hasEyeReveal && !p.isEye) {
        // Push outward from portrait center
        const centerX = this.width * 0.5;
        const centerY = this.height * 0.5;
        const dx = p.x - centerX;
        const dy = p.y - centerY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist > 1) {
          const nx = dx / dist;
          const ny = dy / dist;
          forceX += nx * CONFIG.EYE_REVEAL_SCATTER * this.eyeRevealLevel;
          forceY += ny * CONFIG.EYE_REVEAL_SCATTER * this.eyeRevealLevel;
        }
        
        // Extra chaos to make the scatter look organic
        const scatterChaos = (Math.random() - 0.5) * 0.3 * this.eyeRevealLevel;
        forceX += scatterChaos;
        forceY += scatterChaos;
      }

      let particleDriftScale = driftScale;
      if (isColoredParticle && cursorInside) particleDriftScale = driftScale * 2.5;

      const driftX = hashNoise(p.seed, now) * CONFIG.DRIFT_AMPLITUDE * particleDriftScale;
      const driftY = hashNoise(p.seed + 1000, now + 500) * CONFIG.DRIFT_AMPLITUDE * particleDriftScale;

      // Waiting particles: freeze completely (no forces, kill velocity)
      if (isWaitingToReform) {
        p.vx *= 0.85;  // Quickly dampen to stop
        p.vy *= 0.85;
      } else {
        p.vx += (forceX + driftX + homeDistX * particleSpring) * dt;
        p.vy += (forceY + driftY + homeDistY * particleSpring) * dt;
      }

      // Damping varies by state
      let damping = CONFIG.DAMPING;
      if (hasStream && isDust) {
        damping = CONFIG.STREAM_DAMPING;  // Less damping when streaming out
      } else if (isActivelyReforming) {
        damping = CONFIG.REFORM_DAMPING;  // Reform damping for smooth travel back
      }
      p.vx *= damping;
      p.vy *= damping;

      // Higher speed limit for streaming particles
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
      this.mouseVelX *= 0.92;
      this.mouseVelY *= 0.92;
    }

    const physicsEnd = performance.now();
    const physicsMs = physicsEnd - physicsStart;

    const renderStart = performance.now();
    this.render();
    const renderEnd = performance.now();
    const renderMs = renderEnd - renderStart;

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
    if (CONFIG.RENDER_MODE === 'imagedata') this.renderImageData();
    else this.renderFillRect();
    
    // Debug: draw eye ellipses
    if (CONFIG.DEBUG_EYES) {
      this.ctx.save();
      const pad = CONFIG.CANVAS_PAD;
      this.ctx.strokeStyle = 'rgba(255,0,255,0.8)';
      this.ctx.lineWidth = 2;
      
      for (const eye of [CONFIG.LEFT_EYE, CONFIG.RIGHT_EYE]) {
        const cx = eye.cx * this.width + pad;
        const cy = eye.cy * this.height + pad;
        const rx = eye.rx * this.width;
        const ry = eye.ry * this.height;
        
        this.ctx.beginPath();
        this.ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        this.ctx.stroke();
      }
      this.ctx.restore();
    }
  }

  renderImageData() {
    const buf32 = this.buf32;
    const bufWidth = this.bufWidth;
    const bufHeight = this.bufHeight;
    const dpr = this.dpr;
    const pad = CONFIG.CANVAS_PAD;

    buf32.fill(0);

    const particles = this.particles;
    const len = particles.length;

    for (let i = 0; i < len; i++) {
      const p = particles[i];
      // Offset by pad so particles at (0,0) render at (pad,pad) in buffer
      const px = ((p.x + pad) * dpr + 0.5) | 0;
      const py = ((p.y + pad) * dpr + 0.5) | 0;

      if (px >= 0 && px < bufWidth && py >= 0 && py < bufHeight) {
        buf32[py * bufWidth + px] = PALETTE_UINT32[p.binIndex];
      }
    }

    this.ctx.putImageData(this.imageData, 0, 0);
  }

  renderFillRect() {
    const ctx = this.ctx;
    const pad = CONFIG.CANVAS_PAD;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width + pad * 2, this.height + pad * 2);

    for (let b = 0; b < this.bins.length; b++) {
      const particles = this.bins[b];
      if (particles.length === 0) continue;

      ctx.fillStyle = PALETTE_STRINGS[b];
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const s = p.size;
        // Offset by pad
        ctx.fillRect(p.x + pad - s * 0.5, p.y + pad - s * 0.5, s, s);
      }
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // === DUST STREAMING API ===
  
  // Set stream target (local portrait coords)
  setStreamTarget(localX, localY) {
    if (!this.streamTarget) {
      this.streamStartTime = performance.now();
      // Calculate per-particle launch delays based on distance from target
      this.calculateLaunchDelays(localX, localY);
      // Clear any ongoing reform
      this.isReforming = false;
      this.reformDelays = null;
      this.reformNormalizedDelays = null;
      this.reformStreamTarget = null;
    }
    this.streamTarget = { x: localX, y: localY };
    console.log('[particles] Stream target set:', localX.toFixed(0), localY.toFixed(0));
  }
  
  // Calculate staggered launch delays - closer particles leave first
  calculateLaunchDelays(targetX, targetY) {
    const particles = this.particles;
    const len = particles.length;
    
    // Find max distance among dust particles for normalization
    let maxDist = 0;
    for (let i = 0; i < len; i++) {
      const p = particles[i];
      if (p.binIndex >= 4) {  // Only dust particles
        const dx = p.homeX - targetX;
        const dy = p.homeY - targetY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > maxDist) maxDist = dist;
      }
    }
    
    // Create delay array
    this.streamLaunchDelays = new Float32Array(len);
    const staggerMs = CONFIG.STREAM_STAGGER_MS;
    const randomness = CONFIG.STREAM_STAGGER_RANDOMNESS;
    
    for (let i = 0; i < len; i++) {
      const p = particles[i];
      if (p.binIndex >= 4 && maxDist > 0) {  // Dust particles
        const dx = p.homeX - targetX;
        const dy = p.homeY - targetY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        // Base delay: closer = less delay
        const normalizedDist = dist / maxDist;
        const baseDelay = normalizedDist * staggerMs;
        
        // Add seed-based randomness so it's not perfectly distance-ordered
        const randomOffset = (hashNoise(p.seed, 0) * 0.5 + 0.5) * randomness * staggerMs;
        
        this.streamLaunchDelays[i] = baseDelay + randomOffset;
      } else {
        this.streamLaunchDelays[i] = 0;
      }
    }
  }
  
  // Set stream target from viewport coords
  // Clamps target to stay within canvas bounds so particles don't fly off and disappear
  setStreamTargetVp(vpX, vpY) {
    const rect = this.wrapper.getBoundingClientRect();
    let localX = vpX - rect.left;
    let localY = vpY - rect.top;
    
    // Clamp to canvas bounds (pad - margin for orbit room)
    const margin = CONFIG.CANVAS_PAD - 30;  // Leave room for orbit
    localX = Math.max(-margin, Math.min(this.width + margin, localX));
    localY = Math.max(-margin, Math.min(this.height + margin, localY));
    
    this.setStreamTarget(localX, localY);
  }
  
  // Clear stream - dust reforms back to portrait with staggered return
  clearStream() {
    if (this.streamTarget) {
      // Calculate reform delays before clearing target
      this.calculateReformDelays();
      this.isReforming = true;
      this.reformStartTime = performance.now();
      // Set the common stream target = portrait center
      // All particles will head HERE first (creating cohesive stream),
      // then disperse to their individual homes when close
      this.reformStreamTarget = { x: this.width * 0.5, y: this.height * 0.5 };
    }
    this.streamTarget = null;
    this.streamLaunchDelays = null;
    console.log('[particles] Stream cleared - reforming as cohesive stream');
  }
  
  // Calculate staggered reform delays - creates head-body-tail stream effect
  // Uses RANDOM delays since particles are clustered together at the nav icon
  calculateReformDelays() {
    const particles = this.particles;
    const len = particles.length;
    
    // Create delay arrays
    this.reformDelays = new Float32Array(len);
    this.reformNormalizedDelays = new Float32Array(len);
    const staggerMs = CONFIG.REFORM_STAGGER_MS;
    
    // Use seeded random for consistent behavior but spread particles across full stagger range
    // This creates clear head-body-tail since particles are clustered together spatially
    for (let i = 0; i < len; i++) {
      const p = particles[i];
      if (p.binIndex >= 4) {  // Dust particles
        // Use seed to get deterministic "random" delay for each particle
        // This ensures same particle is always head/body/tail on repeat
        const seedRandom = (hashNoise(p.seed + 777, 0) + 1) * 0.5;  // 0-1
        
        // Full spread across stagger range
        const delay = seedRandom * staggerMs;
        
        this.reformDelays[i] = delay;
        this.reformNormalizedDelays[i] = seedRandom;  // 0 = head, 1 = tail
      } else {
        this.reformDelays[i] = 0;
        this.reformNormalizedDelays[i] = 0;
      }
    }
    
    console.log('[particles] Reform delays calculated - stagger:', staggerMs, 'ms');
  }
  
  // === EYE REVEAL API ===
  
  // Toggle eye reveal mode
  toggleEyeReveal() {
    if (this.eyeRevealActive) {
      this.cancelEyeReveal();
    } else {
      this.triggerEyeReveal();
    }
  }
  
  // Trigger eye reveal - scatter everything except eyes
  triggerEyeReveal() {
    this.eyeRevealActive = true;
    this.targetEyeRevealLevel = 1;
    console.log('[particles] Eye reveal triggered - stare into the void');
  }
  
  // Cancel eye reveal - reform face
  cancelEyeReveal() {
    this.eyeRevealActive = false;
    this.targetEyeRevealLevel = 0;
    console.log('[particles] Eye reveal cancelled - reforming');
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
