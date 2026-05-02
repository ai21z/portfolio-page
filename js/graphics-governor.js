const STORAGE_KEY = 'vissarion.graphicsProfile';
const PROFILES = ['quiet', 'balanced', 'rich', 'full'];
const PROFILE_RANK = new Map(PROFILES.map((profile, index) => [profile, index]));

const PROFILE_BUDGETS = {
  quiet: {
    dprCap: 1,
    maxCanvasPixels: 1_200_000,
    frameIntervalMs: 1000 / 24,
    antialias: false,
    textureMaxSize: 768,
    particleScale: 0,
    geometryScale: 0.55,
    effectsScale: 0.25,
    allowWorkers: false,
    quiet: true
  },
  balanced: {
    dprCap: 1.25,
    maxCanvasPixels: 2_400_000,
    frameIntervalMs: 1000 / 30,
    antialias: false,
    textureMaxSize: 1024,
    particleScale: 0.55,
    geometryScale: 0.72,
    effectsScale: 0.65,
    allowWorkers: true,
    quiet: false
  },
  rich: {
    dprCap: 1.5,
    maxCanvasPixels: 4_000_000,
    frameIntervalMs: 0,
    antialias: true,
    textureMaxSize: 1536,
    particleScale: 0.85,
    geometryScale: 0.9,
    effectsScale: 0.9,
    allowWorkers: true,
    quiet: false
  },
  full: {
    dprCap: 1.75,
    maxCanvasPixels: 5_500_000,
    frameIntervalMs: 0,
    antialias: true,
    textureMaxSize: 1536,
    particleScale: 1,
    geometryScale: 1,
    effectsScale: 1,
    allowWorkers: true,
    quiet: false
  }
};

const subscribers = new Set();
const frameSamples = [];

let initialized = false;
let selectedProfile = readStoredProfile() || 'balanced';
let effectiveProfile = selectedProfile;
let downgradeSteps = 0;
let movementRegressionUntil = 0;
let lastPromotionCheck = 0;
let currentSection = 'intro';
let debugOverlay = null;
let webglCapabilityProbe = null;

export const GRAPHICS_PROFILES = PROFILES;

function isFirefox() {
  return /\bFirefox\//.test(navigator.userAgent);
}

function isWebKit() {
  return /AppleWebKit/i.test(navigator.userAgent)
    && !/(Chrome|Chromium|Edg|OPR|Firefox)/i.test(navigator.userAgent);
}

function isMobileViewport() {
  return window.innerWidth <= 760 || window.matchMedia('(pointer: coarse)').matches;
}

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function saveDataEnabled() {
  return Boolean(navigator.connection?.saveData);
}

function browserEngine() {
  if (isFirefox()) return 'firefox';
  if (isWebKit()) return 'webkit';
  if (/(Chrome|Chromium|Edg|OPR|CriOS)/i.test(navigator.userAgent)) return 'chromium';
  return 'unknown';
}

function viewportClass() {
  if (isMobileViewport()) return 'mobile';
  if (window.innerWidth <= 1100) return 'tablet';
  if (window.innerHeight <= 700) return 'short-desktop';
  return 'desktop';
}

function readCoarseNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function classifyRenderer(renderer) {
  const value = String(renderer || '').toLowerCase();
  if (!value) return 'unknown';
  if (/(swiftshader|llvmpipe|software|warp|basic render|mesa offscreen)/i.test(value)) return 'software';
  if (/(geforce|nvidia|rtx|gtx|radeon rx|radeon pro|quadro|arc\W|discrete)/i.test(value)) return 'discrete';
  if (/(intel|uhd|iris|apple m|apple gpu|radeon graphics|integrated)/i.test(value)) return 'integrated';
  return 'unknown';
}

function createProbeContext(options) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  try {
    return canvas.getContext('webgl2', options) || null;
  } catch {
    return null;
  } finally {
    canvas.width = 1;
    canvas.height = 1;
  }
}

