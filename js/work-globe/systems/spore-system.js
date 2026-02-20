export class SporeSystem {
  constructor(gl, maxParticles = 10000) {
    this.gl = gl;
    this.maxParticles = maxParticles;
    this.activeParticles = 0;
    this.particles = [];
    this.lastLightningIntensity = 0;
    this.emissionCooldown = 0;
    
    // Free-list: stack of inactive particle indices for O(1) acquisition
    this.freeList = [];
    
    for (let i = 0; i < maxParticles; i++) {
      this.particles.push({
        position: [0, 0, 0],
        velocity: [0, 0, 0],
        life: 0,
        size: 1,
        phase: Math.random() * Math.PI * 2,
        active: false
      });
      this.freeList.push(i);
    }
    
    this.positionBuffer = gl.createBuffer();
    this.velocityBuffer = gl.createBuffer();
    this.lifeBuffer = gl.createBuffer();
    this.sizeBuffer = gl.createBuffer();
    this.phaseBuffer = gl.createBuffer();
    this.colorBuffer = gl.createBuffer();
    
    this.positionData = new Float32Array(maxParticles * 3);
    this.velocityData = new Float32Array(maxParticles * 3);
    this.lifeData = new Float32Array(maxParticles);
    this.sizeData = new Float32Array(maxParticles);
    this.phaseData = new Float32Array(maxParticles);
    this.colorData = new Float32Array(maxParticles * 3);
    
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    
    this.setupAttribute(this.positionBuffer, 0, 3, this.positionData);
    this.setupAttribute(this.velocityBuffer, 1, 3, this.velocityData);
    this.setupAttribute(this.lifeBuffer, 2, 1, this.lifeData);
    this.setupAttribute(this.sizeBuffer, 3, 1, this.sizeData);
    this.setupAttribute(this.phaseBuffer, 4, 1, this.phaseData);
    this.setupAttribute(this.colorBuffer, 5, 3, this.colorData);
    
    gl.bindVertexArray(null);
  }
  
  setupAttribute(buffer, location, size, data) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
  }
  
  emitBurst(originPositions, intensity = 1.0) {
    if (this.emissionCooldown > 0) return;
    
    const tinyParticles = Math.floor(250 + intensity * 350);
    const regularParticles = Math.floor(50 + intensity * 100);
    const emitted = [];
    
    for (const origin of originPositions) {
      const radius = Math.sqrt(origin[0]**2 + origin[1]**2 + origin[2]**2);
      const normal = [origin[0]/radius, origin[1]/radius, origin[2]/radius];
      
      for (let i = 0; i < tinyParticles; i++) {
        const particle = this.getInactiveParticle();
        if (!particle) break;
        
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.random() * Math.PI;
        
        let dir = [
          Math.sin(phi) * Math.cos(theta),
          Math.sin(phi) * Math.sin(theta),
          Math.cos(phi)
        ];
        
        const radialComponent = dir[0]*normal[0] + dir[1]*normal[1] + dir[2]*normal[2];
        dir[0] -= normal[0] * radialComponent * 0.7;
        dir[1] -= normal[1] * radialComponent * 0.7;
        dir[2] -= normal[2] * radialComponent * 0.7;
        
        const len = Math.sqrt(dir[0]**2 + dir[1]**2 + dir[2]**2);
        const speed = 0.4 + Math.random() * 0.6;
        dir[0] = (dir[0]/len) * speed;
        dir[1] = (dir[1]/len) * speed;
        dir[2] = (dir[2]/len) * speed;
        
        dir[0] += normal[0] * 0.08;
        dir[1] += normal[1] * 0.08;
        dir[2] += normal[2] * 0.08;
        
        const jitter = 0.05;
        particle.position = [
          origin[0] + (Math.random() - 0.5) * jitter,
          origin[1] + (Math.random() - 0.5) * jitter,
          origin[2] + (Math.random() - 0.5) * jitter
        ];
        particle.velocity = dir;
        particle.life = 1.0;
        particle.size = 0.03 + Math.random() * 0.06;
        particle.active = true;
        
        emitted.push(particle);
      }
      
      for (let i = 0; i < regularParticles; i++) {
        const particle = this.getInactiveParticle();
        if (!particle) break;
        
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.random() * Math.PI;
        
        let dir = [
          Math.sin(phi) * Math.cos(theta),
          Math.sin(phi) * Math.sin(theta),
          Math.cos(phi)
        ];
        
        const radialComponent = dir[0]*normal[0] + dir[1]*normal[1] + dir[2]*normal[2];
        dir[0] -= normal[0] * radialComponent * 0.7;
        dir[1] -= normal[1] * radialComponent * 0.7;
        dir[2] -= normal[2] * radialComponent * 0.7;
        
        const len = Math.sqrt(dir[0]**2 + dir[1]**2 + dir[2]**2);
        const speed = 0.5 + Math.random() * 0.7;
        dir[0] = (dir[0]/len) * speed;
        dir[1] = (dir[1]/len) * speed;
        dir[2] = (dir[2]/len) * speed;
        
        dir[0] += normal[0] * 0.1;
        dir[1] += normal[1] * 0.1;
        dir[2] += normal[2] * 0.1;
        
        const jitter = 0.05;
        particle.position = [
          origin[0] + (Math.random() - 0.5) * jitter,
          origin[1] + (Math.random() - 0.5) * jitter,
          origin[2] + (Math.random() - 0.5) * jitter
        ];
        particle.velocity = dir;
        particle.life = 1.0;
        particle.size = 0.12 + Math.random() * 0.15;
        particle.active = true;
        
        emitted.push(particle);
      }
    }
    
    this.emissionCooldown = 0.35;
    return emitted.length;
  }
  
  getInactiveParticle() {
    if (this.freeList.length === 0) return null;
    const idx = this.freeList.pop();
    return this.particles[idx];
  }
  
  update(dt, lightningIntensity = 0) {
    if (lightningIntensity > 0.7 && this.lastLightningIntensity < 0.5) {
      const tipPositions = this.getMyceliumTips();
      if (tipPositions.length > 0) {
        this.emitBurst(tipPositions, lightningIntensity);
      }
    }
    this.lastLightningIntensity = lightningIntensity;
    
    if (this.emissionCooldown > 0) {
      this.emissionCooldown -= dt;
    }
    
    this.activeParticles = 0;
    this.orbitalInjectionPoint = 0;
    
    // Pre-compute drag powers once per frame (avoids Math.pow per particle)
    const dt60 = dt * 60;
    const dragHigh = Math.pow(0.96, dt60);
    const dragMid  = Math.pow(0.93, dt60);
    const dragLow  = Math.pow(0.90, dt60);
    
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      
      p.life -= dt * 0.35;
      if (p.life <= 0) {
        p.active = false;
        this.freeList.push(i); // Return to free-list for O(1) reuse
        continue;
      }
      
      if (p.life > 0.7) {
        p.velocity[0] *= dragHigh;
        p.velocity[1] *= dragHigh;
        p.velocity[2] *= dragHigh;
      } else if (p.life > 0.3) {
        p.velocity[0] *= dragMid;
        p.velocity[1] *= dragMid;
        p.velocity[2] *= dragMid;
        p.velocity[1] -= dt * 0.3;
      } else {
        p.velocity[0] *= dragLow;
        p.velocity[1] *= dragLow;
        p.velocity[2] *= dragLow;
        p.velocity[1] -= dt * 1.2;
      }
      
      p.position[0] += p.velocity[0] * dt;
      p.position[1] += p.velocity[1] * dt;
      p.position[2] += p.velocity[2] * dt;
      
      const idx = this.activeParticles * 3;
      this.positionData[idx] = p.position[0];
      this.positionData[idx + 1] = p.position[1];
      this.positionData[idx + 2] = p.position[2];
      
      this.velocityData[idx] = p.velocity[0];
      this.velocityData[idx + 1] = p.velocity[1];
      this.velocityData[idx + 2] = p.velocity[2];
      
      this.lifeData[this.activeParticles] = p.life;
      this.sizeData[this.activeParticles] = p.size;
      this.phaseData[this.activeParticles] = p.phase;
      
      this.colorData[idx] = 0;
      this.colorData[idx + 1] = 0;
      this.colorData[idx + 2] = 0;
      
      this.activeParticles++;
    }
    
    this.orbitalInjectionPoint = this.activeParticles;
  }
  
  injectOrbitalParticles(orbitals) {
    orbitals.forEach(orbital => {
      if (this.activeParticles >= this.maxParticles) return;
      
      const idx = this.activeParticles * 3;
      this.positionData[idx] = orbital.position[0];
      this.positionData[idx + 1] = orbital.position[1];
      this.positionData[idx + 2] = orbital.position[2];
      
      this.velocityData[idx] = 0;
      this.velocityData[idx + 1] = 0;
      this.velocityData[idx + 2] = 0;
      
      this.lifeData[this.activeParticles] = orbital.life;
      this.sizeData[this.activeParticles] = orbital.size * 8.0;
      this.phaseData[this.activeParticles] = orbital.phase;
      
      this.colorData[idx] = orbital.color[0];
      this.colorData[idx + 1] = orbital.color[1];
      this.colorData[idx + 2] = orbital.color[2];
      
      this.activeParticles++;
    });
    
    if (this.activeParticles > 0) {
      this.updateBuffers();
    }
  }
  
  updateBuffers() {
    const gl = this.gl;
    
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.positionData.subarray(0, this.activeParticles * 3));
    
    gl.bindBuffer(gl.ARRAY_BUFFER, this.velocityBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.velocityData.subarray(0, this.activeParticles * 3));
    
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lifeBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.lifeData.subarray(0, this.activeParticles));
    
    gl.bindBuffer(gl.ARRAY_BUFFER, this.sizeBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.sizeData.subarray(0, this.activeParticles));
    
    gl.bindBuffer(gl.ARRAY_BUFFER, this.phaseBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.phaseData.subarray(0, this.activeParticles));
    
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.colorData.subarray(0, this.activeParticles * 3));
  }
  
  getMyceliumTips() {
    const tips = [];
    const numTips = 3 + Math.floor(Math.random() * 5);
    
    for (let i = 0; i < numTips; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);
      const r = 1.02;
      
      tips.push([
        r * Math.cos(phi) * Math.cos(theta),
        r * Math.sin(phi),
        r * Math.cos(phi) * Math.sin(theta)
      ]);
    }
    
    return tips;
  }
  
  render(program) {
    if (this.activeParticles === 0) return;
    
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.POINTS, 0, this.activeParticles);
    gl.bindVertexArray(null);
  }
}
