// WebGL globe visualization

import { mat4 } from './work-globe/core/math-utils.js';
import { createProgram, loadTexture } from './work-globe/core/gl-utils.js';
import { createSphereGeometry, createPinGeometry, createMyceliumHyphae } from './work-globe/core/geometry.js';

import { WORK_LOCATIONS } from './work-globe/data/work-locations.js';
import { PROJECTS } from './work-globe/data/projects.js';

import { SporeSystem } from './work-globe/systems/spore-system.js';
import { WorkPinSystem } from './work-globe/systems/work-pin-system.js';
import { DataStreamSystem } from './work-globe/systems/data-stream-system.js';
import { MoonOrbitSystem } from './work-globe/systems/moon-orbit-system.js';
import { cappedDpr, isFirefox } from './utils.js';

import { GLOBE_VERTEX_SHADER, GLOBE_FRAGMENT_SHADER } from './work-globe/shaders/globe-shaders.js';
import { ATMOSPHERE_VERTEX_SHADER, ATMOSPHERE_FRAGMENT_SHADER, FOG_VERTEX_SHADER, FOG_FRAGMENT_SHADER } from './work-globe/shaders/atmosphere-fog-shaders.js';
import { LIGHTNING_VERTEX_SHADER, LIGHTNING_FRAGMENT_SHADER } from './work-globe/shaders/lightning-shaders.js';
import { MYCELIUM_VERTEX_SHADER, MYCELIUM_FRAGMENT_SHADER, MYCELIUM_CORE_FRAGMENT_SHADER } from './work-globe/shaders/mycelium-shaders.js';
import { PARTICLE_VERTEX_SHADER, PARTICLE_FRAGMENT_SHADER } from './work-globe/shaders/particle-shaders.js';
import { PIN_VERTEX_SHADER, PIN_FRAGMENT_SHADER } from './work-globe/shaders/pin-shaders.js';
import { DATA_STREAM_VERTEX_SHADER, DATA_STREAM_FRAGMENT_SHADER, TEXT_BILLBOARD_VERTEX_SHADER, TEXT_BILLBOARD_FRAGMENT_SHADER } from './work-globe/shaders/misc-shaders.js';
import { MOON_VERTEX_SHADER, MOON_FRAGMENT_SHADER } from './work-globe/shaders/moon-shaders.js';

let gl, canvas;
let globeProgram, atmosphereProgram, fogProgram, lightningProgram, myceliumProgram, myceliumCoreProgram, sporeProgram, pinProgram, dataStreamProgram, textBillboardProgram, moonProgram;
let globeVAO, sphereVertexCount;
let myceliumVAO, myceliumVertexCount, myceliumGrowthTime = 0;
let sporeSystem = null;
let workPinSystem = null;
let dataStreamSystem = null;
let moonOrbitSystem = null;
let projectionMatrix, viewMatrix, modelMatrix;
let rotation = { x: 0, y: 0 };
let rotationVelocity = { x: 0, y: 0 };
let isDragging = false;
let lastPointerPos = { x: 0, y: 0 };
let clickStartPos = { x: 0, y: 0 };
let clickStartTime = 0;
let animationFrameId = null;
let autoRotate = true;
let time = 0;
let lastFrameTime = 0;

// Cached uniform locations (avoid getUniformLocation every frame)
let uniformCache = {};

// Reusable arrays to avoid allocations in render loop
const scaledModelFog = new Float32Array(16);
const scaledModelLightning = new Float32Array(16);

// Stored handler references for proper cleanup
let boundResizeHandler = null;
let boundTouchStartHandler = null;
let boundTouchEndHandler = null;
let boundDprHandler = null;
let boundVisibilityHandler = null;
let dprCheckIntervalId = null;

let isMobile = false;
const WORK_FRAME_INTERVAL_MS = isFirefox() ? 1000 / 30 : 0;

function updateMobileState() {
  isMobile = window.innerWidth <= 900;
  return isMobile;
}

let earthTexture = null;
let fogTexture = null;
let lightningTexture = null;
let texturesReady = false;

function checkAllTexturesLoaded() {
  if (earthTexture && fogTexture && lightningTexture) {
    texturesReady = true;
  }
}

/**
 * Cache uniform locations for a program to avoid getUniformLocation calls every frame.
 * @param {WebGLProgram} program 
 * @param {string} programKey - Unique key for this program's cache
 * @param {string[]} uniformNames - Array of uniform names to cache
 */
function cacheUniforms(program, programKey, uniformNames) {
  uniformCache[programKey] = {};
  for (const name of uniformNames) {
    uniformCache[programKey][name] = gl.getUniformLocation(program, name);
  }
}