function readRendererCategory(gl) {
  if (!gl) return 'unknown';
  try {
    const debugInfo = gl.getExtension?.('WEBGL_debug_renderer_info');
    const renderer = debugInfo
      ? gl.getParameter?.(debugInfo.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter?.(gl.RENDERER);
    return classifyRenderer(renderer);
  } catch {
    return 'unknown';
  }
}

function probeWebGL2Capability() {
  if (webglCapabilityProbe) return webglCapabilityProbe;

  const normalContext = createProbeContext({
    antialias: false,
    powerPreference: 'high-performance'
  });
  const caveatContext = createProbeContext({
    failIfMajorPerformanceCaveat: true,
    antialias: false,
    powerPreference: 'high-performance'
  });
  const webgl2 = Boolean(normalContext);
  const webgl2PerformanceOk = Boolean(caveatContext);

  webglCapabilityProbe = {
    webgl2,
    webgl2PerformanceOk,
    majorPerformanceCaveat: webgl2 && !webgl2PerformanceOk,
    rendererCategory: readRendererCategory(normalContext || caveatContext)
  };
  return webglCapabilityProbe;
}

function hardwareClass({ hardwareConcurrency, deviceMemory, rendererCategory }) {
  if (rendererCategory === 'software') return 'weak';
  if ((hardwareConcurrency !== null && hardwareConcurrency <= 2)
    || (deviceMemory !== null && deviceMemory <= 2)) {
    return 'weak';
  }
  if ((hardwareConcurrency !== null && hardwareConcurrency <= 4)
    || (deviceMemory !== null && deviceMemory <= 4)
    || rendererCategory === 'integrated') {
    return 'modest';
  }
  if ((hardwareConcurrency === null || hardwareConcurrency >= 8)
    && (deviceMemory === null || deviceMemory >= 8)
    && rendererCategory === 'discrete') {
    return 'strong';
  }
  return 'capable';
}

function getGraphicsCapability() {
  const hardwareConcurrency = readCoarseNumber(navigator.hardwareConcurrency);
  const deviceMemory = readCoarseNumber(navigator.deviceMemory);
  const engine = browserEngine();
  const viewport = viewportClass();
  const webgl = probeWebGL2Capability();
  const reducedMotion = prefersReducedMotion();
  const saveData = saveDataEnabled();
  const reasons = [];

  if (reducedMotion) reasons.push('reduced-motion');
  if (saveData) reasons.push('save-data');
  if (!webgl.webgl2) reasons.push('no-webgl2');
  if (webgl.majorPerformanceCaveat) reasons.push('major-performance-caveat');
  if (hardwareConcurrency !== null && hardwareConcurrency <= 2) reasons.push('low-hardware-concurrency');
  if (deviceMemory !== null && deviceMemory <= 2) reasons.push('low-device-memory');
  if (webgl.rendererCategory === 'software') reasons.push('software-renderer');

  const classification = hardwareClass({
    hardwareConcurrency,
    deviceMemory,
    rendererCategory: webgl.rendererCategory
  });

  let recommendedProfile = 'balanced';
  const quietReasons = new Set([
    'reduced-motion',
    'save-data',
    'no-webgl2',
    'major-performance-caveat',
    'software-renderer'
  ]);

  if (reasons.some((reason) => quietReasons.has(reason))) {
    recommendedProfile = 'quiet';
  } else if (engine === 'firefox' || engine === 'webkit') {
    recommendedProfile = 'balanced';
    reasons.push(`${engine}-conservative`);
  } else if (classification === 'weak') {
    recommendedProfile = 'balanced';
    reasons.push('weak-hardware');
  } else if (classification === 'modest' || viewport === 'mobile' || viewport === 'tablet' || viewport === 'short-desktop') {
    recommendedProfile = 'balanced';
    if (classification === 'modest') reasons.push('modest-hardware');
    if (viewport !== 'desktop') reasons.push(viewport);
  } else if (engine === 'chromium' && classification === 'strong' && webgl.webgl2PerformanceOk) {
    recommendedProfile = 'rich';
    reasons.push('strong-chromium-webgl');
  } else {
    reasons.push('standard-capability');
  }

  return {
    recommendedProfile,
    reasons: Array.from(new Set(reasons)),
    engine,
    viewportClass: viewport,
    reducedMotion,
    saveData,
    hardwareConcurrency,
    deviceMemory,
    webgl2: webgl.webgl2,
    webgl2PerformanceOk: webgl.webgl2PerformanceOk,
    majorPerformanceCaveat: webgl.majorPerformanceCaveat,
    rendererCategory: webgl.rendererCategory,
    hardwareClass: classification
  };
}

function validProfile(profile) {
  return PROFILE_RANK.has(profile);
}

function readStoredProfile() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return validProfile(stored) ? stored : null;
  } catch {
    return null;
  }
}

