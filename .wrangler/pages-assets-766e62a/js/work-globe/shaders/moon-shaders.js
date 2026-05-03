export const MOON_VERTEX_SHADER = `#version 300 es
precision highp float;

in vec3 position;
in vec3 normal;
in vec2 uv;

out vec3 vNormal;
out vec3 vPosition;
out vec3 vWorldNormal;
out vec3 vWorldPos;
out vec3 vViewDir;
out vec3 vLocalPos;
out vec2 vUV;

uniform mat4 uProjection;
uniform mat4 uView;
uniform mat4 uModel;
uniform vec3 uCameraPos;
uniform float uTime;
uniform float uBreathIntensity;

// Noise for rocky displacement
float hash(vec3 p) {
  return fract(sin(dot(p, vec3(12.9898, 78.233, 45.5432))) * 43758.5453);
}

float noise3D(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  
  float n000 = hash(i);
  float n100 = hash(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash(i + vec3(1.0, 1.0, 1.0));
  
  float x00 = mix(n000, n100, f.x);
  float x10 = mix(n010, n110, f.x);
  float x01 = mix(n001, n101, f.x);
  float x11 = mix(n011, n111, f.x);
  
  float y0 = mix(x00, x10, f.y);
  float y1 = mix(x01, x11, f.y);
  
  return mix(y0, y1, f.z);
}

void main() {
  vLocalPos = position;
  vUV = uv;
  
  // Rocky surface displacement (craters and bumps)
  float rockDetail = noise3D(position * 8.0) * 0.5 + 0.5;
  float craters = noise3D(position * 3.0);
  craters = pow(max(0.0, craters), 2.0); // Sharp crater edges
  
  // Combine for rough surface
  float displacement = rockDetail * 0.03 - craters * 0.05;
  vec3 displacedPos = position + normal * displacement;
  
  // Transform to world space
  vNormal = mat3(uModel) * normalize(normal + vec3(rockDetail - 0.5) * 0.1);
  vWorldNormal = normalize(vNormal);
  
  vec4 worldPos = uModel * vec4(displacedPos, 1.0);
  vWorldPos = worldPos.xyz;
  vPosition = worldPos.xyz;
  
  vViewDir = normalize(uCameraPos - vPosition);
  
  gl_Position = uProjection * uView * worldPos;
}
`;

export const MOON_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec3 vNormal;
in vec3 vPosition;
in vec3 vWorldNormal;
in vec3 vWorldPos;
in vec3 vViewDir;
in vec3 vLocalPos;
in vec2 vUV;

out vec4 fragColor;

uniform vec3 uMoonColor;
uniform vec3 uRimColor;
uniform float uTime;
uniform float uGlowIntensity;
uniform float uPulseSpeed;
uniform float uHoverAmount;
uniform float uEyeDilation;
uniform float uShimmerPhase;

// Dark rocky moon color palette
const vec3 COLOR_ROCK_BASE = vec3(0.10, 0.06, 0.12);       // Dark purple
const vec3 COLOR_ROCK_DETAIL = vec3(0.14, 0.08, 0.16);     // Slightly lighter purple
const vec3 COLOR_ROCK_DARK = vec3(0.06, 0.04, 0.08);       // Deep purple shadows
const vec3 COLOR_MYCELIUM = vec3(0.1, 0.3, 0.15);          // Ominous dark green
const vec3 COLOR_MYCELIUM_BRIGHT = vec3(0.2, 0.6, 0.3);    // Brighter green glow

