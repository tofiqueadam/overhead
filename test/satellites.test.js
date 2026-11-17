import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  satrecFromTle, satrecFromOmm, propagateTeme, observe, periodMinutes, eclipseFraction,
} from '../src/lib/satellites.js';
import { geodeticToEcef, lookAngles } from '../src/lib/geo.js';
import { separation } from '../src/lib/angles.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b} (tol ${tol})`);

// Vallado, Crawford, Hujsak & Kelso (2006), "Revisiting Spacetrack Report #3",
// verification case 00005 (SGP4 near-Earth). Expected TEME state vectors from
// the accompanying tcppver.out at t = 0 and t = 360 min after epoch.
const VALLADO_00005 = [
  '1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753',
  '2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667',
];

test('SGP4 reproduces the Vallado 2006 verification vectors (sat 00005)', () => {
  const rec = satrecFromTle(...VALLADO_00005);
  assert.ok(rec, 'TLE parses');
  const epochMs = (rec.jdsatepoch - 2440587.5) * 86400000;
  const cases = [
    [0, [7022.46529266, -1400.08296755, 0.03995155], [1.893841015, 6.405893759, 4.534807250]],
    [360, [-7154.03120202, -3783.17682504, -3536.19412294], [4.741887409, -4.151817765, -2.093935425]],
  ];
  for (const [min, r, v] of cases) {
    const pv = propagateTeme(rec, new Date(epochMs + min * 60000));
    // Converting the epoch through a JS Date loses sub-millisecond precision,
    // so allow metres, not millimetres.
    close(pv.position.x, r[0], 0.02, `x@${min}`);
    close(pv.position.y, r[1], 0.02, `y@${min}`);
    close(pv.position.z, r[2], 0.02, `z@${min}`);
    close(pv.velocity.x, v[0], 1e-4, `vx@${min}`);
    close(pv.velocity.y, v[1], 1e-4, `vy@${min}`);
    close(pv.velocity.z, v[2], 1e-4, `vz@${min}`);
  }
});

test('ISS matches an independent ephemeris (wheretheiss.at) for the same TLE', () => {
  const fx = JSON.parse(readFileSync(new URL('./fixtures/iss-wheretheiss.json', import.meta.url)));
  const rec = satrecFromTle(...fx.tle);
  assert.ok(rec);
  close(periodMinutes(rec), 92.9, 0.3, 'ISS period');
  const observer = { lat: 9.03, lon: 38.74, height: 2.355 }; // Addis Ababa
  for (const p of fx.positions) {
    const date = new Date(p.timestamp * 1000);
    const s = observe(rec, date, observer);
    // Sub-satellite point: compare as ground distance.
    const refEcef = geodeticToEcef(p.latitude, p.longitude, p.altitude);
    const myEcef = geodeticToEcef(s.lat, s.lon, s.alt);
    const dKm = Math.hypot(refEcef.x - myEcef.x, refEcef.y - myEcef.y, refEcef.z - myEcef.z);
    assert.ok(dKm < 0.1, `position differs by ${dKm.toFixed(2)} km at ${date.toISOString()}`);
    close(s.alt, p.altitude, 0.1, 'altitude km');
    close(s.speed * 3600, p.velocity, 5, 'speed km/h');
    // Look angles from Addis computed from *their* position must agree with ours.
    const ref = lookAngles(observer, refEcef);
    const sep = separation(s.az, s.el, ref.az, ref.el);
    assert.ok(sep < 0.01, `az/el differ by ${sep.toFixed(3)} deg`);
  }
});

test('OMM JSON and TLE for the same element set agree', () => {
  const omm = {
    OBJECT_NAME: 'TEST', NORAD_CAT_ID: 5, EPOCH: '2000-06-27T18:50:19.733568',
    MEAN_MOTION: 10.82419157, ECCENTRICITY: 0.1859667, INCLINATION: 34.2682,
    RA_OF_ASC_NODE: 348.7242, ARG_OF_PERICENTER: 331.7664, MEAN_ANOMALY: 19.3264,
    BSTAR: 2.8098e-5, MEAN_MOTION_DOT: 2.3e-7, MEAN_MOTION_DDOT: 0,
  };
  const a = satrecFromOmm(omm);
  const b = satrecFromTle(...VALLADO_00005);
  const t = new Date('2000-06-28T00:00:00Z');
  const pa = propagateTeme(a, t).position;
  const pb = propagateTeme(b, t).position;
  assert.ok(Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z) < 0.5);
});

test('bad elements are rejected, not thrown', () => {
  assert.equal(satrecFromOmm({ NORAD_CAT_ID: 1 }), null);
});

test('range rate sign: approaching is negative, receding positive', () => {
  const fx = JSON.parse(readFileSync(new URL('./fixtures/iss-wheretheiss.json', import.meta.url)));
  const rec = satrecFromTle(...fx.tle);
  const obs = { lat: 9.03, lon: 38.74, height: 0 };
  const t0 = new Date(fx.positions[0].timestamp * 1000);
  const t1 = new Date(t0.getTime() + 1000);
  const a = observe(rec, t0, obs);
  const b = observe(rec, t1, obs);
  close(b.range - a.range, (a.rangeRate + b.rangeRate) / 2, 0.05, 'finite-difference range rate');
});

test('eclipse: satellite on the night side behind Earth is shadowed', () => {
  // Place a point 7000 km from Earth's centre on the far side from the Sun.
  const date = new Date('2026-03-20T12:00:00Z'); // near equinox, Sun ~ +x
  const lit = eclipseFraction({ x: 7000, y: 0, z: 0 }, date);
  const dark = eclipseFraction({ x: -7000, y: 0, z: 0 }, date);
  assert.equal(lit, 0);
  assert.equal(dark, 1);
});
