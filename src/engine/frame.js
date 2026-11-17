// Bulk propagation for one "frame": every enabled satellite at two instants
// t0 and t0 + dt. The renderer interpolates between the two unit vectors, so
// thousands of objects move smoothly while SGP4 runs only once per second.
// Used inside the Web Worker, and on the main thread as a fallback.

import { satrecFromOmm, prepareObserver, topocentric, gstime, isSunlit } from '../lib/satellites.js';

export const STRIDE = 8; // e0 n0 u0 e1 n1 u1 range0 sunlit
const HORIZON_U = Math.sin((-1 * Math.PI) / 180); // keep objects within 1 deg below

/** Turn catalogue records into propagatable entries, dropping bad elements. */
export function buildEntries(records) {
  const out = [];
  for (const r of records) {
    const satrec = satrecFromOmm(r.omm);
    if (satrec) out.push({ id: r.id, mask: r.mask, satrec });
  }
  return out;
}

/**
 * entries: [{ id, mask, satrec }]; enabledMask: bitmask of groups to include.
 * Returns { t0, dt, ids: Int32Array, data: Float32Array } for objects at or
 * near the horizon at either instant.
 */
export function computeFrame(entries, enabledMask, observer, t0, dt) {
  const prepared = prepareObserver(observer);
  const d0 = new Date(t0);
  const d1 = new Date(t0 + dt);
  const g0 = gstime(d0);
  const g1 = gstime(d1);
  const ids = [];
  const data = [];
  for (const { id, mask, satrec } of entries) {
    if (!(mask & enabledMask)) continue;
    const a = topocentric(satrec, d0, prepared, g0);
    if (!a) continue;
    const b = topocentric(satrec, d1, prepared, g1);
    if (!b) continue;
    if (a.u < HORIZON_U && b.u < HORIZON_U) continue;
    ids.push(id);
    data.push(a.e, a.n, a.u, b.e, b.n, b.u, a.range, isSunlit(a.eci, d0) ? 1 : 0);
  }
  return { t0, dt, ids: Int32Array.from(ids), data: Float32Array.from(data) };
}
