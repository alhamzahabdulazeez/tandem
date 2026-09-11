'use strict';
/** Wilson score interval. Two rates differ only if their 95% intervals do not overlap. */
function wilson(successes, trials, z = 1.96) {
  if (!trials) return { lo: 0, hi: 1 };
  const p = successes / trials;
  const d = 1 + (z * z) / trials;
  const c = p + (z * z) / (2 * trials);
  const m = z * Math.sqrt((p * (1 - p)) / trials + (z * z) / (4 * trials * trials));
  return { lo: Math.max(0, (c - m) / d), hi: Math.min(1, (c + m) / d) };
}
function differs(a, b) {
  const A = wilson(a.s, a.n), B = wilson(b.s, b.n);
  return !(A.lo <= B.hi && B.lo <= A.hi);
}
module.exports = { wilson, differs };
