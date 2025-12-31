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
  CANVAS_PAD: 180,

  // Flow target attraction (hover-driven, independent of cursor proximity)
  FLOW_STRENGTH: 0.12,
  FLOW_FALLOFF: 0.004,
  FLOW_RAMP_MS: 200,

  PORTRAIT_IDLE_OPACITY: 0.2,
  ACTIVATION_RADIUS: 200,
  ACTIVATION_RAMP_MS: 300,

  RADIAL_PUSH: 0.45,
  TANGENT_SWIRL: 0.03,
  VELOCITY_DRAG: 0.2,
  MAX_SPEED: 12,

  DRIFT_AMPLITUDE: 0.075,
  DRIFT_FREQUENCY: 0.0008,

  DAMPING: 0.92,
  SPRING_NORMAL: 0.025,
  SPRING_RECOVERY: 0.12,

  IDLE_THRESHOLD_MS: 200,
  RECOVERY_DURATION_MS: 400,

  DEBUG_PERF: false,
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

    // Flow target for attention system (portrait-local coords)
    this.flowTargetLocalX = null;
    this.flowTargetLocalY = null;
    this.flowLevel = 0;
    this.targetFlowLevel = 0;
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

        const particle = {
          homeX, homeY,
          x: homeX, y: homeY,
          vx: 0, vy: 0,
          binIndex,
          size: baseSize * binSize,
          seed: Math.random() * 10000,
        };

        this.particles.push(particle);
        this.bins[binIndex].push(particle);
      }
    }

    if (this.img && this.particles.length > 0) {
      this.img.style.opacity = String(CONFIG.PORTRAIT_IDLE_OPACITY);
      this.img.style.transition = 'opacity 0.15s ease-out';
    }

    console.log('[particles]', this.particles.length);
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

    // Flow level ramped independently (not tied to cursor proximity)
    const flowDelta = this.targetFlowLevel - this.flowLevel;
    const flowRampSpeed = dt * (1000 / CONFIG.FLOW_RAMP_MS) / 60;
    if (Math.abs(flowDelta) < flowRampSpeed) {
      this.flowLevel = this.targetFlowLevel;
    } else {
      this.flowLevel += Math.sign(flowDelta) * flowRampSpeed;
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

    // Flow target in portrait-local coords
    const hasFlowTarget = this.flowTargetLocalX !== null && this.flowLevel > 0.01;

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      const isColoredParticle = p.binIndex <= 1 || p.binIndex >= 4;

      const homeDistX = p.homeX - p.x;
      const homeDistY = p.homeY - p.y;

      // Colored particles: no spring when cursor inside (sand scatter)
      let particleSpring = springK;
      if (isColoredParticle && cursorInside) particleSpring = 0;

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

      // Flow force: dust particles attracted toward flow target (hover-driven)
      // Independent of cursor proximity (activationLevel)
      if (hasFlowTarget && isColoredParticle) {
        const dx = this.flowTargetLocalX - p.x;
        const dy = this.flowTargetLocalY - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 1) {
          const nx = dx / dist;
          const ny = dy / dist;
          // Attraction with distance falloff
          const strength = CONFIG.FLOW_STRENGTH * this.flowLevel * (1 / (1 + dist * CONFIG.FLOW_FALLOFF));
          forceX += nx * strength;
          forceY += ny * strength;
        }
      }

      let particleDriftScale = driftScale;
      if (isColoredParticle && cursorInside) particleDriftScale = driftScale * 2.5;

      const driftX = hashNoise(p.seed, now) * CONFIG.DRIFT_AMPLITUDE * particleDriftScale;
      const driftY = hashNoise(p.seed + 1000, now + 500) * CONFIG.DRIFT_AMPLITUDE * particleDriftScale;

      p.vx += (forceX + driftX + homeDistX * particleSpring) * dt;
      p.vy += (forceY + driftY + homeDistY * particleSpring) * dt;

      p.vx *= CONFIG.DAMPING;
      p.vy *= CONFIG.DAMPING;

      const speedSq = p.vx * p.vx + p.vy * p.vy;
      if (speedSq > maxSpeedSq) {
        const scale = CONFIG.MAX_SPEED / Math.sqrt(speedSq);
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

  // Set flow target from viewport coords (hover-driven attention)
  // Converts to portrait-local coords internally
  setFlowTargetVp(vpX, vpY) {
    const rect = this.wrapper.getBoundingClientRect();
    this.flowTargetLocalX = vpX - rect.left;
    this.flowTargetLocalY = vpY - rect.top;
    this.targetFlowLevel = 1;
  }

  // Clear flow target
  clearFlowTarget() {
    this.flowTargetLocalX = null;
    this.flowTargetLocalY = null;
    this.targetFlowLevel = 0;
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
