const FALLBACK_TEXT = {
  unavailable: 'Graphics are reduced on this browser/device for smoothness. The content remains available. Use Chrome or Edge with hardware acceleration for the full WebGL scene, or try Rich/Full if your device can handle it.',
  'performance-caveat': 'Graphics are reduced on this browser/device for smoothness. The browser reported that the full WebGL scene may be slow here. Use Chrome or Edge with hardware acceleration for the full scene, or try Rich/Full if your device can handle it.',
  'context-lost': 'Graphics are reduced because the WebGL context was interrupted. The content remains available; reload or switch graphics modes if you want to try the scene again.'
};

function probeWebGL2Availability(options = {}) {
  const probe = document.createElement('canvas');
  try {
    const gl = probe.getContext('webgl2', {
      ...options,
      failIfMajorPerformanceCaveat: false
    });
    gl?.getExtension?.('WEBGL_lose_context')?.loseContext?.();
    return Boolean(gl);
  } catch {
    return false;
  } finally {
    probe.width = 1;
    probe.height = 1;
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

export function restoreWebGLCanvas(canvas) {
  if (!canvas?.parentNode) return;
  const existing = canvas.parentNode.querySelector(`[data-webgl-fallback-for="${canvas.id}"]`);
  existing?.remove();
  canvas.style.display = '';
}

export function requestProtectedWebGL2Context(canvas, options = {}) {
  restoreWebGLCanvas(canvas);

  let gl = null;
  try {
    gl = canvas.getContext('webgl2', {
      ...options,
      failIfMajorPerformanceCaveat: true
    });
  } catch {
    gl = null;
  }

  if (gl) return { gl, reason: null };

  const webgl2Available = probeWebGL2Availability(options);
  return {
    gl: null,
    reason: webgl2Available ? 'performance-caveat' : 'unavailable'
  };
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
