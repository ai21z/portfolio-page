export const LIGHTNING_VERTEX_SHADER = `#version 300 es
precision highp float;

in vec3 position;
in vec3 normal;
in vec2 uv;

out vec2 vUv;

uniform mat4 uProjection;
uniform mat4 uView;
uniform mat4 uModel;

void main() {
  vUv = uv;
  gl_Position = uProjection * uView * uModel * vec4(position, 1.0);
}
`;

export const LIGHTNING_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uLightningTex;
uniform vec3 uLightningColor;
uniform float uLightningGain;
uniform vec2 uLightningScroll;
uniform float uTime;
uniform float uFlickerFreq;
uniform float uFlickerDuty;

// Simple hash for pseudo-random flicker
float hash(float t) {
  return fract(sin(t * 127.1) * 43758.5453);
}

void main() {
  // Sample lightning mask with scroll + seam guard
  vec2 scrollUv = fract(vUv + uLightningScroll * uTime); // fract() prevents seam
  float mask = texture(uLightningTex, scrollUv).r;
  
  // Create flicker: base slow pulse + sharp strobe
  float slowPulse = hash(floor(uTime * uFlickerFreq * 0.3)) * 0.5 + 0.5;
  float strobePhase = fract(uTime * uFlickerFreq);
  float strobe = step(strobePhase, uFlickerDuty) * 2.0;
  
  // Combine with jitter
  float jitter = hash(uTime * 10.0) * 0.3 + 0.7;
  float pulse = slowPulse * (0.3 + strobe * 0.7) * jitter;
  
  // Emissive output (additive)
  vec3 emissive = uLightningColor * mask * pulse * uLightningGain;
  fragColor = vec4(emissive, 1.0);
}
`;
