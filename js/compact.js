// Keep this query aligned with the compact layout in CSS.
export const COMPACT_MQ =
  '(max-width: 900px), (max-width: 1199px) and (max-aspect-ratio: 1/1), (max-width: 1366px) and (pointer: coarse)';

export const compactMediaQuery = () => window.matchMedia(COMPACT_MQ);

export const isCompact = () => window.matchMedia(COMPACT_MQ).matches;