function initWorkGlobe() {
  canvas = document.getElementById('work-globe-canvas');
  if (!canvas) {
    console.error('[Work Globe] Canvas not found');
    return;
  }
  
  const firefox = isFirefox();
  gl = canvas.getContext('webgl2', {
    alpha: true,
    antialias: !firefox,
    powerPreference: 'high-performance'
  });

  if (!gl) {
    console.error('WebGL2 not supported');
    // Show fallback message
    canvas.style.display = 'none';
    const fallback = document.createElement('div');
    fallback.className = 'webgl-fallback-visible';
    fallback.textContent = 'WebGL2 is not available in your browser. The globe visualization requires a modern browser with WebGL2 support.';
    canvas.parentNode.insertBefore(fallback, canvas.nextSibling);
    return;
  }

  updateMobileState();

  resizeCanvas();

  globeProgram = createProgram(gl, GLOBE_VERTEX_SHADER, GLOBE_FRAGMENT_SHADER, {
    position: 0,
    normal: 1,
    uv: 2
  });
  atmosphereProgram = createProgram(gl, ATMOSPHERE_VERTEX_SHADER, ATMOSPHERE_FRAGMENT_SHADER, {
    position: 0,
    normal: 1
  });
  fogProgram = createProgram(gl, FOG_VERTEX_SHADER, FOG_FRAGMENT_SHADER, {
    position: 0,
    normal: 1,
    uv: 2
  });
  lightningProgram = createProgram(gl, LIGHTNING_VERTEX_SHADER, LIGHTNING_FRAGMENT_SHADER, {
    position: 0,
    normal: 1,
    uv: 2
  });
  
  myceliumProgram = createProgram(gl, MYCELIUM_VERTEX_SHADER, MYCELIUM_FRAGMENT_SHADER, {
    position: 0,
    normal: 1,
    uv: 2,
    age: 3
  });
  
  myceliumCoreProgram = createProgram(gl, MYCELIUM_VERTEX_SHADER, MYCELIUM_CORE_FRAGMENT_SHADER, {
    position: 0,
    normal: 1,
    uv: 2,
    age: 3
  });
  
  sporeProgram = createProgram(gl, PARTICLE_VERTEX_SHADER, PARTICLE_FRAGMENT_SHADER, {
    position: 0,
    velocity: 1,
    life: 2,
    size: 3,
    phase: 4
  });
  
  pinProgram = createProgram(gl, PIN_VERTEX_SHADER, PIN_FRAGMENT_SHADER, {
    position: 0,
    normal: 1,
    instancePos: 2,
    instanceColor: 3,
    instanceHeight: 4,
    instancePhase: 5
  });
  
  dataStreamProgram = createProgram(gl, DATA_STREAM_VERTEX_SHADER, DATA_STREAM_FRAGMENT_SHADER, {
    position: 0,
    life: 1,
    phase: 2
  });
  
  moonProgram = createProgram(gl, MOON_VERTEX_SHADER, MOON_FRAGMENT_SHADER, {
    position: 0,
    normal: 1,
    uv: 2
  });
  
  textBillboardProgram = createProgram(gl, TEXT_BILLBOARD_VERTEX_SHADER, TEXT_BILLBOARD_FRAGMENT_SHADER, {
    aPosition: 0,
    aUv: 1
  });
  
  if (!textBillboardProgram) {
    console.error('❌ Failed to create text billboard shader program!');
  }

  // Cache uniform locations for all programs (avoids getUniformLocation every frame)
  cacheUniforms(globeProgram, 'globe', ['uProjection', 'uView', 'uModel', 'uTime', 'uDaymap', 'uUseDaymap']);
  cacheUniforms(atmosphereProgram, 'atmosphere', ['uProjection', 'uView', 'uModel']);
  cacheUniforms(fogProgram, 'fog', ['uProjection', 'uView', 'uModel', 'uFogTex', 'uFogTint', 'uFogStrength', 'uFogScroll', 'uTime']);
  cacheUniforms(lightningProgram, 'lightning', ['uProjection', 'uView', 'uModel', 'uLightningTex', 'uLightningColor', 'uLightningGain', 'uLightningScroll', 'uTime', 'uFlickerFreq', 'uFlickerDuty']);
  cacheUniforms(myceliumProgram, 'mycelium', ['uProjection', 'uView', 'uModel', 'uTime', 'uBodyColor', 'uCoreColor', 'uCoreGain', 'uGrowthTime', 'uOpacityNoise']);
  cacheUniforms(myceliumCoreProgram, 'myceliumCore', ['uProjection', 'uView', 'uModel', 'uTime', 'uCoreColor', 'uCoreGain', 'uGrowthTime']);
  cacheUniforms(sporeProgram, 'spore', ['uProjection', 'uView', 'uModel', 'uTime', 'uSporeColor', 'uEmberColor']);

  const sphere = createSphereGeometry(1.0, 40, 40);
  sphereVertexCount = sphere.indices.length;
  
  const imageToSpherical = (x, y) => {
    const u = 1.0 - (x / 1536.0); // Flip U to match sphere UV
    const v = y / 1024.0;
    const lon = u * Math.PI * 2.0 - Math.PI;  // -π to π
    const lat = (0.5 - v) * Math.PI;          // -π/2 to π/2
    return { lat, lon };
  };
  
  const myceliumSeeds = [
    imageToSpherical(777, 330),  // Greece (Pin A)
    imageToSpherical(689, 310)   // Barcelona (Pin B)
  ];
  
  // Add fewer random land seeds for cleaner look
  for (let i = 0; i < 6; i++) {
    myceliumSeeds.push({
      lat: (Math.random() - 0.5) * Math.PI * 0.6,  // ±54 degrees (avoid poles)
      lon: (Math.random() - 0.5) * Math.PI * 2     // ±180 degrees
    });
  }
  
  const mycelium = createMyceliumHyphae(1.0, myceliumSeeds, {
    stepSize: 0.008,
    minLength: 120,
    maxLength: 220,
    branchProb: 0.08,
    killRadius: 0.025,
    mergeRadius: 0.015,
    widthBase: 0.010,
    widthNode: 0.016,
    tubeSegments: 6
  });
  
  myceliumVertexCount = mycelium.indices.length;

  globeVAO = gl.createVertexArray();
  gl.bindVertexArray(globeVAO);

  const positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, sphere.positions, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

  const normalBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, sphere.normals, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

  const uvBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, sphere.uvs, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);

  const indexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, sphere.indices, gl.STATIC_DRAW);

  gl.bindVertexArray(null);
  
  myceliumVAO = gl.createVertexArray();
  gl.bindVertexArray(myceliumVAO);
  
  const myceliumPositionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, myceliumPositionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, mycelium.positions, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  
  const myceliumNormalBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, myceliumNormalBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, mycelium.normals, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
  
  const myceliumUvBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, myceliumUvBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, mycelium.uvs, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
  
  const myceliumAgeBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, myceliumAgeBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, mycelium.ages, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 0, 0);
  
  const myceliumIndexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, myceliumIndexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mycelium.indices, gl.STATIC_DRAW);
  
  gl.bindVertexArray(null);
  
  sporeSystem = new SporeSystem(gl, 4000);
  
  const pinGeometry = createPinGeometry(0.02, 1.0, 6);
  workPinSystem = new WorkPinSystem(gl, WORK_LOCATIONS, pinGeometry);
  
  dataStreamSystem = new DataStreamSystem(gl, 500);
  
  moonOrbitSystem = new MoonOrbitSystem(gl, PROJECTS);

  const cameraDistance = isMobile ? 6 : 3.5;
  
  projectionMatrix = mat4.perspective(
    Math.PI / 4,
    canvas.width / canvas.height,
    0.1,
    100.0
  );
  viewMatrix = mat4.lookAt([0, 0, cameraDistance], [0, 0, 0], [0, 1, 0]);
  modelMatrix = mat4.create();

  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);

  let loadedCount = 0;
  const onTextureLoad = () => {
    loadedCount++;
    if (loadedCount === 3) {
      texturesReady = true;
    }
  };

  const textureOptions = {
    mipmap: true,
    maxSize: firefox ? 1024 : 1536,
    anisotropy: firefox ? 2 : 8,
    onLoad: onTextureLoad
  };

  earthTexture = loadTexture(gl, './artifacts/work-page/ominus-earth.webp', {
    ...textureOptions,
    fallbackUrl: './artifacts/work-page/ominus-earth.png'
  });
  
  fogTexture = loadTexture(gl, './artifacts/work-page/ominus-fog-cloud.webp', {
    ...textureOptions,
    fallbackUrl: './artifacts/work-page/ominus-fog-cloud.png'
  });
  
  lightningTexture = loadTexture(gl, './artifacts/work-page/lightning.webp', {
    ...textureOptions,
    fallbackUrl: './artifacts/work-page/lightning.png'
  });

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointerleave', onPointerUp);
  
  let touchStartTime = 0;
  let touchStartPos = { x: 0, y: 0 };
  
  boundTouchStartHandler = (e) => {
    touchStartTime = Date.now();
    const touch = e.touches[0];
    touchStartPos = { x: touch.clientX, y: touch.clientY };
  };
  
  boundTouchEndHandler = (e) => {
    const touchDuration = Date.now() - touchStartTime;
    const touch = e.changedTouches[0];
    const moveDistance = Math.sqrt(
      Math.pow(touch.clientX - touchStartPos.x, 2) + 
      Math.pow(touch.clientY - touchStartPos.y, 2)
    );
    
    // If it's a quick tap (< 200ms) and minimal movement (< 10px), treat as tap
    if (touchDuration < 200 && moveDistance < 10) {
      const tappedPin = checkPinHover(touch.clientX, touch.clientY, true);
      if (!tappedPin) {
        // Tapped elsewhere - close info bubble
        hideLocationInfo();
      }
    }
  };
  
  canvas.addEventListener('touchstart', boundTouchStartHandler, { passive: true });
  canvas.addEventListener('touchend', boundTouchEndHandler, { passive: true });
  
  boundResizeHandler = () => {
    updateMobileState();
    resizeCanvas();
  };
  window.addEventListener('resize', boundResizeHandler);
  
  // Listen for DPR changes dispatched by app.js (event-driven, no polling)
  let lastDPR = currentDPR();
  boundDprHandler = () => {
    const dpr = currentDPR();
    if (dpr !== lastDPR) {
      lastDPR = dpr;
      resizeCanvas();
    }
  };
  window.addEventListener('dpr-changed', boundDprHandler);

  boundVisibilityHandler = () => {
    if (!document.hidden && gl && !animationFrameId) {
      lastFrameTime = 0;
      animationFrameId = requestAnimationFrame(animate);
    }
  };
  document.addEventListener('visibilitychange', boundVisibilityHandler);

  try {
    initAutoWriter();
  } catch (e) {
    console.warn('[Work Globe] Auto-writer init failed:', e);
  }

  animationFrameId = requestAnimationFrame(animate);

}

