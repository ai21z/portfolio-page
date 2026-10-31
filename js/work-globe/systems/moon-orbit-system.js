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
// A chosen moon leaves its orbit for a dock beside the globe, on the side clear of the timeline and its
// card, a little above the centre and in front of the globe's middle. On a screen too narrow for that,
// the dock is above the globe instead.
const DOCK_DEPTH = 0.3;       // toward the camera from the globe's centre, in globe radii
const DOCK_RAISE = 0.12;      // above the centre, in clip space
const DOCK_CLEAR = 0.2;       // the least clip-space gap from the globe's limb
const DOCK_EDGE = 0.86;       // where the page's nav begins at the right, in clip space
const DOCK_SPEED = 2.5;       // per second, the eased share of the way to the dock
const DOCK_CLEARANCE = 1.22;  // the radius a docking moon keeps from the globe's centre on its way
// Docked, the moon's face is aimed between the camera and the light, so it is seen nearly square and lit.
// Keep this light aligned with moon-shaders.js.
const LIGHT_DIR = normalize3([0.5, 0.3, 0.5]);
const DOCK_LIGHT_LEAN = 0.5;  // how far the docked face leans from the camera toward the light

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
        sway: 1.0,   // how far the helmet sways, eased to 0 when chosen
        docked: false,
        dock: 0.0    // the eased way from its orbit to its dock, 0 to 1
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
      const dockDiff = (moon.docked ? 1 : 0) - moon.dock;
      moon.dock = Math.abs(dockDiff) < 0.001 ? (moon.docked ? 1 : 0) : moon.dock + dockDiff * ease(Math.min(1, DOCK_SPEED * dt));

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

  // Where the moon is drawn: on its orbit as the globe carries it, or on its way to or at its dock. On the
  // way it keeps clear of the globe, so it passes round it and never through it.
  getScenePosition(moon, modelMatrix) {
    const worldPos = this.getWorldPosition(moon);
    const orbit = modelMatrix ? mat4.transformPoint(modelMatrix, worldPos) : worldPos;
    if (moon.dock <= 0 || !this.dockPos) return [orbit[0], orbit[1], orbit[2]];
    const t = moon.dock * moon.dock * (3 - 2 * moon.dock);
    const p = [0, 1, 2].map((k) => orbit[k] + (this.dockPos[k] - orbit[k]) * t);
    const r = Math.hypot(p[0], p[1], p[2]);
    return r < DOCK_CLEARANCE && r > 1e-6 ? p.map((v) => (v * DOCK_CLEARANCE) / r) : p;
  }

  // The dock for this projection, set beside the globe's limb as the camera sees it.
  updateDock(projMatrix, cameraPos) {
    const d = cameraPos[2];
    const depth = d - DOCK_DEPTH;
    const limbX = projMatrix[0] / Math.sqrt(d * d - 1);
    const limbY = projMatrix[5] / Math.sqrt(d * d - 1);
    let ndcX = Math.max(limbX + DOCK_CLEAR, (limbX + DOCK_EDGE) / 2);
    let ndcY = DOCK_RAISE;
    if (ndcX > DOCK_EDGE - 0.06) {
      ndcX = Math.min(limbX * 0.6, 0.6);
      ndcY = Math.min(limbY + DOCK_CLEAR, 0.82);
    }
    this.dockPos = [ndcX * depth / projMatrix[0], ndcY * depth / projMatrix[5], DOCK_DEPTH];
  }

  // The moon's turn in the world: the d20 about its axis from its rest face, the helmet about the vertical.
  // Docked, either is turned to face between the camera and the light, so its face is seen lit beside the globe.
  getOrientation(moon, position, cameraPos) {
    const own = moon.shape === 'd20'
      ? multiply3(axisRotation(D20_AXIS, moon.spin), D20_REST)
      : axisRotation([0, 1, 0], TALOS_SWAY * moon.sway * Math.sin(moon.spin));
    if (moon.dock <= 0) return own;
    const t = moon.dock * moon.dock * (3 - 2 * moon.dock);
    const view = normalize3([cameraPos[0] - position[0], cameraPos[1] - position[1], cameraPos[2] - position[2]]);
    // The lean is level, so the face turns toward the light without tipping up and foreshortening.
    const to = [view[0] + LIGHT_DIR[0] * DOCK_LIGHT_LEAN, view[1], view[2] + LIGHT_DIR[2] * DOCK_LIGHT_LEAN];
    const yaw = Math.atan2(to[0], to[2]) * t;
    const pitch = Math.atan2(to[1], Math.hypot(to[0], to[2])) * t;
    return multiply3(axisRotation([0, 1, 0], yaw), multiply3(axisRotation([1, 0, 0], -pitch), own));
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
    this.updateDock(projMatrix, cameraPos);

    const m = this._moonModelMatrix;

    this.moons.forEach(moon => {
      const shape = this.shapes[moon.shape];
      const scale = moon.moonRadius * moon.scale * shape.scale;
      const rotatedPos = this.getScenePosition(moon, modelMatrix);

      // Reuse pre-allocated matrix: the moon's turn, scaled, at its place.
      const r = this.getOrientation(moon, rotatedPos, cameraPos);
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
      const modelPos = this.getScenePosition(moon, modelMatrix);
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

  pauseMoon(moon, paused) {
    if (moon) {
      moon.paused = paused;
    }
  }

  // Released, every moon also leaves its dock for its orbit.
  pauseAll(paused) {
    this.moons.forEach(moon => {
      moon.paused = paused;
      if (!paused) moon.docked = false;
    });
  }

  // Sends the chosen moon to its dock and any other back to its orbit.
  dockMoon(moon) {
    this.moons.forEach(m => {
      m.docked = (m === moon);
    });
  }
}
