// Pass prediction: when does a satellite rise above, culminate in, and set
// below an observer's horizon? Coarse sampling finds horizon crossings, then
// bisection refines them to ~1 s and a golden-section search finds the peak.

import { observe, prepareObserver, periodMinutes, isSunlit } from './satellites.js';

const SEC = 1000;

/**
 * Bisect for the instant elevation crosses `minEl` between t0 and t1 (ms),
 * where f(t0) and f(t1) are on opposite sides. Returns ms.
 */
function bisect(elAt, t0, t1, minEl, tolMs = 500) {
  let a = t0, b = t1;
  const aAbove = elAt(a) >= minEl;
  while (b - a > tolMs) {
    const m = (a + b) / 2;
    if ((elAt(m) >= minEl) === aAbove) a = m; else b = m;
  }
  return (a + b) / 2;
}

/** Golden-section search for the maximum of elAt on [a, b] (ms). */
function peak(elAt, a, b, tolMs = 500) {
  const g = (Math.sqrt(5) - 1) / 2;
  let c = b - g * (b - a);
  let d = a + g * (b - a);
  let fc = elAt(c), fd = elAt(d);
  while (b - a > tolMs) {
    if (fc > fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = elAt(c); }
    else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = elAt(d); }
  }
  return (a + b) / 2;
}

/** Coarse sampling step (ms) suited to the orbit: short for LEO, longer for high orbits. */
export function sampleStepMs(satrec) {
  const p = periodMinutes(satrec);
  return Math.min(Math.max((p * 60 * SEC) / 120, 20 * SEC), 10 * 60 * SEC);
}

/**
 * Find upcoming passes.
 * options:
 *  - hours: search window (default 24)
 *  - minEl: elevation threshold in degrees (default 0)
 *  - maxPasses: stop after this many (default 5)
 *  - sunAltitude: optional (Date) => deg, enables the `visible` flag
 * Returns { passes, alwaysUp, neverUp } where each pass is
 * { start, peak, end, maxEl, startAz, peakAz, endAz, inProgress, visible }.
 * `visible` is true when part of the pass is sunlit while the observer's Sun
 * is below -6 deg (civil twilight or darker); undefined without sunAltitude.
 */
export function findPasses(satrec, from, observer, options = {}) {
  const { hours = 24, minEl = 0, maxPasses = 5, sunAltitude } = options;
  const prepared = prepareObserver(observer);
  const state = (ms) => observe(satrec, new Date(ms), observer, prepared);
  const elAt = (ms) => state(ms)?.el ?? -90;

  const t0 = from.getTime();
  const tEnd = t0 + hours * 3600 * SEC;
  const step = sampleStepMs(satrec);
  const passes = [];

  let prevT = t0;
  let prevUp = elAt(t0) >= minEl;
  let riseT = prevUp ? t0 : null;
  let everUp = prevUp;
  let everDown = !prevUp;

  for (let t = t0 + step; t <= tEnd + step && passes.length < maxPasses; t += step) {
    const tt = Math.min(t, tEnd);
    const up = elAt(tt) >= minEl;
    everUp ||= up;
    everDown ||= !up;
    if (up && !prevUp) {
      riseT = bisect(elAt, prevT, tt, minEl);
    } else if (!up && prevUp && riseT !== null) {
      const setT = bisect(elAt, prevT, tt, minEl);
      passes.push(describe(riseT, setT, riseT === t0));
      riseT = null;
    }
    prevT = tt;
    prevUp = up;
    if (tt === tEnd) break;
  }
  // A pass still in progress at the end of the window is reported open-ended.
  if (riseT !== null && passes.length < maxPasses && everDown) {
    passes.push({ ...describe(riseT, tEnd, riseT === t0), end: null, endAz: null });
  }

  function describe(rise, set, inProgress) {
    const pk = peak(elAt, rise, set);
    const a = state(rise), p = state(pk), b = state(set);
    const pass = {
      start: new Date(rise), peak: new Date(pk), end: new Date(set),
      maxEl: p.el, startAz: a.az, peakAz: p.az, endAz: b.az, inProgress,
    };
    if (sunAltitude) pass.visible = isVisible(rise, set);
    return pass;
  }

  function isVisible(rise, set) {
    const n = Math.max(2, Math.ceil((set - rise) / (20 * SEC)));
    for (let i = 0; i <= n; i++) {
      const ms = rise + ((set - rise) * i) / n;
      const s = state(ms);
      if (!s) continue;
      const d = new Date(ms);
      if (sunAltitude(d) < -6 && isSunlit(s.eci, d)) return true;
    }
    return false;
  }

  return { passes, alwaysUp: everUp && !everDown, neverUp: !everUp };
}
