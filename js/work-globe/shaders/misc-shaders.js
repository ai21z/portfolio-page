export const DATA_STREAM_VERTEX_SHADER = `#version 300 es
precision highp float;

layout(location = 0) in vec3 position;
layout(location = 1) in float life;
layout(location = 2) in float phase;

out float vLife;
out float vPhase;

uniform mat4 uProjection;
uniform mat4 uView;
uniform mat4 uModel;
uniform float uTime;

void main() {
  vLife = life;
  vPhase = phase;
  
  vec4 viewPos = uView * uModel * vec4(position, 1.0);
  
  // Pulsing size
  float pulse = sin(uTime * 4.0 + phase * 6.28) * 0.3 + 0.7;
  gl_PointSize = (2.0 + pulse) * life;
  
  gl_Position = uProjection * viewPos;
}
`;

export const DATA_STREAM_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in float vLife;
in float vPhase;

out vec4 fragColor;

uniform vec3 uStreamColor;

void main() {
  vec2 coord = gl_PointCoord - vec2(0.5);
  float dist = length(coord);
  
  if (dist > 0.5) discard;
  
  float alpha = smoothstep(0.5, 0.0, dist) * vLife;
  fragColor = vec4(uStreamColor, alpha);
}
`;

export const TEXT_BILLBOARD_VERTEX_SHADER = `#version 300 es
precision highp float;

in vec2 aPosition;
in vec2 aUv;

out vec2 vUv;

uniform mat4 uProjection;
uniform mat4 uView;
uniform vec3 uWorldPos;
uniform vec2 uSize;
uniform float uHoverProgress;

void main() {
  vUv = aUv;
  
  // Extract camera right and up vectors from view matrix
  vec3 right = vec3(uView[0][0], uView[1][0], uView[2][0]);
  vec3 up = vec3(uView[0][1], uView[1][1], uView[2][1]);
  
  // Offset above pin with hover animation
  vec3 worldPos = uWorldPos + vec3(0.0, 0.2 + uHoverProgress * 0.1, 0.0);
  
  // Billboard calculation
  vec3 billboardPos = worldPos + 
    right * aPosition.x * uSize.x * 0.5 + 
    up * aPosition.y * uSize.y * 0.5;
  
  gl_Position = uProjection * uView * vec4(billboardPos, 1.0);
}
`;

export const TEXT_BILLBOARD_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uTextTexture;
uniform float uAlpha;

void main() {
  vec4 texColor = texture(uTextTexture, vUv);
  // Simple pass-through with alpha multiplication
  fragColor = vec4(texColor.rgb, texColor.a * uAlpha);
}
`;
