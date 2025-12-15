/**
 * WorkPinSystem - Manages work location pins and orbital hover effects
 * Handles pin rendering, hover states, text billboards, and orbital particles
 */

// Text Renderer for generating text textures
class TextRenderer {
  constructor(gl) {
    this.gl = gl;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.textureCache = new Map();
  }
  
  createTextTexture(company, role, period, color = '#3FFF9F') {
    const key = `${company}_${role}_${period}`;
    if (this.textureCache.has(key)) return this.textureCache.get(key);
    
    const width = 512;
    const height = 128;
    this.canvas.width = width;
    this.canvas.height = height;
    
    const ctx = this.ctx;
    ctx.clearRect(0, 0, width, height);
    
    // Dark background with transparency
    ctx.fillStyle = 'rgba(20, 30, 28, 0.9)';
    ctx.fillRect(0, 0, width, height);
    
    // Border glow
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.strokeRect(4, 4, width-8, height-8);
    ctx.shadowBlur = 0;
    
    // Company name (large)
    ctx.fillStyle = '#C8FFDC';
    ctx.font = 'bold 32px "Courier New", monospace';
    ctx.fillText(company, 20, 45);
    
    // Role (medium)
    ctx.fillStyle = color;
    ctx.font = '20px "Courier New", monospace';
    ctx.fillText(role, 20, 75);
    
    // Period (small)
    ctx.fillStyle = '#7AAE8A';
    ctx.font = '16px "Courier New", monospace';
    ctx.fillText(period, 20, 100);
    
    // Create WebGL texture
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.canvas);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    
    this.textureCache.set(key, texture);
    return texture;
  }
}

export class WorkPinSystem {
  constructor(gl, locations, pinGeometry) {
    this.gl = gl;
    this.locations = locations;
    this.pins = [];
    this.hoveredPin = null;
    this.selectedPin = null;
    this.pinGeometry = pinGeometry;
    
    this.textRenderer = new TextRenderer(gl);
    this.textQuads = new Map();
    
    // Orbital particle system for hover effect
    this.orbitalParticles = [];
    this.maxOrbitalsPerPin = 8; // 8 particles orbit each hovered pin
    
    this.initializePins();
    this.setupBuffers();
    this.createBillboardGeometry();
    this.generateTextTextures(); // Must be after initializePins
    this.setupOrbitalParticles();
  }
  
  initializePins() {
    for (const [key, loc] of Object.entries(this.locations)) {
      const { imageCoords, name, color } = loc;
      
      if (!imageCoords) {
        console.warn(`[WorkPinSystem] No image coordinates for ${key}`);
        continue;
      }
      
      // Convert image coordinates to UV (matching sphere geometry UV mapping)
      // Image dimensions: 1536×1024
      const u = 1.0 - (imageCoords.x / 1536.0); // Flip U to match sphere UV
      const v = imageCoords.y / 1024.0;
      
      // Convert UV to spherical coordinates
      // U maps to longitude (0-1 → 0-2π)
      // V maps to latitude (0-1 → π-0)
      const theta = u * Math.PI * 2.0;  // Longitude in radians
      const phi = v * Math.PI;           // Latitude in radians
      
      // Convert spherical to cartesian (matching sphere geometry)
      const r = 1.0;
      const sinTheta = Math.sin(theta);
      const cosTheta = Math.cos(theta);
      const sinPhi = Math.sin(phi);
      const cosPhi = Math.cos(phi);
      
      const basePos = [
        r * cosTheta * sinPhi,  // X
        r * cosPhi,              // Y (up)
        r * sinTheta * sinPhi
      ];
      
      this.pins.push({
        key,
        name: name || key,
        basePos,
        color: color || [0.247, 1.0, 0.624],
        targetHeight: 0.12,
        currentHeight: 0.12,
        targetScale: 1.0,      // For hover scale animation
        currentScale: 1.0,     // Smooth interpolated scale
        pulsePhase: Math.random() * Math.PI * 2,
        hovered: false,
        selected: false,
        imageCoords,
        orbitals: []           // Orbital particles for this pin
      });
    }
  }
  
