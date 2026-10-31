import { createD20Geometry, createTalosGeometry } from '../core/moon-solids.js';
import { mat4 } from '../core/math-utils.js';
import { isCompact } from '../../compact.js';

// Each project's solid, and how large it is drawn against its moon radius. The d20's faces sit inside
// its unit vertices, so it is drawn a little larger. The helmet is drawn a little larger again, so its slits stay open at a glance.
const SHAPES = {
  d20: { create: createD20Geometry, scale: 1.2 },
  talos: { create: createTalosGeometry, scale: 1.1 }
};
// The d20 tumbles about a tilted axis and settles face on when its project is chosen. The helmet sways
// to show its depth and turns to face the viewer when chosen. Hovered, either holds where it is.
const D20_SPIN = 0.35;                       // radians per second
const D20_AXIS = normalize3([0.4, 1.0, 0.25]);
const TALOS_SWAY = 0.35;                     // radians either side of facing the viewer
const TALOS_SWAY_SPEED = 0.4;                // radians of its phase per second

function normalize3(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

// A rotation of angle a about the unit axis k, as a column-major 3x3.
function axisRotation(k, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const t = 1 - c;
  const [x, y, z] = k;
  return [
    t * x * x + c, t * x * y + s * z, t * x * z - s * y,
    t * x * y - s * z, t * y * y + c, t * y * z + s * x,
    t * x * z + s * y, t * y * z - s * x, t * z * z + c
  ];
}

function multiply3(a, b) {
  const out = new Array(9);
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 3; row++) {
      out[col * 3 + row] = a[row] * b[col * 3] + a[3 + row] * b[col * 3 + 1] + a[6 + row] * b[col * 3 + 2];
    }
  }
  return out;
}

// The d20 at rest shows one face to the viewer: the face round (phi, 0, 2 phi + 1) turned onto +z.
const PHI = (1 + Math.sqrt(5)) / 2;
const D20_REST = axisRotation([0, 1, 0], -Math.atan2(PHI, 2 * PHI + 1));

export class MoonOrbitSystem {
  constructor(gl, projects) {
    this.gl = gl;
    this.moons = [];
    this._uniformsCache = null;
    this._moonModelMatrix = new Float32Array(16); // Pre-allocated, reused per moon
    this.shapes = {};

    projects.forEach(project => {
      if (!this.shapes[project.shape]) this.shapes[project.shape] = this.createShape(SHAPES[project.shape]);
      this.moons.push({
        project: project,
        shape: project.shape,
        angle: project.initialAngle, // Current angle in degrees
        orbitRadius: project.orbitRadius,
        rotationSpeed: project.rotationSpeed,
        orbitTilt: project.orbitTilt,
        moonRadius: project.moonRadius,
        color: project.color,
        paused: false,
        hovered: false,
        scale: 1.0,
        targetScale: 1.0,
        hoverAmount: 0.0,
        targetHoverAmount: 0.0,
        spin: 0.0,   // the d20's turn about its axis, or the helmet's sway phase
        sway: 1.0    // how far the helmet sways, eased to 0 when chosen
      });
    });
  }

  createShape({ create, scale }) {
    const gl = this.gl;
    const geometry = create();
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    [[geometry.positions, 3], [geometry.normals, 3], [geometry.edges, 4], [geometry.tints, 3]].forEach(([data, size], location) => {
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(location); // position, normal, edge, tint
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    });
    gl.bindVertexArray(null);
    return { vao, vertexCount: geometry.vertexCount, scale };
  }

