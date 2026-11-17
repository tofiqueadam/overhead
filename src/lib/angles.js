// Small, dependency-free angle helpers shared by every other module.

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

/** Wrap an angle in degrees into [0, 360). */
export function wrap360(deg) {
  const r = deg % 360;
  if (r >= 0) return r;
  const w = r + 360;
  return w === 360 ? 0 : w; // tiny negatives round up to exactly 360
}

/** Wrap an angle in degrees into [-180, 180). */
export function wrap180(deg) {
  return wrap360(deg + 180) - 180;
}

/** Signed smallest difference a - b in degrees, in [-180, 180). */
export function angleDiff(a, b) {
  return wrap180(a - b);
}

/**
 * Great-circle separation between two horizontal directions, in degrees.
 * Uses the haversine form so it stays accurate for tiny separations.
 */
export function separation(az1, el1, az2, el2) {
  const p1 = el1 * DEG;
  const p2 = el2 * DEG;
  const dp = p2 - p1;
  const dl = (az2 - az1) * DEG;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h))) * RAD;
}

const COMPASS_16 = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
];

/** 16-point compass name for an azimuth in degrees (0 = north, 90 = east). */
export function compassPoint(azDeg) {
  return COMPASS_16[Math.round(wrap360(azDeg) / 22.5) % 16];
}