  setupBuffers() {
    const gl = this.gl;
    const numInstances = this.pins.length;
    
    // Instance data arrays
    this.instancePosData = new Float32Array(numInstances * 3);
    this.instanceColorData = new Float32Array(numInstances * 3);
    this.instanceHeightData = new Float32Array(numInstances);
    this.instancePhaseData = new Float32Array(numInstances);
    this.instanceScaleData = new Float32Array(numInstances);
    
    // Fill initial data
    this.pins.forEach((pin, i) => {
      this.instancePosData[i * 3] = pin.basePos[0];
      this.instancePosData[i * 3 + 1] = pin.basePos[1];
      this.instancePosData[i * 3 + 2] = pin.basePos[2];
      
      this.instanceColorData[i * 3] = pin.color[0];
      this.instanceColorData[i * 3 + 1] = pin.color[1];
      this.instanceColorData[i * 3 + 2] = pin.color[2];
      
      this.instanceHeightData[i] = pin.currentHeight;
      this.instancePhaseData[i] = pin.pulsePhase;
      this.instanceScaleData[i] = pin.currentScale;
    });
    
    // Create VAO for instanced rendering
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    
    // Base geometry (shared across all instances)
    const posBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.pinGeometry.positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    
    const normalBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.pinGeometry.normals, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    
    // Instance attributes
    this.instancePosBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instancePosBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.instancePosData, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(2, 1);
    
    this.instanceColorBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceColorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.instanceColorData, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 3, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(3, 1);
    
    this.instanceHeightBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceHeightBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.instanceHeightData, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 1, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(4, 1);
    
    this.instancePhaseBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instancePhaseBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.instancePhaseData, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(5);
    gl.vertexAttribPointer(5, 1, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(5, 1);
    
    this.instanceScaleBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceScaleBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.instanceScaleData, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(6);
    gl.vertexAttribPointer(6, 1, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(6, 1);
    
    // Index buffer
    const indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.pinGeometry.indices, gl.STATIC_DRAW);
    
    gl.bindVertexArray(null);
  }
  
  update(dt, time) {
    // Animation strategy:
    // - Pin spikes (height/scale): Respond to hover (pin.hovered)
    // - Orbital particles: Always active, continuously rotating
    // - Text billboards: Always visible at full opacity
    // This ensures ambient effects are always visible; hover only affects pin visual feedback
    
    const isMobile = window.innerWidth <= 768;

    // Animate pin heights and scales (hover-responsive)
    this.pins.forEach((pin, i) => {
      // Height animation (subtle on hover)
      let targetHeight = pin.hovered ? pin.targetHeight * 1.2 : pin.targetHeight;
      
      // Heartbeat for mobile (pulsing height)
      if (isMobile && !pin.hovered) {
        const pulse = Math.sin(time * 3 + pin.pulsePhase) * 0.5 + 0.5; // 0 to 1
        targetHeight = pin.targetHeight * (1.0 + pulse * 0.15);
      }

      const heightDiff = targetHeight - pin.currentHeight;
      
      // Snap to target if very close
      if (Math.abs(heightDiff) < 0.001) {
        pin.currentHeight = targetHeight;
      } else {
        pin.currentHeight += heightDiff * 0.12;
      }
      this.instanceHeightData[i] = pin.currentHeight;
      
      // Scale animation (clear hover feedback)
      let targetScale = pin.hovered ? 1.3 : 1.0;

      // Heartbeat for mobile (pulsing scale)
      if (isMobile && !pin.hovered) {
        const pulse = Math.sin(time * 3 + pin.pulsePhase) * 0.5 + 0.5;
        targetScale = 1.0 + pulse * 0.2;
      }

      const scaleDiff = targetScale - pin.currentScale;
      
      if (Math.abs(scaleDiff) < 0.001) {
        pin.currentScale = targetScale;
      } else {
        pin.currentScale += scaleDiff * 0.12;
      }
      this.instanceScaleData[i] = pin.currentScale;
      
      // Update orbital particles - always active, continuously rotating
      pin.orbitals.forEach(orbital => {
        // Always active (not dependent on hover)
        orbital.targetActive = 1.0;
        orbital.active = 1.0; // Keep at full opacity
        
        // Continuously rotate around pin
        orbital.angle += orbital.speed * dt;
      });
    });
    
    // Update GPU buffers
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceHeightBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceHeightData);
    
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceScaleBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceScaleData);
    
