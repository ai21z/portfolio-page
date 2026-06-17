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

// Ocean/land palette, shared by the daymap and procedural branches below.
const vec3 OCEAN_COLOR = vec3(0.08, 0.12, 0.13);  // Subtle dark teal
const vec3 LAND_COLOR = vec3(0.55, 0.75, 0.60);   // Keep land brighter

void main() {
  vec3 baseColor;
  
  if (uUseDaymap) {
    // Sample Earth albedo texture
    vec3 sampledColor = texture(uDaymap, vUv).rgb;
    
    // SIMPLIFIED: No linearization - texture is already sRGB, work directly
    // Most Earth textures are pre-processed for display
    
    // Subtle palette shift (much lighter touch)
    float luminance = dot(sampledColor, vec3(0.299, 0.587, 0.114));
    float landness = smoothstep(0.15, 0.40, luminance);
    
    // Very subtle remap (10% strength - mostly shows original texture)
    vec3 targetColor = mix(OCEAN_COLOR, LAND_COLOR, landness);
    baseColor = mix(sampledColor, targetColor, 0.10);
    
  } else {
    // Fallback: procedural land/ocean
    float v = sin(vUv.x * 12.0 + sin(vUv.y * 8.0)) * 
              sin(vUv.y * 10.0 + sin(vUv.x * 6.0));
    float land = step(0.2, v);
    baseColor = mix(OCEAN_COLOR, LAND_COLOR, land);
  }
  
  // Lambert lighting: balanced ambient + diffuse
  // NOTE: this lightDir is duplicated in moon-shaders.js — keep the two in sync.
  vec3 lightDir = normalize(vec3(0.5, 0.3, 0.5));
  float diffuse = max(dot(normalize(vNormal), lightDir), 0.0);
  float ambient = 0.15;  // brighter overall
  float lighting = ambient + diffuse * 0.65;
  
  // Apply lighting
  vec3 color = baseColor * lighting;
  
  // Micro-grain: very subtle
  float grain = sin(vUv.x * 20.0 + uTime * 0.5) * 
                sin(vUv.y * 15.0 + uTime * 0.3);
  color += vec3(grain) * 0.02;
  
  // Slight emissive glow
  color += vec3(0.05, 0.08, 0.06) * 0.10;
  
  // NO gamma correction - texture is already in correct space
  // If it looks too dark/bright, adjust lighting instead
  
  fragColor = vec4(color, 1.0);
}
`;
