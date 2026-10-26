// Viewport coordinate mapping

import { COVER, bgImg } from './state.js';

export function computeCoverFromImage() {
  const vv = window.visualViewport;
  const vw = window.innerWidth;
  const vh = vv ? Math.round(vv.height) : window.innerHeight;
  // The network's coordinates are in the full backdrop's 1920x1080 frame (the img's width and height).
  // Portrait screens load only its middle, which cover places exactly where the full image's middle
  // would be, so the frame, not the loaded file's size, sets the mapping.
  const ready = bgImg && bgImg.naturalWidth > 0;
  const W = ready ? Number(bgImg.getAttribute('width')) : 0;
  const H = ready ? Number(bgImg.getAttribute('height')) : 0;
  
  if (!W || !H) {
    console.warn('Cover: Image not ready yet, dimensions unavailable');
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

export function coverMap(x, y) { 
  return [ x * COVER.s + COVER.dx, y * COVER.s + COVER.dy ]; 
}

export function toViewport(x, y) { 
  return coverMap(x, y);
}

export function projectXY(points) {
  return points.map((p) => toViewport(p.x, p.y));
}