function render(deltaTime) {
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  // Safeguard against NaN
  if (isNaN(deltaTime) || deltaTime === undefined || deltaTime === null) {
    deltaTime = 0.016; // Default to 60fps
  }

  time += deltaTime * 0.6;
  
  // Additional safeguard - if time becomes NaN, reset it
  if (isNaN(time)) {
    console.warn('[Work Globe] Time became NaN, resetting to 0');
    time = 0;
  }

  if (!isDragging) {
    rotation.y += rotationVelocity.x;
    rotation.x += rotationVelocity.y;

    const rotDecay = Math.pow(0.95, deltaTime * 60);
    rotationVelocity.x *= rotDecay;
    rotationVelocity.y *= rotDecay;

    if (autoRotate && Math.abs(rotationVelocity.x) < 0.001) {
      rotation.y += 0.002;
    }
  }

  rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, rotation.x));

  const rotX = mat4.rotateX(rotation.x);
  const rotY = mat4.rotateY(rotation.y);
  modelMatrix = mat4.multiply(rotY, rotX);

  gl.depthMask(true);
  gl.disable(gl.BLEND);
  
  if (!globeProgram || !globeVAO) {
    console.error('[Render Error] Missing globe resources:', { globeProgram: !!globeProgram, globeVAO: !!globeVAO });
    return;
  }
  
  gl.useProgram(globeProgram);
  gl.bindVertexArray(globeVAO);

  // Use cached uniform locations
  const globeUniforms = uniformCache.globe;
  gl.uniformMatrix4fv(globeUniforms.uProjection, false, projectionMatrix);
  gl.uniformMatrix4fv(globeUniforms.uView, false, viewMatrix);
  gl.uniformMatrix4fv(globeUniforms.uModel, false, modelMatrix);
  gl.uniform1f(globeUniforms.uTime, time);
  
  if (texturesReady && earthTexture) {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, earthTexture);
    gl.uniform1i(globeUniforms.uDaymap, 0);
    gl.uniform1i(globeUniforms.uUseDaymap, 1);
  } else {
    gl.uniform1i(globeUniforms.uUseDaymap, 0);
  }
  
  gl.drawElements(gl.TRIANGLES, sphereVertexCount, gl.UNSIGNED_SHORT, 0);

  // Atmosphere (back-face)
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false); // Don't write depth for atmosphere glow
  
  gl.useProgram(atmosphereProgram);
  gl.cullFace(gl.FRONT);
  gl.enable(gl.CULL_FACE);

  const atmUniforms = uniformCache.atmosphere;
  gl.uniformMatrix4fv(atmUniforms.uProjection, false, projectionMatrix);
  gl.uniformMatrix4fv(atmUniforms.uView, false, viewMatrix);
  gl.uniformMatrix4fv(atmUniforms.uModel, false, modelMatrix);

  gl.drawElements(gl.TRIANGLES, sphereVertexCount, gl.UNSIGNED_SHORT, 0);

  gl.disable(gl.CULL_FACE);
  
  // Mycelium Hyphae - Body Pass
  if (myceliumProgram && myceliumVAO && myceliumVertexCount > 0) {
    myceliumGrowthTime += deltaTime * 50; // Growth speed in units/second (~5-6 seconds to fully reveal)
    
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(false); // Don't write depth - sit on surface
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    
    gl.useProgram(myceliumProgram);
    gl.bindVertexArray(myceliumVAO);
    
    const mycUniforms = uniformCache.mycelium;
    gl.uniformMatrix4fv(mycUniforms.uProjection, false, projectionMatrix);
    gl.uniformMatrix4fv(mycUniforms.uView, false, viewMatrix);
    gl.uniformMatrix4fv(mycUniforms.uModel, false, modelMatrix);
    gl.uniform1f(mycUniforms.uTime, time);
    // Using intro page palette: darker necrotic for body, bright decay-green for highlights
    gl.uniform3f(mycUniforms.uBodyColor, 0.35, 0.50, 0.40); // Darkened necrotic - fibrous mass
    gl.uniform3f(mycUniforms.uCoreColor, 0.247, 1.0, 0.624); // rgb(63, 255, 159) - decay-green glow!
    gl.uniform1f(mycUniforms.uCoreGain, 0.0); // No core in body pass
    gl.uniform1f(mycUniforms.uGrowthTime, myceliumGrowthTime);
    gl.uniform1f(mycUniforms.uOpacityNoise, 0.025); // 2.5% opacity variation
    
    gl.drawElements(gl.TRIANGLES, myceliumVertexCount, gl.UNSIGNED_SHORT, 0);
  }
  
  // Mycelium Core - Additive Pass
  if (myceliumCoreProgram && myceliumVAO && myceliumVertexCount > 0) {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE); // Additive for core glint
    gl.depthMask(false);
    
    gl.useProgram(myceliumCoreProgram);
    gl.bindVertexArray(myceliumVAO);
    
    const coreUniforms = uniformCache.myceliumCore;
    gl.uniformMatrix4fv(coreUniforms.uProjection, false, projectionMatrix);
    gl.uniformMatrix4fv(coreUniforms.uView, false, viewMatrix);
    gl.uniformMatrix4fv(coreUniforms.uModel, false, modelMatrix);
    gl.uniform1f(coreUniforms.uTime, time);
    gl.uniform3f(coreUniforms.uCoreColor, 0.247, 1.0, 0.624); // Decay-green glint - memorable!
    gl.uniform1f(coreUniforms.uCoreGain, 0.15); // Slightly brighter for visibility
    gl.uniform1f(coreUniforms.uGrowthTime, myceliumGrowthTime);
    
    gl.drawElements(gl.TRIANGLES, myceliumVertexCount, gl.UNSIGNED_SHORT, 0);
  }
  
  // Fog Layer
  if (texturesReady && fogTexture) {
    gl.depthMask(false); // Don't write depth
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    
    gl.useProgram(fogProgram);
    gl.bindVertexArray(globeVAO);
    
    // Scale model matrix slightly (1.012x) to sit above surface - reuse pre-allocated array
    const fogScale = 1.012;
    for (let i = 0; i < 16; i++) {
      scaledModelFog[i] = modelMatrix[i];
      if (i === 0 || i === 5 || i === 10) {
        scaledModelFog[i] *= fogScale;
      }
    }
    
    const fogUniforms = uniformCache.fog;
    gl.uniformMatrix4fv(fogUniforms.uProjection, false, projectionMatrix);
    gl.uniformMatrix4fv(fogUniforms.uView, false, viewMatrix);
    gl.uniformMatrix4fv(fogUniforms.uModel, false, scaledModelFog);
    
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, fogTexture);
    gl.uniform1i(fogUniforms.uFogTex, 1);
    
    gl.uniform3f(fogUniforms.uFogTint, 0.15, 0.22, 0.20); // Lighter, more subtle green
    gl.uniform1f(fogUniforms.uFogStrength, 0.20); // Reduced from 0.35 - much more transparent
    gl.uniform2f(fogUniforms.uFogScroll, 0.002, 0.0007);
    gl.uniform1f(fogUniforms.uTime, time);
    
    gl.drawElements(gl.TRIANGLES, sphereVertexCount, gl.UNSIGNED_SHORT, 0);
  }
  
  // Lightning Layer
  if (texturesReady && lightningTexture) {
    gl.depthMask(false); // Don't write depth
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE); // Additive blending
    
    gl.useProgram(lightningProgram);
    gl.bindVertexArray(globeVAO);
    
    // Use same scaled model as fog - reuse pre-allocated array
    const lightningScale = 1.012;
    for (let i = 0; i < 16; i++) {
      scaledModelLightning[i] = modelMatrix[i];
      if (i === 0 || i === 5 || i === 10) {
        scaledModelLightning[i] *= lightningScale;
      }
    }
    
    const lightningUniforms = uniformCache.lightning;
    gl.uniformMatrix4fv(lightningUniforms.uProjection, false, projectionMatrix);
    gl.uniformMatrix4fv(lightningUniforms.uView, false, viewMatrix);
    gl.uniformMatrix4fv(lightningUniforms.uModel, false, scaledModelLightning);
    
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, lightningTexture);
    gl.uniform1i(lightningUniforms.uLightningTex, 2);
    
    gl.uniform3f(lightningUniforms.uLightningColor, 0.35, 0.70, 0.60); // Softer teal
    gl.uniform1f(lightningUniforms.uLightningGain, 0.50); // Reduced from 0.9 - much more subtle
    gl.uniform2f(lightningUniforms.uLightningScroll, 0.005, -0.001);
    gl.uniform1f(lightningUniforms.uTime, time);
    gl.uniform1f(lightningUniforms.uFlickerFreq, 0.5);
    gl.uniform1f(lightningUniforms.uFlickerDuty, 0.04);
    
    gl.drawElements(gl.TRIANGLES, sphereVertexCount, gl.UNSIGNED_SHORT, 0);
  }
  
  if (sporeSystem) {
    const lightningTime = time;
    const slowPulse = Math.sin(lightningTime * 0.5 * 2.0 * Math.PI) * 0.5 + 0.5; // 0.5Hz
    const strobePhase = (lightningTime * 2.0) % 1.0;
    const strobe = strobePhase < 0.04 ? 1.0 : 0.0; // 4% duty cycle
    const lightningIntensity = slowPulse * (0.3 + strobe * 0.7);
    
    sporeSystem.update(deltaTime, lightningIntensity);
  }
  
  if (workPinSystem) {
    workPinSystem.update(deltaTime, time);
    
    if (sporeSystem) {
      const orbitals = workPinSystem.getOrbitalParticles(time);
      if (orbitals.length > 0) {
        sporeSystem.injectOrbitalParticles(orbitals);
      }
    }
  }
  
  if (moonOrbitSystem) {
    moonOrbitSystem.update(deltaTime);
  }
  
  if (sporeProgram && sporeSystem && sporeSystem.activeParticles > 0) {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE); // Additive for glow
    gl.depthMask(false);
    
    gl.useProgram(sporeProgram);
    
    const sporeUniforms = uniformCache.spore;
    gl.uniformMatrix4fv(sporeUniforms.uProjection, false, projectionMatrix);
    gl.uniformMatrix4fv(sporeUniforms.uView, false, viewMatrix);
    gl.uniformMatrix4fv(sporeUniforms.uModel, false, modelMatrix);
    gl.uniform1f(sporeUniforms.uTime, time);
    gl.uniform3f(sporeUniforms.uSporeColor, 0.247, 1.0, 0.624);
    gl.uniform3f(sporeUniforms.uEmberColor, 0.784, 1.0, 0.863); // Ember color #C8FFDC
    
    sporeSystem.render(sporeProgram);
  }
  
  if (pinProgram && workPinSystem) {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
    
    gl.useProgram(pinProgram);
    
    const cameraPos = [0, 0, 3.5];
    workPinSystem.render(pinProgram, projectionMatrix, viewMatrix, modelMatrix, time, cameraPos);
    
    workPinSystem.renderText(textBillboardProgram, projectionMatrix, viewMatrix);
  }
  
  if (moonProgram && moonOrbitSystem) {
    gl.disable(gl.BLEND); // Solid object, no blending needed
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    
    const cameraPos = [0, 0, 3.5];
    moonOrbitSystem.render(moonProgram, projectionMatrix, viewMatrix, modelMatrix, time, cameraPos);
  }
  
  if (dataStreamSystem) {
    dataStreamSystem.update(deltaTime); // Use actual delta time
    
    // Emit streams from hovered pins
    if (workPinSystem && workPinSystem.hoveredPin) {
      const pin = workPinSystem.pins.find(p => p.key === workPinSystem.hoveredPin);
      if (pin) {
        const emitPoint = [
          pin.basePos[0] * 1.15,
          pin.basePos[1] * 1.15,
          pin.basePos[2] * 1.15
        ];
        dataStreamSystem.startEmission(emitPoint, pin.color);
      }
    } else {
      dataStreamSystem.stopEmission();
    }
  }
  
  if (dataStreamProgram && dataStreamSystem && dataStreamSystem.activeParticles > 0) {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.depthMask(false);
    
    gl.useProgram(dataStreamProgram);
    dataStreamSystem.render(dataStreamProgram, projectionMatrix, viewMatrix, modelMatrix, time);
  }
  
  gl.depthMask(true);
  gl.disable(gl.BLEND);
  gl.bindVertexArray(null);
}

