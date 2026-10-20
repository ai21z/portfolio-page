import { isFirefox, isWebKit } from './ua.js';

const STORAGE_KEY = 'aris.graphicsProfile';
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
    quiet: false
  }
};

// rAF timestamps jitter around vsync, so a 30 fps cap on a 60 Hz screen sees gaps a hair under 33.3 ms.
// Without slack the loop waits for a third vsync and alternates 33 and 50 ms frames.
const FRAME_SLACK_MS = 4;

// A gap this long is a pause (hidden tab, stopped loop), not a frame.
const PAUSE_MS = 1000;
// Frames right after a tier change carry its canvas reallocation, so they are not evidence.
const SETTLE_MS = 1000;
// A stepped-down tier is retried after 20 s, then 60 s, then 180 s, then no more this visit.
// Any downgrade after a retry counts that retry as failed, however late it comes, so a retry
// made in silence (Contact, Quiet) or a device that slows after warming up still backs off.
const PROMOTION_DELAY_MS = 20_000;
const MAX_FAILED_PROMOTIONS = 3;

const frameSamples = [];
let lastFrameAdjustAt = 0;

let initialized = false;
const storedProfile = readStoredProfile();
// Null until the visitor picks a profile. Until then the recommendation decides.
let explicitProfile = storedProfile ? normalizeSelectableProfile(storedProfile) : null;
let effectiveProfile = explicitProfile || (isMobileViewport() ? 'quiet' : 'balanced');
// The highest tier recent frames allow. Held as a ceiling, not as steps, so a later lower
// recommendation is not penalised twice.
let runtimeCeiling = PROFILES.length - 1;
let tierChangedAt = 0;
let retryAwaitingVerdict = false;
let failedPromotions = 0;
let promotionTimer = 0;
let movementRegressionUntil = 0;
let currentSection = 'intro';
let debugOverlay = null;
let webglCapabilityProbe = null;

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
  // Arc cards read "Arc(TM) A770 Graphics", "A750E", "A370M", "A310 LP", "Pro A40/A50" or "B580".
  // Integrated Arc reads "Arc(TM) Graphics" (Meteor Lake) or "Arc(TM) 140V GPU" (Lunar Lake).
  if (/intel.*\barc\b/i.test(value)) {
    const card = /\barc(\(tm\))?\s+(pro\s+)?[ab]\d{2,3}[a-z]?(\/[ab]?\d{2,3})?(\s+lp)?\s+graphics/i;
    return card.test(value) ? 'discrete' : 'integrated';
  }
  // "Radeon(TM) RX Vega 11 Graphics" is a Raven Ridge APU. "RX Vega 56", "RX Vega M" and "RX 480" are cards.
  if (/(geforce|nvidia|rtx|gtx|radeon\s*(\(tm\))?\s*(rx\b(?!\s+vega\s+\d{1,2}\s+graphics)|pro\b)|quadro|discrete)/i.test(value)) return 'discrete';
  // Apple silicon handles these scenes like a discrete card. Intel Macs still read as integrated.
  if (/apple m\d/i.test(value)) return 'apple';
  // AMD APUs read "Radeon(TM) Graphics", "Radeon Vega 8 Graphics" or "Radeon 780M Graphics".
  if (/(intel|uhd|iris|apple m|apple gpu|radeon.{0,24}graphics|adreno|mali|integrated)/i.test(value)) return 'integrated';
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
  for (const gl of [normalContext, caveatContext]) {
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  }
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
    && (rendererCategory === 'discrete' || rendererCategory === 'apple')) {
    return 'strong';
  }
  return 'capable';
}