// === NOISE FUNCTIONS ===
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float hash3D(vec3 p) {
  return fract(sin(dot(p, vec3(12.9898, 78.233, 45.5432))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float noise3D(vec3 p) {
  return hash3D(p);
}

// === ROCKY MOON EFFECTS ===

// Rock texture (smooth with subtle variation)
vec3 getRockTexture(vec3 pos, vec3 normal) {
  // Larger scale variation - smoother surface
  float rockLarge = noise3D(pos * 2.0);
  float rockMedium = noise3D(pos * 4.0);
  
  // Much smoother - reduce high-frequency noise
  float rockDetail = rockLarge * 0.6 + rockMedium * 0.4;
  
  // Subtle crater patterns
  float craters = pow(max(0.0, noise3D(pos * 3.0)), 4.0); // Higher power = softer edges
  
  // Build color with smooth variation
  vec3 rockColor = mix(COLOR_ROCK_DARK, COLOR_ROCK_BASE, rockDetail);
  rockColor = mix(rockColor, COLOR_ROCK_DETAIL, rockMedium * 0.3);
  
  // Very subtle crater darkening
  rockColor = mix(rockColor, COLOR_ROCK_DARK, craters * 0.4);
  
  return rockColor;
}

// Mycelium veins on moon surface
vec3 getMyceliumVeins(vec3 pos, float time) {
  // Organic vein network crawling on surface
  float veinPattern1 = noise3D(pos * 6.0 + vec3(0.0, time * 0.05, 0.0));
  float veinPattern2 = noise3D(pos * 10.0 - vec3(time * 0.03, 0.0, 0.0));
  
  // Combine patterns for branching veins
  float veins = max(
    smoothstep(0.55, 0.6, veinPattern1),
    smoothstep(0.6, 0.65, veinPattern2)
  );
  
  // Pulsing glow through mycelium
  float pulse = sin(time * 1.5 + veinPattern1 * 6.28) * 0.3 + 0.7;
  
  // Glowing mycelium color
  vec3 myceliumColor = mix(COLOR_MYCELIUM, COLOR_MYCELIUM_BRIGHT, pulse);
  
  return myceliumColor * veins;
}

// Connection point glow (where mycelium connects to moon)
float getConnectionGlow(vec3 localPos) {
  // Glow on the side facing the globe (negative Z)
  float connectionSide = smoothstep(0.0, -0.5, localPos.z);
  
  // Concentrated at the "attachment point"
  vec2 connectionUV = localPos.xy;
  float distFromConnection = length(connectionUV);
  float connectionGlow = smoothstep(0.4, 0.1, distFromConnection) * connectionSide;
  
  return connectionGlow;
}

// === MAIN SHADER ===
void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(vViewDir);
  
  // Use uMoonColor uniform passed from JavaScript!
  vec3 rockColor = uMoonColor;
  
  // === ROCKY SURFACE ===
  vec3 rockTexture = getRockTexture(vLocalPos, N);
  // Tint rock texture with moon color
  rockTexture = mix(rockTexture, rockColor, 0.7);
  
  // === MYCELIUM VEINS ===
  vec3 mycelium = getMyceliumVeins(vLocalPos, uTime);
  
  // === CONNECTION GLOW ===
  float connectionGlow = getConnectionGlow(vLocalPos);
  vec3 connectionColor = COLOR_MYCELIUM_BRIGHT * connectionGlow;
  
  // === COMBINE SURFACE ===
  vec3 baseColor = rockTexture;
  baseColor += mycelium;        // Add glowing mycelium veins
  baseColor += connectionColor; // Glow where it connects to globe
  
  // === LIGHTING ===
  vec3 lightDir = normalize(vec3(0.5, 0.3, 0.5));
  float diffuse = max(dot(N, lightDir), 0.0) * 0.4;
  float ambient = 0.2; // Dark ambient for moon
  
  vec3 finalColor = baseColor * (ambient + diffuse);
  
  // === SUBTLE RIM LIGHT (atmosphere catch) ===
  float rimPower = 3.0;
  float rim = pow(1.0 - max(dot(N, V), 0.0), rimPower);
  vec3 rimLight = COLOR_MYCELIUM * rim * 0.3; // Slight green rim
  finalColor += rimLight;
  
  // === HOVER EFFECT (mycelium glows brighter) ===
  finalColor += mycelium * uHoverAmount * 0.5;
  finalColor += connectionColor * uHoverAmount * 0.3;
  
  // === FULLY OPAQUE (solid rocky moon) ===
  float finalAlpha = 1.0;
  
  fragColor = vec4(finalColor, finalAlpha);
}
`;
