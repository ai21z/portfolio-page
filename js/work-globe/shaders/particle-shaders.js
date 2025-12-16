export const PARTICLE_VERTEX_SHADER = `#version 300 es
precision highp float;

// Per-vertex attributes
layout(location = 0) in vec3 position;  // Particle position
layout(location = 1) in vec3 velocity;  // Particle velocity
layout(location = 2) in float life;     // Particle life (0-1)
layout(location = 3) in float size;     // Particle size
layout(location = 4) in float phase;    // Random phase for variation
layout(location = 5) in vec3 color;     // Per-particle color

out float vLife;
out float vPhase;
out float vIsOrbital; // Flag for orbital particles (larger/brighter)
out vec3 vColor; // Pass color to fragment shader

uniform mat4 uProjection;
uniform mat4 uView;
uniform mat4 uModel;
uniform float uTime;

void main() {
  vLife = life;
  vPhase = phase;
  vColor = color;
  
  // Detect orbital particles: they have zero velocity AND larger size
  float velMag = length(velocity);
  vIsOrbital = (velMag < 0.001 && size > 1.0) ? 1.0 : 0.0;
  
  // Cloud particles: no additional gravity (handled in CPU physics)
  vec3 pos = position;
  
  vec4 viewPos = uView * uModel * vec4(pos, 1.0);
  
  // Size-based rendering with special handling for orbital particles
  float baseSize = size < 0.2 ? 2.0 : 4.0; // Tiny particles get smaller base
  float pulseMult = size < 0.2 ? 0.5 : 2.0; // Less pulse on tiny particles
  
  // Orbital particles: MUCH MUCH bigger and stronger pulse
  if (vIsOrbital > 0.5) {
    baseSize = 40.0; // Massive base size
    pulseMult = 10.0; // Very strong pulse
  }
  
  float pulse = sin(uTime * 3.0 + phase * 6.28) * 0.3 + 0.7;
  gl_PointSize = size * (baseSize + pulseMult * pulse) * life * life;
  
  gl_Position = uProjection * viewPos;
}
`;

export const PARTICLE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in float vLife;
in float vPhase;
in float vIsOrbital; // Flag for orbital particles
in vec3 vColor; // Per-particle color

out vec4 fragColor;

uniform float uTime;
uniform vec3 uSporeColor;    // Decay-green color (fallback)
uniform vec3 uEmberColor;    // Bright ember color for core

void main() {
  // Distance from center of point sprite
  vec2 coord = gl_PointCoord - vec2(0.5);
  float dist = length(coord);
  
  // Soft circular falloff
  if (dist > 0.5) discard;
  
  float alpha = smoothstep(0.5, 0.0, dist) * vLife;
  
  // Pulsing glow - stronger for orbital particles
  float pulseSpeed = vIsOrbital > 0.5 ? 6.0 : 4.0;
  float pulseAmount = vIsOrbital > 0.5 ? 0.5 : 0.3;
  float pulse = sin(uTime * pulseSpeed + vPhase * 6.28) * pulseAmount + (1.0 - pulseAmount);
  
  // Use per-particle color if available (non-zero), otherwise use uniform color
  vec3 baseColor = length(vColor) > 0.01 ? vColor : uSporeColor;
  
  // Orbital particles: much brighter with stronger core
  vec3 edgeColor, coreColor;
  float brightness;
  
  if (vIsOrbital > 0.5) {
    // Orbital particles: brighter, more ember-like, using particle color
    brightness = 2.5; // Much brighter
    edgeColor = mix(baseColor, uEmberColor, 0.4) * brightness;
    coreColor = mix(baseColor, uEmberColor, 0.7) * brightness; // More color in core
  } else {
    // Regular spores: normal brightness
    brightness = 1.0;
    edgeColor = baseColor * 0.6;
    coreColor = mix(baseColor, uEmberColor, 0.3);
  }
  
  vec3 color = mix(edgeColor, coreColor, 1.0 - dist * 2.0);
  
  // Additive blending will be enabled
  fragColor = vec4(color * pulse, alpha);
}
`;
