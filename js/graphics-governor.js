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

export const GRAPHICS_PROFILES = PROFILES;

function isFirefox() {
  return /\bFirefox\//.test(navigator.userAgent);
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

function mergeBudget(profile, extras = {}) {
  return {
    profile: selectedProfile,
    effectiveProfile: profile,
    ...PROFILE_BUDGETS[profile],
    ...extras
  };
}

function computeEffectiveProfile() {
  if (prefersReducedMotion() || saveDataEnabled()) return 'quiet';

  let index = rank(selectedProfile);

  if (isFirefox()) {
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

  syncControl();
  updateDebugOverlay();

  if (changed || reason === 'profile') {
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
    toggle.textContent = `Graphics: ${selectedProfile[0].toUpperCase()}${selectedProfile.slice(1)}`;
  }

  root.querySelectorAll('[data-graphics-profile]').forEach((button) => {
    const active = button.getAttribute('data-graphics-profile') === selectedProfile;
    button.setAttribute('aria-pressed', String(active));
  });
}

function wireControl() {
  const root = document.querySelector('[data-graphics-control]');
  if (!root || root.__graphicsControlBound) return;
  root.__graphicsControlBound = true;

  const toggle = root.querySelector('.graphics-control__toggle');
  const menu = root.querySelector('.graphics-control__menu');

  toggle?.addEventListener('click', () => {
    const open = menu?.hasAttribute('hidden');
    if (open) {
      menu?.removeAttribute('hidden');
      toggle.setAttribute('aria-expanded', 'true');
    } else {
      menu?.setAttribute('hidden', '');
      toggle.setAttribute('aria-expanded', 'false');
    }
  });

  root.querySelectorAll('[data-graphics-profile]').forEach((button) => {
    button.addEventListener('click', () => {
      const profile = button.getAttribute('data-graphics-profile');
      if (profile) setGraphicsProfile(profile, { persist: true });
      menu?.setAttribute('hidden', '');
      toggle?.setAttribute('aria-expanded', 'false');
    });
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
    `section ${state.currentSection}`,
    `dpr ${state.budget.dprCap}`,
    `long ${state.recentLongFrames}`,
    `canvases ${canvases}`
  ].join(' | ');
}

export function getGraphicsState() {
  const now = performance.now();
  const recent = frameSamples.filter((sample) => now - sample.at <= 10_000);
  return {
    profile: selectedProfile,
    effectiveProfile,
    currentSection,
    downgradeSteps,
    movementRegression: now < movementRegressionUntil,
    reducedMotion: prefersReducedMotion(),
    saveData: saveDataEnabled(),
    firefox: isFirefox(),
    mobile: isMobileViewport(),
    recentLongFrames: recent.filter((sample) => sample.deltaMs > 100).length,
    budget: getGraphicsBudget('state')
  };
}

export function getGraphicsBudget(systemName = 'default') {
  const profile = computeEffectiveProfile();
  const extras = {
    systemName,
    reducedMotion: prefersReducedMotion(),
    movementRegression: performance.now() < movementRegressionUntil
  };

  const budget = mergeBudget(profile, extras);

  if (isFirefox()) {
    budget.dprCap = Math.min(budget.dprCap, profile === 'quiet' ? 1 : 1.25);
    budget.frameIntervalMs = Math.max(budget.frameIntervalMs, 1000 / 30);
    budget.antialias = false;
  }

  if (isMobileViewport()) {
    budget.dprCap = Math.min(budget.dprCap, 1.25);
    budget.maxCanvasPixels = Math.min(budget.maxCanvasPixels, 2_400_000);
  }

  if (systemName === 'portrait-particles') {
    budget.maxCanvasPixels = Math.min(budget.maxCanvasPixels, budget.quiet ? 800_000 : 3_200_000);
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
