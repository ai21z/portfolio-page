// blog-network-webgl.js — Hand-painted mycelium network
import { cappedDpr } from './utils.js';
import { getGraphicsBudget, reportFrameSample } from './graphics-governor.js';
import { installWebGLContextHealth, requestProtectedWebGL2Context, showWebGLFallback } from './webgl-health.js';

const BLOG_NETWORK_VERSION = window.__BLOG_NETWORK_VERSION || '20260615-physarum-voronoi-9b';
if (!window.__BLOG_NETWORK_VERSION) {
  window.__BLOG_NETWORK_VERSION = BLOG_NETWORK_VERSION;
}

const PETRI_K = 0.42;
const AUTO_CENTER = true;
const FIXED_SHIFT = [0, 0];

const PAL = {
  ABYSS: [0.031, 0.035, 0.039],     // near-black abyss floor (9b)
  BRANCH1: [0.25, 0.35, 0.28],      // mossy green
  BRANCH2: [0.30, 0.40, 0.45],      // blue-teal
  BRANCH3: [0.35, 0.30, 0.25],      // earthy brown
  BRANCH4: [0.28, 0.32, 0.38],      // slate gray-blue
  FUSION1: [0.40, 0.50, 0.35],      // bright moss
  FUSION2: [0.35, 0.45, 0.50],      // aqua
  EMBER1: [0.70, 0.45, 0.25],       // warm orange
  EMBER2: [0.65, 0.35, 0.40],       // rose
  EMBER3: [0.55, 0.50, 0.30],       // olive gold
  GLOW1:  [0.50, 0.60, 0.45],       // soft green
  GLOW2:  [0.45, 0.55, 0.60],       // cyan
  GLOW3:  [0.60, 0.50, 0.40],       // amber
  MOSS_DARK: [0.20, 0.27, 0.22],    // damp moss shadow
  MOSS_LIGHT: [0.46, 0.63, 0.50],   // lichen highlight
  NECROTIC: [0.48, 0.66, 0.58],     // necrographic node tint
  BONE:   [0.788, 0.761, 0.702],    // #C9C2B3
};

function currentDPR() {
  const rect = q('#blog-network-canvas')?.getBoundingClientRect();
  return cappedDpr(1.5, {
    systemName: 'blog-network',
    width: Math.max(1, rect?.width || window.innerWidth),
    height: Math.max(1, rect?.height || window.innerHeight)
  });
}

const VIEW = { W: 1920, H: 1080 };

function computeNetworkCentroid(paths) {
  const B = {minX: +Infinity, minY: +Infinity, maxX: -Infinity, maxY: -Infinity};
  for (const path of (paths || [])) {
    for (const [x, y] of path) {
      if (x < B.minX) B.minX = x; 
      if (x > B.maxX) B.maxX = x;
      if (y < B.minY) B.minY = y; 
      if (y > B.maxY) B.maxY = y;
    }
  }
  if (!isFinite(B.minX)) return [VIEW.W * 0.5, VIEW.H * 0.5];
  const netCx = (B.minX + B.maxX) * 0.5;
  const netCy = (B.minY + B.maxY) * 0.5;
  return [netCx, netCy];
}

const VS_FSQ = `#version 300 es
precision highp float;
const vec2 P[3]=vec2[3](vec2(-1.,-1.),vec2(3.,-1.),vec2(-1.,3.));
out vec2 v_uv;
void main(){
  vec2 p=P[gl_VertexID];
  v_uv = 0.5*(p+1.);
  gl_Position=vec4(p,0,1);
}`;

