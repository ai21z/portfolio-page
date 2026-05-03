// Configuration constants

export const NAV_SPEED_WHEN_ACTIVE = 48;

// Design anchors (1920x1080 reference)
export const NAV_COORDS = {
  intro:   { x: 1640, y: 160 },
  about:   { x: 1466, y: 179 },
  work:    { x: 1463, y: 275 },
  now:     { x: 1170, y: 404 },
  contact: { x: 1432, y: 637 },
  blog:    { x: 1524, y: 411 },
  skills:  { x:  1119, y: 240 }
};

export const NAV_ORDER = ['intro','about','work','now','blog','contact','skills'];

export const LABEL_OFFSET_PX = {
  intro: 34, about: 26, work: 24, now: 22,
  blog: 26, contact: 20, skills: 24
};

export const LABEL_SPEEDS = { 
  about: 65, work: 70, now: 75, blog: 72, 
  contact: 66, skills: 74
};
export const DEFAULT_SPEED = 68;

export const MAX_SPARKS = 12;

// Route parameters
export const MIN_ROUTE_LEN_PX     = 320;
export const MAX_ROUTE_LEN_PX     = 900;
export const RESAMPLE_STEP_PX     = 18;
export const RESAMPLE_MIN_POINTS  = 64;