  // Held still (reduced motion), the moons keep their hover response, taken at once instead of eased,
  // drop the compact pulse, which runs on the wall clock, and neither turn nor sway.
  update(dt, still = false) {
    const isMobile = isCompact();
    const ease = (k) => (still ? 1 : k);

    this.moons.forEach(moon => {
      if (!moon.paused) {
        moon.angle += moon.rotationSpeed * dt;
        if (moon.angle > 360) moon.angle -= 360;
      }

      if (still) {
        moon.spin = 0;
      } else if (moon.shape === 'd20') {
        if (!moon.paused && !moon.hovered) {
          moon.spin += D20_SPIN * dt;
        } else if (moon.paused) {
          // Settle on the next whole turn, where the d20 shows its rest face.
          const rest = Math.ceil(moon.spin / (2 * Math.PI) - 1e-3) * 2 * Math.PI;
          moon.spin += (rest - moon.spin) * Math.min(1, 3 * dt);
        }
      } else if (!moon.paused && !moon.hovered) {
        moon.spin += TALOS_SWAY_SPEED * dt;
      }
      moon.sway += ((moon.paused || still ? 0 : 1) - moon.sway) * ease(Math.min(1, 3 * dt));

      let targetScale = moon.targetScale;

      if (isMobile && !still && Math.abs(moon.targetScale - 1.0) < 0.01) {
         const pulse = Math.sin(Date.now() / 1000 * 3) * 0.5 + 0.5;
         targetScale = 1.0 + pulse * 0.15;
      }

      const scaleDiff = targetScale - moon.scale;
      if (Math.abs(scaleDiff) < 0.001) {
        moon.scale = targetScale;
      } else {
        moon.scale += scaleDiff * ease(0.12);
      }

      const hoverDiff = moon.targetHoverAmount - moon.hoverAmount;
      if (Math.abs(hoverDiff) < 0.001) {
        moon.hoverAmount = moon.targetHoverAmount;
      } else {
        moon.hoverAmount += hoverDiff * ease(0.15);
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

  // The moon's turn in the world: the d20 about its axis from its rest face, the helmet about the vertical.
  getOrientation(moon) {
    if (moon.shape === 'd20') return multiply3(axisRotation(D20_AXIS, moon.spin), D20_REST);
    return axisRotation([0, 1, 0], TALOS_SWAY * moon.sway * Math.sin(moon.spin));
  }

  _cacheUniforms(program) {
    const gl = this.gl;
    this._uniformsCache = {
      uProjection: gl.getUniformLocation(program, 'uProjection'),
      uView: gl.getUniformLocation(program, 'uView'),
      uCameraPos: gl.getUniformLocation(program, 'uCameraPos'),
      uModel: gl.getUniformLocation(program, 'uModel'),
      uMoonColor: gl.getUniformLocation(program, 'uMoonColor'),
      uHoverAmount: gl.getUniformLocation(program, 'uHoverAmount'),
    };
  }

  render(program, projMatrix, viewMatrix, modelMatrix, time, cameraPos) {
    if (this.moons.length === 0) return;

    const gl = this.gl;
    gl.useProgram(program);

    if (!this._uniformsCache) this._cacheUniforms(program);
    const u = this._uniformsCache;

    gl.uniformMatrix4fv(u.uProjection, false, projMatrix);
    gl.uniformMatrix4fv(u.uView, false, viewMatrix);
    gl.uniform3fv(u.uCameraPos, cameraPos);

    const m = this._moonModelMatrix;

    this.moons.forEach(moon => {
      const shape = this.shapes[moon.shape];
      const worldPos = this.getWorldPosition(moon);

      const scale = moon.moonRadius * moon.scale * shape.scale;

      const rotatedPos = modelMatrix
        ? mat4.transformPoint(modelMatrix, worldPos)
        : [...worldPos, 1];

      // Reuse pre-allocated matrix: the moon's turn, scaled, at its place.
      const r = this.getOrientation(moon);
      m[0] = r[0] * scale; m[1] = r[1] * scale; m[2] = r[2] * scale; m[3] = 0;
      m[4] = r[3] * scale; m[5] = r[4] * scale; m[6] = r[5] * scale; m[7] = 0;
      m[8] = r[6] * scale; m[9] = r[7] * scale; m[10] = r[8] * scale; m[11] = 0;
      m[12] = rotatedPos[0]; m[13] = rotatedPos[1]; m[14] = rotatedPos[2]; m[15] = 1;

      gl.uniformMatrix4fv(u.uModel, false, m);
      gl.uniform3fv(u.uMoonColor, moon.color);

      gl.uniform1f(u.uHoverAmount, moon.hoverAmount);

      gl.bindVertexArray(shape.vao);
      gl.drawArrays(gl.TRIANGLES, 0, shape.vertexCount);
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
    });
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
