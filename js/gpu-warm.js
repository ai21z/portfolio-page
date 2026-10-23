// Links a section's shader programs once in a throwaway WebGL context during idle time. Chromium
// keeps linked programs in a cache that every context on the page shares, so when the section
// later links the same programs, the link is quick instead of a long frame.
//
// Nothing here waits on the GPU: shaders compile in parallel (KHR_parallel_shader_compile) and the
// context is released once every program reports done. Without that extension, or on a software
// renderer, it does nothing, since the wait would block the page.
export function warmPrograms(specs, bindAttribs = () => {}) {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    let gl = null;
    try {
      gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: true });
    } catch {
      gl = null;
    }
    const parallel = gl && gl.getExtension('KHR_parallel_shader_compile');
    const release = () => gl?.getExtension('WEBGL_lose_context')?.loseContext();
    if (!parallel) {
      release();
      resolve(false);
      return;
    }
    const programs = specs.map(({ vs, fs, attribs }) => {
      const program = gl.createProgram();
      for (const [type, source] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        gl.attachShader(program, shader);
      }
      bindAttribs(gl, program, attribs || {});
      gl.linkProgram(program);
      return program;
    });
    const started = performance.now();
    const poll = () => {
      // Done, or given up on after 10 s: either way the context is released.
      if (programs.every((program) => gl.getProgramParameter(program, parallel.COMPLETION_STATUS_KHR)) ||
          performance.now() - started > 10000) {
        release();
        resolve(true);
        return;
      }
      setTimeout(poll, 50);
    };
    poll();
  });
}