function animate(timestamp) {
  if (document.hidden || !canvas?.closest('.active-section')) {
    animationFrameId = null;
    return;
  }
  
  if (lastFrameTime === 0) {
    lastFrameTime = timestamp;
    render(0.016); // First frame uses assumed 60fps
    animationFrameId = requestAnimationFrame(animate);
    return;
  }

  if (WORK_FRAME_INTERVAL_MS && timestamp - lastFrameTime < WORK_FRAME_INTERVAL_MS) {
    animationFrameId = requestAnimationFrame(animate);
    return;
  }

  const deltaTime = Math.min((timestamp - lastFrameTime) / 1000, 0.1); // Cap at 100ms to prevent huge jumps
  lastFrameTime = timestamp;
  
  render(deltaTime);
  animationFrameId = requestAnimationFrame(animate);
}

function onPointerDown(e) {
  isDragging = true;
  autoRotate = false;
  lastPointerPos = { x: e.clientX, y: e.clientY };
  canvas.style.cursor = 'grabbing';
  
  clickStartPos = { x: e.clientX, y: e.clientY };
  clickStartTime = Date.now();
}

function onPointerMove(e) {
  // Don't do hover effects if card is visible
  const infoBubble = document.querySelector('.work-location-info');
  const projectPanel = document.querySelector('.project-panel');
  const cardIsVisible = (infoBubble && infoBubble.classList.contains('visible')) ||
                       (projectPanel && projectPanel.classList.contains('visible'));
  
  let cursorState = 'grab';

  // Check moon hover (even when not dragging) - visual feedback only
  if (moonOrbitSystem && !isDragging && !cardIsVisible && projectionMatrix && viewMatrix && modelMatrix) {
    const rect = canvas.getBoundingClientRect();
    const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    const hoveredMoon = moonOrbitSystem.getMoonAtPosition(ndcX, ndcY, projectionMatrix, viewMatrix, modelMatrix);
    moonOrbitSystem.setHoveredMoon(hoveredMoon);
    if (hoveredMoon) {
      cursorState = 'pointer';
    }
  } else if (moonOrbitSystem) {
    moonOrbitSystem.setHoveredMoon(null);
  }

  // Check pin hover (even when not dragging) - visual feedback only
  if (workPinSystem && !isDragging && !cardIsVisible) {
    const hoveredPin = checkPinHover(e.clientX, e.clientY, false); // Don't show info on hover
    if (hoveredPin) {
      cursorState = 'pointer';
    }
  }

  if (!isDragging) {
    canvas.style.cursor = cursorState;
  }
  
  if (!isDragging) return;

  const deltaX = e.clientX - lastPointerPos.x;
  const deltaY = e.clientY - lastPointerPos.y;

  rotationVelocity.x = deltaX * 0.005;
  rotationVelocity.y = deltaY * 0.005;

  rotation.y += rotationVelocity.x;
  rotation.x += rotationVelocity.y;

  lastPointerPos = { x: e.clientX, y: e.clientY };
}

