/**
 * Moon Orbit System
 * Manages orbital project spheres around the globe
 * Supports 1-4 projects with independent orbits
 */

import { createSphereGeometry } from '../core/geometry.js';
import { mat4 } from '../core/math-utils.js';

export class MoonOrbitSystem {
  constructor(gl, projects) {
    this.gl = gl;
    this.moons = [];
    
    // Create moon state for each project
    projects.forEach(project => {
      this.moons.push({
        project: project,
        angle: project.initialAngle, // Current angle in degrees
        orbitRadius: project.orbitRadius,
        rotationSpeed: project.rotationSpeed,
        orbitTilt: project.orbitTilt,
        moonRadius: project.moonRadius,
        color: project.color,
        glowIntensity: project.glowIntensity,
        pulseSpeed: project.pulseSpeed,
        paused: false,
        hovered: false,
        scale: 1.0,
        targetScale: 1.0,
        // New moth wing moon interaction state
        breathIntensity: 1.0,
        targetBreathIntensity: 1.0,
        hoverAmount: 0.0,
        targetHoverAmount: 0.0,
        eyeDilation: 0.0,
        targetEyeDilation: 0.0,
        shimmerPhase: -1.0, // -1 to 1 (travels across sphere)
        shimmerActive: false,
        shimmerStartTime: 0
      });
    });
    
    // Create shared moon geometry (sphere)
    const sphereDetail = 24; // 24x24 segments for smooth sphere
    this.geometry = createSphereGeometry(1.0, sphereDetail, sphereDetail);
    this.vertexCount = this.geometry.indices.length;
    
    this.setupBuffers();
  }
  
