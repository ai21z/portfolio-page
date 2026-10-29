export const GLOBE_VERTEX_SHADER = `#version 300 es
precision highp float;

in vec3 position;
in vec3 normal;
in vec2 uv;

out vec3 vNormal;
out vec3 vPosition;
out vec2 vUv;

uniform mat4 uProjection;
uniform mat4 uView;
uniform mat4 uModel;

void main() {
  vNormal = mat3(uModel) * normal;
  vPosition = (uModel * vec4(position, 1.0)).xyz;
  vUv = uv;
  gl_Position = uProjection * uView * uModel * vec4(position, 1.0);
}
`;

export const GLOBE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec3 vNormal;
in vec3 vPosition;
in vec2 vUv;

out vec4 fragColor;

uniform float uTime;
uniform sampler2D uDaymap;
uniform bool uUseDaymap;

// The dish's language on a globe: abyss ocean, moss land, a bone coastline drawn as a line, engraved
// hatching where the land turns from the light, a faint graticule like the dish's rim marks, and a teal
// rim light. Shared by the daymap and procedural branches below.
const vec3 OCEAN_COLOR = vec3(0.030, 0.042, 0.042);  // abyss, near the dish's agar
const vec3 LAND_COLOR = vec3(0.26, 0.36, 0.31);      // moss, the dish's fine mesh
const vec3 COAST_COLOR = vec3(0.72, 0.80, 0.72);     // bone moss, the dish's trunks
const vec3 RIM_COLOR = vec3(0.29, 0.60, 0.54);       // the atmosphere's teal
// The daymap is a dark map: its ocean reads 0.06 to 0.07 luminance and its land 0.12 to 0.19, so the
// land step sits between the two. At 0.15 to 0.40 most land read as ocean.
const float LAND_LUMA_LO = 0.08;
const float LAND_LUMA_HI = 0.13;
// How far the daymap is pulled toward the palette. A plain mix, never a lighten blend, which
// collapses over near-black on P3 displays.
const float PALETTE_STRENGTH = 0.80;

// A line of width w (in periods) at every whole value of f, antialiased by its screen derivative.
float lines(float f, float w) {
  float d = abs(fract(f) - 0.5);
  float aa = fwidth(f) * 1.2 + 1e-4;
  return smoothstep(0.5 - w - aa, 0.5 - w, d);
}

void main() {
  vec3 baseColor;
  float landness;

  if (uUseDaymap) {
    vec3 sampledColor = texture(uDaymap, vUv).rgb;
    // The land mask reads a softer mip, so the coast is one clean line and not the map's speckle.
    float luminance = dot(texture(uDaymap, vUv, 1.5).rgb, vec3(0.299, 0.587, 0.114));
    landness = smoothstep(LAND_LUMA_LO, LAND_LUMA_HI, luminance);
    vec3 targetColor = mix(OCEAN_COLOR, LAND_COLOR, landness);
    baseColor = mix(sampledColor, targetColor, PALETTE_STRENGTH);
  } else {
    // Fallback: procedural land/ocean
    float v = sin(vUv.x * 12.0 + sin(vUv.y * 8.0)) *
              sin(vUv.y * 10.0 + sin(vUv.x * 6.0));
    landness = smoothstep(0.15, 0.25, v);
    baseColor = mix(OCEAN_COLOR, LAND_COLOR, landness);
  }

  // Lambert lighting. Keep this lightDir aligned with moon-shaders.js.
  vec3 n = normalize(vNormal);
  vec3 lightDir = normalize(vec3(0.5, 0.3, 0.5));
  float diffuse = max(dot(n, lightDir), 0.0);
  float lighting = 0.16 + diffuse * 0.84;
  vec3 color = baseColor * lighting;

  // Engraved hatching on the land, denser as it turns from the light.
  float shade = landness * (1.0 - smoothstep(0.1, 0.75, diffuse));
  float hatch = 1.0 - lines(vUv.y * 220.0 + vUv.x * 18.0, 0.36);
  color *= 1.0 - 0.45 * hatch * shade;

  // The coastline, the iso-line where land meets sea, drawn as a bone line, brighter in the light.
  float coast = 1.0 - smoothstep(0.0, fwidth(landness) * 1.4 + 1e-4, abs(landness - 0.5));
  color = mix(color, COAST_COLOR * (0.35 + 0.65 * lighting), coast * 0.85);

  // A faint graticule every 15 degrees, an instrument's marks.
  float grid = max(1.0 - lines(vUv.x * 24.0, 0.48), 1.0 - lines(vUv.y * 12.0, 0.48));
  color += vec3(0.20, 0.30, 0.26) * grid * 0.22 * (0.4 + 0.6 * lighting);

  // Teal rim light where the sphere turns away from the viewer.
  float fres = pow(1.0 - max(dot(n, vec3(0.0, 0.0, 1.0)), 0.0), 3.0);
  color += RIM_COLOR * fres * 0.38;

  fragColor = vec4(color, 1.0);
}
`;