function isOccludedByGlobe(worldPos, viewMatrix) {
  // Transform world position to view space
  const viewPos = mat4.transformPoint(viewMatrix, worldPos);
  const target = [viewPos[0], viewPos[1], viewPos[2]];

  const rayLength = Math.hypot(target[0], target[1], target[2]);
  if (rayLength === 0) {
    return false;
  }

  // Normalized ray direction from camera (0,0,0 in view space) toward target
  const dir = [target[0] / rayLength, target[1] / rayLength, target[2] / rayLength];

  // Globe centre in view space (camera is at origin)
  const globeViewPos = mat4.transformPoint(viewMatrix, [0, 0, 0]);
  const L = [globeViewPos[0], globeViewPos[1], globeViewPos[2]];

  const radius = 1.0; // Globe radius in world units
  const radiusSq = radius * radius;

  // Project centre-to-camera vector onto ray to find closest approach
  const tca = L[0] * dir[0] + L[1] * dir[1] + L[2] * dir[2];

  // If closest point is behind camera, no occlusion
  if (tca < 0) {
    return false;
  }

  const Lsq = L[0] * L[0] + L[1] * L[1] + L[2] * L[2];
  const dSq = Lsq - tca * tca;

  // Ray misses the sphere
  if (dSq > radiusSq) {
    return false;
  }

  const thc = Math.sqrt(Math.max(radiusSq - dSq, 0));
  const t0 = tca - thc;
  const t1 = tca + thc;

  // Ignore intersections behind the camera
  const nearest = t0 >= 0 ? t0 : t1;
  if (nearest < 0) {
    return false;
  }

  const EPSILON = 0.01;
  return nearest < (rayLength - EPSILON);
}