const FS_PAPER = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform vec2 uRes;        // canvas px
uniform float uTime;
uniform vec3 uAbyss;
uniform float uVignette;
float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){
  vec2 i=floor(p), f=fract(p);
  float a=hash(i), b=hash(i+vec2(1,0)), c=hash(i+vec2(0,1)), d=hash(i+vec2(1,1));
  vec2 u=f*f*(3.-2.*f);
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
void main(){
  // abyss base
  vec3 col = uAbyss;
  // paper fibers (very subtle, static feel)
  vec2 px = v_uv * uRes * 0.33;
  float fib = smoothstep(0.65,0.9, noise(px*vec2(0.37,0.29)));
  col += vec3(0.02)*fib*0.12;
  // vignette
  vec2 c = v_uv*2.-1.;
  float r = length(c);
  float vig = smoothstep(1.2, 0.35, r); // center lighter
  col *= mix(1.0, 0.65, uVignette * (1.0 - vig));
  // mild film grain (changes twice/sec prevents swimming)
  float t = floor(uTime*2.0)*0.5;
  float g = noise(v_uv*uRes*vec2(0.9,1.1)+t);
  col *= 0.97 + g*0.03;
  o = vec4(col,1.0);
}`;

const VS_SEG = `#version 300 es
precision highp float;
// per-vertex (static quad): (u along, side)
layout(location=0) in vec2 aUS;
// per-instance
layout(location=1) in vec2 aP0;
layout(location=2) in vec2 aP1;
layout(location=3) in float aW;
layout(location=4) in float aKind;   // 0=branch,1=fusion
layout(location=5) in float aThick;  // 0..1 (relative width)
uniform vec2 uScale, uOffset, uShift; // fit + off-center
uniform vec2 uRes; // actual canvas resolution
flat out vec2 vP0;
flat out vec2 vP1;
flat out float vR;
flat out float vKind;
flat out float vThick;
void main(){
  vec2 p0 = aP0 + uShift;
  vec2 p1 = aP1 + uShift;
  vec2 dir = normalize(p1-p0 + vec2(1e-6,0.0));
  vec2 perp = vec2(-dir.y, dir.x);
  float hw = aW*0.5;
  vec2 world = mix(p0,p1,aUS.x) + perp * (aUS.y*hw);
  vec2 screen = world*uScale + uOffset;
  vec2 clip = (screen/uRes)*2.0 - 1.0;
  clip.y = -clip.y; // Flip Y: JSON has Y-down (top-left origin), NDC has Y-up
  gl_Position = vec4(clip, 0.0, 1.0);
  vP0=p0; vP1=p1; vR=hw; vKind=aKind; vThick=aThick;
}`;

const FS_SEG = `#version 300 es
precision highp float;
out vec4 o;
uniform vec3 uBranch1, uBranch2, uBranch3, uBranch4;
uniform vec3 uFusion1, uFusion2;
uniform vec3 uEmber1, uEmber2, uEmber3;
uniform vec2 uScale, uOffset, uShift;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uHubPos[8];
uniform int uHubCount;
uniform float uEmberR;
uniform float uHighlight; // 1.0 = normal, up to 1.25 for hover lift
uniform vec2 uDishCenterPx;   // Petri dish center in CSS pixels (CSS top-left origin)
uniform float uDishRadiusPx;  // Petri dish radius in CSS pixels
uniform float uDpr;           // devicePixelRatio for buffer→CSS conversion
flat in vec2 vP0; flat in vec2 vP1; flat in float vR;
flat in float vKind; flat in float vThick;

// Petri dish clipping (DPR-correct, CSS pixel space)
void petriClip() {
  vec2 pCss = gl_FragCoord.xy / uDpr;  // Convert buffer pixels → CSS pixels
  pCss.y = uRes.y - pCss.y;            // Flip Y: GL bottom-left → CSS top-left
  float d = distance(pCss, uDishCenterPx);
  if (d > uDishRadiusPx) discard;
}

float sdCapsule(vec2 p, vec2 a, vec2 b, float r){
  vec2 pa=p-a, ba=b-a;
  float h=clamp(dot(pa,ba)/dot(ba,ba),0.0,1.0);
  return length(pa-ba*h)-r;
}
float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float hash2(vec2 p){ return fract(sin(dot(p,vec2(269.5,183.3)))*43758.5453); }
float noise(vec2 p){
  vec2 i=floor(p), f=fract(p);
  float a=hash(i), b=hash(i+vec2(1,0)), c=hash(i+vec2(0,1)), d=hash(i+vec2(1,1));
  vec2 u=f*f*(3.-2.*f);
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}

void main(){
  // Early discard for Petri dish clipping
  petriClip();
  
  vec2 pix = gl_FragCoord.xy;
  pix.y = uRes.y - pix.y; // Flip Y back: gl_FragCoord has Y-up, but we need Y-down to match network space
  vec2 worldShifted = (pix - uOffset)/uScale;      // world coords with artistic shift applied
  vec2 world = worldShifted - uShift;              // underlying network space (no shift)
  float colorSeed = hash(vP0 * 0.1);

  // SDF with wrinkled edges (hand-painted feel)
  float d = sdCapsule(worldShifted, vP0, vP1, vR);
  
  // Add organic wrinkles/irregularity to edge
  // Scale wrinkle by segment radius AND scale to keep it stable at all zoom levels
  float wrinkle = noise(world * 0.3) * 0.8 + noise(world * 0.8) * 0.4;
  float scaleAvg = (uScale.x + uScale.y) * 0.5; // average scale
  float wrinkleAmount = min(vR * 0.12, 0.6) * max(0.3, scaleAvg);
  float roughBranch = smoothstep(0.45, 1.35, vR);
  float highFreq = noise(world * 1.25 + vec2(colorSeed * 13.7, colorSeed * 21.9));
  float microFreq = noise(world * 3.8 + vec2(colorSeed * 41.3, colorSeed * 9.1));
  wrinkleAmount *= mix(1.0, 1.85, roughBranch);
  d += (wrinkle - 0.5) * wrinkleAmount;
  d += (highFreq - 0.5) * wrinkleAmount * 0.6 * roughBranch;
  d += (microFreq - 0.5) * wrinkleAmount * 0.35 * roughBranch;
  
  float aa = max(fwidth(d), 1e-4);
  float alpha = 1.0 - smoothstep(-aa*2.0, aa*0.5, d); // softer falloff

  // Color variation based on position (hand-painted variety)
  float colorVar = colorSeed; // per-segment variation
  float localNoise = noise(world * 0.15); // texture within segment
  
  // Cool moss->bone ramp by vein thickness (flux-driven). Ember stays reserved for the centre mass.
  vec3 col;
  {
    float t = clamp(vThick, 0.0, 1.0);
    vec3 c0 = vec3(0.247,0.353,0.298); // dark moss (fine mesh)
    vec3 c1 = vec3(0.357,0.490,0.408);
    vec3 c2 = vec3(0.529,0.627,0.518); // moss light
    vec3 c3 = vec3(0.498,0.749,0.651); // teal-green
    vec3 c4 = vec3(0.788,0.761,0.702); // bone (thick trunks)
    col = t < 0.25 ? mix(c0,c1, t/0.25)
        : t < 0.5  ? mix(c1,c2,(t-0.25)/0.25)
        : t < 0.75 ? mix(c2,c3,(t-0.5)/0.25)
        :            mix(c3,c4,(t-0.75)/0.25);
  }
  
  // Add painterly texture variation
  col *= 0.85 + localNoise * 0.3; // texture modulation
  float roughShade = noise(world * 2.6 + vec2(colorSeed * 57.1, colorSeed * 17.9));
  col *= 0.92 + roughShade * 0.35 * roughBranch;
  float roughMix = clamp((roughShade - 0.45) * 0.6 * roughBranch, 0.0, 1.0);
  col = mix(col, col * 0.78, roughMix);
  
  // Color variation along the segment (brush stroke effect)
  vec2 segDir = normalize(vP1 - vP0);
  float along = dot(worldShifted - vP0, segDir) / max(0.1, length(vP1 - vP0));
  float strokeVar = noise(vec2(along * 10.0, colorVar * 100.0)) * (0.15 + 0.15 * roughBranch);
  col *= 1.0 + strokeVar;

  // (no per-vein ember: the single warm focal is the centre plasmodial mass)

  // Soft painted glow
  float glow = smoothstep(3.5, 0.0, d) * 0.2;
  col += col * glow;
  
  // Apply highlight (clamped to 1.25x max)
  col *= min(uHighlight, 1.25);

  // overall brightness trim — the veins were reading too hot
  col *= 0.5;

  // grade opacity by thickness: fine mesh recedes, trunks read solid (the 9b look)
  o = vec4(clamp(col, 0.0, 1.0), alpha * (0.20 + 0.72 * clamp(vThick, 0.0, 1.0)));
}`;

const VS_CYST = `#version 300 es
precision highp float;
layout(location=0) in vec2 aQuad;
layout(location=1) in vec2 aPos;
layout(location=2) in float aSize;
layout(location=3) in float aPulse;
uniform vec2 uScale, uOffset, uShift;
uniform vec2 uRes;
uniform float uTime;
out vec2 vUv;
out float vPulsePhase;
void main(){
  float pulse = (sin(uTime*0.8 + aPulse)*0.3 + 0.7);
  float r = aSize * pulse;
  vec2 world = aPos + uShift + aQuad * r * 3.0;
  vec2 screen = world*uScale + uOffset;
  vec2 clip = (screen/uRes)*2.0 - 1.0;
  clip.y = -clip.y; // Flip Y: JSON has Y-down (top-left origin), NDC has Y-up
  gl_Position = vec4(clip,0,1);
  vUv = aQuad*0.5 + 0.5;
  vPulsePhase = aPulse; // pass to fragment for color variation
}`;

const FS_CYST = `#version 300 es
precision highp float;
in vec2 vUv;
in float vPulsePhase;
out vec4 o;
uniform vec3 uGlow1, uGlow2, uGlow3;
uniform vec3 uBranch1;
uniform vec2 uRes;
uniform vec2 uDishCenterPx;   // CSS pixels, CSS top-left origin
uniform float uDishRadiusPx;  // CSS pixels
uniform float uDpr;           // devicePixelRatio
float hash(float p){ return fract(sin(p*127.1)*43758.5453); }

// Petri dish clipping (DPR-correct, CSS pixel space)
void petriClip() {
  vec2 pCss = gl_FragCoord.xy / uDpr;  // Convert buffer pixels → CSS pixels
  pCss.y = uRes.y - pCss.y;            // Flip Y: GL bottom-left → CSS top-left
  float d = distance(pCss, uDishCenterPx);
  if (d > uDishRadiusPx) discard;
}

void main(){
  petriClip();
  
  float d = length(vUv-0.5);
  float a = smoothstep(0.6, 0.0, d);
  
  // Pick color based on pulse phase
  float cVar = hash(vPulsePhase);
  vec3 glowCol;
  if(cVar < 0.33) glowCol = uGlow1;
  else if(cVar < 0.66) glowCol = uGlow2;
  else glowCol = uGlow3;
  
  vec3 col = mix(uBranch1, glowCol, 0.7) * (0.5 + (1.0 - d)*0.4);
  o = vec4(col, a*0.7);
}`;

const VS_NODE = `#version 300 es
precision highp float;
layout(location=0) in vec2 aQuad;
layout(location=1) in vec2 aPos;
layout(location=2) in float aSize;
layout(location=3) in float aKind;
uniform vec2 uScale, uOffset, uShift;
uniform vec2 uRes;
out vec2 vUv;
out vec2 vCenter;
out float vSize;
flat out float vKind;
void main(){
  vec2 center = aPos + uShift;
  vec2 world = center + aQuad * aSize;
  vec2 screen = world*uScale + uOffset;
  vec2 clip = (screen/uRes)*2.0 - 1.0;
  clip.y = -clip.y; // Flip Y: JSON has Y-down (top-left origin), NDC has Y-up
  gl_Position = vec4(clip,0.0,1.0);
  vUv = aQuad*0.5 + 0.5;
  vCenter = center;
  vSize = aSize;
  vKind = aKind;
}`;

const FS_NODE = `#version 300 es
precision highp float;
in vec2 vUv;
in vec2 vCenter;
in float vSize;
flat in float vKind;
out vec4 o;
uniform vec3 uDotBranch;
uniform vec3 uDotFusion;
uniform vec3 uMossDark;
uniform vec3 uMossLight;
uniform float uTime;
uniform vec2 uRes;
uniform vec2 uDishCenterPx;   // CSS pixels, CSS top-left origin
uniform float uDishRadiusPx;  // CSS pixels
uniform float uDpr;           // devicePixelRatio

float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){
  vec2 i=floor(p), f=fract(p);
  float a=hash(i);
  float b=hash(i+vec2(1.0,0.0));
  float c=hash(i+vec2(0.0,1.0));
  float d=hash(i+vec2(1.0,1.0));
  vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}

// Petri dish clipping (DPR-correct, CSS pixel space)
void petriClip() {
  vec2 pCss = gl_FragCoord.xy / uDpr;  // Convert buffer pixels → CSS pixels
  pCss.y = uRes.y - pCss.y;            // Flip Y: GL bottom-left → CSS top-left
  float d = distance(pCss, uDishCenterPx);
  if (d > uDishRadiusPx) discard;
}

