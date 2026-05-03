export const MYCELIUM_VERTEX_SHADER = `#version 300 es
precision highp float;

layout(location = 0) in vec3 position;
layout(location = 1) in vec3 normal;
layout(location = 2) in vec2 uv;
layout(location = 3) in float age;

out vec3 vNormal;
out vec3 vPosition;
out vec2 vUv;
out float vAge;
out float vDepth;

uniform mat4 uProjection;
uniform mat4 uView;
uniform mat4 uModel;
uniform float uTime;
uniform float uGrowthTime; // Animated reveal

void main() {
  vNormal = normalize(mat3(uModel) * normal);
  vPosition = (uModel * vec4(position, 1.0)).xyz;
  vUv = uv;
  vAge = age;
  
  vec4 viewPos = uView * uModel * vec4(position, 1.0);
  vDepth = -viewPos.z;
  
  gl_Position = uProjection * viewPos;
}
`;

export const MYCELIUM_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec3 vNormal;
in vec3 vPosition;
in vec2 vUv;
in float vAge;
in float vDepth;

out vec4 fragColor;

uniform float uTime;
uniform vec3 uBodyColor;      // Dark fibrous base
uniform vec3 uCoreColor;      // Subtle core glint
uniform float uCoreGain;      // Core intensity (≤0.18)
uniform float uGrowthTime;    // Growth reveal
uniform float uOpacityNoise;  // Micro-noise modulation

// Simple noise for opacity variation
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  // Growth reveal: fade in based on age
  float reveal = smoothstep(0.0, 50.0, uGrowthTime - vAge);
  if (reveal < 0.01) discard;
  
  // Directional lighting (from upper-right)
  vec3 lightDir = normalize(vec3(0.5, 0.5, 1.0));
  float diffuse = max(dot(vNormal, lightDir), 0.0);
  
  // Ambient occlusion from radial UV
  float ao = 0.6 + 0.4 * (1.0 - abs(vUv.x * 2.0 - 1.0));
  
  // Body color: dark fibrous mass
  vec3 bodyLit = uBodyColor * (0.3 + diffuse * 0.5) * ao;
  
  // Core glint: only at centerline (vUv.x near 0.5 or 0.0/1.0 for wrapped)
  float coreStrength = 1.0 - abs(vUv.x * 2.0 - 1.0); // Peaks at center
  coreStrength = pow(coreStrength, 4.0); // Narrow core
  vec3 coreGlint = uCoreColor * coreStrength * uCoreGain;
  
  // Micro-noise opacity modulation (2-3%)
  float opacityNoise = hash(vPosition.xy * 100.0) * uOpacityNoise;
  float baseAlpha = 0.70 + opacityNoise;
  
  // Depth fade
  float depthFade = smoothstep(800.0, 300.0, vDepth);
  
  // Final: body (alpha) + core (will be additive in separate pass)
  vec3 finalColor = bodyLit;
  float alpha = baseAlpha * depthFade * reveal;
  
  fragColor = vec4(finalColor, alpha);
}
`;

export const MYCELIUM_CORE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec3 vNormal;
in vec3 vPosition;
in vec2 vUv;
in float vAge;
in float vDepth;

out vec4 fragColor;

uniform float uTime;
uniform vec3 uCoreColor;
uniform float uCoreGain;
uniform float uGrowthTime;

void main() {
  // Growth reveal
  float reveal = smoothstep(0.0, 50.0, uGrowthTime - vAge);
  if (reveal < 0.01) discard;
  
  // Core only at centerline
  float coreStrength = 1.0 - abs(vUv.x * 2.0 - 1.0);
  coreStrength = pow(coreStrength, 6.0); // Very narrow line
  
  // Pulse at tips (high age)
  float tipPulse = smoothstep(100.0, 150.0, vAge) * (sin(uTime * 2.0) * 0.3 + 0.7);
  
  vec3 emissive = uCoreColor * coreStrength * uCoreGain * (0.5 + tipPulse * 0.5);
  
  fragColor = vec4(emissive, 1.0);
}
`;