function checkClickWithDepth(mouseX, mouseY) {
  if (!projectionMatrix || !viewMatrix || !modelMatrix) return null;
  
  // Convert mouse to NDC
  const rect = canvas.getBoundingClientRect();
  const ndcX = ((mouseX - rect.left) / rect.width) * 2 - 1;
  const ndcY = -((mouseY - rect.top) / rect.height) * 2 + 1;
  
  const clickableCandidates = [];
  let occludedCount = 0;
  
  // Check moon(s)
  if (moonOrbitSystem) {
    const moon = moonOrbitSystem.getMoonAtPosition(ndcX, ndcY, projectionMatrix, viewMatrix, modelMatrix);
    if (moon) {
      // Get moon's world position
      const moonWorldPos = moonOrbitSystem.getMoonWorldPosition(moon);
      if (moonWorldPos) {
        // Check if moon is occluded by globe
        const modelPos = mat4.transformPoint(modelMatrix, moonWorldPos);
        const isOccluded = isOccludedByGlobe(modelPos, viewMatrix);
        
        if (isOccluded) {
          occludedCount++;
        } else {
          // Transform to clip space to get depth
          const viewPos = mat4.transformPoint(viewMatrix, modelPos);
          const clipPos = mat4.transformPoint(projectionMatrix, viewPos);
          
          // transformPoint already returns normalized device coordinates
          const depth = clipPos[2];
          
          clickableCandidates.push({
            type: 'moon',
            object: moon,
            depth: depth,
            screenDist: 0 // Moon detection already handles distance
          });
        }
      }
    }
  }
  
  // Check pins with TIGHT click radius
  if (workPinSystem) {
    const CLICK_RADIUS = 0.15; // Increased from 0.08 to make clicking easier
    
    workPinSystem.pins.forEach(pin => {
      // Project pin position to screen space
      const worldPos = [
        pin.basePos[0] * 1.1, // Slightly above surface
        pin.basePos[1] * 1.1,
        pin.basePos[2] * 1.1
      ];
      
      // Manual MVP transform
      const modelPos = mat4.transformPoint(modelMatrix, worldPos);
      
      // Check if pin is occluded by globe
      const isOccluded = isOccludedByGlobe(modelPos, viewMatrix);
      
      if (isOccluded) {
        occludedCount++;
      } else {
        const viewPos = mat4.transformPoint(viewMatrix, modelPos);
        const clipPos = mat4.transformPoint(projectionMatrix, viewPos);
        
        const pinNdcX = clipPos[0];
        const pinNdcY = clipPos[1];
        const depth = clipPos[2];
        
        // Check if behind camera
        if (clipPos[3] < 0) return;
        
        // Distance to mouse in screen space
        const screenDist = Math.sqrt((pinNdcX - ndcX) ** 2 + (pinNdcY - ndcY) ** 2);
        
        if (screenDist < CLICK_RADIUS) {
          clickableCandidates.push({
            type: 'pin',
            object: pin,
            depth: depth,
            screenDist: screenDist
          });
        }
      }
    });
  }
  
  // Sort by depth (closest first) - LOWER depth = closer to camera
  clickableCandidates.sort((a, b) => a.depth - b.depth);
  
  // Return the closest object in 3D space
  if (clickableCandidates.length > 0) {
    const winner = clickableCandidates[0];
    return winner;
  }
  
  return null;
}

function checkPinHover(mouseX, mouseY, showInfo = false) {
  if (!workPinSystem) return null;
  
  // Convert mouse to NDC
  const rect = canvas.getBoundingClientRect();
  const x = ((mouseX - rect.left) / rect.width) * 2 - 1;
  const y = -((mouseY - rect.top) / rect.height) * 2 + 1;
  
  // HOVER radius - more generous than click radius
  let closestPin = null;
  let closestDist = 0.15; // Hover radius in NDC space (15% of screen width)
  
  workPinSystem.pins.forEach(pin => {
    // Project pin position to screen space
    const worldPos = [
      pin.basePos[0] * 1.1, // Slightly above surface
      pin.basePos[1] * 1.1,
      pin.basePos[2] * 1.1
    ];
    
    // Manual MVP transform
    const modelPos = mat4.transformPoint(modelMatrix, worldPos);
    const viewPos = mat4.transformPoint(viewMatrix, modelPos);
    const clipPos = mat4.transformPoint(projectionMatrix, viewPos);
    
    // transformPoint already performed the perspective divide
    const ndcX = clipPos[0];
    const ndcY = clipPos[1];
    
    // Check if behind camera
    if (clipPos[3] < 0) return;
    
    const dist = Math.sqrt((ndcX - x) ** 2 + (ndcY - y) ** 2);
    
    if (dist < closestDist) {
      closestDist = dist;
      closestPin = pin;
    }
  });
  
  workPinSystem.pins.forEach(pin => {
    pin.hovered = (pin === closestPin);
  });
  
  workPinSystem.hoveredPin = closestPin ? closestPin.key : null;
  
  if (showInfo && closestPin) {
    showLocationInfo(closestPin);
  }

  return closestPin;
}

function projectToScreen(worldPos) {
  const modelPos = mat4.transformPoint(modelMatrix, worldPos);
  const viewPos = mat4.transformPoint(viewMatrix, modelPos);
  const clipPos = mat4.transformPoint(projectionMatrix, viewPos);
  
  // transformPoint already returned normalized device coordinates
  const ndcX = clipPos[0];
  const ndcY = clipPos[1];
  
  // Convert from clip space (-1 to 1) to screen space
  const rect = canvas.getBoundingClientRect();
  const x = (ndcX * 0.5 + 0.5) * rect.width + rect.left;
  const y = (1 - (ndcY * 0.5 + 0.5)) * rect.height + rect.top;
  
  return { x, y };
}

function showLocationInfo(pin) {
  let infoBubble = document.querySelector('.work-location-info');
  if (!infoBubble) {
    infoBubble = document.createElement('div');
    infoBubble.className = 'work-location-info';
    document.body.appendChild(infoBubble);
    
    // Add click handler to close when clicking outside (desktop only)
    if (!isMobile) {
      document.addEventListener('click', (e) => {
        const bubble = document.querySelector('.work-location-info');
        if (bubble && bubble.classList.contains('visible')) {
          // Check if click is outside the bubble
          if (!bubble.contains(e.target)) {
            hideLocationInfo();
          }
        }
      });
    }
  }

  const location = WORK_LOCATIONS[pin.key];
  // Country flags instead of generic icons
  const countryFlags = { greece: '🇬🇷', spain: '🇪🇸' };
  const icon = countryFlags[pin.key] || '🏛️';
  
  // Build content with close button (unified style)
  let html = '<button class="close-btn" aria-label="Close">✕</button>';
  
  html += `
    <div class="work-location-header">
      <span class="work-location-icon">${icon}</span>
      ${location.name}
    </div>
  `;

  location.entries.forEach(entry => {
    html += `
      <div class="work-entry">
        <div class="work-company">${entry.company}</div>
        <div class="work-position">${entry.position}</div>
        <div class="work-period">${entry.period}</div>
        <ul class="work-responsibilities">
          ${entry.responsibilities.map(resp => `<li>${resp}</li>`).join('')}
        </ul>
      </div>
    `;
  });

  infoBubble.innerHTML = html;
  
  // Wire up close button (for both desktop and mobile)
  const closeBtn = infoBubble.querySelector('.close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      hideLocationInfo();
    });
  }
  
  // Add mobile-specific class for different positioning
  if (isMobile) {
    infoBubble.classList.add('mobile');
  } else {
    infoBubble.classList.remove('mobile');
  }

  // Position: center on desktop, bottom on mobile
  if (isMobile) {
    infoBubble.style.left = '50%';
    infoBubble.style.top = 'auto';
    infoBubble.style.bottom = '20px';
  } else {
    infoBubble.style.left = '50%';
    infoBubble.style.top = '50%';
    infoBubble.style.bottom = 'auto';
  }
  
  // Show with animation
  requestAnimationFrame(() => {
    infoBubble.classList.add('visible');
  });
}

