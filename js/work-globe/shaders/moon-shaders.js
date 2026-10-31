export const MOON_VERTEX_SHADER = `#version 300 es
precision highp float;

in vec3 position;
in vec3 normal;
in vec4 edge;   // per side, 0 on a true edge of the face (moon-solids.js)
in vec3 tint;

out vec3 vObjPos;
out vec3 vObjNormal;
out vec3 vWorldNormal;
out vec3 vViewDir;
out vec4 vEdge;
out vec3 vTint;

uniform mat4 uProjection;
uniform mat4 uView;
uniform mat4 uModel;
uniform vec3 uCameraPos;

void main() {
  vObjPos = position;
  vObjNormal = normal;
  vWorldNormal = mat3(uModel) * normal;
  vec4 worldPos = uModel * vec4(position, 1.0);
  vViewDir = uCameraPos - worldPos.xyz;
  vEdge = edge;
  vTint = tint;
  gl_Position = uProjection * uView * worldPos;
}
`;

// The projects' moons as engraved solids under the globe's light: each face flat, clear where it is lit,
// cut with lines that thicken into its shadow and cross in the deepest of it, and its true edges inked.
// The lines run across each face in the object's own space, so they stay on it as it turns, and give way
// to their average tone where they would fall closer than a few pixels.
export const MOON_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec3 vObjPos;
in vec3 vObjNormal;
in vec3 vWorldNormal;
in vec3 vViewDir;
in vec4 vEdge;
in vec3 vTint;

out vec4 fragColor;

uniform vec3 uMoonColor;
uniform float uHoverAmount;

const vec3 INK_COLOR = vec3(0.030, 0.042, 0.042);  // the globe's abyss
const vec3 BONE_COLOR = vec3(0.79, 0.76, 0.70);
const vec3 RIM_COLOR = vec3(0.29, 0.60, 0.54);     // the globe's teal rim
const float HATCH = 9.0;  // engraved lines per model unit

// A line of half width w (in periods) at every whole value of f, antialiased by its screen derivative.
float lines(float f, float w) {
  float d = abs(fract(f) - 0.5);
  float aa = fwidth(f) * 1.2 + 1e-4;
  return smoothstep(0.5 - w - aa, 0.5 - w, d) * step(0.01, w);
}

void main() {
  // Keep this light aligned with globe-shaders.js.
  vec3 n = normalize(vWorldNormal);
  vec3 lightDir = normalize(vec3(0.5, 0.3, 0.5));
  vec3 viewDir = normalize(vViewDir);
  float diffuse = max(dot(n, lightDir), 0.0);
  vec3 color = uMoonColor * vTint * (0.34 + 0.66 * diffuse + 0.08 * uHoverAmount);
  color += BONE_COLOR * pow(max(dot(reflect(-lightDir, n), viewDir), 0.0), 18.0) * 0.35;

  // Lines across the face, thicker as it turns from the light, crossed in its deepest shade.
  float shade = 1.0 - smoothstep(0.15, 0.75, diffuse);
  vec3 faceNormal = normalize(vObjNormal);
  // The lines run at 60 degrees, so on the helmet they cross its bars instead of doubling them.
  vec3 slant = vec3(0.5, 0.866, 0.0);
  vec3 across = normalize(cross(faceNormal, abs(dot(faceNormal, slant)) < 0.9 ? slant : vec3(1.0, 0.0, 0.0)));
  float f = dot(vObjPos, across) * HATCH;
  float g = dot(vObjPos, cross(faceNormal, across)) * HATCH;
  float w = 0.24 * shade;
  float w2 = 0.10 * smoothstep(0.75, 1.0, shade);
  // Lines closer than about four pixels give way to their average tone, and the crossing lines wait for
  // six, so a small face never breaks into dots.
  float clear = smoothstep(3.0, 4.5, 1.0 / max(fwidth(f), 1e-4));
  w2 *= smoothstep(5.0, 7.0, 1.0 / max(fwidth(g), 1e-4));
  float ink = mix(min(2.0 * w, 1.0), max(lines(f, w), lines(g, w2)), clear);
  color = mix(color, INK_COLOR, ink * 0.7);

  // The face's true edges, a pixel and a bit wide.
  vec4 e = vEdge / max(fwidth(vEdge), vec4(1e-4));
  float edge = 1.0 - smoothstep(0.5, 1.3, min(min(e.x, e.y), min(e.z, e.w)));
  color = mix(color, INK_COLOR, edge * 0.9);

  // The globe's teal rim where a face turns from the viewer.
  color += RIM_COLOR * pow(1.0 - max(dot(n, viewDir), 0.0), 3.0) * 0.12;

  fragColor = vec4(color, 1.0);
}
`;