function writeStoredProfile(profile) {
  try {
    window.localStorage.setItem(STORAGE_KEY, profile);
  } catch {
    // Ignore private browsing/storage denial.
  }
}

function profileAt(index) {
  return PROFILES[Math.max(0, Math.min(PROFILES.length - 1, index))];
}

function rank(profile) {
  return PROFILE_RANK.get(profile) ?? PROFILE_RANK.get('balanced');
}

function formatProfile(profile) {
  return profile ? `${profile[0].toUpperCase()}${profile.slice(1)}` : 'Balanced';
}

function recommendationReason(state) {
  const capabilityReasons = state.capability?.reasons || [];
  if (capabilityReasons.length > 0) {
    return capabilityReasons.map((reason) => reason.replaceAll('-', ' ')).join(', ');
  }
  if (state.reducedMotion) return 'reduced motion is enabled';
  if (state.saveData) return 'save-data is enabled';
  if (state.firefox) return 'Firefox receives a safer WebGL budget';
  if (state.webkit) return 'WebKit receives a safer WebGL budget';
  if (state.mobile) return 'small or touch viewport';
  if (state.movementRegression) return 'recent movement or long frames';
  if (state.downgradeSteps > 0) return 'recent long frames';
  if (state.profile !== state.effectiveProfile) return 'runtime capability budget';
  return 'standard browser settings';
}

function selectedProfileAllowsPortraitStreaming() {
  return selectedProfile === 'rich' || selectedProfile === 'full';
}

function mergeBudget(profile, extras = {}) {
  return {
    profile: selectedProfile,
    effectiveProfile: profile,
    ...PROFILE_BUDGETS[profile],
    ...extras
  };
}

function ownerSectionForSystem(systemName) {
  if (systemName === 'intro-spores' || systemName === 'intro-sparks' || systemName === 'portrait-particles') return 'intro';
  if (systemName === 'blog-network') return 'blog';
  if (systemName === 'work-globe') return 'work';
  return null;
}

function computeEffectiveProfile() {
  const capability = getGraphicsCapability();

  if (capability.recommendedProfile === 'quiet') return 'quiet';

  let index = rank(selectedProfile);
  if (rank(capability.recommendedProfile) <= rank('balanced')) {
    index = Math.min(index, rank(capability.recommendedProfile));
  }

  if (isFirefox() || isWebKit()) {
    index = Math.min(index, rank('balanced'));
  }

  if (isMobileViewport()) {
    index = Math.min(index, rank(selectedProfile === 'full' ? 'rich' : 'balanced'));
  }

  index = Math.max(0, index - downgradeSteps);

  if (performance.now() < movementRegressionUntil) {
    index = Math.max(0, index - 1);
  }

  return profileAt(index);
}

function updateDocumentState(reason = 'state') {
  const nextEffective = computeEffectiveProfile();
  const changed = nextEffective !== effectiveProfile;
  effectiveProfile = nextEffective;

  document.documentElement.dataset.graphicsProfile = selectedProfile;
  document.documentElement.dataset.graphicsEffectiveProfile = effectiveProfile;
  document.documentElement.dataset.graphicsSection = currentSection;
  document.documentElement.dataset.graphicsReducedMotion = String(prefersReducedMotion());
  const capability = getGraphicsCapability();
  document.documentElement.dataset.graphicsRecommendedProfile = capability.recommendedProfile;
  document.documentElement.dataset.graphicsHardwareClass = capability.hardwareClass;

  syncControl();
  updateDebugOverlay();

  if (changed || reason === 'profile' || reason === 'section') {
    notifySubscribers(reason);
  }
}

