import { createSphereGeometry } from '../core/geometry.js';
import { mat4 } from '../core/math-utils.js';

export class MoonOrbitSystem {
  constructor(gl, projects) {
    this.gl = gl;
    this.moons = [];
    this._uniformsCache = null;
    this._moonModelMatrix = new Float32Array(16); // Pre-allocated, reused per moon
    
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
        breathIntensity: 1.0,
        targetBreathIntensity: 1.0,
        hoverAmount: 0.0,
        targetHoverAmount: 0.0,
        eyeDilation: 0.0,
        targetEyeDilation: 0.0,
        shimmerPhase: -1.0,
        shimmerActive: false,
        shimmerStartTime: 0
      });
    });
    
    const sphereDetail = 24;
    this.geometry = createSphereGeometry(1.0, sphereDetail, sphereDetail);
    this.vertexCount = this.geometry.indices.length;
    
    this.setupBuffers();
  }
  
  setupBuffers() {
    const gl = this.gl;
    
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.geometry.positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); // position
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    
    const normalBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.geometry.normals, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1); // normal
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    
    const uvBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.geometry.uvs, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(2); // uv
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
    
    const indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.geometry.indices, gl.STATIC_DRAW);
    
    gl.bindVertexArray(null);
  }
  
  update(dt) {
    const isMobile = window.innerWidth <= 768;

    this.moons.forEach(moon => {
      moon.angle += moon.rotationSpeed * dt;
      if (moon.angle > 360) moon.angle -= 360;
      
      let targetScale = moon.targetScale;

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
      
      if (moon.shimmerActive) {
        const shimmerDuration = 2.0;
        const elapsed = (Date.now() - moon.shimmerStartTime) / 1000;
        moon.shimmerPhase = -1.0 + (elapsed / shimmerDuration) * 2.0;
        
        if (moon.shimmerPhase >= 1.0) {
          moon.shimmerActive = false;
          moon.shimmerPhase = -1.0;
        }
      }
    });
  }
  
  getWorldPosition(moon) {
    const angleRad = moon.angle * Math.PI / 180;
    const tiltRad = moon.orbitTilt * Math.PI / 180;
    
    // X-Z plane orbit with Y tilt
    return [
      moon.orbitRadius * Math.cos(angleRad),
      moon.orbitRadius * Math.sin(angleRad) * Math.sin(tiltRad),
      moon.orbitRadius * Math.sin(angleRad) * Math.cos(tiltRad)
    ];
  }
  
  _cacheUniforms(program) {
    const gl = this.gl;
    this._uniformsCache = {
      uProjection: gl.getUniformLocation(program, 'uProjection'),
      uView: gl.getUniformLocation(program, 'uView'),
      uTime: gl.getUniformLocation(program, 'uTime'),
      uCameraPos: gl.getUniformLocation(program, 'uCameraPos'),
      uModel: gl.getUniformLocation(program, 'uModel'),
      uMoonColor: gl.getUniformLocation(program, 'uMoonColor'),
      uRimColor: gl.getUniformLocation(program, 'uRimColor'),
      uGlowIntensity: gl.getUniformLocation(program, 'uGlowIntensity'),
      uPulseSpeed: gl.getUniformLocation(program, 'uPulseSpeed'),
      uBreathIntensity: gl.getUniformLocation(program, 'uBreathIntensity'),
      uHoverAmount: gl.getUniformLocation(program, 'uHoverAmount'),
      uEyeDilation: gl.getUniformLocation(program, 'uEyeDilation'),
      uShimmerPhase: gl.getUniformLocation(program, 'uShimmerPhase'),
    };
  }

  render(program, projMatrix, viewMatrix, modelMatrix, time, cameraPos) {
    if (this.moons.length === 0) return;
    
    const gl = this.gl;
    gl.useProgram(program);
    gl.bindVertexArray(this.vao);
    
    if (!this._uniformsCache) this._cacheUniforms(program);
    const u = this._uniformsCache;
    
    gl.uniformMatrix4fv(u.uProjection, false, projMatrix);
    gl.uniformMatrix4fv(u.uView, false, viewMatrix);
    gl.uniform1f(u.uTime, time);
    gl.uniform3fv(u.uCameraPos, cameraPos);
    
    const m = this._moonModelMatrix;
    
    this.moons.forEach((moon, index) => {
      const worldPos = this.getWorldPosition(moon);
      
      const scale = moon.moonRadius * moon.scale;
      
      const rotatedPos = modelMatrix
        ? mat4.transformPoint(modelMatrix, worldPos)
        : [...worldPos, 1];
      
      // Reuse pre-allocated matrix
      m[0] = scale; m[1] = 0; m[2] = 0; m[3] = 0;
      m[4] = 0; m[5] = scale; m[6] = 0; m[7] = 0;
      m[8] = 0; m[9] = 0; m[10] = scale; m[11] = 0;
      m[12] = rotatedPos[0]; m[13] = rotatedPos[1]; m[14] = rotatedPos[2]; m[15] = 1;
      
      gl.uniformMatrix4fv(u.uModel, false, m);
      gl.uniform3fv(u.uMoonColor, moon.color);
      
      const rimColor = [
        Math.min(moon.color[0] * 1.4, 1.0),
        Math.min(moon.color[1] * 1.4, 1.0),
        Math.min(moon.color[2] * 1.4, 1.0)
      ];
      gl.uniform3fv(u.uRimColor, rimColor);
      
      gl.uniform1f(u.uGlowIntensity, moon.glowIntensity);
      gl.uniform1f(u.uPulseSpeed, moon.pulseSpeed);
      
      gl.uniform1f(u.uBreathIntensity, moon.breathIntensity);
      gl.uniform1f(u.uHoverAmount, moon.hoverAmount);
      gl.uniform1f(u.uEyeDilation, moon.eyeDilation);
      gl.uniform1f(u.uShimmerPhase, moon.shimmerPhase);
      
      gl.drawElements(gl.TRIANGLES, this.vertexCount, gl.UNSIGNED_SHORT, 0);
    });
    
    gl.bindVertexArray(null);
  }
  
  getMoonAtPosition(ndcX, ndcY, projMatrix, viewMatrix, modelMatrix) {
    let closestMoon = null;
    let closestDist = 0.2;
    
    this.moons.forEach(moon => {
      const worldPos = this.getWorldPosition(moon);
      
      const modelPos = mat4.transformPoint(modelMatrix, worldPos);
      const viewPos = mat4.transformPoint(viewMatrix, modelPos);
      const clipPos = mat4.transformPoint(projMatrix, viewPos);
      
      if (clipPos[3] < 0) return;
      
      const screenX = clipPos[0];
      const screenY = clipPos[1];
      
      const dist = Math.sqrt((screenX - ndcX) ** 2 + (screenY - ndcY) ** 2);
      
      const hitRadius = 0.15 * (moon.moonRadius / 0.08);
      
      if (dist < hitRadius && dist < closestDist) {
        closestDist = dist;
        closestMoon = moon;
      }
    });
    
    return closestMoon;
  }
  
  setHoveredMoon(moon) {
    this.moons.forEach(m => {
      const isHovered = (m === moon);
      m.hovered = isHovered;
      m.targetScale = isHovered ? 1.15 : 1.0;
      
      m.targetHoverAmount = isHovered ? 1.0 : 0.0;
      m.targetEyeDilation = isHovered ? 1.0 : 0.0;
      m.targetBreathIntensity = isHovered ? 1.5 : 1.0;
      
      if (isHovered && !m.shimmerActive) {
        m.shimmerActive = true;
        m.shimmerStartTime = Date.now();
        m.shimmerPhase = -1.0;
      }
    });
  }
  
  triggerMoonClick(moon) {
    if (!moon) return;
    
    moon.shimmerActive = true;
    moon.shimmerStartTime = Date.now();
    moon.shimmerPhase = -1.0;
  }
  
  getMoonWorldPosition(moon) {
    if (!moon) return null;
    return this.getWorldPosition(moon);
  }
  
  pauseMoon(moon, paused) {
    if (moon) {
      moon.paused = paused;
    }
  }
  
  pauseAll(paused) {
    this.moons.forEach(moon => {
      moon.paused = paused;
    });
  }
}
