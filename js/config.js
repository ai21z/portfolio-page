/**
 * Configuration constants for Necrography
 * All design anchors, speeds, and layout parameters
 */

// ━━━ Navigation Animation ━━━
export const NAV_SPEED_WHEN_ACTIVE = 48;      // reduced by ~17% for better clickability

// ━━━ Design Anchors (1920×1080 reference) ━━━
// [LOCKED-ROUTE] Fixed design anchors in image space - DO NOT CHANGE
export const NAV_COORDS = {
  intro:   { x: 1640, y: 160 },
  about:   { x: 1466, y: 179 },
  work:    { x: 1463, y: 275 },
  now:     { x: 1170, y: 404 },  // Renamed from 'projects'
  contact: { x: 1432, y: 637 },  // Moved to where resume was
  blog:    { x: 1524, y: 411 },  // Moved to where contact was
  skills:  { x:  1119, y: 240 }
};

export const NAV_ORDER = ['intro','about','work','now','blog','contact','skills'];

export const LABEL_OFFSET_PX = {
  intro: 34, about: 26, work: 24, now: 22,
  blog: 26, contact: 20, skills: 24
};

// ━━━ Label Animation Speeds ━━━
export const LABEL_SPEEDS = { 
  about: 65, work: 70, now: 75, blog: 72, 
  contact: 66, skills: 74
};
export const DEFAULT_SPEED = 68; // fallback if label not in LABEL_SPEEDS

// ━━━ Spark System ━━━
export const MAX_SPARKS = 12;

// ━━━ Locked Route Parameters ━━━
export const MIN_ROUTE_LEN_PX     = 320;  // generous travel
export const MAX_ROUTE_LEN_PX     = 900;  // don't span the whole canvas
export const RESAMPLE_STEP_PX     = 18;   // output spacing in pixels
export const RESAMPLE_MIN_POINTS  = 64;   // guarantee enough samples