    // Animate text billboards - always visible, hover only affects pins
    this.pins.forEach((pin, i) => {
      const quad = this.textQuads.get(pin.key);
      if (quad) {
        // Always fully visible (not dependent on hover)
        quad.targetAlpha = 1.0;
        quad.alpha = 1.0;
      }
    });
  }
  
  getOrbitalParticles(time) {
    // Return active orbital particles as world positions for rendering
    const particles = [];
    
    this.pins.forEach(pin => {
      // Always render orbitals, not dependent on hover
      pin.orbitals.forEach(orbital => {
        if (orbital.active > 0.001) { // Lower threshold for visibility
          // Calculate orbital position in 3D space
          // Create a local tangent plane at the pin
          const pinPos = pin.basePos;
          const normal = [pinPos[0], pinPos[1], pinPos[2]]; // Pin normal (outward)
          const len = Math.sqrt(normal[0]**2 + normal[1]**2 + normal[2]**2);
          const n = [normal[0]/len, normal[1]/len, normal[2]/len];
            
            // Create two perpendicular vectors in the tangent plane
            let tangent = [0, 0, 0];
            if (Math.abs(n[1]) < 0.9) {
              tangent = [0, 1, 0]; // Use up vector
            } else {
              tangent = [1, 0, 0]; // Use right vector
            }
            
            // Cross product to get first tangent basis vector
            const t1 = [
              tangent[1]*n[2] - tangent[2]*n[1],
              tangent[2]*n[0] - tangent[0]*n[2],
              tangent[0]*n[1] - tangent[1]*n[0]
            ];
            const t1Len = Math.sqrt(t1[0]**2 + t1[1]**2 + t1[2]**2);
            t1[0] /= t1Len; t1[1] /= t1Len; t1[2] /= t1Len;
            
            // Cross product to get second tangent basis vector
            const t2 = [
              n[1]*t1[2] - n[2]*t1[1],
              n[2]*t1[0] - n[0]*t1[2],
              n[0]*t1[1] - n[1]*t1[0]
            ];
            
            // Calculate orbital position
            const angle = orbital.angle;
            const radius = orbital.radius * 1.05; // Slightly above surface
            const offsetX = Math.cos(angle) * radius;
            const offsetY = Math.sin(angle) * radius;
            
            // World position: pin + offset in tangent plane + slight outward push
            const worldPos = [
              pinPos[0] * 1.15 + t1[0] * offsetX + t2[0] * offsetY + n[0] * 0.03,
              pinPos[1] * 1.15 + t1[1] * offsetX + t2[1] * offsetY + n[1] * 0.03,
              pinPos[2] * 1.15 + t1[2] * offsetX + t2[2] * offsetY + n[2] * 0.03
            ];
            
            particles.push({
              position: worldPos,
              life: orbital.active,
              size: 0.08 + Math.sin(time * 3 + orbital.phaseOffset) * 0.02,
              phase: orbital.phaseOffset,
              color: pin.color
            });
        }
      });
    });
    
    return particles;
  }
  
  render(program, projMatrix, viewMatrix, modelMatrix, time, cameraPos) {
    if (this.pins.length === 0) return;
    
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    
    gl.uniformMatrix4fv(gl.getUniformLocation(program, 'uProjection'), false, projMatrix);
    gl.uniformMatrix4fv(gl.getUniformLocation(program, 'uView'), false, viewMatrix);
    gl.uniformMatrix4fv(gl.getUniformLocation(program, 'uModel'), false, modelMatrix);
    gl.uniform1f(gl.getUniformLocation(program, 'uTime'), time);
    gl.uniform3fv(gl.getUniformLocation(program, 'uCameraPos'), cameraPos);
    
    gl.drawElementsInstanced(
      gl.TRIANGLES,
      this.pinGeometry.vertexCount,
      gl.UNSIGNED_SHORT,
      0,
      this.pins.length
    );
    
    gl.bindVertexArray(null);
  }
  
  createBillboardGeometry() {
    const gl = this.gl;
    
    // Simple quad: 4 vertices forming 2 triangles
    const positions = new Float32Array([
      -1.0,  1.0,  // top-left
       1.0,  1.0,  // top-right
       1.0, -1.0,  // bottom-right
      -1.0, -1.0   // bottom-left
    ]);
    
    const uvs = new Float32Array([
      0.0, 1.0,  // top-left
      1.0, 1.0,  // top-right
      1.0, 0.0,  // bottom-right
      0.0, 0.0   // bottom-left
    ]);
    
    const indices = new Uint16Array([
      0, 1, 2,  // first triangle
      0, 2, 3   // second triangle
    ]);
    
    // Create VAO for billboard quad
    this.billboardVAO = gl.createVertexArray();
    gl.bindVertexArray(this.billboardVAO);
    
    // Position buffer (aPosition = location 0)
    const posBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    
    // UV buffer (aUv = location 1)
    const uvBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    
    // Index buffer
    const indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    
    gl.bindVertexArray(null);
  }
  
  setupOrbitalParticles() {
    // Create orbital particles for each pin
    this.pins.forEach(pin => {
      for (let i = 0; i < this.maxOrbitalsPerPin; i++) {
        const orbital = {
          angle: (i / this.maxOrbitalsPerPin) * Math.PI * 2, // Evenly spaced
          speed: 1.5 + Math.random() * 0.5, // Rotation speed (radians/sec)
          radius: 0.15 + Math.random() * 0.05, // Distance from pin
          phaseOffset: Math.random() * Math.PI * 2,
          active: 0.0, // Fade in/out (0-1)
          targetActive: 0.0
        };
        pin.orbitals.push(orbital);
      }
    });
  }
  
  generateTextTextures() {
    // Pre-generate textures for all work locations
    for (const [key, loc] of Object.entries(this.locations)) {
      const entry = loc.entries[0]; // Get first/current job
      const texture = this.textRenderer.createTextTexture(
        entry.company,
        entry.position,
        entry.period,
        loc.color
      );
      
      this.textQuads.set(key, {
        texture: texture,
        alpha: 0.0,
        targetAlpha: 0.0
      });
    }
  }
  
  renderText(program, projMatrix, viewMatrix) {
    const gl = this.gl;
    
    if (!program) {
      console.error('❌ Text billboard program is null!');
      return;
    }
    
    if (!this.billboardVAO) {
      console.error('❌ Billboard VAO not created!');
      return;
    }
    
    // Enable blending for transparent text backgrounds
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.disable(gl.DEPTH_TEST); // Render on top of everything
    
    gl.useProgram(program);
    
    // Mobile check
    const isMobile = window.innerWidth <= 900;
    
    // If mobile, skip rendering text billboards entirely
    if (isMobile) return;
    
    gl.bindVertexArray(this.billboardVAO);
    
    // Set matrices
    gl.uniformMatrix4fv(gl.getUniformLocation(program, 'uProjection'), false, projMatrix);
    gl.uniformMatrix4fv(gl.getUniformLocation(program, 'uView'), false, viewMatrix);
    
    // Render each visible text quad
    this.pins.forEach((pin, i) => {
      const quad = this.textQuads.get(pin.key);
      if (!quad || quad.alpha < 0.01) return;
      
      // Set uniforms for this billboard
      gl.uniform3fv(gl.getUniformLocation(program, 'uWorldPos'), new Float32Array(pin.basePos));
      gl.uniform2f(gl.getUniformLocation(program, 'uSize'), 5.0, 2.0); // DEBUG: 5x larger for visibility testing
      gl.uniform1f(gl.getUniformLocation(program, 'uHoverProgress'), pin.hovered ? 1.0 : 0.0);
      gl.uniform1f(gl.getUniformLocation(program, 'uAlpha'), quad.alpha);
      
      // Bind text texture
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, quad.texture);
      gl.uniform1i(gl.getUniformLocation(program, 'uTextTexture'), 0);
      
      // Draw billboard
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    });
    
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST); // Re-enable depth test
    gl.disable(gl.BLEND);
  }
  
  checkHover(ray, cameraPos) {
    // Ray-sphere intersection for pin selection
    // Will implement proper picking in next step
    this.pins.forEach(pin => {
      pin.hovered = false;
    });
  }
}
