// Main-thread client for bulk satellite propagation. Prefers a module Web
// Worker; falls back to computing on the main thread if workers are
// unavailable (old browsers, file://).

import { buildEntries, computeFrame, STRIDE } from './frame.js';
import { azElToEnu } from '../lib/geo.js';

export { STRIDE };

export class SkyEngine {
  /** onFrame(frame) is called with { t0, dt, ids, data, ms }. */
  constructor(onFrame) {
    this.onFrame = onFrame;
    this.nextId = 1;
    this.pendingId = 0;
    this.fallbackEntries = null;
    try {
      this.worker = new Worker(new URL('./propagate.worker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = ({ data }) => {
        if (data.type === 'frame' && data.id === this.pendingId) {
          this.pendingId = 0;
          this.onFrame(data);
        }
      };
      this.worker.onerror = (e) => {
        console.warn('Propagation worker failed, using main thread', e.message);
        this.worker = null;
        this.pendingId = 0;
      };
    } catch {
      this.worker = null;
    }
  }

  /** records: [{ id, omm, mask }] */
  setCatalog(records) {
    this.records = records;
    this.fallbackEntries = null;
    this.worker?.postMessage({ type: 'catalog', records });
    this.pendingId = 0;
  }

  get busy() { return this.pendingId !== 0; }

  request(t0, dt, enabledMask, observer) {
    const id = this.nextId++;
    this.pendingId = id;
    if (this.worker) {
      this.worker.postMessage({ type: 'frame', id, t0, dt, enabledMask, observer });
      return;
    }
    // Main-thread fallback: build once, compute now, deliver async.
    this.fallbackEntries ??= buildEntries(this.records ?? []);
    const started = performance.now();
    const f = computeFrame(this.fallbackEntries, enabledMask, observer, t0, dt);
    queueMicrotask(() => {
      if (this.pendingId === id) {
        this.pendingId = 0;
        this.onFrame({ ...f, ms: performance.now() - started });
      }
    });
  }
}

/**
 * Interpolated direction of object i in a frame at time t (ms).
 * Returns { e, n, u } (unit-ish) by lerping the two samples; clamped to a
 * small extrapolation window so a late frame does not run away.
 */
export function interpolate(frame, i, t) {
  const k = Math.max(-0.5, Math.min(1.5, (t - frame.t0) / frame.dt));
  const d = frame.data;
  const o = i * STRIDE;
  const e = d[o] + (d[o + 3] - d[o]) * k;
  const n = d[o + 1] + (d[o + 4] - d[o + 1]) * k;
  const u = d[o + 2] + (d[o + 5] - d[o + 2]) * k;
  const len = Math.hypot(e, n, u) || 1;
  return { e: e / len, n: n / len, u: u / len };
}

export { azElToEnu };