function notifySubscribers(reason) {
  const state = getGraphicsState();
  window.dispatchEvent(new CustomEvent('graphics:profile-change', { detail: { ...state, reason } }));
  window.dispatchEvent(new CustomEvent('dpr-changed', { detail: { ...state, reason } }));
  subscribers.forEach((callback) => {
    try {
      callback(state);
    } catch (error) {
      console.warn('[graphics] subscriber failed:', error);
    }
  });
}

function syncControl() {
  const root = document.querySelector('[data-graphics-control]');
  if (!root) return;

  const toggle = root.querySelector('.graphics-control__toggle');
  if (toggle) {
    toggle.textContent = `Graphics: ${formatProfile(selectedProfile)}`;
  }

  root.querySelectorAll('[data-graphics-profile]').forEach((button) => {
    const active = button.getAttribute('data-graphics-profile') === selectedProfile;
    button.setAttribute('aria-pressed', String(active));
  });

  const state = getGraphicsState();
  const status = root.querySelector('[data-graphics-help-status]');
  if (status) {
    const selectedSuffix = state.profile === state.capability.recommendedProfile
      ? ''
      : ` (${formatProfile(state.profile)} selected)`;
    status.textContent = `Current recommendation: ${formatProfile(state.capability.recommendedProfile)}${selectedSuffix}`;
  }

  const reason = root.querySelector('[data-graphics-help-reason]');
  if (reason) {
    reason.textContent = `Reason: ${recommendationReason(state)}`;
  }
}

function wireControl() {
  const root = document.querySelector('[data-graphics-control]');
  if (!root || root.__graphicsControlBound) return;
  root.__graphicsControlBound = true;

  const toggle = root.querySelector('.graphics-control__toggle');
  const info = root.querySelector('.graphics-control__info');
  const menu = root.querySelector('.graphics-control__menu');
  const help = root.querySelector('.graphics-control__help');
  let lastTogglePointerActivation = 0;
  let lastInfoPointerActivation = 0;

  const isPrimaryPointer = (event) => !('button' in event) || event.button === 0;
  const isRecentPointerActivation = (timestamp) => timestamp && performance.now() - timestamp < 500;

  const setMenuOpen = (open) => {
    if (open) {
      menu?.removeAttribute('hidden');
      toggle?.setAttribute('aria-expanded', 'true');
      help?.setAttribute('hidden', '');
      info?.setAttribute('aria-expanded', 'false');
    } else {
      menu?.setAttribute('hidden', '');
      toggle?.setAttribute('aria-expanded', 'false');
    }
  };

  const setHelpOpen = (open) => {
    if (open) {
      syncControl();
      help?.removeAttribute('hidden');
      info?.setAttribute('aria-expanded', 'true');
      menu?.setAttribute('hidden', '');
      toggle?.setAttribute('aria-expanded', 'false');
    } else {
      help?.setAttribute('hidden', '');
      info?.setAttribute('aria-expanded', 'false');
    }
  };

  toggle?.addEventListener('pointerdown', (event) => {
    if (!isPrimaryPointer(event)) return;
    lastTogglePointerActivation = performance.now();
    setMenuOpen(menu?.hasAttribute('hidden'));
  });

  toggle?.addEventListener('click', () => {
    if (isRecentPointerActivation(lastTogglePointerActivation)) return;
    setMenuOpen(menu?.hasAttribute('hidden'));
  });

  info?.addEventListener('pointerdown', (event) => {
    if (!isPrimaryPointer(event)) return;
    lastInfoPointerActivation = performance.now();
    setHelpOpen(help?.hasAttribute('hidden'));
  });

  info?.addEventListener('click', () => {
    if (isRecentPointerActivation(lastInfoPointerActivation)) return;
    setHelpOpen(help?.hasAttribute('hidden'));
  });

  root.querySelectorAll('[data-graphics-profile]').forEach((button) => {
    button.addEventListener('click', () => {
      const profile = button.getAttribute('data-graphics-profile');
      if (profile) setGraphicsProfile(profile, { persist: true });
      setMenuOpen(false);
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    setHelpOpen(false);
    setMenuOpen(false);
  });

  document.addEventListener('pointerdown', (event) => {
    if (root.contains(event.target)) return;
    setHelpOpen(false);
  });
}

function maybeAdjustFromFrames(now) {
  const recent = frameSamples.filter((sample) => now - sample.at <= 10_000);
  frameSamples.length = 0;
  frameSamples.push(...recent);

  const longFrames = recent.filter((sample) => sample.deltaMs > 100).length;
  if (longFrames >= 5 && downgradeSteps < 3) {
    downgradeSteps++;
    updateDocumentState('runtime-downgrade');
    return;
  }

  if (now - lastPromotionCheck < 20_000 || downgradeSteps <= 0) return;
  lastPromotionCheck = now;

  const stable = recent.length >= 30 && recent.every((sample) => sample.deltaMs < 50);
  if (stable) {
    downgradeSteps--;
    updateDocumentState('runtime-promotion');
  }
}

function initReducedMotionListener() {
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  media.addEventListener?.('change', () => updateDocumentState('motion-preference'));
}

function initDebugOverlay() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('graphicsDebug') !== '1') return;

  debugOverlay = document.createElement('div');
  debugOverlay.className = 'graphics-debug';
  debugOverlay.setAttribute('aria-hidden', 'true');
  document.body.appendChild(debugOverlay);
  updateDebugOverlay();
}

