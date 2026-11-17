// SGP4 propagation for one satellite as seen by one observer.
// Wraps satellite.js (pinned, vendored) and adds the observer geometry from
// geo.js. Pure: callers pass the time and observer explicitly.

import { json2satrec, twoline2satrec } from '../../vendor/satellite.js-7.1.0/io.js';
import { propagate, gstime } from '../../vendor/satellite.js-7.1.0/propagation.js';
import { jday } from '../../vendor/satellite.js-7.1.0/ext.js';
import { sunPos } from '../../vendor/satellite.js-7.1.0/sun.js';
import { shadowFraction } from '../../vendor/satellite.js-7.1.0/shadow.js';
import {
  eciToEcef, eciVelocityToEcef, ecefToGeodetic, geodeticToEcef, enuRotation, enuToAzEl,
} from './geo.js';

/** Fields of a CelesTrak OMM JSON record that SGP4 actually needs. */
export const OMM_FIELDS = [
  'OBJECT_NAME', 'OBJECT_ID', 'NORAD_CAT_ID', 'EPOCH', 'MEAN_MOTION', 'ECCENTRICITY',
  'INCLINATION', 'RA_OF_ASC_NODE', 'ARG_OF_PERICENTER', 'MEAN_ANOMALY', 'BSTAR',
  'MEAN_MOTION_DOT', 'MEAN_MOTION_DDOT',
];

/** Build a satrec from an OMM record; returns null if the elements are unusable. */
export function satrecFromOmm(omm) {
  try {
    const rec = json2satrec(omm);
    return rec.error ? null : rec;
  } catch {
    return null;
  }
}

/** Build a satrec from a classic two-line element set. */
export function satrecFromTle(line1, line2) {
  try {
    const rec = twoline2satrec(line1, line2);
    return rec.error ? null : rec;
  } catch {
    return null;
  }
}

/** Raw SGP4 state in the TEME frame: { position, velocity } in km, km/s, or null. */
export function propagateTeme(satrec, date) {
  const pv = propagate(satrec, date);
  if (!pv || !pv.position || Number.isNaN(pv.position.x)) return null;
  return pv;
}

/** Orbital period in minutes from the satrec's mean motion (rad/min). */
export function periodMinutes(satrec) {
  return (2 * Math.PI) / satrec.no;
}

/**
 * Observer-relative state of a satellite at `date`.
 * observer: { lat, lon, height } (deg, deg, km).
 * Returns { az, el, range, rangeRate, lat, lon, alt, speed, eci } or null.
 *  - az/el in degrees, range km, rangeRate km/s (positive = receding)
 *  - lat/lon/alt: sub-satellite point and altitude above the ellipsoid
 *  - speed: inertial orbital speed, km/s
 */
export function observe(satrec, date, observer, prepared = prepareObserver(observer)) {
  const pv = propagateTeme(satrec, date);
  if (!pv) return null;
  const gmst = gstime(date);
  const r = eciToEcef(pv.position, gmst);
  const v = eciVelocityToEcef(pv.velocity, r, gmst);
  const d = { x: r.x - prepared.ecef.x, y: r.y - prepared.ecef.y, z: r.z - prepared.ecef.z };
  const look = enuToAzEl(prepared.toEnu(d));
  const rangeRate = (d.x * v.x + d.y * v.y + d.z * v.z) / look.range;
  const sub = ecefToGeodetic(r);
  const vi = pv.velocity;
  return {
    az: look.az,
    el: look.el,
    range: look.range,
    rangeRate,
    lat: sub.lat,
    lon: sub.lon,
    alt: sub.height,
    speed: Math.hypot(vi.x, vi.y, vi.z),
    eci: pv.position,
  };
}

/** Precompute the observer's ECEF position and ENU rotation (hot-loop helper). */
export function prepareObserver(observer) {
  return {
    ecef: geodeticToEcef(observer.lat, observer.lon, observer.height ?? 0),
    toEnu: enuRotation(observer.lat, observer.lon),
  };
}

/**
 * Fraction of the Sun's disc hidden by the Earth as seen from the satellite:
 * 0 = fully sunlit, 1 = in umbra. Uses Vallado's low-precision Sun vector,
 * which is ample for shadow tests (~0.01 deg).
 */
export function eclipseFraction(eci, date) {
  const { rsun } = sunPos(jday(date));
  return shadowFraction(rsun, eci);
}

export function isSunlit(eci, date) {
  return eclipseFraction(eci, date) < 0.5;
}