function hideLocationInfo() {
  const infoBubble = document.querySelector('.work-location-info');
  if (infoBubble) {
    infoBubble.classList.remove('visible');
  }
}

function checkMoonClick(mouseX, mouseY) {
  if (!moonOrbitSystem || !projectionMatrix || !viewMatrix || !modelMatrix) return null;
  
  // Convert mouse to NDC
  const rect = canvas.getBoundingClientRect();
  const ndcX = ((mouseX - rect.left) / rect.width) * 2 - 1;
  const ndcY = -((mouseY - rect.top) / rect.height) * 2 + 1;
  
  // Check if moon was clicked
  const clickedMoon = moonOrbitSystem.getMoonAtPosition(ndcX, ndcY, projectionMatrix, viewMatrix, modelMatrix);
  
  if (clickedMoon) {
    moonOrbitSystem.triggerMoonClick(clickedMoon); // Trigger moth wing click animation
    showProjectPanel(clickedMoon);
    return clickedMoon;
  }
  
  return null;
}

function showProjectPanel(moon) {
  // Hide any existing work location info
  hideLocationInfo();
  
  let projectPanel = document.querySelector('.project-panel');
  if (!projectPanel) {
    projectPanel = document.createElement('div');
    projectPanel.className = 'project-panel necrographic-card';
    document.body.appendChild(projectPanel);
    
    // Add click handler to close when clicking outside (desktop only)
    if (!isMobile) {
      document.addEventListener('click', (e) => {
        const panel = document.querySelector('.project-panel');
        if (panel && panel.classList.contains('visible')) {
          if (!panel.contains(e.target)) {
            hideProjectPanel();
          }
        }
      });
    }
  }
  
  const project = moon.project;
  
  // Build content
  let html = '<button class="close-btn" aria-label="Close">✕</button>';
  
  html += `
    <div class="project-header">
      <h3>${project.name}</h3>
    </div>
    <p class="project-description">${project.description}</p>
    <div class="tech-badges">
      ${project.tech.map(t => `<span class="tech-badge">${t}</span>`).join('')}
    </div>
    <a href="${project.github}" class="github-link" target="_blank" rel="noopener noreferrer">
      View on GitHub →
    </a>
  `;
  
  projectPanel.innerHTML = html;
  
  // Wire up close button
  const closeBtn = projectPanel.querySelector('.close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      hideProjectPanel();
    });
  }
  
  // Pause moon orbit
  moonOrbitSystem.pauseMoon(moon, true);
  
  // Add mobile-specific class
  if (isMobile) {
    projectPanel.classList.add('mobile');
  } else {
    projectPanel.classList.remove('mobile');
  }
  
  // Position
  if (isMobile) {
    projectPanel.style.left = '50%';
    projectPanel.style.top = 'auto';
    projectPanel.style.bottom = '20px';
  } else {
    projectPanel.style.left = '50%';
    projectPanel.style.top = '50%';
    projectPanel.style.bottom = 'auto';
  }
  
  // Clear any inline transform so CSS classes control it
  projectPanel.style.transform = '';
  projectPanel.style.position = 'fixed'; // Ensure fixed positioning
  
  // Show with animation
  requestAnimationFrame(() => {
    projectPanel.classList.add('visible');
  });
}

function hideProjectPanel() {
  const projectPanel = document.querySelector('.project-panel');
  if (projectPanel) {
    projectPanel.classList.remove('visible');
    
    // Resume moon orbit
    if (moonOrbitSystem) {
      moonOrbitSystem.pauseAll(false);
    }
  }
}

// Make hideProjectPanel available globally for the close button
window.hideProjectPanel = hideProjectPanel;

function onPointerUp(e) {
  const wasDragging = isDragging;
  isDragging = false;
  canvas.style.cursor = 'grab';
  
  // Calculate if this was a click or a drag
  if (clickStartTime) {
    const clickDuration = Date.now() - clickStartTime;
    const moveDistance = Math.sqrt(
      Math.pow(e.clientX - clickStartPos.x, 2) + 
      Math.pow(e.clientY - clickStartPos.y, 2)
    );
    
    // If it's a quick click (< 200ms) and minimal movement (< 10px), treat as click
    const isClick = clickDuration < 200 && moveDistance < 10;
    
    if (isClick) {
      // Don't check if any card/panel is visible
      const infoBubble = document.querySelector('.work-location-info');
      const projectPanel = document.querySelector('.project-panel');
      const cardIsVisible = (infoBubble && infoBubble.classList.contains('visible')) || 
                           (projectPanel && projectPanel.classList.contains('visible'));
      
      if (!cardIsVisible) {
        // Check ALL clickable objects and select the closest one in 3D space
        const clickResult = checkClickWithDepth(e.clientX, e.clientY);
        
        if (clickResult) {
          if (clickResult.type === 'moon') {
            showProjectPanel(clickResult.object);
          } else if (clickResult.type === 'pin') {
            showLocationInfo(clickResult.object);
          }
        }
      }
    }
  }
  
  clickStartTime = 0;
  
  // Re-enable auto-rotate after 3 seconds of no interaction
  setTimeout(() => {
    if (!isDragging && Math.abs(rotationVelocity.x) < 0.001) {
      autoRotate = true;
    }
  }, 3000);
}

// Dynamic DPR helper (updates on zoom/display change)
function currentDPR() {
  return cappedDpr(1.5);
}

