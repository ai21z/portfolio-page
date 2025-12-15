// ━━━ Viewport & Cover Transform Module ━━━
// Handles screen-to-image coordinate mapping and viewport projection

import { COVER, bgImg } from './state.js';

/**
 * Computes the "cover" transform to fit background image to viewport.
 * Updates COVER object with scale (s), offsets (dx, dy), and dimensions (baseW, baseH).
 * @returns {boolean} - true if successful, false if image not ready
 */
export function computeCoverFromImage() {
  const vv = window.visualViewport;
  const vw = window.innerWidth;
  const vh = vv ? Math.round(vv.height) : window.innerHeight;
  // MUST use naturalWidth/naturalHeight from loaded image
  const W = bgImg ? bgImg.naturalWidth : 0;
  const H = bgImg ? bgImg.naturalHeight : 0;
  
  if (!W || !H) {
    console.warn('⚠️ Cover: Image not ready yet, dimensions unavailable');
    return false;
  }
  
  const s = Math.max(vw / W, vh / H);
  COVER.s = s;
  COVER.dx = (vw - W * s) * 0.5;
  COVER.dy = (vh - H * s) * 0.5;
  COVER.baseW = W; 
  COVER.baseH = H;
  COVER.ready = true;
  
  return true;
}

/**
 * Maps image coordinates to viewport coordinates using the cover transform.
 * SINGLE coverMap function used everywhere (labels, sparks, follower lightning, HUD)
 * @param {number} x - Image x coordinate
 * @param {number} y - Image y coordinate
 * @returns {Array<number>} - [viewportX, viewportY]
 */
export function coverMap(x, y) { 
  return [ x * COVER.s + COVER.dx, y * COVER.s + COVER.dy ]; 
}

/**
 * Alias for coverMap - for backward compatibility.
 * @param {number} x - Image x coordinate
 * @param {number} y - Image y coordinate
 * @returns {Array<number>} - [viewportX, viewportY]
 */
export function toViewport(x, y) { 
  return coverMap(x, y);
}

/**
 * Projects an array of image-space points to viewport coordinates.
 * @param {Array<{x: number, y: number}>} points - Array of points in image space
 * @returns {Array<Array<number>>} - Array of [x, y] viewport coordinates
 */
export function projectXY(points) {
  return points.map((p) => toViewport(p.x, p.y));
}
