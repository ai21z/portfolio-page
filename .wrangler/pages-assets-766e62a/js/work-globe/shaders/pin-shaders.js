export const PIN_VERTEX_SHADER = `#version 300 es
precision highp float;

layout(location = 0) in vec3 position;
layout(location = 1) in vec3 normal;
layout(location = 2) in vec3 instancePos;    // Pin base position
layout(location = 3) in vec3 instanceColor;  // Pin color
layout(location = 4) in float instanceHeight; // Animated height
layout(location = 5) in float instancePhase;  // Pulse phase
layout(location = 6) in float instanceScale;  // Hover scale

out vec3 vNormal;
out vec3 vWorldPos;
out vec3 vColor;
out float vHeight;
out float vPhase;
out float vScale;

uniform mat4 uProjection;
uniform mat4 uView;
uniform mat4 uModel;
uniform float uTime;

void main() {
  vColor = instanceColor;
  vHeight = instanceHeight;
  vPhase = instancePhase;
  vScale = instanceScale;
  
  // Calculate orientation vector (pin points outward from globe center)
  vec3 upVector = normalize(instancePos);
  vec3 tangent = normalize(cross(upVector, vec3(0.0, 1.0, 0.0)));
  vec3 bitangent = cross(upVector, tangent);
  
  // Build rotation matrix to orient pin
  mat3 orientation = mat3(tangent, upVector, bitangent);
  
  // Scale and orient geometry
  vec3 localPos = position * instanceScale; // Apply scale
  localPos.y *= instanceHeight; // Stretch along pin axis
  vec3 rotatedPos = orientation * localPos;
  
  // Position at base
  vec3 worldPos = instancePos + rotatedPos;
  
  vNormal = mat3(uModel) * (orientation * normal);
  vWorldPos = (uModel * vec4(worldPos, 1.0)).xyz;
  
  gl_Position = uProjection * uView * uModel * vec4(worldPos, 1.0);
}
`;

export const PIN_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec3 vNormal;
in vec3 vWorldPos;
in vec3 vColor;
in float vHeight;
in float vPhase;
in float vScale;

out vec4 fragColor;

uniform float uTime;
uniform vec3 uCameraPos;

void main() {
  vec3 normal = normalize(vNormal);
  vec3 viewDir = normalize(uCameraPos - vWorldPos);
  
  // IDLE PULSING GLOW - slow, subtle breathing effect
  float idlePulse = sin(uTime * 1.5 + vPhase) * 0.15 + 0.85; // Range: 0.7 - 1.0
  
  // HOVER BOOST - when scaled up, pulse faster and brighter
  float hoverBoost = smoothstep(1.0, 1.4, vScale); // 0 when idle, 1 when fully hovered
  float hoverPulse = sin(uTime * 3.0 + vPhase) * 0.2 + 0.8;
  float finalPulse = mix(idlePulse, hoverPulse, hoverBoost);
  
  // Rim lighting (edges glow more)
  float rim = 1.0 - max(0.0, dot(normal, viewDir));
  rim = pow(rim, 3.0);
  
  // Height-based gradient (brighter at tip)
  float heightGradient = length(vWorldPos) - 1.0; // Distance from globe center
  heightGradient = smoothstep(0.0, vHeight, heightGradient);
  
  // Combine effects
  vec3 baseColor = vColor * 0.4;
  vec3 glowColor = vColor * 2.2;
  vec3 finalColor = mix(baseColor, glowColor, rim * 0.5 + heightGradient * 0.5);
  finalColor *= finalPulse;
  
  // Add core glow (boosted on hover)
  float coreBrightness = heightGradient * rim * (1.0 + hoverBoost * 0.5);
  finalColor += vColor * coreBrightness * finalPulse;
  
  fragColor = vec4(finalColor, 0.8 + rim * 0.2);
}
`;