function updateDebugOverlay() {
  if (!debugOverlay) return;
  const state = getGraphicsState();
  const canvases = Array.from(document.querySelectorAll('canvas')).filter((canvas) => {
    const rect = canvas.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1 && canvas.width > 1 && canvas.height > 1;
  }).length;

  debugOverlay.textContent = [
    `profile ${state.profile}`,
    `effective ${state.effectiveProfile}`,
    `recommended ${state.capability.recommendedProfile}`,
    `section ${state.currentSection}`,
    `dpr ${state.budget.dprCap}`,
    `long ${state.recentLongFrames}`,
    `canvases ${canvases}`
  ].join(' | ');
}

export function getGraphicsState() {
  const now = performance.now();
  const recent = frameSamples.filter((sample) => now - sample.at <= 10_000);
  effectiveProfile = computeEffectiveProfile();
  return {
    profile: selectedProfile,
    effectiveProfile,
    capability: getGraphicsCapability(),
    currentSection,
    downgradeSteps,
    movementRegression: now < movementRegressionUntil,
    reducedMotion: prefersReducedMotion(),
    saveData: saveDataEnabled(),
    firefox: isFirefox(),
    webkit: isWebKit(),
    mobile: isMobileViewport(),
    recentLongFrames: recent.filter((sample) => sample.deltaMs > 100).length,
    budget: getGraphicsBudget('state')
  };
}