  setupBuffers() {
    const gl = this.gl;
    
    // Create VAO for moon geometry
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    
    // Position buffer
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.geometry.positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); // position
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    
    // Normal buffer
    const normalBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.geometry.normals, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1); // normal
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    
    // UV buffer
    const uvBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.geometry.uvs, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(2); // uv
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
    
    // Index buffer
    const indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.geometry.indices, gl.STATIC_DRAW);
    
    gl.bindVertexArray(null);
  }
  
  update(dt) {
    const isMobile = window.innerWidth <= 768;

    this.moons.forEach(moon => {
      // Update orbit angle
      moon.angle += moon.rotationSpeed * dt;
      if (moon.angle > 360) moon.angle -= 360;
      
      // Update scale animation (for hover effect)
      let targetScale = moon.targetScale;

      // Heartbeat for mobile (pulsing scale)
      // Only apply if not currently hovered (targetScale is 1.0)
      if (isMobile && Math.abs(moon.targetScale - 1.0) < 0.01) {
         const pulse = Math.sin(Date.now() / 1000 * 3) * 0.5 + 0.5;
         targetScale = 1.0 + pulse * 0.15;
      }

      const scaleDiff = targetScale - moon.scale;
      if (Math.abs(scaleDiff) < 0.001) {
        moon.scale = targetScale;
      } else {
        moon.scale += scaleDiff * 0.12;
      }
      
      // Update moth wing interaction states
      const breathDiff = moon.targetBreathIntensity - moon.breathIntensity;
      if (Math.abs(breathDiff) < 0.001) {
        moon.breathIntensity = moon.targetBreathIntensity;
      } else {
        moon.breathIntensity += breathDiff * 0.08;
      }
      
      const hoverDiff = moon.targetHoverAmount - moon.hoverAmount;
      if (Math.abs(hoverDiff) < 0.001) {
        moon.hoverAmount = moon.targetHoverAmount;
      } else {
        moon.hoverAmount += hoverDiff * 0.15;
      }
      
      const eyeDiff = moon.targetEyeDilation - moon.eyeDilation;
      if (Math.abs(eyeDiff) < 0.001) {
        moon.eyeDilation = moon.targetEyeDilation;
      } else {
        moon.eyeDilation += eyeDiff * 0.12;
      }
      
      // Update shimmer wave (travels from -1 to 1)
      if (moon.shimmerActive) {
        const shimmerDuration = 2.0; // 2 seconds to cross
        const elapsed = (Date.now() - moon.shimmerStartTime) / 1000;
        moon.shimmerPhase = -1.0 + (elapsed / shimmerDuration) * 2.0;
        
        if (moon.shimmerPhase >= 1.0) {
          moon.shimmerActive = false;
          moon.shimmerPhase = -1.0; // Reset off-screen
        }
      }
    });
  }
  
  getWorldPosition(moon) {
    // Convert angle to radians
    const angleRad = moon.angle * Math.PI / 180;
    const tiltRad = moon.orbitTilt * Math.PI / 180;
    
    // Calculate position on tilted circular orbit
    // Orbit in X-Z plane (horizontal from camera view) with Y-axis tilt
    return [
      moon.orbitRadius * Math.cos(angleRad),                    // X: left-right
      moon.orbitRadius * Math.sin(angleRad) * Math.sin(tiltRad), // Y: vertical tilt
      moon.orbitRadius * Math.sin(angleRad) * Math.cos(tiltRad)  // Z: front-back (goes behind!)
    ];
  }
  
  render(program, projMatrix, viewMatrix, modelMatrix, time, cameraPos) {
    if (this.moons.length === 0) return;
    
    const gl = this.gl;
    gl.useProgram(program);
    gl.bindVertexArray(this.vao);
    
    // Set shared uniforms
    const uProjection = gl.getUniformLocation(program, 'uProjection');
    const uView = gl.getUniformLocation(program, 'uView');
    const uTime = gl.getUniformLocation(program, 'uTime');
    const uCameraPos = gl.getUniformLocation(program, 'uCameraPos');
    
    gl.uniformMatrix4fv(uProjection, false, projMatrix);
    gl.uniformMatrix4fv(uView, false, viewMatrix);
    gl.uniform1f(uTime, time);
    gl.uniform3fv(uCameraPos, cameraPos);
    
    // Render each moon
    this.moons.forEach((moon, index) => {
      const worldPos = this.getWorldPosition(moon);
      
      // Create model matrix for this moon
      const scale = moon.moonRadius * moon.scale;
      
      // Rotate the orbital position into world space so rendering matches hit-testing
      const rotatedPos = modelMatrix
        ? mat4.transformPoint(modelMatrix, worldPos)
        : [...worldPos, 1];
      
      const moonModel = new Float32Array([
        scale, 0, 0, 0,
        0, scale, 0, 0,
        0, 0, scale, 0,
        rotatedPos[0], rotatedPos[1], rotatedPos[2], 1
      ]);
      
      // Set per-moon uniforms
      const uModel = gl.getUniformLocation(program, 'uModel');
      const uMoonColor = gl.getUniformLocation(program, 'uMoonColor');
      const uRimColor = gl.getUniformLocation(program, 'uRimColor');
      const uGlowIntensity = gl.getUniformLocation(program, 'uGlowIntensity');
      const uPulseSpeed = gl.getUniformLocation(program, 'uPulseSpeed');
      const uBreathIntensity = gl.getUniformLocation(program, 'uBreathIntensity');
      const uHoverAmount = gl.getUniformLocation(program, 'uHoverAmount');
      const uEyeDilation = gl.getUniformLocation(program, 'uEyeDilation');
      const uShimmerPhase = gl.getUniformLocation(program, 'uShimmerPhase');
      
      gl.uniformMatrix4fv(uModel, false, moonModel);
      gl.uniform3fv(uMoonColor, moon.color);
      
      // Rim color (lighter version of base color)
      const rimColor = [
        Math.min(moon.color[0] * 1.4, 1.0),
        Math.min(moon.color[1] * 1.4, 1.0),
        Math.min(moon.color[2] * 1.4, 1.0)
      ];
      gl.uniform3fv(uRimColor, rimColor);
      
      gl.uniform1f(uGlowIntensity, moon.glowIntensity);
      gl.uniform1f(uPulseSpeed, moon.pulseSpeed);
      
      // New moth wing moon uniforms
      gl.uniform1f(uBreathIntensity, moon.breathIntensity);
      gl.uniform1f(uHoverAmount, moon.hoverAmount);
      gl.uniform1f(uEyeDilation, moon.eyeDilation);
      gl.uniform1f(uShimmerPhase, moon.shimmerPhase);
      
      // Draw moon
      gl.drawElements(gl.TRIANGLES, this.vertexCount, gl.UNSIGNED_SHORT, 0);
    });
    
    gl.bindVertexArray(null);
  }
  
  // Get moon at screen position (for click detection)
  getMoonAtPosition(ndcX, ndcY, projMatrix, viewMatrix, modelMatrix) {
    let closestMoon = null;
    let closestDist = 0.2; // Screen-space hit radius
    
    this.moons.forEach(moon => {
      const worldPos = this.getWorldPosition(moon);
      
      // Project to screen space
      const modelPos = mat4.transformPoint(modelMatrix, worldPos);
      const viewPos = mat4.transformPoint(viewMatrix, modelPos);
      const clipPos = mat4.transformPoint(projMatrix, viewPos); // Returns NDC xyz and clip w
      
      // Check if behind camera
      if (clipPos[3] < 0) return;
      
      const screenX = clipPos[0];
      const screenY = clipPos[1];
      
      // Distance to mouse
      const dist = Math.sqrt((screenX - ndcX) ** 2 + (screenY - ndcY) ** 2);
      
      // Scale hit radius by moon size (smaller moon = smaller hit area)
      const hitRadius = 0.15 * (moon.moonRadius / 0.08); // Adjusted base from 0.18 to 0.08
      
      if (dist < hitRadius && dist < closestDist) {
        closestDist = dist;
        closestMoon = moon;
      }
    });
    
    return closestMoon;
  }
  
  // Update hover state for moon
  setHoveredMoon(moon) {
    this.moons.forEach(m => {
      const isHovered = (m === moon);
      m.hovered = isHovered;
      m.targetScale = isHovered ? 1.15 : 1.0;
      
      // Moth wing moon interaction states
      m.targetHoverAmount = isHovered ? 1.0 : 0.0;
      m.targetEyeDilation = isHovered ? 1.0 : 0.0;
      m.targetBreathIntensity = isHovered ? 1.5 : 1.0; // Breathe faster on hover
      
      // Trigger shimmer wave on hover start
      if (isHovered && !m.shimmerActive) {
        m.shimmerActive = true;
        m.shimmerStartTime = Date.now();
        m.shimmerPhase = -1.0;
      }
    });
  }
  
  // Trigger click interaction on moon
  triggerMoonClick(moon) {
    if (!moon) return;
    
    // Trigger rapid shimmer wave
    moon.shimmerActive = true;
    moon.shimmerStartTime = Date.now();
    moon.shimmerPhase = -1.0;
    
    // Eye flash (handled by existing click logic in main code)
    // Wing dust burst will be added in particle system
  }
  
  // Get moon's world position (for external depth checking)
  getMoonWorldPosition(moon) {
    if (!moon) return null;
    return this.getWorldPosition(moon);
  }
  
  // Pause/unpause specific moon
  pauseMoon(moon, paused) {
    if (moon) {
      moon.paused = paused;
    }
  }
  
  // Pause/unpause all moons
  pauseAll(paused) {
    this.moons.forEach(moon => {
      moon.paused = paused;
    });
  }
}
