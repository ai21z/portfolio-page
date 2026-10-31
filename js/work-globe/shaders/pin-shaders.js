export const PIN_VERTEX_SHADER = `#version 300 es
precision highp float;

layout(location = 0) in vec3 position;       // the marker's corner, x east and z south, -1 to 1
layout(location = 1) in vec3 normal;
layout(location = 2) in vec3 instancePos;    // the place on the globe
layout(location = 3) in vec3 instanceColor;  // the legend's place colour
layout(location = 4) in float instanceHeight;
layout(location = 5) in float instancePhase;
layout(location = 6) in float instanceScale;  // hover scale

out vec2 vCorner;
out vec3 vColor;
out float vScale;

uniform mat4 uProjection;
uniform mat4 uView;
uniform mat4 uModel;
uniform float uTime;

// Half the marker's side and its lift off the surface, in globe radii.
const float MARKER_SIZE = 0.05;
const float MARKER_LIFT = 0.006;

void main() {
  vColor = instanceColor;
  vScale = instanceScale;
  vCorner = vec2(position.x, -position.z);

  // The marker lies flat on the globe at its place, its triangle pointing north.
  vec3 upVector = normalize(instancePos);
  vec3 tangent = normalize(cross(upVector, vec3(0.0, 1.0, 0.0)));
  vec3 bitangent = cross(upVector, tangent);
  mat3 orientation = mat3(tangent, upVector, bitangent);

  vec3 localPos = vec3(position.x, 0.0, position.z) * MARKER_SIZE * instanceScale;
  localPos.y = MARKER_LIFT;
  vec3 worldPos = instancePos + orientation * localPos;

  gl_Position = uProjection * uView * uModel * vec4(worldPos, 1.0);
}
`;

// The legend's place mark stamped on the map: a filled triangle with a dark ink edge, cut by its
// screen derivative so it stays one crisp shape at any size, and a fine bone ring round the chosen place.
export const PIN_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vCorner;
in vec3 vColor;
in float vScale;

out vec4 fragColor;

uniform float uTime;
uniform vec3 uCameraPos;

const vec3 INK_COLOR = vec3(0.030, 0.042, 0.042);   // the globe's abyss
const vec3 LIT_COLOR = vec3(0.247, 1.0, 0.624);     // the timeline's chosen place, #3fff9f
const vec3 RING_COLOR = vec3(0.79, 0.76, 0.70);     // bone
const float TRIANGLE = 0.40;  // half the triangle's side, in marker units
const float RING = 0.80;      // the chosen place's ring radius, in marker units

// Signed distance to an equilateral triangle of half side r, centred, pointing up (Inigo Quilez).
float sdTriangle(vec2 p, float r) {
  const float k = sqrt(3.0);
  p.x = abs(p.x) - r;
  p.y = p.y + r / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
  p.x -= clamp(p.x, -2.0 * r, 0.0);
  return -length(p) * sign(p.y);
}

void main() {
  // The hovered or chosen place grows to 1.3, past the 1.2 a compact layout pulses to.
  float chosen = smoothstep(1.22, 1.3, vScale);
  float d = sdTriangle(vCorner, TRIANGLE);
  float px = max(fwidth(d), 1e-4);

  float fill = 1.0 - smoothstep(-0.5, 0.5, d / px);
  float ink = 1.0 - smoothstep(1.2, 2.0, d / px);
  float ring = (1.0 - smoothstep(0.4, 1.0, abs(length(vCorner) - RING) / px)) * chosen;

  vec3 color = mix(INK_COLOR, mix(vColor, LIT_COLOR, chosen), fill);
  color = mix(color, RING_COLOR, ring * (1.0 - ink));
  float alpha = max(ink, ring * 0.85);
  if (alpha < 0.01) discard;
  fragColor = vec4(color, alpha);
}
`;
