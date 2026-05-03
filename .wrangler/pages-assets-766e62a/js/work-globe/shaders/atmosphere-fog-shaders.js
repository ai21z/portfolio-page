export const ATMOSPHERE_VERTEX_SHADER = `#version 300 es
precision highp float;

in vec3 position;
in vec3 normal;

out vec3 vNormal;

uniform mat4 uProjection;
uniform mat4 uView;
uniform mat4 uModel;

void main() {
  vNormal = normalize(mat3(uModel) * normal);
  gl_Position = uProjection * uView * uModel * vec4(position * 1.04, 1.0);
}
`;

export const ATMOSPHERE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec3 vNormal;
out vec4 fragColor;

void main() {
  // Rim lighting effect
  float intensity = pow(0.5 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.5);
  vec3 glowColor = vec3(0.29, 0.60, 0.54); // Soft teal
  fragColor = vec4(glowColor, intensity * 0.4);
}
`;

export const FOG_VERTEX_SHADER = `#version 300 es
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

export const FOG_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uFogTex;
uniform vec3 uFogTint;
uniform float uFogStrength;
uniform vec2 uFogScroll;
uniform float uTime;

void main() {
  // Sample fog with slow scroll + seam guard
  vec2 scrollUv = fract(vUv + uFogScroll * uTime); // fract() prevents seam artifacts
  float fogAlpha = texture(uFogTex, scrollUv).a;
  
  // Clamp to prevent hiding continents (max 60% coverage)
  fogAlpha = min(fogAlpha * uFogStrength, 0.6);
  
  // Output tinted fog
  vec3 fogColor = uFogTint * fogAlpha;
  fragColor = vec4(fogColor, fogAlpha);
}
`;