function resizeCanvas() {
  updateMobileState();
  const container = canvas.parentElement;
  const width = container.clientWidth;
  const height = container.clientHeight;
  
  // Check if container has valid dimensions
  if (width === 0 || height === 0) {
    console.warn(`[Work Globe] Container has invalid dimensions: ${width}×${height} - skipping resize`);
    // Retry after a short delay
    setTimeout(() => {
      if (canvas && canvas.parentElement) {
        resizeCanvas();
      }
    }, 100);
    return;
  }
  
  const dpr = currentDPR(); // Dynamic DPR

  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';

  if (gl) {
    gl.viewport(0, 0, canvas.width, canvas.height);
    projectionMatrix = mat4.perspective(
      Math.PI / 4,
      width / height,
      0.1,
      100.0
    );
  }
}

function cleanupWorkGlobe() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  
  // Clear the DPR check interval
  if (dprCheckIntervalId) {
    clearInterval(dprCheckIntervalId);
    dprCheckIntervalId = null;
  }

  if (gl) {
    // Delete all programs
    if (globeProgram) gl.deleteProgram(globeProgram);
    if (atmosphereProgram) gl.deleteProgram(atmosphereProgram);
    if (fogProgram) gl.deleteProgram(fogProgram);
    if (lightningProgram) gl.deleteProgram(lightningProgram);
    if (myceliumProgram) gl.deleteProgram(myceliumProgram);
    if (myceliumCoreProgram) gl.deleteProgram(myceliumCoreProgram);
    if (sporeProgram) gl.deleteProgram(sporeProgram);
    if (pinProgram) gl.deleteProgram(pinProgram);
    if (dataStreamProgram) gl.deleteProgram(dataStreamProgram);
    if (textBillboardProgram) gl.deleteProgram(textBillboardProgram);
    if (moonProgram) gl.deleteProgram(moonProgram);
    
    // Delete VAOs
    if (globeVAO) gl.deleteVertexArray(globeVAO);
    if (myceliumVAO) gl.deleteVertexArray(myceliumVAO);
    
    // Delete textures
    if (earthTexture) gl.deleteTexture(earthTexture);
    if (fogTexture) gl.deleteTexture(fogTexture);
    if (lightningTexture) gl.deleteTexture(lightningTexture);
  }

  // Remove event listeners using stored references
  if (canvas) {
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointerleave', onPointerUp);
    if (boundTouchStartHandler) canvas.removeEventListener('touchstart', boundTouchStartHandler);
    if (boundTouchEndHandler) canvas.removeEventListener('touchend', boundTouchEndHandler);
  }
  if (boundResizeHandler) {
    window.removeEventListener('resize', boundResizeHandler);
  }
  if (boundDprHandler) {
    window.removeEventListener('dpr-changed', boundDprHandler);
  }
  if (boundVisibilityHandler) {
    document.removeEventListener('visibilitychange', boundVisibilityHandler);
  }
  
  hideLocationInfo();
  hideProjectPanel();
  
  const infoBubble = document.querySelector('.work-location-info');
  if (infoBubble) {
    infoBubble.remove();
  }
  const projectPanel = document.querySelector('.project-panel');
  if (projectPanel) {
    projectPanel.remove();
  }

  // Reset all module-level state so re-init works correctly
  gl = null;
  canvas = null;
  globeProgram = null;
  atmosphereProgram = null;
  fogProgram = null;
  lightningProgram = null;
  myceliumProgram = null;
  myceliumCoreProgram = null;
  sporeProgram = null;
  pinProgram = null;
  dataStreamProgram = null;
  textBillboardProgram = null;
  moonProgram = null;
  globeVAO = null;
  sphereVertexCount = 0;
  myceliumVAO = null;
  myceliumVertexCount = 0;
  myceliumGrowthTime = 0;
  sporeSystem = null;
  workPinSystem = null;
  dataStreamSystem = null;
  moonOrbitSystem = null;
  earthTexture = null;
  fogTexture = null;
  lightningTexture = null;
  texturesReady = false;
  rotation = { x: 0, y: 0 };
  rotationVelocity = { x: 0, y: 0 };
  isDragging = false;
  autoRotate = true;
  time = 0;
  lastFrameTime = 0;
  uniformCache = {};
  boundResizeHandler = null;
  boundTouchStartHandler = null;
  boundTouchEndHandler = null;
  boundDprHandler = null;
  boundVisibilityHandler = null;
}

function autoInit() {
  const workSection = document.getElementById('work');
  if (!workSection) {
    console.warn('[Work Globe] Work section not found, skipping auto-init');
    return;
  }

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
        const hasActiveClass = workSection.classList.contains('active-section');
        
        if (hasActiveClass && !gl) {
          // Section just became active and globe not initialized
          initWorkGlobe();
        } else if (!hasActiveClass && gl) {
          // Section just became inactive and globe is initialized
          cleanupWorkGlobe();
        }
      }
    });
  });

  observer.observe(workSection, { attributes: true });
  
  const initiallyActive = workSection.classList.contains('active-section');
  
  if (initiallyActive) {
    initWorkGlobe();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', autoInit);
} else {
  autoInit();
}

function initAutoWriter() {
  const writer = document.querySelector('.work-auto-writer .writer-line');
  const iconZone = document.querySelector('.work-auto-writer .writer-icon-zone');
  if (!writer) return;

  const messages = [
    {
      text: "MEMORANDUM DECRYPTED",
      icon: ""
    },
    {
      text: "LOCATION CONES\nClick green spires",
      icon: "icon-cone"
    },
    {
      text: "PROJECT MOONS\nClick orbiting moons",
      icon: "icon-moon"
    },
    {
      text: "TAP NODES TO ACCESS",
      icon: ""
    }
  ];
  
  let msgIndex = 0;
  let charIndex = 0;
  let isDeleting = false;
  let typeSpeed = 60;
  
  function type() {
    const currentMsg = messages[msgIndex];
    
    if (iconZone) {
      iconZone.innerHTML = currentMsg.icon ? `<div class="${currentMsg.icon}"></div>` : '';
    }

    if (isDeleting) {
      writer.textContent = currentMsg.text.substring(0, charIndex - 1);
      charIndex--;
      typeSpeed = 30;
    } else {
      writer.textContent = currentMsg.text.substring(0, charIndex + 1);
      charIndex++;
      typeSpeed = 60;
    }
    
    if (!isDeleting && charIndex === currentMsg.text.length) {
      isDeleting = true;
      typeSpeed = 2500; // Pause at end
    } else if (isDeleting && charIndex === 0) {
      isDeleting = false;
      msgIndex = (msgIndex + 1) % messages.length;
      typeSpeed = 500; // Pause before next
    }
    
    setTimeout(type, typeSpeed);
  }
  
  type();
}