void main(){
  petriClip();  // Early discard for Petri dish clipping
  
  vec2 c = vUv*2.0 - 1.0;
  float r = length(c);
  float edge = fwidth(r);
  float alpha = 1.0 - smoothstep(1.0 - edge*1.5, 1.0, r);
  if(alpha <= 0.001){ discard; }

  float mossVar = noise(vCenter*0.08 + uTime*0.02);
  vec3 moss = mix(uMossDark, uMossLight, mossVar);
  vec3 baseCol = mix(moss, uDotBranch, 0.35);
  vec3 col = mix(baseCol, uDotFusion, step(0.5, vKind));

  float grain = noise(vCenter*0.6 + c*4.0);
  float ring = sin((r*7.5 + mossVar*2.2 + noise(vCenter*0.25))*3.14159);
  float crack = smoothstep(0.4, 1.0, abs(ring));
  col *= 0.82 + grain*0.24;
  col *= 1.0 - crack*0.18;

  float core = smoothstep(0.55, 0.0, r);
  col *= 0.85 + 0.23*core;

  float patina = noise(vCenter*1.3 + vec2(vSize*0.05)) * 0.35;
  col = mix(col, col*0.55, patina);

  float phase = hash(vCenter*0.17);
  float freq = mix(0.35, 0.95, hash(vCenter*0.41));
  float breathe = 0.5 + 0.5*sin(uTime*freq + phase*6.28318);
  float spark = smoothstep(0.25, 0.95, breathe);
  vec3 sporeTint = mix(uMossLight, uDotFusion, 0.35);
  col = mix(col, sporeTint, 0.22 * spark);
  float haze = smoothstep(0.0, 0.7, 1.0 - r);
  col += haze * 0.18 * spark;
  alpha *= clamp(0.85 + 0.15 * spark, 0.0, 1.0);

  o = vec4(clamp(col, 0.0, 1.0), alpha * 0.92);
}`;

const q = (sel)=>document.querySelector(sel);
function compile(gl, type, src){
  const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh);
  if(!gl.getShaderParameter(sh, gl.COMPILE_STATUS)){ throw new Error(gl.getShaderInfoLog(sh)); }
  return sh;
}
function program(gl, vs, fs){
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if(!gl.getProgramParameter(p, gl.LINK_STATUS)){ throw new Error(gl.getProgramInfoLog(p)); }
  return p;
}

let initialized = false;

async function initBlogNetwork(){
  if (initialized) return;
  
  const canvas = q('#blog-network-canvas');
  if (!canvas) return;
  const context = requestProtectedWebGL2Context(canvas, { alpha:false, antialias:false, preserveDrawingBuffer:false, powerPreference:'high-performance' });
  const gl = context.gl;
  if(!gl){
    showWebGLFallback(canvas, context.reason);
    return;
  }

  let running = false;
  let rafId = null;
  let clockRafId = null;

  const releaseCanvasBuffer = () => {
    canvas.width = 1;
    canvas.height = 1;
    gl.viewport(0, 0, 1, 1);
  };

  const stopClockLoop = () => {
    if (clockRafId) {
      cancelAnimationFrame(clockRafId);
      clockRafId = null;
    }
  };

  installWebGLContextHealth(canvas, {
    onLost: () => {
      stopClockLoop();
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      running = false;
    },
    onRestored: () => {
      initialized = false;
      if (document.getElementById('blog')?.classList.contains('active-section')) {
        void initBlogNetwork();
      }
    }
  });

  // Load network JSON
  const res = await fetch(`./artifacts/blog_network.json?v=${BLOG_NETWORK_VERSION}`);
  const data = await res.json();

  // Build geometry buffers. Per-vertex vein diameter comes from the JSON ([x,y,w]) — width is
  // flux-driven now, not derived from distance/depth.
  const segs = [];

  // Per-hub segment buffers for hover highlight, bucketed by the flux-tag in the data
  // (the category whose protoplasmic flow each vein carries), not by spatial proximity.
  const hubIds = ['craft', 'cosmos', 'codex', 'convergence'];
  const perHub = Object.fromEntries(hubIds.map(h => [h, []]));

  // Global max vein diameter -> thickRatio for the shader's color + alpha grading.
  let maxW = 1e-6;
  (data.paths||[]).forEach((p)=>{
    for(const pt of p){ const w = pt[2]||1; if(w>maxW) maxW = w; }
  });

  const VEIN_WIDTH_K = 0.5;   // overall vein thinness (0.5 = half the generated diameter)
  (data.paths||[]).forEach((p, i)=>{
    if(p.length<2) return;
    const meta = (data.paths_meta&&data.paths_meta[i])||{};
    const bucket = (meta.hub && perHub[meta.hub]) ? perHub[meta.hub] : null;
    for(let j=0;j<p.length-1;j++){
      const x1=p[j][0], y1=p[j][1], x2=p[j+1][0], y2=p[j+1][1];
      const wOrig = ((p[j][2]||1) + (p[j+1][2]||1)) * 0.5;   // mean endpoint diameter (VIEW px)
      const thickRatio = Math.min(1.0, wOrig/maxW);          // color/alpha keep the true hierarchy
      const w = wOrig * VEIN_WIDTH_K;                         // physical width, thinned
      segs.push(x1,y1,x2,y2, w, 0.0, thickRatio);
      if(bucket) bucket.push(x1,y1,x2,y2, w, 0.0, thickRatio);
    }
  });

  const nodes = [];                       // scattered node dots dropped (not in this look)
  const segCount = segs.length/7;
  const nodeCount = 0;

  // Plasmodial mass blobs at the anchors (rendered via the cyst program, under the veins).
  // [x, y, size, kind]  kind 0 = food (moss), 1 = source (ember)
  const masses = [];
  (data.masses||[]).forEach((m)=>{
    if(typeof m.x==='number' && typeof m.y==='number'){
      masses.push(m.x, m.y, (m.r||56), m.kind==='source'?1:0);
    }
  });

  // hub-halo / hover-ember reuse a 1-instance dynamic cyst buffer; no scattered cysts.
  const cysts = [0,0,2.5,0];
  const cystCount = 0;

  // Prepare buffers/VAOs
  function makeVAOforSegments(){
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    // quad
    const quad = new Float32Array([0,-1, 0,1, 1,-1, 1,1]); // triangle strip
    const bQuad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bQuad);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    // instances
    const inst = new Float32Array(segs);
    const bInst = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bInst);
    gl.bufferData(gl.ARRAY_BUFFER, inst, gl.STATIC_DRAW);
    const STRIDE = 7*4; // 7 floats
    // aP0
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, STRIDE, 0);
    gl.vertexAttribDivisor(1, 1);
    // aP1
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, STRIDE, 8);
    gl.vertexAttribDivisor(2, 1);
    // aW
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, STRIDE, 16);
    gl.vertexAttribDivisor(3, 1);
    // aKind
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 1, gl.FLOAT, false, STRIDE, 20);
    gl.vertexAttribDivisor(4, 1);
    // aThick
    gl.enableVertexAttribArray(5);
    gl.vertexAttribPointer(5, 1, gl.FLOAT, false, STRIDE, 24);
    gl.vertexAttribDivisor(5, 1);
    gl.bindVertexArray(null);
    return { vao, count: segCount };
  }
  function makeVAOforCysts(){
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    // quad
    const quad = new Float32Array([-1,-1, -1,1, 1,-1, 1,1]);
    const bQuad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bQuad);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    // instances: pos,size,pulse
    const inst = new Float32Array(cysts);
    const bInst = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bInst);
    gl.bufferData(gl.ARRAY_BUFFER, inst, gl.DYNAMIC_DRAW);
    const STR = 4*4; // x,y,size,pulse
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,2,gl.FLOAT,false,STR,0); gl.vertexAttribDivisor(1,1);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2,1,gl.FLOAT,false,STR,8); gl.vertexAttribDivisor(2,1);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3,1,gl.FLOAT,false,STR,12); gl.vertexAttribDivisor(3,1);
    gl.bindVertexArray(null);
    return { vao, count: cystCount, buf: bInst, data: inst };
  }
  function makeVAOforNodes(){
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const quad = new Float32Array([-1,-1, -1,1, 1,-1, 1,1]);
    const bQuad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bQuad);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const inst = new Float32Array(nodes);
    const bInst = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bInst);
    gl.bufferData(gl.ARRAY_BUFFER, inst, gl.STATIC_DRAW);
    const STR = 4*4; // x,y,size,kind
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,2,gl.FLOAT,false,STR,0); gl.vertexAttribDivisor(1,1);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2,1,gl.FLOAT,false,STR,8); gl.vertexAttribDivisor(2,1);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3,1,gl.FLOAT,false,STR,12); gl.vertexAttribDivisor(3,1);
    gl.bindVertexArray(null);
    return { vao, count: nodeCount };
  }

  const progPaper = program(gl, VS_FSQ, FS_PAPER);
  const progSeg   = program(gl, VS_SEG, FS_SEG);
  const progCyst  = program(gl, VS_CYST, FS_CYST);
  const progNode  = program(gl, VS_NODE, FS_NODE);

  // Create main VAO
  const vaoSeg  = makeVAOforSegments();
  const vaoCyst = makeVAOforCysts();
  const vaoNode = makeVAOforNodes();
  
  // Create per-hub VAOs for highlighting
  const vaoByHub = {};
  for (const hubId of hubIds) {
    const hubSegs = perHub[hubId];
    const hubSegCount = hubSegs.length / 7;
    
    const vao = gl.createVertexArray(); 
    gl.bindVertexArray(vao);
    
    // quad (same as main)
    const quad = new Float32Array([0,-1, 0,1, 1,-1, 1,1]);
    const bQuad = gl.createBuffer(); 
    gl.bindBuffer(gl.ARRAY_BUFFER, bQuad);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    
    // instances for this hub
    const inst = new Float32Array(hubSegs);
    const bInst = gl.createBuffer(); 
    gl.bindBuffer(gl.ARRAY_BUFFER, bInst);
    gl.bufferData(gl.ARRAY_BUFFER, inst, gl.STATIC_DRAW);
    const STRIDE = 7*4;
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, STRIDE, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, STRIDE, 8);
    gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, STRIDE, 16);
    gl.vertexAttribDivisor(3, 1);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 1, gl.FLOAT, false, STRIDE, 20);
    gl.vertexAttribDivisor(4, 1);
    gl.enableVertexAttribArray(5);
    gl.vertexAttribPointer(5, 1, gl.FLOAT, false, STRIDE, 24);
    gl.vertexAttribDivisor(5, 1);
    gl.bindVertexArray(null);
    
    vaoByHub[hubId] = { vao, count: hubSegCount };
  }

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.disable(gl.DEPTH_TEST);

  // Cache all uniform locations at init time (avoids getUniformLocation every frame)
  const _uCache = {};
  function cacheUniformsFor(prog, key, names) {
    _uCache[key] = {};
    for (const n of names) {
      _uCache[key][n] = gl.getUniformLocation(prog, n);
    }
  }
  cacheUniformsFor(progPaper, 'paper', ['uRes','uTime','uAbyss','uVignette']);
  cacheUniformsFor(progSeg, 'seg', [
    'uScale','uOffset','uShift','uRes','uTime','uDpr',
    'uBranch1','uBranch2','uBranch3','uBranch4',
    'uFusion1','uFusion2','uEmber1','uEmber2','uEmber3','uEmberR',
    'uHubPos[0]','uHubCount','uHighlight',
    'uDishCenterPx','uDishRadiusPx'
  ]);
  cacheUniformsFor(progNode, 'node', [
    'uScale','uOffset','uShift','uRes','uTime','uDpr',
    'uMossDark','uMossLight','uDotBranch','uDotFusion',
    'uDishCenterPx','uDishRadiusPx'
  ]);
  cacheUniformsFor(progCyst, 'cyst', [
    'uScale','uOffset','uShift','uRes','uTime','uDpr',
    'uGlow1','uGlow2','uGlow3','uBranch1',
    'uDishCenterPx','uDishRadiusPx'
  ]);

  // Cached uniform setters (no getUniformLocation per call)
  function set2(key,name,x,y){ gl.uniform2f(_uCache[key][name],x,y); }
  function set3(key,name,[r,g,b]){ gl.uniform3f(_uCache[key][name],r,g,b); }

  // hubs → uniform array
  const hubPos = (data.hubs||[]).map(h=>[h.x, h.y]);
  const _hubFlat = new Float32Array(16); // pre-allocated
  hubPos.forEach((h,i)=>{ _hubFlat[i*2]=h[0]; _hubFlat[i*2+1]=h[1]; });
  function setHubs(key){
    gl.uniform2fv(_uCache[key]['uHubPos[0]'], _hubFlat);
    gl.uniform1i(_uCache[key]['uHubCount'], hubPos.length);
  }

  // Build Petri dish SVG overlay (realistic top-down view)
  function buildDish({wCss, hCss}) {
    const svg = document.getElementById('dish');
    if (!svg) return null;
    
    svg.setAttribute('viewBox', `0 0 ${wCss} ${hCss}`);
    svg.innerHTML = '';

    const cx = wCss / 2, cy = hCss / 2;
    const r = Math.floor(Math.min(wCss, hCss) * PETRI_K); // inner agar edge; all glass is drawn OUTSIDE r
    const NS = 'http://www.w3.org/2000/svg';
    const el = (tag, attrs) => {
      const n = document.createElementNS(NS, tag);
      for (const k in attrs) n.setAttribute(k, attrs[k]);
      return n;
    };
    const arc = (rr, d0, d1) => {
      const a0 = d0 * Math.PI / 180, a1 = d1 * Math.PI / 180;
      return `M ${cx + rr * Math.cos(a0)} ${cy + rr * Math.sin(a0)} `
        + `A ${rr} ${rr} 0 0 1 ${cx + rr * Math.cos(a1)} ${cy + rr * Math.sin(a1)}`;
    };
    const frag = document.createDocumentFragment();

    // A bevelled glass-wall gradient (a LINEAR gradient on a ring reads as a glass cylinder,
    // not a flat disc) + a cool teal-bone agar that harmonises with the colony, not warm tan
    // over teal. Everything cool; warm is reserved for the later 'culture alive' ember.
    const defs = el('defs', {});
    const wall = el('linearGradient', { id: 'dishWall', gradientTransform: 'rotate(115 0.5 0.5)' });
    wall.innerHTML =
      '<stop offset="0%"   stop-color="rgba(214,236,228,0.42)"/>' +   // lit top edge (bone)
      '<stop offset="38%"  stop-color="rgba(150,178,170,0.10)"/>' +
      '<stop offset="62%"  stop-color="rgba(10,18,18,0.06)"/>' +      // dark underside (cylindrical)
      '<stop offset="100%" stop-color="rgba(150,200,186,0.30)"/>';    // faint lit bottom
    const agarGrad = el('radialGradient', { id: 'dishAgar' });
    agarGrad.innerHTML =
      '<stop offset="0%"   stop-color="rgba(120,150,140,0.04)"/>' +
      '<stop offset="55%"  stop-color="rgba(90,120,112,0.06)"/>' +
      '<stop offset="100%" stop-color="rgba(58,84,78,0.10)"/>';       // capped 0.10 — colony stays the hero
    defs.append(wall, agarGrad);
    frag.appendChild(defs);

    // proud-lid cast shadow — a faint dark ring nudged down: the dish reads as TWO pieces on the abyss
    frag.appendChild(el('circle', { cx, cy: cy + 6, r: r + 14, fill: 'none', stroke: 'rgba(6,10,11,0.4)', 'stroke-width': 6 }));
    // cool agar growth medium (the first visible medium)
    frag.appendChild(el('circle', { cx, cy, r, fill: 'url(#dishAgar)', stroke: 'none' }));
    // meniscus — a bright/dark pair where the gel climbs the wall (the key 'liquid in glass' cue)
    frag.appendChild(el('circle', { cx, cy, r: r - 3, fill: 'none', stroke: 'rgba(8,14,12,0.28)', 'stroke-width': 0.6 }));
    frag.appendChild(el('circle', { cx, cy, r: r - 1.5, fill: 'none', stroke: 'rgba(196,224,214,0.5)', 'stroke-width': 2 }));
    // double wall with thickness: a thin base ring + a proud bevelled lid-lip (the gap = the glass thickness)
    frag.appendChild(el('circle', { cx, cy, r: r + 3, fill: 'none', stroke: 'rgba(150,178,170,0.3)', 'stroke-width': 2 }));
    frag.appendChild(el('circle', { cx, cy, r: r + 11, fill: 'none', stroke: 'url(#dishWall)', 'stroke-width': 9 }));
    // broad lid sheen — a wide soft top-left glint with a brighter core (asymmetric, never a centered bloom)
    frag.appendChild(el('path', { d: arc(r + 9, -168, -90), fill: 'none', stroke: 'rgba(216,240,232,0.12)', 'stroke-width': 6, 'stroke-linecap': 'round' }));
    frag.appendChild(el('path', { d: arc(r + 9, -150, -112), fill: 'none', stroke: 'rgba(232,250,244,0.34)', 'stroke-width': 2.5, 'stroke-linecap': 'round' }));
    // counter-glint — a short crisp bottom-right arc for the curvature read
    frag.appendChild(el('path', { d: arc(r + 9, 34, 62), fill: 'none', stroke: 'rgba(200,228,220,0.2)', 'stroke-width': 2, 'stroke-linecap': 'round' }));

    // ===== Stage 2: the legendary signature =====
    // (a) rim-growth FRINGE — growth creeps inward from the rim in the colony's OWN moss
    //     palette (PAL.NECROTIC), masked to fade out before the colony core, so the article
    //     network reads as the culture that grew in THIS dish. Anastomotic (splits + rejoins).
    const fade = el('radialGradient', { id: 'dishFringeFade' });
    fade.innerHTML = '<stop offset="0%" stop-color="#000"/><stop offset="58%" stop-color="#000"/>'
      + '<stop offset="88%" stop-color="#fff"/><stop offset="100%" stop-color="#fff"/>';
    const fmask = el('mask', { id: 'dishFringe', maskUnits: 'userSpaceOnUse' });
    fmask.appendChild(el('circle', { cx, cy, r: r + 2, fill: 'url(#dishFringeFade)' }));
    defs.append(fade, fmask);
    const fringe = el('g', { class: 'dish-fringe', mask: 'url(#dishFringe)', fill: 'none', stroke: 'rgba(122,168,148,0.30)', 'stroke-width': 1.1, 'stroke-linecap': 'round' });
    const NF = 13, tips = [];
    for (let i = 0; i < NF; i++) {
      const a = (i / NF) * Math.PI * 2 + ((i * 53) % 17) / 80;
      const reach = r * (0.30 + ((i * 31) % 10) / 55);
      const sway = ((i % 2) ? 1 : -1) * (0.10 + ((i * 7) % 9) / 70);
      const am = a + sway, ae = a + sway * 1.7;
      const x0 = cx + r * Math.cos(a), y0 = cy + r * Math.sin(a);
      const xm = cx + (r - reach * 0.5) * Math.cos(am), ym = cy + (r - reach * 0.5) * Math.sin(am);
      const xe = cx + (r - reach) * Math.cos(ae), ye = cy + (r - reach) * Math.sin(ae);
      fringe.appendChild(el('path', { d: `M ${x0} ${y0} Q ${xm} ${ym} ${xe} ${ye}` }));
      tips.push([xe, ye]);
      if (i % 3 === 0) { // an offshoot that branches off
        const bx = cx + (r - reach * 0.62) * Math.cos(am + 0.2), by = cy + (r - reach * 0.62) * Math.sin(am + 0.2);
        fringe.appendChild(el('path', { d: `M ${xm} ${ym} Q ${(xm + bx) / 2} ${(ym + by) / 2} ${bx} ${by}` }));
      }
    }
    for (let i = 0; i < NF; i += 3) { // anastomosis — rejoin adjacent tips into a web
      const A = tips[i], B = tips[(i + 1) % NF];
      const mx = (A[0] + B[0]) / 2 + (cx - (A[0] + B[0]) / 2) * 0.14, my = (A[1] + B[1]) / 2 + (cy - (A[1] + B[1]) / 2) * 0.14;
      fringe.appendChild(el('path', { d: `M ${A[0]} ${A[1]} Q ${mx} ${my} ${B[0]} ${B[1]}`, 'stroke-width': 0.8 }));
    }
    frag.appendChild(fringe);

    // (b) engraved specimen TAG — typewriter notation curved on the lower-left rim
    //     (a dead zone between the N/E/S/W category labels).
    defs.appendChild(el('path', { id: 'dishTagArc', fill: 'none', d: arc(r + 20, 116, 156) }));
    const tagText = el('text', { class: 'dish-tag-text' });
    const tp = el('textPath', { href: '#dishTagArc', startOffset: '50%', 'text-anchor': 'middle' });
    tp.textContent = 'CULTURE No. AZ-2026 · incept vi.2026';
    tagText.appendChild(tp);
    frag.appendChild(tagText);
    // (c) ember 'culture alive' tick at the head of the tag (the single warm focal)
    const ea = 112 * Math.PI / 180, eR = r + 20;
    frag.appendChild(el('circle', { class: 'dish-ember', cx: cx + eR * Math.cos(ea), cy: cy + eR * Math.sin(ea), r: 3.4 }));

    // ===== Stage 3: humidity LID — condensation on the sealed glass =====
    // A sealed petri dish fogs: glassy beads scattered on the lid, denser toward the rim.
    // One reusable <symbol> (shadow + clear lens + meniscus rim + specular) instanced via
    // <use>, so it stays light. Static, decorative, aria-hidden via #dish.
    const dropGrad = el('radialGradient', { id: 'dishDrop', cx: '0.42', cy: '0.40', r: '0.62' });
    dropGrad.innerHTML =
      '<stop offset="0%"  stop-color="rgba(210,228,222,0.03)"/>' +
      '<stop offset="55%" stop-color="rgba(200,220,214,0.06)"/>' +
      '<stop offset="82%" stop-color="rgba(228,242,236,0.18)"/>' +   // bright meniscus edge
      '<stop offset="100%" stop-color="rgba(150,175,168,0.06)"/>';
    const dropSym = el('symbol', { id: 'dishDropBead', viewBox: '-1.4 -1.4 2.8 2.8', overflow: 'visible' });
    dropSym.innerHTML =
      '<circle cx="0.18" cy="0.24" r="1.02" fill="rgba(0,0,0,0.16)"/>' +                                   // cast shadow
      '<circle cx="0" cy="0" r="1" fill="url(#dishDrop)"/>' +                                              // clear lens
      '<circle cx="0" cy="0" r="1" fill="none" stroke="rgba(228,242,236,0.22)" stroke-width="0.05"/>' +   // rim
      '<ellipse cx="-0.34" cy="-0.36" rx="0.30" ry="0.20" fill="rgba(255,255,255,0.70)"/>' +              // specular
      '<circle cx="0.22" cy="0.32" r="0.08" fill="rgba(255,255,255,0.26)"/>';                              // counter-glint
    defs.append(dropGrad, dropSym);

    const lid = el('g', { class: 'dish-lid' });
    let dseed = 0x9e3779b9 ^ Math.round(r);                  // stable per dish size
    const drnd = () => { dseed |= 0; dseed = (dseed + 0x6D2B79F5) | 0;
      let t = Math.imul(dseed ^ (dseed >>> 15), 1 | dseed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const placeDrop = (dx, dy, dr, cls) => {
      const u = el('use', { x: dx - 1.4 * dr, y: dy - 1.4 * dr, width: 2.8 * dr, height: 2.8 * dr });
      if (cls) u.setAttribute('class', cls);
      u.setAttribute('href', '#dishDropBead');
      u.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#dishDropBead');
      lid.appendChild(u);
    };
    // (a) prominent beads — varied size, a few fat ones, pooled toward the rim
    const NBEADS = Math.round(r * 0.20);
    for (let i = 0; i < NBEADS; i++) {
      const dr = 1.2 + Math.pow(drnd(), 3) * 16;
      const ang = drnd() * Math.PI * 2;
      const rad = (r - dr - 4) * Math.sqrt(0.12 + 0.88 * drnd());
      placeDrop(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad, dr);
    }
    // (b) fine micro-condensation — many tiny beads spread evenly across the whole lid
    const NMICRO = Math.round(r * 0.9);
    for (let i = 0; i < NMICRO; i++) {
      const dr = 0.5 + Math.pow(drnd(), 2) * 2.6;            // 0.5 .. ~3 px
      const ang = drnd() * Math.PI * 2;
      const rad = (r - dr - 2) * Math.sqrt(drnd());          // uniform across the disc
      placeDrop(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad, dr);
    }
    // (c) a couple of beads that drift slowly (reduced-motion gated in CSS)
    placeDrop(cx + r * 0.34, cy - r * 0.42, 8.5, 'dish-drop-drift');
    placeDrop(cx - r * 0.46, cy + r * 0.28, 7.0, 'dish-drop-drift2');
    frag.appendChild(lid);

    // wire the ember to the blog hover bus ONCE — it brightens when you examine a hub
    // (#dish keeps the class across resize innerHTML wipes; only its children are rebuilt)
    if (!buildDish.__wired) {
      buildDish.__wired = true;
      window.addEventListener('blog:hover', () => svg.classList.add('dish-hot'));
      window.addEventListener('blog:hover-off', () => svg.classList.remove('dish-hot'));
    }

    svg.appendChild(frag);
    return { cx, cy, r };
  }

  // Update dish clipping uniforms (CSS pixel space, not buffer pixels)
  function updateDishUniforms(dish) {
    if (!dish) return;
    
    const dpr = currentDPR();

    // Dish center/radius are already in CSS pixels (from buildDish)
    // Pass directly to shaders - they handle DPR conversion internally
    const cxCss = dish.cx;  // CSS pixels, CSS top-left origin
    const cyCss = dish.cy;  // CSS pixels, CSS top-left origin
    const rCss  = dish.r;   // CSS pixels

    // Set uniforms for segment, cyst, AND node shaders (using cached locations)
    for (const [prog, key] of [[progSeg, 'seg'], [progCyst, 'cyst'], [progNode, 'node']]) {
      gl.useProgram(prog);
      gl.uniform2f(_uCache[key]['uDishCenterPx'], cxCss, cyCss);
      gl.uniform1f(_uCache[key]['uDishRadiusPx'], rCss);
      gl.uniform1f(_uCache[key]['uDpr'], dpr);
    }
    gl.useProgram(null);
  }

  // Build curved labels OUTSIDE dish rim
  function buildLabels(dish) {
    if (!dish) return;
    stopClockLoop();
    
    const root = document.getElementById('dish-labels');
    if (!root) return;
    
    root.innerHTML = ''; 
    root.style.pointerEvents = 'none';

    const cfg = [
      {id:'craft',        midDeg: 270, text:'CRAFT'},        // North (top)
      {id:'cosmos',       midDeg:   0, text:'COSMOS'},       // East (right)
      {id:'convergence',  midDeg: 180, text:'CONVERGENCE'},  // South (bottom)
      {id:'codex',        midDeg:  90, text:'CODEX'},        // West (left)
    ];

    const w = root.clientWidth, h = root.clientHeight;
    const cx = dish.cx, cy = dish.cy;
    const outerR = dish.r + 48; // Position labels 48px OUTSIDE the rim

    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.style.width='100%'; 
    svg.style.height='100%';
    root.appendChild(svg);

    for (const c of cfg) {
      const arcId = `arc-${c.id}`;
      const span = 70 * Math.PI/180;  // Wider arc for bigger text
      const a0 = (c.midDeg*Math.PI/180) - span/2;
      const a1 = (c.midDeg*Math.PI/180) + span/2;
      
      // Hit zone centered between rim and label for full coverage
      const hitR = dish.r + 30; // Midpoint between rim (~r+14) and label (~r+48)
      const hx0 = cx + hitR*Math.cos(a0), hy0 = cy + hitR*Math.sin(a0);
      const hx1 = cx + hitR*Math.cos(a1), hy1 = cy + hitR*Math.sin(a1);
      
      // Label text path at outer radius
      const x0 = cx + outerR*Math.cos(a0), y0 = cy + outerR*Math.sin(a0);
      const x1 = cx + outerR*Math.cos(a1), y1 = cy + outerR*Math.sin(a1);

      // Clickable group with hit zone and text
      const grp = document.createElementNS(svg.namespaceURI,'g');
      grp.classList.add('arc-btn');
      grp.dataset.hub = c.id;
      grp.setAttribute('tabindex','0');
      grp.setAttribute('role','button');
      grp.setAttribute('aria-label', `${c.text}, open category`);

      // Hit zone path - covers rim through label area
      const hitPath = document.createElementNS(svg.namespaceURI,'path');
      hitPath.setAttribute('d', `M ${hx0} ${hy0} A ${hitR} ${hitR} 0 0 1 ${hx1} ${hy1}`);
      hitPath.setAttribute('fill','none');
      hitPath.setAttribute('stroke','transparent');
      hitPath.setAttribute('stroke-width','72'); // Covers rim (r+14) to beyond label (r+48)
      grp.appendChild(hitPath);

      // Text path for label positioning
      const textArc = document.createElementNS(svg.namespaceURI,'path');
      textArc.setAttribute('id', arcId);
      textArc.setAttribute('d', `M ${x0} ${y0} A ${outerR} ${outerR} 0 0 1 ${x1} ${y1}`);
      textArc.setAttribute('fill','none');
      textArc.setAttribute('stroke','none');
      grp.appendChild(textArc);

      const text = document.createElementNS(svg.namespaceURI,'text');
      text.setAttribute('class','arc-label');
      text.setAttribute('text-anchor','middle');
      text.setAttribute('font-size','24');  // Bigger font
      text.setAttribute('letter-spacing','0.35em');

      const textPath = document.createElementNS(svg.namespaceURI,'textPath');
      textPath.setAttributeNS('http://www.w3.org/1999/xlink','xlink:href', `#${arcId}`);
      textPath.setAttribute('startOffset','50%');
      textPath.textContent = c.text;

      text.appendChild(textPath);
      grp.appendChild(text);
      svg.appendChild(grp);
    }
    
    // Add zoom indicator arc between COSMOS (0°) and CODEX (90°) at ~45°
    const zoomArcId = 'arc-zoom';
    const zoomMidDeg = 45; // Bottom-right, between COSMOS and CODEX
    const zoomSpan = 50 * Math.PI/180; // Smaller arc for zoom text
    const zoomA0 = (zoomMidDeg*Math.PI/180) - zoomSpan/2;
    const zoomA1 = (zoomMidDeg*Math.PI/180) + zoomSpan/2;
    const zoomX0 = cx + outerR*Math.cos(zoomA0), zoomY0 = cy + outerR*Math.sin(zoomA0);
    const zoomX1 = cx + outerR*Math.cos(zoomA1), zoomY1 = cy + outerR*Math.sin(zoomA1);
    
    // Zoom arc path (non-interactive)
    const zoomPath = document.createElementNS(svg.namespaceURI,'path');
    zoomPath.setAttribute('id', zoomArcId);
    zoomPath.setAttribute('d', `M ${zoomX0} ${zoomY0} A ${outerR} ${outerR} 0 0 1 ${zoomX1} ${zoomY1}`);
    zoomPath.setAttribute('fill','none');
    zoomPath.setAttribute('stroke','transparent');
    svg.appendChild(zoomPath);
    
    // Zoom text (read-only, non-clickable)
    const zoomText = document.createElementNS(svg.namespaceURI,'text');
    zoomText.setAttribute('id','zoom-arc-label');
    zoomText.setAttribute('class','zoom-arc-label');
    zoomText.setAttribute('text-anchor','middle');
    zoomText.setAttribute('font-size','16');  // Smaller than hub labels
    zoomText.setAttribute('letter-spacing','0.2em');
    zoomText.style.pointerEvents='none';
    
    const zoomTextPath = document.createElementNS(svg.namespaceURI,'textPath');
    zoomTextPath.setAttributeNS('http://www.w3.org/1999/xlink','xlink:href', `#${zoomArcId}`);
    zoomTextPath.setAttribute('startOffset','50%');
    zoomTextPath.setAttribute('id','zoom-text-content');
    zoomTextPath.textContent = '• ZOOM 100% •';
    
    zoomText.appendChild(zoomTextPath);
    svg.appendChild(zoomText);
    
    // Clock dots - orbiting between rim and labels
    const clockR = dish.r + 30; // Same track as hit zones, between rim and labels
    
    // Hour dot (largest, brass/dish color)
    const hourDot = document.createElementNS(svg.namespaceURI,'circle');
    hourDot.setAttribute('id','clock-hour');
    hourDot.setAttribute('r','7');
    hourDot.setAttribute('fill','rgba(180, 150, 110, 0.8)');
    hourDot.style.pointerEvents='none';
    svg.appendChild(hourDot);
    
    // Minute dot (medium, ominous green like craft)
    const minDot = document.createElementNS(svg.namespaceURI,'circle');
    minDot.setAttribute('id','clock-minute');
    minDot.setAttribute('r','4.5');
    minDot.setAttribute('fill','rgba(45, 140, 90, 0.75)');
    minDot.style.pointerEvents='none';
    svg.appendChild(minDot);
    
    // Second dot (smallest, ominous purple like convergence)
    const secDot = document.createElementNS(svg.namespaceURI,'circle');
    secDot.setAttribute('id','clock-second');
    secDot.setAttribute('r','2.5');
    secDot.setAttribute('fill','rgba(130, 85, 145, 0.7)');
    secDot.style.pointerEvents='none';
    svg.appendChild(secDot);
    
    // Get user timezone, fallback to Barcelona
    let userTimezone;
    try {
      userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Madrid';
    } catch {
      userTimezone = 'Europe/Madrid';
    }
    
    let lastMinute = -1;
    let lastClockTs = 0;

    // One formatter, hoisted (formatToParts in a single call instead of 3
    // toLocaleString round-trips per frame).
    const clockFmt = new Intl.DateTimeFormat('en-US', {
      timeZone: userTimezone, hour: 'numeric', hour12: false, minute: 'numeric', second: 'numeric'
    });
    function getTimeInZone() {
      const now = new Date();
      let h = 0, m = 0, s = 0;
      for (const p of clockFmt.formatToParts(now)) {
        if (p.type === 'hour') h = parseInt(p.value);
        else if (p.type === 'minute') m = parseInt(p.value);
        else if (p.type === 'second') s = parseInt(p.value);
      }
      return { h: h % 24, m, s, ms: now.getMilliseconds() };
    }
    
    function renderClockFrame() {
      const { h, m, s, ms } = getTimeInZone();
      
      // Smooth fractional values for continuous motion
      const secSmooth = s + ms / 1000;
      const minSmooth = m + secSmooth / 60;
      const hrSmooth = (h % 12) + minSmooth / 60;
      
      // Convert to angles (12 o'clock = -90° in SVG, clockwise)
      const hourAngle = (hrSmooth * 30 - 90) * Math.PI / 180;
      const minAngle = (minSmooth * 6 - 90) * Math.PI / 180;
      const secAngle = (secSmooth * 6 - 90) * Math.PI / 180;
      
      // Position dots
      hourDot.setAttribute('cx', cx + clockR * Math.cos(hourAngle));
      hourDot.setAttribute('cy', cy + clockR * Math.sin(hourAngle));
      minDot.setAttribute('cx', cx + clockR * Math.cos(minAngle));
      minDot.setAttribute('cy', cy + clockR * Math.sin(minAngle));
      secDot.setAttribute('cx', cx + clockR * Math.cos(secAngle));
      secDot.setAttribute('cy', cy + clockR * Math.sin(secAngle));
      
      // Update sr-only time for accessibility (only on minute change)
      if (m !== lastMinute) {
        lastMinute = m;
        const hubStatus = document.getElementById('hub-status');
        if (hubStatus) {
          const h12 = (h % 12) || 12;
          const ampm = h < 12 ? 'AM' : 'PM';
          hubStatus.textContent = `Current time: ${h12}:${m.toString().padStart(2,'0')} ${ampm}`;
        }
      }
    }

    // Clock animation while the blog map is visible — throttled to the governor's
    // frame interval (was an uncapped rAF doing per-frame Intl formatting).
    function animateClock(ts) {
      if (!running || document.hidden) {
        clockRafId = null;
        return;
      }
      const now = ts || performance.now();
      const interval = Math.max(33, getGraphicsBudget('blog-network').frameIntervalMs || 33);
      if (now - lastClockTs >= interval) {
        lastClockTs = now;
        renderClockFrame();
      }
      clockRafId = requestAnimationFrame(animateClock);
    }
    
    renderClockFrame();
    if (running && !document.hidden) {
      clockRafId = requestAnimationFrame(animateClock);
    }
  }

  const [netCx, netCy] = computeNetworkCentroid(data.paths);
  const shift = AUTO_CENTER 
    ? [VIEW.W * 0.5 - netCx, VIEW.H * 0.5 - netCy]
    : FIXED_SHIFT;

  // Zoom starts at the minimum (0.75x); resize() applies it, so it survives resize + re-activation.
  let userZoom = 0.75;
  let baseScale = 1;

  let resizeTimeout = null;
  let currentDish = null;
  
  function resize(){
    // Dynamic DPR: compute at resize time to handle display changes
    const dpr = currentDPR();
    
    // Get actual canvas client dimensions
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(300, rect.width); // minimum size to prevent tiny scales
    const cssH = Math.max(300, rect.height);
    
    const w = Math.max(1, Math.floor(cssW * dpr));
    const h = Math.max(1, Math.floor(cssH * dpr));
    
    // Only resize if dimensions changed significantly (>5px)
    if (Math.abs(canvas.width - w) > 5 || Math.abs(canvas.height - h) > 5) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
    
    // scale & offset to fit 1920x1080, with the user zoom applied (0.75x..1.0x)
    baseScale = Math.min(cssW/VIEW.W, cssH/VIEW.H);
    const scale = baseScale * userZoom;
    const offX = (cssW - VIEW.W*scale)/2;
    const offY = (cssH - VIEW.H*scale)/2;

    // Build Petri dish and curved labels
    currentDish = buildDish({wCss: cssW, hCss: cssH});
    updateDishUniforms(currentDish);
    buildLabels(currentDish);
    updateZoomIndicator();   // buildLabels rebuilds the label -> refresh it to the real zoom
    
    // Emit transform event for overlay (legacy, may not be needed with dish-first layout)
    window.dispatchEvent(new CustomEvent('blog:transform', {
      detail: {
        scale,
        offsetX: offX,
        offsetY: offY,
        baseW: VIEW.W,
        baseH: VIEW.H,
        cssW,
        cssH
      }
    }));
    
    return { scale, offX, offY, cssW, cssH };
  }
  let fit = resize();
  
  // Debounced resize handler to prevent rapid resizing
  window.addEventListener('resize', ()=>{ 
    if (resizeTimeout) clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      if (running) fit = resize();
    }, 100); // Wait 100ms after last resize event
  });
  
  // Listen for DPR changes dispatched by app.js (event-driven, no polling)
  let lastDPR = currentDPR();
  window.addEventListener('dpr-changed', () => {
    const dpr = currentDPR();
    if (dpr !== lastDPR) {
      lastDPR = dpr;
      if (running) fit = resize();
    }
  });

  let hoveredHubId = null;
  let activeHub = null;
  
  // Pan state (for right-mouse drag)
  let isPanning = false;
  let panStartX = 0, panStartY = 0;
  let panOffsetX = 0, panOffsetY = 0;
  
  // simple hover picking in data space (36 world-px hover radius)
  canvas.addEventListener('mousemove', (e)=>{
    // Handle panning first
    if (isPanning) {
      const dx = e.clientX - panStartX;
      const dy = e.clientY - panStartY;
      panOffsetX = dx;
      panOffsetY = dy;
      fit.offX = (fit.cssW - VIEW.W * fit.scale) / 2 + panOffsetX;
      fit.offY = (fit.cssH - VIEW.H * fit.scale) / 2 + panOffsetY;
      return;
    }
    
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX-rect.left - fit.offX)/fit.scale - shift[0];
    const my = (e.clientY-rect.top  - fit.offY)/fit.scale - shift[1];
    const prevHovered = hoveredHubId;
    hoveredHubId = null;
    let minD = 99999, idx=-1;
    const HOVER_RADIUS = 36; // world-space pixels
    for(let i=0;i<hubPos.length;i++){
      const dx = mx-hubPos[i][0], dy = my-hubPos[i][1];
      const d = Math.hypot(dx,dy);
      if(d<HOVER_RADIUS && d<minD){ minD=d; idx=i; }
    }
    hoveredHubId = idx>=0 ? (data.hubs[idx].id) : null;
    canvas.style.cursor = hoveredHubId ? 'pointer' : 'default';
    
    // Emit hover events when hub changes
    if (hoveredHubId !== prevHovered) {
      if (hoveredHubId) {
        window.dispatchEvent(new CustomEvent('blog:hover', { 
          detail: { hubId: hoveredHubId, source: 'hub-point' } 
        }));
      } else {
        window.dispatchEvent(new CustomEvent('blog:hover-off', { 
          detail: { hubId: prevHovered, source: 'hub-point' } 
        }));
      }
    }
  });
  
  // Click to navigate to category (debounced)
  let lastClickTime = 0;
  const CLICK_DEBOUNCE = 300; // ms
  
  let lastTouchNav = 0;
  canvas.addEventListener('click', ()=>{
    if (performance.now() - lastTouchNav < 500) return; // ignore the ghost click after a touch tap
    if (!hoveredHubId) return;

    const now = performance.now();
    if (now - lastClickTime < CLICK_DEBOUNCE) {
      return;
    }
    lastClickTime = now;

    // Brief spotlight effect (150ms) - non-blocking
    activeHub = hoveredHubId;
    setTimeout(() => { activeHub = null; }, 150);

    // Navigate immediately (app.js will handle the transition)
    window.dispatchEvent(new CustomEvent('blog:navigate', {
      detail: { hubId: hoveredHubId }
    }));
  });

  // Touch: tap a hub to navigate. Mobile fires no mousemove, so hoveredHubId
  // is null when the synthetic click arrives — without this, tapping a hub
  // (the most prominent interactive object on the page) does nothing.
  let touchStartT = 0, touchStartX = 0, touchStartY = 0;
  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    touchStartT = performance.now();
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  canvas.addEventListener('touchend', (e) => {
    const t = e.changedTouches && e.changedTouches[0];
    if (!t) return;
    // Only a quick, stationary tap counts as a select (not a pan/scroll)
    if (performance.now() - touchStartT > 250) return;
    if (Math.hypot(t.clientX - touchStartX, t.clientY - touchStartY) > 12) return;

    const rect = canvas.getBoundingClientRect();
    const mx = (t.clientX - rect.left - fit.offX) / fit.scale - shift[0];
    const my = (t.clientY - rect.top  - fit.offY) / fit.scale - shift[1];
    let minD = 99999, idx = -1;
    const TAP_RADIUS = 44; // larger than hover — fingers are coarse
    for (let i = 0; i < hubPos.length; i++) {
      const dx = mx - hubPos[i][0], dy = my - hubPos[i][1];
      const d = Math.hypot(dx, dy);
      if (d < TAP_RADIUS && d < minD) { minD = d; idx = i; }
    }
    if (idx < 0) return;

    const now = performance.now();
    if (now - lastClickTime < CLICK_DEBOUNCE) return;
    lastClickTime = now;
    lastTouchNav = now;

    const hubId = data.hubs[idx].id;
    activeHub = hubId;
    setTimeout(() => { activeHub = null; }, 150);
    window.dispatchEvent(new CustomEvent('blog:navigate', { detail: { hubId } }));
  }, { passive: true });

  // ESC to exit deep view
  window.addEventListener('keydown', (e)=>{
    if (e.key === 'Escape' && activeHub){
      activeHub = null;
      document.dispatchEvent(new CustomEvent('blog:activeHub', { 
        detail: { id: null } 
      }));
      history.replaceState(null, '', '#blog');
    }
  });
  
  // Listen for external hover events (from rim labels and memo)
  window.addEventListener('blog:hover', (e) => {
    const { hubId, source } = e.detail;
    if ((source === 'rim-label' || source === 'memo') && hubId && hubId !== 'source') {
      hoveredHubId = hubId;
      canvas.style.cursor = 'pointer';
    }
  });
  
  window.addEventListener('blog:hover-off', (e) => {
    const { hubId, source } = e.detail;
    // Clear if from memo (no hubId check) or if matching hub
    if (source === 'memo' || hoveredHubId === hubId) {
      hoveredHubId = null;
      canvas.style.cursor = 'default';
    }
  });
  
  // Restore deep link on load
  if (location.hash.startsWith('#blog/')) {
    const id = location.hash.split('/')[1];
    if (hubIds.includes(id)) {
      activeHub = id;
      document.dispatchEvent(new CustomEvent('blog:activeHub', { 
        detail: { id: activeHub } 
      }));
    }
  }
  
  // Wheel zoom (clamp 0.75x - 1.0x). userZoom + baseScale are declared up top and applied inside
  // resize(), so zoom survives resizes and section re-activation.
  function updateZoomIndicator() {
    const zoomTextContent = document.getElementById('zoom-text-content');
    if (zoomTextContent) {
      const zoomPercent = Math.round(userZoom * 100);
      zoomTextContent.textContent = `• ZOOM ${zoomPercent}% •`;
    }
  }
  updateZoomIndicator(); // Set initial indicator to match default zoom
  
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.95 : 1.05;
    userZoom = Math.max(0.75, Math.min(1.0, userZoom * delta));
    fit.scale = baseScale * userZoom;
    // Recalculate offsets to keep zoom centered
    fit.offX = (fit.cssW - VIEW.W * fit.scale) / 2;
    fit.offY = (fit.cssH - VIEW.H * fit.scale) / 2;
    updateZoomIndicator();
  }, { passive: false });
  
  // Right-mouse drag panning handlers
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 2) { // right mouse
      e.preventDefault();
      isPanning = true;
      panStartX = e.clientX;
      panStartY = e.clientY;
    }
  });
  
  canvas.addEventListener('mouseup', (e) => {
    if (e.button === 2) {
      isPanning = false;
    }
  });
  
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault(); // Disable context menu on right-click
  });

  // animate
  let last = performance.now();
  function loop(now){
    if (!running || document.hidden) {
      rafId = null;
      return;
    }

    const budget = getGraphicsBudget('blog-network');
    const frameIntervalMs = budget.frameIntervalMs || 0;
    const dt = now - last;
    if (frameIntervalMs && dt < frameIntervalMs) {
      rafId = requestAnimationFrame(loop);
      return;
    }
    last = now;
    reportFrameSample('blog-network', dt);

    // PAPER (renders background)
    gl.useProgram(progPaper);
    gl.bindVertexArray(null);
    gl.uniform2f(_uCache.paper['uRes'], fit.cssW, fit.cssH);
    gl.uniform1f(_uCache.paper['uTime'], now*0.001);
    set3('paper','uAbyss', PAL.ABYSS);
    gl.uniform1f(_uCache.paper['uVignette'], 0.35);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // PLASMODIAL MASSES — soft blobs at the anchors, drawn under the veins.
    // Moss for the four foods, ember for the central inoculation (the one warm focal).
    if (masses.length) {
      gl.useProgram(progCyst);
      set2('cyst','uScale', fit.scale, fit.scale);
      set2('cyst','uOffset', fit.offX, fit.offY);
      set2('cyst','uShift', shift[0], shift[1]);
      set2('cyst','uRes', fit.cssW, fit.cssH);
      gl.uniform1f(_uCache.cyst['uTime'], now*0.001);
      gl.uniform1f(_uCache.cyst['uDpr'], currentDPR());
      for (let m = 0; m < masses.length; m += 4) {
        const mx = masses[m], my = masses[m+1], msz = masses[m+2], mkind = masses[m+3];
        if (mkind > 0.5) {            // source: ember
          set3('cyst','uGlow1', PAL.EMBER1); set3('cyst','uGlow2', PAL.EMBER2); set3('cyst','uGlow3', PAL.EMBER3);
          set3('cyst','uBranch1', [0.20, 0.14, 0.09]);
        } else {                      // food: moss
          set3('cyst','uGlow1', [0.30, 0.45, 0.38]); set3('cyst','uGlow2', [0.36, 0.52, 0.43]); set3('cyst','uGlow3', [0.26, 0.39, 0.33]);
          set3('cyst','uBranch1', [0.15, 0.25, 0.21]);
        }
        vaoCyst.data.set([mx, my, msz * 0.5, m * 0.7], 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, vaoCyst.buf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, vaoCyst.data.subarray(0, 4));
        gl.bindVertexArray(vaoCyst.vao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, 1);
        gl.bindVertexArray(null);
      }
    }

    // SEGMENTS
    gl.useProgram(progSeg);
    set2('seg','uScale', fit.scale, fit.scale);
    set2('seg','uOffset', fit.offX, fit.offY);
    set2('seg','uShift', shift[0], shift[1]);
    set2('seg','uRes', fit.cssW, fit.cssH);
    gl.uniform1f(_uCache.seg['uTime'], now*0.001);
    gl.uniform1f(_uCache.seg['uDpr'], currentDPR());
    // Petri dish clipping handled by updateDishUniforms() (already set)
    // Set all branch colors
    set3('seg','uBranch1', PAL.BRANCH1);
    set3('seg','uBranch2', PAL.BRANCH2);
    set3('seg','uBranch3', PAL.BRANCH3);
    set3('seg','uBranch4', PAL.BRANCH4);
    // Set fusion colors
    set3('seg','uFusion1', PAL.FUSION1);
    set3('seg','uFusion2', PAL.FUSION2);
    // Set ember colors
    set3('seg','uEmber1', PAL.EMBER1);
    set3('seg','uEmber2', PAL.EMBER2);
    set3('seg','uEmber3', PAL.EMBER3);
    gl.uniform1f(_uCache.seg['uEmberR'], 86.0);
    setHubs('seg');

    if (!activeHub) {
      // OVERVIEW MODE: Draw all segments with optional hover highlight
      gl.uniform1f(_uCache.seg['uHighlight'], 1.0);
      gl.bindVertexArray(vaoSeg.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, vaoSeg.count);
      gl.bindVertexArray(null);
      
      // HOVER HIGHLIGHT: Additive pass for hovered hub
      if (hoveredHubId && vaoByHub[hoveredHubId]) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE); // Additive
        
        gl.uniform1f(_uCache.seg['uHighlight'], 1.15);
        gl.bindVertexArray(vaoByHub[hoveredHubId].vao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, vaoByHub[hoveredHubId].count);
        gl.bindVertexArray(null);
        
        // Reset blend
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      }
    } else {
      // DEEP VIEW MODE: Dim all, then draw active hub at full brightness
      // Pass 1: Draw all dimmed
      gl.uniform1f(_uCache.seg['uHighlight'], 0.25);
      gl.bindVertexArray(vaoSeg.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, vaoSeg.count);
      gl.bindVertexArray(null);
      
      // Pass 2: Draw active hub at higher contrast
      if (vaoByHub[activeHub]) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        
        gl.uniform1f(_uCache.seg['uHighlight'], 1.2);
        gl.bindVertexArray(vaoByHub[activeHub].vao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, vaoByHub[activeHub].count);
        gl.bindVertexArray(null);
      }
    }

    // NODE DOTS
    if(vaoNode.count){
      gl.useProgram(progNode);
      set2('node','uScale', fit.scale, fit.scale);
      set2('node','uOffset', fit.offX, fit.offY);
      set2('node','uShift', shift[0], shift[1]);
      set2('node','uRes', fit.cssW, fit.cssH);
      gl.uniform1f(_uCache.node['uTime'], now*0.001);
      gl.uniform1f(_uCache.node['uDpr'], currentDPR());
      set3('node','uMossDark', PAL.MOSS_DARK);
      set3('node','uMossLight', PAL.MOSS_LIGHT);
      set3('node','uDotBranch', PAL.NECROTIC);
      set3('node','uDotFusion', PAL.FUSION2);
      gl.bindVertexArray(vaoNode.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, vaoNode.count);
      gl.bindVertexArray(null);
    }

    // CYSTS
    gl.useProgram(progCyst);
    set2('cyst','uScale', fit.scale, fit.scale);
    set2('cyst','uOffset', fit.offX, fit.offY);
    set2('cyst','uShift', shift[0], shift[1]);
    set2('cyst','uRes', fit.cssW, fit.cssH);
    gl.uniform1f(_uCache.cyst['uTime'], now*0.001);
    gl.uniform1f(_uCache.cyst['uDpr'], currentDPR());
    set3('cyst','uGlow1', PAL.GLOW1);
    set3('cyst','uGlow2', PAL.GLOW2);
    set3('cyst','uGlow3', PAL.GLOW3);
    set3('cyst','uBranch1', PAL.BRANCH1);
    // Petri dish clipping handled by updateDishUniforms() (already set)
    gl.bindVertexArray(vaoCyst.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, vaoCyst.count);
    gl.bindVertexArray(null);

    // (per-hub ember pulse removed: the masses provide the hub glow, and the warm
    //  ember is reserved for the central inoculation mass + the on-hover halo)

    // Hover halo (breathing ember) — brighter overdraw when hovered
    if(hoveredHubId){
      const hub = data.hubs.find(h=>h.id===hoveredHubId);
      if(hub){
        gl.useProgram(progCyst);
        set2('cyst','uScale', fit.scale, fit.scale);
        set2('cyst','uOffset', fit.offX, fit.offY);
        set2('cyst','uShift', shift[0], shift[1]);
        gl.uniform1f(_uCache.cyst['uTime'], now*0.001);
        gl.uniform1f(_uCache.cyst['uDpr'], currentDPR());
        // Petri dish clipping handled by updateDishUniforms() (already set)
        set3('cyst','uGlow1', PAL.EMBER1);
        set3('cyst','uGlow2', PAL.EMBER2);
        set3('cyst','uGlow3', PAL.EMBER3);
        set3('cyst','uBranch1', PAL.BRANCH1);
        // draw one big pulse at hub
        const pulse = (Math.sin(now*0.0005)*0.2+0.8);
        const r = 20 + 44*pulse;
        // quick immediate-mode instancing (no buffer update): use viewport trick
        // simpler: draw a triangle strip with gl_VertexID FSQ but centered—reuse cyst VAO first instance by updating buffer
        vaoCyst.data.set([hub.x, hub.y, 10.0, 0.0], 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, vaoCyst.buf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, vaoCyst.data.subarray(0,4));
        gl.bindVertexArray(vaoCyst.vao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, 1);
        gl.bindVertexArray(null);
      }
    }

    if (running && !document.hidden) {
      rafId = requestAnimationFrame(loop);
    } else {
      rafId = null;
    }
  }
  
  initialized = true;
  
  // Pause/resume when blog section visibility changes
  const startLoop = () => {
    if (running && !document.hidden && !rafId) {
      fit = resize();
      last = performance.now();
      rafId = requestAnimationFrame(loop);
    }
  };
  const stopLoop = () => {
    if (rafId) {
      cancelAnimationFrame(rafId);
    }
    rafId = null;
    stopClockLoop();
    releaseCanvasBuffer();
  };
  const blogStage = document.querySelector('.blog-screen');
  if (blogStage) {
    const obs = new MutationObserver(() => {
      const isActive = blogStage.classList.contains('active-section');
      running = isActive;
      if (isActive) startLoop();
      else stopLoop();
    });
    obs.observe(blogStage, { attributes: true, attributeFilter: ['class'] });
    
    // Initial check
    running = blogStage.classList.contains('active-section');
    if (!running) {
      releaseCanvasBuffer();
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopLoop();
    else startLoop();
  });
  
  // Start animation loop
  startLoop();
}

// Wait for DOM to be ready, then init when blog section becomes visible
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    watchForBlogSection();
  });
} else {
  watchForBlogSection();
}

function watchForBlogSection() {
  const blogSection = document.getElementById('blog');
  if (!blogSection) return;
  
  // Check if already visible
  if (blogSection.classList.contains('active-section')) {
    initBlogNetwork();
    return;
  }
  
  // Watch for visibility changes
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
        if (blogSection.classList.contains('active-section')) {
          initBlogNetwork();
          observer.disconnect(); // Stop watching after init
        }
      }
    });
  });
  
  observer.observe(blogSection, {
    attributes: true,
    attributeFilter: ['class']
  });
}
