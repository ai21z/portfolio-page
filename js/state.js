/**
 * Centralized state management for Necrography
 * All shared state variables with getters/setters
 */

// ━━━ Preferences ━━━
export const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ━━━ HUD State ━━━
export let hudEnabled = new URLSearchParams(window.location.search).has('hud');
export let hudCanvas = null;
export let hudCtx = null;

export function setHudEnabled(value) { hudEnabled = value; }
export function setHudCanvas(canvas) { hudCanvas = canvas; }
export function setHudCtx(ctx) { hudCtx = ctx; }

// ━━━ DOM References ━━━
export const bgImg = document.getElementById('bg-front-img');

// ━━━ Background Geometry (COVER Transform) ━━━
export const COVER = { s: 1, dx: 0, dy: 0, baseW: 0, baseH: 0, ready: false };

// ━━━ Mycelium Data ━━━
export let MYC_MAP = null; // {seed, width, height, paths, junctions}
export function setMycMap(data) { MYC_MAP = data; }

// ━━━ Graph & Pathfinding ━━━
export let GRAPH = null; // { nodes: Array<{x,y}>, neighbors(id)->id[], nearestId(x,y) }
export const PATH_CACHE = new Map(); // "fromId->toId" => [{x,y}, …]
export function setGraph(graph) { GRAPH = graph; }

// ━━━ Ritual State ━━━
export let ritualActive = false;
export let followerSparks = []; // [{ id, alpha }]
export function setRitualActive(value) { ritualActive = value; }
export function setFollowerSparks(sparks) { followerSparks = sparks; }

// ━━━ Locked Routes ━━━
export let LOCKED_ROUTES = {}; // id -> {imgPts, projPts, cum, len, s, dir, speed}
export function setLockedRoutes(routes) { LOCKED_ROUTES = routes; }

// ━━━ Navigation ━━━
export const NODE_IDS = {}; // id -> graph node index
export const NAV_OFFSETS = {}; // id -> {nx, ny} in image space
export let currentNavHover = null;
export function setCurrentNavHover(id) { currentNavHover = id; }

// ━━━ Canvas References ━━━
export let sparkCanvas = document.getElementById('reveal-canvas') || document.getElementById('spark-canvas');
export let sparkCtx = null;
export let sporeCanvas = document.getElementById('spore-canvas');
export let sporeCtx = null;

export function setSparkCanvas(canvas) { sparkCanvas = canvas; }
export function setSparkCtx(ctx) { sparkCtx = ctx; }
export function setSporeCanvas(canvas) { sporeCanvas = canvas; }
export function setSporeCtx(ctx) { sporeCtx = ctx; }

// ━━━ Animation State ━━━
export let ACTIVE_ANIMS = [];
export let spores = [];
export let lastSporeFrame = 0;
export let lastSparkTs = performance.now();

export function setActiveAnims(anims) { ACTIVE_ANIMS = anims; }
export function setSpores(value) { spores = value; }
export function setLastSporeFrame(value) { lastSporeFrame = value; }
export function setLastSparkTs(value) { lastSparkTs = value; }
