// Earth-fixed geometry on the WGS-84 ellipsoid: geodetic <-> ECEF and the
// topocentric (east-north-up) look angles an observer on the ground sees.
// Everything is in kilometres and degrees. Pure functions, no globals.

import { DEG, RAD, wrap360, wrap180 } from './angles.js';

export const WGS84_A = 6378.137; // equatorial radius, km
export const WGS84_F = 1 / 298.257223563;
const E2 = WGS84_F * (2 - WGS84_F); // first eccentricity squared

/** Earth rotation rate, rad/s (IERS conventional value). */
export const EARTH_OMEGA = 7.292115e-5;

/**
 * Geodetic latitude/longitude (deg) and height above the ellipsoid (km)
 * to Earth-centred, Earth-fixed cartesian coordinates (km).
 */
export function geodeticToEcef(latDeg, lonDeg, heightKm = 0) {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const n = WGS84_A / Math.sqrt(1 - E2 * sinLat * sinLat);
  return {
    x: (n + heightKm) * cosLat * Math.cos(lon),
    y: (n + heightKm) * cosLat * Math.sin(lon),
    z: (n * (1 - E2) + heightKm) * sinLat,
  };
}

/** ECEF (km) to geodetic { lat, lon, height } using Bowring-style iteration. */
export function ecefToGeodetic({ x, y, z }) {
  const lon = Math.atan2(y, x);
  const p = Math.hypot(x, y);
  let lat = Math.atan2(z, p * (1 - E2));
  let height = 0;
  for (let i = 0; i < 6; i++) {
    const sinLat = Math.sin(lat);
    const n = WGS84_A / Math.sqrt(1 - E2 * sinLat * sinLat);
    height = p / Math.cos(lat) - n;
    lat = Math.atan2(z, p * (1 - (E2 * n) / (n + height)));
  }
  return { lat: lat * RAD, lon: wrap180(lon * RAD), height };
}

/**
 * Rotation from ECEF to the local east-north-up frame of an observer.
 * Returns a function mapping an ECEF *difference* vector to ENU.
 */
export function enuRotation(latDeg, lonDeg) {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  const sL = Math.sin(lat), cL = Math.cos(lat);
  const sO = Math.sin(lon), cO = Math.cos(lon);
  return ({ x, y, z }) => ({
    e: -sO * x + cO * y,
    n: -sL * cO * x - sL * sO * y + cL * z,
    u: cL * cO * x + cL * sO * y + sL * z,
  });
}

/** Azimuth (deg from north, clockwise) and elevation (deg) of an ENU vector. */
export function enuToAzEl({ e, n, u }) {
  const range = Math.hypot(e, n, u);
  return {
    az: wrap360(Math.atan2(e, n) * RAD),
    el: Math.asin(u / range) * RAD,
    range,
  };
}

/** Unit ENU vector for an azimuth/elevation pair in degrees. */
export function azElToEnu(azDeg, elDeg) {
  const az = azDeg * DEG;
  const el = elDeg * DEG;
  return {
    e: Math.cos(el) * Math.sin(az),
    n: Math.cos(el) * Math.cos(az),
    u: Math.sin(el),
  };
}

/**
 * Look angles from an observer to a target, both given in ECEF km.
 * observer: { lat, lon, height } in deg/deg/km.
 */
export function lookAngles(observer, targetEcef) {
  const o = geodeticToEcef(observer.lat, observer.lon, observer.height ?? 0);
  const toEnu = enuRotation(observer.lat, observer.lon);
  return enuToAzEl(toEnu({ x: targetEcef.x - o.x, y: targetEcef.y - o.y, z: targetEcef.z - o.z }));
}

/** Rotate an inertial (TEME/ECI) vector into ECEF using Greenwich sidereal angle (rad). */
export function eciToEcef({ x, y, z }, gmst) {
  const c = Math.cos(gmst);
  const s = Math.sin(gmst);
  return { x: c * x + s * y, y: -s * x + c * y, z };
}

/**
 * Inertial velocity (km/s) to Earth-fixed velocity, removing Earth rotation:
 * v_ecef = R v_eci - omega x r_ecef.
 */
export function eciVelocityToEcef(vEci, rEcef, gmst) {
  const v = eciToEcef(vEci, gmst);
  return {
    x: v.x + EARTH_OMEGA * rEcef.y,
    y: v.y - EARTH_OMEGA * rEcef.x,
    z: v.z,
  };
}
