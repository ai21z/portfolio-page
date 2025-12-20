// blog-network-webgl.js — Hand-painted mycelium network
const BLOG_NETWORK_VERSION = window.__BLOG_NETWORK_VERSION || '20251029-trunks6-branch1p2x-rough';
if (!window.__BLOG_NETWORK_VERSION) {
  window.__BLOG_NETWORK_VERSION = BLOG_NETWORK_VERSION;
}

const PETRI_K = 0.42;
const AUTO_CENTER = true;
const FIXED_SHIFT = [0, 0];

const PAL = {
  ABYSS: [0.05, 0.06, 0.07],        // soft charcoal background
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
  return Math.min(Math.max(1, window.devicePixelRatio || 1), 2); // cap at 2x for performance
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
  
  vec3 col;
  if(vKind > 0.5) {
    // Fusions: alternate between two fusion colors
    col = mix(uFusion1, uFusion2, step(0.5, colorVar));
  } else {
    // Branches: pick from 4 colors based on hash
    if(colorVar < 0.25) col = uBranch1;
    else if(colorVar < 0.5) col = uBranch2;
    else if(colorVar < 0.75) col = uBranch3;
    else col = uBranch4;
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

  // Hub ember highlights (multi-color)
  float minHub = 1e9;
  int nearestHub = 0;
  for(int i=0;i<8;i++){
    if(i>=uHubCount) break;
    vec2 h = uHubPos[i];
  float dist2 = dot(world-h, world-h);
    if(dist2<minHub) { minHub = dist2; nearestHub = i; }
  }
  float nearHub = smoothstep(uEmberR*uEmberR, 0.0, minHub);
  float thickOK = step(0.7, vThick);
  
  // Pick ember color based on hub index
  vec3 emberCol;
  int hubMod = nearestHub % 3;
  if(hubMod == 0) emberCol = uEmber1;
  else if(hubMod == 1) emberCol = uEmber2;
  else emberCol = uEmber3;
  
  col = mix(col, emberCol, nearHub * thickOK * 0.75);

  // Soft painted glow
  float glow = smoothstep(3.5, 0.0, d) * 0.2;
  col += col * glow;
  
  // Apply highlight (clamped to 1.25x max)
  col *= min(uHighlight, 1.25);

  o = vec4(clamp(col, 0.0, 1.0), alpha * 0.95);
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
let animationActive = false;

async function initBlogNetwork(){
  if (initialized) return;
  
  const canvas = q('#blog-network-canvas');
  if (!canvas) return;
  const gl = canvas.getContext('webgl2', { alpha:false, antialias:false, preserveDrawingBuffer:false, powerPreference:'high-performance' });
  if(!gl){ console.error('WebGL2 not available'); return; }

  // Load network JSON
  const res = await fetch(`./artifacts/blog_network.json?v=${BLOG_NETWORK_VERSION}`);
  const data = await res.json();

  // Build geometry buffers (segments)
  const segs = [];
  const MAXW = 4.5, MINW = 0.9;
  const WIDTH_SCALE = 1.4; // global thickness boost (30% thinner than previous double width)
  const hubLookup = new Map();
  (data.hubs||[]).forEach((hub)=>{
    if(hub && hub.id!==undefined && typeof hub.x==='number' && typeof hub.y==='number'){
      hubLookup.set(hub.id, [hub.x, hub.y]);
    }
  });
  
  // Per-hub segment buffers for selective rendering
  const hubIds = ['craft', 'cosmos', 'codex', 'convergence'];
  const perHub = Object.fromEntries(hubIds.map(h => [h, []]));
  
  const nodeMap = new Map();
  const nodes = [];
  const stashNode = (x, y, radius, kind)=>{
    const key = `${Math.round(x)}:${Math.round(y)}`;
    const existing = nodeMap.get(key);
    if(existing){
      existing.radius = Math.max(existing.radius, radius);
      existing.kind = Math.max(existing.kind, kind);
    }else{
      nodeMap.set(key, { x, y, radius, kind });
    }
  };
  (data.paths||[]).forEach((p, i)=>{
    if(p.length<2) return;
    const meta = (data.paths_meta&&data.paths_meta[i])||{};
    const kind = meta.kind==='fusion'?1:0;
    const isTrunk = meta.kind === 'trunk';
    const tier = typeof meta.tier === 'number' ? meta.tier : null;
    const hub = meta.hub || 'craft'; // default to craft if no hub specified
  // Mirror generator's radial taper when depth is absent in metadata.
  let depth = typeof meta.depth==='number' ? meta.depth : null;
    if(depth===null){
      const ref = p[0];
      let origin = null;
      if(meta.hub && hubLookup.has(meta.hub)){
        origin = hubLookup.get(meta.hub);
      }else if(hubLookup.size){
        let minDist = Infinity;
        hubLookup.forEach(([hx, hy])=>{
          const d = Math.hypot(ref[0]-hx, ref[1]-hy);
          if(d<minDist){
            minDist = d;
            origin = [hx, hy];
          }
        });
      }
      if(origin){
        const dist = Math.hypot(ref[0]-origin[0], ref[1]-origin[1]);
        depth = Math.min(8, Math.floor(dist/80));
      }else{
        depth = 0;
      }
    }
  const branchBoost = (!isTrunk && tier !== null && tier <= 1) ? 1.0 : 0.0;
  const thicknessScale = isTrunk ? 1.0 : 1.2;
  const base = (Math.max(MINW, MAXW - 0.5*depth) * WIDTH_SCALE + branchBoost) * thicknessScale;
    const pushEndpoint = (point, prog, shrink)=>{
      if(!point) return;
  const w = base*(1.0 - 0.4*prog);
      const scale = shrink ? 0.5 : 1.0;
      const radius = Math.max(6.0*scale, w*1.4*scale);
      stashNode(point[0], point[1], radius, kind);
    };
    pushEndpoint(p[0], 0, false);
    pushEndpoint(p[p.length-1], p.length>1 ? 1 : 0, true);
    for(let j=0;j<p.length-1;j++){
      const [x1,y1] = p[j], [x2,y2] = p[j+1];
      const prog = j/(p.length-1);
      const w = base*(1.0 - 0.4*prog);
      const thickRatio = Math.min(1.0, w/(MAXW * WIDTH_SCALE));
      // Push to global buffer
      segs.push(x1,y1,x2,y2,w, kind, thickRatio);
      
      // Assign segment to hub based on SPATIAL PROXIMITY (segment midpoint)
      // rather than path metadata destination tag
      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;
      let closestHub = null;
      let minDist = Infinity;
      
      // Check distance to each interactive hub
      hubIds.forEach(hubId => {
        const hubData = hubLookup.get(hubId);
        if(hubData) {
          const [hx, hy] = hubData;
          const dist = Math.hypot(midX - hx, midY - hy);
          if(dist < minDist) {
            minDist = dist;
            closestHub = hubId;
          }
        }
      });
      
      // Push segment to the spatially-closest hub buffer
      if(closestHub && perHub[closestHub]) {
        perHub[closestHub].push(x1,y1,x2,y2,w, kind, thickRatio);
      }
    }
  });
  nodeMap.forEach((n)=>{
    nodes.push(n.x, n.y, n.radius, n.kind);
  });
  const segCount = segs.length/7;
  const nodeCount = nodes.length/4;

  // infected/cyst nodes (every 12th)
  const cysts = [];
  const interval = 12;
  (data.paths||[]).forEach((p)=>{
    for(let i=interval;i<p.length-interval;i+=interval){
      const [x,y] = p[i];
      cysts.push(x,y, 2.5, Math.random()*6.2831);
    }
  });
  const cystCount = cysts.length/4;

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

  // uniforms helpers
  function set2(p,name,x,y){ const l=gl.getUniformLocation(p,name); gl.uniform2f(l,x,y); }
  function set3(p,name,[r,g,b]){ const l=gl.getUniformLocation(p,name); gl.uniform3f(l,r,g,b); }

  // hubs → uniform array
  const hubPos = (data.hubs||[]).map(h=>[h.x, h.y]);
  function setHubs(p){
    const loc = gl.getUniformLocation(p, 'uHubPos[0]');
    const flat = new Float32Array(16);
    hubPos.forEach((h,i)=>{ flat[i*2]=h[0]; flat[i*2+1]=h[1]; });
    gl.uniform2fv(loc, flat);
    gl.uniform1i(gl.getUniformLocation(p,'uHubCount'), hubPos.length);
  }

  // Build Petri dish SVG overlay (realistic top-down view)
  function buildDish({wCss, hCss}) {
    const svg = document.getElementById('dish');
    if (!svg) return null;
    
    svg.setAttribute('viewBox', `0 0 ${wCss} ${hCss}`);
    svg.innerHTML = '';

    const cx = wCss/2, cy = hCss/2;
    const r  = Math.floor(Math.min(wCss,hCss) * PETRI_K); // inner radius for crop (uses PETRI_K constant)

    // Create defs for gradients
    const defs = document.createElementNS('http://www.w3.org/2000/svg','defs');
    
    // Glass rim gradient (top-down lighting)
    const rimGrad = document.createElementNS('http://www.w3.org/2000/svg','radialGradient');
    rimGrad.setAttribute('id','rimGrad');
    rimGrad.innerHTML = `
      <stop offset="0%" stop-color="rgba(255,255,255,0.08)" />
      <stop offset="70%" stop-color="rgba(228,189,140,0.15)" />
      <stop offset="85%" stop-color="rgba(255,255,255,0.25)" />
      <stop offset="100%" stop-color="rgba(180,160,130,0.3)" />
    `;
    
    // Agar medium gradient (subtle depth - keep transparent for network visibility)
    const agarGrad = document.createElementNS('http://www.w3.org/2000/svg','radialGradient');
    agarGrad.setAttribute('id','agarGrad');
    agarGrad.innerHTML = `
      <stop offset="0%" stop-color="rgba(160,140,120,0.04)" />
      <stop offset="50%" stop-color="rgba(140,120,100,0.02)" />
      <stop offset="100%" stop-color="rgba(120,100,80,0.01)" />
    `;
    
    defs.append(rimGrad, agarGrad);
    svg.appendChild(defs);

    // Outer shadow (dish sitting on surface)
    const shadow = document.createElementNS('http://www.w3.org/2000/svg','circle');
    shadow.setAttribute('cx', cx); 
    shadow.setAttribute('cy', cy);
    shadow.setAttribute('r', r+16);
    shadow.setAttribute('fill','none');
    shadow.setAttribute('stroke','rgba(0,0,0,0.15)');
    shadow.setAttribute('stroke-width','6');
    shadow.setAttribute('opacity','0.6');

    // Glass rim (thick wall with gradient)
    const rimOuter = document.createElementNS('http://www.w3.org/2000/svg','circle');
    rimOuter.setAttribute('cx', cx); 
    rimOuter.setAttribute('cy', cy);
    rimOuter.setAttribute('r', r+14);
    rimOuter.setAttribute('fill','none');
    rimOuter.setAttribute('stroke','url(#rimGrad)');
    rimOuter.setAttribute('stroke-width','12');

    // Inner glass edge (where medium meets wall)
    const rimInner = document.createElementNS('http://www.w3.org/2000/svg','circle');
    rimInner.setAttribute('cx', cx); 
    rimInner.setAttribute('cy', cy);
    rimInner.setAttribute('r', r+2);
    rimInner.setAttribute('fill','none');
    rimInner.setAttribute('stroke','rgba(200,180,150,0.2)');
    rimInner.setAttribute('stroke-width','1.5');

    // Agar medium (subtle gel texture)
    const agar = document.createElementNS('http://www.w3.org/2000/svg','circle');
    agar.setAttribute('cx', cx); 
    agar.setAttribute('cy', cy);
    agar.setAttribute('r', r);
    agar.setAttribute('fill','url(#agarGrad)');
    agar.setAttribute('stroke','none');

    // Meniscus line (liquid surface tension)
    const meniscus = document.createElementNS('http://www.w3.org/2000/svg','circle');
    meniscus.setAttribute('cx', cx); 
    meniscus.setAttribute('cy', cy);
    meniscus.setAttribute('r', r-1);
    meniscus.setAttribute('fill','none');
    meniscus.setAttribute('stroke','rgba(228,189,140,0.08)');
    meniscus.setAttribute('stroke-width','0.5');

    // Top-left specular highlight (overhead light reflection)
    const spec1 = document.createElementNS('http://www.w3.org/2000/svg','path');
    const a0 = -160*Math.PI/180, a1 = -115*Math.PI/180, rs = r+8;
    const x0 = cx + rs*Math.cos(a0), y0 = cy + rs*Math.sin(a0);
    const x1 = cx + rs*Math.cos(a1), y1 = cy + rs*Math.sin(a1);
    spec1.setAttribute('d', `M ${x0} ${y0} A ${rs} ${rs} 0 0 1 ${x1} ${y1}`);
    spec1.setAttribute('stroke','rgba(255,255,255,0.25)');
    spec1.setAttribute('stroke-width','3');
    spec1.setAttribute('fill','none');
    spec1.setAttribute('stroke-linecap','round');

    // Bottom-right subtle reflection
    const spec2 = document.createElementNS('http://www.w3.org/2000/svg','path');
    const a2 = 25*Math.PI/180, a3 = 70*Math.PI/180;
    const x2 = cx + rs*Math.cos(a2), y2 = cy + rs*Math.sin(a2);
    const x3 = cx + rs*Math.cos(a3), y3 = cy + rs*Math.sin(a3);
    spec2.setAttribute('d', `M ${x2} ${y2} A ${rs} ${rs} 0 0 1 ${x3} ${y3}`);
    spec2.setAttribute('stroke','rgba(255,255,255,0.12)');
    spec2.setAttribute('stroke-width','2');
    spec2.setAttribute('fill','none');
    spec2.setAttribute('stroke-linecap','round');

    svg.append(shadow, agar, meniscus, rimInner, rimOuter, spec1, spec2);
    
    return {cx, cy, r};
  }

  // Update dish clipping uniforms (CSS pixel space, not buffer pixels)
  function updateDishUniforms(dish) {
    if (!dish) return;
    
    const dpr = window.devicePixelRatio || 1;

    // Dish center/radius are already in CSS pixels (from buildDish)
    // Pass directly to shaders - they handle DPR conversion internally
    const cxCss = dish.cx;  // CSS pixels, CSS top-left origin
    const cyCss = dish.cy;  // CSS pixels, CSS top-left origin
    const rCss  = dish.r;   // CSS pixels

    // Set uniforms for segment, cyst, AND node shaders
    for (const prog of [progSeg, progCyst, progNode]) {
      gl.useProgram(prog);
      gl.uniform2f(gl.getUniformLocation(prog,'uDishCenterPx'), cxCss, cyCss);
      gl.uniform1f(gl.getUniformLocation(prog,'uDishRadiusPx'), rCss);
      gl.uniform1f(gl.getUniformLocation(prog,'uDpr'), dpr);
    }
    gl.useProgram(null);
  }

  // Build curved labels OUTSIDE dish rim
  function buildLabels(dish) {
    if (!dish) return;
    
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
      grp.setAttribute('aria-label', `${c.text} — open category`);

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
  }

  const [netCx, netCy] = computeNetworkCentroid(data.paths);
  const shift = AUTO_CENTER 
    ? [VIEW.W * 0.5 - netCx, VIEW.H * 0.5 - netCy]
    : FIXED_SHIFT;

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
    
    // scale & offset to fit 1920x1080
    const scale = Math.min(cssW/VIEW.W, cssH/VIEW.H);
    const offX = (cssW - VIEW.W*scale)/2;
    const offY = (cssH - VIEW.H*scale)/2;
    
    // Build Petri dish and curved labels
    currentDish = buildDish({wCss: cssW, hCss: cssH});
    updateDishUniforms(currentDish);
    buildLabels(currentDish);
    
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
      fit = resize();
    }, 100); // Wait 100ms after last resize event
  });
  
  // Poll for DPR changes (e.g., moving window between displays with different zoom)
  let lastDPR = currentDPR();
  setInterval(() => {
    const dpr = currentDPR();
    if (dpr !== lastDPR) {
      lastDPR = dpr;
      fit = resize();
    }
  }, 500);

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
  
  canvas.addEventListener('click', ()=>{
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
  
  // Wheel zoom (clamp to 0.75x - 1.0x base scale)
  const baseScale = fit.scale;
  let userZoom = 0.81;
  fit.scale = baseScale * userZoom;
  fit.offX = (fit.cssW - VIEW.W * fit.scale) / 2;
  fit.offY = (fit.cssH - VIEW.H * fit.scale) / 2;
  
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
  let frameCount = 0;
  function loop(now){
    const dt = now-last; if(dt<1000/30){ requestAnimationFrame(loop); return; } // 30 FPS cap
    last = now;
    frameCount++;

    // PAPER (renders background)
    gl.useProgram(progPaper);
    gl.bindVertexArray(null);
    gl.uniform2f(gl.getUniformLocation(progPaper,'uRes'), fit.cssW, fit.cssH);
    gl.uniform1f(gl.getUniformLocation(progPaper,'uTime'), now*0.001);
    set3(progPaper,'uAbyss', PAL.ABYSS);
    gl.uniform1f(gl.getUniformLocation(progPaper,'uVignette'), 0.35);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // SEGMENTS
    gl.useProgram(progSeg);
    set2(progSeg,'uScale', fit.scale, fit.scale);
    set2(progSeg,'uOffset', fit.offX, fit.offY);
    set2(progSeg,'uShift', shift[0], shift[1]);
    set2(progSeg,'uRes', fit.cssW, fit.cssH);
    gl.uniform1f(gl.getUniformLocation(progSeg,'uTime'), now*0.001);
    gl.uniform1f(gl.getUniformLocation(progSeg,'uDpr'), currentDPR());
    // Petri dish clipping handled by updateDishUniforms() (already set)
    // Set all branch colors
    set3(progSeg,'uBranch1', PAL.BRANCH1);
    set3(progSeg,'uBranch2', PAL.BRANCH2);
    set3(progSeg,'uBranch3', PAL.BRANCH3);
    set3(progSeg,'uBranch4', PAL.BRANCH4);
    // Set fusion colors
    set3(progSeg,'uFusion1', PAL.FUSION1);
    set3(progSeg,'uFusion2', PAL.FUSION2);
    // Set ember colors
    set3(progSeg,'uEmber1', PAL.EMBER1);
    set3(progSeg,'uEmber2', PAL.EMBER2);
    set3(progSeg,'uEmber3', PAL.EMBER3);
    gl.uniform1f(gl.getUniformLocation(progSeg,'uEmberR'), 86.0);
    setHubs(progSeg);

    if (!activeHub) {
      // OVERVIEW MODE: Draw all segments with optional hover highlight
      gl.uniform1f(gl.getUniformLocation(progSeg,'uHighlight'), 1.0);
      gl.bindVertexArray(vaoSeg.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, vaoSeg.count);
      gl.bindVertexArray(null);
      
      // HOVER HIGHLIGHT: Additive pass for hovered hub
      if (hoveredHubId && vaoByHub[hoveredHubId]) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE); // Additive
        
        gl.uniform1f(gl.getUniformLocation(progSeg,'uHighlight'), 1.15);
        gl.bindVertexArray(vaoByHub[hoveredHubId].vao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, vaoByHub[hoveredHubId].count);
        gl.bindVertexArray(null);
        
        // Reset blend
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      }
    } else {
      // DEEP VIEW MODE: Dim all, then draw active hub at full brightness
      // Pass 1: Draw all dimmed
      gl.uniform1f(gl.getUniformLocation(progSeg,'uHighlight'), 0.25);
      gl.bindVertexArray(vaoSeg.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, vaoSeg.count);
      gl.bindVertexArray(null);
      
      // Pass 2: Draw active hub at higher contrast
      if (vaoByHub[activeHub]) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        
        gl.uniform1f(gl.getUniformLocation(progSeg,'uHighlight'), 1.2);
        gl.bindVertexArray(vaoByHub[activeHub].vao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, vaoByHub[activeHub].count);
        gl.bindVertexArray(null);
      }
    }

    // NODE DOTS
    if(vaoNode.count){
      gl.useProgram(progNode);
      set2(progNode,'uScale', fit.scale, fit.scale);
      set2(progNode,'uOffset', fit.offX, fit.offY);
      set2(progNode,'uShift', shift[0], shift[1]);
      set2(progNode,'uRes', fit.cssW, fit.cssH);
      gl.uniform1f(gl.getUniformLocation(progNode,'uTime'), now*0.001);
      gl.uniform1f(gl.getUniformLocation(progNode,'uDpr'), currentDPR());
      set3(progNode,'uMossDark', PAL.MOSS_DARK);
      set3(progNode,'uMossLight', PAL.MOSS_LIGHT);
      set3(progNode,'uDotBranch', PAL.NECROTIC);
      set3(progNode,'uDotFusion', PAL.FUSION2);
      gl.bindVertexArray(vaoNode.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, vaoNode.count);
      gl.bindVertexArray(null);
    }

    // CYSTS
    gl.useProgram(progCyst);
    set2(progCyst,'uScale', fit.scale, fit.scale);
    set2(progCyst,'uOffset', fit.offX, fit.offY);
    set2(progCyst,'uShift', shift[0], shift[1]);
    set2(progCyst,'uRes', fit.cssW, fit.cssH);
    gl.uniform1f(gl.getUniformLocation(progCyst,'uTime'), now*0.001);
    gl.uniform1f(gl.getUniformLocation(progCyst,'uDpr'), currentDPR());
    set3(progCyst,'uGlow1', PAL.GLOW1);
    set3(progCyst,'uGlow2', PAL.GLOW2);
    set3(progCyst,'uGlow3', PAL.GLOW3);
    set3(progCyst,'uBranch1', PAL.BRANCH1);
    // Petri dish clipping handled by updateDishUniforms() (already set)
    gl.bindVertexArray(vaoCyst.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, vaoCyst.count);
    gl.bindVertexArray(null);

    // Hub point pulsing glow (subtle, ominous breathing)
    for (let i = 0; i < hubPos.length; i++) {
      const hub = data.hubs[i];
      if (!hub) continue;
      // Gentle pulse: each hub has offset phase for organic feel
      const phase = now * 0.0008 + i * 1.57; // ~0.8 sec period, π/2 offset between hubs
      const pulse = 0.4 + 0.15 * Math.sin(phase); // subtle 0.25-0.55 range
      const size = 8 + 3 * Math.sin(phase * 0.7); // gentle size breathing
      
      gl.useProgram(progCyst);
      set2(progCyst,'uScale', fit.scale, fit.scale);
      set2(progCyst,'uOffset', fit.offX, fit.offY);
      set2(progCyst,'uShift', shift[0], shift[1]);
      set2(progCyst,'uRes', fit.cssW, fit.cssH);
      gl.uniform1f(gl.getUniformLocation(progCyst,'uTime'), now*0.001);
      gl.uniform1f(gl.getUniformLocation(progCyst,'uDpr'), currentDPR());
      // Dim ember colors for subtle glow
      set3(progCyst,'uGlow1', [PAL.EMBER1[0]*pulse, PAL.EMBER1[1]*pulse, PAL.EMBER1[2]*pulse]);
      set3(progCyst,'uGlow2', [PAL.EMBER2[0]*pulse, PAL.EMBER2[1]*pulse, PAL.EMBER2[2]*pulse]);
      set3(progCyst,'uGlow3', [PAL.EMBER3[0]*pulse, PAL.EMBER3[1]*pulse, PAL.EMBER3[2]*pulse]);
      set3(progCyst,'uBranch1', PAL.BRANCH1);
      
      vaoCyst.data.set([hub.x, hub.y, size, i * 0.5], 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, vaoCyst.buf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, vaoCyst.data.subarray(0,4));
      gl.bindVertexArray(vaoCyst.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, 1);
      gl.bindVertexArray(null);
    }

    // Hover halo (breathing ember) — brighter overdraw when hovered
    if(hoveredHubId){
      const hub = data.hubs.find(h=>h.id===hoveredHubId);
      if(hub){
        gl.useProgram(progCyst);
        set2(progCyst,'uScale', fit.scale, fit.scale);
        set2(progCyst,'uOffset', fit.offX, fit.offY);
        set2(progCyst,'uShift', shift[0], shift[1]);
        gl.uniform1f(gl.getUniformLocation(progCyst,'uTime'), now*0.001);
        gl.uniform1f(gl.getUniformLocation(progCyst,'uDpr'), currentDPR());
        // Petri dish clipping handled by updateDishUniforms() (already set)
        set3(progCyst,'uGlow1', PAL.EMBER1);
        set3(progCyst,'uGlow2', PAL.EMBER2);
        set3(progCyst,'uGlow3', PAL.EMBER3);
        set3(progCyst,'uBranch1', PAL.BRANCH1);
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

    if (running) {
      requestAnimationFrame(loop);
    }
  }
  
  initialized = true;
  
  // Pause/resume when blog section visibility changes
  let running = false;
  let rafId = null;
  const blogStage = document.querySelector('.blog-screen');
  if (blogStage) {
    const obs = new MutationObserver(() => {
      const isActive = blogStage.classList.contains('active-section');
      running = isActive;
      if (isActive && !rafId) {
        rafId = requestAnimationFrame(loop);
      } else if (!isActive) {
        rafId = null;
      }
    });
    obs.observe(blogStage, { attributes: true, attributeFilter: ['class'] });
    
    // Initial check
    running = blogStage.classList.contains('active-section');
  }
  
  // Start animation loop
  animationActive = true;
  if (running) {
    rafId = requestAnimationFrame(loop);
  }
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
