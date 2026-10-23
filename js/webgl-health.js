import { readRendererCategory } from './graphics-governor.js';

const FALLBACK_TEXT = {
  unavailable: 'Graphics are reduced on this browser/device for smoothness. The content remains available. Use Chrome or Edge with hardware acceleration for the full WebGL scene, or try Rich/Full if your device can handle it.',
  'performance-caveat': 'Graphics are reduced on this browser/device for smoothness. The browser reported that the full WebGL scene may be slow here. Use Chrome or Edge with hardware acceleration for the full scene, or try Rich/Full if your device can handle it.',
  'context-lost': 'Graphics are reduced because the WebGL context was interrupted. The content remains available. Reload or switch graphics modes if you want to try the scene again.'
};

// Whether WebGL2 exists at all here, and on what kind of renderer, read from a throwaway canvas.
function probeWebGL2(options = {}) {
  const probe = document.createElement('canvas');
  try {
    const gl = probe.getContext('webgl2', {
      ...options,
      failIfMajorPerformanceCaveat: false
    });
    const rendererCategory = gl ? readRendererCategory(gl) : 'unknown';
    gl?.getExtension?.('WEBGL_lose_context')?.loseContext?.();
    return { available: Boolean(gl), rendererCategory };
  } catch {
    return { available: false, rendererCategory: 'unknown' };
  } finally {
    probe.width = 1;
    probe.height = 1;
  }
}

function getWebGL2Context(canvas, options) {
  try {
    return canvas.getContext('webgl2', options);
  } catch {
    return null;
  }
}

export function showWebGLFallback(canvas, reason = 'unavailable') {
  if (!canvas?.parentNode) return;
  const existing = canvas.parentNode.querySelector(`[data-webgl-fallback-for="${canvas.id}"]`);
  existing?.remove();

  canvas.style.display = 'none';
  const fallback = document.createElement('div');
  fallback.className = 'webgl-fallback-visible';
  fallback.dataset.webglFallbackFor = canvas.id;
  fallback.setAttribute('role', 'status');
  fallback.textContent = FALLBACK_TEXT[reason] || FALLBACK_TEXT.unavailable;
  canvas.parentNode.insertBefore(fallback, canvas.nextSibling);
}

function restoreWebGLCanvas(canvas) {
  if (!canvas?.parentNode) return;
  const existing = canvas.parentNode.querySelector(`[data-webgl-fallback-for="${canvas.id}"]`);
  existing?.remove();
  canvas.style.display = '';
}

export function requestProtectedWebGL2Context(canvas, options = {}) {
  restoreWebGLCanvas(canvas);

  const gl = getWebGL2Context(canvas, { ...options, failIfMajorPerformanceCaveat: true });
  if (gl) return { gl, reason: null };

  const probe = probeWebGL2(options);
  if (!probe.available) return { gl: null, reason: 'unavailable' };
  // Chrome also reports the caveat on some capable GPUs, Macs among them. A refused context binds
  // nothing to the canvas, so a real GPU retries without the flag and the governor sets the tier.
  // Only a software renderer keeps the reduced fallback.
  if (probe.rendererCategory === 'software') return { gl: null, reason: 'performance-caveat' };
  const retried = getWebGL2Context(canvas, { ...options, failIfMajorPerformanceCaveat: false });
  return retried
    ? { gl: retried, reason: null }
    : { gl: null, reason: 'performance-caveat' };
}

export function installWebGLContextHealth(canvas, { onLost, onRestored } = {}) {
  const handleContextLost = (event) => {
    event.preventDefault();
    onLost?.(event);
    showWebGLFallback(canvas, 'context-lost');
  };

  const handleContextRestored = (event) => {
    restoreWebGLCanvas(canvas);
    onRestored?.(event);
  };

  canvas.addEventListener('webglcontextlost', handleContextLost);
  canvas.addEventListener('webglcontextrestored', handleContextRestored);

  return () => {
    canvas.removeEventListener('webglcontextlost', handleContextLost);
    canvas.removeEventListener('webglcontextrestored', handleContextRestored);
  };
}
