// Centralized application state

// Live, from js/motion.js: a module reading it at the moment it acts follows a change of the setting.
export { reducedMotion as prefersReducedMotion } from './motion.js';

// The nav-route debug overlay (js/hud.js) is for development only: it opens with ?hud on the source
// tree and has no keyboard toggle. The build defines __DEV__ as false, so production never opens it.
export const hudEnabled = (typeof __DEV__ === 'undefined' || __DEV__) && new URLSearchParams(window.location.search).has('hud');

export const bgImg = document.getElementById('bg-front-img');

export const COVER = { s: 1, dx: 0, dy: 0, baseW: 0, baseH: 0, ready: false };

export let MYC_MAP = null;
export function setMycMap(data) { MYC_MAP = data; }

export let GRAPH = null;
export const PATH_CACHE = new Map();
export function setGraph(graph) { GRAPH = graph; }

export let ritualActive = false;
export let followerSparks = [];
export function setRitualActive(value) { ritualActive = value; }
export function setFollowerSparks(sparks) { followerSparks = sparks; }

export let LOCKED_ROUTES = {};
export function setLockedRoutes(routes) { LOCKED_ROUTES = routes; }

export const NODE_IDS = {};
export const NAV_OFFSETS = {};
export let currentNavHover = null;
export function setCurrentNavHover(id) { currentNavHover = id; }

export let sparkCanvas = document.getElementById('reveal-canvas') || document.getElementById('spark-canvas');
export let sparkCtx = null;
export let sporeCanvas = document.getElementById('spore-canvas');
export let sporeCtx = null;

export function setSparkCanvas(canvas) { sparkCanvas = canvas; }
export function setSparkCtx(ctx) { sparkCtx = ctx; }
export function setSporeCtx(ctx) { sporeCtx = ctx; }

export let ACTIVE_ANIMS = [];
export let spores = [];
export let lastSporeFrame = 0;
export let lastSparkTs = performance.now();

export function setActiveAnims(anims) { ACTIVE_ANIMS = anims; }
export function setSpores(value) { spores = value; }
export function setLastSporeFrame(value) { lastSporeFrame = value; }
export function setLastSparkTs(value) { lastSparkTs = value; }
