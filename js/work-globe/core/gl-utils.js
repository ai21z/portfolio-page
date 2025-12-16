export function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('Shader compile error:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }

  return shader;
}

export function createProgram(gl, vertexSource, fragmentSource, attribLocations = {}) {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);

  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  
  // Bind attribute locations before linking
  if (attribLocations.position !== undefined) {
    gl.bindAttribLocation(program, attribLocations.position, 'position');
  }
  if (attribLocations.normal !== undefined) {
    gl.bindAttribLocation(program, attribLocations.normal, 'normal');
  }
  if (attribLocations.uv !== undefined) {
    gl.bindAttribLocation(program, attribLocations.uv, 'uv');
  }
  
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Program link error:', gl.getProgramInfoLog(program));
    return null;
  }

  return program;
}

export function loadTexture(gl, url, options = {}) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  
  // Placeholder pixel while loading
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
    new Uint8Array([0, 0, 0, 255]));
  
  const image = new Image();
  image.onload = () => {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    
    // Don't flip Y - we handle orientation in UV generation
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, 
      options.mipmap !== false ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    
    // S repeats, T clamps to avoid pole artifacts
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    
    // Generate mipmaps
    if (options.mipmap !== false) {
      gl.generateMipmap(gl.TEXTURE_2D);
    }
    
    const ext = gl.getExtension('EXT_texture_filter_anisotropic');
    if (ext) {
      const maxAniso = gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
      gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, 
        Math.min(8, maxAniso));
    }
    
    if (options.onLoad) {
      options.onLoad();
    }
  };
  
  image.onerror = () => {
    console.error(`Failed to load texture: ${url}`);
  };
  
  image.src = url;
  return texture;
}
