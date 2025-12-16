export class DataStreamSystem {
  constructor(gl, maxParticles = 500) {
    this.gl = gl;
    this.maxParticles = maxParticles;
    this.particles = [];
    this.activeParticles = 0;
    this.emitting = false;
    this.emissionPoint = [0, 0, 0];
    this.emissionColor = [0.247, 1.0, 0.624];
    
    for (let i = 0; i < maxParticles; i++) {
      this.particles.push({
        position: [0, 0, 0],
        velocity: [0, 0, 0],
        life: 0,
        phase: Math.random() * Math.PI * 2,
        active: false
      });
    }
    
    this.positionBuffer = gl.createBuffer();
    this.lifeBuffer = gl.createBuffer();
    this.phaseBuffer = gl.createBuffer();
    
    this.positionData = new Float32Array(maxParticles * 3);
    this.lifeData = new Float32Array(maxParticles);
    this.phaseData = new Float32Array(maxParticles);
    
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.positionData, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lifeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.lifeData, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 0, 0);
    
    gl.bindBuffer(gl.ARRAY_BUFFER, this.phaseBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.phaseData, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
    
    gl.bindVertexArray(null);
  }
  
  startEmission(point, color) {
    this.emitting = true;
    this.emissionPoint = point;
    this.emissionColor = color;
  }
  
  stopEmission() {
    this.emitting = false;
  }
  
  update(dt) {
    if (this.emitting && Math.random() < 0.5) {
      const particle = this.particles.find(p => !p.active);
      if (particle) {
        const spread = 0.02;
        particle.position = [
          this.emissionPoint[0] + (Math.random() - 0.5) * spread,
          this.emissionPoint[1] + (Math.random() - 0.5) * spread,
          this.emissionPoint[2] + (Math.random() - 0.5) * spread
        ];
        
        const upDir = [
          this.emissionPoint[0] * 0.8,
          this.emissionPoint[1] * 0.8 + 0.5,
          this.emissionPoint[2] * 0.8
        ];
        
        particle.velocity = [
          upDir[0] * (0.5 + Math.random() * 0.5),
          upDir[1] * (0.5 + Math.random() * 0.5),
          upDir[2] * (0.5 + Math.random() * 0.5)
        ];
        particle.life = 1.0;
        particle.active = true;
      }
    }
    
    this.activeParticles = 0;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      
      p.life -= dt * 0.8;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }
      
      p.velocity[0] *= 0.99;
      p.velocity[1] *= 0.99;
      p.velocity[2] *= 0.99;
      
      p.position[0] += p.velocity[0] * dt;
      p.position[1] += p.velocity[1] * dt;
      p.position[2] += p.velocity[2] * dt;
      
      const idx = this.activeParticles * 3;
      this.positionData[idx] = p.position[0];
      this.positionData[idx + 1] = p.position[1];
      this.positionData[idx + 2] = p.position[2];
      this.lifeData[this.activeParticles] = p.life;
      this.phaseData[this.activeParticles] = p.phase;
      
      this.activeParticles++;
    }
    
    if (this.activeParticles > 0) {
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.positionData.subarray(0, this.activeParticles * 3));
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lifeBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.lifeData.subarray(0, this.activeParticles));
      gl.bindBuffer(gl.ARRAY_BUFFER, this.phaseBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.phaseData.subarray(0, this.activeParticles));
    }
  }
  
  render(program, projMatrix, viewMatrix, modelMatrix, time) {
    if (this.activeParticles === 0) return;
    
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    
    gl.uniformMatrix4fv(gl.getUniformLocation(program, 'uProjection'), false, projMatrix);
    gl.uniformMatrix4fv(gl.getUniformLocation(program, 'uView'), false, viewMatrix);
    gl.uniformMatrix4fv(gl.getUniformLocation(program, 'uModel'), false, modelMatrix);
    gl.uniform1f(gl.getUniformLocation(program, 'uTime'), time);
    gl.uniform3fv(gl.getUniformLocation(program, 'uStreamColor'), this.emissionColor);
    
    gl.drawArrays(gl.POINTS, 0, this.activeParticles);
    gl.bindVertexArray(null);
  }
}
