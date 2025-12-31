// Portrait Particle Effect - Desktop only

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

  CANVAS_PAD: 850,

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
  SIGIL_PATH: './artifacts/sigil/AZ-VZ-01.png',
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
    this.boundHandleClick = this.handleClick.bind(this);
    this.boundAnimate = this.animate.bind(this);

    this.perfBufferSize = 300;
    this.perfIndex = 0;
    this.perfFrameMs = new Float32Array(300);
    this.perfPhysicsMs = new Float32Array(300);
    this.perfRenderMs = new Float32Array(300);
    this.perfFrameCount = 0;
    this.lastPerfLogTime = 0;

    // Stream state
    this.streamTarget = null;
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

    const introSection = document.querySelector('.stage[data-section="intro"]');
    if (introSection?.classList.contains('active-section')) {
      this.start();
    }
  }

  createCanvas() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'portrait-particles-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    
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
  }

  sampleSigil() {
    const sigil = new Image();
    sigil.crossOrigin = 'anonymous';
    sigil.src = CONFIG.SIGIL_PATH;
    
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
      console.warn('[particles] Failed to load sigil image');
    };
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
    this.wrapper.addEventListener('click', this.boundHandleClick);
  }

  handleClick(e) {
    const rect = this.wrapper.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;

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

    const targetStreamLevel = this.streamTarget ? 1 : 0;
    const streamDelta = targetStreamLevel - this.streamLevel;
    const streamRampMs = this.streamTarget ? CONFIG.STREAM_RAMP_MS : CONFIG.REFORM_RAMP_MS;
    const streamRampSpeed = dt * (1000 / streamRampMs) / 60;
    if (Math.abs(streamDelta) < streamRampSpeed) {
      this.streamLevel = targetStreamLevel;
    } else {
      this.streamLevel += Math.sign(streamDelta) * streamRampSpeed;
    }
    
    const constDelta = this.targetConstellationLevel - this.constellationLevel;
    const constRampSpeed = dt * (1000 / CONFIG.CONSTELLATION_RAMP_MS) / 60;
    if (Math.abs(constDelta) < constRampSpeed) {
      this.constellationLevel = this.targetConstellationLevel;
    } else {
      this.constellationLevel += Math.sign(constDelta) * constRampSpeed;
    }

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

    const hasStream = this.streamLevel > 0.01 && this.streamTarget;
    const streamTargetX = hasStream ? this.streamTarget.x : 0;
    const streamTargetY = hasStream ? this.streamTarget.y : 0;
    const streamTime = hasStream ? (now - this.streamStartTime) : 0;
    
    const hasConstellation = this.constellationLevel > 0.01;

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

      if (isWaitingToReform) {
        p.vx *= 0.85;
        p.vy *= 0.85;
      } else {
        p.vx += (forceX + driftX + homeDistX * particleSpring) * dt;
        p.vy += (forceY + driftY + homeDistY * particleSpring) * dt;
      }

      let damping = CONFIG.DAMPING;
      if (hasStream && isDust) {
        damping = CONFIG.STREAM_DAMPING;
      } else if (isActivelyReforming) {
        damping = CONFIG.REFORM_DAMPING;
      }
      p.vx *= damping;
      p.vy *= damping;

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
        ctx.fillRect(p.x + pad - s * 0.5, p.y + pad - s * 0.5, s, s);
      }
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // === STREAMING API ===

  setStreamTarget(localX, localY) {
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
    const rect = this.wrapper.getBoundingClientRect();
    let localX = vpX - rect.left;
    let localY = vpY - rect.top;

    const margin = CONFIG.CANVAS_PAD - 30;
    localX = Math.max(-margin, Math.min(this.width + margin, localX));
    localY = Math.max(-margin, Math.min(this.height + margin, localY));

    this.setStreamTarget(localX, localY);
  }
  
  clearStream() {
    if (this.streamTarget) {
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
