// Single source of truth for the "compact" layout regime (phones AND tablets).
// This string MUST stay byte-identical to the CSS trigger broadened across the
// stylesheets so the CSS layout and the JS behaviour can never drift:
//
//   @media (max-width: 900px),
//          (max-width: 1199px) and (max-aspect-ratio: 1/1),
//          (max-width: 1366px) and (pointer: coarse)
//
// Phones (<=900px) match the first arm; portrait/near-square tablets (e.g. iPad Pro
// 1024x1366) match the aspect-ratio arm; landscape touch tablets (e.g. 1366x1024,
// 11" Android) match the pointer:coarse arm. Genuine desktops/laptops are
// pointer:fine and landscape, so they match none of the arms.
export const COMPACT_MQ =
  '(max-width: 900px), (max-width: 1199px) and (max-aspect-ratio: 1/1), (max-width: 1366px) and (pointer: coarse)';

// A live MediaQueryList for change-listeners (matches becoming/leaving compact).
export const compactMediaQuery = () => window.matchMedia(COMPACT_MQ);

// Synchronous boolean: is the current viewport in the compact (phone/tablet) regime?
export const isCompact = () => window.matchMedia(COMPACT_MQ).matches;
