// Projections from horizontal coordinates (azimuth, elevation) to the screen.
//
// Dome: azimuthal equidistant ("fisheye") chart of the whole sky, zenith at
// the centre, horizon on the rim, north up and east on the LEFT, as the sky
// looks when you lie on your back with your head to the south.
//
// Point mode: a pinhole camera whose orientation comes from the phone's
// DeviceOrientationEvent (or from dragging, on desktop).

import { DEG, RAD, wrap360 } from './angles.js';
import { azElToEnu, enuToAzEl } from './geo.js';

/** Dome: az/el (deg) -> canvas x/y for a chart of radius R centred on (cx, cy). */
export function domeProject(az, el, cx, cy, R) {
  const r = (R * (90 - el)) / 90;
  const a = az * DEG;
  return { x: cx - r * Math.sin(a), y: cy - r * Math.cos(a) };
}

/** Dome inverse: canvas x/y -> az/el. el < 0 means outside the horizon. */
export function domeUnproject(x, y, cx, cy, R) {
  const dx = cx - x;
  const dy = cy - y;
  const r = Math.hypot(dx, dy);
  return { az: wrap360(Math.atan2(dx, dy) * RAD), el: 90 - (90 * r) / R };
}

// --- 3x3 matrices as flat row-major arrays --------------------------------

function mul(a, b) {
  const o = new Array(9);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      o[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
    }
  }
  return o;
}
const rz = (t) => { const c = Math.cos(t), s = Math.sin(t); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
const rx = (t) => { const c = Math.cos(t), s = Math.sin(t); return [1, 0, 0, 0, c, -s, 0, s, c]; };
const ry = (t) => { const c = Math.cos(t), s = Math.sin(t); return [c, 0, s, 0, 1, 0, -s, 0, c]; };

/**
 * Device -> world (east, north, up) rotation from W3C DeviceOrientation
 * angles (deg), with alpha measured from north, i.e. an *absolute* reading.
 * screenAngle (deg) is screen.orientation.angle, so landscape works.
 * R = Rz(alpha) * Rx(beta) * Ry(gamma) * Rz(-screenAngle).
 */
export function deviceToWorld(alpha, beta, gamma, screenAngle = 0) {
  return mul(mul(mul(rz(alpha * DEG), rx(beta * DEG)), ry(gamma * DEG)), rz(-screenAngle * DEG));
}

/**
 * The same kind of matrix for a camera aimed at (az, el) with the top of
 * the screen towards the zenith: used for drag-to-look on desktop.
 * Columns are the screen right, screen up and backwards (-forward) axes.
 */
export function aimAt(azDeg, elDeg) {
  const f = azElToEnu(azDeg, elDeg);
  const a = azDeg * DEG;
  const r = { e: Math.cos(a), n: -Math.sin(a), u: 0 }; // horizontal, right of forward
  const u = { // up = right x forward
    e: r.n * f.u - r.u * f.n,
    n: r.u * f.e - r.e * f.u,
    u: r.e * f.n - r.n * f.e,
  };
  return [r.e, u.e, -f.e, r.n, u.n, -f.n, r.u, u.u, -f.u];
}

/** Where the camera (device -Z axis, i.e. the back camera) is pointing. */
export function lookDirection(R) {
  return enuToAzEl({ e: -R[2], n: -R[5], u: -R[8] });
}

/**
 * Project az/el into a pinhole camera with world rotation R, focal length f
 * (px) and centre (cx, cy). Returns { x, y, front } where front is false for
 * directions behind the viewer (x/y then point the way to turn).
 */
export function cameraProject(azDeg, elDeg, R, f, cx, cy) {
  const d = azElToEnu(azDeg, elDeg);
  // device = R^T * world
  const vx = R[0] * d.e + R[3] * d.n + R[6] * d.u;
  const vy = R[1] * d.e + R[4] * d.n + R[7] * d.u;
  const vz = R[2] * d.e + R[5] * d.n + R[8] * d.u;
  const depth = -vz;
  if (depth <= 1e-6) {
    return { x: cx + vx * 1e4, y: cy - vy * 1e4, front: false };
  }
  return { x: cx + (f * vx) / depth, y: cy - (f * vy) / depth, front: true };
}

/** Focal length in px for a given vertical field of view (deg) and height. */
export function focalLength(height, vfovDeg) {
  return height / 2 / Math.tan((vfovDeg * DEG) / 2);
}

/**
 * iOS Safari exposes a magnetic compass heading (clockwise from north) as
 * webkitCompassHeading while alpha is relative to an arbitrary start. Convert
 * to the absolute, counter-clockwise alpha the matrix above expects.
 */
export function alphaFromCompassHeading(heading) {
  return wrap360(360 - heading);
}