// Cache capability probes until the viewport, connection, or preferences change.
let _capabilityCache = null;
function invalidateGraphicsCapability() { _capabilityCache = null; }
if (typeof window !== 'undefined') {
  window.addEventListener('resize', invalidateGraphicsCapability, { passive: true });
  window.addEventListener('dpr-changed', invalidateGraphicsCapability);
  try { window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', invalidateGraphicsCapability); } catch { /* older Safari */ }
  try { navigator.connection?.addEventListener?.('change', invalidateGraphicsCapability); } catch { /* unsupported */ }
}

function getGraphicsCapability() {
  if (_capabilityCache) return _capabilityCache;
  const hardwareConcurrency = readCoarseNumber(navigator.hardwareConcurrency);
  const deviceMemory = readCoarseNumber(navigator.deviceMemory);
  const engine = browserEngine();
  const viewport = viewportClass();
  // Defer GPU startup unless a 3D section or an explicit desktop quality choice needs it.
  const needsWebGL = currentSection === 'work' || currentSection === 'blog'
    || (!isMobileViewport() && explicitProfile !== null && rank(explicitProfile) > rank('balanced'));
  const webgl = webglCapabilityProbe || (needsWebGL ? probeWebGL2Capability() : {
    webgl2: null,
    webgl2PerformanceOk: null,
    majorPerformanceCaveat: false,
    rendererCategory: 'unknown'
  });
  const reducedMotion = prefersReducedMotion();
  const saveData = saveDataEnabled();
  const reasons = [];

  if (reducedMotion) reasons.push('reduced-motion');
  if (saveData) reasons.push('save-data');
  if (viewport === 'mobile') reasons.push('mobile');
  if (webgl.webgl2 === false) reasons.push('no-webgl2');
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
  // The performance-caveat probe can fail on capable Macs. Do not force Quiet from it alone.
  const quietReasons = new Set([
    'reduced-motion',
    'save-data',
    'mobile',
    'no-webgl2',
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
  } else if (engine === 'chromium'
    && (webgl.webgl2 === null || webgl.rendererCategory === 'discrete' || webgl.rendererCategory === 'apple')) {
    // The landing has no WebGL, so its GPU stays unprobed until a 3D section opens. Once probed,
    // Rich needs a GPU known to be discrete or Apple silicon. Integrated and unrecognised ones
    // step down to Balanced. The performance-caveat flag is ignored: software renderers already
    // go Quiet and the flag has misfired on Apple silicon.
    recommendedProfile = 'rich';
    reasons.push(classification === 'strong' ? 'strong-chromium-webgl' : 'capable-chromium');
  } else {
    reasons.push('standard-capability');
  }

  _capabilityCache = {
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
  return _capabilityCache;
}

function validProfile(profile) {
  return PROFILE_RANK.has(profile);
}

function isFirefoxUnavailableProfile(profile) {
  return isFirefox() && (profile === 'rich' || profile === 'full');
}

function normalizeSelectableProfile(profile) {
  if (!validProfile(profile)) return 'balanced';
  return isFirefoxUnavailableProfile(profile) ? 'balanced' : profile;
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
    if (validProfile(profile)) window.localStorage.setItem(STORAGE_KEY, profile);
    else window.localStorage.removeItem(STORAGE_KEY);
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
    return capabilityReasons.map(formatCapabilityReason).join(', ');
  }
  if (state.reducedMotion) return 'reduced motion is enabled';
  if (state.saveData) return 'save-data is enabled';
  if (state.firefox) return 'Firefox receives a safer WebGL budget';
  if (state.webkit) return 'WebKit receives a safer WebGL budget';
  if (state.mobile) return 'small or touch viewport';
  if (state.downgradeSteps > 0) return 'recent long frames';
  if (state.profile !== state.effectiveProfile) return 'runtime capability budget';
  return 'standard browser settings';
}

function formatCapabilityReason(reason) {
  const labels = {
    'strong-chromium-webgl': 'strong Chrome/Edge/Brave WebGL',
    'capable-chromium': 'capable Chrome/Edge/Brave desktop',
    'firefox-conservative': 'Firefox conservative mode',
    'webkit-conservative': 'Safari/WebKit conservative mode'
  };
  return labels[reason] || reason.replaceAll('-', ' ');
}

function selectedProfile() {
  return explicitProfile || getGraphicsCapability().recommendedProfile;
}

function selectedProfileAllowsPortraitStreaming() {
  const profile = selectedProfile();
  return profile === 'rich' || profile === 'full';
}

function mergeBudget(profile, extras = {}) {
  return {
    profile: selectedProfile(),
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

// The tier before runtime evidence.
function baseProfileIndex() {
  // Reduced motion, save-data, phones, missing WebGL2 and software rendering always run Quiet.
  if (getGraphicsCapability().recommendedProfile === 'quiet') return 0;

  // An explicit choice is honoured. The runtime ceiling still steps it down if frames slow.
  let index = rank(selectedProfile());

  if (isFirefox() || isWebKit()) {
    index = Math.min(index, rank('balanced'));
  }
  return index;
}

// Movement pauses portrait streaming only. Dropping a tier mid-gesture reallocated every canvas.
function computeEffectiveProfile() {
  return profileAt(Math.min(baseProfileIndex(), runtimeCeiling));
}

function runtimeSteps() {
  const base = baseProfileIndex();
  return base - Math.min(base, runtimeCeiling);
}

function updateDocumentState(reason = 'state') {
  const nextEffective = computeEffectiveProfile();
  const changed = nextEffective !== effectiveProfile;
  effectiveProfile = nextEffective;

  document.documentElement.dataset.graphicsProfile = selectedProfile();
  document.documentElement.dataset.graphicsEffectiveProfile = effectiveProfile;
  document.documentElement.dataset.graphicsSection = currentSection;
  document.documentElement.dataset.graphicsReducedMotion = String(prefersReducedMotion());
  const capability = getGraphicsCapability();
  document.documentElement.dataset.graphicsRecommendedProfile = capability.recommendedProfile;
  document.documentElement.dataset.graphicsHardwareClass = capability.hardwareClass;

  syncControl();
  updateDebugOverlay();
  armPromotionIfHeldBack();

  if (changed || reason === 'profile' || reason === 'section') {
    notifySubscribers(reason);
  }
}

function notifySubscribers(reason) {
  const state = getGraphicsState();
  window.dispatchEvent(new CustomEvent('graphics:profile-change', { detail: { ...state, reason } }));
  window.dispatchEvent(new CustomEvent('dpr-changed', { detail: { ...state, reason } }));
}

function syncControl() {
  const root = document.querySelector('[data-graphics-control]');
  if (!root) return;

  const state = getGraphicsState();
  const toggle = root.querySelector('.graphics-control__toggle');
  if (toggle) {
    // Name the tier actually running, and mark it when the governor overrode the visitor's choice.
    const overridden = explicitProfile && state.effectiveProfile !== explicitProfile;
    toggle.textContent = `Graphics: ${formatProfile(state.effectiveProfile)}${overridden ? ' (auto)' : ''}`;
  }

  root.querySelectorAll('[data-graphics-profile]').forEach((button) => {
    const profile = button.getAttribute('data-graphics-profile');
    const unavailable = isFirefoxUnavailableProfile(profile);
    const active = profile === (explicitProfile || 'auto');
    button.setAttribute('aria-pressed', String(active));
    button.toggleAttribute('disabled', unavailable);
    button.setAttribute('aria-disabled', String(unavailable));
    if (unavailable) {
      button.title = 'Rich and Full graphics are available in Chrome, Edge, or Brave.';
    } else {
      button.removeAttribute('title');
    }
  });

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
      setMenuOpen(false);
      // Reload on explicit profile changes, never on automatic downgrades.
      if (!profile || profile === (explicitProfile || 'auto')) return;
      writeStoredProfile(profile);
      if (typeof window.__showThreshold === 'function') window.__showThreshold();
      window.location.reload();
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (menu?.contains(document.activeElement)) toggle?.focus();
    if (help?.contains(document.activeElement)) info?.focus();
    setHelpOpen(false);
    setMenuOpen(false);
  });

  document.addEventListener('ui:close-overlays', () => {
    setHelpOpen(false);
    setMenuOpen(false);
  });

  document.addEventListener('pointerdown', (event) => {
    if (root.contains(event.target)) return;
    setHelpOpen(false);
  });
}

// A capped loop's own gap is not slowness: a 24 fps cap waits 50 ms on 60 Hz and 66.7 ms under
// Chrome's 30 Hz Energy Saver by design. Slow means 30 ms past the cap, and never under 50 ms.
function isSlowFrame(sample) {
  return sample.deltaMs > Math.max(50, (sample.intervalMs || 0) + 30);
}

function recentFrameSamples(now) {
  return frameSamples.filter((sample) => now - sample.at <= 10_000);
}

function setRuntimeCeiling(index, reason) {
  runtimeCeiling = index;
  tierChangedAt = performance.now();
  // One burst costs one tier: the next decision needs fresh evidence from the new tier.
  frameSamples.length = 0;
  updateDocumentState(reason);
  schedulePromotion(PROMOTION_DELAY_MS * 3 ** failedPromotions);
}

function schedulePromotion(delayMs) {
  window.clearTimeout(promotionTimer);
  promotionTimer = 0;
  if (runtimeCeiling >= PROFILES.length - 1 || failedPromotions >= MAX_FAILED_PROMOTIONS) return;
  promotionTimer = window.setTimeout(tryPromotion, delayMs);
}

// Called on every state update, so a retry that found the ceiling not binding (the base had
// dropped for a narrow window or reduced motion) is armed again once the base rises above it.
function armPromotionIfHeldBack() {
  if (!promotionTimer && runtimeCeiling < baseProfileIndex()) {
    schedulePromotion(PROMOTION_DELAY_MS * 3 ** failedPromotions);
  }
}

function tryPromotion() {
  promotionTimer = 0;
  if (runtimeCeiling >= baseProfileIndex() || failedPromotions >= MAX_FAILED_PROMOTIONS) return;
  // Retiering a hidden tab would reallocate canvases nobody sees.
  if (document.hidden) {
    schedulePromotion(5_000);
    return;
  }
  const recent = recentFrameSamples(performance.now());
  // Quiet stops the landing's only sampled loop, so silence must not block a retry.
  const calm = recent.length === 0 || (recent.length >= 30 && !recent.some(isSlowFrame));
  if (!calm) {
    schedulePromotion(5_000);
    return;
  }
  retryAwaitingVerdict = true;
  setRuntimeCeiling(runtimeCeiling + 1, 'runtime-promotion');
}

function maybeAdjustFromFrames(now) {
  const recent = recentFrameSamples(now);
  frameSamples.length = 0;
  frameSamples.push(...recent);

  const slowFrames = recent.filter(isSlowFrame).length;
  const longFrames = recent.filter((sample) => sample.deltaMs > 100).length;
  const current = rank(computeEffectiveProfile());
  if ((longFrames >= 5 || slowFrames >= 18) && current > 0) {
    // One failed retry counts once, however many steps the same slowdown then takes.
    if (retryAwaitingVerdict) failedPromotions++;
    retryAwaitingVerdict = false;
    setRuntimeCeiling(current - 1, 'runtime-downgrade');
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
  const recent = recentFrameSamples(now);
  const effectiveProfile = computeEffectiveProfile();
  return {
    profile: selectedProfile(),
    profileSource: explicitProfile ? 'user' : 'auto',
    effectiveProfile,
    capability: getGraphicsCapability(),
    currentSection,
    downgradeSteps: runtimeSteps(),
    failedPromotions,
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

  if (isFirefox() && systemName === 'portrait-particles') {
    budget.dprCap = 1;
    budget.maxCanvasPixels = Math.min(budget.maxCanvasPixels, 1);
    budget.frameIntervalMs = Math.max(budget.frameIntervalMs, 1000 / 24);
    budget.particleScale = 0;
    budget.effectsScale = 0;
    budget.quiet = true;
  }

  if (constrainedEngine && systemName === 'intro-sparks') {
    budget.dprCap = Math.min(budget.dprCap, 1);
    budget.maxCanvasPixels = Math.min(budget.maxCanvasPixels, largeViewport ? 550_000 : 900_000);
    budget.frameIntervalMs = Math.max(budget.frameIntervalMs, 1000 / 20);
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

// 'auto' clears the visitor's choice and hands the tier back to the recommendation.
export function setGraphicsProfile(profile, options = {}) {
  if (profile !== 'auto' && !validProfile(profile)) return;
  explicitProfile = profile === 'auto' ? null : normalizeSelectableProfile(profile);
  invalidateGraphicsCapability();
  runtimeCeiling = PROFILES.length - 1;
  failedPromotions = 0;
  retryAwaitingVerdict = false;
  tierChangedAt = performance.now();
  frameSamples.length = 0;
  window.clearTimeout(promotionTimer);
  promotionTimer = 0;
  if (options.persist !== false) writeStoredProfile(explicitProfile || 'auto');
  updateDocumentState('profile');
}

// The reason names the gesture at call sites. Movement only pauses portrait streaming,
// which reads the budget every frame, so no state update or event is needed.
export function markGraphicsActivity(reason = 'activity', durationMs = 700) {
  movementRegressionUntil = Math.max(movementRegressionUntil, performance.now() + durationMs);
}

export function frameDue(elapsedMs, intervalMs) {
  return !intervalMs || elapsedMs >= intervalMs - FRAME_SLACK_MS;
}

export function reportFrameSample(systemName, deltaMs, intervalMs = 0) {
  const now = performance.now();
  if (deltaMs < PAUSE_MS && now - tierChangedAt >= SETTLE_MS) {
    frameSamples.push({ systemName, deltaMs, intervalMs, at: now });
  }
  // Sample every frame but adjust the budget only a few times per second.
  if (now - lastFrameAdjustAt >= 500) {
    lastFrameAdjustAt = now;
    maybeAdjustFromFrames(now);
    updateDebugOverlay();
  }
}

export function setGraphicsSection(sectionName) {
  currentSection = sectionName || 'intro';
  if (!webglCapabilityProbe && (currentSection === 'work' || currentSection === 'blog')) {
    invalidateGraphicsCapability();
  }
  updateDocumentState('section');
}

export function initGraphicsGovernor() {
  if (initialized) return;
  initialized = true;

  wireControl();
  initReducedMotionListener();
  initDebugOverlay();
  window.addEventListener('resize', () => updateDocumentState('viewport'), { passive: true });
  updateDocumentState('init');
}
