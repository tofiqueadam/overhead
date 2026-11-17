// Display formatting. Pure and locale-stable (en-US digits) so readouts line
// up in tabular figures and tests are deterministic.

import { compassPoint, wrap360 } from './angles.js';

const nf = (digits) => new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const n0 = nf(0), n1 = nf(1), n2 = nf(2);

export const deg = (v, digits = 1) => `${nf(digits).format(v)}°`;
export const signedDeg = (v, digits = 1) => `${v >= 0 ? '+' : '−'}${nf(digits).format(Math.abs(v))}°`;
export const azimuth = (az) => `${n1.format(wrap360(az)).padStart(5, '0')}° ${compassPoint(az)}`;
export const km = (v) => `${v >= 1e5 ? n0.format(v) : v >= 100 ? n0.format(v) : n1.format(v)} km`;
export const kmPerS = (v) => `${v >= 0 ? '+' : '−'}${n2.format(Math.abs(v))} km/s`;
export const speed = (kmS) => `${n2.format(kmS)} km/s`;
export const magnitude = (m) => `${m >= 0 ? '+' : '−'}${n1.format(Math.abs(m))}`;

export function distance(distKm) {
  const AU = 149597870.7;
  if (distKm > 0.05 * AU) return `${n2.format(distKm / AU)} AU`;
  return km(distKm);
}

export function latLon(lat, lon, digits = 4) {
  const f = nf(digits);
  return `${f.format(Math.abs(lat))}° ${lat >= 0 ? 'N' : 'S'}, ${f.format(Math.abs(lon))}° ${lon >= 0 ? 'E' : 'W'}`;
}

/** "in 3 min", "in 1 h 05 min", "2 min ago", "now". */
export function relative(ms) {
  const past = ms < 0;
  const s = Math.round(Math.abs(ms) / 1000);
  if (s < 30) return 'now';
  const m = Math.round(s / 60);
  let body;
  if (m < 60) body = `${m} min`;
  else if (m < 48 * 60) body = `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
  else body = `${Math.round(m / 1440)} d`;
  return past ? `${body} ago` : `in ${body}`;
}

/** "4m 32s" style duration. */
export function duration(ms) {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return m ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}

/** Signed scrubber offset: "Live", "T+2h 05m", "T−0h 30m". */
export function offset(minutes) {
  if (minutes === 0) return 'Live';
  const sign = minutes > 0 ? '+' : '−';
  const a = Math.abs(minutes);
  return `T${sign}${Math.floor(a / 60)}h ${String(a % 60).padStart(2, '0')}m`;
}

/** Age of an element set in days, e.g. "0.4 d". */
export function ageDays(epochMs, nowMs) {
  return `${n1.format((nowMs - epochMs) / 86400000)} d`;
}