export function getGraphicsBudget(systemName = 'default') {
  const profile = computeEffectiveProfile();
  const constrainedEngine = isFirefox() || isWebKit();
  const largeViewport = window.innerWidth * window.innerHeight >= 1_800_000;
  const extras = {
    systemName,
    reducedMotion: prefersReducedMotion(),
    movementRegression: performance.now() < movementRegressionUntil
  };

  const budget = mergeBudget(profile, extras);
  budget.allowPortraitStreaming = false;

  if (constrainedEngine) {
    budget.dprCap = Math.min(budget.dprCap, profile === 'quiet' ? 1 : 1.25);
    budget.frameIntervalMs = Math.max(budget.frameIntervalMs, 1000 / 30);
    budget.antialias = false;
  }

  if (isMobileViewport()) {
    budget.dprCap = Math.min(budget.dprCap, 1.25);
    budget.maxCanvasPixels = Math.min(budget.maxCanvasPixels, 2_400_000);
  }

  if (constrainedEngine && (systemName === 'portrait-particles' || systemName === 'intro-spores')) {
    const particleCap = largeViewport ? 0.25 : 0.35;
    budget.dprCap = Math.min(budget.dprCap, 1);
    budget.maxCanvasPixels = Math.min(budget.maxCanvasPixels, largeViewport ? 500_000 : 900_000);
    budget.frameIntervalMs = Math.max(budget.frameIntervalMs, 1000 / 24);
    budget.particleScale = Math.min(budget.particleScale, particleCap);
  }

  if (constrainedEngine && systemName === 'intro-sparks') {
    budget.dprCap = Math.min(budget.dprCap, 1);
    budget.maxCanvasPixels = Math.min(budget.maxCanvasPixels, largeViewport ? 550_000 : 900_000);
  }

  if (constrainedEngine && systemName === 'work-globe') {
    const particleCap = largeViewport ? 0.25 : 0.35;
    budget.heavyConstrained = largeViewport;
    budget.dprCap = Math.min(budget.dprCap, 1);
    budget.maxCanvasPixels = Math.min(budget.maxCanvasPixels, largeViewport ? 550_000 : 1_200_000);
    budget.frameIntervalMs = Math.max(budget.frameIntervalMs, 1000 / 24);
    budget.particleScale = Math.min(budget.particleScale, particleCap);
    budget.geometryScale = Math.min(budget.geometryScale, largeViewport ? 0.45 : 0.55);
    budget.effectsScale = Math.min(budget.effectsScale, largeViewport ? 0.35 : 0.45);
    budget.textureMaxSize = Math.min(budget.textureMaxSize, largeViewport ? 512 : 768);
  }

  const ownerSection = ownerSectionForSystem(systemName);
  if (ownerSection && ownerSection !== currentSection) {
    budget.dprCap = Math.min(budget.dprCap, 1);
    budget.maxCanvasPixels = Math.min(budget.maxCanvasPixels, 1_000_000);
    budget.frameIntervalMs = Math.max(budget.frameIntervalMs, 1000 / 20);
    budget.particleScale = 0;
    budget.effectsScale = Math.min(budget.effectsScale, 0.25);
  }

  if (systemName === 'portrait-particles') {
    budget.maxCanvasPixels = Math.min(budget.maxCanvasPixels, budget.quiet ? 800_000 : 3_200_000);
    budget.allowPortraitStreaming = selectedProfileAllowsPortraitStreaming()
      && !budget.quiet
      && !budget.reducedMotion
      && !budget.movementRegression
      && budget.particleScale > 0
      && currentSection === 'intro';
  }

  if (systemName === 'blog-network') {
    budget.frameIntervalMs = budget.quiet
      ? Math.max(budget.frameIntervalMs, 1000 / 20)
      : budget.frameIntervalMs;
  }

  if (systemName === 'work-globe') {
    budget.frameIntervalMs = budget.quiet
      ? Math.max(budget.frameIntervalMs, 1000 / 24)
      : budget.frameIntervalMs;
  }

  return budget;
}

export function setGraphicsProfile(profile, options = {}) {
  if (!validProfile(profile)) return;
  selectedProfile = profile;
  downgradeSteps = 0;
  if (options.persist !== false) writeStoredProfile(profile);
  updateDocumentState('profile');
}

export function subscribeGraphics(callback) {
  subscribers.add(callback);
  callback(getGraphicsState());
  return () => subscribers.delete(callback);
}

export function markGraphicsActivity(reason = 'activity', durationMs = 700) {
  movementRegressionUntil = Math.max(movementRegressionUntil, performance.now() + durationMs);
  updateDocumentState(reason);
  window.setTimeout(() => updateDocumentState(`${reason}:settled`), durationMs + 40);
}

export function reportFrameSample(systemName, deltaMs) {
  const now = performance.now();
  frameSamples.push({ systemName, deltaMs, at: now });
  maybeAdjustFromFrames(now);
  updateDebugOverlay();
}

export function setGraphicsSection(sectionName) {
  currentSection = sectionName || 'intro';
  updateDocumentState('section');
}

export function initGraphicsGovernor() {
  if (initialized) return;
  initialized = true;

  wireControl();
  initReducedMotionListener();
  initDebugOverlay();
  updateDocumentState('init');
}
