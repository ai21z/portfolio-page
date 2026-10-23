// Durations the JS timers share with the stylesheets. The CSS side is --dur-stage and --dur-paper
// in styles/base.css, and tests/motion-tokens.spec.ts checks the two agree.
export const STAGE_FADE_MS = 450;
export const PAPER_MOVE_MS = 300;

// Fallback timers wait a little past the transition they back up, in case transitionend never comes.
export const STAGE_LEAVE_MS = STAGE_FADE_MS + 50;
export const PAPER_SETTLE_MS = PAPER_MOVE_MS + 50;
export const PAPER_CLEANUP_MS = PAPER_MOVE_MS + 60;

// How long after a section switch the governor treats frames as movement, not slowness. Tied to
// the fade, so a longer transition cannot outrun it.
export const SECTION_SWITCH_ACTIVITY_MS = STAGE_FADE_MS * 2;
