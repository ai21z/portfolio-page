// User-agent engine sniffs, shared by utils.js and graphics-governor.js.
// Dependency-free so both can import it without creating a cycle (utils.js
// imports getGraphicsBudget from the governor).
export function isFirefox() {
  return /\bFirefox\//.test(navigator.userAgent);
}

export function isWebKit() {
  return /AppleWebKit/i.test(navigator.userAgent)
    && !/(Chrome|Chromium|Edg|OPR|Firefox)/i.test(navigator.userAgent);
}
